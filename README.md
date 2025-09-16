# Mutano

Converts Prisma/MySQL/PostgreSQL/SQLite schemas to Zod schemas, TypeScript interfaces, or Kysely type definitions

## Features

- Generates Zod schemas, Typescript interfaces or Kysely type definitions for MySQL, PostgreSQL, SQLite, and Prisma schemas
- **NEW: Database Views Support** - Extract and generate types for database views (read-only)
- Supports camelCase conversion
- Handles nullable, default, auto-increment and enum fields
- Supports custom type overrides via configuration or database comments
- Intelligently handles field nullability based on operation type (table, insertable, updateable, selectable)
- All fields in updateable schemas are automatically made optional
- Views are treated as read-only entities (no insertable/updateable schemas generated)

## Installation

Install `mutano` with npm

```bash
npm install mutano
```

## Usage/Examples

Create user table:

```sql
CREATE TABLE `user` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '@zod(z.string().min(10).max(255))', -- this will override the Zod type
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `profile_picture` varchar(255) DEFAULT NULL,
  `metadata` json NOT NULL COMMENT '@ts(Record<string, unknown>) @kysely(Record<string, string>)', -- this will override the TypeScript and Kysely type
  `role` enum('admin','user') NOT NULL,
  PRIMARY KEY (`id`)
);
```
Use the mutano API:

### MySQL Example with Zod Schemas

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'zod',
    useDateType: true,
    useTrim: false,
    nullish: false, // When true, nullable fields use nullish() instead of nullable()
    folder: './generated',
    suffix: 'schema'
  }]
})
```

### MySQL Example with TypeScript Type Aliases (Instead of Interfaces)

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'ts',
    modelType: 'type',  // Generate TypeScript type aliases instead of interfaces
    folder: './types',
    suffix: 'types'
  }]
})
```

### MySQL Example with Custom Header for TypeScript

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'ts',
    header: "import type { CustomType } from './types';\nimport type { BaseModel } from './models';"
  }]
})
```

### MySQL Example with Custom Header for Zod

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'zod',
    header: "import { z } from 'zod';\nimport { CustomValidator } from './validators';"
  }]
})
```

### MySQL Example with Kysely Type Definitions (Custom Schema Name)

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'kysely',
    schemaName: 'Database', // Default is 'DB'
    header: "import { Generated, ColumnType } from 'kysely';\nimport { CustomTypes } from './types';",
    folder: './db/types',
    suffix: 'db'
  }]
})
```

### Example with Dry Run Option

```typescript
import { generate } from 'mutano'

// Generate without writing to disk
const output = await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp'
  },
  destinations: [{
    type: 'zod'
  }],
  dryRun: true // Return content and don't write to files
})

// Output is an object where keys are filenames and values are file content
console.log(Object.keys(output)) // ['user.ts', 'product.ts', ...]

// You can access the content for a specific file
console.log(output['user.ts'])
```

### PostgreSQL Example

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'secret',
    database: 'myapp',
    schema: 'public', // optional, defaults to 'public'
    overrideTypes: {
      jsonb: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'zod',
    useDateType: true
  }]
})
```

### SQLite Example

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'sqlite',
    path: './myapp.db',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [{
    type: 'ts'
  }]
})
```

### Example with Multiple Destinations

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp',
    overrideTypes: {
      json: 'z.record(z.string())'
    }
  },
  destinations: [
    {
      type: 'zod',
      useDateType: true,
      folder: './generated/zod',
      suffix: 'schema'
    },
    {
      type: 'ts',
      folder: './generated/types',
      suffix: 'type'
    },
    {
      type: 'kysely',
      folder: './generated/kysely',
      suffix: 'db'
    }
  ]
})
```

This will generate all three types of output files for each table in your database, placing them in separate folders with appropriate suffixes.

### Database Views Example

```typescript
import { generate } from 'mutano'

await generate({
  origin: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'myapp'
  },
  destinations: [{
    type: 'zod',
    folder: './generated/schemas',
    suffix: 'schema'
  }],
  includeViews: true, // Enable views processing
  views: ['user_profile_view', 'order_summary_view'], // Optional: specify which views to include
  ignoreViews: ['temp_view'] // Optional: specify which views to ignore
})
```

**Database Views Features:**
- **Read-only**: Views generate only selectable schemas (no insertable/updateable)
- **All database types**: Supports MySQL, PostgreSQL, SQLite, and Prisma views
- **Filtering**: Use `views` and `ignoreViews` options to control which views are processed
- **Type safety**: Full TypeScript/Zod/Kysely type generation for view columns
- **Prisma integration**: Automatically detects `view` blocks in Prisma schema files

### Prisma Views Integration

Mutano automatically detects and processes `view` blocks in your Prisma schema:

```prisma
// schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["views"]
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  name    String?
  profile Profile?
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  user   User   @relation(fields: [userId], references: [id])
  userId Int    @unique
}

// This view will be automatically processed by Mutano
view UserInfo {
  id    Int
  email String
  name  String?
  bio   String?
}
```

```typescript
// Generate types from Prisma schema with views
await generate({
  origin: {
    type: 'prisma',
    path: './schema.prisma'
  },
  destinations: [{
    type: 'zod',
    useDateType: true
  }],
  includeViews: true
})
```

The generator will create `user.type.ts`, `user.schema.ts`, and `user.db.ts` files with the following contents:

### Database View Output Examples

For a database view like:
```sql
CREATE VIEW user_profile_view AS
SELECT
  u.id,
  u.name,
  u.email,
  p.bio,
  p.avatar_url
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id;
```

### Zod Schema Output Example with Custom Header

```typescript
import { z } from 'zod';
import { CustomValidator } from './validators';

export const user = z.object({
  id: z.number().nonnegative(),
  name: z.string().min(10).max(255),
  username: z.string(),
  password: z.string(),
  profile_picture: z.string().nullable(),
  role: z.enum(['admin', 'user']),
})

export const insertable_user = z.object({
  name: z.string().min(10).max(255),
  username: z.string(),
  password: z.string(),
  profile_picture: z.string().nullable(),
  role: z.enum(['admin', 'user']),
})

export const updateable_user = z.object({
  name: z.string().min(10).max(255).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  profile_picture: z.string().nullable().optional(),
  role: z.enum(['admin', 'user']).optional(),
})

export const selectable_user = z.object({
  id: z.number().nonnegative(),
  name: z.string(),
  username: z.string(),
  password: z.string(),
  profile_picture: z.string().nullable(),
  role: z.enum(['admin', 'user']),
})

export type userType = z.infer<typeof user>
export type InsertableUserType = z.infer<typeof insertable_user>
export type UpdateableUserType = z.infer<typeof updateable_user>
export type SelectableUserType = z.infer<typeof selectable_user>
```

### TypeScript Interface Output Example with Custom Header

```typescript
import { CustomType } from './types';
import { BaseModel } from './models';

// TypeScript interfaces for user

export interface User {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  metadata: Record<string, unknown>; // Custom type from @ts comment
  role: 'admin' | 'user';
}

export interface InsertableUser {
  name: string | null; // Optional because it has a default value
  username: string;
  password: string;
  profile_picture: string | null;
  metadata: Record<string, unknown>; // Custom type from @ts comment
  role: 'admin' | 'user';
}

export interface UpdateableUser {
  name: string | null; // Optional for updates
  username: string | null; // Optional for updates
  password: string | null; // Optional for updates
  profile_picture: string | null;
  metadata: Record<string, unknown> | null; // Custom type from @ts comment, optional for updates
  role: 'admin' | 'user' | null; // Optional for updates
}

export interface SelectableUser {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  metadata: Record<string, unknown>; // Custom type from @ts comment
  role: 'admin' | 'user';
}
```

### Kysely Type Definitions Output Example

```typescript
import { Generated, ColumnType, Selectable, Insertable, Updateable } from 'kysely';

// JSON type definitions
export type Json = ColumnType<JsonValue, string, string>;

export type JsonArray = JsonValue[];

export type JsonObject = {
  [x: string]: JsonValue | undefined;
};

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

// Kysely type definitions for user

// This interface defines the structure of the 'user' table
export interface UserTable {
  id: Generated<number>;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  metadata: Record<string, unknown>; // Custom type from @kysely comment
  role: 'admin' | 'user';
}

// Define the database interface
export interface DB {
  user: UserTable;
}

// Use these types for inserting, selecting and updating the table
export type User = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;
```

### View Output Examples

#### Zod Schema for Views (Read-only)

```typescript
import { z } from 'zod';

// View schema (read-only)
export const user_profile_view = z.object({
  id: z.number().nonnegative(),
  name: z.string(),
  email: z.string(),
  bio: z.string().nullable(),
  avatar_url: z.string().nullable(),
})

export type UserProfileViewType = z.infer<typeof user_profile_view>
```

#### TypeScript Interface for Views (Read-only)

```typescript
// TypeScript interface for user_profile_view (view - read-only)
export interface UserProfileView {
  id: number;
  name: string;
  email: string;
  bio: string | null;
  avatar_url: string | null;
}
```

#### Kysely Type Definitions for Views (Read-only)

```typescript
// Kysely type definitions for user_profile_view (view)

// This interface defines the structure of the 'user_profile_view' view (read-only)
export interface UserProfileView {
  id: number;
  name: string;
  email: string;
  bio: string | null;
  avatar_url: string | null;
}

// Helper types for user_profile_view (view - read-only)
export type SelectableUserProfileView = Selectable<UserProfileView>;
```

## Config

```json
{
  "origin": {
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "secret",
    "database": "myapp",
    "overrideTypes": {
      "json": "z.record(z.string())"
    },
    "ssl": {
      "ca": "path/to/ca.pem",
      "cert": "path/to/cert.pem",
      "key": "path/to/key.pem"
    },
  } | {
    "type": "postgres",
    "host": "127.0.0.1",
    "port": 5432,
    "user": "postgres",
    "password": "secret",
    "database": "myapp",
    "schema": "public",
    "overrideTypes": {
      "jsonb": "z.record(z.string())"
    },
    "ssl": {
      "ca": "path/to/ca.pem",
      "cert": "path/to/cert.pem",
      "key": "path/to/key.pem"
    },
  } | {
    "type": "sqlite",
    "path": "path/to/database.db",
    "overrideTypes": {
      "json": "z.record(z.string())"
    }
  } | {
    "type": "prisma",
    "path": "path/to/schema.prisma",
    "overrideTypes": {
      "Json": "z.record(z.string())"
    }
  },
  "destinations": [
    {
      "type": "zod",
      "useDateType": true,
      "useTrim": false,
      "nullish": false, // When true, nullable fields use nullish() instead of nullable()
      "requiredString": false, // When true, adds min(1) validation to non-nullable string fields
      "header": "import { z } from 'zod';\nimport { CustomValidator } from './validators';",
      "folder": "@zod",
      "suffix": "table"
    },
    {
      "type": "ts",
      "enumType": "union",
      "modelType": "interface",
      "header": "import { CustomType } from './types';\nimport { BaseModel } from './models';",
      "folder": "types",
      "suffix": "type"
    },
    {
      "type": "kysely",
      "schemaName": "Database",
      "header": "import { Generated, ColumnType } from 'kysely';\nimport { CustomTypes } from './types';",
      "outFile": "db.ts"
    }
  ],
  "tables": ["user", "log"],
  "views": ["user_profile_view", "order_summary"],
  "ignore": ["log", "/^temp/"],
  "ignoreViews": ["temp_view", "/^debug_/"],
  "includeViews": true,
  "camelCase": false,
  "silent": false,
  "dryRun": false,
  "magicComments": true
}
```

| Option | Description |
| ------ | ----------- |
| destinations | An array of destination configurations to generate multiple output formats from a single origin |
| destinations[].type | The type of output to generate: "zod", "ts", or "kysely" |
| destinations[].useDateType | (Zod only) Use a specialized Zod type for date-like fields instead of string |
| destinations[].useTrim | (Zod only) Use `z.string().trim()` instead of `z.string()` |
| destinations[].nullish | (Zod only) Use `nullish()` instead of `nullable()` for nullable fields. In updateable schemas, fields that were already nullable will become nullish |
| destinations[].version | (Zod only) Zod version to use. Defaults to 3. Set to 4 to use Zod v4 |
| destinations[].requiredString | (Zod only) Add `min(1)` for non-nullable string fields |
| destinations[].enumType | (TypeScript only) How to represent enum types: "union" (default) or "enum" |
| destinations[].modelType | (TypeScript only) How to represent models: "interface" (default) or "type" |
| destinations[].schemaName | (Kysely only) Name of the database interface (default: "DB") |
| destinations[].header | Custom header to include at the beginning of generated files (e.g., custom imports) |
| destinations[].folder | Specify the output directory for the generated files |
| destinations[].suffix | Suffix to the name of a generated file (eg: `user.table.ts`) |
| destinations[].outFile | (Kysely only) Specify the output file for the generated content. All tables will be written to this file |
| tables | Filter the tables to include only those specified |
| views | Filter the views to include only those specified (requires `includeViews: true`) |
| ignore | Filter the tables to exclude those specified. If a table name begins and ends with "/", it will be processed as a regular expression |
| ignoreViews | Filter the views to exclude those specified. If a view name begins and ends with "/", it will be processed as a regular expression |
| includeViews | When true, database views will be processed and included in the output. Views are read-only (no insertable/updateable schemas) |
| camelCase | Convert all table names and their properties to camelcase. (eg: `profile_picture` becomes `profilePicture`) |
| silent | Don't log anything to the console |
| dryRun | When true, doesn't write files to disk but returns an object with filenames as keys and generated content as values |
| magicComments | Use @zod and @ts comments to override types (unsupported by SQLite) |

## overrideTypes

You can override the default type for a specific column type. This is specific to each database type and is placed inside the origin object. Each database type has its own set of valid types that can be overridden:

### MySQL overrideTypes

```json
{
  "origin": {
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "secret",
    "database": "myapp",
    "overrideTypes": {
      "json": "z.record(z.string())",
      "text": "z.string().max(1000)"
    }
  }
}
```

### PostgreSQL overrideTypes

```json
{
  "origin": {
    "type": "postgres",
    "host": "127.0.0.1",
    "port": 5432,
    "user": "postgres",
    "password": "secret",
    "database": "myapp",
    "schema": "public",
    "overrideTypes": {
      "jsonb": "z.record(z.string())",
      "uuid": "z.string().uuid()"
    }
  }
}
```

### SQLite overrideTypes

```json
{
  "origin": {
    "type": "sqlite",
    "path": "./myapp.db",
    "overrideTypes": {
      "json": "z.record(z.string())",
      "text": "z.string().max(1000)"
    }
  }
}
```

### Prisma overrideTypes

```json
{
  "origin": {
    "type": "prisma",
    "path": "./schema.prisma",
    "overrideTypes": {
      "Json": "z.record(z.string())",
      "String": "z.string().min(1)"
    }
  }
}
```

## Magic Comments

### @zod Comments

You can use the `@zod` comment to override the Zod type for a specific column. This is useful when you want to add custom validation or transformation to a field.

```sql
CREATE TABLE `user` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '@zod(z.string().min(10).max(255))',
  `email` varchar(255) NOT NULL COMMENT '@zod(z.string().email())',
  PRIMARY KEY (`id`)
);
```

This will generate:

```typescript
export const user = z.object({
  id: z.number().nonnegative(),
  name: z.string().min(10).max(255),
  email: z.string().email(),
})
```

### @ts Comments

You can use the `@ts` comment to override the TypeScript type for a specific column. This is useful when you want to specify a more precise type for a field.

```sql
CREATE TABLE `user` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `metadata` json NOT NULL COMMENT '@ts(Record<string, unknown>)',
  `settings` json NOT NULL COMMENT '@ts(UserSettings)',
  PRIMARY KEY (`id`)
);
```

This will generate:

```typescript
export interface User {
  id: number;
  metadata: Record<string, unknown>;
  settings: UserSettings;
}
```

### @kysely Comments

You can use the `@kysely` comment to override the Kysely type for a specific column. This is useful when you want to specify a more precise type for a field.

```sql
CREATE TABLE `user` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `metadata` json NOT NULL COMMENT '@kysely(Record<string, string>)',
  PRIMARY KEY (`id`)
);
```

This will generate:

```typescript
export interface UserTable {
  id: Generated<number>;
  metadata: Record<string, string>;
}
```

## Complex TypeScript Types

You can use complex TypeScript types in the `@ts`(or `@kysely`) comment:

```sql
CREATE TABLE `product` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `variants` json NOT NULL COMMENT '@ts(Array<{ id: string; price: number; stock: number }>)',
  PRIMARY KEY (`id`)
);
```

This will generate:

```typescript
export interface Product {
  id: number;
  variants: Array<{ id: string; price: number; stock: number }>;
}
```