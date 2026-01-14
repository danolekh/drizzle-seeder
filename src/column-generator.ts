import type { Column } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { Faker } from "./faker";

export type GetElementsBefore<
  Order extends readonly any[],
  Target,
  Acc extends any[] = [],
> = Order extends readonly [infer Head, ...infer Tail]
  ? Head extends Target
    ? Acc
    : GetElementsBefore<Tail, Target, [...Acc, Head]>
  : Acc;

export type ColumnGeneratorContext<
  schema extends Record<string, Table> = Record<string, Table>,
  tableOrder extends readonly (keyof schema)[] = readonly (keyof schema)[],
  tableKey extends keyof schema = keyof schema,
  table extends Table = Table,
  columnKey extends keyof table["_"]["columns"] = keyof table["_"]["columns"],
  column extends Column = Column,
  columnOrder extends
    readonly (keyof table["_"]["columns"])[] = readonly (keyof table["_"]["columns"])[],
> = {
  /** Current row index (0-based) */
  index: number;

  /** Total count of rows being generated for this table */
  count: number;

  /** Faker instance for generating random data */
  faker: Faker;

  /** Column definition from table */
  columnDef: column;

  /** Already-generated columns for current row (based on columnOrder) */
  self: {
    [K in GetElementsBefore<
      columnOrder,
      columnKey
    >[number]]: K extends keyof table["_"]["columns"]
      ? table["_"]["columns"][K]["_"]["data"]
      : never;
  };

  /** All previously generated rows for this table */
  generatedRows: Array<{
    [col in keyof table["_"]["columns"]]: table["_"]["columns"][col]["_"]["data"];
  }>;

  /** All generated data from tables that came before this one in tableOrder */
  generatedSchema: {
    [T in GetElementsBefore<
      tableOrder,
      tableKey
    >[number]]: T extends keyof schema
      ? Array<{
          [col in keyof schema[T]["_"]["columns"]]: schema[T]["_"]["columns"][col]["_"]["data"];
        }>
      : never;
  };

  /** Calls generator chain */
  super: () => unknown;
};

export type RootGeneratorContext<
  schema extends Record<string, Table> = Record<string, Table>,
  tableOrder extends readonly (keyof schema)[] = readonly (keyof schema)[],
  tableKey extends keyof schema = keyof schema,
  table extends Table = Table,
  columnKey extends keyof table["_"]["columns"] = keyof table["_"]["columns"],
  column extends Column = Column,
  columnOrder extends
    readonly (keyof table["_"]["columns"])[] = readonly (keyof table["_"]["columns"])[],
> = Omit<
  ColumnGeneratorContext<
    schema,
    tableOrder,
    tableKey,
    table,
    columnKey,
    column,
    columnOrder
  >,
  "super"
>;

export type ColumnGenerator<returnType extends unknown = unknown> = (
  ctx: ColumnGeneratorContext,
) => returnType;
