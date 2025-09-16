/**
 * Mutano - Database schema to TypeScript/Zod/Kysely converter
 * Refactored for better maintainability and modularity
 */

import * as path from 'node:path'
import camelCase from 'camelcase'
import { writeFile } from 'node:fs/promises'
import { ensureDir } from 'fs-extra/esm'

// Import types
import type { Config, Desc } from './types/index.js'

// Import utilities
import { filterTables, filterViews, createEntityList } from './utils/filters.js'

// Import generators
import { generateContent, generateViewContent } from './generators/content-generator.js'

// Import database utilities
import {
  createDatabaseConnection,
  extractTables,
  extractViews,
  extractColumnDescriptions
} from './database/connection.js'
import {
  extractPrismaEntities,
  extractPrismaColumnDescriptions
} from './database/prisma.js'

// Import constants
import { defaultKyselyHeader, defaultZodHeader, kyselyJsonTypes } from './constants.js'

// Re-export utilities for backward compatibility
export {
  extractTypeExpression,
  extractTSExpression,
  extractKyselyExpression,
  extractZodExpression
} from './utils/magic-comments.js'

// Re-export types for backward compatibility
export type { Config, Desc, Destination } from './types/index.js'

// Re-export generators for backward compatibility
export { generateContent, generateViewContent } from './generators/content-generator.js'

// Re-export type generator for backward compatibility
export { getType } from './generators/type-generator.js'

// Re-export constants for backward compatibility
export { defaultKyselyHeader, defaultZodHeader }

/**
 * Main generate function - orchestrates the entire schema generation process
 */
export async function generate(config: Config): Promise<Record<string, string>> {
  let tables: string[] = []
  let views: string[] = []
  let enumDeclarations: Record<string, string[]> = {}
  let db: ReturnType<typeof createDatabaseConnection> | null = null

  try {
    // Extract entities based on origin type
    if (config.origin.type === 'prisma') {
      const prismaEntities = extractPrismaEntities(config)
      tables = prismaEntities.tables
      views = prismaEntities.views
      enumDeclarations = prismaEntities.enumDeclarations
    } else {
      // Create database connection for non-Prisma origins
      db = createDatabaseConnection(config)

      // Extract tables and views from database
      tables = await extractTables(db, config)
      views = await extractViews(db, config)
    }

    // Apply filtering
    tables = filterTables(tables, config.tables, config.ignore)

    // Filter views (only include if explicitly enabled)
    if (!config.includeViews) {
      views = []
    } else {
      views = filterViews(views, config.views, config.ignoreViews)
    }

    // Create unified entity list
    const allEntities = createEntityList(tables, views)

    // Generate content for each entity
    const results: Record<string, string> = {}
    const isCamelCase = config.camelCase === true

    // Process non-Kysely destinations first
    const nonKyselyDestinations = config.destinations.filter((d) => d.type !== 'kysely')

    for (const entity of allEntities) {
      const { name: entityName, type: entityType } = entity

      // Extract column descriptions
      let describes: Desc[]
      if (config.origin.type === 'prisma') {
        describes = extractPrismaColumnDescriptions(config, entityName, enumDeclarations)
      } else {
        describes = await extractColumnDescriptions(db!, config, entityName)
      }

      if (describes.length === 0) continue

      // Generate content for each non-Kysely destination
      for (const destination of nonKyselyDestinations) {
        const content = entityType === 'view'
          ? generateViewContent({
              view: entityName,
              describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
              config,
              destination,
              isCamelCase,
              enumDeclarations,
              defaultZodHeader,
            })
          : generateContent({
              table: entityName,
              describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
              config,
              destination,
              isCamelCase,
              enumDeclarations,
              defaultZodHeader,
            })

        // Determine output file path
        const suffix = destination.suffix === undefined ? destination.type : destination.suffix
        const folder = destination.folder || '.'
        const fileName = `${entityName}${suffix ? `.${suffix}`: ''}.ts`
        const filePath = path.join(folder, fileName)

        results[filePath] = (destination.header || '') + content
      }
    }

    // Process Kysely destinations (consolidated output)
    const kyselyDestinations = config.destinations.filter((d) => d.type === 'kysely')

    for (const kyselyDestination of kyselyDestinations) {
      const header = kyselyDestination.header || defaultKyselyHeader
      const schemaName = kyselyDestination.schemaName || 'DB'

      // Start with the header and JSON type definitions
      let consolidatedContent = `${header}\n${kyselyJsonTypes}`

      // Generate content for each entity
      const tableContents: Array<{ table: string; content: string }> = []

      for (const entity of allEntities) {
        const { name: entityName, type: entityType } = entity

        // Extract column descriptions
        let describes: Desc[]
        if (config.origin.type === 'prisma') {
          describes = extractPrismaColumnDescriptions(config, entityName, enumDeclarations)
        } else {
          describes = await extractColumnDescriptions(db!, config, entityName)
        }

        if (describes.length === 0) continue

        const content = entityType === 'view'
          ? generateViewContent({
              view: entityName,
              describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
              config,
              destination: kyselyDestination,
              isCamelCase,
              enumDeclarations,
              defaultZodHeader,
            })
          : generateContent({
              table: entityName,
              describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
              config,
              destination: kyselyDestination,
              isCamelCase,
              enumDeclarations,
              defaultZodHeader,
            })

        tableContents.push({ table: entityName, content })
        consolidatedContent += content + '\n'
      }

      // Generate database interface
      consolidatedContent += `\n// Database Interface\nexport interface ${schemaName} {\n`

      const sortedTableEntries = tableContents
        .map(({ table, content }) => {
          const isView = content.includes('(view')
          const pascalTable = camelCase(table, { pascalCase: true }) + (isView ? 'View' : '')
          const tableKey = isCamelCase ? camelCase(table) : table
          return { tableKey, pascalTable, isView }
        })
        .sort((a, b) => a.tableKey.localeCompare(b.tableKey))

      for (const { tableKey, pascalTable } of sortedTableEntries) {
        consolidatedContent += `  ${tableKey}: ${pascalTable};\n`
      }

      consolidatedContent += '}\n'

      // Determine output file path
      const outputFile = kyselyDestination.outFile ||
                        path.join(kyselyDestination.folder || '.', 'db.ts')

      results[outputFile] = consolidatedContent
    }

    // Write files to disk or return content
    if (config.dryRun) {
      return results
    }

    // Write files to disk
    for (const [filePath, content] of Object.entries(results)) {
      const fullPath = path.resolve(filePath)
      await ensureDir(path.dirname(fullPath))
      await writeFile(fullPath, content)

      if (!config.silent) {
        console.log(`Created: ${filePath}`)
      }
    }

    return results

  } finally {
    // Clean up database connection
    if (db) {
      await db.destroy()
    }
  }
}