import { describe, expect, test } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm } from 'fs/promises'
import { generate } from '../main.js'

describe('Decimal Field Validation Tests', () => {
  test('should generate z.string().trim().min(1) for decimal fields in Zod schemas', async () => {
    const tempDir = join(tmpdir(), 'mutano-decimal-test-' + Date.now())
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
  name     String
  price    Decimal @db.Decimal(10,2)
  discount Decimal? @db.Decimal(5,2)
  weight   Decimal @default(0.0) @db.Decimal(8,3)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    try {
      console.log('=== Testing Decimal Field Validation ===')
      
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
      console.log('Generated decimal validation content:', productContent)
      
      // Main schema should have decimal fields with .trim().min(1) only if no default
      expect(productContent).toContain("price: z.string().trim().min(1)")
      expect(productContent).toContain("discount: z.string().trim().min(1).nullable()")
      expect(productContent).toContain("weight: z.string().trim().default('0.0')") // Has default, should NOT have .min(1)
      
      // Insertable schema should have decimal fields with .trim().min(1) only if no default
      expect(productContent).toMatch(/insertable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(productContent).toMatch(/insertable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)/)
      expect(productContent).toMatch(/insertable_product[^}]+weight:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.0'\)/) // Has default, should NOT have .min(1)

      // Updateable schema should have decimal fields with .trim().min(1) only if no default
      expect(productContent).toMatch(/updateable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/)
      expect(productContent).toMatch(/updateable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)/)
      expect(productContent).toMatch(/updateable_product[^}]+weight:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.0'\)/) // Has default, should NOT have .min(1)
      
      // Selectable schema should NOT have .trim().min(1) (data from DB is already validated)
      expect(productContent).toMatch(/selectable_product[^}]+price:\s*z\.string\(\)(?!\.trim)/)
      expect(productContent).toMatch(/selectable_product[^}]+discount:\s*z\.string\(\)\.nullable\(\)/)
      expect(productContent).toMatch(/selectable_product[^}]+weight:\s*z\.string\(\)(?!\.trim)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('should work with different database types for decimal fields', async () => {
    const tempDir = join(tmpdir(), 'mutano-decimal-mysql-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id      Int     @id @default(autoincrement())
  balance Decimal @db.Decimal(15,2)
  fee     Decimal? @db.Decimal(5,4)
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
          type: 'zod'
        }],
        dryRun: true
      })
      
      const accountContent = result['Account.zod.ts']
      console.log('Generated PostgreSQL decimal content:', accountContent)
      
      // Should work with PostgreSQL decimal types
      expect(accountContent).toContain("balance: z.string().trim().min(1)")
      expect(accountContent).toContain("fee: z.string().trim().min(1).nullable()")
      
      // Selectable should not have validation
      expect(accountContent).toMatch(/selectable_account[^}]+balance:\s*z\.string\(\)(?!\.trim)/)
      expect(accountContent).toMatch(/selectable_account[^}]+fee:\s*z\.string\(\)\.nullable\(\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
