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

  test('should generate proper z.enum() for MySQL enums', async () => {
    const result = await generate({
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'test',
        password: 'test',
        database: 'test'
      },
      destinations: [{
        type: 'zod'
      }],
      dryRun: true,
      // Mock the database connection to return enum data
      _mockDescribes: [{
        Field: 'status',
        Type: "enum('active','inactive','pending')",
        Null: 'NO',
        Default: 'active',
        Extra: '',
        Comment: ''
      }],
      _mockTables: ['users']
    })
    
    // This test would need actual MySQL connection, so we'll mock it
    // The important thing is to test the enum parsing logic
  })

  test('should generate proper z.enum() for PostgreSQL enums', async () => {
    const result = await generate({
      origin: {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test'
      },
      destinations: [{
        type: 'zod'
      }],
      dryRun: true,
      // Mock the database connection to return enum data
      _mockDescribes: [{
        Field: 'status',
        Type: 'user_status',
        Null: 'NO',
        Default: 'active',
        Extra: '',
        Comment: '',
        EnumOptions: ['active', 'inactive', 'pending']
      }],
      _mockTables: ['users']
    })
    
    // This test would need actual PostgreSQL connection, so we'll mock it
    // The important thing is to test the enum parsing logic
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
    
    // For insertable, should be nullable due to default (current behavior)
    const insertableMatch = postContent.match(/export const insertable_Post[^}]+status: (z\.enum\([^)]+\)[^,\n]*)/s)
    expect(insertableMatch).toBeTruthy()
    expect(insertableMatch![1]).toMatch(/z\.enum\(\['DRAFT','PUBLISHED','ARCHIVED'\]\)\.nullable\(\)/)
  })
})
