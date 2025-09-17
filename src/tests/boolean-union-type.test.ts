import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Boolean Union Type Tests', () => {
  test('should generate z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean()) when useBooleanType is true', async () => {
    const tempDir = join(tmpdir(), 'mutano-boolean-union-test-' + Date.now())
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
  id           Int     @id @default(autoincrement())
  isActive     Boolean @default(true)
  isPublic     Boolean @default(false)
  notifications Boolean
  darkMode     Boolean?
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
        useBooleanType: true
      }],
      dryRun: true
    })
    
    const settingsContent = result['Settings.zod.ts']
    expect(settingsContent).toBeDefined()
    
    console.log('Generated boolean union content:', settingsContent)
    
    // ✅ All boolean fields should use the union type with coercion
    expect(settingsContent).toContain('isActive: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).default(true)')
    expect(settingsContent).toContain('isPublic: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).default(false)')
    expect(settingsContent).toContain('notifications: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())')
    expect(settingsContent).toContain('darkMode: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).nullable()')
    
    // ✅ Insertable schema should also use union types
    expect(settingsContent).toContain('insertable_settings')
    expect(settingsContent).toContain('isActive: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).optional().default(true)')

    // ✅ Updateable schema should also use union types
    expect(settingsContent).toContain('updateable_settings')
    expect(settingsContent).toContain('isActive: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).optional().default(true)')

    // ✅ Selectable schema should also use union types
    expect(settingsContent).toContain('selectable_settings')
    // In selectable, boolean fields don't have defaults
    expect(settingsContent).toContain('isActive: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())')
  })

  test('should generate z.boolean() when useBooleanType is false or not set', async () => {
    const tempDir = join(tmpdir(), 'mutano-boolean-simple-test-' + Date.now())
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
  id       Int     @id @default(autoincrement())
  isActive Boolean @default(true)
  isAdmin  Boolean
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
        // useBooleanType not set, should default to false
      }],
      dryRun: true
    })
    
    const userContent = result['User.zod.ts']
    expect(userContent).toBeDefined()
    
    console.log('Generated simple boolean content:', userContent)
    
    // ✅ Should use simple z.boolean() when useBooleanType is not set
    expect(userContent).toContain('isActive: z.boolean().default(true)')
    expect(userContent).toContain('isAdmin: z.boolean()')

    // ✅ Should NOT contain union types
    expect(userContent).not.toContain('z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())')
  })

  test('should work with both useBooleanType and useDateType together', async () => {
    const tempDir = join(tmpdir(), 'mutano-boolean-date-combo-test-' + Date.now())
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

model Activity {
  id        Int      @id @default(autoincrement())
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
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
        useBooleanType: true,
        useDateType: true
      }],
      dryRun: true
    })
    
    const activityContent = result['Activity.zod.ts']
    expect(activityContent).toBeDefined()
    
    console.log('Generated boolean+date combo content:', activityContent)
    
    // ✅ Boolean fields should use union type
    expect(activityContent).toContain('isActive: z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean()).default(true)')

    // ✅ Date fields should use union type
    expect(activityContent).toContain('createdAt: z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date()).optional()')
    expect(activityContent).toContain('updatedAt: z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date()).optional()')
  })
})
