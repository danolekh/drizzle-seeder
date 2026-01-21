# drizzle-seeder

Type-safe database seeding for [Drizzle ORM](https://orm.drizzle.team/).

- works with drizzle@beta version
- only postgres & sqlite supported for now

## Installation

```bash
pnpm add drizzle-seeder
```

## Usage

### Postgres | SQLite

```typescript
import { generate, seed, reset } from "drizzle-seeder/pg-core"; // or sqlite-core
import * as schema from "./schema";

// Define generator for your seed data
const BOOK_COUNT = 30;
const AVG_NOTES_PER_BOOK = 20;
const REVIEW_PROBABILITY = 0.6;
const AVG_REVIEWS_PER_BOOK = 2;

const generator = generate(schema, {
  tableOrder: ["books", "reviews", "notes"],
  seed: 42,
}).refine({
  // Define what columns will be potentially referenced by others
  refs: ["books.id"],
  tables: {
    books: {
      count: BOOK_COUNT,
      columns: {
        title: (ctx) => ctx.faker.book.title(),
        author: (ctx) => ctx.faker.person.fullName(),
        coverUrl: (ctx) =>
          ctx.faker.helpers.maybe(() => ctx.faker.image.url(), {
            probability: 0.7,
          }) ?? null,
      },
    },
    reviews: {
      count: Math.floor(BOOK_COUNT * REVIEW_PROBABILITY * AVG_REVIEWS_PER_BOOK),
      columns: {
        bookId: (ctx) => {
          // Spread reviews across books, some get multiple
          const bookIndex = Math.floor(ctx.index / AVG_REVIEWS_PER_BOOK);
          // Access referenced column value
          return ctx.ref.books[bookIndex % BOOK_COUNT]!.id((v) => v);
        },
        rating: (ctx) =>
          ctx.faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
        body: (ctx) => ctx.faker.lorem.paragraph(),
      },
    },
    notes: {
      count: BOOK_COUNT * AVG_NOTES_PER_BOOK,
      columns: {
        bookId: (ctx) => {
          // Distribute notes across books
          const bookIndex = Math.floor(ctx.index / AVG_NOTES_PER_BOOK);
          return ctx.ref.books[bookIndex % BOOK_COUNT]!.id((v) => v);
        },
        referenceText: (ctx) =>
          ctx.faker.helpers.maybe(() => ctx.faker.lorem.sentence(), {
            probability: 0.8,
          }) ?? null,
        body: (ctx) => ctx.faker.lorem.sentences({ min: 1, max: 3 }),
      },
    },
  },
});

// Seed your database
await seed(db, generator);

// Reset (truncate) tables
await reset(db, schema);
```

WIP

## License

MIT
