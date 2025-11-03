import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { generate } from '../main.js'
import { extractPrismaEntities, extractPrismaColumnDescriptions } from '../database/prisma.js'

describe('Prisma enum @ignore and @@ignore attributes', () => {
  const testSchemaPath = './test-enum-ignore-schema.prisma'

  const testPrismaSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  USER
  GUEST
  INTERNAL @ignore
}

enum Status {
  ACTIVE
  INACTIVE
  PENDING
  SUSPENDED
  ARCHIVED @ignore
}

enum InternalStatus {
  PROCESSING
  COMPLETED
  FAILED
  
  @@ignore
}

enum DebugLevel {
  INFO
  WARN
  ERROR
  
  @@ignore
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  role      UserRole @default(USER)
  status    Status   @default(ACTIVE)
  priority  Priority @default(MEDIUM)
  createdAt DateTime @default(now())
}

model Task {
  id          Int      @id @default(autoincrement())
  title       String
  description String?
  priority    Priority
  createdAt   DateTime @default(now())
}
`

  beforeAll(() => {
    writeFileSync(testSchemaPath, testPrismaSchema)
  })

  afterAll(() => {
    try {
      unlinkSync(testSchemaPath)
    } catch (error) {
      // Ignore if file doesn't exist
    }
  })

  describe('extractPrismaEntities - enum handling', () => {
    test('should exclude enums with @@ignore attribute', () => {
      const config = {
        origin: {
          type: 'prisma' as const,
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'zod' as const,
          },
        ],
      }

      const { enumDeclarations } = extractPrismaEntities(config)

      // Should include enums without @@ignore
      expect(enumDeclarations).toHaveProperty('UserRole')
      expect(enumDeclarations).toHaveProperty('Status')
      expect(enumDeclarations).toHaveProperty('Priority')

      // Should NOT include enums with @@ignore
      expect(enumDeclarations).not.toHaveProperty('InternalStatus')
      expect(enumDeclarations).not.toHaveProperty('DebugLevel')
    })

    test('should exclude enum values with @ignore attribute', () => {
      const config = {
        origin: {
          type: 'prisma' as const,
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'zod' as const,
          },
        ],
      }

      const { enumDeclarations } = extractPrismaEntities(config)

      // UserRole should have ADMIN, USER, GUEST but NOT INTERNAL
      expect(enumDeclarations.UserRole).toEqual(['ADMIN', 'USER', 'GUEST'])
      expect(enumDeclarations.UserRole).not.toContain('INTERNAL')

      // Status should have ACTIVE, INACTIVE, PENDING, SUSPENDED but NOT ARCHIVED
      expect(enumDeclarations.Status).toEqual(['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED'])
      expect(enumDeclarations.Status).not.toContain('ARCHIVED')

      // Priority should have all values (no @ignore)
      expect(enumDeclarations.Priority).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    })

    test('should handle enums with all values ignored', () => {
      const schemaWithAllIgnored = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum EmptyEnum {
  VALUE1 @ignore
  VALUE2 @ignore
  VALUE3 @ignore
}

model Test {
  id Int @id
}
`
      const tempPath = './test-all-ignored-enum.prisma'
      writeFileSync(tempPath, schemaWithAllIgnored)

      try {
        const config = {
          origin: {
            type: 'prisma' as const,
            path: tempPath,
          },
          destinations: [
            {
              type: 'zod' as const,
            },
          ],
        }

        const { enumDeclarations } = extractPrismaEntities(config)

        // Enum should exist but have no values
        expect(enumDeclarations).toHaveProperty('EmptyEnum')
        expect(enumDeclarations.EmptyEnum).toEqual([])
      } finally {
        unlinkSync(tempPath)
      }
    })
  })

  describe('generate integration - enum ignore', () => {
    test('should generate schemas with filtered enum values', async () => {
      const result = await generate({
        origin: {
          type: 'prisma',
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'zod',
          },
        ],
        dryRun: true,
      })

      const userContent = result['User.zod.ts']

      // UserRole should not include INTERNAL
      expect(userContent).toContain("role: z.enum(['ADMIN','USER','GUEST'])")
      expect(userContent).not.toContain('INTERNAL')

      // Status should not include ARCHIVED
      expect(userContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING','SUSPENDED'])")
      expect(userContent).not.toContain('ARCHIVED')

      // Priority should include all values
      expect(userContent).toContain("priority: z.enum(['LOW','MEDIUM','HIGH','URGENT'])")
    })

    test('should not reference ignored enums in generated code', async () => {
      const result = await generate({
        origin: {
          type: 'prisma',
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'zod',
          },
        ],
        dryRun: true,
      })

      const allContent = Object.values(result).join('\n')

      // Should not contain references to ignored enums
      expect(allContent).not.toContain('InternalStatus')
      expect(allContent).not.toContain('DebugLevel')
    })

    test('should generate TypeScript with filtered enum values', async () => {
      const result = await generate({
        origin: {
          type: 'prisma',
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'ts',
          },
        ],
        dryRun: true,
      })

      const userContent = result['User.ts.ts']

      // Should have filtered enum values in TypeScript types (using single quotes)
      expect(userContent).toContain("role: 'ADMIN' | 'USER' | 'GUEST'")
      expect(userContent).not.toContain('INTERNAL')

      expect(userContent).toContain("status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED'")
      expect(userContent).not.toContain('ARCHIVED')
    })

    test('should handle enum default values with ignored enum values', async () => {
      const result = await generate({
        origin: {
          type: 'prisma',
          path: testSchemaPath,
        },
        destinations: [
          {
            type: 'zod',
          },
        ],
        dryRun: true,
      })

      const userContent = result['User.zod.ts']

      // Default values should still work even with ignored enum values
      // role has @default(USER) - USER is not ignored
      expect(userContent).toMatch(/role:\s*z\.enum\(\['ADMIN','USER','GUEST'\]\)\.optional\(\)\.default\('USER'\)/)

      // status has @default(ACTIVE) - ACTIVE is not ignored
      expect(userContent).toMatch(/status:\s*z\.enum\(\['ACTIVE','INACTIVE','PENDING','SUSPENDED'\]\)\.optional\(\)\.default\('ACTIVE'\)/)
    })
  })

  describe('edge cases', () => {
    test('should handle enum with @ignore in middle of values', () => {
      const schemaWithMiddleIgnore = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum TestEnum {
  FIRST
  SECOND @ignore
  THIRD
  FOURTH @ignore
  FIFTH
}

model Test {
  id    Int      @id
  value TestEnum
}
`
      const tempPath = './test-middle-ignore-enum.prisma'
      writeFileSync(tempPath, schemaWithMiddleIgnore)

      try {
        const config = {
          origin: {
            type: 'prisma' as const,
            path: tempPath,
          },
          destinations: [
            {
              type: 'zod' as const,
            },
          ],
        }

        const { enumDeclarations } = extractPrismaEntities(config)

        // Should only have non-ignored values
        expect(enumDeclarations.TestEnum).toEqual(['FIRST', 'THIRD', 'FIFTH'])
      } finally {
        unlinkSync(tempPath)
      }
    })
  })
})

