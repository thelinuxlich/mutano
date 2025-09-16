/**
 * Database type mappings for different database systems
 */
export declare const prismaValidTypes: readonly ["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes", "Unsupported"];
export declare const dateTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const stringTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const bigIntTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const numberTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const decimalTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const booleanTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const enumTypes: {
    mysql: string[];
    postgres: string[];
    sqlite: string[];
    prisma: string[];
};
export declare const enumRegex: RegExp;
/**
 * Get the appropriate type mappings for a database type
 */
export declare function getTypeMappings(dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): {
    dateTypes: string[];
    stringTypes: string[];
    bigIntTypes: string[];
    numberTypes: string[];
    decimalTypes: string[];
    booleanTypes: string[];
    enumTypes: string[];
};
/**
 * Check if a type is a JSON type
 */
export declare function isJsonType(type: string): boolean;
/**
 * Check if a type is a date type for a specific database
 */
export declare function isDateType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is a string type for a specific database
 */
export declare function isStringType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is a number type for a specific database
 */
export declare function isNumberType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is a bigint type for a specific database
 */
export declare function isBigIntType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is a decimal type for a specific database
 */
export declare function isDecimalType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is a boolean type for a specific database
 */
export declare function isBooleanType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
/**
 * Check if a type is an enum type for a specific database
 */
export declare function isEnumType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean;
