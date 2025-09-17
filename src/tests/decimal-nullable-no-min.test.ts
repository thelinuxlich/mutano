import { describe, expect, test } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm } from 'fs/promises'
import { generate } from '../main.js'

describe('Decimal Nullable No Min Validation Tests', () => {
  test('should not add .min(1) to nullable decimal fields', async () => {
    const tempDir = join(tmpdir(), 'mutano-decimal-nullable-no-min-test-' + Date.now())
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
  name        String
  price       Decimal @db.Decimal(10,2) // Required decimal - should have .trim().min(1)
  discount    Decimal? @db.Decimal(5,2) // Nullable decimal - should NOT have .min(1)
  shipping    Decimal? @default(5.99) @db.Decimal(6,2) // Nullable with default - should NOT have .min(1)
  weight      Decimal @default(0.0) @db.Decimal(8,3) // Required with default - should NOT have .min(1)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    try {
      console.log('=== Testing Nullable Decimal Fields - No Min Validation ===')
      
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
      console.log('Generated nullable decimal content:', productContent)
      
      // Main schema checks
      expect(productContent).toContain("price: z.string().trim().min(1)") // Required, no default - should have .min(1)
      expect(productContent).toContain("discount: z.string().trim().nullable()") // Nullable - should NOT have .min(1)
      expect(productContent).toContain("shipping: z.string().trim().nullable().default('5.99')") // Nullable with default - should NOT have .min(1)
      expect(productContent).toContain("weight: z.string().trim().default('0.0')") // Required with default - should NOT have .min(1)
      
      // Verify that nullable fields do NOT have .min(1)
      expect(productContent).not.toMatch(/discount:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(productContent).not.toMatch(/shipping:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
      // Insertable schema checks
      expect(productContent).toMatch(/insertable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)/) // Required, no default - should have .min(1)
      expect(productContent).toMatch(/insertable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.nullable\(\)/) // Nullable - should NOT have .min(1)
      expect(productContent).toMatch(/insertable_product[^}]+shipping:\s*z\.string\(\)\.trim\(\)\.nullable\(\)\.default\('5\.99'\)/) // Nullable with default - should NOT have .min(1)
      expect(productContent).toMatch(/insertable_product[^}]+weight:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.0'\)/) // Required with default - should NOT have .min(1)
      
      // Updateable schema checks
      expect(productContent).toMatch(/updateable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/) // Required, no default - should have .min(1)
      expect(productContent).toMatch(/updateable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.nullable\(\)/) // Nullable - should NOT have .min(1)
      expect(productContent).toMatch(/updateable_product[^}]+shipping:\s*z\.string\(\)\.trim\(\)\.nullable\(\)\.default\('5\.99'\)/) // Nullable with default - should NOT have .min(1)
      expect(productContent).toMatch(/updateable_product[^}]+weight:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.0'\)/) // Required with default - should NOT have .min(1)
      
      // Selectable schema should not have any validation
      expect(productContent).toMatch(/selectable_product[^}]+price:\s*z\.string\(\)(?!\.trim)/)
      expect(productContent).toMatch(/selectable_product[^}]+discount:\s*z\.string\(\)\.nullable\(\)/)
      expect(productContent).toMatch(/selectable_product[^}]+shipping:\s*z\.string\(\)\.nullable\(\)/)
      expect(productContent).toMatch(/selectable_product[^}]+weight:\s*z\.string\(\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('should work correctly with mixed required and nullable decimal fields', async () => {
    const tempDir = join(tmpdir(), 'mutano-mixed-nullable-decimal-test-' + Date.now())
    await mkdir(tempDir, { recursive: true })
    
    const schemaPath = join(tempDir, 'schema.prisma')
    const schemaContent = `
generator client {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Account {
  id          Int     @id @default(autoincrement())
  name        String  // String field for comparison
  balance     Decimal @db.Decimal(15,2) // Required decimal - should have .min(1)
  fee         Decimal? @db.Decimal(5,2) // Nullable decimal - should NOT have .min(1)
  bonus       Decimal? @default(10.00) @db.Decimal(8,2) // Nullable with default - should NOT have .min(1)
  commission  Decimal @default(2.50) @db.Decimal(6,2) // Required with default - should NOT have .min(1)
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
      
      const accountContent = result['Account.zod.ts']
      console.log('Generated mixed nullable decimal content:', accountContent)
      
      // String field should have .min(1) (for comparison)
      expect(accountContent).toContain("name: z.string().trim().min(1)")
      
      // Required decimal without default should have .min(1)
      expect(accountContent).toContain("balance: z.string().trim().min(1)")
      
      // Nullable decimal should NOT have .min(1)
      expect(accountContent).toContain("fee: z.string().trim().nullable()")
      
      // Nullable decimal with default should NOT have .min(1)
      expect(accountContent).toContain("bonus: z.string().trim().nullable().default('10.00')")
      
      // Required decimal with default should NOT have .min(1)
      expect(accountContent).toContain("commission: z.string().trim().default('2.50')")
      
      // Verify nullable fields do NOT have .min(1)
      expect(accountContent).not.toMatch(/fee:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(accountContent).not.toMatch(/bonus:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(accountContent).not.toMatch(/commission:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
