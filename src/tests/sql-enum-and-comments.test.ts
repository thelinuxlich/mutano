import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate, getType } from '../main.js'
import type { Config, Desc } from '../types/index.js'

async function withSqlFile(
  sqlContent: string,
  run: (sqlFile: string) => Promise<void>,
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'mutano-sql-issue-5-'))
  try {
    const sqlFile = join(tempDir, 'schema.sql')
    writeFileSync(sqlFile, sqlContent)
    await run(sqlFile)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('SQL DDL parsing edge cases', () => {
  it('preserves enum values containing commas, quotes, and parentheses', async () => {
    await withSqlFile(
      `CREATE TABLE tasks (
  id int NOT NULL AUTO_INCREMENT,
  status enum('new', 'in,progress', 'it''s done', 'archived (old)') NOT NULL,
  PRIMARY KEY (id)
);
`,
      async (sqlFile) => {
        const results = await generate({
          origin: { type: 'sql', path: sqlFile, dialect: 'mysql' },
          destinations: [{ type: 'zod' }],
          dryRun: true,
          silent: true,
        })

        expect(results['tasks.zod.ts']).toContain(
          `status: z.enum(['new','in,progress',"it's done",'archived (old)']),`,
        )
      },
    )
  })

  it('preserves enum values from live MySQL column types', () => {
    const config: Config = {
      origin: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test',
      },
      destinations: [],
    }
    const desc: Desc = {
      Field: 'status',
      Type: "enum('new','in,progress','it''s done','archived (old)')",
      DataType: 'enum',
      Null: 'NO',
      Default: null,
      Extra: '',
      Comment: '',
    }

    expect(getType('table', desc, config, { type: 'zod' })).toBe(
      `z.enum(['new','in,progress',"it's done",'archived (old)'])`,
    )
  })

  it('ignores commented-out tables and handles schema-qualified names and inline comments', async () => {
    await withSqlFile(
      `-- CREATE TABLE old_stuff (x integer NOT NULL);
/* CREATE TABLE blocked (x integer NOT NULL); */
# CREATE TABLE hash_ignored (x integer NOT NULL);
CREATE TABLE items (a integer PRIMARY KEY, b text, c real);
CREATE TABLE public.events (id integer NOT NULL);
CREATE TABLE notes (
  id serial PRIMARY KEY,
  title varchar(255), -- inline comment
  body text NOT NULL,
  note varchar(255) DEFAULT 'NOT NULL'
);
`,
      async (sqlFile) => {
        const results = await generate({
          origin: { type: 'sql', path: sqlFile, dialect: 'postgres' },
          destinations: [{ type: 'ts' }],
          dryRun: true,
          silent: true,
        })

        expect(Object.keys(results).sort()).toEqual([
          'events.ts.ts',
          'items.ts.ts',
          'notes.ts.ts',
        ])

        const items = results['items.ts.ts']
        expect(items).toContain('  a: number;\n')
        expect(items).toContain('  b: string | null;\n')
        expect(items).toContain('  c: number | null;\n')

        const events = results['events.ts.ts']
        expect(events).toContain('  id: number;\n')

        const notes = results['notes.ts.ts']
        expect(notes).toContain('  id: number;\n')
        expect(notes).toContain('  title: string | null;\n')
        expect(notes).toContain('  body: string;\n')
        expect(notes).toContain('  note: string | null;\n')
      },
    )
  })

  it('treats table-level PRIMARY KEY columns as NOT NULL', async () => {
    await withSqlFile(
      `CREATE TABLE widgets (
  id integer,
  label text,
  PRIMARY KEY (id)
);
`,
      async (sqlFile) => {
        const results = await generate({
          origin: { type: 'sql', path: sqlFile, dialect: 'postgres' },
          destinations: [{ type: 'ts' }],
          dryRun: true,
          silent: true,
        })

        const widgets = results['widgets.ts.ts']
        expect(widgets).toContain('  id: number;\n')
        expect(widgets).toContain('  label: string | null;\n')
      },
    )
  })
})
