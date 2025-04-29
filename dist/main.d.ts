export declare function getType(op: 'table' | 'insertable' | 'updateable' | 'selectable', desc: Desc, config: Config, destination: Destination, tableName?: string): string;
export interface GenerateContentParams {
    table: string;
    describes: Desc[];
    config: Config;
    destination: Destination;
    isCamelCase: boolean;
    enumDeclarations: Record<string, string[]>;
    defaultZodHeader: string;
    defaultKyselyHeader: string;
}
export declare function generateContent({ table, describes, config, destination, isCamelCase, enumDeclarations, defaultZodHeader, defaultKyselyHeader, }: GenerateContentParams): string;
export declare const defaultKyselyHeader = "import { Generated, ColumnType, Selectable, Insertable, Updateable } from 'kysely';\n\n";
export declare const defaultZodHeader = "import { z } from 'zod';\n\n";
export declare function generate(config: Config): Promise<string[] | Record<string, string>>;
type MySQLValidTypes = 'date' | 'datetime' | 'timestamp' | 'time' | 'year' | 'char' | 'varchar' | 'tinytext' | 'text' | 'mediumtext' | 'longtext' | 'json' | 'decimal' | 'tinyint' | 'smallint' | 'mediumint' | 'int' | 'bigint' | 'float' | 'double' | 'enum';
type PostgresValidTypes = 'date' | 'timestamp' | 'timestamptz' | 'timestamp without time zone' | 'timestamp with time zone' | 'time' | 'timetz' | 'interval' | 'character' | 'varchar' | 'character varying' | 'text' | 'json' | 'jsonb' | 'uuid' | 'name' | 'citext' | 'numeric' | 'decimal' | 'smallint' | 'integer' | 'bigint' | 'real' | 'double precision' | 'serial' | 'bigserial' | 'boolean' | 'bool' | 'USER-DEFINED';
type SQLiteValidTypes = 'datetime' | 'text' | 'character' | 'varchar' | 'varying character' | 'nchar' | 'native character' | 'nvarchar' | 'clob' | 'json' | 'int' | 'integer' | 'tinyint' | 'smallint' | 'mediumint' | 'bigint' | 'unsigned big int' | 'int2' | 'int8' | 'real' | 'double' | 'double precision' | 'float' | 'numeric' | 'decimal' | 'boolean';
type PrismaValidTypes = 'DateTime' | 'String' | 'Decimal' | 'BigInt' | 'Bytes' | 'Json' | 'Int' | 'Float' | 'Boolean' | 'Enum';
export interface Desc {
    Field: string;
    Default: string | null;
    EnumOptions?: string[];
    Extra: string;
    Type: string;
    Null: 'YES' | 'NO';
    Comment: string;
}
export type Destination = {
    type: 'zod';
    header?: string;
    useDateType?: boolean;
    useTrim?: boolean;
    nullish?: boolean;
    requiredString?: boolean;
    folder?: string;
    suffix?: string;
} | {
    type: 'ts';
    header?: string;
    enumType?: 'enum' | 'union';
    modelType?: 'interface' | 'type';
    folder?: string;
    suffix?: string;
} | {
    type: 'kysely';
    header?: string;
    schemaName?: string;
    folder?: string;
    suffix?: string;
};
export interface Config {
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
    ignore?: string[];
    camelCase?: boolean;
    silent?: boolean;
    dryRun?: boolean;
    magicComments?: boolean;
}
export {};
