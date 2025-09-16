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
    
    // Main schema should have required strings
    expect(userContent).toContain("name: z.string()")
    expect(userContent).toContain("email: z.string()")
    expect(userContent).toContain("bio: z.string().nullable()")
    
    // Insertable should have defaults for fields with @default
    expect(userContent).toMatch(/insertable_User[^}]+name:\s*z\.string\(\)\.default\('Anonymous'\)/)
    expect(userContent).toMatch(/insertable_User[^}]+email:\s*z\.string\(\)(?!\.(optional|nullable|nullish|default))/) // Required, no default
    expect(userContent).toMatch(/insertable_User[^}]+bio:\s*z\.string\(\)\.nullable\(\)\.default\('No bio provided'\)/)
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
    
    // Main schema should have required numbers
    expect(productContent).toContain("price: z.number()")
    expect(productContent).toContain("quantity: z.number()")
    expect(productContent).toContain("rating: z.number().nullable()")
    expect(productContent).toContain("discount: z.number().nullable()")
    
    // Insertable should have defaults for fields with @default
    expect(productContent).toMatch(/insertable_Product[^}]+price:\s*z\.number\(\)\.default\(0\.0\)/)
    expect(productContent).toMatch(/insertable_Product[^}]+quantity:\s*z\.number\(\)\.default\(1\)/)
    expect(productContent).toMatch(/insertable_Product[^}]+rating:\s*z\.number\(\)\.nullable\(\)(?!\.(optional|default))/) // Nullable, no default
    expect(productContent).toMatch(/insertable_Product[^}]+discount:\s*z\.number\(\)\.nullable\(\)\.default\(0\)/)
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
    
    // Main schema should have required booleans
    expect(settingsContent).toContain("isActive: z.boolean()")
    expect(settingsContent).toContain("isPublic: z.boolean()")
    expect(settingsContent).toContain("notifications: z.boolean()")
    expect(settingsContent).toContain("darkMode: z.boolean().nullable()")
    
    // Insertable should have defaults for fields with @default
    expect(settingsContent).toMatch(/insertable_Settings[^}]+isActive:\s*z\.boolean\(\)\.default\(true\)/)
    expect(settingsContent).toMatch(/insertable_Settings[^}]+isPublic:\s*z\.boolean\(\)\.default\(false\)/)
    expect(settingsContent).toMatch(/insertable_Settings[^}]+notifications:\s*z\.boolean\(\)(?!\.(optional|nullable|nullish|default))/) // Required, no default
    expect(settingsContent).toMatch(/insertable_Settings[^}]+darkMode:\s*z\.boolean\(\)\.nullable\(\)\.default\(true\)/)
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
    
    // Main schema should have required dates
    expect(postContent).toContain("createdAt: z.date()")
    expect(postContent).toContain("updatedAt: z.date()")
    expect(postContent).toContain("publishedAt: z.date().nullable()")
    
    // Insertable should handle auto-generated dates as optional
    expect(postContent).toMatch(/insertable_Post[^}]+createdAt:\s*z\.date\(\)\.optional\(\)/) // now() is auto-generated
    expect(postContent).toMatch(/insertable_Post[^}]+updatedAt:\s*z\.date\(\)\.optional\(\)/) // @updatedAt is auto-generated
    expect(postContent).toMatch(/insertable_Post[^}]+publishedAt:\s*z\.date\(\)\.nullable\(\)(?!\.(optional|default))/) // Nullable, no default
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
    
    // Insertable should have proper defaults for all types
    expect(accountContent).toMatch(/insertable_Account[^}]+id:\s*z\.number\(\)\.nonnegative\(\)\.optional\(\)/) // Auto-increment
    expect(accountContent).toContain("username: z.string().default('user')") // String default
    expect(accountContent).toContain("balance: z.number().default(0.0)") // Number default
    expect(accountContent).toContain("isVerified: z.boolean().default(false)") // Boolean default
    expect(accountContent).toContain("status: z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')") // Enum default
    expect(accountContent).toContain("createdAt: z.date().optional()") // Auto-generated date
    expect(accountContent).toContain("lastLogin: z.date().nullable()") // Nullable, no default
    expect(accountContent).toContain("metadata: z.string().nullable().default('{}')") // Nullable string with default
  })
})
