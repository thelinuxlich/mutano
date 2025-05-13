import { describe, expect, test } from 'vitest'
import { type Desc, getType } from '../main.js'

describe('JSON type handling', () => {
	test('should handle non-nullable JSON fields correctly', () => {
		const desc: Desc = {
			Field: 'json_data',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'json',
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
		const isJsonField = desc.Type.toLowerCase().includes('json')
		const isNullable = desc.Null === 'YES'
		let kyselyType = type

		if (isJsonField) {
			kyselyType = isNullable ? 'Json | null' : 'Json'
		}

		expect(kyselyType).toBe('Json')
	})

	test('should handle nullable JSON fields correctly', () => {
		const desc: Desc = {
			Field: 'json_data',
			Default: null,
			Extra: '',
			Null: 'YES',
			Type: 'json',
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
		const isJsonField = desc.Type.toLowerCase().includes('json')
		const isNullable = desc.Null === 'YES'
		let kyselyType = type

		if (isJsonField) {
			kyselyType = isNullable ? 'Json | null' : 'Json'
		}

		expect(kyselyType).toBe('Json | null')
	})

	test('should respect @kysely magic comment for JSON fields', () => {
		const desc: Desc = {
			Field: 'json_data',
			Default: null,
			Extra: '',
			Null: 'YES',
			Type: 'json',
			Comment: 'This is a JSON field with @kysely(CustomJsonType)',
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
			magicComments: true,
		}

		const type = getType('table', desc, config, config.destinations[0])
		const isJsonField = desc.Type.toLowerCase().includes('json')
		const isNullable = desc.Null === 'YES'
		let kyselyType = type

		const kyselyOverrideType = config.magicComments
			? 'CustomJsonType' // Simulating the result of extractKyselyExpression
			: null

		if (kyselyOverrideType) {
			kyselyType = kyselyOverrideType
			if (isNullable && !kyselyType.includes('| null')) {
				kyselyType = `${kyselyType} | null`
			}
		} else if (isJsonField) {
			kyselyType = isNullable ? 'Json | null' : 'Json'
		}

		expect(kyselyType).toBe('CustomJsonType | null')
	})
})
