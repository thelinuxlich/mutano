import { describe, test, expect } from 'vitest'
import { generateContent } from '../generators/content-generator.js'
import type { Config, Desc } from '../types/index.js'

describe('Global overrideTypes', () => {
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
      Field: 'metadata',
      Type: 'json',
      Null: 'YES',
      Default: null,
      Extra: '',
      Comment: ''
    }
  ]

  const defaultZodHeader = (v: 3 | 4) => `import { z } from 'zod';\n\n`

  test('should work as global option', () => {
    const config: Config = {
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test'
      },
      destinations: [{ type: 'zod' }],
      // Global overrideTypes
      overrideTypes: {
        zod: {
          json: 'z.record(z.unknown())'
        }
      }
    }

    const content = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'zod' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader
    })

    expect(content).toContain('metadata: z.record(z.unknown())')
  })

  test('should support all destination types', () => {
    const config: Config = {
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test'
      },
      destinations: [{ type: 'zod' }],
      overrideTypes: {
        zod: { json: 'z.record(z.string())' },
        ts: { json: 'Record<string, string>' },
        kysely: { json: 'CustomJson' }
      }
    }

    // Test Zod
    const zodContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'zod' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader
    })
    expect(zodContent).toContain('metadata: z.record(z.string())')

    // Test TypeScript
    const tsContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'ts' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader
    })
    expect(tsContent).toContain('metadata: Record<string, string> | null;')

    // Test Kysely
    const kyselyContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'kysely' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader
    })
    expect(kyselyContent).toContain('metadata: CustomJson | null;')
  })
})
