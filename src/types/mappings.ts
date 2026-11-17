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
  mysql: [
    'date',
    'datetime',
    'datetime(3)',
    'timestamp',
    'timestamp(3)',
  ] as string[],
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
    'integer',
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

/**
 * Parse MySQL ENUM values from a column type such as
 * `enum('new','in,progress','it''s done','archived (old)')`.
 * Commas, parentheses, and quotes inside quoted values are preserved.
 */
export function parseEnumValues(type: string): string[] | undefined {
  const open = type.match(/\benum\s*\(/i)
  if (!open) return undefined

  const values: string[] = []
  let value = ''
  let quote: string | null = null

  for (let i = open.index! + open[0].length; i < type.length; i++) {
    const char = type[i]

    if (quote) {
      if (char === '\\' && quote === "'") {
        const next = type[i + 1]
        if (next === undefined) break
        // MySQL escapes quotes/backslashes with a backslash; keep other
        // escape sequences literal.
        value += next === "'" || next === '\\' ? next : `\\${next}`
        i++
        continue
      }
      if (char === quote) {
        if (type[i + 1] === quote) {
          value += quote
          i++
          continue
        }
        quote = null
        continue
      }
      value += char
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === ',') {
      values.push(value.trim())
      value = ''
      continue
    }
    if (char === ')') {
      values.push(value.trim())
      break
    }
    value += char
  }

  return values
}

/**
 * Get the appropriate type mappings for a database type
 */
export function getTypeMappings(
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma' | 'sql',
  dialect?: string,
) {
  // For SQL files, use the dialect to determine mappings (default to mysql)
  const effectiveType =
    dbType === 'sql'
      ? (dialect as 'mysql' | 'postgres' | 'sqlite') || 'mysql'
      : dbType

  return {
    dateTypes: dateTypes[effectiveType],
    stringTypes: stringTypes[effectiveType],
    bigIntTypes: bigIntTypes[effectiveType],
    numberTypes: numberTypes[effectiveType],
    decimalTypes: decimalTypes[effectiveType],
    booleanTypes: booleanTypes[effectiveType],
    enumTypes: enumTypes[effectiveType],
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
export function isDateType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return dateTypes[dbType].includes(type)
}

/**
 * Check if a type is a string type for a specific database
 */
export function isStringType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return stringTypes[dbType].includes(type)
}

/**
 * Check if a type is a number type for a specific database
 */
export function isNumberType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return numberTypes[dbType].includes(type)
}

/**
 * Check if a type is a bigint type for a specific database
 */
export function isBigIntType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return bigIntTypes[dbType].includes(type)
}

/**
 * Check if a type is a decimal type for a specific database
 */
export function isDecimalType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return decimalTypes[dbType].includes(type)
}

/**
 * Check if a type is a boolean type for a specific database
 */
export function isBooleanType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return booleanTypes[dbType].includes(type)
}

/**
 * Check if a type is an enum type for a specific database
 */
export function isEnumType(
  type: string,
  dbType: 'mysql' | 'postgres' | 'sqlite' | 'prisma',
): boolean {
  return enumTypes[dbType].includes(type)
}
