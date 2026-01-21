import { is } from "drizzle-orm";
import { SQLiteText, SQLiteTimestamp, SQLiteBoolean } from "drizzle-orm/sqlite-core";
import { BaseGenerator, type ExtendedGeneratorContext } from "../../generators/base.generator";

type SqliteColumnClasses = {
  SQLiteText: InstanceType<typeof SQLiteText>;
  SQLiteTimestamp: InstanceType<typeof SQLiteTimestamp>;
  SQLiteBoolean: InstanceType<typeof SQLiteBoolean>;
};

export type RuntimeConfigHandlerFn<K extends keyof SqliteColumnClasses> = (
  ctx: Omit<ExtendedGeneratorContext, "columnDef"> & {
    columnDef: SqliteColumnClasses[K];
  },
) => unknown;

export type RuntimeConfigHandlersMap = {
  [K in keyof SqliteColumnClasses]?: RuntimeConfigHandlerFn<K>;
};

const columnClassMap = {
  SQLiteText,
  SQLiteTimestamp,
  SQLiteBoolean,
} as const;

export class RuntimeConfigAwareGenerator extends BaseGenerator {
  constructor(readonly handlersMap: RuntimeConfigHandlersMap) {
    super();
  }

  generate(ctx: ExtendedGeneratorContext): unknown {
    for (const [className, handler] of Object.entries(this.handlersMap)) {
      const columnClass = columnClassMap[className as keyof typeof columnClassMap];
      if (columnClass && handler && is(ctx.columnDef, columnClass)) {
        const result = (handler as RuntimeConfigHandlerFn<any>)(ctx as any);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return ctx.super();
  }

  refine(refinements: RuntimeConfigHandlersMap): RuntimeConfigAwareGenerator {
    return new RuntimeConfigAwareGenerator({
      ...this.handlersMap,
      ...refinements,
    });
  }
}

const defaultHandlers: RuntimeConfigHandlersMap = {
  // Text with enum values or length constraint
  SQLiteText: (ctx) => {
    if (ctx.columnDef.enumValues && ctx.columnDef.enumValues.length > 0) {
      return ctx.faker.helpers.arrayElement([...ctx.columnDef.enumValues]);
    }
    if (ctx.columnDef.length !== undefined) {
      return ctx.faker.string.alphanumeric({ length: ctx.columnDef.length });
    }
    return undefined;
  },

  // Timestamp stored as integer (unix epoch)
  SQLiteTimestamp: (ctx) => {
    const date = ctx.faker.date.anytime();
    // mode determines seconds vs milliseconds
    if (ctx.columnDef.mode === "timestamp_ms") {
      return date.getTime();
    }
    return Math.floor(date.getTime() / 1000);
  },

  // Boolean stored as integer (0/1)
  SQLiteBoolean: (ctx) => {
    return ctx.faker.datatype.boolean() ? 1 : 0;
  },
};

export const DefaultRuntimeConfigAwareGenerator = new RuntimeConfigAwareGenerator(defaultHandlers);
