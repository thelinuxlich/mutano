import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Updateable Schema Auto-Generated DateTime Exclusion Tests', () => {
  test('should exclude auto-generated datetime fields from updateable schemas', async () => {
    const tempDir = join(tmpdir(), 'mutano-updateable-datetime-test-' + Date.now())
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
  id          Int      @id @default(autoincrement())
  title       String
  content     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
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
    
    console.log('Generated content with auto-datetime exclusion:', postContent)
    
    // ✅ Main schema should include auto-generated datetime fields with .optional()
    expect(postContent).toContain('createdAt: z.date().optional()')
    expect(postContent).toContain('updatedAt: z.date().optional()')
    expect(postContent).toContain('publishedAt: z.date().nullable()')

    // ✅ FIXED: Insertable schema should NOT include auto-generated datetime fields
    expect(postContent).toContain('insertable_post')
    expect(postContent).not.toMatch(/insertable_post[^}]+createdAt:/)
    expect(postContent).not.toMatch(/insertable_post[^}]+updatedAt:/)
    
    // ✅ Insertable schema should still include manual datetime fields and other fields
    expect(postContent).toMatch(/insertable_post[^}]+title:\s*z\.string\(\)/)
    expect(postContent).toMatch(/insertable_post[^}]+content:\s*z\.string\(\)\.nullable\(\)/)
    expect(postContent).toMatch(/insertable_post[^}]+publishedAt:\s*z\.date\(\)\.nullable\(\)/)

    // ✅ FIXED: Updateable schema should NOT include auto-generated datetime fields
    expect(postContent).toContain('updateable_post')
    expect(postContent).not.toMatch(/updateable_post[^}]+createdAt:/)
    expect(postContent).not.toMatch(/updateable_post[^}]+updatedAt:/)

    // ✅ Updateable schema should still include manual datetime fields and other fields
    expect(postContent).toMatch(/updateable_post[^}]+title:\s*z\.string\(\)\.optional\(\)/)
    expect(postContent).toMatch(/updateable_post[^}]+content:\s*z\.string\(\)\.nullable\(\)/)
    expect(postContent).toMatch(/updateable_post[^}]+publishedAt:\s*z\.date\(\)\.nullable\(\)/)
    
    // ✅ Selectable schema should include all datetime fields
    expect(postContent).toContain('selectable_post')
    expect(postContent).toMatch(/selectable_post[^}]+createdAt:\s*z\.date\(\)\.optional\(\)/)
    expect(postContent).toMatch(/selectable_post[^}]+updatedAt:\s*z\.date\(\)\.optional\(\)/)
    expect(postContent).toMatch(/selectable_post[^}]+publishedAt:\s*z\.date\(\)\.nullable\(\)/)
  })

  test('should work with different datetime field patterns', async () => {
    const tempDir = join(tmpdir(), 'mutano-datetime-patterns-test-' + Date.now())
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
  id            Int      @id @default(autoincrement())
  name          String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  scheduledAt   DateTime
  completedAt   DateTime?
  deletedAt     DateTime?
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
    
    const activityContent = result['Activity.zod.ts']
    expect(activityContent).toBeDefined()
    
    console.log('Generated datetime patterns content:', activityContent)
    
    // ✅ Insertable schema should exclude auto-generated fields but include manual ones
    expect(activityContent).toContain('insertable_activity')

    // Should NOT include auto-generated datetime fields
    expect(activityContent).not.toMatch(/insertable_activity[^}]+createdAt:/)
    expect(activityContent).not.toMatch(/insertable_activity[^}]+updatedAt:/)

    // Should include manual datetime fields
    expect(activityContent).toMatch(/insertable_activity[^}]+name:\s*z\.string\(\)/)
    expect(activityContent).toMatch(/insertable_activity[^}]+scheduledAt:\s*z\.date\(\)/)
    expect(activityContent).toMatch(/insertable_activity[^}]+completedAt:\s*z\.date\(\)\.nullable\(\)/)
    expect(activityContent).toMatch(/insertable_activity[^}]+deletedAt:\s*z\.date\(\)\.nullable\(\)/)

    // ✅ Updateable schema should exclude auto-generated fields but include manual ones
    expect(activityContent).toContain('updateable_activity')

    // Should NOT include auto-generated datetime fields
    expect(activityContent).not.toMatch(/updateable_activity[^}]+createdAt:/)
    expect(activityContent).not.toMatch(/updateable_activity[^}]+updatedAt:/)

    // Should include manual datetime fields
    expect(activityContent).toMatch(/updateable_activity[^}]+name:\s*z\.string\(\)\.optional\(\)/)
    expect(activityContent).toMatch(/updateable_activity[^}]+scheduledAt:\s*z\.date\(\)\.optional\(\)/)
    expect(activityContent).toMatch(/updateable_activity[^}]+completedAt:\s*z\.date\(\)\.nullable\(\)/)
    expect(activityContent).toMatch(/updateable_activity[^}]+deletedAt:\s*z\.date\(\)\.nullable\(\)/)
  })

  test('should work with useDateType option', async () => {
    const tempDir = join(tmpdir(), 'mutano-datetime-union-test-' + Date.now())
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

model Event {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  eventDate DateTime
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
        useDateType: true
      }],
      dryRun: true
    })
    
    const eventContent = result['Event.zod.ts']
    expect(eventContent).toBeDefined()
    
    console.log('Generated datetime union content:', eventContent)
    
    // ✅ Insertable schema should exclude auto-generated fields
    expect(eventContent).toContain('insertable_event')
    expect(eventContent).not.toMatch(/insertable_event[^}]+createdAt:/)
    expect(eventContent).not.toMatch(/insertable_event[^}]+updatedAt:/)

    // ✅ Should include manual datetime field with union type
    expect(eventContent).toContain('eventDate: z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())')

    // ✅ Updateable schema should exclude auto-generated fields
    expect(eventContent).toContain('updateable_event')
    expect(eventContent).not.toMatch(/updateable_event[^}]+createdAt:/)
    expect(eventContent).not.toMatch(/updateable_event[^}]+updatedAt:/)

    // ✅ Should include manual datetime field with union type
    expect(eventContent).toContain('eventDate: z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date()).optional()')
  })
})
