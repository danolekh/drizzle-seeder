import type { Column, Table } from "drizzle-orm";
import type { Faker } from "@faker-js/faker";
import type { DuplicateChecker } from "./duplicate-checker";
import type { ColumnValueReference } from "./placeholders";

export type SchemaExport = Record<string, Table | any>;

export type extractTableFromRef<T> = T extends `${infer table}.${string}` ? table : never;
export type extractColumnFromRef<T> = T extends `${string}.${infer column}` ? column : never;

export type getColumnGeneratorContext<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[] =
    getTablesFromSchemaExport<schema>[],
  tableKey extends keyof schema = keyof schema,
  _table extends Table = Table,
  columnKey extends keyof schema[tableKey]["_"]["columns"] = schema[tableKey]["_"]["columns"],
  columnOrder extends readonly getColumnsWithoutGeneratedAs<schema[tableKey]>[] = [],
  columnDefinition extends Column = Column,
  refs extends Array<getPossibleRefs<schema, tableOrder>> = [],
> = {
  index: number;
  count: number;
  faker: Faker;
  columnDef: columnDefinition;
  self: {
    [column in getElementsBefore<columnOrder, columnKey>[number]]: inferColumnType<
      schema[tableKey][column]
    >;
  };
  ref: {
    [table in extractTableFromRef<refs[number]>]: Array<{
      [column in extractColumnFromRef<Extract<refs[number], `${table}.${string}`>>]: <T>(
        cb: (value: inferColumnType<schema[table][column]>) => T,
      ) => ColumnValueReference<T>;
    }>;
  };
  // something like [_]['isUnique'] on drizzle column would be cool to have
  duplicateChecker?: DuplicateChecker<unknown>;
  super: () => any;
  tableKey: tableKey;
  columnKey: columnKey;
};

export type getPossibleRefs<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> = {
  [tableKey in tableOrder[number]]: {
    [column in keyof schema[tableKey]["_"]["columns"]]: tableKey extends string
      ? column extends string
        ? `${tableKey}.${column}`
        : never
      : never;
  }[keyof schema[tableKey]["_"]["columns"]];
}[tableOrder[number]];

export type getElementsBefore<
  Arr extends readonly unknown[],
  T extends any,
  Prev extends unknown[] = [],
> = Arr extends [infer C, ...infer Next]
  ? C extends T
    ? Prev
    : getElementsBefore<Next, T, [...Prev, C]>
  : Prev;

export type getTablesFromSchemaExport<schema extends SchemaExport> = {
  [exportName in keyof schema]: schema[exportName] extends Table ? exportName : never;
}[keyof schema];

export type getColumnsWithoutGeneratedAs<table extends Table> = {
  [column in keyof table["_"]["columns"]]: table["_"]["columns"][column]["_"]["generated"] extends undefined
    ? column
    : never;
}[keyof table["_"]["columns"]];

export type inferColumnType<column extends Column> = column["_"]["notNull"] extends false
  ? column["_"]["data"] | null
  : column["_"]["data"];
