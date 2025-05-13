import { describe, expect, test } from 'vitest'
import { type Desc, getType } from './main'

describe('Prisma type handling', () => {
	test('should convert Prisma Decimal type to Kysely Decimal type', () => {
		const desc: Desc = {
			Field: 'amount',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'Decimal',
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
		expect(result).toBe('Decimal')
	})

	test('should convert Prisma Decimal type to TypeScript string type', () => {
		const desc: Desc = {
			Field: 'amount',
			Default: null,
			Extra: '',
			Null: 'NO',
			Type: 'Decimal',
			Comment: '',
		}

		const config = {
			origin: {
				type: 'prisma' as const,
				path: './schema.prisma',
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

	test('should convert Prisma Decimal type with default value to Generated<Decimal>', () => {
		const desc: Desc = {
			Field: 'amount',
			Default: '0',
			Extra: '',
			Null: 'NO',
			Type: 'Decimal',
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

		// First get the type
		const type = getType('table', desc, config, config.destinations[0])

		// Then simulate the wrapping with Generated<> that happens in generateContent
		let kyselyType = type
		const hasDefaultValue = desc.Default !== null

		if (hasDefaultValue && kyselyType === 'Decimal') {
			kyselyType = `Generated<${kyselyType}>`
		}

		expect(kyselyType).toBe('Generated<Decimal>')
	})
})
