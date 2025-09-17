import { describe, expect, test } from 'vitest'
import { type Desc, generateContent, defaultZodHeader } from '../main.js'

describe('Table Magic Comments', () => {
  test('should handle @zod magic comments in table columns', () => {
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
        Field: 'email',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '@zod(z.string().email().min(5).max(100))',
      },
      {
        Field: 'score',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'decimal',
        Comment: '@zod(z.number().min(0).max(100))',
      },
      {
        Field: 'metadata',
        Default: '{}',
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.record(z.string()))',
      },
    ]

    const config = {
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

    const content = generateContent({
      table: 'user',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // Check main schema
    expect(content).toContain('export const user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No .nonnegative()
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod magic comment completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod magic comment completely overrides (no .nullable())
    expect(content).toContain('metadata: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable().default())

    // Check insertable schema
    expect(content).toContain('export const insertable_user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No .nonnegative()
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod magic comment completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod magic comment completely overrides (no .nullable())
    expect(content).toContain('metadata: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable().default())

    // Check updateable schema
    expect(content).toContain('export const updateable_user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No .nonnegative()
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod magic comment completely overrides (no .optional())
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod magic comment completely overrides (no .nullable())
    expect(content).toContain('metadata: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable())

    // Check selectable schema
    expect(content).toContain('export const selectable_user = z.object({')
    expect(content).toContain('id: z.number()')  // No .nonnegative() and no .optional() for selectable
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod magic comment completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod magic comment completely overrides (no .nullable())
    expect(content).toContain('metadata: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable())

    // Check type exports
    expect(content).toContain('export type UserType = z.infer<typeof user>')
    expect(content).toContain('export type InsertableUserType = z.infer<typeof insertable_user>')
    expect(content).toContain('export type UpdateableUserType = z.infer<typeof updateable_user>')
    expect(content).toContain('export type SelectableUserType = z.infer<typeof selectable_user>')
  })

  test('should handle @ts magic comments in table columns', () => {
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
        Field: 'metadata',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(UserMetadata)',
      },
      {
        Field: 'settings',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'json',
        Comment: '@ts(Record<string, unknown>)',
      },
      {
        Field: 'profile',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'text',
        Comment: '@ts(UserProfile)',
      },
    ]

    const config = {
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
          type: 'ts' as const,
        },
      ],
      magicComments: true,
    }

    const content = generateContent({
      table: 'user',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// TypeScript interfaces for user')
    expect(content).toContain('export interface User {')
    expect(content).toContain('id: number;')
    expect(content).toContain('metadata: UserMetadata;')  // @ts magic comment completely overrides (no | null added)
    expect(content).toContain('settings: Record<string, unknown>;')  // @ts magic comment completely overrides
    expect(content).toContain('profile: UserProfile;')  // @ts magic comment completely overrides (no | null added)
  })

  test('should handle @kysely magic comments in table columns', () => {
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
        Field: 'data',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@kysely(CustomJsonType)',
      },
      {
        Field: 'config',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'text',
        Comment: '@kysely(ConfigObject)',
      },
      {
        Field: 'status',
        Default: 'ACTIVE',
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '@kysely(StatusType)',
      },
    ]

    const config = {
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
          type: 'kysely' as const,
        },
      ],
      magicComments: true,
    }

    const content = generateContent({
      table: 'system_config',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// Kysely type definitions for system_config')
    expect(content).toContain('export interface SystemConfig {')
    expect(content).toContain('id: Generated<number>;')
    expect(content).toContain('data: CustomJsonType;')  // @kysely magic comment completely overrides (no | null added)
    expect(content).toContain('config: ConfigObject;')  // @kysely magic comment completely overrides
    expect(content).toContain('status: StatusType;') // @kysely magic comment completely overrides (should NOT be wrapped in Generated<>)
    expect(content).toContain('export type SelectableSystemConfig = Selectable<SystemConfig>;')
    expect(content).toContain('export type InsertableSystemConfig = Insertable<SystemConfig>;')
    expect(content).toContain('export type UpdateableSystemConfig = Updateable<SystemConfig>;')
  })

  test('should handle multiple magic comments in single table column', () => {
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
        Field: 'complex_field',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(ComplexType) @kysely(KyselyComplexType) @zod(z.record(z.string()))',
      },
    ]

    // Test TypeScript output
    const tsConfig = {
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
          type: 'ts' as const,
        },
      ],
      magicComments: true,
    }

    const tsContent = generateContent({
      table: 'complex_table',
      describes,
      config: tsConfig,
      destination: tsConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(tsContent).toContain('complex_field: ComplexType;')  // @ts magic comment completely overrides (no | null added)

    // Test Kysely output
    const kyselyConfig = {
      ...tsConfig,
      destinations: [{ type: 'kysely' as const }],
    }

    const kyselyContent = generateContent({
      table: 'complex_table',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(kyselyContent).toContain('complex_field: KyselyComplexType;')  // @kysely magic comment completely overrides (no | null added)

    // Test Zod output
    const zodConfig = {
      ...tsConfig,
      destinations: [{ type: 'zod' as const }],
    }

    const zodContent = generateContent({
      table: 'complex_table',
      describes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(zodContent).toContain('complex_field: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable() added)
  })

  test('should handle magic comments with camelCase conversion in tables', () => {
    const describes: Desc[] = [
      {
        Field: 'user_id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'created_at',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'datetime',
        Comment: '@ts(CustomDate)',
      },
      {
        Field: 'metadata_json',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.record(z.string().min(1)))',
      },
    ]

    const config = {
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
          type: 'ts' as const,
        },
      ],
      magicComments: true,
    }

    const content = generateContent({
      table: 'activity_log',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: true, // Enable camelCase conversion
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('export interface ActivityLog {')
    expect(content).toContain('userId: number;') // camelCase field name
    expect(content).toContain('createdAt: CustomDate;') // camelCase field name with magic comment type
    expect(content).toContain('metadataJson: string | null;') // camelCase field name (JSON without magic comment becomes string)
  })

  test('should ignore magic comments when magicComments is disabled', () => {
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
        Field: 'data',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'json',
        Comment: '@ts(CustomType) @zod(z.record(z.string()))',
      },
    ]

    const config = {
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
      magicComments: false, // Disabled
    }

    const content = generateContent({
      table: 'test_table',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // Should use default JSON type, not magic comment type
    expect(content).toContain('data: z.string()') // JSON without magic comments becomes string in MySQL
    expect(content).not.toContain('z.record(z.string())')
  })

  test('should handle complex nested types in table magic comments', () => {
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
        Field: 'complex_data',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(Array<{ id: string; values: Record<string, number> }>)',
      },
    ]

    const config = {
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
          type: 'ts' as const,
        },
      ],
      magicComments: true,
    }

    const content = generateContent({
      table: 'analytics_table',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('complex_data: Array<{ id: string; values: Record<string, number> }>;')  // @ts magic comment completely overrides (no | null added)
  })

  test('should handle magic comments with default values correctly', () => {
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
        Field: 'status',
        Default: 'ACTIVE',
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '@kysely(StatusEnum)',
      },
      {
        Field: 'config',
        Default: '{}',
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@kysely(ConfigType)',
      },
    ]

    // Test Kysely with defaults and magic comments
    const kyselyConfig = {
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
          type: 'kysely' as const,
        },
      ],
      magicComments: true,
    }

    const kyselyContent = generateContent({
      table: 'settings',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // Magic comment should override type but NOT prevent Generated<> wrapping for defaults
    expect(kyselyContent).toContain('id: Generated<number>;')
    expect(kyselyContent).toContain('status: StatusEnum;') // Magic comment should prevent Generated<> wrapping
    expect(kyselyContent).toContain('config: ConfigType;') // @kysely magic comment completely overrides (no | null added)

    // Test Zod with defaults and magic comments
    const zodConfig = {
      ...kyselyConfig,
      destinations: [{ type: 'zod' as const }],
    }

    // Create a separate test data for Zod with proper @zod magic comment
    const zodDescribes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: 'auto_increment',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'status',
        Default: 'ACTIVE',
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '@zod(z.enum([\'ACTIVE\', \'INACTIVE\']))',
      },
      {
        Field: 'config',
        Default: '{}',
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.record(z.string()))',
      },
    ]

    const zodContent = generateContent({
      table: 'settings',
      describes: zodDescribes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(zodContent).toContain('config: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable().default())
    expect(zodContent).toContain('status: z.enum([\'ACTIVE\', \'INACTIVE\'])')  // @zod magic comment completely overrides (no .default())
  })
})
