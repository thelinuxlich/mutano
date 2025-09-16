import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Enum Default Values Tests', () => {
  test('should handle enum with default value - insertable should be optional', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-default-test-' + Date.now())
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
    
    console.log('Generated content:', postContent)
    
    // Main schema should have required enum
    expect(postContent).toContain("status: z.enum(['DRAFT','PUBLISHED','ARCHIVED'])")
    
    // Insertable should have default value (not just optional) due to @default(DRAFT) - snake_case naming
    expect(postContent).toMatch(/insertable_post[^}]+status:\s*z\.enum\(\['DRAFT','PUBLISHED','ARCHIVED'\]\)\.default\('DRAFT'\)/)

    // Updateable should be optional (can be updated or not) - snake_case naming
    expect(postContent).toMatch(/updateable_post[^}]+status:\s*z\.enum\(\['DRAFT','PUBLISHED','ARCHIVED'\]\)\.optional\(\)/)

    // Selectable should NOT have defaults - when selecting from DB, you always get a value
    expect(postContent).toMatch(/selectable_post[^}]+status:\s*z\.enum\(\['DRAFT','PUBLISHED','ARCHIVED'\]\)/)
  })

  test('should handle nullable enum with default value', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-nullable-default-test-' + Date.now())
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
}

model Task {
  id       Int       @id @default(autoincrement())
  title    String
  priority Priority? @default(MEDIUM)
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
    
    console.log('Generated nullable enum content:', taskContent)
    
    // Main schema should have nullish enum (nullable field)
    expect(taskContent).toContain("priority: z.enum(['LOW','MEDIUM','HIGH']).nullish()")
    
    // Insertable should be nullish (optional due to default, nullable due to field definition) - snake_case naming
    expect(taskContent).toMatch(/insertable_task[^}]+priority:\s*z\.enum\(\['LOW','MEDIUM','HIGH'\]\)\.nullish\(\)\.default\('MEDIUM'\)/)
  })

  test('should handle enum without default value - insertable should be required', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-no-default-test-' + Date.now())
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

enum UserRole {
  ADMIN
  USER
  MODERATOR
}

model User {
  id   Int      @id @default(autoincrement())
  name String
  role UserRole
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
    
    console.log('Generated no-default enum content:', userContent)
    
    // Main schema should have required enum
    expect(userContent).toContain("role: z.enum(['ADMIN','USER','MODERATOR'])")
    
    // Insertable should be required (no default value) - snake_case naming
    expect(userContent).toMatch(/insertable_user[^}]+role:\s*z\.enum\(\['ADMIN','USER','MODERATOR'\]\)(?!\.(optional|nullable|nullish))/)

    // Updateable should be optional (can be updated or not) - snake_case naming
    expect(userContent).toMatch(/updateable_user[^}]+role:\s*z\.enum\(\['ADMIN','USER','MODERATOR'\]\)\.optional\(\)/)
  })

  test('should handle multiple enums with different default scenarios', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-mixed-test-' + Date.now())
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
  ACTIVE
  INACTIVE
}

enum Priority {
  LOW
  HIGH
}

model Item {
  id       Int      @id @default(autoincrement())
  name     String
  status   Status   @default(ACTIVE)  // Has default
  priority Priority                   // No default
  category Status?                    // Nullable, no default
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
    
    const itemContent = result['Item.zod.ts']
    expect(itemContent).toBeDefined()
    
    console.log('Generated mixed enum content:', itemContent)
    
    // Main schema validations
    expect(itemContent).toContain("status: z.enum(['ACTIVE','INACTIVE'])")  // Required with default
    expect(itemContent).toContain("priority: z.enum(['LOW','HIGH'])")       // Required no default
    expect(itemContent).toContain("category: z.enum(['ACTIVE','INACTIVE']).nullish()") // Nullable
    
    // Insertable validations - snake_case naming
    expect(itemContent).toMatch(/insertable_item[^}]+status:\s*z\.enum\(\['ACTIVE','INACTIVE'\]\)\.default\('ACTIVE'\)/)  // Default value due to @default(ACTIVE)
    expect(itemContent).toMatch(/insertable_item[^}]+priority:\s*z\.enum\(\['LOW','HIGH'\]\)(?!\.(optional|nullable|nullish|default))/)  // Required (no default)
    expect(itemContent).toMatch(/insertable_item[^}]+category:\s*z\.enum\(\['ACTIVE','INACTIVE'\]\)\.nullish\(\)/)  // Nullish (nullable)
  })

  test('should handle enum with autoincrement and default combination', async () => {
    const tempDir = join(tmpdir(), 'mutano-enum-auto-default-test-' + Date.now())
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

enum Type {
  SYSTEM
  USER
}

model Record {
  id   Int  @id @default(autoincrement())  // Auto-generated
  type Type @default(USER)                 // Has default
  name String
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
    
    const recordContent = result['Record.zod.ts']
    expect(recordContent).toBeDefined()
    
    console.log('Generated auto+default enum content:', recordContent)
    
    // Main schema should have required enum
    expect(recordContent).toContain("type: z.enum(['SYSTEM','USER'])")
    
    // Insertable should have optional id (auto-generated) and default type (has @default(USER)) - snake_case naming
    expect(recordContent).toMatch(/insertable_record[^}]+id:\s*z\.number\(\)\.nonnegative\(\)\.optional\(\)/)
    expect(recordContent).toMatch(/insertable_record[^}]+type:\s*z\.enum\(\['SYSTEM','USER'\]\)\.default\('USER'\)/)
  })
})
