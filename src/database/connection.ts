/**
 * Database connection and schema extraction utilities
 */

import knex from 'knex'
import type { Config, Desc } from '../types/index.js'
import { hasTableIgnoreDirective, hasIgnoreDirective } from '../utils/magic-comments.js'

/**
 * Create a database connection based on config
 */
export function createDatabaseConnection(config: Config) {
  const { origin } = config

  switch (origin.type) {
    case 'mysql':
      return knex({
        client: 'mysql2',
        connection: {
          host: origin.host,
          port: origin.port,
          user: origin.user,
          password: origin.password,
          database: origin.database,
          ssl: origin.ssl,
        },
      })

    case 'postgres':
      return knex({
        client: 'pg',
        connection: {
          host: origin.host,
          port: origin.port,
          user: origin.user,
          password: origin.password,
          database: origin.database,
          ssl: origin.ssl,
        },
        searchPath: origin.schema ? [origin.schema] : ['public'],
      })

    case 'sqlite':
      return knex({
        client: 'sqlite3',
        connection: {
          filename: origin.path,
        },
        useNullAsDefault: true,
      })

    default:
      throw new Error(`Unsupported database type: ${(origin as any).type}`)
  }
}

/**
 * Extract table names from database, filtering out tables with @@ignore
 */
export async function extractTables(db: ReturnType<typeof knex>, config: Config): Promise<string[]> {
  const { origin } = config

  switch (origin.type) {
    case 'mysql':
      const mysqlTables = await db.raw(`
        SELECT table_name, table_comment
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [origin.database])
      return mysqlTables[0]
        .filter((row: any) => !hasTableIgnoreDirective(row.table_comment || ''))
        .map((row: any) => row.table_name)

    case 'postgres':
      const schema = origin.schema || 'public'
      const postgresTables = await db.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [schema])
      return postgresTables.rows.map((row: any) => row.table_name)

    case 'sqlite':
      const sqliteTables = await db.raw(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `)
      return sqliteTables.map((row: any) => row.name)

    default:
      return []
  }
}

/**
 * Extract view names from database, filtering out views with @@ignore
 */
export async function extractViews(db: ReturnType<typeof knex>, config: Config): Promise<string[]> {
  const { origin } = config

  switch (origin.type) {
    case 'mysql':
      const mysqlViews = await db.raw(`
        SELECT table_name, table_comment
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [origin.database])
      return mysqlViews[0]
        .filter((row: any) => !hasTableIgnoreDirective(row.table_comment || ''))
        .map((row: any) => row.table_name)

    case 'postgres':
      const schema = origin.schema || 'public'
      const postgresViews = await db.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [schema])
      return postgresViews.rows.map((row: any) => row.table_name)

    case 'sqlite':
      const sqliteViews = await db.raw(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'view'
      `)
      return sqliteViews.map((row: any) => row.name)

    default:
      return []
  }
}

/**
 * Extract column descriptions for a table or view
 */
export async function extractColumnDescriptions(
  db: ReturnType<typeof knex>,
  config: Config,
  tableName: string
): Promise<Desc[]> {
  const { origin } = config

  switch (origin.type) {
    case 'mysql':
      const mysqlColumns = await db.raw(`
        SELECT
          column_name as \`Field\`,
          column_default as \`Default\`,
          extra as \`Extra\`,
          is_nullable as \`Null\`,
          column_type as \`Type\`,
          column_comment as \`Comment\`
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [origin.database, tableName])

      return mysqlColumns[0]
        .filter((row: any) => !hasIgnoreDirective(row.Comment || ''))
        .map((row: any) => ({
          Field: row.Field,
          Default: row.Default,
          Extra: row.Extra || '',
          Null: row.Null,
          Type: row.Type,
          Comment: row.Comment || '',
        }))

    case 'postgres':
      const schema = origin.schema || 'public'
      const postgresColumns = await db.raw(`
        SELECT
          column_name as "Field",
          column_default as "Default",
          '' as "Extra",
          is_nullable as "Null",
          data_type as "Type",
          '' as "Comment"
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [schema, tableName])

      return postgresColumns.rows
        .filter((row: any) => !hasIgnoreDirective(row.Comment || ''))
        .map((row: any) => ({
          Field: row.Field,
          Default: row.Default,
          Extra: row.Extra || '',
          Null: row.Null,
          Type: row.Type,
          Comment: row.Comment || '',
        }))

    case 'sqlite':
      const sqliteColumns = await db.raw(`PRAGMA table_info(${tableName})`)

      return sqliteColumns
        .filter((row: any) => !hasIgnoreDirective(row.Comment || ''))
        .map((row: any) => ({
          Field: row.name,
          Default: row.dflt_value,
          Extra: row.pk ? 'PRIMARY KEY' : '',
          Null: row.notnull ? 'NO' : 'YES',
          Type: row.type,
          Comment: '',
        }))

    default:
      return []
  }
}

/**
 * Extract enum values for PostgreSQL user-defined types
 */
export async function extractEnumValues(
  db: ReturnType<typeof knex>, 
  config: Config, 
  typeName: string
): Promise<string[]> {
  if (config.origin.type !== 'postgres') {
    return []
  }

  try {
    const result = await db.raw(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = ?
      )
      ORDER BY enumsortorder
    `, [typeName])
    
    return result.rows.map((row: any) => row.enumlabel)
  } catch (error) {
    return []
  }
}
