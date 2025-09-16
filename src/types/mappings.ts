/**
 * Database type mappings for different database systems
 */

export const prismaValidTypes = [
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
  'Unsupported',
] as const

export const dateTypes = {
  mysql: ['date', 'datetime', 'timestamp'] as string[],
  postgres: [
    'timestamp',
    'timestamp with time zone',
    'timestamp without time zone',
    'date',
  ] as string[],
  sqlite: ['date', 'datetime'] as string[],
  prisma: ['DateTime'] as string[],
}

export const stringTypes = {
  mysql: [
    'tinytext',
    'text',
    'mediumtext',
    'longtext',
    'json',
    'time',
    'year',
    'char',
    'varchar',
  ] as string[],
  postgres: [
    'text',
    'character varying',
    'varchar',
    'char',
    'character',
    'json',
    'jsonb',
    'uuid',
    'time',
    'timetz',
    'interval',
    'name',
    'citext',
  ] as string[],
  sqlite: [
    'text',
    'character',
    'varchar',
    'varying character',
    'nchar',
    'native character',
    'nvarchar',
    'clob',
    'json',
  ] as string[],
  prisma: ['String', 'Bytes', 'Json'] as string[],
}

export const bigIntTypes = {
  mysql: ['bigint'] as string[],
  postgres: ['bigint'] as string[],
  sqlite: ['bigint', 'unsigned big int', 'int8'] as string[],
  prisma: ['BigInt'] as string[],
}

export const numberTypes = {
  mysql: [
    'tinyint',
    'smallint',
    'mediumint',
    'int',
    'float',
    'double',
    'bit',
    'year',
  ] as string[],
  postgres: [
    'smallint',
    'integer',
    'real',
    'double precision',
    'smallserial',
    'serial',
    'bigserial',
    'bit',
    'bit varying',
  ] as string[],
  sqlite: [
    'integer',
    'real',
    'numeric',
    'double',
    'double precision',
    'float',
    'int',
    'int2',
    'mediumint',
    'tinyint',
    'smallint',
  ] as string[],
  prisma: ['Int', 'Float'] as string[],
}

export const decimalTypes = {
  mysql: ['decimal'] as string[],
  postgres: ['decimal', 'numeric', 'money'] as string[],
  sqlite: ['decimal'] as string[],
  prisma: ['Decimal'] as string[],
}

export const booleanTypes = {
  mysql: ['boolean'] as string[],
  postgres: ['boolean'] as string[],
  sqlite: ['boolean'] as string[],
  prisma: ['Boolean'] as string[],
}

export const enumTypes = {
  mysql: ['enum'] as string[],
  postgres: ['enum', 'USER-DEFINED'] as string[],
  sqlite: [] as string[],
  prisma: [] as string[],
}

export const enumRegex = /enum\(([^)]+)\)/

/**
 * Get the appropriate type mappings for a database type
 */
export function getTypeMappings(dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma') {
  return {
    dateTypes: dateTypes[dbType],
    stringTypes: stringTypes[dbType],
    bigIntTypes: bigIntTypes[dbType],
    numberTypes: numberTypes[dbType],
    decimalTypes: decimalTypes[dbType],
    booleanTypes: booleanTypes[dbType],
    enumTypes: enumTypes[dbType],
  }
}

/**
 * Check if a type is a JSON type
 */
export function isJsonType(type: string): boolean {
  return type.toLowerCase().includes('json')
}

/**
 * Check if a type is a date type for a specific database
 */
export function isDateType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return dateTypes[dbType].includes(type)
}

/**
 * Check if a type is a string type for a specific database
 */
export function isStringType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return stringTypes[dbType].includes(type)
}

/**
 * Check if a type is a number type for a specific database
 */
export function isNumberType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return numberTypes[dbType].includes(type)
}

/**
 * Check if a type is a bigint type for a specific database
 */
export function isBigIntType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return bigIntTypes[dbType].includes(type)
}

/**
 * Check if a type is a decimal type for a specific database
 */
export function isDecimalType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return decimalTypes[dbType].includes(type)
}

/**
 * Check if a type is a boolean type for a specific database
 */
export function isBooleanType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return booleanTypes[dbType].includes(type)
}

/**
 * Check if a type is an enum type for a specific database
 */
export function isEnumType(type: string, dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma'): boolean {
  return enumTypes[dbType].includes(type)
}
