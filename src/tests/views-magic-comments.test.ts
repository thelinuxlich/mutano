import { describe, expect, test } from 'vitest'
import { type Desc, generateViewContent, defaultZodHeader } from '../main.js'

describe('Views with Magic Comments', () => {
  test('should handle @zod magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'user_scores',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// View schema (read-only)')
    expect(content).toContain('export const user_scores_view = z.object({')
    expect(content).toContain('id: z.number()')
    expect(content).toContain('email: z.string().email().min(5).max(100)')
    expect(content).toContain('score: z.number().min(0).max(100).nullable()')
    expect(content).toContain('export type UserScoresViewType = z.infer<typeof user_scores_view>')
  })

  test('should handle @ts magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'user_data',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// TypeScript interface for user_data (view - read-only)')
    expect(content).toContain('export interface UserDataView {')
    expect(content).toContain('id: number;')
    expect(content).toContain('metadata: UserMetadata | null;')
    expect(content).toContain('settings: Record<string, unknown>;')
  })

  test('should handle @kysely magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'system_config',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// Kysely type definitions for system_config (view)')
    expect(content).toContain('export interface SystemConfigView {')
    expect(content).toContain('id: number;')
    expect(content).toContain('data: CustomJsonType | null;')
    expect(content).toContain('config: ConfigObject;')
    expect(content).toContain('export type SelectableSystemConfigView = Selectable<SystemConfigView>;')
  })

  test('should handle multiple magic comments in single view column', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: true,
    }

    const tsContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: tsConfig,
      destination: tsConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(tsContent).toContain('complex_field: ComplexType | null;')

    // Test Kysely output
    const kyselyConfig = {
      ...tsConfig,
      destinations: [{ type: 'kysely' as const }],
    }

    const kyselyContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(kyselyContent).toContain('complex_field: KyselyComplexType | null;')

    // Test Zod output
    const zodConfig = {
      ...tsConfig,
      destinations: [{ type: 'zod' as const }],
    }

    const zodContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(zodContent).toContain('complex_field: z.record(z.string()).nullable()')
  })

  test('should handle magic comments with camelCase conversion in views', () => {
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
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'activity_log',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: true, // Enable camelCase conversion
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('export interface ActivityLogView {')
    expect(content).toContain('userId: number;') // camelCase field name
    expect(content).toContain('createdAt: CustomDate;') // camelCase field name with magic comment type
    expect(content).toContain('metadataJson: string | null;') // camelCase field name (JSON without magic comment becomes string)
  })

  test('should ignore magic comments when magicComments is disabled', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: false, // Disabled
    }

    const content = generateViewContent({
      view: 'test_view',
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

  test('should handle complex nested types in view magic comments', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
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
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'analytics_view',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('complex_data: Array<{ id: string; values: Record<string, number> }> | null;')
  })
})
