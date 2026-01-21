import { is } from "drizzle-orm";
import {
  PgChar,
  PgInterval,
  PgNumeric,
  PgNumericBigInt,
  PgNumericNumber,
  PgText,
  PgTimestampString,
  PgVarchar,
  PgVector,
} from "drizzle-orm/pg-core";
import { BaseGenerator, type ExtendedGeneratorContext } from "../../generators/base.generator";

type PgColumnClasses = {
  PgText: InstanceType<typeof PgText>;
  PgVarchar: InstanceType<typeof PgVarchar>;
  PgChar: InstanceType<typeof PgChar>;
  PgNumeric: InstanceType<typeof PgNumeric>;
  PgNumericNumber: InstanceType<typeof PgNumericNumber>;
  PgNumericBigInt: InstanceType<typeof PgNumericBigInt>;
  PgTimestampString: InstanceType<typeof PgTimestampString>;
  PgVector: InstanceType<typeof PgVector>;
  PgInterval: InstanceType<typeof PgInterval>;
};

export type RuntimeConfigHandlerFn<K extends keyof PgColumnClasses> = (
  ctx: Omit<ExtendedGeneratorContext, "columnDef"> & {
    columnDef: PgColumnClasses[K];
  },
) => unknown;

export type RuntimeConfigHandlersMap = {
  [K in keyof PgColumnClasses]?: RuntimeConfigHandlerFn<K>;
};

const columnClassMap = {
  PgText,
  PgVarchar,
  PgChar,
  PgNumeric,
  PgNumericNumber,
  PgNumericBigInt,
  PgTimestampString,
  PgVector,
  PgInterval,
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
  PgText: (ctx) => {
    if (ctx.columnDef.enumValues && ctx.columnDef.enumValues.length > 0) {
      return ctx.faker.helpers.arrayElement([...ctx.columnDef.enumValues]);
    }
    return undefined;
  },

  PgVarchar: (ctx) => {
    if (ctx.columnDef.enumValues && ctx.columnDef.enumValues.length > 0) {
      return ctx.faker.helpers.arrayElement([...ctx.columnDef.enumValues]);
    }
    if (ctx.columnDef.length !== undefined) {
      const baseString = `varchar_${ctx.index}`;
      return baseString.length <= ctx.columnDef.length
        ? baseString
        : ctx.faker.string.alphanumeric({ length: ctx.columnDef.length });
    }
    return undefined;
  },

  PgChar: (ctx) => {
    if (ctx.columnDef.enumValues && ctx.columnDef.enumValues.length > 0) {
      return ctx.faker.helpers.arrayElement([...ctx.columnDef.enumValues]);
    }
    return ctx.faker.string.alphanumeric({ length: ctx.columnDef.length ?? 1 });
  },

  PgNumeric: (ctx) => {
    const { precision, scale } = ctx.columnDef;

    if (precision !== undefined) {
      const integerDigits = scale !== undefined && scale > 0 ? precision - scale : precision;
      const maxInteger = Math.pow(10, integerDigits) - 1;

      if (scale !== undefined && scale > 0) {
        const intPart = ctx.faker.number.int({ min: 0, max: maxInteger });
        const decPart = ctx.faker.number.int({
          min: 0,
          max: Math.pow(10, scale) - 1,
        });
        return `${intPart}.${decPart.toString().padStart(scale, "0")}`;
      }
      return ctx.faker.number.int({ min: 0, max: maxInteger }).toString();
    }
    return undefined;
  },

  PgNumericNumber: (ctx) => {
    const { precision, scale } = ctx.columnDef;

    if (precision !== undefined) {
      const integerDigits = scale !== undefined && scale > 0 ? precision - scale : precision;
      const maxInteger = Math.pow(10, integerDigits) - 1;
      const fractionDigits = scale ?? 0;

      return ctx.faker.number.float({
        min: 0,
        max: maxInteger,
        fractionDigits,
      });
    }
    return undefined;
  },

  PgNumericBigInt: (ctx) => {
    const { precision } = ctx.columnDef;

    if (precision !== undefined) {
      const maxValue = Math.pow(10, precision) - 1;
      return BigInt(
        ctx.faker.number.int({
          min: 0,
          max: Math.min(maxValue, Number.MAX_SAFE_INTEGER),
        }),
      );
    }
    return undefined;
  },

  PgTimestampString: (ctx) => {
    const { precision } = ctx.columnDef;

    const date = ctx.faker.date.anytime();
    let isoString = date.toISOString();

    if (precision !== undefined && precision < 3) {
      const [datePart, timePart] = isoString.split("T");
      const timeWithoutZ = timePart!.slice(0, -1);
      const [hms, ms] = timeWithoutZ.split(".");

      if (precision === 0) {
        isoString = `${datePart}T${hms}Z`;
      } else if (ms) {
        const truncatedMs = ms.slice(0, precision);
        isoString = `${datePart}T${hms}.${truncatedMs}Z`;
      }
    }

    return isoString;
  },

  PgVector: (ctx) => {
    const dimensions = ctx.columnDef.dimensions;

    if (dimensions !== undefined && dimensions > 0) {
      return Array.from({ length: dimensions }, () => ctx.faker.number.float());
    }
    return undefined;
  },

  PgInterval: (ctx) => {
    const { fields } = ctx.columnDef;

    if (fields) {
      switch (fields) {
        case "year":
          return `${ctx.faker.number.int({ min: 1, max: 100 })} years`;
        case "month":
          return `${ctx.faker.number.int({ min: 1, max: 12 })} months`;
        case "day":
          return `${ctx.faker.number.int({ min: 1, max: 365 })} days`;
        case "hour":
          return `${ctx.faker.number.int({ min: 1, max: 24 })} hours`;
        case "minute":
          return `${ctx.faker.number.int({ min: 1, max: 60 })} minutes`;
        case "second":
          return `${ctx.faker.number.int({ min: 1, max: 60 })} seconds`;
        case "year to month":
          return `${ctx.faker.number.int({ min: 1, max: 10 })} years ${ctx.faker.number.int({ min: 0, max: 11 })} months`;
        case "day to hour":
          return `${ctx.faker.number.int({ min: 1, max: 30 })} days ${ctx.faker.number.int({ min: 0, max: 23 })} hours`;
        case "day to minute": {
          const days = ctx.faker.number.int({ min: 1, max: 30 });
          const hours = ctx.faker.number.int({ min: 0, max: 23 });
          const minutes = ctx.faker.number.int({ min: 0, max: 59 });
          return `${days} days ${hours}:${minutes.toString().padStart(2, "0")}`;
        }
        case "day to second": {
          const days = ctx.faker.number.int({ min: 1, max: 30 });
          const hours = ctx.faker.number.int({ min: 0, max: 23 });
          const mins = ctx.faker.number.int({ min: 0, max: 59 });
          const secs = ctx.faker.number.int({ min: 0, max: 59 });
          return `${days} days ${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        }
        case "hour to minute": {
          const h = ctx.faker.number.int({ min: 0, max: 23 });
          const m = ctx.faker.number.int({ min: 0, max: 59 });
          return `${h}:${m.toString().padStart(2, "0")}`;
        }
        case "hour to second": {
          const h = ctx.faker.number.int({ min: 0, max: 23 });
          const m = ctx.faker.number.int({ min: 0, max: 59 });
          const s = ctx.faker.number.int({ min: 0, max: 59 });
          return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        }
        case "minute to second": {
          const m = ctx.faker.number.int({ min: 0, max: 59 });
          const s = ctx.faker.number.int({ min: 0, max: 59 });
          return `${m}:${s.toString().padStart(2, "0")}`;
        }
      }
    }
    return undefined;
  },
};

export const DefaultRuntimeConfigAwareGenerator = new RuntimeConfigAwareGenerator(defaultHandlers);
