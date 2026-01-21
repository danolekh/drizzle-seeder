import type { getPossibleRefs, getTablesFromSchemaExport, SchemaExport } from "../shared";
import type { PgGenerator } from "./generate";
import {
  isColumnValueReference,
  isGeneratedAsPlaceholder,
  type ColumnValueReference,
} from "../placeholders";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { createClient, type Client } from "@libsql/client";
import type { PgTable } from "drizzle-orm/pg-core";
import { stringify, parse } from "devalue";

const PG_MAX_PARAMETERS = 65535;

type DrizzleDb = {
  insert: (table: PgTable) => {
    values: (values: Record<string, unknown>[]) => Promise<unknown>;
  };
};

// Per-table state for tracking batches and queued items
type TableState = {
  batch: Record<string, unknown>[];
  queue: QueuedChunk[];
  seededCount: number;
  rowIndices: number[]; // track original rowIndex for each batch item
  batchSize: number; // computed based on column count
  columnCount: number;
};

type QueuedChunk = {
  chunk: Record<string, unknown>;
  rowIndex: number;
  pendingRefs: ColumnValueReference<unknown>[];
};

class PgSeeder<
  schema extends SchemaExport,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
> {
  private refsConfig: Map<string, Set<string>>;
  private executionId = randomUUID();
  private schema: schema;
  private generator: PgGenerator<schema, tableOrder, refs>;

  constructor(
    private db: DrizzleDb,
    generator: PgGenerator<schema, tableOrder, refs>,
  ) {
    this.generator = generator;
    this.schema = generator.getSchema();
    const refineConfig = generator.getRefineConfig();

    this.refsConfig = new Map();

    if (refineConfig) {
      for (const ref of refineConfig.refs) {
        const parts = (ref as string).split(".");
        const table = parts[0];
        const column = parts[1];
        if (table && column) {
          if (!this.refsConfig.has(table)) {
            this.refsConfig.set(table, new Set());
          }
          this.refsConfig.get(table)!.add(column);
        }
      }
    }
  }

  private getBatchSizeForTable(columnCount: number): number {
    return Math.floor(PG_MAX_PARAMETERS / columnCount);
  }

  // eslint-ignore
  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async createRefStore(): Promise<{ db: Client; cleanup: () => void }> {
    const tempPath = join(tmpdir(), `drizzle-seeder-${this.executionId}.db`);
    const db = createClient({ url: `file:${tempPath}` });

    for (const [tableName, columns] of this.refsConfig) {
      const cols = Array.from(columns)
        .map((c) => `"${c}" TEXT`)
        .join(", ");
      await db.execute(
        `CREATE TABLE IF NOT EXISTS "${tableName}" (_rowIndex INTEGER PRIMARY KEY${cols ? ", " + cols : ""})`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS "idx_${tableName}_rowIndex" ON "${tableName}"(_rowIndex)`,
      );
    }

    const cleanup = () => {
      db.close();
      try {
        unlinkSync(tempPath);
      } catch {}
    };

    return { db, cleanup };
  }

  private extractRefs(chunk: Record<string, unknown>): ColumnValueReference<unknown>[] {
    const refs: ColumnValueReference<unknown>[] = [];
    for (const value of Object.values(chunk)) {
      if (isColumnValueReference(value)) {
        refs.push(value);
      }
    }
    return refs;
  }

  private async refExists(ref: ColumnValueReference<unknown>, db: Client): Promise<boolean> {
    const result = await db.execute({
      sql: `SELECT 1 FROM "${ref.refTableName}" WHERE _rowIndex = ?`,
      args: [ref.refRowIndex],
    });
    return result.rows.length > 0;
  }

  private async resolveRef(ref: ColumnValueReference<unknown>, db: Client): Promise<unknown> {
    const result = await db.execute({
      sql: `SELECT "${ref.refColumnName}" FROM "${ref.refTableName}" WHERE _rowIndex = ?`,
      args: [ref.refRowIndex],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const rawValue = row[ref.refColumnName] as string | undefined;
    if (rawValue === undefined) return undefined;
    return ref.transformFn(parse(rawValue));
  }

  private async areAllRefsResolved(
    refs: ColumnValueReference<unknown>[],
    db: Client,
  ): Promise<boolean> {
    for (const ref of refs) {
      if (!(await this.refExists(ref, db))) {
        return false;
      }
    }
    return true;
  }

  private async resolveChunk(
    chunk: Record<string, unknown>,
    db: Client | null,
  ): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(chunk)) {
      if (isColumnValueReference(value)) {
        if (!db) {
          throw new Error(
            `Cannot resolve ref without SQLite database: ${value.refTableName}[${value.refRowIndex}].${value.refColumnName}`,
          );
        }
        resolved[key] = await this.resolveRef(value, db);
      } else if (isGeneratedAsPlaceholder(value)) {
        // Skip generated columns - don't include in insert
        continue;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private async flush(tableName: string, tableState: TableState, db: Client | null): Promise<void> {
    if (tableState.batch.length === 0) return;

    const table = this.schema[tableName] as PgTable;
    if (!table) {
      throw new Error(`Table "${tableName}" not found in schema`);
    }

    // Resolve all chunks in batch
    const resolvedBatch = await Promise.all(
      tableState.batch.map((chunk) => this.resolveChunk(chunk, db)),
    );

    // Insert into database
    await this.db.insert(table).values(resolvedBatch);

    // Store ref columns in SQLite for future reference resolution
    if (db) {
      const refColumns = this.refsConfig.get(tableName);
      if (refColumns && refColumns.size > 0) {
        const columnsList = Array.from(refColumns);
        for (let i = 0; i < tableState.batch.length; i++) {
          const chunk = tableState.batch[i];
          const rowIndex = tableState.rowIndices[i];
          if (chunk && rowIndex !== undefined) {
            const values = columnsList.map((col) => stringify(chunk[col]));
            await db.execute({
              sql: `INSERT INTO "${tableName}" (_rowIndex, ${columnsList.map((c) => `"${c}"`).join(", ")}) VALUES (?, ${columnsList.map(() => "?").join(", ")})`,
              args: [rowIndex, ...values],
            });
          }
        }
      }
    }

    tableState.seededCount += tableState.batch.length;
    tableState.batch = [];
    tableState.rowIndices = [];
  }

  private async drainAllQueues(tableStates: Map<string, TableState>, db: Client): Promise<boolean> {
    let madeProgress = true;
    let anyProgress = false;

    while (madeProgress) {
      madeProgress = false;

      for (const [, tableState] of tableStates) {
        const stillQueued: QueuedChunk[] = [];

        for (const queued of tableState.queue) {
          if (await this.areAllRefsResolved(queued.pendingRefs, db)) {
            // Refs are now resolved, add to batch
            tableState.batch.push(queued.chunk);
            tableState.rowIndices.push(queued.rowIndex);
            madeProgress = true;
            anyProgress = true;
          } else {
            stillQueued.push(queued);
          }
        }

        tableState.queue = stillQueued;
      }
    }

    return anyProgress;
  }

  private async flushAllQueuesAfterDrain(
    tableStates: Map<string, TableState>,
    db: Client | null,
  ): Promise<void> {
    for (const [tableName, tableState] of tableStates) {
      if (tableState.batch.length >= tableState.batchSize) {
        await this.flush(tableName, tableState, db);
        // After flushing, try to drain queues again
        if (db) {
          await this.drainAllQueues(tableStates, db);
        }
      }
    }
  }

  private getUnresolvedRefsError(tableStates: Map<string, TableState>): string {
    const errors: string[] = [];

    for (const [tableName, tableState] of tableStates) {
      for (const queued of tableState.queue) {
        for (const ref of queued.pendingRefs) {
          errors.push(
            `${tableName}[${queued.rowIndex}] → ${ref.refTableName}[${ref.refRowIndex}].${ref.refColumnName}`,
          );
        }
      }
    }

    return `Failed to resolve refs (possible circular dependency):\n${errors.join("\n")}`;
  }

  private async execute(): Promise<void> {
    // Check if refs exist - if not, skip SQLite entirely
    const hasRefs = this.refsConfig.size > 0;

    let db: Client | null = null;
    let cleanup: (() => void) | null = null;

    if (hasRefs) {
      const result = await this.createRefStore();
      db = result.db;
      cleanup = result.cleanup;
    }

    try {
      const tableStates = new Map<string, TableState>();
      const rowIndexByTable = new Map<string, number>();

      // Process generator stream
      for (const chunk of this.generator) {
        const tableName = (chunk as any)._tag as string;

        // Remove _tag from chunk before processing
        const { _tag, ...chunkData } = chunk as Record<string, unknown>;

        // Initialize table state if needed (compute batch size from first chunk)
        if (!tableStates.has(tableName)) {
          const columnCount = Object.keys(chunkData).length;
          tableStates.set(tableName, {
            batch: [],
            queue: [],
            seededCount: 0,
            rowIndices: [],
            columnCount,
            batchSize: this.getBatchSizeForTable(columnCount),
          });
          rowIndexByTable.set(tableName, 0);
        }

        const tableState = tableStates.get(tableName)!;
        const rowIndex = rowIndexByTable.get(tableName)!;
        rowIndexByTable.set(tableName, rowIndex + 1);

        // Extract refs from chunk
        const refs = this.extractRefs(chunkData);

        if (!hasRefs || refs.length === 0) {
          // No refs to resolve, add directly to batch
          tableState.batch.push(chunkData);
          tableState.rowIndices.push(rowIndex);
        } else if (await this.areAllRefsResolved(refs, db!)) {
          // All refs already resolved
          tableState.batch.push(chunkData);
          tableState.rowIndices.push(rowIndex);
        } else {
          // Some refs pending, add to queue
          tableState.queue.push({
            chunk: chunkData,
            rowIndex,
            pendingRefs: refs,
          });
        }

        // Flush if batch is full
        if (tableState.batch.length >= tableState.batchSize) {
          await this.flush(tableName, tableState, db);

          // After flush, drain all queues
          if (hasRefs && db) {
            await this.drainAllQueues(tableStates, db);
            await this.flushAllQueuesAfterDrain(tableStates, db);
          }
        }
      }

      // FINALIZE: Flush all remaining batches
      for (const [tableName, tableState] of tableStates) {
        await this.flush(tableName, tableState, db);
      }

      // Final drain of all queues
      if (hasRefs && db) {
        let madeProgress = true;
        while (madeProgress) {
          madeProgress = await this.drainAllQueues(tableStates, db);
          for (const [tableName, tableState] of tableStates) {
            await this.flush(tableName, tableState, db);
          }
        }
      }

      // Check for stuck items (circular dependencies)
      for (const [, tableState] of tableStates) {
        if (tableState.queue.length > 0) {
          throw new Error(this.getUnresolvedRefsError(tableStates));
        }
      }
    } finally {
      cleanup?.();
    }
  }
}

export const seed = <
  schema extends SchemaExport,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
>(
  db: DrizzleDb,
  generator: PgGenerator<schema, tableOrder, refs>,
) => {
  return new PgSeeder(db, generator);
};
