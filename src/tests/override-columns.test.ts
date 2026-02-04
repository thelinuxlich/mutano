import { describe, test, expect } from 'vitest'
import { generateContent, generateViewContent } from '../generators/content-generator.js'
import type { Config, Desc } from '../types/index.js'

describe('Override Columns Feature', () => {
  const baseConfig: Config = {
    origin: {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'test'
    },
    destinations: [{ type: 'zod' }]
  }

  const describes: Desc[] = [
    {
      Field: 'id',
      Type: 'int',
      Null: 'NO',
      Default: null,
      Extra: 'auto_increment',
      Comment: ''
    },
    {
      Field: 'email',
      Type: 'varchar(255)',
      Null: 'NO',
      Default: null,
      Extra: '',
      Comment: ''
    },
    {
      Field: 'metadata',
      Type: 'json',
      Null: 'YES',
      Default: null,
      Extra: '',
      Comment: ''
    }
  ]

  const defaultZodHeader = (v: 3 | 4) => `import { z } from 'zod';\n\n`

  describe('Zod output', () => {
    test('should override specific column with custom type', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                metadata: 'z.record(z.unknown())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('metadata: z.record(z.unknown())')
      // Other columns should use default types
      expect(content).toContain('email: z.string()')
      expect(content).toContain('id: z.number()')
    })

    test('should apply nullability to overridden columns', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                metadata: 'z.record(z.unknown())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // metadata is nullable in the schema, so should have .nullable()
      expect(content).toContain('metadata: z.record(z.unknown()).nullable()')
    })

    test('should override multiple columns', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                email: 'z.string().email()',
                metadata: 'z.record(z.any())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('email: z.string().email()')
      expect(content).toContain('metadata: z.record(z.any()).nullable()')
    })
  })

  describe('TypeScript output', () => {
    test('should override specific column with custom type', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            ts: {
              users: {
                metadata: 'Record<string, unknown>'
              }
            }
          }
        },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('metadata: Record<string, unknown> | null;')
      expect(content).toContain('email: string;')
    })

    test('should apply nullability to overridden columns', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            ts: {
              users: {
                email: 'EmailAddress'
              }
            }
          }
        },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // email is NOT nullable
      expect(content).toContain('email: EmailAddress;')
      // metadata IS nullable
      expect(content).toContain('metadata: string | null;')
    })
  })

  describe('Kysely output', () => {
    test('should override specific column with custom type', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            kysely: {
              users: {
                metadata: 'CustomJson'
              }
            }
          }
        },
        destination: { type: 'kysely' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('metadata: CustomJson | null;')
      expect(content).toContain('email: string;')
    })
  })

  describe('Priority over magic comments', () => {
    test('should take priority over @zod magic comments', () => {
      const describesWithComment: Desc[] = [
        {
          Field: 'metadata',
          Type: 'json',
          Null: 'YES',
          Default: null,
          Extra: '',
          Comment: '@zod(z.object({}))'  // Magic comment
        }
      ]

      const content = generateContent({
        table: 'users',
        describes: describesWithComment,
        config: {
          ...baseConfig,
          magicComments: true,
          overrideColumns: {
            zod: {
              users: {
                metadata: 'z.record(z.unknown())'  // Should override magic comment
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('metadata: z.record(z.unknown())')
      expect(content).not.toContain('z.object({})')
    })
  })

  describe('Multiple tables', () => {
    test('should support different overrides for different tables', () => {
      const content1 = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                metadata: 'z.record(z.string())'
              },
              posts: {
                metadata: 'z.record(z.number())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content1).toContain('metadata: z.record(z.string())')

      const content2 = generateContent({
        table: 'posts',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                metadata: 'z.record(z.string())'
              },
              posts: {
                metadata: 'z.record(z.number())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content2).toContain('metadata: z.record(z.number())')
    })
  })

  describe('Views', () => {
    test('should work with views', () => {
      
      const content = generateViewContent({
        view: 'user_profiles',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              user_profiles: {
                metadata: 'z.record(z.unknown())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('metadata: z.record(z.unknown())')
    })
  })

  describe('Edge cases', () => {
    test('should ignore columns not in overrideColumns', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              other_table: {  // Different table
                metadata: 'z.record(z.unknown())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Should use default type since override is for different table
      expect(content).toContain('metadata: z.string().nullable()')
    })

    test('should ignore columns not specified in override', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: {
          ...baseConfig,
          overrideColumns: {
            zod: {
              users: {
                // Only overriding metadata, not email
                metadata: 'z.record(z.unknown())'
              }
            }
          }
        },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // email should use default
      expect(content).toContain('email: z.string()')
      // metadata should be overridden
      expect(content).toContain('metadata: z.record(z.unknown())')
    })
  })
})
