# Mutano

Converts Prisma/MySQL/PostgreSQL/SQLite schemas to Zod schemas, TypeScript interfaces, or Kysely type definitions

## Features

- Generates Zod schemas, Typescript interfaces or Kysely type definitions for MySQL, PostgreSQL, SQLite, and Prisma schemas
- Supports camelCase conversion
- Handles nullable, default, auto-increment and enum fields
- Supports custom type overrides via configuration or database comments
- Intelligently handles field nullability based on operation type (table, insertable, updateable, selectable)

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
  `metadata` json NOT NULL COMMENT '@ts(Record<string, unknown>)', -- this will override the TypeScript type
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
    nullish: false,
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
  dryRun: true // Return content instead of writing to files
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

The generator will create `user.type.ts`, `user.schema.ts`, and `user.db.ts` files with the following contents:

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
  name: z.string().min(10).max(255),
  username: z.string(),
  password: z.string(),
  profile_picture: z.string().nullable(),
  role: z.enum(['admin', 'user']),
})

export const selectable_user = z.object({
  id: z.number().nonnegative(),
  name: z.string().min(10).max(255),
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

### TypeScript Interface Output Example (Enum Type for Enums)

```typescript
// TypeScript interfaces for user

// Enum declarations
enum RoleEnum {
  admin = 'admin',
  user = 'user'
}

export interface User {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  role: RoleEnum;
}

export interface InsertableUser {
  name: string | null; // Optional because it has a default value
  username: string;
  password: string;
  profile_picture: string | null;
  role: RoleEnum;
}

export interface UpdateableUser {
  name: string | null; // Optional for updates
  username: string | null; // Optional for updates
  password: string | null; // Optional for updates
  profile_picture: string | null;
  role: RoleEnum | null; // Optional for updates
}

export interface SelectableUser {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  role: RoleEnum;
}
```

### TypeScript Type Alias Output Example

```typescript
// TypeScript types for user

export type User = {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
  role: 'admin' | 'user';
}

export type InsertableUser = {
  name: string | null; // Optional because it has a default value
  username: string;
  password: string;
  profile_picture: string | null;
  role: 'admin' | 'user';
}

export type UpdateableUser = {
  name: string | null; // Optional for updates
  username: string | null; // Optional for updates
  password: string | null; // Optional for updates
  profile_picture: string | null;
  role: 'admin' | 'user' | null; // Optional for updates
}

export type SelectableUser = {
  id: number;
  name: string;
  username: string;
  password: string;
  profile_picture: string | null;
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
  metadata: Json;
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

### Kysely Type Definitions Output Example with Custom Schema Name

```typescript
import { Generated, ColumnType, Selectable, Insertable, Updateable } from 'kysely';
import { CustomTypes } from './types';

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
  metadata: Json;
  role: 'admin' | 'user';
}

// Define the database interface
export interface Database {
  user: UserTable;
}

// Use these types for inserting, selecting and updating the table
export type User = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;
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
      "nullish": false,
      "requiredString": false,
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
      "folder": "kysely",
      "suffix": "db"
    }
  ],
  "tables": ["user", "log"],
  "ignore": ["log", "/^temp/"],
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
| destinations[].nullish | (Zod only) Set schema as `nullish` instead of `nullable` |
| destinations[].requiredString | (Zod only) Add `min(1)` for string schema |
| destinations[].enumType | (TypeScript only) How to represent enum types: "union" (default) or "enum" |
| destinations[].modelType | (TypeScript only) How to represent models: "interface" (default) or "type" |
| destinations[].schemaName | (Kysely only) Name of the database interface (default: "DB") |
| destinations[].header | Custom header to include at the beginning of generated files (e.g., custom imports) |
| destinations[].folder | Specify the output directory for the generated files |
| destinations[].suffix | Suffix to the name of a generated file (eg: `user.table.ts`) |
| tables | Filter the tables to include only those specified |
| ignore | Filter the tables to exclude those specified. If a table name begins and ends with "/", it will be processed as a regular expression |
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

You can use complex TypeScript types in the `@ts` comment:

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