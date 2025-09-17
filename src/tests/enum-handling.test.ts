import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Enum Handling Tests', () => {
  test('should generate proper z.enum() for Prisma enums in models', async () => {
    // Create a temporary Prisma schema with enums
    const tempDir = join(tmpdir(), 'mutano-enum-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  ACTIVE
  INACTIVE
  PENDING
  SUSPENDED
}

enum UserRole {
  ADMIN
  USER
  MODERATOR
}

model User {
  id     Int        @id @default(autoincrement())
  name   String
  status UserStatus @default(ACTIVE)
  role   UserRole   @default(USER)
  email  String     @unique
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    const result = await generate({
      origin: {
        type: 'prisma',
        path: schemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      dryRun: true
    })
    
    const userContent = result['User.zod.ts']
    expect(userContent).toBeDefined()
    
    // Should generate proper z.enum() for Prisma enums, not z.string()
    expect(userContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING','SUSPENDED'])")
    expect(userContent).toContain("role: z.enum(['ADMIN','USER','MODERATOR'])")
    
    // Should NOT contain z.string() for enum fields
    expect(userContent).not.toMatch(/status:\s*z\.string\(\)/)
    expect(userContent).not.toMatch(/role:\s*z\.string\(\)/)
  })

  test('should handle nullable Prisma enums correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-nullable-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

model Task {
  id       Int       @id @default(autoincrement())
  title    String
  priority Priority? // Optional enum
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    const result = await generate({
      origin: {
        type: 'prisma',
        path: schemaPath
      },
      destinations: [{
        type: 'zod',
        nullish: true
      }],
      dryRun: true
    })
    
    const taskContent = result['Task.zod.ts']
    expect(taskContent).toBeDefined()
    
    // Should generate proper z.enum().nullish() for optional Prisma enums
    expect(taskContent).toContain("priority: z.enum(['LOW','MEDIUM','HIGH','URGENT']).nullish()")
    
    // Should NOT contain z.string() for enum fields
    expect(taskContent).not.toMatch(/priority:\s*z\.string\(\)/)
  })

  test('should handle Prisma enums in views correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-views-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["views"]
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  ACTIVE
  INACTIVE
  PENDING
}

model User {
  id     Int        @id @default(autoincrement())
  name   String
  status UserStatus @default(ACTIVE)
  email  String     @unique
}

view ActiveUsers {
  id     Int
  name   String
  status UserStatus  // Views can maintain enum types
  email  String
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    const result = await generate({
      origin: {
        type: 'prisma',
        path: schemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      includeViews: true,
      dryRun: true
    })
    
    // For models, should generate proper enum
    const userContent = result['User.zod.ts']
    expect(userContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING'])")
    
    // For views, enum fields should remain enums (Prisma views maintain enum constraints)
    const activeUsersContent = result['ActiveUsers.zod.ts']
    expect(activeUsersContent).toContain("status: z.enum(['ACTIVE','INACTIVE','PENDING'])")
  })

  test('should handle enum with default values correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-defaults-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Status {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model Post {
  id     Int    @id @default(autoincrement())
  title  String
  status Status @default(DRAFT)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    const result = await generate({
      origin: {
        type: 'prisma',
        path: schemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      dryRun: true
    })
    
    const postContent = result['Post.zod.ts']
    expect(postContent).toBeDefined()
    
    // Should generate proper z.enum() even with default values
    expect(postContent).toContain("status: z.enum(['DRAFT','PUBLISHED','ARCHIVED'])")
    
    // For insertable, should have default value due to @default(DRAFT) - snake_case naming
    const insertableMatch = postContent.match(/export const insertable_post[^}]+status: (z\.enum\([^)]+\)[^,\n]*)/s)
    expect(insertableMatch).toBeTruthy()
    expect(insertableMatch![1]).toMatch(/z\.enum\(\['DRAFT','PUBLISHED','ARCHIVED'\]\)\.optional\(\)\.default\('DRAFT'\)/)
  })

  test('should handle Prisma enums with @map attributes correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-map-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })

    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum CompanyType {
  sole_proprietorship
  limited_liability_company
  s_corporation                        @map("s-corporation")
  c_corporation                        @map("c-corporation")
  partnership
}

enum EventType {
  user_created                         @map("user.created")
  user_updated                         @map("user.updated")
  payment_sent                         @map("payment.sent")
  invoice_created                      @map("invoice.created")
}

model Company {
  id     Int         @id @default(autoincrement())
  name   String
  type   CompanyType @default(sole_proprietorship)
}

model Event {
  id     Int       @id @default(autoincrement())
  type   EventType
  data   String
}
`

    await writeFile(schemaPath, schemaContent)

    const result = await generate({
      origin: {
        type: 'prisma',
        path: schemaPath
      },
      destinations: [{
        type: 'zod'
      }],
      dryRun: true
    })

    const companyContent = result['Company.zod.ts']
    expect(companyContent).toBeDefined()

    const eventContent = result['Event.zod.ts']
    expect(eventContent).toBeDefined()

    // Should generate proper z.enum() with @map values, not Prisma enum names
    expect(companyContent).toContain("type: z.enum(['sole_proprietorship','limited_liability_company','s-corporation','c-corporation','partnership'])")
    expect(eventContent).toContain("type: z.enum(['user.created','user.updated','payment.sent','invoice.created'])")

    // Should NOT contain the Prisma enum names for mapped values
    expect(companyContent).not.toContain('s_corporation')
    expect(companyContent).not.toContain('c_corporation')
    expect(eventContent).not.toContain('user_created')
    expect(eventContent).not.toContain('payment_sent')

    // Should contain the mapped database values
    expect(companyContent).toContain('s-corporation')
    expect(companyContent).toContain('c-corporation')
    expect(eventContent).toContain('user.created')
    expect(eventContent).toContain('payment.sent')
  })
})
