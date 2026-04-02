import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '../main.js'

describe('SQL DDL @@ignore and @ignore directives', () => {
  it('should exclude tables with @@ignore in table comment', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-ignore-table-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`users\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE \`audit_logs\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`action\` varchar(255) NOT NULL,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='@@ignore';

CREATE TABLE \`posts\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`title\` varchar(255) NOT NULL,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT = '@@ignore';

CREATE TABLE \`comments\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`body\` text,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'out')

    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
        },
      ],
      silent: true,
      dryRun: true,
    })

    const keys = Object.keys(results)

    // users and comments should be generated
    expect(keys.some((k) => k.includes('users.zod.ts'))).toBe(true)
    expect(keys.some((k) => k.includes('comments.zod.ts'))).toBe(true)

    // audit_logs and posts should be excluded (@@ignore)
    expect(keys.some((k) => k.includes('audit_logs'))).toBe(false)
    expect(keys.some((k) => k.includes('posts'))).toBe(false)
  })

  it('should exclude columns with @ignore in column comment', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-ignore-col-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`users\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    \`email\` varchar(255) NOT NULL,
    \`password_hash\` varchar(255) NOT NULL COMMENT '@ignore',
    \`internal_id\` varchar(100) DEFAULT NULL COMMENT 'Internal tracking @ignore',
    \`metadata\` json DEFAULT NULL COMMENT '@ts(UserMetadata)',
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'out')

    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
        },
      ],
      silent: true,
      dryRun: true,
    })

    const content = Object.values(results)[0] as string

    // These columns should be present
    expect(content).toContain('id:')
    expect(content).toContain('name:')
    expect(content).toContain('email:')
    expect(content).toContain('metadata:')

    // These columns should be excluded (@ignore)
    expect(content).not.toContain('password_hash')
    expect(content).not.toContain('internal_id')
  })

  it('should handle @@ignore with other table comment text', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-ignore-mixed-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`visible_table\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='This is a visible table';

CREATE TABLE \`hidden_table\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Internal table @@ignore - do not expose';
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'out')

    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
        },
      ],
      silent: true,
      dryRun: true,
    })

    const keys = Object.keys(results)

    expect(keys.some((k) => k.includes('visible_table'))).toBe(true)
    expect(keys.some((k) => k.includes('hidden_table'))).toBe(false)
  })

  it('should handle @ignore with mixed magic comments on columns', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-ignore-magic-'))
    const sqlFile = join(tempDir, 'schema.sql')

    const sqlContent = `
CREATE TABLE \`items\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    \`secret_field\` varchar(255) DEFAULT NULL COMMENT '@ts(SecretType) @ignore',
    \`visible_field\` varchar(255) DEFAULT NULL COMMENT '@ts(VisibleType)',
    PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

    writeFileSync(sqlFile, sqlContent)

    const outputFolder = join(tempDir, 'out')

    const results = await generate({
      origin: {
        type: 'sql',
        path: sqlFile,
        dialect: 'mysql',
      },
      destinations: [
        {
          type: 'zod',
          folder: outputFolder,
        },
      ],
      silent: true,
      dryRun: true,
    })

    const content = Object.values(results)[0] as string

    // secret_field has @ignore and should be excluded
    expect(content).not.toContain('secret_field')
    // visible_field should be present
    expect(content).toContain('visible_field:')
    expect(content).toContain('name:')
  })
})
