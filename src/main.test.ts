import { describe, test } from 'vitest'
import { type Config, type Desc, getType } from './main.js'

describe('getType', () => {
  const config: Config = {
    origin: {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'rise',
    },
    camelCase: true,
    nullish: true,
    requiredString: true,
    useDateType: true,
    overrideTypes: {
      json: 'z.record(z.string())',
    },
    zodCommentTypes: true,
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
    const result = getType('table', desc, config)
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
    const result = getType('table', desc, config)
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
    const result = getType('table', desc, { ...config, useTrim: true })
    expect(result).toEqual('z.string().trim().min(1)')
  })

  test('should return a custom Zod boolean field for tinyint types', ({
    expect,
  }) => {
    const desc: Desc = {
      Default: '0',
      Extra: '',
      Null: 'NO',
      Field: 'tinyint',
      Type: 'tinyint',
      Comment: '',
    }
    const result = getType('table', desc, config)
    expect(result).toEqual(
      'z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean()).optional().default(false)',
    )
  })

  test('should return a Zod number field for smallint, mediumint, int, bigint, float, and double types', ({
    expect,
  }) => {
    const desc: Desc = {
      Default: '0',
      Extra: '',
      Null: 'NO',
      Field: 'int',
      Type: 'int',
      Comment: '',
    }
    const result = getType('table', desc, config)
    expect(result).toEqual('z.number().optional().default(0)')
  })

  test('should return a Zod enum field for enum types', ({ expect }) => {
    const desc: Desc = {
      Default: 'foo',
      Extra: '',
      Null: 'NO',
      Field: 'enum',
      Type: "enum('foo', 'bar', 'baz')",
      Comment: '',
    }
    const result = getType('table', desc, config)
    expect(result).toEqual(
      "z.enum(['foo', 'bar', 'baz']).optional().default('foo')",
    )
  })

  test('should return undefined for insertable and updateable fields that are not null and have a default value', ({
    expect,
  }) => {
    const desc: Desc = {
      Default: 'CURRENT_TIMESTAMP',
      Extra: 'DEFAULT_GENERATED',
      Null: 'NO',
      Field: 'timestamp',
      Type: 'timestamp',
      Comment: '',
    }
    let result = getType('insertable', desc, config)
    expect(result).toEqual(undefined)
    result = getType('updateable', desc, config)
    expect(result).toEqual(undefined)
  })

  test('should override a field type if a @zod commment exists on the column', ({
    expect,
  }) => {
    const desc: Desc = {
      Default: '0',
      Extra: '',
      Null: 'NO',
      Field: 'int',
      Type: 'int',
      Comment: '@ts(Foo) @zod(z.number().nonnegative().min(10))',
    }
    const result = getType('table', desc, config)
    expect(result).toEqual(
      'z.number().nonnegative().min(10).optional().default(0)',
    )
  })

  test('should override a field type if a overrideTypes config exists on the column', ({
    expect,
  }) => {
    const desc: Desc = {
      Default: '{}',
      Extra: '',
      Null: 'NO',
      Field: 'json',
      Type: 'json',
      Comment: '',
    }
    const result = getType('table', desc, config)
    expect(result).toEqual("z.record(z.string()).optional().default('{}')")
  })

  test('should throw an error for unsupported column types', ({ expect }) => {
    const desc: Desc = {
      Default: null,
      Extra: '',
      Null: 'NO',
      Field: 'unsupported',
      Type: 'unsupported',
      Comment: '',
    }
    expect(() => getType('table', desc, config)).toThrowError(
      'Unsupported column type: unsupported',
    )
  })
})
