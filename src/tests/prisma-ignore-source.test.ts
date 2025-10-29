import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { generate } from '../main.js'
import { extractPrismaEntities, extractPrismaColumnDescriptions } from '../database/prisma.js'

describe('Prisma @ignore field and @@ignore model attributes', () => {
  const testSchemaPath = './test-ignore-source-schema.prisma'

  const testPrismaSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  password  String   @ignore
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
}

model AuditLog {
  id        Int      @id @default(autoincrement())
  action    String
  userId    Int
  timestamp DateTime @default(now())

  @@ignore
}

model InternalMetrics {
  id        Int      @id @default(autoincrement())
  metric    String
  value     Float
  recordedAt DateTime @default(now())

  @@ignore
}

enum UserRole {
  ADMIN
  USER
  GUEST
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

  describe('extractPrismaEntities', () => {
    test('should exclude models with @@ignore attribute', () => {
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

      const { tables } = extractPrismaEntities(config)

      // Should include User and Post
      expect(tables).toContain('User')
      expect(tables).toContain('Post')

      // Should NOT include models with @@ignore
      expect(tables).not.toContain('AuditLog')
      expect(tables).not.toContain('InternalMetrics')
    })

    test('should include all models when none have @@ignore', () => {
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

      const { tables } = extractPrismaEntities(config)

      // Should have exactly 2 tables (User and Post)
      expect(tables).toHaveLength(2)
    })
  })

  describe('extractPrismaColumnDescriptions', () => {
    test('should exclude fields with @ignore attribute', () => {
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
      const fields = extractPrismaColumnDescriptions(config, 'User', enumDeclarations)

      // Should include regular fields
      expect(fields.map(f => f.Field)).toContain('id')
      expect(fields.map(f => f.Field)).toContain('email')
      expect(fields.map(f => f.Field)).toContain('name')
      expect(fields.map(f => f.Field)).toContain('createdAt')

      // Should NOT include field with @ignore attribute
      expect(fields.map(f => f.Field)).not.toContain('password')
    })

    test('should include all fields when none have @source', () => {
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
      const fields = extractPrismaColumnDescriptions(config, 'Post', enumDeclarations)

      // Post model has no @source fields, so all should be included
      expect(fields.map(f => f.Field)).toContain('id')
      expect(fields.map(f => f.Field)).toContain('title')
      expect(fields.map(f => f.Field)).toContain('content')
      expect(fields.map(f => f.Field)).toContain('published')
      expect(fields.map(f => f.Field)).toContain('authorId')
      expect(fields.map(f => f.Field)).toContain('createdAt')
    })

    test('should not extract fields from ignored models', () => {
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
      const fields = extractPrismaColumnDescriptions(config, 'AuditLog', enumDeclarations)

      // Should return empty array for ignored model
      expect(fields).toHaveLength(0)
    })
  })

  describe('generate integration', () => {
    test('should not generate files for ignored models', async () => {
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

      const generatedFiles = Object.keys(result)

      // Should generate for User and Post
      expect(generatedFiles.some(f => f.includes('User'))).toBe(true)
      expect(generatedFiles.some(f => f.includes('Post'))).toBe(true)

      // Should NOT generate for ignored models
      expect(generatedFiles.some(f => f.includes('AuditLog'))).toBe(false)
      expect(generatedFiles.some(f => f.includes('InternalMetrics'))).toBe(false)
    })

    test('should exclude @ignore fields from generated schemas', async () => {
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

      // Should include regular fields
      expect(userContent).toContain('id: z.number()')
      expect(userContent).toContain('email: z.string()')
      expect(userContent).toContain('name: z.string().nullable()')

      // Should NOT include password field with @ignore
      expect(userContent).not.toContain('password')
    })

    test('should generate TypeScript interfaces without @ignore fields', async () => {
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

      // Should include regular fields
      expect(userContent).toContain('id: number;')
      expect(userContent).toContain('email: string;')
      expect(userContent).toContain('name: string | null;')

      // Should NOT include password field with @ignore
      expect(userContent).not.toContain('password')
    })
  })
})

