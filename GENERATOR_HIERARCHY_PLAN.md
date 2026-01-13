# Generator Hierarchy Implementation Plan

## Problem Statement

The current generator system uses `defaultDataTypeGenerators` that map data types (like `'string'`, `'number int32'`) to generator functions. However, these generators are **unaware of column configurations** such as:
- `enumValues` in `text()` columns
- `precision` and `scale` in `numeric()` columns
- `length` in `varchar()` columns
- Array dimensions
- Nullable constraints

**Example Issue:**
```typescript
// Schema definition
const users = pgTable('users', {
  role: text('role', { enum: ['admin', 'user', 'guest'] }), // Has enumValues!
});

// Current behavior: generates "string_0", "string_1", "string_2"
// Desired behavior: generates "admin", "user", or "guest"
```

## Proposed Solution: Three-Layer Generator Hierarchy

### Priority System
```
1. Custom Generator (highest priority)
   ↓ (if not defined)
2. Column Config Generator (medium priority)
   ↓ (if not applicable)
3. Data Type Generator (lowest priority, current default)
```

### Layer Descriptions

#### Layer 1: Custom Generator (via .refine())
- **Current implementation** - already working
- User-provided generator functions via `.refine({ tableName: { columns: { ... } } })`
- Has access to full context: `index`, `count`, `faker`, `self`, `generatedRows`, `generatedSchema`
- **Priority:** HIGHEST - always takes precedence when defined

#### Layer 2: Column Config Generator (NEW)
- **Intelligently generates data based on column metadata**
- Inspects runtime column configuration:
  - `column.enumValues` → pick random enum value
  - `column.precision` & `column.scale` → generate numbers within range
  - `column.length` → generate strings/arrays of appropriate length
  - `column.notNull` → ensure non-null values
  - `column.dimensions` → generate multi-dimensional arrays
  - `column.withTimezone` → include timezone info
- Different implementations for different column types
- **Priority:** MEDIUM - used when no custom generator, but column config exists

#### Layer 3: Data Type Generator (EXISTING)
- **Current `defaultDataTypeGenerators` map**
- Fallback when no custom generator and no special column config
- Generic generators based on data type only
- **Priority:** LOWEST - used as last resort

---

## Architecture Design

### 1. Type Definitions

```typescript
// src/generator.ts

/**
 * Base generator type (unchanged)
 */
export type ColumnGenerator<dataType extends ColumnType> = (
  ctx: ColumnGeneratorContext,
) => InferTsType<dataType>;

/**
 * Column config generator - inspects column metadata
 * Returns a generator function if applicable, or null if not applicable
 */
export type ColumnConfigGeneratorFactory<TColumn = any> = (
  column: TColumn,
) => ColumnGenerator<any> | null;

/**
 * Registry of column config generators by column type
 */
export type ColumnConfigGeneratorsMap = {
  [columnType: string]: ColumnConfigGeneratorFactory;
};
```

### 2. Column Config Generator Registry

Create a map similar to `defaultDataTypeGenerators`, but keyed by **column class name** (e.g., `'PgText'`, `'PgVarchar'`, `'PgNumeric'`):

```typescript
// src/pg-core/column-config-generators.ts

import type { ColumnConfigGeneratorsMap } from '../generator.ts';

export const columnConfigGenerators: ColumnConfigGeneratorsMap = {
  // Text/String types with enum support
  PgText: (column) => {
    if (column.enumValues && column.enumValues.length > 0) {
      return (ctx) => {
        const values = column.enumValues as string[];
        return ctx.faker.helpers.arrayElement(values);
      };
    }
    return null; // No special config, fall through to data type generator
  },

  PgVarchar: (column) => {
    const hasEnum = column.enumValues && column.enumValues.length > 0;
    const hasLength = column.length !== undefined;

    if (hasEnum) {
      return (ctx) => {
        const values = column.enumValues as string[];
        return ctx.faker.helpers.arrayElement(values);
      };
    }

    if (hasLength) {
      return (ctx) => {
        // Generate string respecting max length
        const str = ctx.faker.string.alpha({ length: { min: 1, max: column.length } });
        return str.slice(0, column.length);
      };
    }

    return null;
  },

  PgChar: (column) => {
    const hasEnum = column.enumValues && column.enumValues.length > 0;
    const hasLength = column.length !== undefined;

    if (hasEnum) {
      return (ctx) => {
        const values = column.enumValues as string[];
        // Pad to fixed length if needed
        const value = ctx.faker.helpers.arrayElement(values);
        return hasLength ? value.padEnd(column.length, ' ') : value;
      };
    }

    if (hasLength) {
      return (ctx) => {
        const str = ctx.faker.string.alpha({ length: column.length });
        return str.slice(0, column.length);
      };
    }

    return null;
  },

  // Numeric types with precision/scale
  PgNumeric: (column) => {
    const hasPrecision = column.precision !== undefined;
    const hasScale = column.scale !== undefined;

    if (hasPrecision || hasScale) {
      return (ctx) => {
        const precision = column.precision ?? 10;
        const scale = column.scale ?? 0;

        // Calculate max value: 10^(precision - scale) - 1
        const maxIntegerDigits = precision - scale;
        const maxValue = Math.pow(10, maxIntegerDigits) - 1;

        // Generate random number within range
        const value = ctx.faker.number.float({
          min: 0,
          max: maxValue,
          fractionDigits: scale,
        });

        // Handle mode: 'string' | 'number' | 'bigint'
        if (column.mode === 'string') return value.toString();
        if (column.mode === 'bigint') return BigInt(Math.floor(value));
        return value;
      };
    }

    return null;
  },

  // Timestamp with precision
  PgTimestamp: (column) => {
    if (column.precision !== undefined) {
      return (ctx) => {
        const date = ctx.faker.date.past();

        // Truncate milliseconds based on precision (0-6)
        const ms = date.getMilliseconds();
        const precision = column.precision;
        const truncatedMs = Math.floor(ms / Math.pow(10, 3 - precision)) * Math.pow(10, 3 - precision);
        date.setMilliseconds(truncatedMs);

        // Handle mode: 'date' | 'string'
        return column.mode === 'string' ? date.toISOString() : date;
      };
    }
    return null;
  },

  // Vector with dimensions
  PgVector: (column) => {
    if (column.length !== undefined) { // length = dimensions
      return (ctx) => {
        return Array.from({ length: column.length }, () =>
          ctx.faker.number.float({ min: -1, max: 1, fractionDigits: 4 })
        );
      };
    }
    return null;
  },

  // Interval with fields
  PgInterval: (column) => {
    if (column.fields) {
      return (ctx) => {
        // Generate interval string based on fields
        // e.g., 'year to month', 'day to second', etc.
        const fields = column.fields;

        // Simplified example - would need full implementation
        if (fields.includes('year')) {
          return `${ctx.faker.number.int({ min: 0, max: 10 })} years`;
        }
        // ... handle other field types

        return '1 day'; // fallback
      };
    }
    return null;
  },

  // Add more column types as needed:
  // PgInteger, PgBigInt, PgBoolean, PgDate, PgTime, PgJson, PgUUID, etc.
  // Most won't need special handling and will return null
};
```

### 3. Generator Resolution Logic

Update the generator resolution in `src/pg-core/seed.ts`:

```typescript
// Current (simplified):
const generator = refined || defaultDataTypeGenerators[columnConfig.dataType];

// New (with priority):
function resolveGenerator(
  column: any,
  userRefinedGenerator: ColumnGenerator<any> | undefined,
): ColumnGenerator<any> {
  // Priority 1: User-defined custom generator
  if (userRefinedGenerator) {
    return userRefinedGenerator;
  }

  // Priority 2: Column config generator
  const columnType = column.columnType; // e.g., 'PgText', 'PgVarchar'
  const configGeneratorFactory = columnConfigGenerators[columnType];

  if (configGeneratorFactory) {
    const configGenerator = configGeneratorFactory(column);
    if (configGenerator) {
      return configGenerator;
    }
  }

  // Priority 3: Data type generator (fallback)
  const dataType = column.dataType as ColumnType;
  const dataTypeGenerator = defaultDataTypeGenerators[dataType];

  if (dataTypeGenerator) {
    return dataTypeGenerator;
  }

  // Ultimate fallback: return null or some default value
  return () => null;
}
```

### 4. Integration Points

**File: `src/pg-core/seed.ts`**

Update the `generateWithConfig` function around lines 130-137:

```typescript
// OLD:
const refined =
  tableConfigUser?.columns?.[
    columnTsKey as keyof typeof tableConfigUser.columns
  ];

const generator: ColumnGenerator<ColumnType> = refined
  ? (refined as any)
  : defaultDataTypeGenerators[columnConfig.dataType as ColumnType];

// NEW:
const refined =
  tableConfigUser?.columns?.[
    columnTsKey as keyof typeof tableConfigUser.columns
  ];

const generator = resolveGenerator(
  columnConfig, // Full column object with metadata
  refined as ColumnGenerator<any> | undefined,
);
```

### 5. Benefits of This Architecture

1. **Separation of Concerns**
   - Data type generators: Simple, generic fallbacks
   - Column config generators: Smart, metadata-aware generation
   - Custom generators: Full user control

2. **Extensibility**
   - Easy to add new column config generators
   - Each column type can have its own logic
   - No need to modify existing data type generators

3. **Type Safety**
   - Maintains full TypeScript inference
   - Column metadata is typed based on Drizzle's types
   - Generator return types match column types

4. **Backwards Compatible**
   - Existing code continues to work
   - Users can opt-in to smarter generation
   - Fallback to data type generators always available

5. **Performance**
   - Generator resolution happens once per column per row
   - No runtime overhead when using simple data type generators
   - Closure-based approach allows caching

---

## Implementation Steps

### Phase 1: Core Infrastructure
1. ✅ **Architecture Design** (this document)
2. Add type definitions for `ColumnConfigGeneratorFactory` and `ColumnConfigGeneratorsMap`
3. Create `src/pg-core/column-config-generators.ts` file
4. Implement `resolveGenerator()` function

### Phase 2: Column Config Generators
5. Implement generators for text types (PgText, PgVarchar, PgChar) with enum support
6. Implement generators for numeric types (PgNumeric) with precision/scale
7. Implement generators for temporal types (PgTimestamp, PgTime, PgInterval) with precision
8. Implement generators for specialized types (PgVector, PgEnum)
9. Add support for array dimensions across all types

### Phase 3: Integration
10. Update `generateWithConfig()` in `seed.ts` to use `resolveGenerator()`
11. Export new types and utilities from index files
12. Update main exports in `src/index.ts` and `src/pg-core/index.ts`

### Phase 4: Testing & Documentation
13. Write unit tests for each column config generator
14. Write integration tests for generator resolution
15. Update README with examples of automatic enum generation
16. Add migration guide for users

---

## Example Usage

### Before (Current Behavior)
```typescript
const schema = {
  users: pgTable('users', {
    id: serial('id').primaryKey(),
    role: text('role', { enum: ['admin', 'user', 'guest'] }),
    score: numeric('score', { precision: 5, scale: 2 }),
  }),
};

const data = await generate(schema, { tableOrder: ['users'], seed: 1 });
// data.users[0].role = "string_0" ❌ (doesn't respect enum)
// data.users[0].score = 123 ❌ (doesn't respect precision/scale)
```

### After (New Behavior)
```typescript
const schema = {
  users: pgTable('users', {
    id: serial('id').primaryKey(),
    role: text('role', { enum: ['admin', 'user', 'guest'] }),
    score: numeric('score', { precision: 5, scale: 2 }),
  }),
};

const data = await generate(schema, { tableOrder: ['users'], seed: 1 });
// data.users[0].role = "admin" ✅ (automatically picks from enum)
// data.users[0].score = "123.45" ✅ (respects precision/scale)
```

### Custom Override Still Works
```typescript
const data = await generate(schema, { tableOrder: ['users'], seed: 1 })
  .refine({
    users: {
      columns: {
        // Custom generator takes highest priority
        role: (ctx) => 'superadmin', // ✅ Always uses custom
      },
    },
  });
// data.users[0].role = "superadmin" ✅
```

---

## Open Questions & Considerations

### 1. Column Type Naming
- **Question:** Should we use `column.columnType` (e.g., `'PgText'`) or another identifier?
- **Answer:** Use `columnType` - it's consistent and available at runtime

### 2. Array Handling
- **Question:** How to handle arrays with column config generators?
- **Answer:** Column config generator should return base value; array wrapping is handled by existing logic in `mapFromDriverValue`

### 3. Serial/Auto-increment Columns
- **Question:** Should we skip generation for serial columns since they're auto-generated?
- **Answer:** Current behavior generates values; we can add a special case to skip if `isAutoincrement` is true

### 4. Nullable Columns
- **Question:** Should column config generators respect `notNull` and sometimes return null?
- **Answer:** By default, generate non-null values. Let users use custom generators if they want nulls

### 5. Foreign Key Relationships
- **Question:** Should column config generators be aware of foreign key references?
- **Answer:** Not in Phase 1. This is more complex and can be a future enhancement

### 6. Performance Impact
- **Question:** Will this add overhead to generation?
- **Answer:** Minimal - generator resolution happens once per column per row, same as before

### 7. Drizzle ORM Version Compatibility
- **Question:** How to handle different versions of Drizzle ORM?
- **Answer:** Document minimum required version; gracefully handle missing properties

---

## Testing Strategy

### Unit Tests
- Test each column config generator factory in isolation
- Verify correct generator returned for each configuration
- Verify `null` returned when config doesn't apply

### Integration Tests
- Test generator resolution priority (custom > config > datatype)
- Test end-to-end data generation with various column types
- Test .refine() override still works

### Edge Cases
- Missing/undefined column properties
- Invalid configuration values
- Custom types and arrays
- Nested objects and JSON

---

## Migration Notes

### For Existing Users
- **No breaking changes** - existing code works as-is
- Opt-in feature - automatically benefits from smarter generation
- Can disable by providing custom generators

### For Contributors
- New pattern for adding column type support
- Column config generators are separate from data type generators
- Follow priority system when debugging generation issues

---

## Future Enhancements

### Phase 2 Features (Future)
1. **Relationship-aware Generation**
   - Respect foreign key constraints
   - Generate valid references automatically

2. **Constraint-aware Generation**
   - Check constraints (e.g., `age > 18`)
   - Unique constraints (no duplicates)

3. **Smart Context-aware Generation**
   - Email column named `email` → generate email format
   - Column named `phone` → generate phone format
   - Column named `url` → generate URL format

4. **Configuration Options**
   - `respectConstraints: boolean` - honor/ignore constraints
   - `nullProbability: number` - chance of null for nullable columns
   - `uniqueAttempts: number` - retries for unique constraint violations

5. **Multi-database Support**
   - MySQL column config generators
   - SQLite column config generators
   - (postgres already implemented)

---

## Summary

This three-layer generator hierarchy provides:
- ✅ **Smarter default generation** (respects column config)
- ✅ **Full backward compatibility** (existing code works)
- ✅ **User control** (custom generators always win)
- ✅ **Extensible architecture** (easy to add new types)
- ✅ **Type-safe** (full TypeScript inference)
- ✅ **Clean separation** (config generators separate from data type generators)

The implementation is straightforward and can be done incrementally, starting with the most commonly used column types (text with enum, numeric with precision) and expanding from there.
