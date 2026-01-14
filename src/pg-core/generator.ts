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
import { DataTypeGenerator } from "../data-type-generators";
import { is } from "drizzle-orm";

export const DefaultGenerators = DataTypeGenerator.extend((ctx) => {
  const { columnDef, faker, index } = ctx;

  if (is(columnDef, PgText)) {
    const col = columnDef;
    if (col.enumValues && col.enumValues.length > 0) {
      return faker.helpers.arrayElement([...col.enumValues]);
    }
  }

  if (is(columnDef, PgVarchar)) {
    const col = columnDef as unknown as PgVarchar;
    if (col.enumValues && col.enumValues.length > 0) {
      return faker.helpers.arrayElement([...col.enumValues]);
    }
    if (col.length !== undefined) {
      const baseString = `varchar_${index}`;
      return baseString.length <= col.length
        ? baseString
        : faker.string.alphanumeric({ length: col.length });
    }
  }

  if (is(columnDef, PgChar)) {
    if (columnDef.enumValues && columnDef.enumValues.length > 0) {
      return faker.helpers.arrayElement([...columnDef.enumValues]);
    }
    return faker.string.alphanumeric({ length: columnDef.length ?? 1 });
  }

  if (is(columnDef, PgNumeric)) {
    const { precision, scale } = columnDef;

    if (precision !== undefined) {
      const integerDigits =
        scale !== undefined && scale > 0 ? precision - scale : precision;
      const maxInteger = Math.pow(10, integerDigits) - 1;

      if (scale !== undefined && scale > 0) {
        const intPart = faker.number.int({ min: 0, max: maxInteger });
        const decPart = faker.number.int({
          min: 0,
          max: Math.pow(10, scale) - 1,
        });
        return `${intPart}.${decPart.toString().padStart(scale, "0")}`;
      }
      return faker.number.int({ min: 0, max: maxInteger }).toString();
    }
  }

  if (is(columnDef, PgNumericNumber)) {
    const { precision, scale } = columnDef;

    if (precision !== undefined) {
      const integerDigits =
        scale !== undefined && scale > 0 ? precision - scale : precision;
      const maxInteger = Math.pow(10, integerDigits) - 1;
      const fractionDigits = scale ?? 0;

      return faker.number.float({
        min: 0,
        max: maxInteger,
        fractionDigits,
      });
    }
  }

  if (is(columnDef, PgNumericBigInt)) {
    const { precision } = columnDef;

    if (precision !== undefined) {
      const maxValue = Math.pow(10, precision) - 1;
      return BigInt(
        faker.number.int({
          min: 0,
          max: Math.min(maxValue, Number.MAX_SAFE_INTEGER),
        }),
      );
    }
  }

  if (is(columnDef, PgTimestampString)) {
    const { precision } = columnDef;

    const date = faker.date.anytime();
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
  }

  if (is(columnDef, PgVector)) {
    // drizzle-orm stores vector dimensions in the `length` property
    const dimensions = columnDef.length;

    if (dimensions !== undefined && dimensions > 0) {
      return Array.from({ length: dimensions }, () => faker.number.float());
    }
  }

  if (is(columnDef, PgInterval)) {
    const { fields } = columnDef;

    if (fields) {
      switch (fields) {
        case "year":
          return `${faker.number.int({ min: 1, max: 100 })} years`;
        case "month":
          return `${faker.number.int({ min: 1, max: 12 })} months`;
        case "day":
          return `${faker.number.int({ min: 1, max: 365 })} days`;
        case "hour":
          return `${faker.number.int({ min: 1, max: 24 })} hours`;
        case "minute":
          return `${faker.number.int({ min: 1, max: 60 })} minutes`;
        case "second":
          return `${faker.number.int({ min: 1, max: 60 })} seconds`;
        case "year to month":
          return `${faker.number.int({ min: 1, max: 10 })} years ${faker.number.int({ min: 0, max: 11 })} months`;
        case "day to hour":
          return `${faker.number.int({ min: 1, max: 30 })} days ${faker.number.int({ min: 0, max: 23 })} hours`;
        case "day to minute": {
          const days = faker.number.int({ min: 1, max: 30 });
          const hours = faker.number.int({ min: 0, max: 23 });
          const minutes = faker.number.int({ min: 0, max: 59 });
          return `${days} days ${hours}:${minutes.toString().padStart(2, "0")}`;
        }
        case "day to second": {
          const days = faker.number.int({ min: 1, max: 30 });
          const hours = faker.number.int({ min: 0, max: 23 });
          const mins = faker.number.int({ min: 0, max: 59 });
          const secs = faker.number.int({ min: 0, max: 59 });
          return `${days} days ${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        }
        case "hour to minute": {
          const h = faker.number.int({ min: 0, max: 23 });
          const m = faker.number.int({ min: 0, max: 59 });
          return `${h}:${m.toString().padStart(2, "0")}`;
        }
        case "hour to second": {
          const h = faker.number.int({ min: 0, max: 23 });
          const m = faker.number.int({ min: 0, max: 59 });
          const s = faker.number.int({ min: 0, max: 59 });
          return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        }
        case "minute to second": {
          const m = faker.number.int({ min: 0, max: 59 });
          const s = faker.number.int({ min: 0, max: 59 });
          return `${m}:${s.toString().padStart(2, "0")}`;
        }
      }
    }
  }

  return ctx.super();
});
