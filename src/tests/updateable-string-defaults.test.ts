import { describe, test, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Updateable String Defaults Tests', () => {
  test('should not add .min(1) to updateable string fields with defaults', async () => {
    const tempDir = join(tmpdir(), 'mutano-updateable-string-test-' + Date.now())
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
        type: 'zod',
        requiredString: true,
        useTrim: true
      }],
      dryRun: true
    })
    
    const userContent = result['User.zod.ts']
    expect(userContent).toBeDefined()
    
    console.log('Generated updateable string defaults content:', userContent)
    
    // ✅ FIXED: Updateable schema should NOT have .min(1) for fields with defaults
    expect(userContent).toMatch(/updateable_user[^}]+name:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('Anonymous'\)/)
    expect(userContent).toMatch(/updateable_user[^}]+bio:\s*z\.string\(\)\.trim\(\)\.nullable\(\)\.default\('No bio provided'\)/)
    
    // ✅ FIXED: Updateable schema should still have .min(1) for fields WITHOUT defaults
    expect(userContent).toMatch(/updateable_user[^}]+email:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/)
    
    // ✅ VERIFIED: Main schema should still have .min(1) for all required strings
    expect(userContent).toMatch(/export const user[^}]+name:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.default\('Anonymous'\)/)
    expect(userContent).toMatch(/export const user[^}]+email:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
    
    // ✅ VERIFIED: Insertable schema should still have .min(1) for required strings
    expect(userContent).toMatch(/insertable_user[^}]+name:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)\.default\('Anonymous'\)/)
    expect(userContent).toMatch(/insertable_user[^}]+email:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
    
    // ✅ VERIFIED: Selectable schema should NOT have validation modifiers
    expect(userContent).toMatch(/selectable_user[^}]+name:\s*z\.string\(\)/)
    expect(userContent).toMatch(/selectable_user[^}]+email:\s*z\.string\(\)/)
  })

  test('should add .default() at the end for updateable schemas', async () => {
    const tempDir = join(tmpdir(), 'mutano-updateable-defaults-order-test-' + Date.now())
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
  id       Int     @id @default(autoincrement())
  name     String  @default("Unnamed Product")
  price    Float   @default(0.0)
  active   Boolean @default(true)
  category String? @default("General")
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
    
    console.log('Generated defaults order content:', productContent)
    
    // ✅ FIXED: Updateable schema should have .default() at the end
    expect(productContent).toMatch(/updateable_product[^}]+name:\s*z\.string\(\)\.optional\(\)\.default\('Unnamed Product'\)/)
    expect(productContent).toMatch(/updateable_product[^}]+price:\s*z\.number\(\)\.optional\(\)\.default\(0\.0\)/)
    expect(productContent).toMatch(/updateable_product[^}]+active:\s*z\.boolean\(\)\.optional\(\)\.default\(true\)/)
    expect(productContent).toMatch(/updateable_product[^}]+category:\s*z\.string\(\)\.nullable\(\)\.default\('General'\)/)
  })
})
