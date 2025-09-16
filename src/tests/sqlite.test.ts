import path from 'node:path'
import fs from 'fs-extra'
import knex from 'knex'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
	type Config,
	type Desc,
	defaultZodHeader,
	generate,
	generateContent,
	getType,
} from '../main.js'

describe('mutano with SQLite', () => {
	const dbPath = './test.db'
	const outputDir = './test-output'
	let db: ReturnType<typeof knex>

	// SQLite config with all destination types
	const sqliteConfig: Config = {
		origin: {
			type: 'sqlite',
			path: dbPath,
			overrideTypes: {
				json: 'z.record(z.string())',
				text: 'z.string().min(1)',
				integer: 'z.number().int()',
				datetime: 'z.date()',
			},
		},
		destinations: [
			{
				type: 'zod',
				useDateType: true,
				useTrim: true,
				nullish: true,
				requiredString: true,
				folder: path.join(outputDir, 'zod'),
				suffix: 'schema',
			},
			{
				type: 'ts',
				enumType: 'enum',
				modelType: 'interface',
				folder: path.join(outputDir, 'ts'),
				suffix: 'type',
			},
			{
				type: 'kysely',
				schemaName: 'TestDB',
				outFile: path.join(outputDir, 'kysely', 'db.ts'),
			},
		],
		camelCase: true,
		magicComments: true,
		dryRun: false,
	}

	beforeAll(async () => {
		fs.ensureDirSync(outputDir)
		db = knex({
			client: 'sqlite3',
			connection: {
				filename: dbPath,
			},
			useNullAsDefault: true,
		})

		await db.schema.createTable('users', (table) => {
			table.increments('id').primary()
			table
				.text('name')
				.notNullable()
				.comment('@zod(z.string().min(3).max(50))')
			table.text('email').notNullable().unique().comment('@ts(Email)')
			table.text('password').notNullable()
			table.text('profile_picture').nullable()
			table.text('bio').nullable()
			table.integer('age').nullable()
			table.float('score').defaultTo(0)
			table.boolean('is_active').defaultTo(true)
			table.datetime('created_at').defaultTo(db.fn.now())
			table.datetime('updated_at').nullable()
		})

		await db.schema.createTable('posts', (table) => {
			table.increments('id').primary()
			table.integer('user_id').notNullable()
			table.text('title').notNullable()
			table.text('content').nullable()
			table.text('status').defaultTo('draft')
			table.datetime('published_at').nullable()
			table.datetime('created_at').defaultTo(db.fn.now())
		})

		await db('users').insert([
			{
				name: 'John Doe',
				email: 'john@example.com',
				password: 'password123',
				bio: 'Software developer',
				age: 30,
				score: 4.5,
				is_active: true,
				created_at: new Date().toISOString(),
			},
			{
				name: 'Jane Smith',
				email: 'jane@example.com',
				password: 'password456',
				profile_picture: 'jane.jpg',
				bio: 'UX Designer',
				age: 28,
				score: 4.8,
				is_active: true,
				created_at: new Date().toISOString(),
			},
		])

		await db('posts').insert([
			{
				user_id: 1,
				title: 'First Post',
				content: 'This is my first post',
				status: 'published',
				published_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
			},
			{
				user_id: 2,
				title: 'Hello World',
				content: 'Welcome to my blog',
				status: 'draft',
				created_at: new Date().toISOString(),
			},
		])
	})

	afterAll(async () => {
		await db.destroy()
		fs.removeSync(dbPath)
		fs.removeSync(outputDir)
	})

	test('should generate all destination types from SQLite database', async () => {
		const result = await generate(sqliteConfig)

		expect(typeof result).toBe('object')
		expect(Object.keys(result).length).toBeGreaterThan(0)

		const fileNames = Object.keys(result).map((file) => path.basename(file))
		expect(fileNames).toContain('users.schema.ts')
		expect(fileNames).toContain('users.type.ts')
		expect(fileNames).toContain('posts.schema.ts')
		expect(fileNames).toContain('posts.type.ts')
		expect(fileNames).toContain('db.ts')
	})

	test('should generate with dryRun option', async () => {
		const dryRunConfig: Config = {
			...sqliteConfig,
			dryRun: true,
		}

		const result = await generate(dryRunConfig)
		expect(typeof result).toBe('object')
		expect(Object.keys(result).length).toBeGreaterThan(0)

		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		expect(fileContents['users.schema.ts']).toBeDefined()
		expect(fileContents['users.type.ts']).toBeDefined()
		expect(fileContents['db.ts']).toBeDefined()
	})

	test('should handle SQLite type mapping correctly', () => {
		const testCases: {
			desc: Desc
			expectedContains: string
			destination: 'zod' | 'ts' | 'kysely'
		}[] = [
			// Date types (stored as TEXT in SQLite)
			{
				desc: {
					Field: 'created_at',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'datetime',
					Comment: '',
				},
				expectedContains: 'date',
				destination: 'zod',
			},
			// String types (TEXT storage class)
			{
				desc: {
					Field: 'name',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'text',
					Comment: '',
				},
				expectedContains: 'string',
				destination: 'zod',
			},
			// Number types (INTEGER storage class)
			{
				desc: {
					Field: 'id',
					Default: null,
					Extra: 'auto_increment',
					Null: 'NO',
					Type: 'integer',
					Comment: '',
				},
				expectedContains: 'number',
				destination: 'zod',
			},
			// Boolean types (INTEGER 0/1 in SQLite)
			{
				desc: {
					Field: 'is_active',
					Default: '1',
					Extra: '',
					Null: 'NO',
					Type: 'boolean',
					Comment: '',
				},
				expectedContains: 'boolean',
				destination: 'zod',
			},
			// Magic comment types
			{
				desc: {
					Field: 'email',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'text',
					Comment: '@ts(Email)',
				},
				expectedContains: 'Email',
				destination: 'ts',
			},
		]

		for (const { desc, expectedContains, destination } of testCases) {
			const destinationConfig = sqliteConfig.destinations.find(
				(d) => d.type === destination,
			)!
			const result = getType('table', desc, sqliteConfig, destinationConfig)
			expect(result).toContain(expectedContains)
		}
	})

	test('should respect camelCase option', async () => {
		const camelCaseConfig: Config = {
			...sqliteConfig,
			camelCase: true,
			dryRun: true,
		}

		const result = await generate(camelCaseConfig)
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		expect(fileContents['users.schema.ts']).toContain('profilePicture:')
		expect(fileContents['users.type.ts']).toContain('profilePicture:')
		expect(fileContents['db.ts']).toContain('profilePicture:')
	})

	test('should respect custom headers', async () => {
		const customHeaderConfig: Config = {
			...sqliteConfig,
			destinations: [
				{
					type: 'zod',
					header:
						"import { z } from 'zod';\nimport { customValidator } from './validators';",
					folder: path.join(outputDir, 'custom-header'),
					suffix: 'schema',
				},
				{
					type: 'ts',
					header:
						"import type { Email } from './types';\nimport type { BaseModel } from './models';",
					folder: path.join(outputDir, 'custom-header'),
					suffix: 'type',
				},
				{
					type: 'kysely',
					header:
						"import { Generated, ColumnType } from 'kysely';\nimport { CustomTypes } from './types';",
					outFile: path.join(outputDir, 'custom-header', 'db.ts'),
				},
			],
			dryRun: true,
		}

		const result = await generate(customHeaderConfig)
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		expect(fileContents['users.schema.ts']).toContain(
			"import { customValidator } from './validators';",
		)
		expect(fileContents['users.type.ts']).toContain(
			"import type { Email } from './types';",
		)
		expect(fileContents['db.ts']).toContain(
			"import { CustomTypes } from './types';",
		)
	})

	test('should respect type overrides from config', async () => {
		const overrideConfig: Config = {
			origin: {
				type: 'sqlite',
				path: dbPath,
				overrideTypes: {
					text: 'z.string().max(1000)',
					integer: 'z.number().positive()',
					datetime: 'z.date().optional()',
				},
			},
			destinations: sqliteConfig.destinations,
			camelCase: true,
			magicComments: true,
			dryRun: true,
		}

		const result = await generate(overrideConfig)

		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		expect(fileContents['posts.schema.ts']).toContain('z.string().trim()')
		expect(fileContents['users.schema.ts']).toContain('z.number().nonnegative()')
	})

	test('should generate content for all destination types', () => {
		const describes: Desc[] = [
			{
				Field: 'id',
				Default: null,
				Extra: 'auto_increment',
				Null: 'NO',
				Type: 'integer',
				Comment: '',
			},
			{
				Field: 'name',
				Default: null,
				Extra: '',
				Null: 'NO',
				Type: 'text',
				Comment: '@zod(z.string().min(3).max(50))',
			},
			{
				Field: 'email',
				Default: null,
				Extra: '',
				Null: 'NO',
				Type: 'text',
				Comment: '@ts(Email)',
			},
			{
				Field: 'score',
				Default: '0',
				Extra: '',
				Null: 'YES',
				Type: 'real',
				Comment: '',
			},
			{
				Field: 'created_at',
				Default: 'CURRENT_TIMESTAMP',
				Extra: 'DEFAULT_GENERATED',
				Null: 'NO',
				Type: 'datetime',
				Comment: '',
			},
		]

		const zodContent = generateContent({
			table: 'test_table',
			describes,
			config: sqliteConfig,
			destination: sqliteConfig.destinations[0],
			isCamelCase: true,
			enumDeclarations: {},
			defaultZodHeader,
		})

		expect(zodContent).toContain("import { z } from 'zod';")
		expect(zodContent).toContain('export const test_table = z.object({')
		expect(zodContent).toContain('id:')
		expect(zodContent).toContain('name:')
		expect(zodContent).toContain('email:')
		expect(zodContent).toContain('score:')
		expect(zodContent).toContain('createdAt:')
		expect(zodContent).toContain(
			'export const insertable_test_table = z.object({',
		)
		expect(zodContent).toContain(
			'export const updateable_test_table = z.object({',
		)
		expect(zodContent).toContain(
			'export const selectable_test_table = z.object({',
		)

		const tsContent = generateContent({
			table: 'test_table',
			describes,
			config: sqliteConfig,
			destination: sqliteConfig.destinations[1],
			isCamelCase: true,
			enumDeclarations: {},
			defaultZodHeader,
		})

		expect(tsContent).toContain('// TypeScript interfaces for test_table')
		expect(tsContent).toContain('export interface TestTable {')
		expect(tsContent).toContain('id:')
		expect(tsContent).toContain('name:')
		expect(tsContent).toContain('email:')
		expect(tsContent).toContain('score:')
		expect(tsContent).toContain('createdAt:')
		expect(tsContent).toContain('export interface InsertableTestTable {')
		expect(tsContent).toContain('export interface UpdateableTestTable {')
		expect(tsContent).toContain('export interface SelectableTestTable {')

		const kyselyContent = generateContent({
			table: 'test_table',
			describes,
			config: sqliteConfig,
			destination: sqliteConfig.destinations[2],
			isCamelCase: true,
			enumDeclarations: {},
			defaultZodHeader,
		})

		expect(kyselyContent).toContain('// Kysely type definitions for test_table')
		expect(kyselyContent).toContain('export interface TestTableTable {')
		expect(kyselyContent).toContain('id:')
		expect(kyselyContent).toContain('name:')
		expect(kyselyContent).toContain('email:')
		expect(kyselyContent).toContain('score:')
		expect(kyselyContent).toContain('createdAt:')
		expect(kyselyContent).toContain(
			'export type TestTable = Selectable<TestTableTable>;',
		)
		expect(kyselyContent).toContain(
			'export type NewTestTable = Insertable<TestTableTable>;',
		)
		expect(kyselyContent).toContain(
			'export type TestTableUpdate = Updateable<TestTableTable>;',
		)
	})
})
