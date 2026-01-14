import { describe, test, expect, beforeEach } from "bun:test";
import { faker } from "@faker-js/faker";
import {
  pgTable,
  text,
  varchar,
  char,
  numeric,
  timestamp,
  vector,
  interval,
  PgColumnBuilder,
} from "drizzle-orm/pg-core";
import type { IntervalConfig } from "drizzle-orm/pg-core";
import { DefaultGenerators } from "../../src/pg-core/generator";

function createContext(columnBuilder: PgColumnBuilder<any>, index = 0) {
  const columnDef = pgTable("test", { col: columnBuilder }).col;

  return {
    columnDef,
    faker,
    index,
    count: 10,
    self: {},
    generatedRows: [],
    generatedSchema: {},
  };
}

beforeEach(() => {
  faker.seed(12345);
});

describe("DefaultGenerators", () => {
  describe("PgText", () => {
    test("returns enum value when enumValues is set", () => {
      const status = text("status", {
        enum: ["active", "inactive", "pending"],
      });

      const result = DefaultGenerators.resolve(createContext(status)) as string;

      expect(typeof result).toBe("string");
      expect(["active", "inactive", "pending"]).toContain(result);
    });

    test("falls back to base generator when no enumValues", () => {
      const name = text("name");
      const result = DefaultGenerators.resolve(createContext(name, 5));

      expect(result).toBe("string_5");
    });
  });

  describe("PgVarchar", () => {
    test("returns enum value when enumValues is set", () => {
      const role = varchar("role", { enum: ["admin", "user", "guest"] });

      const result = DefaultGenerators.resolve(createContext(role)) as string;

      expect(["admin", "user", "guest"]).toContain(result);
      expect(typeof result).toBe("string");
    });

    test("returns varchar_{index} when length allows", () => {
      const code = varchar("code", { length: 20 });

      const result = DefaultGenerators.resolve(createContext(code, 3));
      expect(result).toBe("varchar_3");
    });

    test("returns alphanumeric of exact length when varchar_{index} exceeds length", () => {
      const short = varchar("short", { length: 5 });
      const result = DefaultGenerators.resolve(createContext(short, 100));
      expect(result).toHaveLength(5);
      expect(typeof result).toBe("string");
    });

    test("falls back to base generator when no length or enumValues", () => {
      const name = varchar("name");
      const result = DefaultGenerators.resolve(createContext(name, 7));
      expect(result).toBe("string_7");
    });
  });

  describe("PgChar", () => {
    test("returns enum value when enumValues is set", () => {
      const grade = char("grade", { enum: ["A", "B", "C", "D", "F"] });
      const result = DefaultGenerators.resolve(createContext(grade)) as string;
      expect(["A", "B", "C", "D", "F"]).toContain(result);
      expect(typeof result).toBe("string");
    });

    test("returns alphanumeric of specified length", () => {
      const code = char("code", { length: 10 });
      const result = DefaultGenerators.resolve(createContext(code));
      expect(result).toHaveLength(10);
      expect(typeof result).toBe("string");
    });

    test("returns alphanumeric of length 1 when no length specified", () => {
      const letter = char("letter");
      const result = DefaultGenerators.resolve(createContext(letter));
      expect(result).toHaveLength(1);
      expect(typeof result).toBe("string");
    });
  });

  describe("PgNumeric", () => {
    test("returns integer string when only precision is set", () => {
      const amount = numeric("amount", { precision: 5 });
      const result = DefaultGenerators.resolve(createContext(amount)) as string;
      expect(typeof result).toBe("string");
      const num = parseInt(result, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(100000);
    });

    test("returns decimal string with correct format when precision and scale are set", () => {
      const price = numeric("price", { precision: 5, scale: 2 });
      const result = DefaultGenerators.resolve(createContext(price)) as string;
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^\d+\.\d{2}$/);
      const [intPart, decPart] = result.split(".");
      expect(parseInt(intPart!, 10)).toBeLessThan(1000);
      expect(decPart).toHaveLength(2);
    });

    test("falls back to base generator when no precision", () => {
      const value = numeric("value");
      const result = DefaultGenerators.resolve(createContext(value));
      expect(typeof result).toBe("string");
    });
  });

  describe("PgNumericNumber", () => {
    test("returns float with correct fractionDigits based on scale", () => {
      const score = numeric("score", {
        precision: 4,
        scale: 2,
        mode: "number",
      });
      const result = DefaultGenerators.resolve(createContext(score)) as number;
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(100);
    });
  });

  describe("PgNumericBigInt", () => {
    test("returns BigInt within precision bounds", () => {
      const bigval = numeric("bigval", { precision: 5, mode: "bigint" });
      const result = DefaultGenerators.resolve(createContext(bigval)) as bigint;
      expect(typeof result).toBe("bigint");
      expect(result).toBeGreaterThanOrEqual(0n);
      expect(result).toBeLessThan(100000n);
    });
  });

  describe("PgTimestampString", () => {
    test("returns ISO string without milliseconds when precision is 0", () => {
      const created = timestamp("created", { mode: "string", precision: 0 });
      const result = DefaultGenerators.resolve(
        createContext(created),
      ) as string;

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    test("returns ISO string with 1 decimal when precision is 1", () => {
      const updated = timestamp("updated", { mode: "string", precision: 1 });
      const result = DefaultGenerators.resolve(
        createContext(updated),
      ) as string;
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\dZ$/);
    });

    test("returns ISO string with 2 decimals when precision is 2", () => {
      const modified = timestamp("modified", { mode: "string", precision: 2 });
      const result = DefaultGenerators.resolve(
        createContext(modified),
      ) as string;
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}Z$/);
    });

    test("returns full ISO string when precision is undefined", () => {
      const tstamp = timestamp("timestamp", { mode: "string" });
      const result = DefaultGenerators.resolve(createContext(tstamp)) as string;
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("PgVector", () => {
    test("returns array of floats with correct dimensions", () => {
      const embedding = vector("embedding", { dimensions: 5 });
      const result = DefaultGenerators.resolve(
        createContext(embedding),
      ) as number[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(5);
      result.forEach((val) => {
        expect(typeof val).toBe("number");
      });
    });

    test("returns array of floats with dimensions 1", () => {
      const vec = vector("vec", { dimensions: 1 });
      const result = DefaultGenerators.resolve(createContext(vec)) as number[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(typeof result[0]).toBe("number");
    });
  });

  describe("PgInterval", () => {
    const intervalCases: Array<{
      field: IntervalConfig["fields"];
      pattern: RegExp;
    }> = [
      { field: "year", pattern: /^\d+ years$/ },
      { field: "month", pattern: /^\d+ months$/ },
      { field: "day", pattern: /^\d+ days$/ },
      { field: "hour", pattern: /^\d+ hours$/ },
      { field: "minute", pattern: /^\d+ minutes$/ },
      { field: "second", pattern: /^\d+ seconds$/ },
      { field: "year to month", pattern: /^\d+ years \d+ months$/ },
      { field: "day to hour", pattern: /^\d+ days \d+ hours$/ },
      { field: "day to minute", pattern: /^\d+ days \d+:\d{2}$/ },
      { field: "day to second", pattern: /^\d+ days \d+:\d{2}:\d{2}$/ },
      { field: "hour to minute", pattern: /^\d+:\d{2}$/ },
      { field: "hour to second", pattern: /^\d+:\d{2}:\d{2}$/ },
      { field: "minute to second", pattern: /^\d+:\d{2}$/ },
    ];

    for (const { field, pattern } of intervalCases) {
      test(`returns correct format for field "${field}"`, () => {
        const duration = interval("duration", { fields: field });
        const result = DefaultGenerators.resolve(
          createContext(duration),
        ) as string;
        expect(result).toMatch(pattern);
      });
    }

    test("falls back to base generator when no fields specified", () => {
      const period = interval("period");
      const result = DefaultGenerators.resolve(createContext(period));
      expect(typeof result).toBe("string");
    });
  });
});
