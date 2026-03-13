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

  // Find all CREATE TABLE statements by looking for the pattern and matching parentheses
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/gi
  
  let match
  while ((match = tableRegex.exec(sqlContent)) !== null) {
    const tableName = match[1]
    const startIdx = match.index + match[0].length - 1 // Position of opening paren
    
    // Find the matching closing parenthesis for the CREATE TABLE
    let parenDepth = 1
    let endIdx = startIdx + 1
    while (parenDepth > 0 && endIdx < sqlContent.length) {
      if (sqlContent[endIdx] === '(') parenDepth++
      if (sqlContent[endIdx] === ')') parenDepth--
      endIdx++
    }
    
    if (parenDepth === 0) {
      const columnSection = sqlContent.substring(startIdx + 1, endIdx - 1)
      const columns = parseColumns(columnSection)
      
      if (columns.length > 0) {
        tables.push(tableName)
        tableDefinitions.set(tableName, {
          name: tableName,
          isView: false,
          columns
        })
      }
    }
  }

  // Parse CREATE VIEW statements
  const viewMatches = sqlContent.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+[`"]?(\w+)[`"]?/gi
  )

  for (const match of viewMatches) {
    const viewName = match[1]
    views.push(viewName)
  }

  return { tables, views, tableDefinitions }
}

/**
 * Parse column definitions from CREATE TABLE statement body
 */
function parseColumns(columnSection: string): ParsedColumn[] {
  const columns: ParsedColumn[] = []
  
  // Process line by line, tracking multi-line column definitions
  const lines = columnSection.split('\n')
  const columnDefs: string[] = []
  let current = ''
  let parenDepth = 0
  
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('--')) continue
    
    // Track parentheses depth for enums
    for (const char of trimmedLine) {
      if (char === '(') parenDepth++
      if (char === ')') parenDepth--
    }
    
    current += ' ' + trimmedLine
    
    // If at depth 0 and line ends with comma, or is a complete definition
    if (parenDepth === 0) {
      if (trimmedLine.endsWith(',')) {
        columnDefs.push(current.trim().slice(0, -1)) // Remove trailing comma
        current = ''
      } else if (!trimmedLine.includes('(') && 
                 (trimmedLine.match(/,?\s*$/) || 
                  trimmedLine.match(/COMMENT\s+'[^']*'\s*,?$/i))) {
        columnDefs.push(current.trim().replace(/,$/, ''))
        current = ''
      }
    }
  }
  
  // Add any remaining
  if (current.trim()) {
    columnDefs.push(current.trim().replace(/,$/, ''))
  }
  
  for (const colDef of columnDefs) {
    const trimmed = colDef.trim()
    if (!trimmed) continue
    
    // Skip constraints
    if (trimmed.match(/^(PRIMARY\s+KEY|KEY\s|INDEX|UNIQUE\s|FOREIGN\s+KEY|CONSTRAINT|CHECK\s)/i)) {
      continue
    }
    
    // Parse column: `name` type [constraints...]
    const colMatch = trimmed.match(/^[`"]?(\w+)[`"]?\s+(.+)$/is)
    if (!colMatch) continue
    
    const name = colMatch[1]
    let rest = colMatch[2].trim()
    
    // Extract type with special handling for multi-line enums
    let type = ''
    if (rest.match(/^(enum|set)\s*\(/i)) {
      // Find the closing paren for this enum
      let depth = 1
      let pos = rest.indexOf('(') + 1
      while (pos < rest.length && depth > 0) {
        if (rest[pos] === '(') depth++
        if (rest[pos] === ')') depth--
        pos++
      }
      type = rest.substring(0, pos).replace(/\s+/g, ' ').trim()
      rest = rest.substring(pos).trim()
    } else {
      // Regular type
      const typeMatch = rest.match(/^([\w]+(?:\([^)]+\))?)/i)
      if (typeMatch) {
        type = typeMatch[1].trim()
        rest = rest.substring(typeMatch[0].length).trim()
      }
    }
    
    if (!type) continue
    
    // Parse constraints
    const nullable = !rest.match(/NOT\s+NULL/i)
    
    // Extract EXTRA first (before processing DEFAULT)
    const extras: string[] = []
    if (rest.match(/AUTO_INCREMENT/i)) extras.push('auto_increment')
    if (rest.match(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/i)) extras.push('on update CURRENT_TIMESTAMP')
    
    // Extract DEFAULT - handle quoted strings with spaces
    let defaultValue: string | null = null
    // Match DEFAULT followed by either a quoted string or a non-whitespace value
    const defaultMatch = rest.match(/DEFAULT\s+('(?:[^'\\]|\\.)*'|\S+)/i)
    if (defaultMatch) {
      defaultValue = defaultMatch[1].trim()
      // Handle quoted strings
      if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
        defaultValue = defaultValue.slice(1, -1)
      }
      const upper = defaultValue.toUpperCase()
      if (upper === 'NULL') {
        defaultValue = null
      } else if (upper.startsWith('CURRENT_TIMESTAMP')) {
        // CURRENT_TIMESTAMP defaults should be treated as generated (like MySQL driver does)
        // Set extra to indicate this is a default-generated field
        extras.push('DEFAULT_GENERATED')
      }
    }
    
    // Extract COMMENT
    let comment = ''
    const commentMatch = rest.match(/COMMENT\s+'((?:[^'\\]|\\.)*)'/i)
    if (commentMatch) {
      comment = commentMatch[1].replace(/\\'/g, "'")
    }
    
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
 * Extract column descriptions for a table
 */
export function extractSqlColumnDescriptions(
  config: Config,
  tableName: string,
  tableDefinitions: Map<string, ParsedTable>
): Desc[] {
  const table = tableDefinitions.get(tableName)
  if (!table) return []
  
  return table.columns.map(col => {
    // Parse enum options - handle multi-line enums by using dotAll flag
    const enumMatch = col.type.match(/enum\s*\(([\s\S]+)\)/i)
    const enumOptions = enumMatch 
      ? enumMatch[1].match(/'([^']+)'/g)?.map(s => s.slice(1, -1))
      : undefined
    
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
      EnumOptions: enumOptions
    }
  })
}
