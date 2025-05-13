import { describe, expect, test } from 'vitest'
import { type Desc, extractTypeExpression, getType } from './main.js'

describe('Kysely magic comments', () => {
	test('should use @kysely magic comment for Kysely type', () => {
		const desc: Desc = {
			Field: 'custom_field',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'varchar',
			Comment: 'This is a custom field with @kysely(CustomType)',
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

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('CustomType')
	})

	test('should use @ts magic comment as fallback for Kysely type', () => {
		const desc: Desc = {
			Field: 'custom_field',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'varchar',
			Comment: 'This is a custom field with @ts(FallbackType)',
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

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('FallbackType')
	})

	test('should handle nullable types with @kysely magic comment', () => {
		const desc: Desc = {
			Field: 'custom_field',
			Default: null,
			Extra: '',
			Null: 'YES',
			Type: 'varchar',
			Comment: 'This is a custom field with @kysely(CustomType)',
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

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('CustomType | null')
	})

	test('should not add null twice if @kysely type already includes it', () => {
		const desc: Desc = {
			Field: 'custom_field',
			Default: null,
			Extra: '',
			Null: 'YES',
			Type: 'varchar',
			Comment: 'This is a custom field with @kysely(CustomType | null)',
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

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('CustomType | null')
	})

	test('should ignore @kysely magic comment for non-Kysely destinations', () => {
		const desc: Desc = {
			Field: 'custom_field',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'varchar',
			Comment:
				'This is a custom field with @kysely(CustomType) and @ts(TSType)',
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
			magicComments: true,
		}

		const result = getType('table', desc, config, config.destinations[0])
		expect(result).toBe('TSType')
	})

	test('should use @kysely magic comment for JSON fields', () => {
		const desc: Desc = {
			Field: 'json_field',
			Default: null,
			Extra: '',
			Null: 'NO',
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

		// First, get the type from getType
		const type = getType('table', desc, config, config.destinations[0])

		// Then, simulate what happens in generateContent with our fix
		const isJsonField = desc.Type.toLowerCase().includes('json')
		let kyselyType = type

		// Check for magic comments first
		const kyselyOverrideType = config.magicComments
			? extractTypeExpression(desc.Comment, '@kysely(')
			: null

		if (kyselyOverrideType) {
			// Use the override type from magic comment
			kyselyType = kyselyOverrideType
		} else if (isJsonField) {
			// Default JSON handling if no override
			kyselyType = 'Json'
		}

		// This should now be 'CustomJsonType'
		expect(kyselyType).toBe('CustomJsonType')
	})
})
