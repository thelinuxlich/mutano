/**
 * SQL DDL file parser for Mutano
 * Parses CREATE TABLE/VIEW statements from SQL files
 */

import { readFileSync } from 'node:fs'
import { parseEnumValues } from '../types/mappings.js'
import type { Config, Desc } from '../types/index.js'

interface ParsedTable {
  columns: ParsedColumn[]
  isView: boolean
  name: string
}

interface ParsedColumn {
  comment: string
  defaultValue: string | null
  extra: string
  name: string
  nullable: boolean
  type: string
}

/**
 * Replace SQL comments with whitespace while preserving offsets.
 * String literals and quoted identifiers are left untouched.
 */
function stripSqlComments(sql: string): string {
  let result = ''
  let quote: string | null = null

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]

    if (quote) {
      result += char
      if (char === '\\' && quote === "'" && i + 1 < sql.length) {
        result += sql[i + 1]
        i++
        continue
      }
      if (char === quote) {
        if (sql[i + 1] === quote) {
          result += sql[i + 1]
          i++
        } else {
          quote = null
        }
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      result += char
      continue
    }

    if ((char === '-' && sql[i + 1] === '-') || char === '#') {
      while (i < sql.length && sql[i] !== '\n') {
        result += ' '
        i++
      }
      // Let the loop emit the newline that terminates the comment.
      i--
      continue
    }

    if (char === '/' && sql[i + 1] === '*') {
      let end = i + 2
      while (end < sql.length && !(sql[end] === '*' && sql[end + 1] === '/')) {
        end++
      }
      const stop = Math.min(end + 2, sql.length)
      for (let j = i; j < stop; j++) {
        result += sql[j] === '\n' ? '\n' : ' '
      }
      i = stop - 1
      continue
    }

    result += char
  }

  return result
}

/**
 * Find the closing parenthesis matching the opening one at `openIndex`.
 * Ignores parentheses inside quoted strings and identifiers.
 */
function findMatchingParen(sql: string, openIndex: number): number {
  let depth = 0
  let quote: string | null = null

  for (let i = openIndex; i < sql.length; i++) {
    const char = sql[i]

    if (quote) {
      if (char === '\\' && quote === "'" && i + 1 < sql.length) {
        i++
        continue
      }
      if (char === quote) {
        if (sql[i + 1] === quote) {
          i++
        } else {
          quote = null
        }
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/**
 * Split SQL text on commas that are not nested in parentheses or quotes.
 */
function splitTopLevel(sql: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]

    if (quote) {
      current += char
      if (char === '\\' && quote === "'" && i + 1 < sql.length) {
        current += sql[i + 1]
        i++
        continue
      }
      if (char === quote) {
        if (sql[i + 1] === quote) {
          current += sql[i + 1]
          i++
        } else {
          quote = null
        }
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(') depth++
    if (char === ')') depth--

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) parts.push(current)
  return parts
}

/**
 * Read a quoted SQL literal, handling doubled quotes and MySQL backslash escapes.
 */
function readQuotedLiteral(
  text: string,
  start: number,
): { end: number; value: string } {
  const quote = text[start]
  let value = ''

  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]
    if (char === '\\' && quote === "'" && i + 1 < text.length) {
      const next = text[i + 1]
      value += next === "'" || next === '\\' ? next : `\\${next}`
      i++
      continue
    }
    if (char === quote) {
      if (text[i + 1] === quote) {
        value += quote
        i++
        continue
      }
      return { value, end: i + 1 }
    }
    value += char
  }

  return { value, end: text.length }
}

/**
 * Blank out string literals so constraint keywords inside DEFAULT values
 * (for example DEFAULT 'NOT NULL') are not misinterpreted.
 */
function maskStringLiterals(text: string): string {
  let result = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "'" || char === '"') {
      const { end } = readQuotedLiteral(text, i)
      result += ' '.repeat(end - i)
      i = end - 1
    } else {
      result += char
    }
  }

  return result
}

function unquoteIdentifier(identifier: string): string {
  const parts = identifier.split('.')
  return parts[parts.length - 1].trim().replace(/^[`"]|[`"]$/g, '')
}

/**
 * Extracts table and column information from SQL DDL file
 */
export function extractSqlEntities(config: Config): {
  tables: string[]
  views: string[]
  tableDefinitions: Map<string, ParsedTable>
} {
  if (config.origin.type !== 'sql') {
    throw new Error('extractSqlEntities requires a SQL origin')
  }
  const sqlPath = config.origin.path
  const sqlContent = readFileSync(sqlPath, 'utf-8')
  // Offsets are preserved, so view parsing can still use the raw content.
  const strippedSql = stripSqlComments(sqlContent)

  const tables: string[] = []
  const views: string[] = []
  const tableDefinitions = new Map<string, ParsedTable>()

  // Find all CREATE TABLE statements (optionally schema-qualified) and match
  // their parentheses while ignoring quoted values.
  const tableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?\w+[`"]?)\s*\(/gi

  let match
  while ((match = tableRegex.exec(strippedSql)) !== null) {
    const tableName = unquoteIdentifier(match[1])
    const startIdx = match.index + match[0].length - 1 // Position of opening paren

    const endIdx = findMatchingParen(strippedSql, startIdx)

    if (endIdx >= 0) {
      // Check for @@ignore in table comment after the closing paren
      // MySQL table comments look like: ) ENGINE = InnoDB ... COMMENT = '@@ignore';
      // Limit search to text before the next semicolon to avoid matching comments from other tables
      const restOfContent = strippedSql.substring(endIdx + 1)
      const semicolonIdx = restOfContent.indexOf(';')
      const afterParen =
        semicolonIdx >= 0
          ? restOfContent.substring(0, semicolonIdx)
          : restOfContent.substring(0, 500)
      if (afterParen.match(/COMMENT\s*=\s*'[^']*@@ignore[^']*'/i)) {
        continue
      }

      const columnSection = strippedSql.substring(startIdx + 1, endIdx)
      const columns = parseColumns(columnSection)

      if (columns.length > 0) {
        tables.push(tableName)
        tableDefinitions.set(tableName, {
          name: tableName,
          isView: false,
          columns,
        })
      }
    }
  }

  // Parse CREATE VIEW statements
  const viewMatches = strippedSql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+((?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?\w+[`"]?)/gi,
  )

  for (const match of viewMatches) {
    const viewName = unquoteIdentifier(match[1])
    views.push(viewName)

    // Parse view columns from the SELECT statement (raw content keeps
    // inline `--` magic comments intact).
    const viewColumns = parseViewColumns(
      sqlContent,
      match.index + match[0].length,
      tableDefinitions,
    )

    if (viewColumns.length > 0) {
      tableDefinitions.set(viewName, {
        name: viewName,
        isView: true,
        columns: viewColumns,
      })
    }
  }

  return { tables, views, tableDefinitions }
}

/**
 * Parse column definitions from CREATE VIEW statement
 * Extracts column aliases from the SELECT clause and attempts to infer types from source tables
 *
 * For views with table aliases (like `ud` for `users_data`), this function attempts to
 * match column aliases (like `user_email`) to their source tables based on naming conventions
 * and the column name prefixes.
 */
function parseViewColumns(
  sqlContent: string,
  startPos: number,
  tableDefinitions: Map<string, ParsedTable>,
): ParsedColumn[] {
  const columns: ParsedColumn[] = []

  // Find the SELECT statement after CREATE VIEW ... AS
  // Look for 'AS' keyword followed by SELECT
  const remainingContent = sqlContent.substring(startPos)

  // Match AS followed by SELECT (case insensitive, with optional whitespace/newlines)
  const asSelectMatch = remainingContent.match(/\s*AS\s+SELECT\s+/i)
  if (!asSelectMatch) return columns

  const selectStart = asSelectMatch.index! + asSelectMatch[0].length
  const selectContent = remainingContent.substring(selectStart)

  // Find the end of the SELECT clause (look for FROM, WHERE, GROUP BY, HAVING, LIMIT, etc.)
  // Use a regex that matches FROM at the start of a line or after whitespace
  const fromMatch = selectContent.match(/\sFROM\s/i)
  const selectClause = fromMatch
    ? selectContent.substring(0, fromMatch.index)
    : selectContent

  // Parse column expressions - split by commas not inside parentheses
  const columnExprs: string[] = []
  let current = ''
  let parenDepth = 0

  for (let i = 0; i < selectClause.length; i++) {
    const char = selectClause[i]

    if (char === '(') parenDepth++
    if (char === ')') parenDepth--

    if (char === ',' && parenDepth === 0) {
      columnExprs.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    columnExprs.push(current.trim())
  }

  // Common table alias mappings based on naming conventions
  // Maps column prefix patterns to likely source table names
  const prefixToTable: Record<string, string[]> = {
    user_: ['users_data', 'ud'],
    company_: ['rise_entities', 'company'],
    team_: ['rise_entities', 'team'],
    user_relationship_: ['rise_entities', 'user_rel'],
    user_entity_: ['rise_entities', 'user_entity'],
  }

  // Extract column name from each expression
  for (let i = 0; i < columnExprs.length; i++) {
    let expr = columnExprs[i]
    if (!expr) continue

    // Extract inline SQL comment (--) if present - used for type overrides
    // Comments can be at the end of the current expression or at the start of the next
    // (SQL puts comments after the comma, so they end up with the next column when splitting)
    let inlineComment = ''

    // Check for inline comment at the END of current expression
    const endCommentMatch = expr.match(/--\s*(.+)$/)
    if (endCommentMatch) {
      inlineComment = endCommentMatch[1].trim()
      expr = expr.replace(/--\s*.+$/, '').trim()
    }

    // Check for inline comment at the START of current expression (from previous column's trailing comment)
    const startCommentMatch = expr.match(/^--\s*(.+?)\n/)
    if (startCommentMatch && !inlineComment) {
      inlineComment = startCommentMatch[1].trim()
      expr = expr.replace(/^--\s*.+?\n/, '').trim()
    }

    // Also check if there's a comment in the next expression that belongs to this column
    // (This handles the case where the comment is on the same line after the comma)
    const nextExpr = columnExprs[i + 1]
    if (nextExpr && !inlineComment) {
      const nextStartCommentMatch = nextExpr.match(/^--\s*(.+?)(?:\n|$)/)
      if (nextStartCommentMatch) {
        inlineComment = nextStartCommentMatch[1].trim()
        // Remove the comment from the next expression so it doesn't process again
        columnExprs[i + 1] = nextExpr.replace(/^--\s*.+?(?:\n|$)/, '').trim()
      }
    }

    // Match column alias: expression AS `alias` or expression AS alias
    // Also handle case where there's an inline comment after the alias
    const aliasMatch = expr.match(/\s+AS\s+[`"]?([^`"\s,]+)[`"]?\s*(?:--.*)?$/i)
    if (aliasMatch) {
      const name = aliasMatch[1]
      // Try to infer type from source table reference
      // Remove inline comment before matching
      const exprWithoutComment = expr.replace(/--.*$/, '')
      const sourceRefMatch = exprWithoutComment.match(
        /^(?:[`"]?([\w_]+)[`"]?\.)?[`"]?([\w_]+)[`"]?\s+AS/i,
      )
      const sourceTable = sourceRefMatch?.[1]
      const sourceCol = sourceRefMatch?.[2]

      let type = 'varchar(191)'
      let nullable = true
      let foundType = false

      // First try: direct table lookup by alias (e.g., 'ud' -> table definition)
      let sourceColumnComment = ''
      if (sourceTable && sourceCol) {
        const table = tableDefinitions.get(sourceTable)
        if (table) {
          const col = table.columns.find((c) => c.name === sourceCol)
          if (col) {
            type = col.type
            nullable = col.nullable
            sourceColumnComment = col.comment
            foundType = true
          }
        }
      }

      // Second try: infer from column name prefix (e.g., 'user_email' -> look in 'users_data')
      if (!foundType && sourceCol) {
        for (const [prefix, tableNames] of Object.entries(prefixToTable)) {
          if (name.startsWith(prefix)) {
            // Try each possible table name for this prefix
            for (const tableName of tableNames) {
              const table = tableDefinitions.get(tableName)
              if (table) {
                const col = table.columns.find((c) => c.name === sourceCol)
                if (col) {
                  type = col.type
                  nullable = col.nullable
                  sourceColumnComment = col.comment
                  foundType = true
                  break
                }
              }
            }
            if (foundType) break
          }
        }
      }

      // Third try: look for a table with the exact name matching the prefix (e.g., 'team_' -> 'teams')
      if (!foundType && sourceCol) {
        for (const prefix of Object.keys(prefixToTable)) {
          if (name.startsWith(prefix)) {
            // Try the singular and plural forms
            const singular = prefix.slice(0, -1) // Remove trailing underscore and 's'
            const potentialTableNames = [
              prefix.slice(0, -1), // e.g., 'team'
              prefix.slice(0, -1) + 's', // e.g., 'teams'
            ]
            for (const tableName of potentialTableNames) {
              const table = tableDefinitions.get(tableName)
              if (table) {
                const col = table.columns.find((c) => c.name === sourceCol)
                if (col) {
                  type = col.type
                  nullable = col.nullable
                  sourceColumnComment = col.comment
                  foundType = true
                  break
                }
              }
            }
            if (foundType) break
          }
        }
      }

      // Use the comment inherited from the source table column
      // Allow inline SQL comment to override the inherited comment
      let comment = sourceColumnComment
      if (inlineComment) {
        comment = inlineComment
      }

      columns.push({
        name,
        type,
        nullable,
        defaultValue: null,
        extra: '',
        comment,
      })
    } else {
      // No alias - use the column name directly (remove table prefixes)
      const colNameMatch = expr.match(/^(?:.*\.)?[`"]?([^`"\s,()]+)[`"]?\s*$/i)
      if (colNameMatch) {
        columns.push({
          name: colNameMatch[1],
          type: 'varchar(191)',
          nullable: true,
          defaultValue: null,
          extra: '',
          comment: '',
        })
      }
    }
  }

  return columns
}

/**
 * Parse column definitions from CREATE TABLE statement body
 */
function parseColumns(columnSection: string): ParsedColumn[] {
  const columns: ParsedColumn[] = []
  const definitions = splitTopLevel(columnSection)

  // Columns listed in a table-level PRIMARY KEY are implicitly NOT NULL.
  const primaryKeyColumns = new Set<string>()
  for (const definition of definitions) {
    const pkMatch = definition.trim().match(/^PRIMARY\s+KEY\s*\(([\s\S]*)\)$/i)
    if (!pkMatch) continue
    for (const part of pkMatch[1].split(',')) {
      const columnName = part.trim().match(/^[`"]?(\w+)[`"]?/)?.[1]
      if (columnName) primaryKeyColumns.add(columnName)
    }
  }

  for (const definition of definitions) {
    const trimmed = definition.trim()
    if (!trimmed) continue

    // Skip constraints
    if (
      trimmed.match(
        /^(PRIMARY\s+KEY|KEY\s|INDEX|UNIQUE\s|FOREIGN\s+KEY|CONSTRAINT|CHECK\s|FULLTEXT\s|SPATIAL\s)/i,
      )
    ) {
      continue
    }

    // Parse column: `name` type [constraints...]
    const colMatch = trimmed.match(/^[`"]?(\w+)[`"]?\s+([\s\S]+)$/i)
    if (!colMatch) continue

    const name = colMatch[1]
    let rest = colMatch[2].trim()

    // Extract type, handling quoted parentheses in enums/sets
    let type = ''
    if (/^(enum|set)\s*\(/i.test(rest)) {
      const openIndex = rest.indexOf('(')
      const closeIndex = findMatchingParen(rest, openIndex)
      if (closeIndex < 0) continue
      type = rest.substring(0, closeIndex + 1).replace(/\s+/g, ' ').trim()
      rest = rest.substring(closeIndex + 1).trim()
    } else {
      // Regular type
      const typeMatch = rest.match(/^(\w+(?:\([^)]*\))?)/i)
      if (!typeMatch) continue
      type = typeMatch[1].trim()
      rest = rest.substring(typeMatch[0].length).trim()
    }

    if (!type) continue

    // Keywords inside DEFAULT literals (e.g. DEFAULT 'NOT NULL') do not
    // constrain the column.
    const constraints = maskStringLiterals(rest)
    const nullable =
      !primaryKeyColumns.has(name) &&
      !/\bNOT\s+NULL\b/i.test(constraints) &&
      !/\bPRIMARY\s+KEY\b/i.test(constraints)

    // Extract EXTRA first (before processing DEFAULT)
    const extras: string[] = []
    if (/\bAUTO_INCREMENT\b/i.test(constraints)) extras.push('auto_increment')
    if (/\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i.test(constraints))
      extras.push('on update CURRENT_TIMESTAMP')

    const parsedDefault = extractDefault(rest)
    const defaultValue = parsedDefault?.value ?? null
    if (
      parsedDefault &&
      !parsedDefault.quoted &&
      parsedDefault.value.toUpperCase().startsWith('CURRENT_TIMESTAMP')
    ) {
      // CURRENT_TIMESTAMP defaults should be treated as generated (like MySQL driver does)
      // Set extra to indicate this is a default-generated field
      extras.push('DEFAULT_GENERATED')
    }

    const comment = extractComment(rest)

    // Skip columns with @ignore comment
    if (comment.match(/@ignore/)) {
      continue
    }

    // Validate: Magic comments on enum fields can cause issues with sqldef
    // when generating ALTER TABLE statements due to quote escaping problems
    if (
      type.match(/^(enum|set)\s*\(/i) &&
      comment.match(/@(kysely|ts|zod)\s*\(/)
    ) {
      throw new Error(
        `Magic comments are not supported on enum/set columns. ` +
          `Column "${name}" has type "${type}" with comment "${comment}". ` +
          `Remove the magic comment - enum types are automatically generated by mutano.`,
      )
    }

    columns.push({
      name,
      type,
      nullable,
      defaultValue,
      extra: extras.join(' '),
      comment,
    })
  }

  return columns
}

/**
 * Extract a DEFAULT value from a column's constraint text.
 * Quoted literals keep their content; bare NULL means no default.
 */
function extractDefault(
  rest: string,
): { quoted: boolean; value: string } | null {
  const defaultMatch = maskStringLiterals(rest).match(/\bDEFAULT\b/i)
  if (!defaultMatch) return null

  // Masked literals became spaces, so skip whitespace in the original text.
  const start = skipWhitespace(
    rest,
    defaultMatch.index! + defaultMatch[0].length,
  )
  if (start >= rest.length) return null

  const char = rest[start]
  if (char === "'" || char === '"') {
    return { quoted: true, value: readQuotedLiteral(rest, start).value }
  }

  const token = rest.substring(start).match(/^\S+/)?.[0]
  if (!token || token.toUpperCase() === 'NULL') return null
  return { quoted: false, value: token }
}

/**
 * Extract a COMMENT clause from a column's constraint text.
 */
function extractComment(rest: string): string {
  const commentMatch = maskStringLiterals(rest).match(/\bCOMMENT\b/i)
  if (!commentMatch) return ''

  // Masked literals became spaces, so skip whitespace in the original text.
  const start = skipWhitespace(rest, commentMatch.index! + commentMatch[0].length)
  if (rest[start] !== "'" && rest[start] !== '"') return ''
  return readQuotedLiteral(rest, start).value
}

function skipWhitespace(text: string, start: number): number {
  let pos = start
  while (pos < text.length && /\s/.test(text[pos])) pos++
  return pos
}

/**
 * Extract column descriptions for a table
 */
export function extractSqlColumnDescriptions(
  config: Config,
  tableName: string,
  tableDefinitions: Map<string, ParsedTable>,
): Desc[] {
  const table = tableDefinitions.get(tableName)
  if (!table) return []

  return table.columns.map((col) => {
    // Parse enum options - quoted commas/parentheses are preserved
    const enumOptions = parseEnumValues(col.type)

    // Extract base data type
    const dataType = col.type.split('(')[0].toLowerCase()

    return {
      Field: col.name,
      Type: col.type,
      DataType: dataType,
      Null: col.nullable ? 'YES' : 'NO',
      Default: col.defaultValue,
      Extra: col.extra,
      Comment: col.comment,
      EnumOptions: enumOptions,
    }
  })
}
