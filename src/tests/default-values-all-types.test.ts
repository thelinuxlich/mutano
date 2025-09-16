import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Default Values for All Data Types', () => {
  test('should handle string default values correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-string-default-test-' + Date.now())
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

model User {
  id       Int    @id @default(autoincrement())
  name     String @default("Anonymous")
  email    String
  bio      String? @default("No bio provided")
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
    
    console.log('Generated string default content:', userContent)
    
    // Main schema should have defaults for fields with @default
    expect(userContent).toContain("name: z.string().default('Anonymous')")
    expect(userContent).toContain("email: z.string()")  // No default
    expect(userContent).toContain("bio: z.string().nullable().default('No bio provided')")
    
    // Insertable should have defaults for fields with @default (snake_case naming)
    expect(userContent).toMatch(/insertable_user[^}]+name:\s*z\.string\(\)\.default\('Anonymous'\)/)
    expect(userContent).toMatch(/insertable_user[^}]+email:\s*z\.string\(\)(?!\.(optional|nullable|nullish|default))/) // Required, no default
    expect(userContent).toMatch(/insertable_user[^}]+bio:\s*z\.string\(\)\.nullable\(\)\.default\('No bio provided'\)/)

    // Selectable should NOT have defaults - when selecting from DB, you always get a value
    expect(userContent).toMatch(/selectable_user[^}]+name:\s*z\.string\(\)/)
    expect(userContent).toMatch(/selectable_user[^}]+bio:\s*z\.string\(\)\.nullable\(\)/)
  })

  test('should handle number default values correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-number-default-test-' + Date.now())
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

model Product {
  id       Int   @id @default(autoincrement())
  price    Float @default(0.0)
  quantity Int   @default(1)
  rating   Float?
  discount Int?  @default(0)
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
    
    const productContent = result['Product.zod.ts']
    expect(productContent).toBeDefined()
    
    console.log('Generated number default content:', productContent)
    
    // Main schema should have defaults for fields with @default
    expect(productContent).toContain("price: z.number().default(0.0)")
    expect(productContent).toContain("quantity: z.number().default(1)")
    expect(productContent).toContain("rating: z.number().nullable()")  // No default
    expect(productContent).toContain("discount: z.number().nullable().default(0)")

    // Insertable should have defaults for fields with @default (snake_case naming)
    expect(productContent).toMatch(/insertable_product[^}]+price:\s*z\.number\(\)\.default\(0\.0\)/)
    expect(productContent).toMatch(/insertable_product[^}]+quantity:\s*z\.number\(\)\.default\(1\)/)
    expect(productContent).toMatch(/insertable_product[^}]+rating:\s*z\.number\(\)\.nullable\(\)(?!\.(optional|default))/) // Nullable, no default
    expect(productContent).toMatch(/insertable_product[^}]+discount:\s*z\.number\(\)\.nullable\(\)\.default\(0\)/)

    // Selectable should NOT have defaults - when selecting from DB, you always get a value
    expect(productContent).toMatch(/selectable_product[^}]+price:\s*z\.number\(\)/)
    expect(productContent).toMatch(/selectable_product[^}]+quantity:\s*z\.number\(\)/)
    expect(productContent).toMatch(/selectable_product[^}]+discount:\s*z\.number\(\)\.nullable\(\)/)
  })

  test('should handle boolean default values correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-boolean-default-test-' + Date.now())
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

model Settings {
  id            Int     @id @default(autoincrement())
  isActive      Boolean @default(true)
  isPublic      Boolean @default(false)
  notifications Boolean
  darkMode      Boolean? @default(true)
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
    
    const settingsContent = result['Settings.zod.ts']
    expect(settingsContent).toBeDefined()
    
    console.log('Generated boolean default content:', settingsContent)
    
    // Main schema should have defaults for fields with @default
    expect(settingsContent).toContain("isActive: z.boolean().default(true)")
    expect(settingsContent).toContain("isPublic: z.boolean().default(false)")
    expect(settingsContent).toContain("notifications: z.boolean()")  // No default
    expect(settingsContent).toContain("darkMode: z.boolean().nullable().default(true)")

    // Insertable should have defaults for fields with @default (snake_case naming)
    expect(settingsContent).toMatch(/insertable_settings[^}]+isActive:\s*z\.boolean\(\)\.default\(true\)/)
    expect(settingsContent).toMatch(/insertable_settings[^}]+isPublic:\s*z\.boolean\(\)\.default\(false\)/)
    expect(settingsContent).toMatch(/insertable_settings[^}]+notifications:\s*z\.boolean\(\)(?!\.(optional|nullable|nullish|default))/) // Required, no default
    expect(settingsContent).toMatch(/insertable_settings[^}]+darkMode:\s*z\.boolean\(\)\.nullable\(\)\.default\(true\)/)

    // Selectable should NOT have defaults - when selecting from DB, you always get a value
    expect(settingsContent).toMatch(/selectable_settings[^}]+isActive:\s*z\.boolean\(\)/)
    expect(settingsContent).toMatch(/selectable_settings[^}]+isPublic:\s*z\.boolean\(\)/)
    expect(settingsContent).toMatch(/selectable_settings[^}]+darkMode:\s*z\.boolean\(\)\.nullable\(\)/)
  })

  test('should handle DateTime default values correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-datetime-default-test-' + Date.now())
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

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  publishedAt DateTime?
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
    
    console.log('Generated DateTime default content:', postContent)
    
    // Main schema should NOT have defaults for auto-generated dates
    expect(postContent).toContain("createdAt: z.date()")  // Auto-generated, no default in main schema
    expect(postContent).toContain("updatedAt: z.date()")  // Auto-generated, no default in main schema
    expect(postContent).toContain("publishedAt: z.date().nullable()")  // No default
    
    // Insertable should handle auto-generated dates as optional (snake_case naming)
    expect(postContent).toMatch(/insertable_post[^}]+createdAt:\s*z\.date\(\)\.optional\(\)/) // now() is auto-generated
    expect(postContent).toMatch(/insertable_post[^}]+updatedAt:\s*z\.date\(\)\.optional\(\)/) // @updatedAt is auto-generated
    expect(postContent).toMatch(/insertable_post[^}]+publishedAt:\s*z\.date\(\)\.nullable\(\)(?!\.(optional|default))/) // Nullable, no default
  })

  test('should handle mixed data types with defaults correctly', async () => {
    const tempDir = join(tmpdir(), 'mutano-mixed-default-test-' + Date.now())
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

model Account {
  id          Int      @id @default(autoincrement())
  username    String   @default("user")
  balance     Float    @default(0.0)
  isVerified  Boolean  @default(false)
  status      Status   @default(ACTIVE)
  createdAt   DateTime @default(now())
  lastLogin   DateTime?
  metadata    String?  @default("{}")
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
    
    const accountContent = result['Account.zod.ts']
    expect(accountContent).toBeDefined()
    
    console.log('Generated mixed types default content:', accountContent)
    
    // Insertable should have proper defaults for all types (snake_case naming)
    expect(accountContent).toMatch(/insertable_account[^}]+id:\s*z\.number\(\)\.nonnegative\(\)\.optional\(\)/) // Auto-increment
    expect(accountContent).toContain("username: z.string().default('user')") // String default
    expect(accountContent).toContain("balance: z.number().default(0.0)") // Number default
    expect(accountContent).toContain("isVerified: z.boolean().default(false)") // Boolean default
    expect(accountContent).toContain("status: z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')") // Enum default
    expect(accountContent).toContain("createdAt: z.date().optional()") // Auto-generated date
    expect(accountContent).toContain("lastLogin: z.date().nullable()") // Nullable, no default
    expect(accountContent).toContain("metadata: z.string().nullable().default('{}')") // Nullable string with default
  })

  test('should include defaults in main schema (not just insertable)', async () => {
    const tempDir = join(tmpdir(), 'mutano-main-schema-defaults-test-' + Date.now())
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
  HIGH
}

model Task {
  id       Int      @id @default(autoincrement())
  title    String   @default("New Task")
  priority Priority @default(LOW)
  done     Boolean  @default(false)
  score    Int      @default(100)
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

    const taskContent = result['Task.zod.ts']
    expect(taskContent).toBeDefined()

    console.log('Generated main schema defaults content:', taskContent)

    // Main schema should have defaults for all fields with @default (except auto-generated) - snake_case naming
    expect(taskContent).toContain("export const task = z.object({")  // snake_case
    expect(taskContent).toContain("id: z.number().nonnegative()")  // Auto-increment, no default
    expect(taskContent).toContain("title: z.string().default('New Task')")  // String default
    expect(taskContent).toContain("priority: z.enum(['LOW','HIGH']).default('LOW')")  // Enum default
    expect(taskContent).toContain("done: z.boolean().default(false)")  // Boolean default
    expect(taskContent).toContain("score: z.number().default(100)")  // Number default

    // Insertable schema should have same defaults plus optional auto-generated fields - snake_case naming
    expect(taskContent).toContain("export const insertable_task = z.object({")  // snake_case
    expect(taskContent).toContain("id: z.number().nonnegative().optional()")  // Auto-increment, optional
    expect(taskContent).toContain("title: z.string().default('New Task')")  // String default
    expect(taskContent).toContain("priority: z.enum(['LOW','HIGH']).default('LOW')")  // Enum default
    expect(taskContent).toContain("done: z.boolean().default(false)")  // Boolean default
    expect(taskContent).toContain("score: z.number().default(100)")  // Number default

    // Selectable schema should ALSO have defaults - snake_case naming
    expect(taskContent).toContain("export const selectable_task = z.object({")  // snake_case
    expect(taskContent).toContain("id: z.number().nonnegative()")  // Auto-increment, no default
    expect(taskContent).toContain("title: z.string().default('New Task')")  // String default with default!
    expect(taskContent).toContain("priority: z.enum(['LOW','HIGH']).default('LOW')")  // Enum default with default!
    expect(taskContent).toContain("done: z.boolean().default(false)")  // Boolean default with default!
    expect(taskContent).toContain("score: z.number().default(100)")  // Number default with default!
  })
})
