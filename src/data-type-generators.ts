import type { ColumnType } from "drizzle-orm";
import type { ColumnGeneratorContext } from ".";
import { Generator } from "./generator";

export type GetColumnDataType<CT extends ColumnType> =
  CT extends `${infer DT} ${string}` ? DT : CT;

export type ColumnDataTypeToTsType = {
  string: string;
  number: number;
  bigint: bigint;
  boolean: boolean;
  array: unknown[];
  object: object;
  custom: unknown;
};

export type InferTsType<CT extends ColumnType> =
  GetColumnDataType<CT> extends keyof ColumnDataTypeToTsType
    ? ColumnDataTypeToTsType[GetColumnDataType<CT>]
    : unknown;

export type ColumnDataTypeGenerator<dataType extends ColumnType> = (
  ctx: ColumnGeneratorContext,
) => InferTsType<dataType>;

export const defaultColumnDataTypeGenerators: {
  [columnType in ColumnType]: ColumnDataTypeGenerator<columnType>;
} = {
  // Base types
  boolean: ({ faker }) => faker.datatype.boolean(),
  number: ({ faker }) => faker.number.int({ min: 0, max: 1000 }),
  bigint: ({ faker }) => BigInt(faker.number.int({ min: 0, max: 1000000 })),
  string: ({ index }) => `string_${index}`,
  array: () => [],
  object: () => ({}),
  custom: () => null,

  // Array constraints
  "array vector": ({ faker }) =>
    Array.from({ length: 3 }, () => faker.number.float()),
  "array int64vector": ({ faker }) =>
    Array.from({ length: 3 }, () => BigInt(faker.number.int({ max: 100 }))),
  "array halfvector": ({ faker }) =>
    Array.from({ length: 3 }, () => faker.number.float()),
  "array basecolumn": () => [],
  "array point": ({ faker }) => [
    faker.number.float({ max: 100 }),
    faker.number.float({ max: 100 }),
  ],
  "array geometry": () => [],
  "array line": () => [],

  // BigInt constraints
  "bigint int64": ({ faker }) => BigInt(faker.number.int()),
  "bigint uint64": ({ faker }) => BigInt(faker.number.int({ min: 0 })),

  // Number constraints
  "number double": ({ faker }) => faker.number.float({ min: -1000, max: 1000 }),
  "number float": ({ faker }) => faker.number.float({ min: -1000, max: 1000 }),
  "number int8": ({ faker }) => faker.number.int({ min: -128, max: 127 }),
  "number int16": ({ faker }) => faker.number.int({ min: -32768, max: 32767 }),
  "number int24": ({ faker }) =>
    faker.number.int({ min: -8388608, max: 8388607 }),
  "number int32": ({ faker }) =>
    faker.number.int({ min: -2147483648, max: 2147483647 }),
  "number int53": ({ faker }) => faker.number.int(),
  "number udouble": ({ faker }) => faker.number.float({ min: 0, max: 1000 }),
  "number ufloat": ({ faker }) => faker.number.float({ min: 0, max: 1000 }),
  "number uint8": ({ faker }) => faker.number.int({ min: 0, max: 255 }),
  "number uint16": ({ faker }) => faker.number.int({ min: 0, max: 65535 }),
  "number uint24": ({ faker }) => faker.number.int({ min: 0, max: 16777215 }),
  "number uint32": ({ faker }) => faker.number.int({ min: 0, max: 4294967295 }),
  "number uint53": ({ faker }) => faker.number.int({ min: 0 }),
  "number unsigned": ({ faker }) => faker.number.int({ min: 0, max: 1000 }),
  "number year": ({ faker }) => faker.number.int({ min: 1970, max: 2030 }),

  // Object constraints
  "object buffer": ({ index }) => Buffer.from(`buffer_${index}`),
  "object date": ({ faker }) => faker.date.past(),
  "object geometry": ({ faker }) => ({
    type: "Point",
    coordinates: [
      faker.number.float({ max: 180 }),
      faker.number.float({ max: 90 }),
    ],
  }),
  "object json": ({ faker, index }) => ({
    id: index,
    value: faker.lorem.word(),
  }),
  "object line": ({ faker }) => ({
    start: [0, 0],
    end: [faker.number.float({ max: 100 }), faker.number.float({ max: 100 })],
  }),
  "object point": ({ faker }) => ({
    x: faker.number.float({ max: 100 }),
    y: faker.number.float({ max: 100 }),
  }),
  // Gel-specific
  "object dateDuration": ({ faker }) => ({
    days: faker.number.int({ min: 0, max: 365 }),
  }),
  "object duration": ({ faker }) => ({
    milliseconds: faker.number.int({ min: 0, max: 86400000 }),
  }),
  "object localDate": ({ faker }) => faker.date.anytime(),
  "object localDateTime": ({ faker }) => faker.date.anytime(),
  "object localTime": ({ faker }) => faker.date.anytime(),
  "object relDuration": ({ faker }) => ({
    milliseconds: faker.number.int({ min: 0, max: 86400000 }),
  }),

  // String constraints
  "string binary": ({ index }) =>
    Buffer.from(`bin_${index}`).toString("base64"),
  "string cidr": ({ faker }) => `${faker.internet.ipv4()}/24`,
  "string date": ({ faker }) =>
    faker.date.anytime().toISOString().split("T")[0]!,
  "string datetime": ({ faker }) => faker.date.anytime().toISOString(),
  "string enum": () => "value", // Needs column-specific handling
  "string inet": ({ faker }) => faker.internet.ipv4(),
  "string int64": ({ faker }) => String(faker.number.int()),
  "string interval": ({ faker }) =>
    `${faker.number.int({ min: 1, max: 30 })} days`,
  "string macaddr": ({ faker }) => faker.internet.mac(),
  "string macaddr8": ({ faker }) => `${faker.internet.mac()}:00:00`,
  "string numeric": ({ faker }) =>
    faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }).toFixed(2),
  "string sparsevec": ({ faker }) =>
    `{1:${faker.number.float({ fractionDigits: 2 }).toFixed(2)},2:${faker.number
      .float({ fractionDigits: 2 })
      .toFixed(2)}}`,
  "string time": ({ faker }) => {
    const h = faker.number.int({ min: 0, max: 23 }).toString().padStart(2, "0");
    const m = faker.number.int({ min: 0, max: 59 }).toString().padStart(2, "0");
    const s = faker.number.int({ min: 0, max: 59 }).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  },
  "string timestamp": ({ faker }) => faker.date.anytime().toISOString(),
  "string uint64": ({ faker }) => String(faker.number.int({ min: 0 })),
  "string unumeric": ({ faker }) =>
    faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }).toFixed(2),
  "string uuid": ({ faker }) => faker.string.uuid(),
};

export const DataTypeGenerator = Generator.create((ctx) => {
  const generator = defaultColumnDataTypeGenerators[ctx.columnDef.dataType];

  if (!generator) {
    throw new Error(`No generator for dataType: ${ctx.columnDef.dataType}`);
  }

  return generator(ctx as ColumnGeneratorContext);
});
