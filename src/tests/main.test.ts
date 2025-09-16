import { describe, test } from 'vitest'
import {
	type Config,
	type Desc,
	defaultZodHeader,
	generateContent,
	getType,
} from '../main.js'

describe('mutano', () => {
	const mysqlConfig: Config = {
		origin: {
			type: 'mysql',
			host: 'localhost',
			port: 3306,
			user: 'root',
			password: 'password',
			database: 'rise',
			overrideTypes: {
				json: 'z.record(z.string())',
			},
		},
		destinations: [
			{
				type: 'zod',
				version: 4,
				useDateType: true,
				useTrim: false,
				nullish: true,
				requiredString: true,
				folder: './zod',
				suffix: 'schema',
			},
		],
		camelCase: true,
		magicComments: true,
	}

	const mysqlTsConfig: Config = {
		origin: {
			type: 'mysql',
			host: 'localhost',
			port: 3306,
			user: 'root',
			password: 'password',
			database: 'rise',
			overrideTypes: {
				json: 'z.record(z.string())',
			},
		},
		destinations: [
			{
				type: 'ts',
				folder: './ts',
				suffix: 'type',
			},
		],
		camelCase: true,
		magicComments: true,
	}

	const mysqlKyselyConfig: Config = {
		origin: {
			type: 'mysql',
			host: 'localhost',
			port: 3306,
			user: 'root',
			password: 'password',
			database: 'rise',
			overrideTypes: {
				json: 'z.record(z.string())',
			},
		},
		destinations: [
			{
				type: 'kysely',
				outFile: './kysely/db.ts',
			},
		],
		camelCase: true,
		magicComments: true,
	}

	test('should return a custom Zod date field for date, datetime, and timestamp types', ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'date',
			Field: 'date',
			Comment: '',
		}
		const result = getType(
			'table',
			desc,
			mysqlConfig,
			mysqlConfig.destinations[0],
		)
		expect(result).toEqual(
			'z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())',
		)
	})

	test('should return a Zod string field for text, mediumtext, longtext, json, decimal, time, year, char, and varchar types', ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: '',
			Null: 'NO' as const,
			Type: 'varchar',
			Field: 'varchar',
			Comment: '',
		}
		const result = getType(
			'table',
			desc,
			mysqlConfig,
			mysqlConfig.destinations[0],
		)
		expect(result).toEqual('z.string().min(1)')
	})

	test('should return a Zod string with trim() if useTrim is true', ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: '',
			Null: 'NO' as const,
			Type: 'varchar',
			Field: 'varchar',
			Comment: '',
		}
		const configWithTrim: Config = {
			...mysqlConfig,
			destinations: [
				{
					type: 'zod',
					useDateType: true,
					useTrim: true,
					nullish: true,
					requiredString: true,
					folder: './generated',
					suffix: 'schema',
				},
			],
		}
		const result = getType(
			'table',
			desc,
			configWithTrim,
			configWithTrim.destinations[0],
		)
		expect(result).toEqual('z.string().trim().min(1)')
	})

	describe('Content generation', () => {
		test('should generate Zod schema content without a database connection', ({
			expect,
		}) => {
			const table = 'user'
			const describes: Desc[] = [
				{
					Field: 'id',
					Default: null,
					Extra: 'auto_increment',
					Null: 'NO',
					Type: 'int',
					Comment: '',
				},
				{
					Field: 'name',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'varchar',
					Comment: '',
				},
				{
					Field: 'metadata',
					Default: '{}',
					Extra: '',
					Null: 'YES',
					Type: 'json',
					Comment: '',
				},
			]

			const content = generateContent({
				table,
				describes,
				config: mysqlConfig,
				destination: mysqlConfig.destinations[0],
				isCamelCase: false,
				enumDeclarations: {},
				defaultZodHeader,
			})

			expect(content).toContain("import { z } from 'zod/v4';")
			expect(content).toContain('export const user = z.object({')
			expect(content).toContain('id: z.number().nonnegative(),')
			expect(content).toContain('name: z.string().min(1),')
		})

		test('should generate TypeScript interface content without a database connection', ({
			expect,
		}) => {
			const table = 'user'
			const describes: Desc[] = [
				{
					Field: 'id',
					Default: null,
					Extra: 'auto_increment',
					Null: 'NO',
					Type: 'int',
					Comment: '',
				},
				{
					Field: 'name',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'varchar',
					Comment: '',
				},
				{
					Field: 'metadata',
					Default: '{}',
					Extra: '',
					Null: 'YES',
					Type: 'json',
					Comment: '',
				},
			]

			const content = generateContent({
				table,
				describes,
				config: mysqlTsConfig,
				destination: mysqlTsConfig.destinations[0],
				isCamelCase: false,
				enumDeclarations: {},
				defaultZodHeader,
			})

			expect(content).toContain('export interface User {')
			expect(content).toContain('id: number;')
			expect(content).toContain('name: string;')
			expect(content).toContain('metadata: z.record(z.string()) | null;')
		})

		test('should generate Kysely schema content without a database connection', ({
			expect,
		}) => {
			const table = 'user'
			const describes: Desc[] = [
				{
					Field: 'id',
					Default: null,
					Extra: 'auto_increment',
					Null: 'NO',
					Type: 'int',
					Comment: '',
				},
				{
					Field: 'name',
					Default: null,
					Extra: '',
					Null: 'NO',
					Type: 'varchar',
					Comment: '',
				},
				{
					Field: 'metadata',
					Default: '{}',
					Extra: '',
					Null: 'YES',
					Type: 'json',
					Comment: '',
				},
			]

			const content = generateContent({
				table,
				describes,
				config: mysqlKyselyConfig,
				destination: mysqlKyselyConfig.destinations[0],
				isCamelCase: false,
				enumDeclarations: {},
				defaultZodHeader,
			})

			expect(content).toContain('// Kysely type definitions for user')
			expect(content).toContain('export interface User {')
			expect(content).toContain('id: Generated<')
			expect(content).toContain('name:')
			expect(content).toContain('metadata: Generated<Json> | null;') // Has default value '{}' so should be Generated<>
			expect(content).toContain(
				'export type SelectableUser = Selectable<User>;',
			)
			expect(content).toContain(
				'export type InsertableUser = Insertable<User>;',
			)
			expect(content).toContain(
				'export type UpdateableUser = Updateable<User>;',
			)
		})
	})
})
