import { describe, expect, test } from 'vitest'
import { hasIgnoreDirective, hasTableIgnoreDirective } from '../utils/magic-comments.js'

describe('SQL @ignore and @@ignore directives', () => {
  describe('hasIgnoreDirective', () => {
    test('should detect @ignore directive in column comment', () => {
      expect(hasIgnoreDirective('@ignore')).toBe(true)
      expect(hasIgnoreDirective('This field should be ignored @ignore')).toBe(true)
      expect(hasIgnoreDirective('Internal field @ignore - do not expose')).toBe(true)
    })

    test('should not detect @ignore when not present', () => {
      expect(hasIgnoreDirective('')).toBe(false)
      expect(hasIgnoreDirective('Regular comment')).toBe(false)
      expect(hasIgnoreDirective('@ts(CustomType)')).toBe(false)
      expect(hasIgnoreDirective('@zod(z.string())')).toBe(false)
    })

    test('should work with mixed magic comments', () => {
      expect(hasIgnoreDirective('@ts(CustomType) @ignore')).toBe(true)
      expect(hasIgnoreDirective('@ignore @ts(CustomType)')).toBe(true)
      expect(hasIgnoreDirective('@zod(z.string()) @ignore @ts(string)')).toBe(true)
    })
  })

  describe('hasTableIgnoreDirective', () => {
    test('should detect @@ignore directive in table comment', () => {
      expect(hasTableIgnoreDirective('@@ignore')).toBe(true)
      expect(hasTableIgnoreDirective('Internal table @@ignore')).toBe(true)
      expect(hasTableIgnoreDirective('Temporary table @@ignore - do not expose')).toBe(true)
    })

    test('should not detect @@ignore when not present', () => {
      expect(hasTableIgnoreDirective('')).toBe(false)
      expect(hasTableIgnoreDirective('Regular comment')).toBe(false)
      expect(hasTableIgnoreDirective('@ignore')).toBe(false)
      expect(hasTableIgnoreDirective('@ts(CustomType)')).toBe(false)
    })

    test('should distinguish between @ignore and @@ignore', () => {
      expect(hasTableIgnoreDirective('@ignore')).toBe(false)
      expect(hasTableIgnoreDirective('@@ignore')).toBe(true)
    })
  })

  describe('Column-level @ignore filtering', () => {
    test('should filter out columns with @ignore in MySQL', () => {
      const columns = [
        {
          Field: 'id',
          Default: null,
          Extra: 'auto_increment',
          Null: 'NO',
          Type: 'int',
          Comment: '',
        },
        {
          Field: 'email',
          Default: null,
          Extra: '',
          Null: 'NO',
          Type: 'varchar(255)',
          Comment: '',
        },
        {
          Field: 'password_hash',
          Default: null,
          Extra: '',
          Null: 'NO',
          Type: 'varchar(255)',
          Comment: '@ignore',
        },
        {
          Field: 'internal_id',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'varchar(100)',
          Comment: 'Internal tracking @ignore',
        },
      ]

      const filtered = columns.filter(col => !hasIgnoreDirective(col.Comment))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(c => c.Field)).toEqual(['id', 'email'])
    })

    test('should preserve columns without @ignore', () => {
      const columns = [
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
          Type: 'varchar(255)',
          Comment: '@ts(string)',
        },
        {
          Field: 'metadata',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'json',
          Comment: '@zod(z.record(z.string()))',
        },
      ]

      const filtered = columns.filter(col => !hasIgnoreDirective(col.Comment))
      expect(filtered).toHaveLength(3)
      expect(filtered.map(c => c.Field)).toEqual(['id', 'name', 'metadata'])
    })

    test('should work with mixed magic comments and @ignore', () => {
      const columns = [
        {
          Field: 'id',
          Default: null,
          Extra: 'auto_increment',
          Null: 'NO',
          Type: 'int',
          Comment: '',
        },
        {
          Field: 'custom_field',
          Default: null,
          Extra: '',
          Null: 'NO',
          Type: 'varchar(255)',
          Comment: '@ts(CustomType) @ignore',
        },
        {
          Field: 'another_field',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'json',
          Comment: '@ignore @zod(z.record(z.string()))',
        },
      ]

      const filtered = columns.filter(col => !hasIgnoreDirective(col.Comment))
      expect(filtered).toHaveLength(1)
      expect(filtered[0].Field).toBe('id')
    })
  })

  describe('Table-level @@ignore filtering', () => {
    test('should filter out tables with @@ignore in MySQL', () => {
      const tables = [
        { table_name: 'users', table_comment: '' },
        { table_name: 'posts', table_comment: '' },
        { table_name: 'audit_logs', table_comment: '@@ignore' },
        { table_name: 'internal_metrics', table_comment: 'Internal table @@ignore' },
      ]

      const filtered = tables.filter(t => !hasTableIgnoreDirective(t.table_comment || ''))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.table_name)).toEqual(['users', 'posts'])
    })

    test('should preserve tables without @@ignore', () => {
      const tables = [
        { table_name: 'users', table_comment: '' },
        { table_name: 'posts', table_comment: 'User posts' },
        { table_name: 'comments', table_comment: 'Post comments' },
      ]

      const filtered = tables.filter(t => !hasTableIgnoreDirective(t.table_comment || ''))
      expect(filtered).toHaveLength(3)
      expect(filtered.map(t => t.table_name)).toEqual(['users', 'posts', 'comments'])
    })

    test('should not confuse @ignore with @@ignore', () => {
      const tables = [
        { table_name: 'users', table_comment: '@ignore' },
        { table_name: 'posts', table_comment: '@@ignore' },
        { table_name: 'comments', table_comment: '' },
      ]

      const filtered = tables.filter(t => !hasTableIgnoreDirective(t.table_comment || ''))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.table_name)).toEqual(['users', 'comments'])
    })
  })

  describe('Integration scenarios', () => {
    test('should handle complex table with mixed ignored and non-ignored columns', () => {
      const columns = [
        {
          Field: 'id',
          Default: null,
          Extra: 'auto_increment',
          Null: 'NO',
          Type: 'int',
          Comment: '',
        },
        {
          Field: 'email',
          Default: null,
          Extra: '',
          Null: 'NO',
          Type: 'varchar(255)',
          Comment: '',
        },
        {
          Field: 'password_hash',
          Default: null,
          Extra: '',
          Null: 'NO',
          Type: 'varchar(255)',
          Comment: '@ignore',
        },
        {
          Field: 'created_at',
          Default: 'CURRENT_TIMESTAMP',
          Extra: '',
          Null: 'NO',
          Type: 'timestamp',
          Comment: '',
        },
        {
          Field: 'internal_tracking_id',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'varchar(100)',
          Comment: 'Internal use only @ignore',
        },
        {
          Field: 'metadata',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'json',
          Comment: '@ts(UserMetadata)',
        },
      ]

      const filtered = columns.filter(col => !hasIgnoreDirective(col.Comment))
      expect(filtered).toHaveLength(4)
      expect(filtered.map(c => c.Field)).toEqual([
        'id',
        'email',
        'created_at',
        'metadata',
      ])
    })

    test('should handle empty and null comments gracefully', () => {
      const columns = [
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
          Type: 'varchar(255)',
          Comment: null as any,
        },
        {
          Field: 'ignored_field',
          Default: null,
          Extra: '',
          Null: 'YES',
          Type: 'varchar(100)',
          Comment: '@ignore',
        },
      ]

      const filtered = columns.filter(col => !hasIgnoreDirective(col.Comment || ''))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(c => c.Field)).toEqual(['id', 'name'])
    })
  })
})

