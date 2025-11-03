/**
 * Prisma schema extraction utilities
 */

import { readFileSync } from 'node:fs'
import {
  type Attribute,
  type Enumerator,
  type Field,
  type Model,
  createPrismaSchemaBuilder,
} from '@mrleebo/prisma-ast'
import type { Config, Desc } from '../types/index.js'

/**
 * Extract tables and views from Prisma schema
 */
export function extractPrismaEntities(config: Config): {
  tables: string[]
  views: string[]
  enumDeclarations: Record<string, string[]>
} {
  if (config.origin.type !== 'prisma') {
    return { tables: [], views: [], enumDeclarations: {} }
  }

  const schemaContent = readFileSync(config.origin.path, 'utf-8')
  const schema = createPrismaSchemaBuilder(schemaContent)

  // Extract tables (models)
  const prismaModels = schema.findAllByType('model', {})
  const tables = prismaModels
    .filter((m): m is Model => m !== null)
    .filter((model: any) => {
      // Skip models with @@ignore attribute
      // The @@ignore attribute is stored in the properties array as an object attribute
      if (model.properties && Array.isArray(model.properties)) {
        return !model.properties.some(
          (prop: any) => prop.type === 'attribute' && prop.name === 'ignore' && prop.kind === 'object'
        )
      }
      return true
    })
    .map((model) => model.name)

  // Extract views
  const prismaViews = schema.findAllByType('view', {})
  const views = prismaViews
    .filter((v) => v !== null)
    .map((view) => view.name)

  // Extract enums
  const enumDeclarations: Record<string, string[]> = {}
  const prismaEnums = schema.findAllByType('enum', {})

  for (const prismaEnum of prismaEnums) {
    if (prismaEnum && 'name' in prismaEnum && 'enumerators' in prismaEnum) {
      const enumName = prismaEnum.name
      const enumerators = prismaEnum.enumerators as any[]

      // Check if enum has @@ignore attribute
      // The @@ignore attribute is stored in the enumerators array as an object attribute
      const hasEnumIgnore = enumerators.some(
        (item: any) => item.type === 'attribute' && item.name === 'ignore' && item.kind === 'object'
      )
      if (hasEnumIgnore) {
        continue // Skip this enum
      }

      // Filter out enum values with @ignore attribute and map values
      const filteredEnumValues = enumerators
        .filter((e: any) => {
          // Skip attributes (like @@ignore)
          if (e.type === 'attribute') {
            return false
          }
          // Check if enumerator has @ignore attribute
          if ('attributes' in e && e.attributes) {
            const hasIgnore = e.attributes.some((attr: Attribute) => attr.name === 'ignore')
            if (hasIgnore) {
              return false // Skip this enum value
            }
          }
          return true
        })
        .map((e: Enumerator) => {
          // Check for @map attribute
          if ('attributes' in e && e.attributes) {
            const mapAttr = e.attributes.find((attr: Attribute) => attr.name === 'map')
            if (mapAttr && mapAttr.args && mapAttr.args.length > 0) {
              const mapValue = mapAttr.args[0]
              if (typeof mapValue === 'object' && 'value' in mapValue) {
                // Remove quotes if present
                let cleanValue = String(mapValue.value)
                if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
                  cleanValue = cleanValue.slice(1, -1)
                }
                return cleanValue
              } else if (typeof mapValue === 'string') {
                return mapValue
              }
            }
          }
          // Fallback to enum name if no @map
          return e.name
        })

      enumDeclarations[enumName] = filteredEnumValues
    }
  }

  return { tables, views, enumDeclarations }
}

/**
 * Extract column descriptions from Prisma model or view
 */
export function extractPrismaColumnDescriptions(
  config: Config,
  entityName: string,
  enumDeclarations: Record<string, string[]>
): Desc[] {
  if (config.origin.type !== 'prisma') {
    return []
  }

  const schemaContent = readFileSync(config.origin.path, 'utf-8')
  const schema = createPrismaSchemaBuilder(schemaContent)

  // Try to find as model first, then as view
  let entity = schema.findByType('model', { name: entityName }) as any
  if (!entity) {
    entity = schema.findByType('view', { name: entityName }) as any
  }

  if (!entity || !('properties' in entity)) {
    return []
  }

  // Skip if model has @@ignore attribute
  if (entity.type === 'model' && entity.properties && Array.isArray(entity.properties)) {
    const hasIgnore = entity.properties.some(
      (prop: any) => prop.type === 'attribute' && prop.name === 'ignore' && prop.kind === 'object'
    )
    if (hasIgnore) {
      return []
    }
  }

  const fields = entity.properties.filter(
    (p: any): p is Field =>
      p.type === 'field' &&
      p.array !== true &&
      !p.attributes?.find((a: Attribute) => a.name === 'relation') &&
      !p.attributes?.find((a: Attribute) => a.name === 'ignore'),
  )

  return fields.map((field: any) => {
    let defaultGenerated = false
    let defaultValue: string | null = null

    // Check for default values and auto-generation
    if (field.attributes) {
      for (const attr of field.attributes) {
        if (attr.name === 'updatedAt') {
          // @updatedAt is auto-generated by Prisma
          defaultGenerated = true
        } else if (attr.name === 'default') {
          if (attr.args && attr.args.length > 0) {
            const arg = attr.args[0]
            if (typeof arg === 'object' && 'value' in arg) {
              if (typeof arg.value === 'object' && arg.value.type === 'function') {
                // Handle function calls like autoincrement(), cuid(), uuid(), now()
                const functionName = arg.value.name
                if (functionName === 'autoincrement' || functionName === 'cuid' || functionName === 'uuid' || functionName === 'now') {
                  defaultGenerated = true
                }
              } else if (typeof arg.value === 'string') {
                // Handle string/enum default values - remove extra quotes if present
                let cleanValue = arg.value
                if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
                  cleanValue = cleanValue.slice(1, -1)
                }
                defaultValue = cleanValue
              } else {
                defaultValue = String(arg.value)
              }
            } else if (typeof arg === 'string') {
              // Handle direct string values (for enum defaults like @default(USER))
              defaultValue = arg
            }
          }
        }
      }
    }

    // Determine if field is optional
    const isOptional = field.optional === true

    // Handle enum types for both models and views
    let enumOptions: string[] | undefined
    const fieldType = String(field.fieldType)

    if (enumDeclarations[fieldType]) {
      enumOptions = enumDeclarations[fieldType]
    }

    return {
      Field: field.name,
      Default: defaultValue,
      Extra: defaultGenerated ? 'auto_increment' : '',
      Null: isOptional ? 'YES' : 'NO',
      Type: fieldType,
      Comment: field.comment || '', // Extract comment from Prisma field
      EnumOptions: enumOptions,
    }
  })
}

/**
 * Check if Prisma schema has views enabled
 */
export function hasViewsEnabled(config: Config): boolean {
  if (config.origin.type !== 'prisma') {
    return false
  }

  try {
    const schemaContent = readFileSync(config.origin.path, 'utf-8')
    const schema = createPrismaSchemaBuilder(schemaContent)
    
    // Check if any generator has views in previewFeatures
    const generators = schema.findAllByType('generator', {})
    
    for (const generator of generators) {
      if (generator && 'assignments' in generator) {
        const previewFeatures = generator.assignments.find(
          (a: any) => a.key === 'previewFeatures'
        )
        
        if (previewFeatures && 'value' in previewFeatures) {
          const features = previewFeatures.value
          if (Array.isArray(features)) {
            return features.some((f) => 
              typeof f === 'string' && f.includes('views')
            )
          } else if (typeof features === 'string') {
            return features.includes('views')
          }
        }
      }
    }
    
    return false
  } catch (error) {
    return false
  }
}
