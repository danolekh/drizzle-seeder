import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase, SQLiteTable } from "drizzle-orm/sqlite-core";

export const reset = async (
  db: BaseSQLiteDatabase<any, any>,
  schema: Record<string, SQLiteTable | any>,
) => {
  const tablesToTruncate = Object.values(schema)
    .filter((ent) => is(ent, PgTable))
    .map((table) => {
      return getTableName(table);
    });

  await db.run(sql.raw("PRAGMA foreign_keys = OFF"));

  for (const tableName of tablesToTruncate) {
    const sqlQuery = `delete from \`${tableName}\`;`;
    await db.run(sql.raw(sqlQuery));
  }

  await db.run(sql.raw("PRAGMA foreign_keys = ON"));
};
