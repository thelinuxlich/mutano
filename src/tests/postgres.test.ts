import path from 'node:path'
import fs from 'fs-extra'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
	type Config,
	type Desc,
	defaultZodHeader,
	generateContent,
	getType,
} from '../main.js'

describe('mutano with PostgreSQL (pglite)', () => {
	const outputDir = './test-output-postgres'
	let pglite: PGlite

	// PostgreSQL config for testing type generation
	const postgresConfig: Config = {
		origin: {
			type: 'postgres',
			host: 'localhost',
			port: 5432,
			user: 'postgres',
			password: 'password',
			database: 'test',
			schema: 'public',
			overrideTypes: {
				jsonb: 'z.record(z.string())',
				text: 'z.string().min(1)',
				integer: 'z.number().int()',
				'timestamp with time zone': 'z.date()',
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
				enumType: 'union',
				modelType: 'interface',
				folder: path.join(outputDir, 'ts'),
				suffix: 'type',
			},
			{
				type: 'kysely',
				schemaName: 'TestPostgresDB',
				outFile: path.join(outputDir, 'kysely', 'db.ts'),
			},
		],
		camelCase: true,
		magicComments: true,
		includeViews: true,
		dryRun: false,
	}

	beforeAll(async () => {
		fs.ensureDirSync(outputDir)

		// Initialize PGlite
		pglite = new PGlite()

		// Create tables with PostgreSQL-specific features
		await pglite.exec(`
			-- Create enum type
			CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending');

			-- Create users table
			CREATE TABLE users (
				id SERIAL PRIMARY KEY,
				uuid_field TEXT NOT NULL DEFAULT 'uuid-placeholder',
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) UNIQUE NOT NULL,
				password TEXT NOT NULL,
				profile_picture TEXT,
				bio TEXT,
				age INTEGER,
				score DECIMAL(3,2) DEFAULT 0.0,
				is_active BOOLEAN DEFAULT true,
				status user_status DEFAULT 'pending',
				metadata JSONB,
				tags TEXT[],
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE
			);
			
			-- Add comment for magic comment testing
			COMMENT ON COLUMN users.metadata IS '@ts(UserMetadata) @kysely(Record<string, any>)';
			COMMENT ON COLUMN users.name IS '@zod(z.string().min(2).max(100))';
			
			-- Create posts table
			CREATE TABLE posts (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id),
				title VARCHAR(500) NOT NULL,
				content TEXT,
				status VARCHAR(20) DEFAULT 'draft',
				published_at TIMESTAMP WITH TIME ZONE,
				view_count INTEGER DEFAULT 0,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);
			
			-- Create a view for testing views functionality
			CREATE VIEW user_profile_view AS
			SELECT 
				u.id,
				u.name,
				u.email,
				u.bio,
				u.status,
				u.created_at,
				COUNT(p.id) as post_count
			FROM users u
			LEFT JOIN posts p ON u.id = p.user_id
			GROUP BY u.id, u.name, u.email, u.bio, u.status, u.created_at;
			
			-- Create another view with JSON data
			CREATE VIEW user_stats_view AS
			SELECT 
				u.id,
				u.name,
				u.metadata,
				COUNT(p.id) as total_posts,
				AVG(p.view_count) as avg_views
			FROM users u
			LEFT JOIN posts p ON u.id = p.user_id
			GROUP BY u.id, u.name, u.metadata;
		`)

		// Insert test data
		await pglite.exec(`
			INSERT INTO users (name, email, password, bio, age, score, status, metadata, tags) VALUES
			('John Doe', 'john@example.com', 'password123', 'Software developer', 30, 4.5, 'active', '{"role": "admin", "preferences": {"theme": "dark"}}', ARRAY['developer', 'typescript']),
			('Jane Smith', 'jane@example.com', 'password456', 'UX Designer', 28, 4.8, 'active', '{"role": "user", "preferences": {"theme": "light"}}', ARRAY['designer', 'figma']);
			
			INSERT INTO posts (user_id, title, content, status, view_count) VALUES
			(1, 'First Post', 'This is my first post', 'published', 150),
			(1, 'Second Post', 'Another great post', 'published', 89),
			(2, 'Hello World', 'Welcome to my blog', 'draft', 0);
		`)
	})

	afterAll(async () => {
		await pglite.close()
		fs.removeSync(outputDir)
	})

	test('should test PostgreSQL schema extraction with pglite', async () => {
		// Test that we can create tables and extract schema information
		// This validates that the PostgreSQL integration works with pglite

		// Create a simple table structure
		await pglite.exec(`
			CREATE TABLE test_users (
				id SERIAL PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email TEXT UNIQUE NOT NULL,
				metadata JSONB,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);
		`)

		// Query the schema information like Mutano would
		const result = await pglite.query(`
			SELECT
				column_name as "Field",
				column_default as "Default",
				is_nullable as "Null",
				data_type as "Type",
				'' as "Extra",
				'' as "Comment"
			FROM information_schema.columns
			WHERE table_name = 'test_users'
			AND table_schema = 'public'
			ORDER BY ordinal_position;
		`)

		expect(result.rows.length).toBeGreaterThan(0)

		// Check that we got the expected columns
		const columnNames = result.rows.map((row: any) => row.Field)
		expect(columnNames).toContain('id')
		expect(columnNames).toContain('name')
		expect(columnNames).toContain('email')
		expect(columnNames).toContain('metadata')
		expect(columnNames).toContain('created_at')

		// Check that JSONB type is detected correctly
		const metadataColumn = result.rows.find((row: any) => row.Field === 'metadata') as any
		expect(metadataColumn?.Type).toBe('jsonb')
	})

	test('should handle PostgreSQL-specific types correctly', () => {
		const testCases = [
			{
				desc: {
					Field: 'uuid_field',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'uuid',
					Comment: '',
				} as Desc,
				expectedContains: 'z.string()',
				destination: 'zod' as const,
			},
			{
				desc: {
					Field: 'jsonb_field',
					Default: null,
					Extra: '',
					Null: 'YES',
					Type: 'jsonb',
					Comment: '',
				} as Desc,
				expectedContains: 'Json | null',
				destination: 'kysely' as const,
			},
			{
				desc: {
					Field: 'enum_field',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'USER-DEFINED',
					EnumOptions: ['active', 'inactive', 'pending'],
					Comment: '',
				} as Desc,
				expectedContains: "string",
				destination: 'ts' as const,
			},
			{
				desc: {
					Field: 'timestamp_field',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'timestamp with time zone',
					Comment: '',
				} as Desc,
				expectedContains: 'z.date()',
				destination: 'ts' as const,
			},
		]

		for (const { desc, expectedContains, destination } of testCases) {
			const destinationConfig = postgresConfig.destinations.find(
				(d: any) => d.type === destination,
			)!
			const result = getType('table', desc, postgresConfig, destinationConfig)
			expect(result).toContain(expectedContains)
		}
	})

	test('should handle PostgreSQL magic comments', () => {
		const desc: Desc = {
			Field: 'metadata',
			Default: null,
			Extra: '',
			Null: 'YES',
			Type: 'jsonb',
			Comment: '@ts(UserMetadata) @kysely(Record<string, any>)',
		}

		// Test TypeScript magic comment
		const tsResult = getType('table', desc, postgresConfig, {
			type: 'ts',
		})
		expect(tsResult).toContain('UserMetadata')  // @ts magic comment completely overrides (no | null added)

		// Test Kysely magic comment
		const kyselyResult = getType('table', desc, postgresConfig, {
			type: 'kysely',
		})
		expect(kyselyResult).toContain('Record<string, any>')  // @kysely magic comment completely overrides (no | null added)
	})

	test('should generate content for PostgreSQL tables', () => {
		const describes: Desc[] = [
			{
				Field: 'id',
				Default: "nextval('users_id_seq'::regclass)",
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
				Type: 'character varying',
				Comment: '@zod(z.string().min(2).max(100))',
			},
			{
				Field: 'status',
				Default: "'pending'::user_status",
				Extra: '',
				Null: 'NO',
				Type: 'USER-DEFINED',
				EnumOptions: ['active', 'inactive', 'pending'],
				Comment: '',
			},
		]

		const content = generateContent({
			table: 'users',
			describes,
			config: postgresConfig,
			destination: { type: 'zod' },
			isCamelCase: false,
			enumDeclarations: {},
			defaultZodHeader,
		})

		expect(content).toContain('export const users = z.object({')
		expect(content).toContain('name: z.string().min(2).max(100)')
		expect(content).toContain("status: z.string()")
		expect(content).toContain('export type UsersType = z.infer<typeof users>')
	})
})
