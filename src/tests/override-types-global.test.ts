import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { generateContent } from '../generators/content-generator.js'
import { generate } from '../main.js'
import type { Config, Desc } from '../types/index.js'

describe('Global overrideTypes', () => {
  const describes: Desc[] = [
    {
      Field: 'id',
      Type: 'int',
      Null: 'NO',
      Default: null,
      Extra: 'auto_increment',
      Comment: '',
    },
    {
      Field: 'metadata',
      Type: 'json',
      Null: 'YES',
      Default: null,
      Extra: '',
      Comment: '',
    },
  ]

  const defaultZodHeader = (v: 3 | 4) => `import { z } from 'zod';\n\n`

  test('should work as global option', () => {
    const config: Config = {
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test',
      },
      destinations: [{ type: 'zod' }],
      overrideTypes: {
        zod: {
          json: 'z.record(z.unknown())',
        },
      },
    }

    const content = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'zod' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('metadata: z.record(z.unknown())')
  })

  test('should support all destination types', () => {
    const config: Config = {
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test',
      },
      destinations: [{ type: 'zod' }],
      overrideTypes: {
        zod: { json: 'z.record(z.string())' },
        ts: { json: 'Record<string, string>' },
        kysely: { json: 'CustomJson' },
      },
    }

    // Test Zod
    const zodContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'zod' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })
    expect(zodContent).toContain('metadata: z.record(z.string())')

    // Test TypeScript
    const tsContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'ts' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })
    expect(tsContent).toContain('metadata: Record<string, string> | null;')

    // Test Kysely
    const kyselyContent = generateContent({
      table: 'users',
      describes,
      config,
      destination: { type: 'kysely' },
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })
    expect(kyselyContent).toContain('metadata: CustomJson | null;')
  })

  test('should preserve boolean default values when overriding tinyint(1) from SQL files', async () => {
    const tempDir = join(
      tmpdir(),
      'mutano-override-defaults-test-' + Date.now(),
    )
    await mkdir(tempDir, { recursive: true })

    const schemaPath = join(tempDir, 'schema.sql')
    const schemaContent = `
CREATE TABLE settings (
  id int NOT NULL AUTO_INCREMENT,
  is_active tinyint(1) NOT NULL DEFAULT '1',
  is_public tinyint(1) NOT NULL DEFAULT '0',
  is_deleted tinyint(1) DEFAULT NULL,
  name varchar(255) NOT NULL DEFAULT 'untitled',
  PRIMARY KEY (id)
);
`
    await writeFile(schemaPath, schemaContent)

    const outDir = join(tempDir, 'out')
    const result = await generate({
      origin: {
        type: 'sql',
        path: schemaPath,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outDir,
        },
      ],
      overrideTypes: {
        zod: {
          'tinyint(1)':
            'z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())',
        },
      },
      dryRun: true,
    })

    const settingsContent = result[`${outDir}/settings.zod.ts`]
    expect(settingsContent).toBeDefined()

    // Table schema: DEFAULT '1' should produce .default(true)
    expect(settingsContent).toContain('.default(true)')
    // Table schema: DEFAULT '0' should produce .default(false)
    expect(settingsContent).toContain('.default(false)')

    // Insertable: is_active should have .default(true) (NOT NULL with default)
    expect(settingsContent).toMatch(
      /insertable_settings[^}]+is_active:[\s\S]*?\.default\(true\)/,
    )
    // Insertable: is_public should have .default(false) (NOT NULL with default)
    expect(settingsContent).toMatch(
      /insertable_settings[^}]+is_public:[\s\S]*?\.default\(false\)/,
    )
    // Insertable: is_deleted is nullable without default (NULL default)
    expect(settingsContent).toMatch(
      /insertable_settings[^}]+is_deleted:[\s\S]*?\.nullable\(\)(?!\.default)/,
    )

    // Selectable should NOT have defaults
    expect(settingsContent).toMatch(
      /selectable_settings[^}]+is_active:[\s\S]*?\)(?!\.default)/,
    )
  })

  test('should preserve number and string defaults when using overrideTypes', async () => {
    const tempDir = join(
      tmpdir(),
      'mutano-override-number-defaults-test-' + Date.now(),
    )
    await mkdir(tempDir, { recursive: true })

    const schemaPath = join(tempDir, 'schema.sql')
    const schemaContent = `
CREATE TABLE products (
  id int NOT NULL AUTO_INCREMENT,
  price int NOT NULL DEFAULT '0',
  label varchar(100) NOT NULL DEFAULT 'unknown',
  quantity int DEFAULT NULL,
  PRIMARY KEY (id)
);
`
    await writeFile(schemaPath, schemaContent)

    const outDir = join(tempDir, 'out')
    const result = await generate({
      origin: {
        type: 'sql',
        path: schemaPath,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outDir,
        },
      ],
      overrideTypes: {
        zod: {
          int: 'z.number().nonnegative()',
          'varchar(100)': 'z.string().max(100)',
        },
      },
      dryRun: true,
    })

    const productsContent = result[`${outDir}/products.zod.ts`]
    expect(productsContent).toBeDefined()

    // Override type should be used
    expect(productsContent).toContain('z.number().nonnegative()')
    expect(productsContent).toContain('z.string().max(100)')

    // Defaults should be preserved
    expect(productsContent).toContain('.default(0)') // price DEFAULT '0'
    expect(productsContent).toContain(".default('unknown')") // label DEFAULT 'unknown'

    // Insertable: price should have .default(0)
    expect(productsContent).toMatch(
      /insertable_products[^}]+price:[\s\S]*?\.default\(0\)/,
    )
    // Insertable: label should have .default('unknown')
    expect(productsContent).toMatch(
      /insertable_products[^}]+label:[\s\S]*?\.default\('unknown'\)/,
    )
  })

  test('should preserve nullability when using overrideTypes', async () => {
    const tempDir = join(
      tmpdir(),
      'mutano-override-nullability-test-' + Date.now(),
    )
    await mkdir(tempDir, { recursive: true })

    const schemaPath = join(tempDir, 'schema.sql')
    const schemaContent = `
CREATE TABLE items (
  id int NOT NULL AUTO_INCREMENT,
  required_field varchar(255) NOT NULL,
  nullable_field varchar(255) DEFAULT NULL,
  PRIMARY KEY (id)
);
`
    await writeFile(schemaPath, schemaContent)

    const outDir = join(tempDir, 'out')
    const result = await generate({
      origin: {
        type: 'sql',
        path: schemaPath,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outDir,
        },
      ],
      overrideTypes: {
        zod: {
          'varchar(255)': 'z.string().trim()',
        },
      },
      dryRun: true,
    })

    const itemsContent = result[`${outDir}/items.zod.ts`]
    expect(itemsContent).toBeDefined()

    // required_field should NOT be nullable
    expect(itemsContent).toMatch(
      /items[^}]+required_field:\s*z\.string\(\)\.trim\(\)(?!\.(nullable|nullish))/,
    )
    // nullable_field SHOULD be nullable
    expect(itemsContent).toMatch(
      /items[^}]+nullable_field:\s*z\.string\(\)\.trim\(\)\.nullable\(\)/,
    )
  })
})
