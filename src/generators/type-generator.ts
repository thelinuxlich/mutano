/**
 * Core type generation logic
 */

import type { Config, Desc, Destination } from '../types/index.js'
import { 
  getTypeMappings, 
  isJsonType, 
  enumRegex 
} from '../types/mappings.js'
import { 
  extractZodExpression, 
  extractTSExpression, 
  extractKyselyExpression 
} from '../utils/magic-comments.js'

export type OperationType = 'table' | 'insertable' | 'updateable' | 'selectable'

/**
 * Generate the appropriate type for a database field
 */
export function getType(
  op: OperationType,
  desc: Desc,
  config: Config,
  destination: Destination,
  entityName?: string
): string {
  const { Default, Extra, Null, Type, DataType, Comment, EnumOptions } = desc
  const schemaType = config.origin.type
  // For Prisma, preserve case; for others, convert to lowercase
  const type = schemaType === 'prisma' ? Type : Type.toLowerCase()
  // Use DataType (normalized type from DB) for type category matching, fallback to Type
  let dataType = DataType ? (schemaType === 'prisma' ? DataType : DataType.toLowerCase()) : type
  
  // Handle MySQL tinyint(1) as boolean when tinyIntAsBoolean option is enabled (default true)
  const isMySQL = schemaType === 'mysql'
  const tinyIntAsBoolean = isMySQL && (config.origin as any).tinyIntAsBoolean !== false
  const isTinyInt1 = isMySQL && dataType === 'tinyint' && Type.toLowerCase().includes('(1)')
  if (tinyIntAsBoolean && isTinyInt1) {
    dataType = 'boolean'
  }
  
  const isNull = Null === 'YES'
  const hasDefaultValue = Default !== null
  const isGenerated = Extra.toLowerCase().includes('auto_increment') ||
                     Extra.toLowerCase().includes('default_generated')
  const isTsDestination = destination.type === 'ts'
  const isKyselyDestination = destination.type === 'kysely'
  const isZodDestination = destination.type === 'zod'

  const typeMappings = getTypeMappings(schemaType)

  const destKey = isZodDestination ? 'zod' : isTsDestination ? 'ts' : 'kysely'

  // Handle column overrides from config (highest priority)
  if (entityName && config.overrideColumns) {
    const destOverrides = config.overrideColumns[destKey]
    if (destOverrides && destOverrides[entityName] && destOverrides[entityName][desc.Field]) {
      const columnOverride = destOverrides[entityName][desc.Field]
      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)

      if (isZodDestination) {
        const nullishOption = (destination as any).nullish
        const nullableMethod = (nullishOption && op !== 'selectable') ? 'nullish' : 'nullable'
        return shouldBeNullable ? `${columnOverride}.${nullableMethod}()` : columnOverride
      } else {
        return shouldBeNullable ? `${columnOverride} | null` : columnOverride
      }
    }
  }

  // Handle magic comments (second priority)
  if (isZodDestination && config.magicComments) {
    const zodOverrideType = extractZodExpression(Comment)
    if (zodOverrideType) {
      // @zod magic comment completely overrides the previous type
      // No additional nullability, optionality, or default value modifications
      return zodOverrideType
    }
  }

  // Handle TypeScript magic comments
  if (isTsDestination && config.magicComments) {
    const tsOverrideType = extractTSExpression(Comment)
    if (tsOverrideType) {
      // @ts magic comment completely overrides the previous type
      // No additional nullability modifications
      return tsOverrideType
    }
  }

  // Handle Kysely magic comments
  if (isKyselyDestination && config.magicComments) {
    const kyselyOverrideType = extractKyselyExpression(Comment)
    if (kyselyOverrideType) {
      // @kysely magic comment completely overrides the previous type
      // No additional nullability modifications
      return kyselyOverrideType
    }

    // For Kysely, fall back to @ts if no @kysely
    const tsOverrideType = extractTSExpression(Comment)
    if (tsOverrideType) {
      return tsOverrideType
    }
  }

  // Handle override types from config (third priority)
  const overrideType = config.overrideTypes?.[destKey]?.[Type]

  if (overrideType) {
    const shouldBeNullable =
      isNull ||
      (['insertable', 'updateable'].includes(op) &&
        (hasDefaultValue || isGenerated)) ||
      (op === 'updateable' && !isNull && !hasDefaultValue)

    if (isZodDestination) {
      const nullishOption = (destination as any).nullish
      // For selectable schemas, always use .nullable() since DB fields are never undefined
      const nullableMethod = (nullishOption && op !== 'selectable') ? 'nullish' : 'nullable'
      return shouldBeNullable ? `${overrideType}.${nullableMethod}()` : overrideType
    } else {
      return shouldBeNullable ? `${overrideType} | null` : overrideType
    }
  }

  // Handle JSON types first for Kysely (includes json, jsonb)
  // Note: Use dataType (normalized type) instead of type to avoid matching enum('csv','json') as JSON
  if (isTsDestination || isKyselyDestination) {
    const isJsonField = isJsonType(dataType)
    if (isKyselyDestination && isJsonField) {
      // Default JSON handling
      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)
      return shouldBeNullable ? 'Json | null' : 'Json'
    }
  }

  // Handle enum types
  const enumTypesForSchema = typeMappings.enumTypes || []
  const isEnum = enumTypesForSchema.includes(dataType)

  // For Prisma, also check if the type exists in enumDeclarations
  const isPrismaEnum = schemaType === 'prisma' && config.enumDeclarations && config.enumDeclarations[type]

  if (isEnum || isPrismaEnum) {
    let enumValues: string[] = []

    if (schemaType === 'mysql' && dataType === 'enum') {
      const match = Type.match(enumRegex)
      if (match) {
        enumValues = match[1].split(',').map((v) => v.trim().replace(/'/g, ''))
      }
    } else if (schemaType === 'postgres' && EnumOptions) {
      enumValues = EnumOptions
    } else if (isPrismaEnum && config.enumDeclarations) {
      enumValues = config.enumDeclarations[type]
    }

    if (enumValues.length > 0) {
      // Determine if field should be nullable (can be null in database)
      const shouldBeNullable = isNull

      // Determine if field should be optional (can be omitted from input)
      const shouldBeOptional =
        (op === 'insertable' && (hasDefaultValue || isGenerated)) ||
        (op === 'updateable')

      if (isZodDestination) {
        const enumString = `z.enum([${enumValues.map((v) => `'${v}'`).join(',')}])`
        const nullishOption = (destination as any).nullish
        // For selectable schemas, always use .nullable() since DB fields are never undefined
        const nullableMethod = (nullishOption && op !== 'selectable') ? 'nullish' : 'nullable'

        // Handle default values for main, insertable, and updateable schemas (NOT selectable)
        // Note: selectable schemas should NOT have .default() because when selecting from DB,
        // you always get a value (either user-provided or DB default)
        if ((op === 'table' || op === 'insertable' || op === 'updateable') && hasDefaultValue && Default !== null && !isGenerated) {
          // Field has an explicit default value (not auto-generated)
          if (shouldBeNullable && shouldBeOptional) {
            // For updateable: nullable and optional with default at the end
            return `${enumString}.${nullableMethod}().default('${Default}')`
          } else if (shouldBeNullable) {
            return `${enumString}.${nullableMethod}().default('${Default}')`
          } else if (shouldBeOptional) {
            // For updateable: optional with default at the end
            return `${enumString}.optional().default('${Default}')`
          } else {
            return `${enumString}.default('${Default}')`
          }
        }

        if (shouldBeNullable && shouldBeOptional) {
          // Field is both nullable and optional
          return `${enumString}.${nullableMethod}()`
        } else if (shouldBeNullable) {
          // Field is nullable but required
          return `${enumString}.${nullableMethod}()`
        } else if (shouldBeOptional) {
          // Field is optional but not nullable (auto-generated fields)
          return `${enumString}.optional()`
        } else {
          // Field is required and not nullable
          return enumString
        }
      } else if (isTsDestination) {
        const enumString = enumValues.map((v) => `'${v}'`).join(' | ')

        if (shouldBeNullable) {
          return `${enumString} | null`
        } else {
          return enumString
        }
      } else if (isKyselyDestination) {
        const enumString = enumValues.map((v) => `'${v}'`).join(' | ')

        if (shouldBeNullable) {
          return `${enumString} | null`
        } else {
          return enumString
        }
      }
    }
  }

  // Handle other types based on type mappings
  return generateStandardType(op, desc, config, destination, typeMappings, dataType)
}

/**
 * Generate standard types based on type mappings
 */
function generateStandardType(
  op: OperationType,
  desc: Desc,
  config: Config,
  destination: Destination,
  typeMappings: ReturnType<typeof getTypeMappings>,
  dataType: string
): string {
  const { Default, Extra, Null, Type } = desc
  const schemaType = config.origin.type
  // For Prisma, preserve case; for others, convert to lowercase
  const type = schemaType === 'prisma' ? Type : Type.toLowerCase()
  const isNull = Null === 'YES'
  const hasDefaultValue = Default !== null
  const isGenerated = Extra.toLowerCase().includes('auto_increment') ||
                     Extra.toLowerCase().includes('default_generated')

  const isZodDestination = destination.type === 'zod'
  const isKyselyDestination = destination.type === 'kysely'

  // Determine if field should be nullable (can be null in database)
  const shouldBeNullable = isNull

  // Determine if field should be optional (can be omitted from input)
  const shouldBeOptional =
    (op === 'insertable' && (hasDefaultValue || isGenerated)) ||
    (op === 'updateable')

  let baseType: string

  // Determine base type
  if (typeMappings.dateTypes.includes(dataType)) {
    if (isZodDestination) {
      const useDateType = (destination as any).useDateType
      if (useDateType) {
        baseType = 'z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())'
      } else {
        baseType = 'z.date()'
      }
    } else {
      baseType = 'Date'
    }
  } else if (typeMappings.bigIntTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = 'z.string()'
    } else if (isKyselyDestination) {
      baseType = 'BigInt'
    } else {
      baseType = 'string'
    }
  } else if (typeMappings.decimalTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = 'z.string()'
      // Apply validation modifiers for decimal fields (similar to string fields)
      // Only apply validation modifiers to input schemas, not selectable schemas
      // Selectable schemas represent data from DB which is already validated/stored
      if (op !== 'selectable') {
        baseType += '.trim()'
        // For decimal fields with default values or nullable fields, don't add .min(1) validation
        if (!hasDefaultValue && !shouldBeNullable) {
          baseType += '.min(1)'
        }
      }
    } else if (isKyselyDestination) {
      baseType = 'Decimal'
    } else {
      baseType = 'string'
    }
  } else if (typeMappings.numberTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = 'z.number()'
      // Removed automatic .nonnegative() - integers can be negative
    } else {
      baseType = 'number'
    }
  } else if (typeMappings.booleanTypes.includes(dataType)) {
    if (isZodDestination) {
      const useBooleanType = (destination as any).useBooleanType
      if (useBooleanType) {
        baseType = 'z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())'
      } else {
        baseType = 'z.boolean()'
      }
    } else {
      baseType = 'boolean'
    }
  } else if (typeMappings.stringTypes.includes(dataType)) {
    if (isZodDestination) {
      const useTrim = (destination as any).useTrim
      const requiredString = (destination as any).requiredString
      baseType = 'z.string()'
      // Only apply validation modifiers to input schemas, not selectable schemas
      // Selectable schemas represent data from DB which is already validated/stored
      if (useTrim && op !== 'selectable') baseType += '.trim()'
      // For string fields with default values, don't add .min(1) validation
      if (requiredString && !shouldBeNullable && op !== 'selectable' &&
          !hasDefaultValue) baseType += '.min(1)'
    } else {
      baseType = 'string'
    }
  } else {
    // Default to string for unknown types
    baseType = isZodDestination ? 'z.string()' : 'string'
  }

  // Apply nullability and optionality
  if (isZodDestination) {
    const nullishOption = (destination as any).nullish
    // For selectable schemas, always use .nullable() since DB fields are never undefined
    const nullableMethod = (nullishOption && op !== 'selectable') ? 'nullish' : 'nullable'

    // Handle default values for main, insertable, and updateable schemas (NOT selectable)
    // Note: selectable schemas should NOT have .default() because when selecting from DB,
    // you always get a value (either user-provided or DB default)
    if ((op === 'table' || op === 'insertable' || op === 'updateable') && hasDefaultValue && Default !== null && !isGenerated) {
      // Field has an explicit default value (not auto-generated)
      // For non-enum types, we need to format the default value appropriately
      let defaultValueFormatted = Default

      // Handle different types of default values
      if (typeMappings.stringTypes.includes(dataType) || typeMappings.dateTypes.includes(dataType)) {
        defaultValueFormatted = `'${Default}'`
      } else if (typeMappings.booleanTypes.includes(dataType)) {
        defaultValueFormatted = Default.toLowerCase() === 'true' ? 'true' : 'false'
      } else if (typeMappings.numberTypes.includes(dataType)) {
        defaultValueFormatted = Default
      } else {
        // For other types, wrap in quotes
        defaultValueFormatted = `'${Default}'`
      }

      if (shouldBeNullable && shouldBeOptional) {
        // For updateable: nullable and optional with default at the end
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`
      } else if (shouldBeNullable) {
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`
      } else if (shouldBeOptional) {
        // For updateable: optional with default at the end
        return `${baseType}.optional().default(${defaultValueFormatted})`
      } else {
        return `${baseType}.default(${defaultValueFormatted})`
      }
    }

    // Special handling for date/datetime fields in main and selectable schemas
    const isDateField = typeMappings.dateTypes.includes(dataType)
    const shouldDateBeOptional = isDateField && (hasDefaultValue || isGenerated) && (op === 'table' || op === 'selectable')

    // Special handling for ID fields with autoincrement/auto-generation in main and selectable schemas
    const isIdField = typeMappings.numberTypes.includes(dataType) || typeMappings.bigIntTypes.includes(dataType) || typeMappings.stringTypes.includes(dataType)
    const shouldIdBeOptional = isIdField && isGenerated && (op === 'table' || op === 'selectable')

    if (shouldBeNullable && shouldBeOptional) {
      // Field is both nullable and optional
      return `${baseType}.${nullableMethod}()`
    } else if (shouldBeNullable) {
      // Field is nullable but required
      if (shouldDateBeOptional || shouldIdBeOptional) {
        return `${baseType}.${nullableMethod}().optional()`
      }
      return `${baseType}.${nullableMethod}()`
    } else if (shouldBeOptional) {
      // Field is optional but not nullable (auto-generated fields)
      return `${baseType}.optional()`
    } else if (shouldDateBeOptional || shouldIdBeOptional) {
      // Date field with default/auto-generated or ID field with autoincrement in main or selectable schema
      return `${baseType}.optional()`
    } else {
      // Field is required and not nullable
      return baseType
    }
  } else {
    // For TypeScript and Kysely, only handle nullability
    if (shouldBeNullable) {
      return `${baseType} | null`
    } else {
      return baseType
    }
  }
}
