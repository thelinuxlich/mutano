/**
 * Content generation for tables and views
 */

import camelCase from 'camelcase'
import type { GenerateContentParams, GenerateViewContentParams } from '../types/index.js'
import { getType } from './type-generator.js'

/**
 * Convert PascalCase/camelCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

/**
 * Generate content for database views (read-only)
 */
export function generateViewContent({
  view,
  describes,
  config,
  destination,
  isCamelCase,
  enumDeclarations: _enumDeclarations,
  defaultZodHeader,
}: GenerateViewContentParams): string {
  let content = ''

  if (destination.type === 'kysely') {
    // For Kysely views, we only generate the view interface (read-only)
    const pascalView = camelCase(view, { pascalCase: true })
    content += `// Kysely type definitions for ${view} (view)\n\n`
    content += `// This interface defines the structure of the '${view}' view (read-only)\n`
    content += `export interface ${pascalView}View {\n`

    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
      const fieldType = getType('selectable', desc, config, destination)
      content += `  ${fieldName}: ${fieldType};\n`
    }

    content += '}\n\n'
    content += `// Helper types for ${view} (view - read-only)\n`
    content += `export type Selectable${pascalView}View = Selectable<${pascalView}View>;\n`
  } else if (destination.type === 'ts') {
    // For TypeScript views, generate a single interface (read-only)
    const pascalView = camelCase(view, { pascalCase: true })
    content += `// TypeScript interface for ${view} (view - read-only)\n`
    content += `export interface ${pascalView}View {\n`

    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
      const fieldType = getType('selectable', desc, config, destination)
      content += `  ${fieldName}: ${fieldType};\n`
    }

    content += '}\n'
  } else if (destination.type === 'zod') {
    // For Zod views, generate a single schema (read-only)
    const version = (destination as any).version || 3
    const header = destination.header || defaultZodHeader(version)
    
    if (!content.includes(header)) {
      content += header
    }

    content += `// View schema (read-only)\n`
    const snakeView = toSnakeCase(view)
    content += `export const ${snakeView}_view = z.object({\n`

    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
      const fieldType = getType('selectable', desc, config, destination)
      content += `  ${fieldName}: ${fieldType},\n`
    }

    content += '})\n\n'

    const pascalView = camelCase(view, { pascalCase: true })
    content += `export type ${camelCase(`${pascalView}ViewType`, {
      pascalCase: true,
    })} = z.infer<typeof ${snakeView}_view>\n`
  }

  return content
}

/**
 * Generate content for database tables
 */
export function generateContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
  enumDeclarations: _enumDeclarations,
  defaultZodHeader,
}: GenerateContentParams): string {
  let content = ''

  if (destination.type === 'ts') {
    return generateTypeScriptContent({
      table,
      describes,
      config,
      destination,
      isCamelCase,
    })
  } else if (destination.type === 'kysely') {
    return generateKyselyContent({
      table,
      describes,
      config,
      destination,
      isCamelCase,
    })
  } else if (destination.type === 'zod') {
    return generateZodContent({
      table,
      describes,
      config,
      destination,
      isCamelCase,
      defaultZodHeader,
    })
  }

  return content
}

/**
 * Generate TypeScript interface content
 */
function generateTypeScriptContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
}: {
  table: string
  describes: any[]
  config: any
  destination: any
  isCamelCase: boolean
}): string {
  let content = ''
  const pascalTable = camelCase(table, { pascalCase: true })

  // Generate main interface
  content += `// TypeScript interfaces for ${table}\n\n`
  content += `export interface ${pascalTable} {\n`

  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('table', desc, config, destination)
    content += `  ${fieldName}: ${fieldType};\n`
  }

  content += '}\n\n'

  // Generate insertable interface
  content += `export interface Insertable${pascalTable} {\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('insertable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType};\n`
  }
  content += '}\n\n'

  // Generate updateable interface
  content += `export interface Updateable${pascalTable} {\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('updateable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType};\n`
  }
  content += '}\n\n'

  // Generate selectable interface
  content += `export interface Selectable${pascalTable} {\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('selectable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType};\n`
  }
  content += '}\n'

  return content
}

/**
 * Generate Kysely type definitions content
 */
function generateKyselyContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
}: {
  table: string
  describes: any[]
  config: any
  destination: any
  isCamelCase: boolean
}): string {
  let content = ''
  const pascalTable = camelCase(table, { pascalCase: true })

  content += `// Kysely type definitions for ${table}\n\n`
  content += `// This interface defines the structure of the '${table}' table\n`
  content += `export interface ${pascalTable} {\n`

  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    let fieldType = getType('table', desc, config, destination)

    // Handle auto-increment fields
    const isAutoIncrement = desc.Extra.toLowerCase().includes('auto_increment')
    const isDefaultGenerated = desc.Extra.toLowerCase().includes('default_generated')
    
    if (isAutoIncrement || isDefaultGenerated) {
      fieldType = `Generated<${fieldType.replace(' | null', '')}>${fieldType.includes(' | null') ? ' | null' : ''}`
    }

    content += `  ${fieldName}: ${fieldType};\n`
  }

  content += '}\n\n'

  // Generate helper types
  content += `// Use these types for inserting, selecting and updating the table\n`
  content += `export type Selectable${pascalTable} = Selectable<${pascalTable}>;\n`
  content += `export type Insertable${pascalTable} = Insertable<${pascalTable}>;\n`
  content += `export type Updateable${pascalTable} = Updateable<${pascalTable}>;\n`

  return content
}

/**
 * Generate Zod schema content
 */
function generateZodContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
  defaultZodHeader,
}: {
  table: string
  describes: any[]
  config: any
  destination: any
  isCamelCase: boolean
  defaultZodHeader: (version: 3 | 4) => string
}): string {
  let content = ''
  const version = destination.version || 3
  const header = destination.header || defaultZodHeader(version)

  if (!content.includes(header)) {
    content += header
  }

  // Convert table name to snake_case for Zod schemas
  const snakeTable = toSnakeCase(table)

  // Generate main schema
  content += `export const ${snakeTable} = z.object({\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('table', desc, config, destination)
    content += `  ${fieldName}: ${fieldType},\n`
  }
  content += '})\n\n'

  // Generate insertable schema
  content += `export const insertable_${snakeTable} = z.object({\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('insertable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType},\n`
  }
  content += '})\n\n'

  // Generate updateable schema
  content += `export const updateable_${snakeTable} = z.object({\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('updateable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType},\n`
  }
  content += '})\n\n'

  // Generate selectable schema
  content += `export const selectable_${snakeTable} = z.object({\n`
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field
    const fieldType = getType('selectable', desc, config, destination)
    content += `  ${fieldName}: ${fieldType},\n`
  }
  content += '})\n\n'

  // Generate type exports
  content += `export type ${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof ${snakeTable}>\n`
  content += `export type Insertable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof insertable_${snakeTable}>\n`
  content += `export type Updateable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof updateable_${snakeTable}>\n`
  content += `export type Selectable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof selectable_${snakeTable}>\n`

  return content
}
