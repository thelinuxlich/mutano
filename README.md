# mutano

Converts Prisma/MySQL/PostgreSQL/SQLite schemas to Zod interfaces

## Installation

Install `mutano` with npm

```bash
npm install mutano --save-dev
```

## Usage/Examples

Create user table:

```sql
CREATE TABLE `user` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '@zod(z.string().min(10).max(255))', -- this will override the type
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `profile_picture` varchar(255) DEFAULT NULL,
  `role` enum('admin','user') NOT NULL,
  PRIMARY KEY (`id`)
);
```
Use the mutano API:

### MySQL Example

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
})
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
})
```

The generator will create a `user.ts` file with the following contents:

```typescript
import z from 'zod'

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
  "tables": ["user", "log"],
  "ignore": ["log", "/^temp/"],
  "folder": "@zod",
  "suffix": "table",
  "camelCase": false,
  "nullish": false,
  "requiredString": false,
  "useTrim": false,
  "useDateType": false,
  "silent": false,
  "zodCommentTypes": true,
  "overrideTypes": {
    "tinyint": "z.boolean()"
  }
}
```

| Option | Description |
| ------ | ----------- |
| tables | Filter the tables to include only those specified. |
| ignore | Filter the tables to exclude those specified. If a table name begins and ends with "/", it will be processed as a regular expression. |
| folder | Specify the output directory. |
| suffix | Suffix to the name of a generated file. (eg: `user.table.ts`) |
| camelCase | Convert all table names and their properties to camelcase. (eg: `profile_picture` becomes `profilePicture`) |
| nullish | Set schema as `nullish` instead of `nullable` |
| requiredString | Add `min(1)` for string schema |
| useDateType | Use a specialized Zod type for date-like fields instead of string
| useTrim | Use `z.string().trim()` instead of `z.string()` |
| silent | Don't log anything to the console |
| magicComments | Use @zod comment to override entire type (unsupported by SQLite) |

## overrideTypes

You can override the default Zod type for a specific column type. This is specific to each database type and is placed inside the origin object. Each database type has its own set of valid types that can be overridden:

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