import { describe, expect, test } from 'vitest'
import { type Desc, getType } from '../main.js'

describe('BigInt type handling', () => {
	test('should convert MySQL bigint type to Kysely BigInt type', () => {
		const desc: Desc = {
			Field: 'big_number',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'bigint',
			Comment: '',
		}

		const config = {
			origin: {
				type: 'mysql' as const,
				path: './schema.sql',
				host: 'localhost',
				port: 3306,
				user: 'root',
				password: '',
				database: 'test',
			},
			destinations: [
				{
					type: 'kysely' as const,
				},
			],
		}

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('BigInt')
	})

	test('should convert Prisma BigInt type to Kysely BigInt type', () => {
		const desc: Desc = {
			Field: 'big_number',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'BigInt',
			Comment: '',
		}

		const config = {
			origin: {
				type: 'prisma' as const,
				path: './schema.prisma',
			},
			destinations: [
				{
					type: 'kysely' as const,
				},
			],
		}

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('BigInt')
	})

	test('should convert BigInt type to string for TypeScript', () => {
		const desc: Desc = {
			Field: 'big_number',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'bigint',
			Comment: '',
		}

		const config = {
			origin: {
				type: 'mysql' as const,
				path: './schema.sql',
				host: 'localhost',
				port: 3306,
				user: 'root',
				password: '',
				database: 'test',
			},
			destinations: [
				{
					type: 'ts' as const,
				},
			],
		}

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('string')
	})

	test('should wrap BigInt with default value in Generated<>', () => {
		const desc: Desc = {
			Field: 'big_number',
			Default: '0',
			Extra: '',
			Null: 'NO',
			Type: 'bigint',
			Comment: '',
		}

		const config = {
			origin: {
				type: 'mysql' as const,
				path: './schema.sql',
				host: 'localhost',
				port: 3306,
				user: 'root',
				password: '',
				database: 'test',
			},
			destinations: [
				{
					type: 'kysely' as const,
				},
			],
		}

		const type = getType('table', desc, config, config.destinations[0])
		let kyselyType = type
		const hasDefaultValue = desc.Default !== null

		if (hasDefaultValue && kyselyType === 'BigInt') {
			kyselyType = `Generated<${kyselyType}>`
		}

		expect(kyselyType).toBe('Generated<BigInt>')
	})
})
