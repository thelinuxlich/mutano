/**
 * Mutano - Database schema to TypeScript/Zod/Kysely converter
 */

import * as path from 'node:path'
import camelCase from 'camelcase'
import { writeFile } from 'node:fs/promises'
import { ensureDir } from 'fs-extra/esm'
import type { Config, Desc } from './types/index.js'
import { filterTables, filterViews, createEntityList } from './utils/filters.js'
import { generateContent, generateViewContent } from './generators/content-generator.js'
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
import { defaultKyselyHeader, defaultZodHeader, kyselyJsonTypes } from './constants.js'
export {
  extractTypeExpression,
  extractTSExpression,
  extractKyselyExpression,
  extractZodExpression
} from './utils/magic-comments.js'
export type { Config, Desc, Destination } from './types/index.js'
export { generateContent, generateViewContent } from './generators/content-generator.js'
export { getType } from './generators/type-generator.js'
export { defaultKyselyHeader, defaultZodHeader }

export async function generate(config: Config): Promise<Record<string, string>> {
  let tables: string[] = []
  let views: string[] = []
  let enumDeclarations: Record<string, string[]> = {}
  let db: ReturnType<typeof createDatabaseConnection> | null = null

  try {
    if (config.origin.type === 'prisma') {
      const prismaEntities = extractPrismaEntities(config)
      tables = prismaEntities.tables
      views = prismaEntities.views
      enumDeclarations = prismaEntities.enumDeclarations
      config.enumDeclarations = enumDeclarations
    } else {
      db = createDatabaseConnection(config)
      tables = await extractTables(db, config)
      views = await extractViews(db, config)
    }
    tables = filterTables(tables, config.tables, config.ignore)
    if (!config.includeViews) {
      views = []
    } else {
      views = filterViews(views, config.views, config.ignoreViews)
    }
    const allEntities = createEntityList(tables, views)

    const results: Record<string, string> = {}
    const isCamelCase = config.camelCase === true
    const nonKyselyDestinations = config.destinations.filter((d) => d.type !== 'kysely')

    for (const entity of allEntities) {
      const { name: entityName, type: entityType } = entity

      let describes: Desc[]
      if (config.origin.type === 'prisma') {
        describes = extractPrismaColumnDescriptions(config, entityName, enumDeclarations)
      } else {
        describes = await extractColumnDescriptions(db!, config, entityName)
      }

      if (describes.length === 0) continue

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

        const suffix = destination.suffix === undefined ? destination.type : destination.suffix
        const folder = destination.folder || '.'
        const fileName = `${entityName}${suffix ? `.${suffix}`: ''}.ts`
        const filePath = path.join(folder, fileName)

        results[filePath] = (destination.header || '') + content
      }
    }

    const kyselyDestinations = config.destinations.filter((d) => d.type === 'kysely')

    for (const kyselyDestination of kyselyDestinations) {
      const header = kyselyDestination.header || defaultKyselyHeader
      const schemaName = kyselyDestination.schemaName || 'DB'

      let consolidatedContent = `${header}\n${kyselyJsonTypes}`
      const tableContents: Array<{ table: string; content: string }> = []

      for (const entity of allEntities) {
        const { name: entityName, type: entityType } = entity

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

      const outputFile = kyselyDestination.outFile ||
                        path.join(kyselyDestination.folder || '.', 'db.ts')

      results[outputFile] = consolidatedContent
    }

    if (config.dryRun) {
      return results
    }

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
    if (db) {
      await db.destroy()
    }
  }
}