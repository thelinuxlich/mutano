import { describe, it, expect } from 'vitest'
import { generate } from '../main.js'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('mutano with SQL DDL files', () => {
  it('should generate types from SQL file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')
    
    const sqlContent = `
CREATE TABLE \`users\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    \`email\` varchar(191) NOT NULL,
    \`age\` int DEFAULT NULL,
    \`is_active\` tinyint(1) NOT NULL DEFAULT '1',
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`status\` enum('active','inactive','pending') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE \`posts\` (
    \`id\` bigint NOT NULL AUTO_INCREMENT,
    \`user_id\` int NOT NULL,
    \`title\` varchar(255) NOT NULL,
    \`content\` text,
    \`published\` tinyint(1) DEFAULT '0',
    PRIMARY KEY (\`id\`)
);
`
    
    writeFileSync(sqlFile, sqlContent)
    
    const outputFolder = join(tempDir, 'output')
    
    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql'
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
          version: 4,
          nullish: true
        },
        {
          type: 'kysely',
          folder: outputFolder,
          outFile: join(outputFolder, 'db.ts')
        }
      ],
      silent: true
    })
    
    // Check that files were generated
    expect(results[join(outputFolder, 'users.zod.ts')]).toBeDefined()
    expect(results[join(outputFolder, 'posts.zod.ts')]).toBeDefined()
    expect(results[join(outputFolder, 'db.ts')]).toBeDefined()
    
    // Check users zod schema content
    const usersZod = results[join(outputFolder, 'users.zod.ts')]
    expect(usersZod).toContain('export const users = z.object({')
    expect(usersZod).toContain('id:')
    expect(usersZod).toContain('name:')
    expect(usersZod).toContain('email:')
    
    // Check kysely output
    const kyselyOutput = results[join(outputFolder, 'db.ts')]
    expect(kyselyOutput).toContain('export interface DB {')
    expect(kyselyOutput).toContain('users:')
    expect(kyselyOutput).toContain('posts:')
    
    // Cleanup
    rmSync(tempDir, { recursive: true })
  })
  
  it('should handle tables with backticks and comments', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')
    
    const sqlContent = `
CREATE TABLE \`account_ledger\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`hash\` varchar(191) NOT NULL,
    \`amount\` varchar(191) NOT NULL,
    \`type\` enum('payment','transfer','withdraw') NOT NULL,
    \`metadata\` json DEFAULT NULL,
    PRIMARY KEY (\`nanoid\`)
);
`
    
    writeFileSync(sqlFile, sqlContent)
    
    const outputFolder = join(tempDir, 'output')
    
    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql'
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
          version: 4,
          nullish: true
        }
      ],
      silent: true
    })
    
    const ledgerZod = results[join(outputFolder, 'account_ledger.zod.ts')]
    expect(ledgerZod).toContain('export const account_ledger = z.object({')
    expect(ledgerZod).toContain('nanoid:')
    expect(ledgerZod).toContain('hash:')
    expect(ledgerZod).toContain('amount:')
    expect(ledgerZod).toContain('type:')
    expect(ledgerZod).toContain('metadata:')
    
    // Cleanup
    rmSync(tempDir, { recursive: true })
  })
  
  it('should filter tables based on config', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')
    
    const sqlContent = `
CREATE TABLE \`users\` (\`id\` int NOT NULL PRIMARY KEY);
CREATE TABLE \`posts\` (\`id\` int NOT NULL PRIMARY KEY);
CREATE TABLE \`comments\` (\`id\` int NOT NULL PRIMARY KEY);
`
    
    writeFileSync(sqlFile, sqlContent)
    
    const outputFolder = join(tempDir, 'output')
    
    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql'
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
          version: 4
        }
      ],
      tables: ['users', 'posts'],  // Only generate these tables
      silent: true
    })
    
    expect(results[join(outputFolder, 'users.zod.ts')]).toBeDefined()
    expect(results[join(outputFolder, 'posts.zod.ts')]).toBeDefined()
    expect(results[join(outputFolder, 'comments.zod.ts')]).toBeUndefined()
    
    // Cleanup
    rmSync(tempDir, { recursive: true })
  })

  it('should properly extract enum values for single-line enum', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')
    
    const sqlContent = `
CREATE TABLE \`test\` (
    \`id\` int NOT NULL,
    \`status\` enum('active','inactive','pending') NOT NULL,
    PRIMARY KEY (\`id\`)
);
`
    
    writeFileSync(sqlFile, sqlContent)
    
    const outputFolder = join(tempDir, 'output')
    
    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql'
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
          version: 4,
          nullish: true
        }
      ],
      silent: true
    })
    
    const testZod = results[join(outputFolder, 'test.zod.ts')]
    expect(testZod).toBeDefined()
    // Should contain z.enum with the actual values, not just z.string()
    expect(testZod).toContain("z.enum(['active','inactive','pending'])")
    
    // Cleanup
    rmSync(tempDir, { recursive: true })
  })

  it('should properly extract enum values for multi-line enum', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')
    
    // Multi-line enum definition (common in formatted SQL)
    const sqlContent = `
CREATE TABLE \`test\` (
    \`id\` int NOT NULL,
    \`status\` enum(
        'active',
        'inactive',
        'pending'
    ) NOT NULL,
    PRIMARY KEY (\`id\`)
);
`
    
    writeFileSync(sqlFile, sqlContent)
    
    const outputFolder = join(tempDir, 'output')
    
    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql'
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
          version: 4,
          nullish: true
        }
      ],
      silent: true
    })
    
    const testZod = results[join(outputFolder, 'test.zod.ts')]
    expect(testZod).toBeDefined()
    // Should contain z.enum with the actual values, not just z.string()
    expect(testZod).toContain("z.enum(['active','inactive','pending'])")
    
    // Cleanup
    rmSync(tempDir, { recursive: true })
  })

  it('should throw an error when magic comments are used on enum columns', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`test\` (
    \`id\` int NOT NULL,
    \`status\` enum('active','inactive') DEFAULT NULL COMMENT '@kysely(ActiveStatus | null)',
    PRIMARY KEY (\`id\`)
);
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'output')

    await expect(
      generate({
        origin: {
          type: 'sql',
          path: sqlFile,
          dialect: 'mysql'
        },
        destinations: [
          {
            type: 'zod',
            folder: outputFolder,
            version: 4
          }
        ],
        silent: true
      })
    ).rejects.toThrow(/Magic comments are not supported on enum\/set columns/)

    // Cleanup
    rmSync(tempDir, { recursive: true })
  })

  it('should throw an error when @zod magic comments are used on enum columns', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-test-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`test\` (
    \`id\` int NOT NULL,
    \`status\` enum('active','inactive') NOT NULL COMMENT '@zod(z.enum(["active", "inactive"]))',
    PRIMARY KEY (\`id\`)
);
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'output')

    await expect(
      generate({
        origin: {
          type: 'sql',
          path: sqlFile,
          dialect: 'mysql'
        },
        destinations: [
          {
            type: 'zod',
            folder: outputFolder,
            version: 4
          }
        ],
        silent: true
      })
    ).rejects.toThrow(/Magic comments are not supported on enum\/set columns/)

    // Cleanup
    rmSync(tempDir, { recursive: true })
  })
})
