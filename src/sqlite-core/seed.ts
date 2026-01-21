import type {
  getPossibleRefs,
  getTablesFromSchemaExport,
  SchemaExport,
} from "../shared";
import type { SqliteGenerator } from "./generate";
import {
  isColumnValueReference,
  isGeneratedAsPlaceholder,
  type ColumnValueReference,
} from "../placeholders";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import Database from "better-sqlite3";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { stringify, parse } from "devalue";

const SQLITE_MAX_PARAMETERS = 999;

// Database type that supports insert operations
type DrizzleDb = {
  insert: (table: SQLiteTable) => {
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

class SqliteSeeder<
  schema extends SchemaExport,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
> {
  private refsConfig: Map<string, Set<string>>;
  private executionId = randomUUID();
  private schema: schema;
  private generator: SqliteGenerator<schema, tableOrder, refs>;

  constructor(
    private db: DrizzleDb,
    generator: SqliteGenerator<schema, tableOrder, refs>,
  ) {
    this.generator = generator;
    this.schema = generator.getSchema();
    const refineConfig = generator.getRefineConfig();

    // Parse refs config into a map of tableName -> Set<columnName>
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
    return Math.floor(SQLITE_MAX_PARAMETERS / columnCount);
  }

  // eslint-ignore
  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private createRefDatabase() {
    const tempPath = join(tmpdir(), `drizzle-seeder-${this.executionId}.db`);
    const db = new Database(tempPath);

    // Create tables for each referenced table
    for (const [tableName, columns] of this.refsConfig) {
      const cols = Array.from(columns)
        .map((c) => `"${c}" TEXT`)
        .join(", ");
      db.exec(
        `CREATE TABLE IF NOT EXISTS "${tableName}" (_rowIndex INTEGER PRIMARY KEY${cols ? ", " + cols : ""})`,
      );
      db.exec(
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

  private extractRefs(
    chunk: Record<string, unknown>,
  ): ColumnValueReference<unknown>[] {
    const refs: ColumnValueReference<unknown>[] = [];
    for (const value of Object.values(chunk)) {
      if (isColumnValueReference(value)) {
        refs.push(value);
      }
    }
    return refs;
  }

  private refExists(
    ref: ColumnValueReference<unknown>,
    sqliteDb: Database.Database,
  ): boolean {
    const stmt = sqliteDb.prepare(
      `SELECT 1 FROM "${ref.refTableName}" WHERE _rowIndex = ?`,
    );
    const row = stmt.get(ref.refRowIndex);
    return row !== undefined;
  }

  private resolveRef(
    ref: ColumnValueReference<unknown>,
    sqliteDb: Database.Database,
  ): unknown {
    const stmt = sqliteDb.prepare(
      `SELECT "${ref.refColumnName}" FROM "${ref.refTableName}" WHERE _rowIndex = ?`,
    );
    const row = stmt.get(ref.refRowIndex) as Record<string, string> | undefined;
    if (!row) return undefined;
    const rawValue = row[ref.refColumnName];
    if (rawValue === undefined) return undefined;
    const value = parse(rawValue);
    return ref.transformFn(value);
  }

  private areAllRefsResolved(
    refs: ColumnValueReference<unknown>[],
    sqliteDb: Database.Database,
  ): boolean {
    for (const ref of refs) {
      if (!this.refExists(ref, sqliteDb)) {
        return false;
      }
    }
    return true;
  }

  private resolveChunk(
    chunk: Record<string, unknown>,
    sqliteDb: Database.Database | null,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(chunk)) {
      if (isColumnValueReference(value)) {
        if (!sqliteDb) {
          throw new Error(
            `Cannot resolve ref without SQLite database: ${value.refTableName}[${value.refRowIndex}].${value.refColumnName}`,
          );
        }
        resolved[key] = this.resolveRef(value, sqliteDb);
      } else if (isGeneratedAsPlaceholder(value)) {
        // Skip generated columns - don't include in insert
        continue;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private async flush(
    tableName: string,
    tableState: TableState,
    sqliteDb: Database.Database | null,
  ): Promise<void> {
    if (tableState.batch.length === 0) return;

    const table = this.schema[tableName] as SQLiteTable;
    if (!table) {
      throw new Error(`Table "${tableName}" not found in schema`);
    }

    // Resolve all chunks in batch
    const resolvedBatch = tableState.batch.map((chunk) =>
      this.resolveChunk(chunk, sqliteDb),
    );

    // Insert into database
    await this.db.insert(table).values(resolvedBatch);

    // Store ref columns in SQLite for future reference resolution
    if (sqliteDb) {
      const refColumns = this.refsConfig.get(tableName);
      if (refColumns && refColumns.size > 0) {
        const columnsList = Array.from(refColumns);
        const placeholders = columnsList.map(() => "?").join(", ");
        const insertStmt = sqliteDb.prepare(
          `INSERT INTO "${tableName}" (_rowIndex, ${columnsList.map((c) => `"${c}"`).join(", ")}) VALUES (?, ${placeholders})`,
        );

        for (let i = 0; i < tableState.batch.length; i++) {
          const chunk = tableState.batch[i];
          if (chunk) {
            const rowIndex = tableState.rowIndices[i];
            const values = columnsList.map((col) => stringify(chunk[col]));
            insertStmt.run(rowIndex, ...values);
          }
        }
      }
    }

    tableState.seededCount += tableState.batch.length;
    tableState.batch = [];
    tableState.rowIndices = [];
  }

  private drainAllQueues(
    tableStates: Map<string, TableState>,
    sqliteDb: Database.Database,
  ): boolean {
    let madeProgress = true;
    let anyProgress = false;

    while (madeProgress) {
      madeProgress = false;

      for (const [, tableState] of tableStates) {
        const stillQueued: QueuedChunk[] = [];

        for (const queued of tableState.queue) {
          if (this.areAllRefsResolved(queued.pendingRefs, sqliteDb)) {
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
    sqliteDb: Database.Database | null,
  ): Promise<void> {
    for (const [tableName, tableState] of tableStates) {
      if (tableState.batch.length >= tableState.batchSize) {
        await this.flush(tableName, tableState, sqliteDb);
        // After flushing, try to drain queues again
        if (sqliteDb) {
          this.drainAllQueues(tableStates, sqliteDb);
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

    let sqliteDb: Database.Database | null = null;
    let cleanup: (() => void) | null = null;

    if (hasRefs) {
      const result = this.createRefDatabase();
      sqliteDb = result.db;
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
        } else if (this.areAllRefsResolved(refs, sqliteDb!)) {
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
          await this.flush(tableName, tableState, sqliteDb);

          // After flush, drain all queues
          if (hasRefs && sqliteDb) {
            this.drainAllQueues(tableStates, sqliteDb);
            await this.flushAllQueuesAfterDrain(tableStates, sqliteDb);
          }
        }
      }

      // FINALIZE: Flush all remaining batches
      for (const [tableName, tableState] of tableStates) {
        await this.flush(tableName, tableState, sqliteDb);
      }

      // Final drain of all queues
      if (hasRefs && sqliteDb) {
        let madeProgress = true;
        while (madeProgress) {
          madeProgress = this.drainAllQueues(tableStates, sqliteDb);
          for (const [tableName, tableState] of tableStates) {
            await this.flush(tableName, tableState, sqliteDb);
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
  generator: SqliteGenerator<schema, tableOrder, refs>,
) => {
  return new SqliteSeeder(db, generator);
};
