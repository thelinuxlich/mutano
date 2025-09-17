# Mutano

Convert database schemas to TypeScript types, Zod schemas, or Kysely definitions.

- **Supports:** MySQL, PostgreSQL, SQLite, Prisma 
- **Features:** Views, Magic Comments, Type Overrides, Multiple Outputs

## Installation

```bash
npm install mutano
```

## Quick Start

```typescript
import { generate } from 'mutano'

// Basic usage
await generate({
  origin: {
    type: 'mysql', // or 'postgres', 'sqlite', 'prisma'
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp'
  },
  destinations: [{
    type: 'zod', // or 'ts', 'kysely'
    folder: './generated'
  }]
})

// Multiple outputs
await generate({
  origin: { /* ... */ },
  destinations: [
    { type: 'zod', folder: './zod' },
    { type: 'ts', folder: './types' },
    { type: 'kysely', outFile: './db.ts' }
  ]
})

// With views support
await generate({
  origin: { /* ... */ },
  destinations: [{ type: 'zod' }],
  includeViews: true,
  views: ['user_profile_view'], // optional filter
  ignoreViews: ['temp_view'] // optional exclude
})
```

## Output Examples

**Zod Schema:**
```typescript
export const user = z.object({
  id: z.number().nonnegative(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
})

export const insertable_user = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
})

export type UserType = z.infer<typeof user>
```

**TypeScript Interface:**
```typescript
export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface InsertableUser {
  name: string;
  email: string;
  role: 'admin' | 'user';
}
```

**Kysely Types:**
```typescript
export interface User {
  id: Generated<number>;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export type SelectableUser = Selectable<User>;
export type InsertableUser = Insertable<User>;
export type UpdateableUser = Updateable<User>;
```

## Configuration

### Origin Options
```typescript
// MySQL/PostgreSQL
{
  type: 'mysql' | 'postgres',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
  schema?: string, // PostgreSQL only
  ssl?: { ca, cert, key },
  overrideTypes?: Record<string, string>
}

// SQLite
{
  type: 'sqlite',
  path: string,
  overrideTypes?: Record<string, string>
}

// Prisma
{
  type: 'prisma',
  path: string,
  overrideTypes?: Record<string, string>
}
```

### Destination Options
```typescript
{
  type: 'zod' | 'ts' | 'kysely',
  folder?: string,
  suffix?: string,
  outFile?: string, // Kysely only
  header?: string, // Custom imports

  // Zod specific
  useDateType?: boolean,
  useBooleanType?: boolean,
  useTrim?: boolean,
  nullish?: boolean,
  requiredString?: boolean,
  version?: 3 | 4,

  // TypeScript specific
  enumType?: 'union' | 'enum',
  modelType?: 'interface' | 'type',

  // Kysely specific
  schemaName?: string // Default: 'DB'
}
```

### Zod Configuration Options

- **`useDateType`**: When `true`, generates `z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())` instead of `z.date()` for date fields
- **`useBooleanType`**: When `true`, generates `z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())` instead of `z.boolean()` for boolean fields
- **`useTrim`**: When `true`, adds `.trim()` to string fields
- **`nullish`**: When `true`, uses `.nullish()` instead of `.nullable()` for nullable fields (except selectable schemas)
- **`requiredString`**: When `true`, adds `.min(1)` validation to required string fields
- **`version`**: Zod version (3 or 4) for compatibility

### Global Options
| Option | Description |
|--------|-------------|
| `tables` | Include only specified tables |
| `views` | Include only specified views |
| `ignore` | Exclude specified tables (supports regex) |
| `ignoreViews` | Exclude specified views (supports regex) |
| `includeViews` | Process database views |
| `camelCase` | Convert to camelCase |
| `dryRun` | Return content without writing files |
| `magicComments` | Enable @zod/@ts/@kysely comments (Obs.: no SQLite support) |

## Magic Comments

Override types for specific columns using database comments:

```sql
CREATE TABLE `user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COMMENT '@zod(z.string().min(2).max(50))',
  `email` varchar(255) COMMENT '@ts(EmailAddress) @kysely(string)',
  `metadata` json COMMENT '@ts(UserMetadata)',
  PRIMARY KEY (`id`)
);
```

**Supported Comments:**
- `@zod(...)` - Override Zod schema
- `@ts(...)` - Override TypeScript type
- `@kysely(...)` - Override Kysely type

## Type Overrides

Override default types globally in your origin config:

```typescript
{
  origin: {
    type: 'mysql',
    // ... connection config
    overrideTypes: {
      json: 'z.record(z.string())',
      text: 'z.string().max(1000)',
      decimal: 'z.number().positive()'
    }
  }
}
```

**Common Overrides:**
- **MySQL**: `json`, `text`, `decimal`, `enum`
- **PostgreSQL**: `jsonb`, `uuid`, `text`, `numeric`
- **SQLite**: `json`, `text`, `real`
- **Prisma**: `Json`, `String`, `Decimal`