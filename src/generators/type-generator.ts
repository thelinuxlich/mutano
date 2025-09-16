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
  destination: Destination
): string {
  const { Default, Extra, Null, Type, Comment, EnumOptions } = desc
  const schemaType = config.origin.type
  // For Prisma, preserve case; for others, convert to lowercase
  const type = schemaType === 'prisma' ? Type : Type.toLowerCase()
  const isNull = Null === 'YES'
  const hasDefaultValue = Default !== null
  const isGenerated = Extra.toLowerCase().includes('auto_increment') ||
                     Extra.toLowerCase().includes('default_generated')
  const isTsDestination = destination.type === 'ts'
  const isKyselyDestination = destination.type === 'kysely'
  const isZodDestination = destination.type === 'zod'

  const typeMappings = getTypeMappings(schemaType)

  // Handle JSON types first for Kysely (includes json, jsonb)
  if (isTsDestination || isKyselyDestination) {
    const isJsonField = isJsonType(type)
    if (isKyselyDestination && isJsonField) {
      // Check for magic comments first
      if (config.magicComments) {
        const kyselyOverrideType = extractKyselyExpression(Comment)
        if (kyselyOverrideType) {
          const shouldBeNullable =
            isNull ||
            (['insertable', 'updateable'].includes(op) &&
              (hasDefaultValue || isGenerated)) ||
            (op === 'updateable' && !isNull && !hasDefaultValue)
          return shouldBeNullable
            ? kyselyOverrideType.includes('| null')
              ? kyselyOverrideType
              : `${kyselyOverrideType} | null`
            : kyselyOverrideType
        }
      }
      
      // Default JSON handling
      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)
      return shouldBeNullable ? 'Json | null' : 'Json'
    }
    
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

    // Handle TypeScript magic comments (also used as fallback for Kysely)
    if ((isTsDestination || isKyselyDestination) && config.magicComments) {
      const tsOverrideType = extractTSExpression(Comment)
      if (tsOverrideType) {
        const shouldBeNullable =
          isNull ||
          (['insertable', 'updateable'].includes(op) &&
            (hasDefaultValue || isGenerated)) ||
          (op === 'updateable' && !isNull && !hasDefaultValue)

        return shouldBeNullable
          ? tsOverrideType.includes('| null')
            ? tsOverrideType
            : `${tsOverrideType} | null`
          : tsOverrideType
      }
    }
  }

  // Handle Zod magic comments
  if (isZodDestination && config.magicComments) {
    const zodOverrideType = extractZodExpression(Comment)
    if (zodOverrideType) {
      const shouldBeNullable =
        isNull ||
        (['insertable', 'updateable'].includes(op) &&
          (hasDefaultValue || isGenerated)) ||
        (op === 'updateable' && !isNull && !hasDefaultValue)

      const nullishOption = (destination as any).nullish
      const nullableMethod = nullishOption ? 'nullish' : 'nullable'

      return shouldBeNullable
        ? zodOverrideType.includes(`.${nullableMethod}()`) ||
          zodOverrideType.includes('.optional()')
          ? zodOverrideType
          : `${zodOverrideType}.${nullableMethod}()`
        : zodOverrideType
    }
  }

  // Handle override types from config
  const overrideTypes = config.origin.overrideTypes as Record<string, string> | undefined
  if (overrideTypes && overrideTypes[Type]) {
    const overrideType = overrideTypes[Type]
    const shouldBeNullable =
      isNull ||
      (['insertable', 'updateable'].includes(op) &&
        (hasDefaultValue || isGenerated)) ||
      (op === 'updateable' && !isNull && !hasDefaultValue)

    if (isZodDestination) {
      const nullishOption = (destination as any).nullish
      const nullableMethod = nullishOption ? 'nullish' : 'nullable'
      return shouldBeNullable ? `${overrideType}.${nullableMethod}()` : overrideType
    } else {
      return shouldBeNullable ? `${overrideType} | null` : overrideType
    }
  }

  // Handle enum types
  const enumTypesForSchema = (typeMappings.enumTypes as any)[schemaType] || []
  const isEnum = enumTypesForSchema.includes(type)

  // For Prisma, also check if the type exists in enumDeclarations
  const isPrismaEnum = schemaType === 'prisma' && config.enumDeclarations && config.enumDeclarations[type]

  if (isEnum || isPrismaEnum) {
    let enumValues: string[] = []

    if (schemaType === 'mysql' && type === 'enum') {
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

        // Handle default values for insertable schemas
        if (op === 'insertable' && hasDefaultValue && Default !== null && !isGenerated) {
          // Field has an explicit default value (not auto-generated)
          if (shouldBeNullable) {
            const nullableMethod = nullishOption ? 'nullish' : 'nullable'
            return `${enumString}.${nullableMethod}().default('${Default}')`
          } else {
            return `${enumString}.default('${Default}')`
          }
        }

        if (shouldBeNullable && shouldBeOptional) {
          // Field is both nullable and optional
          const nullableMethod = nullishOption ? 'nullish' : 'nullable'
          return `${enumString}.${nullableMethod}()`
        } else if (shouldBeNullable) {
          // Field is nullable but required
          const nullableMethod = nullishOption ? 'nullish' : 'nullable'
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
  return generateStandardType(op, desc, config, destination, typeMappings)
}

/**
 * Generate standard types based on type mappings
 */
function generateStandardType(
  op: OperationType,
  desc: Desc,
  config: Config,
  destination: Destination,
  typeMappings: ReturnType<typeof getTypeMappings>
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
  if (typeMappings.dateTypes.includes(type)) {
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
  } else if (typeMappings.bigIntTypes.includes(type)) {
    if (isZodDestination) {
      baseType = 'z.string()'
    } else if (isKyselyDestination) {
      baseType = 'BigInt'
    } else {
      baseType = 'string'
    }
  } else if (typeMappings.decimalTypes.includes(type)) {
    if (isZodDestination) {
      baseType = 'z.string()'
    } else if (isKyselyDestination) {
      baseType = 'Decimal'
    } else {
      baseType = 'string'
    }
  } else if (typeMappings.numberTypes.includes(type)) {
    if (isZodDestination) {
      baseType = 'z.number()'
      if (!shouldBeNullable && !hasDefaultValue) {
        baseType += '.nonnegative()'
      }
    } else {
      baseType = 'number'
    }
  } else if (typeMappings.booleanTypes.includes(type)) {
    baseType = isZodDestination ? 'z.boolean()' : 'boolean'
  } else if (typeMappings.stringTypes.includes(type)) {
    if (isZodDestination) {
      const useTrim = (destination as any).useTrim
      const requiredString = (destination as any).requiredString
      baseType = 'z.string()'
      if (useTrim) baseType += '.trim()'
      if (requiredString && !shouldBeNullable) baseType += '.min(1)'
    } else {
      baseType = 'string'
    }
  } else {
    // Default to string for unknown types
    baseType = isZodDestination ? 'z.string()' : 'string'
  }

  // Apply nullability and optionality
  if (isZodDestination) {
    // Handle default values for insertable schemas (non-enum fields)
    if (op === 'insertable' && hasDefaultValue && Default !== null && !isGenerated) {
      // Field has an explicit default value (not auto-generated)
      // For non-enum types, we need to format the default value appropriately
      let defaultValueFormatted = Default

      // Handle different types of default values
      if (typeMappings.stringTypes.includes(type) || typeMappings.dateTypes.includes(type)) {
        defaultValueFormatted = `'${Default}'`
      } else if (typeMappings.booleanTypes.includes(type)) {
        defaultValueFormatted = Default.toLowerCase() === 'true' ? 'true' : 'false'
      } else if (typeMappings.numberTypes.includes(type)) {
        defaultValueFormatted = Default
      } else {
        // For other types, wrap in quotes
        defaultValueFormatted = `'${Default}'`
      }

      if (shouldBeNullable) {
        const nullishOption = (destination as any).nullish
        const nullableMethod = nullishOption ? 'nullish' : 'nullable'
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`
      } else {
        return `${baseType}.default(${defaultValueFormatted})`
      }
    }

    if (shouldBeNullable && shouldBeOptional) {
      // Field is both nullable and optional
      const nullishOption = (destination as any).nullish
      const nullableMethod = nullishOption ? 'nullish' : 'nullable'
      return `${baseType}.${nullableMethod}()`
    } else if (shouldBeNullable) {
      // Field is nullable but required
      const nullishOption = (destination as any).nullish
      const nullableMethod = nullishOption ? 'nullish' : 'nullable'
      return `${baseType}.${nullableMethod}()`
    } else if (shouldBeOptional) {
      // Field is optional but not nullable (auto-generated fields)
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
