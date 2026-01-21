import { Column, is, Table } from "drizzle-orm";

export const getColumnNameToTsKeyMap = (table: Table) =>
  Object.keys(table)
    .filter((key) => is((table as any)[key], Column))
    .reduce(
      (acc, tsKey) => ({ ...acc, [(table as any)[tsKey].name]: tsKey }),
      {} as Record<string, string>,
    );

export const getColumnTsKeyToNameMap = (table: Table) =>
  Object.keys(table)
    .filter((key) => is((table as any)[key], Column))
    .reduce(
      (acc, tsKey) => ({ ...acc, [tsKey]: (table as any)[tsKey].name }),
      {} as Record<string, string>,
    );
