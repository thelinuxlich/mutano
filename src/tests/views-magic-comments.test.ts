import { describe, expect, test } from 'vitest'
import { type Desc, generateViewContent, defaultZodHeader, generate } from '../main.js'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Views with Magic Comments', () => {
  test('should handle @zod magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'email',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'varchar',
        Comment: '@zod(z.string().email().min(5).max(100))',
      },
      {
        Field: 'score',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'decimal',
        Comment: '@zod(z.number().min(0).max(100))',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'zod' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'user_scores',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// View schema (read-only)')
    expect(content).toContain('export const user_scores_view = z.object({')
    expect(content).toContain('id: z.number()')
    expect(content).toContain('email: z.string().email().min(5).max(100)')  // @zod magic comment completely overrides
    expect(content).toContain('score: z.number().min(0).max(100)')  // @zod magic comment completely overrides (no .nullable())
    expect(content).toContain('export type UserScoresViewType = z.infer<typeof user_scores_view>')
  })

  test('should handle @ts magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'metadata',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(UserMetadata)',
      },
      {
        Field: 'settings',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'json',
        Comment: '@ts(Record<string, unknown>)',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'ts' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'user_data',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// TypeScript interface for user_data (view - read-only)')
    expect(content).toContain('export interface UserDataView {')
    expect(content).toContain('id: number;')
    expect(content).toContain('metadata: UserMetadata;')  // @ts magic comment completely overrides (no | null added)
    expect(content).toContain('settings: Record<string, unknown>;')  // @ts magic comment completely overrides
  })

  test('should handle @kysely magic comments in view columns', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'data',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@kysely(CustomJsonType)',
      },
      {
        Field: 'config',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'text',
        Comment: '@kysely(ConfigObject)',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'kysely' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'system_config',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('// Kysely type definitions for system_config (view)')
    expect(content).toContain('export interface SystemConfigView {')
    expect(content).toContain('id: number;')
    expect(content).toContain('data: CustomJsonType;')  // @kysely magic comment completely overrides (no | null added)
    expect(content).toContain('config: ConfigObject;')  // @kysely magic comment completely overrides
    expect(content).toContain('export type SelectableSystemConfigView = Selectable<SystemConfigView>;')
  })

  test('should handle multiple magic comments in single view column', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'complex_field',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(ComplexType) @kysely(KyselyComplexType) @zod(z.record(z.string()))',
      },
    ]

    // Test TypeScript output
    const tsConfig = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'ts' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const tsContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: tsConfig,
      destination: tsConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(tsContent).toContain('complex_field: ComplexType;')  // @ts magic comment completely overrides (no | null added)

    // Test Kysely output
    const kyselyConfig = {
      ...tsConfig,
      destinations: [{ type: 'kysely' as const }],
    }

    const kyselyContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: kyselyConfig,
      destination: kyselyConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(kyselyContent).toContain('complex_field: KyselyComplexType;')  // @kysely magic comment completely overrides (no | null added)

    // Test Zod output
    const zodConfig = {
      ...tsConfig,
      destinations: [{ type: 'zod' as const }],
    }

    const zodContent = generateViewContent({
      view: 'complex_view',
      describes,
      config: zodConfig,
      destination: zodConfig.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(zodContent).toContain('complex_field: z.record(z.string())')  // @zod magic comment completely overrides (no .nullable() added)
  })

  test('should handle magic comments with camelCase conversion in views', () => {
    const describes: Desc[] = [
      {
        Field: 'user_id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'created_at',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'datetime',
        Comment: '@ts(CustomDate)',
      },
      {
        Field: 'metadata_json',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@zod(z.record(z.string().min(1)))',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'ts' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'activity_log',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: true, // Enable camelCase conversion
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('export interface ActivityLogView {')
    expect(content).toContain('userId: number;') // camelCase field name
    expect(content).toContain('createdAt: CustomDate;') // camelCase field name with magic comment type
    expect(content).toContain('metadataJson: string | null;') // camelCase field name (JSON without magic comment becomes string)
  })

  test('should ignore magic comments when magicComments is disabled', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'data',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'json',
        Comment: '@ts(CustomType) @zod(z.record(z.string()))',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'zod' as const,
        },
      ],
      includeViews: true,
      magicComments: false, // Disabled
    }

    const content = generateViewContent({
      view: 'test_view',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    // Should use default JSON type, not magic comment type
    expect(content).toContain('data: z.string()') // JSON without magic comments becomes string in MySQL
    expect(content).not.toContain('z.record(z.string())')
  })

  test('should handle complex nested types in view magic comments', () => {
    const describes: Desc[] = [
      {
        Field: 'id',
        Default: null,
        Extra: '',
        Null: 'NO',
        Type: 'int',
        Comment: '',
      },
      {
        Field: 'complex_data',
        Default: null,
        Extra: '',
        Null: 'YES',
        Type: 'json',
        Comment: '@ts(Array<{ id: string; values: Record<string, number> }>)',
      },
    ]

    const config = {
      origin: {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'secret',
        database: 'test',
      },
      destinations: [
        {
          type: 'ts' as const,
        },
      ],
      includeViews: true,
      magicComments: true,
    }

    const content = generateViewContent({
      view: 'analytics_view',
      describes,
      config,
      destination: config.destinations[0],
      isCamelCase: false,
      enumDeclarations: {},
      defaultZodHeader,
    })

    expect(content).toContain('complex_data: Array<{ id: string; values: Record<string, number> }>;')  // @ts magic comment completely overrides (no | null added)
  })

  test('should inherit branded type comments from source table columns in SQL views', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-view-comments-test-'))
    const sqlFile = join(tempDir, 'schema.sql')

    // SQL with tables that have branded type comments and a view that selects from them
    const sqlContent = `
CREATE TABLE \`rise_entities\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`riseid\` varchar(191) NOT NULL COMMENT '@kysely(CompanyRiseid | UserRiseid | TeamRiseid) @zod(companyRiseid.or(userRiseid).or(teamRiseid))',
    \`type\` enum('user','company','team') NOT NULL,
    PRIMARY KEY (\`nanoid\`)
);

CREATE TABLE \`users_data\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`rise_account\` varchar(191) NOT NULL COMMENT '@kysely(UserRiseAccount) @zod(userRiseAccount)',
    \`email\` varchar(191) NOT NULL,
    PRIMARY KEY (\`nanoid\`)
);

CREATE TABLE \`teams\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`company_riseid\` varchar(191) NOT NULL COMMENT '@kysely(CompanyRiseid)',
    \`team_riseid\` varchar(191) NOT NULL COMMENT '@kysely(TeamRiseid) @zod(teamRiseid)',
    PRIMARY KEY (\`nanoid\`)
);

CREATE VIEW \`user_team_relationships_view\` AS
SELECT
    re.nanoid AS company_nanoid,
    re.riseid AS company_riseid,
    t.nanoid AS team_nanoid,
    t.team_riseid AS team_riseid,
    ud.rise_account AS user_rise_account
FROM rise_entities re
JOIN teams t ON t.company_riseid = re.riseid
JOIN users_data ud ON ud.nanoid = re.nanoid;
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
          type: 'kysely',
          folder: outputFolder,
          outFile: join(outputFolder, 'db.ts')
        },
        {
          type: 'zod',
          folder: outputFolder,
          version: 4
        }
      ],
      includeViews: true,
      magicComments: true,
      silent: true
    })

    // Check Kysely output for view with inherited branded types
    const kyselyOutput = results[join(outputFolder, 'db.ts')]
    expect(kyselyOutput).toBeDefined()
    expect(kyselyOutput).toContain('export interface UserTeamRelationshipsViewView {')
    // These should have the branded types from the source table comments
    expect(kyselyOutput).toContain('company_riseid: CompanyRiseid | UserRiseid | TeamRiseid;')
    expect(kyselyOutput).toContain('team_riseid: TeamRiseid;')
    // nanoid columns without comments in source tables should be plain string
    expect(kyselyOutput).toContain('company_nanoid: string;')
    expect(kyselyOutput).toContain('team_nanoid: string;')
    expect(kyselyOutput).toContain('user_rise_account: UserRiseAccount;')

    // Check Zod output for view with inherited branded types
    const zodOutput = results[join(outputFolder, 'user_team_relationships_view.zod.ts')]
    expect(zodOutput).toBeDefined()
    expect(zodOutput).toContain('export const user_team_relationships_view_view = z.object({')
    // These should have the branded types from the source table comments
    expect(zodOutput).toContain('company_riseid: companyRiseid.or(userRiseid).or(teamRiseid)')
    expect(zodOutput).toContain('team_riseid: teamRiseid')
    expect(zodOutput).toContain('company_nanoid: z.string()')
    expect(zodOutput).toContain('team_nanoid: z.string()')
    expect(zodOutput).toContain('user_rise_account: userRiseAccount')

    // Cleanup
    rmSync(tempDir, { recursive: true })
  })

  test('should inherit comments from source tables via column prefix mapping', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mutano-view-prefix-test-'))
    const sqlFile = join(tempDir, 'schema.sql')

    // SQL with tables that have branded type comments
    // The view uses column aliases with prefixes that map to source tables
    const sqlContent = `
CREATE TABLE \`rise_entities\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`riseid\` varchar(191) NOT NULL COMMENT '@kysely(CompanyRiseid)',
    PRIMARY KEY (\`nanoid\`)
);

CREATE TABLE \`users_data\` (
    \`nanoid\` varchar(191) NOT NULL,
    \`riseid\` varchar(191) NOT NULL COMMENT '@kysely(UserRiseid)',
    PRIMARY KEY (\`nanoid\`)
);

CREATE VIEW \`test_view\` AS
SELECT
    re.riseid AS company_riseid,
    ud.riseid AS user_riseid
FROM rise_entities re
JOIN users_data ud ON ud.nanoid = re.nanoid;
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
          type: 'kysely',
          folder: outputFolder,
          outFile: join(outputFolder, 'db.ts')
        }
      ],
      includeViews: true,
      magicComments: true,
      silent: true
    })

    // Check Kysely output - comments should be inherited from source tables
    const kyselyOutput = results[join(outputFolder, 'db.ts')]
    expect(kyselyOutput).toBeDefined()
    expect(kyselyOutput).toContain('export interface TestViewView {')
    // The company_riseid column should inherit the comment from rise_entities.riseid
    expect(kyselyOutput).toContain('company_riseid: CompanyRiseid;')
    // The user_riseid column should inherit the comment from users_data.riseid
    expect(kyselyOutput).toContain('user_riseid: UserRiseid;')

    // Cleanup
    rmSync(tempDir, { recursive: true })
  })
})
