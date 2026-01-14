# drizzle-seeder

Type-safe database seeding for [Drizzle ORM](https://orm.drizzle.team/).

- works with drizzle@beta version
- only postgres supported for now

## Installation

```bash
pnpm add drizzle-seeder
```

## Usage

### PostgreSQL

```typescript
import { generate, reset } from "drizzle-seeder/pg-core";
import * as schema from "./schema";

// Generate seed data with defaults
const data = generate(schema, {
  tableOrder: ["users", "posts"],
  seed: 42,
});

console.log(data.users); // Array of generated users
console.log(data.posts); // Array of generated posts

// Generate with custom configuration
const customData = generate(schema, {
  tableOrder: ["users", "posts"],
  seed: 42,
}).refine({
  users: {
    count: 10,
    columns: {
      name: (ctx) => ctx.faker.person.fullName(),
      email: (ctx) => `user${ctx.index}@example.com`,
    },
  },
  posts: {
    count: 50,
    columns: {
      // Access previously generated data
      userId: (ctx) => ctx.generatedSchema.users[ctx.index % 10].id,
    },
  },
});

// Reset (truncate) tables
await reset(db, schema);
```

### Column Generator Context

Each column generator function receives a context object with:

- `index` - Current row index (0-based)
- `count` - Total number of rows being generated
- `faker` - Faker.js instance for generating random data
- `columnDef` - Column definition from table
- `self` - Already-generated columns for the current row
- `generatedRows` - All previously generated rows for this table
- `generatedSchema` - All generated data from tables earlier in `tableOrder`
- `super` - Calls next by priority generator in the chain

### Generic Exports

```typescript
import { faker, defaultDataTypeGenerators } from "drizzle-seeder";
import type { ColumnGeneratorContext, ColumnGenerator } from "drizzle-seeder";
```

## License

MIT
