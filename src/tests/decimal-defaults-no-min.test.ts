import { describe, expect, test } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm } from 'fs/promises'
import { generate } from '../main.js'

describe('Decimal Defaults No Min Validation Tests', () => {
  test('should not add .min(1) to decimal fields with default values', async () => {
    const tempDir = join(tmpdir(), 'mutano-decimal-defaults-no-min-test-' + Date.now())
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
  price       Decimal @db.Decimal(10,2) // No default - should have .trim().min(1)
  discount    Decimal @default(0.00) @db.Decimal(5,2) // Has default - should NOT have .min(1)
  weight      Decimal? @db.Decimal(8,3) // Nullable without default
  shipping    Decimal? @default(5.99) @db.Decimal(6,2) // Nullable with default - should NOT have .min(1)
}
`
    
    await writeFile(schemaPath, schemaContent)
    
    try {
      console.log('=== Testing Decimal Fields Default Values and Min Validation ===')
      
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
      console.log('Generated decimal defaults content:', productContent)
      
      // Main schema checks
      expect(productContent).toContain("price: z.string().trim().min(1)") // No default, should have .min(1)
      expect(productContent).toContain("discount: z.string().trim().default('0.00')") // Has default, should NOT have .min(1)
      expect(productContent).toContain("weight: z.string().trim().min(1).nullable()") // Nullable without default, should have .min(1)
      expect(productContent).toContain("shipping: z.string().trim().nullable().default('5.99')") // Nullable with default, should NOT have .min(1)
      
      // Verify that fields with defaults do NOT have .min(1)
      expect(productContent).not.toMatch(/discount:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(productContent).not.toMatch(/shipping:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
      // Insertable schema checks
      expect(productContent).toMatch(/insertable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)/) // No default, should have .min(1)
      expect(productContent).toMatch(/insertable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.00'\)/) // Has default, should NOT have .min(1)
      expect(productContent).toMatch(/insertable_product[^}]+shipping:\s*z\.string\(\)\.trim\(\)\.nullable\(\)\.default\('5\.99'\)/) // Nullable with default, should NOT have .min(1)
      
      // Updateable schema checks
      expect(productContent).toMatch(/updateable_product[^}]+price:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/) // No default, should have .min(1)
      expect(productContent).toMatch(/updateable_product[^}]+discount:\s*z\.string\(\)\.trim\(\)\.optional\(\)\.default\('0\.00'\)/) // Has default, should NOT have .min(1)
      expect(productContent).toMatch(/updateable_product[^}]+shipping:\s*z\.string\(\)\.trim\(\)\.nullable\(\)\.default\('5\.99'\)/) // Nullable with default, should NOT have .min(1)
      
      // Selectable schema should not have any validation
      expect(productContent).toMatch(/selectable_product[^}]+price:\s*z\.string\(\)(?!\.trim)/)
      expect(productContent).toMatch(/selectable_product[^}]+discount:\s*z\.string\(\)(?!\.trim)/)
      expect(productContent).toMatch(/selectable_product[^}]+weight:\s*z\.string\(\)\.nullable\(\)/)
      expect(productContent).toMatch(/selectable_product[^}]+shipping:\s*z\.string\(\)\.nullable\(\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('should work correctly with mixed decimal and string fields', async () => {
    const tempDir = join(tmpdir(), 'mutano-mixed-decimal-string-test-' + Date.now())
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
  name        String  // String without default - should have .trim().min(1)
  description String  @default("No description") // String with default - should NOT have .min(1)
  balance     Decimal @db.Decimal(15,2) // Decimal without default - should have .trim().min(1)
  fee         Decimal @default(2.50) @db.Decimal(5,2) // Decimal with default - should NOT have .min(1)
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
      console.log('Generated mixed decimal/string content:', accountContent)
      
      // String without default should have .min(1)
      expect(accountContent).toContain("name: z.string().trim().min(1)")
      
      // String with default should NOT have .min(1)
      expect(accountContent).toContain("description: z.string().trim().default('No description')")
      
      // Decimal without default should have .min(1)
      expect(accountContent).toContain("balance: z.string().trim().min(1)")
      
      // Decimal with default should NOT have .min(1)
      expect(accountContent).toContain("fee: z.string().trim().default('2.50')")
      
      // Verify fields with defaults do NOT have .min(1)
      expect(accountContent).not.toMatch(/description:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      expect(accountContent).not.toMatch(/fee:\s*z\.string\(\)\.trim\(\)\.min\(1\)/)
      
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
