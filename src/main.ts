/* eslint-disable no-case-declarations */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const enumDeclarations: Record<string, string[]> = {}
import {
  type Enumerator,
  type Field,
  type Model,
  createPrismaSchemaBuilder,
} from '@mrleebo/prisma-ast'
import camelCase from 'camelcase'
import fs from 'fs-extra'
import knex from 'knex'

export const extractTypeExpression = (comment: string, prefix: string) => {
  const start = comment.indexOf(prefix)
  if (start === -1) return null

  const typeLen = prefix.length
  let position = start + typeLen

  let depth = 1

  while (position < comment.length && depth > 0) {
    const char = comment[position]

    if (char === '(' || char === '{' || char === '<' || char === '[') {
      depth++
    } else if (char === ')' || char === '}' || char === '>' || char === ']') {
      depth--
      if (depth === 0) {
        const extracted = comment.substring(start + typeLen, position)
        return extracted
      }
    }

    position++
  }

  return null
}

export const extractTSExpression = (comment: string) =>
  extractTypeExpression(comment, '@ts(')
export const extractKyselyExpression = (comment: string) =>
  extractTypeExpression(comment, '@kysely(')
export const extractZodExpression = (comment: string) =>
  extractTypeExpression(comment, '@zod(')

const prismaValidTypes = [
  'BigInt',
  'Boolean',
  'Bytes',
  'DateTime',
  'Decimal',
  'Float',
  'Int',
  'Json',
  'String',
  'Enum',
]

const dateTypes = {
  mysql: ['date', 'datetime', 'timestamp'],
  postgres: [
    'date',
    'timestamp',
    'timestamptz',
    'timestamp without time zone',
    'timestamp with time zone',
  ],
  sqlite: ['datetime'],
  prisma: ['DateTime'],
}
const stringTypes = {
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
  ],
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
  ],
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
  ],
  prisma: ['String', 'Bytes', 'Json'],
}

const bigIntTypes = {
  mysql: ['bigint'],
  postgres: ['bigint'],
  sqlite: ['bigint'],
  prisma: ['BigInt'],
}
const numberTypes = {
  mysql: ['smallint', 'mediumint', 'int', 'float', 'double'],
  postgres: [
    'smallint',
    'integer',
    'real',
    'double precision',
    'serial',
    'bigserial',
  ],
  sqlite: [
    'int',
    'integer',
    'tinyint',
    'smallint',
    'mediumint',
    'unsigned big int',
    'int2',
    'int8',
    'real',
    'double',
    'double precision',
    'float',
  ],
  prisma: ['Int', 'Float'],
}

const decimalTypes = {
  mysql: ['decimal'],
  postgres: ['decimal', 'numeric'],
  sqlite: ['numeric', 'decimal'],
  prisma: ['Decimal'],
}
const booleanTypes = {
  mysql: ['tinyint'],
  postgres: ['boolean', 'bool'],
  sqlite: ['boolean'],
  prisma: ['Boolean'],
}
const enumTypes = {
  mysql: ['enum'],
  postgres: ['USER-DEFINED'],
  sqlite: [], // SQLite doesn't have native enum types
  prisma: ['Enum'],
}

const enumRegex = /enum\(([^)]+)\)/

export function getType(
  op: 'table' | 'insertable' | 'updateable' | 'selectable',
  desc: Desc,
  config: Config,
  destination: Destination,
  tableName?: string,
) {
  const schemaType = config.origin.type
  const { Default, Extra, Null, Type, Comment, EnumOptions } = desc
  const isZodDestination = destination.type === 'zod'
  const isTsDestination = destination.type === 'ts'
  const isKyselyDestination = destination.type === 'kysely'
  const isNullish =
    isZodDestination &&
    destination.type === 'zod' &&
    destination.nullish === true
  const isTrim =
    isZodDestination &&
    destination.type === 'zod' &&
    destination.useTrim === true &&
    op !== 'selectable'
  const isUseDateType =
    isZodDestination &&
    destination.type === 'zod' &&
    destination.useDateType === true

  const hasDefaultValue = Default !== null && op !== 'selectable'
  const isGenerated = ['DEFAULT_GENERATED', 'auto_increment'].includes(Extra)
  const isNull = Null === 'YES'

  if (isGenerated && !isNull && ['insertable', 'updateable'].includes(op))
    return

  const isRequiredString =
    destination.type === 'zod' &&
    destination.requiredString === true &&
    op !== 'selectable'
  const type = schemaType === 'mysql' ? Type.split('(')[0].split(' ')[0] : Type

  if (isTsDestination || isKyselyDestination) {
    if (isKyselyDestination && config.magicComments) {
      const kyselyOverrideType = extractKyselyExpression(Comment)
      if (kyselyOverrideType) {
        const shouldBeNullable =
          isNull ||
          (['insertable', 'updateable'].includes(op) &&
            (hasDefaultValue || isGenerated)) ||
          (op === 'updateable' && !isNull && !hasDefaultValue)

        // Check if the override type already includes "| null" to avoid duplication
        return shouldBeNullable
          ? kyselyOverrideType.includes('| null')
            ? kyselyOverrideType
            : `${kyselyOverrideType} | null`
          : kyselyOverrideType
      }
    }

    const tsOverrideType = config.magicComments
      ? extractTSExpression(Comment)
      : null

    const shouldBeNullable =
      isNull ||
      (['insertable', 'updateable'].includes(op) &&
        (hasDefaultValue || isGenerated)) ||
      (op === 'updateable' && !isNull && !hasDefaultValue)

    if (tsOverrideType) {
      // Check if the override type already includes "| null" to avoid duplication
      return shouldBeNullable
        ? tsOverrideType.includes('| null')
          ? tsOverrideType
          : `${tsOverrideType} | null`
        : tsOverrideType
    }
    if (dateTypes[schemaType].includes(type)) {
      return shouldBeNullable ? 'Date | null' : 'Date'
    }

    if (stringTypes[schemaType].includes(type)) {
      return shouldBeNullable ? 'string | null' : 'string'
    }

    if (numberTypes[schemaType].includes(type)) {
      return shouldBeNullable ? 'number | null' : 'number'
    }

    if (booleanTypes[schemaType].includes(type)) {
      return shouldBeNullable ? 'boolean | null' : 'boolean'
    }

    if (bigIntTypes[schemaType].includes(type) || type === 'BigInt') {
      if (isKyselyDestination) {
        return shouldBeNullable ? 'BigInt | null' : 'BigInt'
      }
      return shouldBeNullable ? 'string | null' : 'string'
    }

    if (decimalTypes[schemaType].includes(type) || type === 'Decimal') {
      if (isKyselyDestination) {
        return shouldBeNullable ? 'Decimal | null' : 'Decimal'
      }
      return shouldBeNullable ? 'string | null' : 'string'
    }

    if (schemaType !== 'sqlite' && enumTypes[schemaType].includes(type)) {
      const enumType =
        destination.type === 'ts' ? destination.enumType || 'union' : 'union'

      let enumValues: string[] = []
      if (schemaType === 'mysql') {
        const matches = Type.match(enumRegex)
        if (matches?.[1]) {
          enumValues = matches[1]
            .split(',')
            .map((v) => v.trim())
            .sort()
        }
      } else if (EnumOptions && EnumOptions.length > 0) {
        enumValues = EnumOptions.map((e) => `'${e}'`).sort()
      }

      if (enumValues.length === 0) {
        return isNull ? 'string | null' : 'string'
      }

      if (enumType === 'enum') {
        const enumName = camelCase(`${desc.Field}_enum`, { pascalCase: true })
        const enumDeclaration = `enum ${enumName} {\n  ${enumValues
          .map((v) => {
            const cleanName = v.replace(/['"]/g, '')
            return `${cleanName} = ${v}`
          })
          .join(',\n  ')}\n}`

        if (tableName) {
          if (!enumDeclarations[tableName]) {
            enumDeclarations[tableName] = []
          }
          if (!enumDeclarations[tableName].includes(enumDeclaration)) {
            enumDeclarations[tableName].push(enumDeclaration)
          }
        }

        return shouldBeNullable ? `${enumName} | null` : enumName
      }
      const unionType = enumValues.join(' | ')
      return shouldBeNullable ? `(${unionType}) | null` : unionType
    }

    return 'any'
  }

  const zDate = [
    'z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())',
  ]
  const string = [isTrim ? 'z.string().trim()' : 'z.string()']
  const number = ['z.number()']
  const boolean = [
    'z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean())',
  ]
  const dateField = isUseDateType ? zDate : string
  const nullable = isNullish && op !== 'selectable' ? 'nullish()' : 'nullable()'
  const optional = 'optional()'
  const nonnegative = 'nonnegative()'
  const isUpdateableFormat = op === 'updateable' && !isNull && !hasDefaultValue
  const min1 = 'min(1)'
  const zodOverrideType = config.magicComments
    ? extractZodExpression(Comment)
    : null

  let typeOverride: string | null = zodOverrideType
  if (!typeOverride && config.origin.overrideTypes) {
    if (config.origin.type === 'mysql') {
      typeOverride =
        config.origin.overrideTypes[type as MySQLValidTypes] || null
    } else if (config.origin.type === 'postgres') {
      typeOverride =
        config.origin.overrideTypes[type as PostgresValidTypes] || null
    } else if (config.origin.type === 'sqlite') {
      typeOverride =
        config.origin.overrideTypes[type as SQLiteValidTypes] || null
    } else if (config.origin.type === 'prisma') {
      typeOverride =
        config.origin.overrideTypes[type as PrismaValidTypes] || null
    }
  }
  const generateDateLikeField = () => {
    const field = typeOverride ? [typeOverride] : dateField
    if (isNull && !typeOverride) field.push(nullable)
    else if (hasDefaultValue || (!hasDefaultValue && isGenerated))
      field.push(optional)
    if (hasDefaultValue && !isGenerated) field.push(`default('${Default}')`)
    if (isUpdateableFormat) field.push(optional)
    return field.join('.')
  }
  const generateStringLikeField = () => {
    const field = typeOverride ? [typeOverride] : string
    if (isNull && !typeOverride) field.push(nullable)
    else if (hasDefaultValue || (!hasDefaultValue && isGenerated))
      field.push(optional)
    else if (isRequiredString && !typeOverride) field.push(min1)
    if (hasDefaultValue && !isGenerated) field.push(`default('${Default}')`)
    if (isUpdateableFormat) field.push(optional)
    return field.join('.')
  }
  const generateBooleanLikeField = () => {
    const field = typeOverride ? [typeOverride] : boolean
    if (isNull && !typeOverride) field.push(nullable)
    else if (hasDefaultValue || (!hasDefaultValue && isGenerated))
      field.push(optional)
    if (hasDefaultValue && !isGenerated) {
      if (Default === 'true' || Default === 'false') {
        field.push(`default(${Default})`)
      } else {
        field.push(`default(${Boolean(+Default)})`)
      }
    }
    if (isUpdateableFormat) field.push(optional)
    return field.join('.')
  }
  const generateNumberLikeField = () => {
    const unsigned = Type.endsWith(' unsigned')
    const field = typeOverride ? [typeOverride] : number
    if (unsigned && !typeOverride) field.push(nonnegative)
    if (isNull && !typeOverride) field.push(nullable)
    else if (hasDefaultValue || (!hasDefaultValue && isGenerated))
      field.push(optional)
    if (hasDefaultValue && !isGenerated) field.push(`default(${Default})`)
    if (isUpdateableFormat) field.push(optional)
    return field.join('.')
  }
  const generateEnumLikeField = () => {
    let enumValues: string[] = []
    if (schemaType === 'mysql') {
      const matches = Type.match(enumRegex)
      if (matches?.[1]) {
        enumValues = matches[1]
          .split(',')
          .map((v) => v.trim())
          .sort()
      }
    } else if (EnumOptions && EnumOptions.length > 0) {
      enumValues = [...EnumOptions].sort().map((e) => `'${e}'`)
    }
    const value = enumValues.join(',')
    const field = [`z.enum([${value}])`]
    if (isNull) field.push(nullable)
    else if (hasDefaultValue || (!hasDefaultValue && isGenerated))
      field.push(optional)
    if (hasDefaultValue && !isGenerated) field.push(`default('${Default}')`)
    if (isUpdateableFormat) field.push(optional)
    return field.join('.')
  }
  if (dateTypes[schemaType].includes(type)) return generateDateLikeField()
  if (stringTypes[schemaType].includes(type)) return generateStringLikeField()
  if (numberTypes[schemaType].includes(type)) return generateNumberLikeField()
  if (bigIntTypes[schemaType].includes(type) || type === 'BigInt') {
    // For Kysely, use the BigInt type
    if (isKyselyDestination) {
      const isNull = Null === 'YES'
      const hasDefaultValue = Default !== null
      const isGenerated =
        Extra.toLowerCase().includes('auto_increment') ||
        Extra.toLowerCase().includes('default_generated')

      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)

      return shouldBeNullable ? 'BigInt | null' : 'BigInt'
    }
    // For other destinations, treat as string
    return generateStringLikeField()
  }
  if (decimalTypes[schemaType].includes(type) || type === 'Decimal') {
    // For Kysely, use the Decimal type
    if (isKyselyDestination) {
      const isNull = Null === 'YES'
      const hasDefaultValue = Default !== null
      const isGenerated =
        Extra.toLowerCase().includes('auto_increment') ||
        Extra.toLowerCase().includes('default_generated')

      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)

      return shouldBeNullable ? 'Decimal | null' : 'Decimal'
    }
    // For other destinations, treat as string
    return generateStringLikeField()
  }
  if (booleanTypes[schemaType].includes(type)) return generateBooleanLikeField()
  if (schemaType !== 'sqlite' && enumTypes[schemaType].includes(type))
    return generateEnumLikeField()
  throw new Error(`Unsupported column type: ${type}`)
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

export function generateContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
  enumDeclarations,
  defaultZodHeader,
}: GenerateContentParams): string {
  let content = ''
  const schemaType = config.origin.type
  if (destination.type === 'kysely') {
    // For Kysely, we only generate the table interface and helper types
    // The DB interface will be generated in the consolidated file
    content += `// Kysely type definitions for ${table}\n`
    content += `\n// This interface defines the structure of the '${table}' table
export interface ${camelCase(table, { pascalCase: true })} {`
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('table', desc, config, destination, table)

      if (type) {
        let kyselyType = type
        const isAutoIncrement =
          desc.Extra.toLowerCase().includes('auto_increment')
        const isDefaultGenerated =
          desc.Extra.toLowerCase().includes('default_generated')
        const isNullable = desc.Null === 'YES'
        const isJsonField = desc.Type.toLowerCase().includes('json')
        const hasDefaultValue = desc.Default !== null
        const isEnum =
          schemaType !== 'sqlite' &&
          enumTypes[schemaType].includes(
            schemaType === 'mysql'
              ? desc.Type.split('(')[0].split(' ')[0]
              : desc.Type,
          )

        // Check for magic comments first
        const kyselyOverrideType = config.magicComments
          ? extractKyselyExpression(desc.Comment)
          : null

        if (kyselyOverrideType) {
          // Use the override type from magic comment
          kyselyType = kyselyOverrideType

          // Handle nullability for the override type
          if (isNullable && !kyselyType.includes('| null')) {
            kyselyType = `${kyselyType} | null`
          }

          // Handle Generated<> wrapping for the override type
          if (
            isAutoIncrement ||
            isDefaultGenerated ||
            (hasDefaultValue &&
              (isEnum ||
                kyselyType === 'string' ||
                kyselyType === 'boolean' ||
                kyselyType === 'number' ||
                kyselyType === 'Decimal' ||
                kyselyType === 'BigInt' ||
                kyselyType.includes('boolean | null') ||
                kyselyType.includes('string | null') ||
                kyselyType.includes('number | null') ||
                kyselyType.includes('Decimal | null') ||
                kyselyType.includes('BigInt | null')))
          ) {
            kyselyType = `Generated<${kyselyType}>`
          }
        } else if (isJsonField) {
          // Default JSON handling if no override
          kyselyType = isNullable ? 'Json | null' : 'Json'
        } else {
          // First, handle nullability
          if (isNullable && !isJsonField) {
            // If the type already includes "| null", we don't need to add it again
            if (!kyselyType.includes('| null')) {
              kyselyType = `${kyselyType} | null`
            }
          }

          // Then, wrap with Generated<> if needed
          if (
            isAutoIncrement ||
            isDefaultGenerated ||
            (hasDefaultValue &&
              (isEnum ||
                kyselyType === 'string' ||
                kyselyType === 'boolean' ||
                kyselyType === 'number' ||
                kyselyType === 'Decimal' ||
                kyselyType === 'BigInt' ||
                kyselyType.includes('boolean | null') ||
                kyselyType.includes('string | null') ||
                kyselyType.includes('number | null') ||
                kyselyType.includes('Decimal | null') ||
                kyselyType.includes('BigInt | null')))
          ) {
            kyselyType = `Generated<${kyselyType}>`
          }
        }

        content = `${content}
  ${field}: ${kyselyType};`
      }
    }
    content = `${content}
}

// Helper types for ${table}
export type Selectable${camelCase(table, { pascalCase: true })} = Selectable<${camelCase(table, { pascalCase: true })}>;
export type Insertable${camelCase(table, { pascalCase: true })} = Insertable<${camelCase(table, { pascalCase: true })}>;
export type Updateable${camelCase(table, { pascalCase: true })} = Updateable<${camelCase(table, { pascalCase: true })}>;
`
  } else if (destination.type === 'ts') {
    const modelType = destination.modelType || 'interface'
    const isInterface = modelType === 'interface'
    const header = destination.header

    content = header ? `${header}\n\n` : ''
    content += `// TypeScript ${isInterface ? 'interfaces' : 'types'} for ${table}`

    if (enumDeclarations[table] && enumDeclarations[table].length > 0) {
      content += '\n\n// Enum declarations'
      for (const enumDecl of enumDeclarations[table]) {
        content += `\n${enumDecl}`
      }
      content += '\n'
    }
    if (isInterface) {
      content += `\nexport interface ${camelCase(table, { pascalCase: true })} {`
    } else {
      content += `\nexport type ${camelCase(table, { pascalCase: true })} = {`
    }
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('table', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type};`
      }
    }
    content = `${content}
}

`
    if (isInterface) {
      content += `export interface Insertable${camelCase(table, { pascalCase: true })} {`
    } else {
      content += `export type Insertable${camelCase(table, { pascalCase: true })} = {`
    }
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('insertable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type};`
      }
    }
    content = `${content}
}

`
    if (isInterface) {
      content += `export interface Updateable${camelCase(table, { pascalCase: true })} {`
    } else {
      content += `export type Updateable${camelCase(table, { pascalCase: true })} = {`
    }
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('updateable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type};`
      }
    }
    content = `${content}
}

`
    if (isInterface) {
      content += `export interface Selectable${camelCase(table, { pascalCase: true })} {`
    } else {
      content += `export type Selectable${camelCase(table, { pascalCase: true })} = {`
    }
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('selectable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type};`
      }
    }
    content = `${content}
}
`
  } else if (destination.type === 'zod') {
    const header = destination.header

    content = header ? header + "\n\n" : defaultZodHeader(destination.version || 3)
    content += `export const ${table} = z.object({`
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('table', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type},`
      }
    }
    content = `${content}
})

export const insertable_${table} = z.object({`
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('insertable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type},`
      }
    }
    content = `${content}
})

export const updateable_${table} = z.object({`
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('updateable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type},`
      }
    }
    content = `${content}
})

export const selectable_${table} = z.object({`
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field
      const type = getType('selectable', desc, config, destination, table)
      if (type) {
        content = `${content}
  ${field}: ${type},`
      }
    }
    content = `${content}
})

export type ${camelCase(`${table}Type`, {
      pascalCase: true,
    })} = z.infer<typeof ${table}>
export type Insertable${camelCase(`${table}Type`, {
      pascalCase: true,
    })} = z.infer<typeof insertable_${table}>
export type Updateable${camelCase(`${table}Type`, {
      pascalCase: true,
    })} = z.infer<typeof updateable_${table}>
export type Selectable${camelCase(`${table}Type`, {
      pascalCase: true,
    })} = z.infer<typeof selectable_${table}>
`
  }

  return content
}

export const defaultKyselyHeader =
  "import { ColumnType, Selectable, Insertable, Updateable } from 'kysely';\n\n"

export const defaultZodHeader = (version: 3 | 4) => "import { z } from 'zod" + (version === 3 ? '' : '/v4')+"';\n\n"

export async function generate(
  config: Config,
): Promise<Record<string, string>> {
  let tables: string[] = []
  let prismaTables: (Model | null)[] = []
  let schema: ReturnType<typeof createPrismaSchemaBuilder> | null = null
  let db: ReturnType<typeof knex> | null = null

  interface KyselyTableContent {
    table: string
    content: string
  }
  const kyselyTableContents: Record<string, KyselyTableContent[]> = {}

  if (config.destinations.length === 0) {
    throw new Error('Empty destinations object.')
  }

  const dryRunOutput: Record<string, string> = {}

  if (config.origin.type === 'mysql') {
    db = knex({
      client: 'mysql2',
      connection: {
        host: config.origin.host,
        port: config.origin.port,
        user: config.origin.user,
        password: config.origin.password,
        database: config.origin.database,
        ssl: config.origin.ssl,
      },
    })
  } else if (config.origin.type === 'postgres') {
    db = knex({
      client: 'pg',
      connection: {
        host: config.origin.host,
        port: config.origin.port,
        user: config.origin.user,
        password: config.origin.password,
        database: config.origin.database,
        ssl: config.origin.ssl,
      },
    })
  } else if (config.origin.type === 'sqlite') {
    db = knex({
      client: 'sqlite3',
      connection: {
        filename: config.origin.path,
      },
      useNullAsDefault: true,
    })
  }

  const isCamelCase = config.camelCase && config.camelCase === true
  if (config.origin.type === 'prisma') {
    const schemaContents = readFileSync(config.origin.path).toString()
    schema = createPrismaSchemaBuilder(schemaContents)
    prismaTables = schema.findAllByType('model', {})
    tables = prismaTables.filter((t) => t !== null).map((table) => table.name)
  } else if (config.origin.type === 'mysql' && db) {
    const t: { table_name: string }[][] = await db.raw(
      'SELECT table_name as table_name FROM information_schema.tables WHERE table_schema = ?',
      [config.origin.database],
    )
    tables = t[0].map((row) => row.table_name).sort()
  } else if (config.origin.type === 'postgres' && db) {
    const schema = config.origin.schema || 'public'
    const t = await db.raw(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
      [schema, 'BASE TABLE'],
    )
    tables = t.rows.map((row: { table_name: string }) => row.table_name).sort()
  } else if (config.origin.type === 'sqlite' && db) {
    const t = await db.raw(
      "SELECT name as table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    tables = t.map((row: { table_name: string }) => row.table_name).sort()
  }
  const dests: string[] = []

  const includedTables = config.tables
  if (includedTables?.length)
    tables = tables.filter((table) => includedTables.includes(table))

  const allIgnoredTables = config.ignore
  const ignoredTablesRegex = allIgnoredTables?.filter((ignoreString) => {
    return ignoreString.startsWith('/') && ignoreString.endsWith('/')
  })
  const ignoredTableNames = allIgnoredTables?.filter(
    (table) => !ignoredTablesRegex?.includes(table),
  )
  if (ignoredTableNames?.length)
    tables = tables.filter((table) => !ignoredTableNames.includes(table))

  if (ignoredTablesRegex?.length) {
    tables = tables.filter((table) => {
      let useTable = true
      for (const text of ignoredTablesRegex) {
        const pattern = text.substring(1, text.length - 1)
        if (table.match(pattern) !== null) useTable = false
      }
      return useTable
    })
  }

  let describes: Desc[] = []

  for (let table of tables.sort((a, b) => a.localeCompare(b))) {
    if (config.origin.type === 'mysql' && db) {
      const d = await db.raw(`SHOW FULL COLUMNS FROM ${table}`)
      describes = d[0] as Desc[]
    } else if (config.origin.type === 'postgres' && db) {
      const schema = config.origin.schema || 'public'
      const d = await db.raw(
        `
				SELECT
					column_name as "Field",
					column_default as "Default",
					CASE WHEN is_nullable = 'YES' THEN 'YES' ELSE 'NO' END as "Null",
					data_type as "Type",
					CASE
						WHEN column_default LIKE 'nextval(%' THEN 'auto_increment'
						WHEN column_default IS NOT NULL AND (
							column_default LIKE 'now()%' OR
							column_default LIKE 'uuid_generate_v4()%' OR
							column_default LIKE 'gen_random_uuid()%' OR
							column_default LIKE 'current_timestamp%' OR
							column_default LIKE 'current_date%' OR
							column_default LIKE 'current_time%' OR
							column_default LIKE '(%' OR
							column_default LIKE 'array[%' OR
							column_default LIKE 'json_build_%'
						) THEN 'DEFAULT_GENERATED'
						ELSE ''
					END as "Extra",
					col_description(('"'||$1||'"."'||$2||'"')::regclass::oid, ordinal_position) as "Comment"
				FROM
					information_schema.columns
				WHERE
					table_schema = $1 AND table_name = $2
				ORDER BY
					ordinal_position
			`,
        [schema, table],
      )

      for (const column of d.rows) {
        if (column.Type === 'USER-DEFINED') {
          const enumValues = await db.raw(
            `
						SELECT
							e.enumlabel
						FROM
							pg_type t
							JOIN pg_enum e ON t.oid = e.enumtypid
							JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
						WHERE
							t.typname = (
								SELECT udt_name
								FROM information_schema.columns
								WHERE table_schema = $1
								AND table_name = $2
								AND column_name = $3
							)
						ORDER BY
							e.enumlabel
					`,
            [schema, table, column.Field],
          )

          column.EnumOptions = enumValues.rows.map(
            (row: { enumlabel: string }) => row.enumlabel,
          )
        }
      }

      describes = d.rows as Desc[]
    } else if (config.origin.type === 'sqlite' && db) {
      const d = await db.raw(`PRAGMA table_info(${table})`)
      describes = d.map(
        (row: {
          name: string
          dflt_value: string | null
          notnull: number
          type: string
        }) => {
          let extra = ''
          if (row.dflt_value !== null) {
            // Check for ROWID-based autoincrement
            if (
              row.name === 'rowid' ||
              row.type.toLowerCase() === 'integer primary key'
            ) {
              extra = 'auto_increment'
            }
            // Check for function-based defaults
            else if (
              row.dflt_value.includes('CURRENT_TIMESTAMP') ||
              row.dflt_value.includes('CURRENT_DATE') ||
              row.dflt_value.includes('CURRENT_TIME') ||
              row.dflt_value.includes('DATETIME') ||
              row.dflt_value.includes('strftime') ||
              row.dflt_value.includes('random()') ||
              row.dflt_value.includes('(') ||
              row.dflt_value.includes('uuid') ||
              row.dflt_value.includes('json_')
            ) {
              extra = 'DEFAULT_GENERATED'
            }
          }

          return {
            Field: row.name,
            Default: row.dflt_value,
            Null: row.notnull === 0 ? 'YES' : 'NO',
            Type: row.type.toLowerCase(),
            Extra: extra,
            Comment: '',
          }
        },
      )
    } else {
      const prismaTable = prismaTables.find((t) => t?.name === table) as Model
      let enumOptions: string[] | undefined
      describes = prismaTable.properties
        .filter(
          (p): p is Field =>
            p.type === 'field' &&
            p.array !== true &&
            !p.attributes?.find((a) => a.name === 'relation'),
        )
        .map((field) => {
          let defaultGenerated = false
          const defaultValueField = field.attributes
            ? field.attributes.find((a) => a.name === 'default')
            : null
          const defaultValue = defaultValueField?.args?.[0].value
          if (
            typeof defaultValue === 'object' &&
            // @ts-ignore
            defaultValue?.type === 'function'
          ) {
            defaultGenerated = true
          }
          const parsedDefaultValue =
            defaultValue !== undefined && typeof defaultValue !== 'object'
              ? defaultValue.toString().replace(/"/g, '')
              : null
          let fieldType = field.fieldType.toString()
          if (!prismaValidTypes.includes(fieldType) && schema) {
            enumOptions = schema
              .findAllByType('enum', {
                name: fieldType,
              })[0]
              ?.enumerators.filter(
                (e): e is Enumerator => e.type === 'enumerator',
              )
              .map((e) => {
                const attrs = e.attributes?.find((a) => a.name === 'map')
                return attrs?.args
                  ? attrs.args[0].value.toString().replace(/"/g, '')
                  : e.name
              })
            fieldType = 'Enum'
          }
          return {
            Field: field.name,
            Default: parsedDefaultValue,
            EnumOptions: enumOptions,
            Extra: defaultGenerated ? 'DEFAULT_GENERATED' : '',
            Type: fieldType,
            Null: field.optional ? 'YES' : 'NO',
            Comment: field.comment ?? '',
          }
        })
    }
    if (isCamelCase) table = camelCase(table)

    if (!config.destinations || config.destinations.length === 0) {
      throw new Error('No destinations specified')
    }

    const kyselyDestinations = config.destinations.filter(
      (d) => d.type === 'kysely',
    )
    const nonKyselyDestinations = config.destinations.filter(
      (d) => d.type !== 'kysely',
    )

    for (const destination of nonKyselyDestinations) {
      const content = generateContent({
        table,
        describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
        config,
        destination,
        isCamelCase: isCamelCase === true,
        enumDeclarations,
        defaultZodHeader,
      })

      const suffix = destination.suffix || ''
      const folder = destination.folder || '.'

      const file = suffix !== '' ? `${table}.${suffix}.ts` : `${table}.ts`

      if (config.dryRun) {
        // Use absolute path as the key
        const absolutePath = path.resolve(path.join(folder, file))
        dryRunOutput[absolutePath] = content
      } else {
        const dest = path.join(folder, file)
        dests.push(dest)
        if (!config.silent) console.log('Created:', dest)
        fs.outputFileSync(dest, content)
      }
    }

    for (const destination of kyselyDestinations) {
      const content = generateContent({
        table,
        describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
        config,
        destination,
        isCamelCase: isCamelCase === true,
        enumDeclarations,
        defaultZodHeader,
      })

      const outFile = destination.outFile || 'db.ts'
      if (!kyselyTableContents[outFile]) {
        kyselyTableContents[outFile] = []
      }
      kyselyTableContents[outFile].push({
        table,
        content,
      })

      if (config.dryRun) {
        // Use a temporary key with absolute path
        const tempKey = path.resolve(`${table}.kysely.temp`)
        dryRunOutput[tempKey] = content
      }
    }
  }

  if (db) await db.destroy()

  for (const [outFile, tableContents] of Object.entries(kyselyTableContents)) {
    if (tableContents.length === 0) continue

    const kyselyDestination = config.destinations.find(
      (d) => d.type === 'kysely',
    )
    const header = kyselyDestination?.header || defaultKyselyHeader
    const schemaName = kyselyDestination?.schemaName || 'DB'

    // Start with the header and JSON type definitions
    let consolidatedContent = `${header}\n\n// JSON type definitions
export type Json = ColumnType<JsonValue, string, string>;

export type JsonArray = JsonValue[];

export type JsonObject = {
  [x: string]: JsonValue | undefined;
};

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>

export type Decimal = ColumnType<string, number | string, number | string>

export type BigInt = ColumnType<string, number | string, number | string>
`

    consolidatedContent += '// Table Interfaces\n'
    for (const { content } of tableContents) {
      consolidatedContent += `${content}\n`
    }

    consolidatedContent += `\n// Database Interface\nexport interface ${schemaName} {\n`

    const sortedTableEntries = tableContents
      .map(({ table }) => {
        const pascalTable = camelCase(table, { pascalCase: true })
        const tableKey = isCamelCase ? camelCase(table) : table
        return { tableKey, pascalTable }
      })
      .sort((a, b) => a.tableKey.localeCompare(b.tableKey))

    for (const { tableKey, pascalTable } of sortedTableEntries) {
      consolidatedContent += `  ${tableKey}: ${pascalTable};\n`
    }

    consolidatedContent += '}\n'

    if (config.dryRun) {
      const absolutePath = path.resolve(outFile)
      dryRunOutput[absolutePath] = consolidatedContent
      for (const key of Object.keys(dryRunOutput)) {
        if (key.endsWith('.kysely.temp')) {
          delete dryRunOutput[key]
        }
      }
    } else {
      const dest = path.resolve(outFile)
      dests.push(dest)
      if (!config.silent) console.log('Created:', dest)
      fs.outputFileSync(dest, consolidatedContent)
    }
  }

  if (!config.dryRun) {
    const result: Record<string, string> = {}
    for (const dest of dests) {
      const absolutePath = path.resolve(dest)
      const content = fs.readFileSync(dest, 'utf8')
      result[absolutePath] = content
    }
    return result
  }

  const result: Record<string, string> = {}
  for (const [key, content] of Object.entries(dryRunOutput)) {
    const absolutePath = path.resolve(key)
    result[absolutePath] = content
  }

  return result
}

type MySQLValidTypes =
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'time'
  | 'year'
  | 'char'
  | 'varchar'
  | 'tinytext'
  | 'text'
  | 'mediumtext'
  | 'longtext'
  | 'json'
  | 'decimal'
  | 'tinyint'
  | 'smallint'
  | 'mediumint'
  | 'int'
  | 'bigint'
  | 'float'
  | 'double'
  | 'enum'

type PostgresValidTypes =
  | 'date'
  | 'timestamp'
  | 'timestamptz'
  | 'timestamp without time zone'
  | 'timestamp with time zone'
  | 'time'
  | 'timetz'
  | 'interval'
  | 'character'
  | 'varchar'
  | 'character varying'
  | 'text'
  | 'json'
  | 'jsonb'
  | 'uuid'
  | 'name'
  | 'citext'
  | 'numeric'
  | 'decimal'
  | 'smallint'
  | 'integer'
  | 'bigint'
  | 'real'
  | 'double precision'
  | 'serial'
  | 'bigserial'
  | 'boolean'
  | 'bool'
  | 'USER-DEFINED'

type SQLiteValidTypes =
  | 'datetime'
  | 'text'
  | 'character'
  | 'varchar'
  | 'varying character'
  | 'nchar'
  | 'native character'
  | 'nvarchar'
  | 'clob'
  | 'json'
  | 'int'
  | 'integer'
  | 'tinyint'
  | 'smallint'
  | 'mediumint'
  | 'bigint'
  | 'unsigned big int'
  | 'int2'
  | 'int8'
  | 'real'
  | 'double'
  | 'double precision'
  | 'float'
  | 'numeric'
  | 'decimal'
  | 'boolean'

type PrismaValidTypes =
  | 'DateTime'
  | 'String'
  | 'Decimal'
  | 'BigInt'
  | 'Bytes'
  | 'Json'
  | 'Int'
  | 'Float'
  | 'Boolean'
  | 'Enum'

export interface Desc {
  Field: string
  Default: string | null
  EnumOptions?: string[]
  Extra: string
  Type: string
  Null: 'YES' | 'NO'
  Comment: string
}

export type Destination =
  | {
      type: 'zod'
      version?: 3 | 4
      header?: string
      useDateType?: boolean
      useTrim?: boolean
      nullish?: boolean
      requiredString?: boolean
      folder?: string
      suffix?: string
    }
  | {
      type: 'ts'
      header?: string
      enumType?: 'enum' | 'union'
      modelType?: 'interface' | 'type'
      folder?: string
      suffix?: string
    }
  | {
      type: 'kysely'
      header?: string
      schemaName?: string
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
  ignore?: string[]
  camelCase?: boolean
  silent?: boolean
  dryRun?: boolean
  magicComments?: boolean
}
