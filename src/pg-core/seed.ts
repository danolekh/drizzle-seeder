import { type ColumnType, is } from "drizzle-orm";
import { getTableConfig, PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { faker } from "../faker";
import {
  type ColumnGenerator,
  type ColumnGeneratorContext,
  defaultDataTypeGenerators,
} from "../generator";

type PgSchema = Record<string, PgTable | any>;

type getTablesFromSchemaExport<schema extends PgSchema> = {
  [exportName in keyof schema]: schema[exportName] extends PgTable
    ? exportName
    : never;
}[keyof schema];

export type TableSeedConfig<
  schema extends PgSchema,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
  tableName extends keyof schema,
  table extends PgTable,
  columnOrder extends readonly (keyof table["_"]["columns"])[],
> = {
  count?: number;
  columnOrder?: columnOrder;
  columns?: {
    [column in keyof table["_"]["columns"]]?: (
      ctx: ColumnGeneratorContext<
        schema,
        tableOrder,
        tableName,
        table,
        column,
        columnOrder
      >,
    ) => table["_"]["columns"][column]["_"]["notNull"] extends false
      ? table["_"]["columns"][column]["_"]["data"] | null
      : table["_"]["columns"][column]["_"]["data"];
  };
};

export type RefineConfig<
  schema extends PgSchema,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  [tableName in tableOrder[number]]?: TableSeedConfig<
    schema,
    tableOrder,
    tableName,
    schema[tableName],
    readonly (keyof schema[tableName]["_"]["columns"])[]
  >;
};

export type GenerateOptions<
  schema extends PgSchema,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  tableOrder: tableOrder;
  seed?: number;
};

export type GenerateResult<
  schema extends PgSchema,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  [table in tableOrder[number]]: Array<{
    [col in keyof schema[table]["_"]["columns"]]: schema[table]["_"]["columns"][col]["_"]["data"];
  }>;
} & {
  refine(
    config: RefineConfig<schema, tableOrder>,
  ): GenerateResult<schema, tableOrder>;
};

export const generate = <
  schema extends PgSchema,
  const tableOrder extends readonly getTablesFromSchemaExport<schema>[],
>(
  inputSchema: schema,
  options: GenerateOptions<schema, tableOrder>,
): GenerateResult<schema, tableOrder> => {
  const { tableOrder, seed = 0 } = options;

  const generateWithConfig = (
    config: RefineConfig<schema, tableOrder>,
  ): GenerateResult<schema, tableOrder> => {
    faker.seed(seed);

    const tablesOrder = new Set(tableOrder) as Set<keyof schema>;
    const generatedSchema = {} as Record<keyof schema, any[]>;

    for (const tableKey of tablesOrder) {
      const tableDef = inputSchema[tableKey]! as PgTable;

      const columnNameToTsKey = Object.keys(tableDef)
        .filter((key) => is((tableDef as any)[key], PgColumn))
        .reduce(
          (acc, tsKey) => ({ ...acc, [(tableDef as any)[tsKey].name]: tsKey }),
          {} as Record<string, string>,
        );

      const tableConfigDrizzle = getTableConfig(tableDef);
      const tableConfigUser = config[tableKey as tableOrder[number]];

      const columnOrder = new Set([
        ...((tableConfigUser?.columnOrder as string[] | undefined)?.map(
          (columnKey) =>
            ((inputSchema[tableKey] as any)[columnKey] as PgColumn).name,
        ) ?? []),
        ...tableConfigDrizzle.columns.map((col) => col.name),
      ]) as Set<string>;

      const count = tableConfigUser?.count ?? 50;
      const generatedRows: any[] = [];

      for (let index = 0; index < count; ++index) {
        const self: Record<string, any> = {};

        for (const columnName of columnOrder) {
          const columnTsKey = columnNameToTsKey[columnName]!;
          const columnConfig = tableConfigDrizzle.columns.find(
            (col) => col.name === columnName,
          );

          if (!columnConfig)
            throw new Error(`No column config found for ${columnName}`);

          const refined =
            tableConfigUser?.columns?.[
              columnTsKey as keyof typeof tableConfigUser.columns
            ];

          const generator: ColumnGenerator<ColumnType> = refined
            ? (refined as any)
            : defaultDataTypeGenerators[columnConfig.dataType as ColumnType];

          const ctx = {
            index,
            count,
            faker,
            self,
            generatedRows,
            generatedSchema,
          };

          const value = generator(ctx as any);

          self[columnTsKey] = value;
        }

        generatedRows.push(self);
      }

      generatedSchema[tableKey] = generatedRows;
    }

    const result = generatedSchema as GenerateResult<schema, tableOrder>;

    Object.defineProperty(result, "refine", {
      value: (newConfig: RefineConfig<schema, tableOrder>) =>
        generateWithConfig(newConfig),
      enumerable: false,
      writable: false,
      configurable: false,
    });

    return result;
  };

  return generateWithConfig({} as RefineConfig<schema, tableOrder>);
};
