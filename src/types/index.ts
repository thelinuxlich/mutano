/**
 * Core types and interfaces for Mutano
 */

export interface Desc {
  Field: string
  Default: string | null
  Extra: string
  Null: string
  Type: string
  Comment: string
  EnumOptions?: string[]
}

export type Destination =
  | {
      type: 'zod'
      useDateType?: boolean
      useTrim?: boolean
      nullish?: boolean
      requiredString?: boolean
      version?: 3 | 4
      header?: string
      folder?: string
      suffix?: string
    }
  | {
      type: 'ts'
      enumType?: 'union' | 'enum'
      modelType?: 'interface' | 'type'
      header?: string
      folder?: string
      suffix?: string
    }
  | {
      type: 'kysely'
      schemaName?: string
      header?: string
      folder?: string
      suffix?: string
      outFile?: string
    }

export interface Config {
  origin:
    | {
        type: 'prisma'
        path: string
        overrideTypes?: { [k in PrismaValidTypes]?: string }
      }
    | {
        type: 'mysql'
        host: string
        port: number
        user: string
        password: string
        database: string
        overrideTypes?: { [k in MySQLValidTypes]?: string }
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        ssl?: Record<string, any>
      }
    | {
        type: 'postgres'
        host: string
        port: number
        user: string
        password: string
        database: string
        schema?: string
        overrideTypes?: { [k in PostgresValidTypes]?: string }
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        ssl?: Record<string, any>
      }
    | {
        type: 'sqlite'
        path: string
        overrideTypes?: { [k in SQLiteValidTypes]?: string }
      }
  destinations: Destination[]
  tables?: string[]
  views?: string[]
  ignore?: string[]
  ignoreViews?: string[]
  camelCase?: boolean
  silent?: boolean
  dryRun?: boolean
  magicComments?: boolean
  includeViews?: boolean
  enumDeclarations?: Record<string, string[]>
}

export interface GenerateContentParams {
  table: string
  describes: Desc[]
  config: Config
  destination: Destination
  isCamelCase: boolean
  enumDeclarations: Record<string, string[]>
  defaultZodHeader: (version: 3 | 4) => string
}

export interface GenerateViewContentParams {
  view: string
  describes: Desc[]
  config: Config
  destination: Destination
  isCamelCase: boolean
  enumDeclarations: Record<string, string[]>
  defaultZodHeader: (version: 3 | 4) => string
}

// Database-specific valid types
export type MySQLValidTypes =
  | 'tinyint'
  | 'smallint'
  | 'mediumint'
  | 'int'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'bit'
  | 'char'
  | 'varchar'
  | 'binary'
  | 'varbinary'
  | 'tinyblob'
  | 'blob'
  | 'mediumblob'
  | 'longblob'
  | 'tinytext'
  | 'text'
  | 'mediumtext'
  | 'longtext'
  | 'enum'
  | 'set'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamp'
  | 'year'
  | 'json'

export type PostgresValidTypes =
  | 'smallint'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'numeric'
  | 'real'
  | 'double precision'
  | 'smallserial'
  | 'serial'
  | 'bigserial'
  | 'money'
  | 'character varying'
  | 'varchar'
  | 'character'
  | 'char'
  | 'text'
  | 'bytea'
  | 'timestamp'
  | 'timestamp with time zone'
  | 'timestamp without time zone'
  | 'date'
  | 'time'
  | 'time with time zone'
  | 'time without time zone'
  | 'interval'
  | 'boolean'
  | 'enum'
  | 'point'
  | 'line'
  | 'lseg'
  | 'box'
  | 'path'
  | 'polygon'
  | 'circle'
  | 'cidr'
  | 'inet'
  | 'macaddr'
  | 'bit'
  | 'bit varying'
  | 'uuid'
  | 'xml'
  | 'json'
  | 'jsonb'
  | 'int4range'
  | 'int8range'
  | 'numrange'
  | 'tsrange'
  | 'tstzrange'
  | 'daterange'
  | 'name'
  | 'citext'

export type SQLiteValidTypes =
  | 'integer'
  | 'real'
  | 'text'
  | 'blob'
  | 'numeric'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'character'
  | 'varchar'
  | 'varying character'
  | 'nchar'
  | 'native character'
  | 'nvarchar'
  | 'clob'
  | 'double'
  | 'double precision'
  | 'float'
  | 'int'
  | 'int2'
  | 'int8'
  | 'bigint'
  | 'unsigned big int'
  | 'mediumint'
  | 'tinyint'
  | 'smallint'
  | 'decimal'
  | 'json'

export type PrismaValidTypes =
  | 'String'
  | 'Boolean'
  | 'Int'
  | 'BigInt'
  | 'Float'
  | 'Decimal'
  | 'DateTime'
  | 'Json'
  | 'Bytes'
  | 'Unsupported'
