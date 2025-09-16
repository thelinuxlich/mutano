import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { generate } from '../main.js'

describe('Prisma Views Integration', () => {
  const testSchemaPath = './test-schema.prisma'
  
  const testPrismaSchema = `
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["views"]
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  bio       String?
  status    UserStatus @default(ACTIVE)
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

enum UserStatus {
  ACTIVE
  INACTIVE
  PENDING
}

// Views for testing
view UserProfile {
  id        Int
  email     String
  name      String?
  bio       String?
  status    UserStatus
  postCount Int
}

view PostSummary {
  id        Int
  title     String
  published Boolean
  authorName String?
  createdAt DateTime
}

view UserStats {
  userId       Int
  totalPosts   Int
  publishedPosts Int
  averageViews Decimal?
}
`

  beforeAll(() => {
    // Create test Prisma schema file
    writeFileSync(testSchemaPath, testPrismaSchema)
  })

  afterAll(() => {
    // Clean up test file
    try {
      unlinkSync(testSchemaPath)
    } catch (error) {
      // Ignore if file doesn't exist
    }
  })

  test('should extract views from Prisma schema with previewFeatures', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'zod',
        folder: './generated'
      }],
      includeViews: true,
      dryRun: true
    })

    // Debug: log what files are actually generated
    console.log('Generated files:', Object.keys(result))

    // Should generate files for views
    expect(Object.keys(result)).toContain('generated/UserProfile.zod.ts')
    expect(Object.keys(result)).toContain('generated/PostSummary.zod.ts')
    expect(Object.keys(result)).toContain('generated/UserStats.zod.ts')
  })

  test('should generate Zod schemas for Prisma views', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      includeViews: true,
      dryRun: true
    })

    const userProfileContent = result['UserProfile.zod.ts']
    expect(userProfileContent).toContain('// View schema (read-only)')
    expect(userProfileContent).toContain('export const user_profile_view = z.object({')
    expect(userProfileContent).toContain('id: z.number()')
    expect(userProfileContent).toContain('email: z.string()')
    expect(userProfileContent).toContain('name: z.string().nullable()')
    expect(userProfileContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING'])") // Enum in view should remain enum
    expect(userProfileContent).toContain('export type UserProfileViewType = z.infer<typeof user_profile_view>')

    // Should not contain insertable/updateable schemas for views
    expect(userProfileContent).not.toContain('insertable_')
    expect(userProfileContent).not.toContain('updateable_')
  })

  test('should generate TypeScript interfaces for Prisma views', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'ts'
      }],
      includeViews: true,
      dryRun: true
    })

    // Debug: log what files are actually generated
    console.log('TS Generated files:', Object.keys(result))

    const postSummaryContent = result['PostSummary.ts.ts']
    expect(postSummaryContent).toContain('// TypeScript interface for PostSummary (view - read-only)')
    expect(postSummaryContent).toContain('export interface PostSummaryView {')
    expect(postSummaryContent).toContain('id: number;')
    expect(postSummaryContent).toContain('title: string;')
    expect(postSummaryContent).toContain('published: boolean;')
    expect(postSummaryContent).toContain('authorName: string | null;')
    expect(postSummaryContent).toContain('createdAt: Date;')

    // Should not contain insertable/updateable interfaces for views
    expect(postSummaryContent).not.toContain('InsertablePostSummary')
    expect(postSummaryContent).not.toContain('UpdateablePostSummary')
  })

  test('should generate Kysely types for Prisma views', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'kysely',
        outFile: 'db.ts'
      }],
      includeViews: true,
      dryRun: true
    })

    const kyselyContent = result['db.ts']
    expect(kyselyContent).toContain('// Kysely type definitions for UserStats (view)')
    expect(kyselyContent).toContain('export interface UserStatsView {')
    expect(kyselyContent).toContain('userId: number;')
    expect(kyselyContent).toContain('totalPosts: number;')
    expect(kyselyContent).toContain('publishedPosts: number;')
    expect(kyselyContent).toContain('averageViews: Decimal | null;')
    expect(kyselyContent).toContain('export type SelectableUserStatsView = Selectable<UserStatsView>;')
    
    // Should not contain insertable/updateable types for views
    expect(kyselyContent).not.toContain('InsertableUserStats')
    expect(kyselyContent).not.toContain('UpdateableUserStats')
  })

  test('should handle Prisma view filtering with views option', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      includeViews: true,
      views: ['UserProfile', 'PostSummary'], // Only include these views
      dryRun: true
    })

    // Should only generate specified views
    expect(Object.keys(result)).toContain('UserProfile.zod.ts')
    expect(Object.keys(result)).toContain('PostSummary.zod.ts')
    expect(Object.keys(result)).not.toContain('UserStats.zod.ts')
  })

  test('should handle Prisma view filtering with ignoreViews option', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      includeViews: true,
      ignoreViews: ['UserStats'], // Exclude this view
      dryRun: true
    })

    // Should generate all views except ignored ones
    expect(Object.keys(result)).toContain('UserProfile.zod.ts')
    expect(Object.keys(result)).toContain('PostSummary.zod.ts')
    expect(Object.keys(result)).not.toContain('UserStats.zod.ts')
  })

  test('should handle camelCase conversion for Prisma views', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'ts'
      }],
      includeViews: true,
      camelCase: true,
      dryRun: true
    })

    const userProfileContent = result['UserProfile.ts.ts']
    expect(userProfileContent).toContain('export interface UserProfileView {')
    expect(userProfileContent).toContain('postCount: number;') // camelCase conversion
    // Note: createdAt is not in the view definition, so we don't expect it
  })

  test('should detect when views are not enabled in previewFeatures', async () => {
    const schemaWithoutViews = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`
    const noViewsSchemaPath = './no-views-schema.prisma'
    writeFileSync(noViewsSchemaPath, schemaWithoutViews)

    try {
      const result = await generate({
        origin: {
          type: 'prisma',
          path: noViewsSchemaPath
        },
        destinations: [{
          type: 'zod'
        }],
        includeViews: true,
        dryRun: true
      })

      // Should not generate any view files when views are not enabled
      const viewFiles = Object.keys(result).filter(key => key.includes('View'))
      expect(viewFiles).toHaveLength(0)
    } finally {
      unlinkSync(noViewsSchemaPath)
    }
  })

  test('should handle Prisma views with enum fields', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      includeViews: true,
      dryRun: true
    })

    const userProfileContent = result['UserProfile.zod.ts']
    // Should properly handle enum types in views (enums should remain enums)
    expect(userProfileContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING'])")
  })

  test('should handle Prisma views with Decimal fields', async () => {
    const result = await generate({
      origin: {
        type: 'prisma',
        path: testSchemaPath
      },
      destinations: [{
        type: 'kysely',
        outFile: 'db.ts'
      }],
      includeViews: true,
      dryRun: true
    })

    const kyselyContent = result['db.ts']
    // Should properly handle Decimal types in views
    expect(kyselyContent).toContain('averageViews: Decimal | null;')
  })
})
