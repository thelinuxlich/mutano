/**
 * Core types and interfaces for Mutano
 */
interface Desc {
    Field: string;
    Default: string | null;
    Extra: string;
    Null: string;
    Type: string;
    Comment: string;
    EnumOptions?: string[];
}
type Destination = {
    type: 'zod';
    useDateType?: boolean;
    useTrim?: boolean;
    nullish?: boolean;
    requiredString?: boolean;
    version?: 3 | 4;
    header?: string;
    folder?: string;
    suffix?: string;
} | {
    type: 'ts';
    enumType?: 'union' | 'enum';
    modelType?: 'interface' | 'type';
    header?: string;
    folder?: string;
    suffix?: string;
} | {
    type: 'kysely';
    schemaName?: string;
    header?: string;
    folder?: string;
    suffix?: string;
    outFile?: string;
};
interface Config {
    origin: {
        type: 'prisma';
        path: string;
        overrideTypes?: {
            [k in PrismaValidTypes]?: string;
        };
    } | {
        type: 'mysql';
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
        overrideTypes?: {
            [k in MySQLValidTypes]?: string;
        };
        ssl?: Record<string, any>;
    } | {
        type: 'postgres';
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
        schema?: string;
        overrideTypes?: {
            [k in PostgresValidTypes]?: string;
        };
        ssl?: Record<string, any>;
    } | {
        type: 'sqlite';
        path: string;
        overrideTypes?: {
            [k in SQLiteValidTypes]?: string;
        };
    };
    destinations: Destination[];
    tables?: string[];
    views?: string[];
    ignore?: string[];
    ignoreViews?: string[];
    camelCase?: boolean;
    silent?: boolean;
    dryRun?: boolean;
    magicComments?: boolean;
    includeViews?: boolean;
    enumDeclarations?: Record<string, string[]>;
}
interface GenerateContentParams {
    table: string;
    describes: Desc[];
    config: Config;
    destination: Destination;
    isCamelCase: boolean;
    enumDeclarations: Record<string, string[]>;
    defaultZodHeader: (version: 3 | 4) => string;
}
interface GenerateViewContentParams {
    view: string;
    describes: Desc[];
    config: Config;
    destination: Destination;
    isCamelCase: boolean;
    enumDeclarations: Record<string, string[]>;
    defaultZodHeader: (version: 3 | 4) => string;
}
type MySQLValidTypes = 'tinyint' | 'smallint' | 'mediumint' | 'int' | 'bigint' | 'decimal' | 'float' | 'double' | 'bit' | 'char' | 'varchar' | 'binary' | 'varbinary' | 'tinyblob' | 'blob' | 'mediumblob' | 'longblob' | 'tinytext' | 'text' | 'mediumtext' | 'longtext' | 'enum' | 'set' | 'date' | 'time' | 'datetime' | 'timestamp' | 'year' | 'json';
type PostgresValidTypes = 'smallint' | 'integer' | 'bigint' | 'decimal' | 'numeric' | 'real' | 'double precision' | 'smallserial' | 'serial' | 'bigserial' | 'money' | 'character varying' | 'varchar' | 'character' | 'char' | 'text' | 'bytea' | 'timestamp' | 'timestamp with time zone' | 'timestamp without time zone' | 'date' | 'time' | 'time with time zone' | 'time without time zone' | 'interval' | 'boolean' | 'enum' | 'point' | 'line' | 'lseg' | 'box' | 'path' | 'polygon' | 'circle' | 'cidr' | 'inet' | 'macaddr' | 'bit' | 'bit varying' | 'uuid' | 'xml' | 'json' | 'jsonb' | 'int4range' | 'int8range' | 'numrange' | 'tsrange' | 'tstzrange' | 'daterange' | 'name' | 'citext';
type SQLiteValidTypes = 'integer' | 'real' | 'text' | 'blob' | 'numeric' | 'boolean' | 'date' | 'datetime' | 'character' | 'varchar' | 'varying character' | 'nchar' | 'native character' | 'nvarchar' | 'clob' | 'double' | 'double precision' | 'float' | 'int' | 'int2' | 'int8' | 'bigint' | 'unsigned big int' | 'mediumint' | 'tinyint' | 'smallint' | 'decimal' | 'json';
type PrismaValidTypes = 'String' | 'Boolean' | 'Int' | 'BigInt' | 'Float' | 'Decimal' | 'DateTime' | 'Json' | 'Bytes' | 'Unsupported';

/**
 * Constants and default headers for code generation
 */
declare const defaultKyselyHeader = "import { Insertable, Selectable, Updateable, ColumnType } from 'kysely';\n\n";
declare const defaultZodHeader: (version: 3 | 4) => string;

/**
 * Utilities for parsing magic comments (@zod, @ts, @kysely)
 */
/**
 * Extract type expression from a comment with a given prefix
 * Handles nested parentheses, brackets, and braces
 */
declare const extractTypeExpression: (comment: string, prefix: string) => string | null;
/**
 * Extract TypeScript type expression from @ts() comment
 */
declare const extractTSExpression: (comment: string) => string | null;
/**
 * Extract Kysely type expression from @kysely() comment
 */
declare const extractKyselyExpression: (comment: string) => string | null;
/**
 * Extract Zod type expression from @zod() comment
 */
declare const extractZodExpression: (comment: string) => string | null;

/**
 * Content generation for tables and views
 */

/**
 * Generate content for database views (read-only)
 */
declare function generateViewContent({ view, describes, config, destination, isCamelCase, enumDeclarations: _enumDeclarations, defaultZodHeader, }: GenerateViewContentParams): string;
/**
 * Generate content for database tables
 */
declare function generateContent({ table, describes, config, destination, isCamelCase, enumDeclarations: _enumDeclarations, defaultZodHeader, }: GenerateContentParams): string;

/**
 * Core type generation logic
 */

type OperationType = 'table' | 'insertable' | 'updateable' | 'selectable';
/**
 * Generate the appropriate type for a database field
 */
declare function getType(op: OperationType, desc: Desc, config: Config, destination: Destination): string;

/**
 * Mutano - Database schema to TypeScript/Zod/Kysely converter
 * Refactored for better maintainability and modularity
 */

/**
 * Main generate function - orchestrates the entire schema generation process
 */
declare function generate(config: Config): Promise<Record<string, string>>;

export { defaultKyselyHeader, defaultZodHeader, extractKyselyExpression, extractTSExpression, extractTypeExpression, extractZodExpression, generate, generateContent, generateViewContent, getType };
export type { Config, Desc, Destination };
