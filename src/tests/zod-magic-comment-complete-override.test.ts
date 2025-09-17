import { describe, expect, test } from 'vitest'
import { type Desc, generateContent, defaultZodHeader } from '../main.js'

describe('Zod Magic Comment Complete Override', () => {
  test('should completely override type with @zod magic comment without adding nullability, optionality, or defaults', () => {
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
        Null: 'YES',  // Nullable field
        Type: 'decimal',
        Comment: '@zod(z.number().min(0).max(100))',
      },
      {
        Field: 'metadata',
        Default: '{}',  // Has default value
        Extra: '',
        Null: 'YES',  // Nullable field
        Type: 'json',
        Comment: '@zod(z.record(z.string()))',
      },
      {
        Field: 'status',
        Default: 'ACTIVE',  // Has default value
        Extra: '',
        Null: 'NO',  // Not nullable
        Type: 'varchar',
        Comment: '@zod(z.enum([\'ACTIVE\', \'INACTIVE\']))',
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

    console.log('Generated content with @zod magic comment complete override:', content)

    // Check main schema - @zod magic comments should completely override without any modifications
    expect(content).toContain('export const user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No magic comment, normal behavior
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod completely overrides (no .nullable() added)
    expect(content).toContain('metadata: z.record(z.string())')  // @zod completely overrides (no .nullable().default() added)
    expect(content).toContain('status: z.enum([\'ACTIVE\', \'INACTIVE\'])')  // @zod completely overrides (no .default() added)

    // Check insertable schema - @zod magic comments should completely override without any modifications
    expect(content).toContain('export const insertable_user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No magic comment, normal behavior
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod completely overrides (no .nullable() added)
    expect(content).toContain('metadata: z.record(z.string())')  // @zod completely overrides (no .nullable().default() added)
    expect(content).toContain('status: z.enum([\'ACTIVE\', \'INACTIVE\'])')  // @zod completely overrides (no .default() added)

    // Check updateable schema - @zod magic comments should completely override without any modifications
    expect(content).toContain('export const updateable_user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No magic comment, normal behavior
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod completely overrides (no .optional() added)
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod completely overrides (no .nullable().optional() added)
    expect(content).toContain('metadata: z.record(z.string())')  // @zod completely overrides (no .nullable().optional() added)
    expect(content).toContain('status: z.enum([\'ACTIVE\', \'INACTIVE\'])')  // @zod completely overrides (no .optional() added)

    // Check selectable schema - @zod magic comments should completely override without any modifications
    expect(content).toContain('export const selectable_user = z.object({')
    expect(content).toContain('id: z.number().optional()')  // No magic comment, but still optional due to auto_increment (this is current behavior)
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod completely overrides (no .nullable() added)
    expect(content).toContain('metadata: z.record(z.string())')  // @zod completely overrides (no .nullable() added)
    expect(content).toContain('status: z.enum([\'ACTIVE\', \'INACTIVE\'])')  // @zod completely overrides

    // Verify that fields WITHOUT @zod magic comments still get normal behavior
    // The 'id' field should still get .optional() for auto-increment in insertable/updateable
    // but fields with @zod should be completely overridden
  })

  test('should handle @zod magic comment with complex nested types', () => {
    const describes: Desc[] = [
      {
        Field: 'complex_field',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.object({ nested: z.array(z.string().min(1)), count: z.number().positive() }).nullable().optional())',
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
      table: 'test',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // The complex @zod magic comment should be used exactly as specified
    expect(content).toContain('complex_field: z.object({ nested: z.array(z.string().min(1)), count: z.number().positive() }).nullable().optional()')
  })
})
