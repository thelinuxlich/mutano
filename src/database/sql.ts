/**
 * SQL DDL file parser for Mutano
 * Parses CREATE TABLE/VIEW statements from SQL files
 */

import { readFileSync } from 'node:fs'
import type { Config, Desc } from '../types/index.js'

interface ParsedTable {
  name: string
  isView: boolean
  columns: ParsedColumn[]
}

interface ParsedColumn {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  extra: string
  comment: string
}

/**
 * Extracts table and column information from SQL DDL file
 */
export function extractSqlEntities(config: Config): {
  tables: string[]
  views: string[]
  tableDefinitions: Map<string, ParsedTable>
} {
  const sqlPath = (config.origin as { type: 'sql'; path: string }).path
  const sqlContent = readFileSync(sqlPath, 'utf-8')
  
  const tables: string[] = []
  const views: string[] = []
  const tableDefinitions = new Map<string, ParsedTable>()

  // Parse CREATE TABLE statements - handles both backtick and unquoted names
  const tableMatches = sqlContent.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^;]+?)\)\s*(?:ENGINE|CHARSET|DEFAULT|COMMENT|;)/gi
  )

  for (const match of tableMatches) {
    const tableName = match[1]
    const columnSection = match[2]
    
    const columns = parseColumns(columnSection)
    
    tables.push(tableName)
    tableDefinitions.set(tableName, {
      name: tableName,
      isView: false,
      columns
    })
  }

  // Parse CREATE VIEW statements
  const viewMatches = sqlContent.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+[`"]?(\w+)[`"]?/gi
  )

  for (const match of viewMatches) {
    const viewName = match[1]
    views.push(viewName)
    // Views need to be queried from database for column info
  }

  return { tables, views, tableDefinitions }
}

/**
 * Parse column definitions from CREATE TABLE statement
 */
function parseColumns(columnSection: string): ParsedColumn[] {
  const columns: ParsedColumn[] = []
  
  // Split by comma but not inside parentheses (for enum values)
  const columnDefs = splitColumnDefinitions(columnSection)
  
  for (const colDef of columnDefs) {
    const trimmed = colDef.trim()
    
    // Skip constraints (PRIMARY KEY, KEY, INDEX, UNIQUE, FOREIGN KEY, CONSTRAINT, CHECK)
    if (trimmed.match(/^(PRIMARY\s+KEY|KEY|INDEX|UNIQUE|FOREIGN\s+KEY|CONSTRAINT|CHECK)/i)) {
      continue
    }
    
    // Parse column definition: `name` type constraints...
    // Handle both backtick quoted and unquoted names
    const colMatch = trimmed.match(/^[`"]?(\w+)[`"]?\s+(.+)$/i)
    if (!colMatch) continue
    
    const name = colMatch[1]
    const rest = colMatch[2]
    
    // Extract type (handles ENUM with parentheses)
    const typeMatch = rest.match(/^([\w\s]+(?:\([^)]+\))?)/i)
    const type = typeMatch ? typeMatch[1].trim() : 'varchar(255)'
    
    // Check for NULL/NOT NULL
    const nullable = !rest.match(/NOT\s+NULL/i)
    
    // Extract DEFAULT value
    const defaultMatch = rest.match(/DEFAULT\s+([^\s,)]+(?:\s+[^,]*)?)/i)
    let defaultValue = defaultMatch ? defaultMatch[1].trim() : null
    // Clean up string defaults
    if (defaultValue?.startsWith("'") && defaultValue.endsWith("'")) {
      defaultValue = defaultValue.slice(1, -1)
    }
    if (defaultValue?.toUpperCase() === 'NULL') {
      defaultValue = null
    }
    
    // Extract COMMENT - handle both single and double quotes, and special characters
    let comment = ''
    const commentMatchSingle = rest.match(/COMMENT\s+'((?:[^'\\]|\\.)*)'/i)
    const commentMatchDouble = rest.match(/COMMENT\s+"((?:[^"\\]|\\.)*)"/i)
    if (commentMatchSingle) {
      comment = commentMatchSingle[1].replace(/\\'/g, "'")
    } else if (commentMatchDouble) {
      comment = commentMatchDouble[1].replace(/\\"/g, '"')
    }
    
    // Extract EXTRA (AUTO_INCREMENT, etc.)
    const extras: string[] = []
    if (rest.match(/AUTO_INCREMENT/i)) extras.push('auto_increment')
    if (rest.match(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/i)) extras.push('on update CURRENT_TIMESTAMP')
    
    columns.push({
      name,
      type,
      nullable,
      defaultValue,
      extra: extras.join(' '),
      comment
    })
  }
  
  return columns
}

/**
 * Split column definitions respecting parentheses
 */
function splitColumnDefinitions(columnSection: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  
  for (let i = 0; i < columnSection.length; i++) {
    const char = columnSection[i]
    const prevChar = i > 0 ? columnSection[i - 1] : ''
    
    // Track string literals
    if (!inString && (char === "'" || char === '"')) {
      inString = true
      stringChar = char
      current += char
      continue
    }
    if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      stringChar = ''
      current += char
      continue
    }
    
    if (inString) {
      current += char
      continue
    }
    
    if (char === '(') depth++
    if (char === ')') depth--
    
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  if (current.trim()) {
    parts.push(current.trim())
  }
  
  return parts
}

/**
 * Extract column descriptions for a table from SQL file
 */
export function extractSqlColumnDescriptions(
  config: Config,
  tableName: string,
  tableDefinitions: Map<string, ParsedTable>
): Desc[] {
  const table = tableDefinitions.get(tableName)
  if (!table) return []
  
  return table.columns.map(col => {
    // Parse enum options if present
    const enumMatch = col.type.match(/enum\(([^)]+)\)/i)
    const enumOptions = enumMatch 
      ? enumMatch[1].match(/'([^']+)'/g)?.map(s => s.slice(1, -1))
      : undefined
    
    // Extract base data type (without size/precision)
    const dataType = col.type.split('(')[0].toLowerCase()
    
    return {
      Field: col.name,
      Type: col.type,
      DataType: dataType,
      Null: col.nullable ? 'YES' : 'NO',
      Default: col.defaultValue,
      Extra: col.extra,
      Comment: col.comment,
      EnumOptions: enumOptions
    }
  })
}
