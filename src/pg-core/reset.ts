import { is, sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export const reset = async (
  db: PgAsyncDatabase<any, any>,
  schema: Record<string, PgTable | any>,
) => {
  const tablesToTruncate = Object.values(schema)
    .filter((ent) => is(ent, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      config.schema ??= "public";

      return `"${config.schema}"."${config.name}"`;
    });

  await db.execute(sql.raw(`truncate ${tablesToTruncate.join(",")} cascade;`));
};
