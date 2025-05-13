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
} from './main.js'

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

	// Setup test database
	beforeAll(async () => {
		// Create test directory
		fs.ensureDirSync(outputDir)

		// Create SQLite database
		db = knex({
			client: 'sqlite3',
			connection: {
				filename: dbPath,
			},
			useNullAsDefault: true,
		})

		// Create test tables with SQLite-specific types
		await db.schema.createTable('users', (table) => {
			table.increments('id').primary() // SQLite integer primary key
			table
				.text('name')
				.notNullable()
				.comment('@zod(z.string().min(3).max(50))') // TEXT type
			table.text('email').notNullable().unique().comment('@ts(Email)') // TEXT type
			table.text('password').notNullable() // TEXT type
			table.text('profile_picture').nullable() // TEXT type that can be null
			table.text('bio').nullable() // TEXT type with potentially longer content
			table.integer('age').nullable() // INTEGER type
			table.float('score').defaultTo(0) // REAL type (floating point)
			table.boolean('is_active').defaultTo(true) // INTEGER 0/1 internally
			table.datetime('created_at').defaultTo(db.fn.now()) // TEXT in ISO format internally
			table.datetime('updated_at').nullable() // TEXT in ISO format that can be null
		})

		await db.schema.createTable('posts', (table) => {
			table.increments('id').primary() // SQLite integer primary key
			table.integer('user_id').notNullable() // INTEGER type
			table.text('title').notNullable() // TEXT type
			table.text('content').nullable() // TEXT type for longer content
			table.text('status').defaultTo('draft') // TEXT type with default
			table.datetime('published_at').nullable() // TEXT in ISO format that can be null
			table.datetime('created_at').defaultTo(db.fn.now()) // TEXT in ISO format
		})

		// Insert some test data
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

	// Clean up after tests
	afterAll(async () => {
		await db.destroy()
		fs.removeSync(dbPath)
		fs.removeSync(outputDir)
	})

	test('should generate all destination types from SQLite database', async () => {
		const result = await generate(sqliteConfig)

		// Check if files were created
		expect(typeof result).toBe('object')
		expect(Object.keys(result).length).toBeGreaterThan(0)

		// Check for specific files - now using absolute paths
		const fileNames = Object.keys(result).map((file) => path.basename(file))
		expect(fileNames).toContain('users.schema.ts')
		expect(fileNames).toContain('users.type.ts')
		expect(fileNames).toContain('posts.schema.ts')
		expect(fileNames).toContain('posts.type.ts')
		expect(fileNames).toContain('db.ts') // Consolidated Kysely file
	})

	test('should generate with dryRun option', async () => {
		const dryRunConfig: Config = {
			...sqliteConfig,
			dryRun: true,
		}

		const result = await generate(dryRunConfig)

		// Check if content was returned
		expect(typeof result).toBe('object')
		expect(Object.keys(result).length).toBeGreaterThan(0)

		// Get the file contents by basename
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		expect(fileContents['users.schema.ts']).toBeDefined()
		expect(fileContents['users.type.ts']).toBeDefined()
		expect(fileContents['db.ts']).toBeDefined() // Consolidated Kysely file
	})

	test('should handle SQLite type mapping correctly', () => {
		// In SQLite, we need to focus on the actual types that SQLite supports
		// SQLite has dynamic typing with storage classes: NULL, INTEGER, REAL, TEXT, and BLOB
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
		// Create a temporary config with camelCase enabled
		const camelCaseConfig: Config = {
			...sqliteConfig,
			camelCase: true,
			dryRun: true,
		}

		const result = await generate(camelCaseConfig)

		// Check if camelCase was applied
		// Get the file contents by basename
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		// Check Zod output
		expect(fileContents['users.schema.ts']).toContain('profilePicture:')

		// Check TypeScript output
		expect(fileContents['users.type.ts']).toContain('profilePicture:')

		// Check Kysely output
		expect(fileContents['db.ts']).toContain('profilePicture:')
	})

	test('should respect custom headers', async () => {
		// Create a temporary config with custom headers
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

		// Check if custom headers were applied
		// Get the file contents by basename
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		// Check Zod output
		expect(fileContents['users.schema.ts']).toContain(
			"import { customValidator } from './validators';",
		)

		// Check TypeScript output
		expect(fileContents['users.type.ts']).toContain(
			"import type { Email } from './types';",
		)

		// Check Kysely output
		expect(fileContents['db.ts']).toContain(
			"import { CustomTypes } from './types';",
		)
	})

	test('should respect type overrides from config', async () => {
		// Create a temporary config with type overrides
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

		// Check if type overrides were applied
		// Get the file contents by basename
		const fileContents: Record<string, string> = {}
		for (const [filePath, content] of Object.entries(result)) {
			fileContents[path.basename(filePath)] = content
		}

		// Check for the overridden text type
		expect(fileContents['posts.schema.ts']).toContain('z.string().max(1000)')

		// Check for the overridden integer type
		expect(fileContents['users.schema.ts']).toContain('z.number().positive()')
	})

	test('should generate content for all destination types', () => {
		// Use only SQLite-compatible types
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

		// Test Zod content generation
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

		// Test TypeScript content generation
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
		expect(kyselyContent).toContain('export interface TestTable {')
		expect(kyselyContent).toContain('id:')
		expect(kyselyContent).toContain('name:')
		expect(kyselyContent).toContain('email:')
		expect(kyselyContent).toContain('score:')
		expect(kyselyContent).toContain('createdAt:')
		expect(kyselyContent).toContain(
			'export type SelectableTestTable = Selectable<TestTable>;',
		)
		expect(kyselyContent).toContain(
			'export type InsertableTestTable = Insertable<TestTable>;',
		)
		expect(kyselyContent).toContain(
			'export type UpdateableTestTable = Updateable<TestTable>;',
		)
	})
})
