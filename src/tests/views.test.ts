import { describe, expect, test } from 'vitest'
import { type Desc, generateViewContent, defaultZodHeader } from '../main.js'

describe('Views functionality', () => {
  test('should generate Zod schema for view (read-only)', () => {
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
        Field: 'name',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '',
      },
      {
        Field: 'email',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'varchar',
        Comment: '',
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
    }

    const content = generateViewContent({
      view: 'user_info',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// View schema (read-only)')
    expect(content).toContain('export const user_info_view = z.object({')
    expect(content).toContain('id: z.number()')
    expect(content).toContain('name: z.string()')
    expect(content).toContain('email: z.string().nullable()')
    expect(content).toContain('export type UserInfoViewType = z.infer<typeof user_info_view>')
    
    // Should not contain insertable/updateable schemas
    expect(content).not.toContain('insertable_')
    expect(content).not.toContain('updateable_')
  })

  test('should generate TypeScript interface for view (read-only)', () => {
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
        Field: 'total_amount',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'decimal',
        Comment: '',
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
    }

    const content = generateViewContent({
      view: 'order_summary',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// TypeScript interface for order_summary (view - read-only)')
    expect(content).toContain('export interface OrderSummaryView {')
    expect(content).toContain('id: number;')
    expect(content).toContain('total_amount: string | null;')
    
    // Should not contain insertable/updateable interfaces
    expect(content).not.toContain('InsertableOrderSummary')
    expect(content).not.toContain('UpdateableOrderSummary')
  })

  test('should generate Kysely interface for view (read-only)', () => {
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
        Field: 'profile_data',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '',
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
    }

    const content = generateViewContent({
      view: 'user_profile',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// Kysely type definitions for user_profile (view)')
    expect(content).toContain('export interface UserProfileView {')
    expect(content).toContain('user_id: number;')
    expect(content).toContain('profile_data: Json | null;')
    expect(content).toContain('export type SelectableUserProfileView = Selectable<UserProfileView>;')
    
    // Should not contain insertable/updateable types
    expect(content).not.toContain('InsertableUserProfile')
    expect(content).not.toContain('UpdateableUserProfile')
  })

  test('should handle camelCase conversion for views', () => {
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
        Comment: '',
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
    }

    const content = generateViewContent({
      view: 'user_activity_log',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: true,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('export interface UserActivityLogView {')
    expect(content).toContain('userId: number;')
    expect(content).toContain('createdAt: Date;')
  })
})
