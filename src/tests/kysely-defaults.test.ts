import { describe, test, expect } from 'vitest'
import { generateContent } from '../generators/content-generator.js'
import type { Desc } from '../types/index.js'

describe('Kysely Default Values Tests', () => {
  test('should wrap fields with explicit default values in Generated<> for Kysely', () => {
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
        Default: 'DRAFT', // Explicit default value
        Extra: '',
        Null: 'NO',
        Type: 'enum',
        Comment: '',
      },
      {
        Field: 'name',
        Default: 'Anonymous', // Explicit default value
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '',
      },
      {
        Field: 'score',
        Default: '100', // Explicit default value
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'test',
      },
      destinations: [
        {
          type: 'kysely' as const,
          outFile: './kysely/db.ts',
        },
      ],
      camelCase: false,
      magicComments: false,
    }

    const content = generateContent({
      table: 'post',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader: () => '',
    })

    console.log('Generated Kysely content:')
    console.log(content)

    // Check that auto-increment field is wrapped in Generated<>
    expect(content).toMatch(/id: Generated<number>/)
    
    // Check that fields with explicit defaults should also be wrapped in Generated<>
    // Currently this will fail - we need to implement this feature
    expect(content).toMatch(/status: Generated<string>/) // Should be Generated<> for explicit default
    expect(content).toMatch(/name: Generated<string>/)   // Should be Generated<> for explicit default
    expect(content).toMatch(/score: Generated<number>/)  // Should be Generated<> for explicit default
  })

  test('should handle Prisma enums with defaults correctly in Kysely', () => {
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
        Default: 'DRAFT', // Explicit enum default value
        Extra: '',
        Null: 'NO',
        Type: 'Status', // Prisma enum type
        Comment: '',
      },
      {
        Field: 'priority',
        Default: null, // No default
        Extra: '',
        Null: 'NO',
        Type: 'Priority', // Prisma enum type
        Comment: '',
      },
    ]

    const config = {
      origin: {
        type: 'prisma' as const,
        path: './schema.prisma',
      },
      destinations: [
        {
          type: 'kysely' as const,
          outFile: './kysely/db.ts',
        },
      ],
      camelCase: false,
      magicComments: false,
    }

    const content = generateContent({
      table: 'task',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {
        Status: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
        Priority: ['LOW', 'MEDIUM', 'HIGH'],
      },
      defaultZodHeader: () => '',
    })

    console.log('Generated Prisma enum Kysely content:')
    console.log(content)

    // Check that auto-increment field is wrapped in Generated<>
    expect(content).toMatch(/id: Generated<string>/) // Prisma uses string for id

    // Check that enum with explicit default is wrapped in Generated<>
    expect(content).toMatch(/status: Generated<string>/) // Enum types are strings in Kysely for Prisma

    // Check that enum without default is NOT wrapped in Generated<>
    expect(content).toMatch(/priority: string/) // Enum types are strings in Kysely for Prisma
  })
})
