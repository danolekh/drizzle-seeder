import { DuplicateChecker } from "../duplicate-checker";
import type {
  getColumnGeneratorContext,
  getPossibleRefs,
  SchemaExport,
  getColumnsWithoutGeneratedAs,
  getTablesFromSchemaExport,
  inferColumnType,
} from "../shared";
import { RefinedGenerator, type BaseGenerator } from "../generators";
import { faker } from "../faker";
import { getColumnNameToTsKeyMap } from "../helpers";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  columnValueReference,
  generatedAsPlaceholder,
  type ColumnValueReference,
  type GeneratedAsPlaceholder,
} from "../placeholders";
import { DefaultGenerator } from "./generators/default.generator";

export type getGenerateOptions<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  tableOrder: tableOrder;
  seed?: number;
  generator?: BaseGenerator;
};

export type getTableRefineConfig<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  tableKey extends keyof schema,
  table extends SQLiteTable,
  columnOrder extends readonly getColumnsWithoutGeneratedAs<schema[tableKey]>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
> = {
  count?: number;
  columnOrder?: columnOrder;
  columns?: {
    [columnKey in getColumnsWithoutGeneratedAs<schema[tableKey]>]?: (
      ctx: getColumnGeneratorContext<
        schema,
        tableOrder,
        tableKey,
        table,
        columnKey,
        columnOrder,
        schema[tableKey]["_"]["columns"][columnKey],
        refs
      >,
    ) =>
      | inferColumnType<schema[tableKey][columnKey]>
      | ColumnValueReference<inferColumnType<schema[tableKey][columnKey]>>;
  };
};

export type getRefineConfig<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
> = {
  refs: refs;
  tables: {
    [tableKey in tableOrder[number]]?: getTableRefineConfig<
      schema,
      tableOrder,
      tableKey,
      schema[tableKey],
      getColumnsWithoutGeneratedAs<schema[tableKey]>[],
      refs
    >;
  };
};

export type inferGeneratorStreamChunk<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  [tableKey in tableOrder[number]]: {
    [columnKey in keyof schema[tableKey]["_"]["columns"]]:
      | inferColumnType<schema[tableKey][columnKey]>
      | ColumnValueReference<inferColumnType<schema[tableKey][columnKey]>>
      | GeneratedAsPlaceholder;
  } & {
    _tag: tableKey;
  };
}[tableOrder[number]];

const createRefProxy = () => {
  // ref.users[10].name(value => `${value.toLowerCase()}@example.com`)
  return new Proxy(
    {},
    {
      get: (_, tableName: string) => {
        return new Proxy(
          {},
          {
            get: (_, rowIndex: string) => {
              return new Proxy(
                {},
                {
                  get: (_, columnName: string) => {
                    return (transformFn: (value: any) => any) => {
                      return columnValueReference({
                        refTableName: tableName,
                        refRowIndex: parseInt(rowIndex, 10),
                        refColumnName: columnName,
                        transformFn: transformFn,
                      });
                    };
                  },
                },
              );
            },
          },
        );
      },
    },
  );
};

export class SqliteGenerator<
  schema extends SchemaExport,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  refs extends Array<getPossibleRefs<schema, tableOrder>>,
> {
  private config: getRefineConfig<schema, tableOrder, refs> | null = null;

  constructor(
    private schema: schema,
    private generateOptions: getGenerateOptions<schema, tableOrder>,
  ) {}

  *[Symbol.iterator](): Generator<inferGeneratorStreamChunk<schema, tableOrder>, any, any> {
    const { tableOrder, seed = 0, generator = DefaultGenerator } = this.generateOptions;

    faker.seed(seed);
    const tablesOrder = new Set(tableOrder);
    const inputSchema = this.schema;
    const config = (this.config ?? {}) as getRefineConfig<schema, tableOrder, refs>;

    const refProxy = createRefProxy();

    for (const tableKey of tablesOrder) {
      const table = inputSchema[tableKey];
      const columnNameToTsKey = getColumnNameToTsKeyMap(table);
      const tableConf = getTableConfig(table);
      const tableRefinements = config.tables[tableKey];

      const columnOrder = new Set([
        ...(tableRefinements?.columnOrder?.map(
          (columnKey) => inputSchema[tableKey][columnKey].name,
        ) ?? []),
        ...tableConf.columns.map((col) => col.name),
      ]) as Set<string>;

      const count = tableRefinements?.count ?? 50;

      const duplicateCheckers: Record<string, DuplicateChecker<unknown>> = tableConf.columns
        .filter((col) => col.isUnique)
        .reduce((acc, col) => ({ ...acc, [col.name]: new DuplicateChecker() }), {});

      for (let index = 0; index < count; ++index) {
        const self: Record<string, any> = {
          _tag: tableKey,
        };

        for (const columnName of columnOrder) {
          const columnTsKey = columnNameToTsKey[columnName]!;
          const columnConfig = tableConf.columns.find((col) => col.name === columnName);

          if (columnConfig?.generated) {
            self[columnTsKey] = generatedAsPlaceholder();
            continue;
          }

          if (!columnConfig) throw new Error(`No column config found for ${columnName}`);

          const ctx = {
            index,
            count,
            faker,
            columnDef: columnConfig,
            self,
            duplicateChecker: duplicateCheckers[columnName],
            tableKey: tableKey as string,
            columnKey: columnTsKey,
            ref: refProxy,
            super: () => {
              throw new Error("End of generator chain");
            },
          };

          self[columnTsKey] = generator.generate(ctx);
        }

        yield self as inferGeneratorStreamChunk<schema, tableOrder>;
      }
    }
  }

  refine<refineConfig extends getRefineConfig<schema, tableOrder, refs>>(config: refineConfig) {
    this.config = config;
    this.generateOptions.generator = (this.generateOptions.generator ?? DefaultGenerator).extend(
      new RefinedGenerator(config),
    );
    return this;
  }

  getRefineConfig(): getRefineConfig<schema, tableOrder, refs> | null {
    return this.config;
  }

  getSchema(): schema {
    return this.schema;
  }
}

export function generate<
  schema extends SchemaExport,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
>(schema: schema, generateOptions: getGenerateOptions<schema, tableOrder>) {
  return new SqliteGenerator(schema, generateOptions);
}
