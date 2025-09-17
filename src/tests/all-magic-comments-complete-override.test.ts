import { describe, expect, test } from 'vitest'
import { type Desc, generateContent, defaultZodHeader } from '../main.js'

describe('All Magic Comments Complete Override', () => {
  test('should completely override types with @zod, @ts, and @kysely magic comments', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: 'auto_increment',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'nullable_field',
        Default: null,
        Extra: '',
        Null: 'YES',  // Nullable field
        Type: 'varchar',
        Comment: '@zod(z.string().min(1)) @ts(CustomString) @kysely(KyselyString)',
      },
      {
        Field: 'default_field',
        Default: 'default_value',  // Has default value
        Extra: '',
        Null: 'NO',  // Not nullable
        Type: 'varchar',
        Comment: '@zod(z.string().max(50)) @ts(LimitedString) @kysely(KyselyLimited)',
      },
      {
        Field: 'nullable_with_default',
        Default: 'test',  // Has default value
        Extra: '',
        Null: 'YES',  // Nullable field
        Type: 'text',
        Comment: '@zod(z.string().optional()) @ts(OptionalText) @kysely(KyselyOptional)',
      },
    ]

    // Test Zod output
    const zodConfig = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'zod' as const,
        },
      ],
      magicComments: true,
    }

    const zodContent = generateContent({
      table: 'test_table',
      describes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    console.log('Generated Zod content with complete override:', zodContent)

    // @zod magic comments should completely override without any modifications
    expect(zodContent).toContain('nullable_field: z.string().min(1)')  // No .nullable() added
    expect(zodContent).toContain('default_field: z.string().max(50)')  // No .default() added
    expect(zodContent).toContain('nullable_with_default: z.string().optional()')  // No .nullable().default() added

    // Test TypeScript output
    const tsConfig = {
      ...zodConfig,
      destinations: [{ type: 'ts' as const }],
    }

    const tsContent = generateContent({
      table: 'test_table',
      describes,
      config: tsConfig,
      destination: tsConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    console.log('Generated TypeScript content with complete override:', tsContent)

    // @ts magic comments should completely override without any modifications
    expect(tsContent).toContain('nullable_field: CustomString;')  // No | null added
    expect(tsContent).toContain('default_field: LimitedString;')  // No modifications
    expect(tsContent).toContain('nullable_with_default: OptionalText;')  // No | null added

    // Test Kysely output
    const kyselyConfig = {
      ...zodConfig,
      destinations: [{ type: 'kysely' as const }],
    }

    const kyselyContent = generateContent({
      table: 'test_table',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    console.log('Generated Kysely content with complete override:', kyselyContent)

    // @kysely magic comments should completely override without any modifications
    expect(kyselyContent).toContain('nullable_field: KyselyString;')  // No | null added
    expect(kyselyContent).toContain('default_field: KyselyLimited;')  // No Generated<> wrapper
    expect(kyselyContent).toContain('nullable_with_default: KyselyOptional;')  // No | null or Generated<> added
  })

  test('should handle complex nested types in all magic comments', () => {
    const describes: Desc[] = [
      {
        Field: 'complex_field',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.object({ nested: z.array(z.string()) }).nullable()) @ts(ComplexType | null) @kysely(KyselyComplex | null)',
      },
    ]

    const zodConfig = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'zod' as const,
        },
      ],
      magicComments: true,
    }

    const zodContent = generateContent({
      table: 'test',
      describes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // The complex magic comments should be used exactly as specified
    expect(zodContent).toContain('complex_field: z.object({ nested: z.array(z.string()) }).nullable()')

    // Test TypeScript
    const tsConfig = { ...zodConfig, destinations: [{ type: 'ts' as const }] }
    const tsContent = generateContent({
      table: 'test',
      describes,
      config: tsConfig,
      destination: tsConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(tsContent).toContain('complex_field: ComplexType | null;')

    // Test Kysely
    const kyselyConfig = { ...zodConfig, destinations: [{ type: 'kysely' as const }] }
    const kyselyContent = generateContent({
      table: 'test',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(kyselyContent).toContain('complex_field: KyselyComplex | null;')
  })
})
