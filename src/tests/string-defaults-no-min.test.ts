import { describe, expect, test } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm } from 'fs/promises'
import { generate } from '../main.js'

describe('String Defaults No Min Validation Tests', () => {
  test('should not add .min(1) to string fields with default values', async () => {
    const tempDir = join(tmpdir(), 'mutano-string-defaults-no-min-test-' + Date.now())
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
  id          Int     @id @default(autoincrement())
  email       String  // No default - should have .min(1)
  name        String  @default("Anonymous") // Has default - should NOT have .min(1)
  bio         String? @default("No bio provided") // Nullable with default
  nickname    String? // Nullable without default
  status      String  @default("active") // Has default - should NOT have .min(1)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    try {
      console.log('=== Testing String Fields Default Values and Min Validation ===')
      
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
      console.log('Generated string defaults content:', userContent)
      
      // Main schema checks
      expect(userContent).toContain("email: z.string().trim().min(1)") // No default, should have .min(1)
      expect(userContent).toContain("name: z.string().trim().default('Anonymous')") // Has default, should NOT have .min(1)
      expect(userContent).toContain("bio: z.string().trim().nullable().default('No bio provided')") // Nullable with default
      expect(userContent).toContain("nickname: z.string().trim().nullable()") // Nullable without default
      expect(userContent).toContain("status: z.string().trim().default('active')") // Has default, should NOT have .min(1)
      
      // Verify that fields with defaults do NOT have .min(1)
      expect(userContent).not.toMatch(/name:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(userContent).not.toMatch(/status:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(userContent).not.toMatch(/bio:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
      // Insertable schema checks
      expect(userContent).toMatch(/insertable_user[^}]+email:\s*z\.string\(\)\.trim\(\)\.min\(1\)/) // No default, should have .min(1)
      expect(userContent).toMatch(/insertable_user[^}]+name:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('Anonymous'\)/) // Has default, should NOT have .min(1)
      expect(userContent).toMatch(/insertable_user[^}]+status:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('active'\)/) // Has default, should NOT have .min(1)
      
      // Updateable schema checks
      expect(userContent).toMatch(/updateable_user[^}]+email:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/) // No default, should have .min(1)
      expect(userContent).toMatch(/updateable_user[^}]+name:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('Anonymous'\)/) // Has default, should NOT have .min(1)
      expect(userContent).toMatch(/updateable_user[^}]+status:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('active'\)/) // Has default, should NOT have .min(1)
      
      // Selectable schema should not have any validation
      expect(userContent).toMatch(/selectable_user[^}]+email:\s*z\.string\(\)(?!\.trim)/)
      expect(userContent).toMatch(/selectable_user[^}]+name:\s*z\.string\(\)(?!\.trim)/)
      expect(userContent).toMatch(/selectable_user[^}]+status:\s*z\.string\(\)(?!\.trim)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('should work correctly with mixed field types', async () => {
    const tempDir = join(tmpdir(), 'mutano-mixed-fields-test-' + Date.now())
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
  id          Int     @id @default(autoincrement())
  name        String  // No default - should have .min(1)
  description String  @default("No description") // String with default - should NOT have .min(1)
  price       Decimal @db.Decimal(10,2) // Decimal without default - should have .trim().min(1)
  discount    Decimal @default(0.00) @db.Decimal(5,2) // Decimal with default - should still have .trim().min(1)
  category    String  @default("General") // String with default - should NOT have .min(1)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    try {
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
      
      const productContent = result['Product.zod.ts']
      console.log('Generated mixed fields content:', productContent)
      
      // String without default should have .min(1)
      expect(productContent).toContain("name: z.string().trim().min(1)")
      
      // String with default should NOT have .min(1)
      expect(productContent).toContain("description: z.string().trim().default('No description')")
      expect(productContent).toContain("category: z.string().trim().default('General')")
      
      // Decimal fields should always have .trim().min(1) regardless of default
      expect(productContent).toContain("price: z.string().trim().min(1)")
      expect(productContent).toContain("discount: z.string().trim().min(1).default('0.00')")
      
      // Verify string fields with defaults do NOT have .min(1)
      expect(productContent).not.toMatch(/description:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(productContent).not.toMatch(/category:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
