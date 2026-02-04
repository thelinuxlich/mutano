import { describe, test, expect } from 'vitest'
import { generateContent, generateViewContent } from '../generators/content-generator.js'
import type { Config, Desc } from '../types/index.js'

describe('Inflection Feature', () => {
  const baseConfig: Config = {
    origin: {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'test'
    },
    destinations: [{ type: 'zod' }]
  }

  const describes: Desc[] = [
    {
      Field: 'id',
      Type: 'int',
      Null: 'NO',
      Default: null,
      Extra: 'auto_increment',
      Comment: ''
    },
    {
      Field: 'name',
      Type: 'varchar(255)',
      Null: 'NO',
      Default: null,
      Extra: '',
      Comment: ''
    }
  ]

  const defaultZodHeader = (v: 3 | 4) => `import { z } from 'zod';\n\n`

  describe('Zod output', () => {
    test('should keep original table name when inflection is none (default)', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: baseConfig,
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export type UsersType = z.infer<typeof users>')
      expect(content).toContain('export type InsertableUsersType = z.infer<typeof insertable_users>')
      expect(content).toContain('export type UpdateableUsersType = z.infer<typeof updateable_users>')
      expect(content).toContain('export type SelectableUsersType = z.infer<typeof selectable_users>')
    })

    test('should singularize table name when inflection is singular', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export type UserType = z.infer<typeof users>')
      expect(content).toContain('export type InsertableUserType = z.infer<typeof insertable_users>')
      expect(content).toContain('export type UpdateableUserType = z.infer<typeof updateable_users>')
      expect(content).toContain('export type SelectableUserType = z.infer<typeof selectable_users>')
    })

    test('should pluralize table name when inflection is plural', () => {
      const content = generateContent({
        table: 'user',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export type UsersType = z.infer<typeof user>')
      expect(content).toContain('export type InsertableUsersType = z.infer<typeof insertable_user>')
      expect(content).toContain('export type UpdateableUsersType = z.infer<typeof updateable_user>')
      expect(content).toContain('export type SelectableUsersType = z.infer<typeof selectable_user>')
    })

    test('should handle irregular plurals with singular inflection', () => {
      const testCases = [
        { table: 'companies', expected: 'CompanyType' },
        { table: 'categories', expected: 'CategoryType' },
        { table: 'people', expected: 'PersonType' },
        { table: 'children', expected: 'ChildType' },
        { table: 'analyses', expected: 'AnalysisType' }
      ]

      for (const { table, expected } of testCases) {
        const content = generateContent({
          table,
          describes,
          config: { ...baseConfig, inflection: 'singular' },
          destination: { type: 'zod' },
          isCamelCase: false,
          enumDeclarations: {},
          defaultZodHeader
        })

        expect(content).toContain(`export type ${expected} = z.infer`)
      }
    })

    test('should handle irregular singulars with plural inflection', () => {
      const testCases = [
        { table: 'company', expected: 'CompaniesType' },
        { table: 'category', expected: 'CategoriesType' },
        { table: 'person', expected: 'PeopleType' },
        { table: 'child', expected: 'ChildrenType' }
      ]

      for (const { table, expected } of testCases) {
        const content = generateContent({
          table,
          describes,
          config: { ...baseConfig, inflection: 'plural' },
          destination: { type: 'zod' },
          isCamelCase: false,
          enumDeclarations: {},
          defaultZodHeader
        })

        expect(content).toContain(`export type ${expected} = z.infer`)
      }
    })

    test('should keep schema names as snake_case even with inflection', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Schema names should remain as snake_case table name
      expect(content).toContain('export const users = z.object({')
      expect(content).toContain('export const insertable_users = z.object({')
      expect(content).toContain('export const updateable_users = z.object({')
      expect(content).toContain('export const selectable_users = z.object({')
    })
  })

  describe('TypeScript output', () => {
    test('should use inflected names for interfaces when inflection is singular', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface User {')
      expect(content).toContain('export interface InsertableUser {')
      expect(content).toContain('export interface UpdateableUser {')
      expect(content).toContain('export interface SelectableUser {')
    })

    test('should use inflected names for interfaces when inflection is plural', () => {
      const content = generateContent({
        table: 'user',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface Users {')
      expect(content).toContain('export interface InsertableUsers {')
      expect(content).toContain('export interface UpdateableUsers {')
      expect(content).toContain('export interface SelectableUsers {')
    })

    test('should keep original names when inflection is none', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'none' },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface Users {')
      expect(content).toContain('export interface InsertableUsers {')
    })
  })

  describe('Kysely output', () => {
    test('should use inflected names for interfaces when inflection is singular', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'kysely' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface User {')
      expect(content).toContain('export type SelectableUser = Selectable<User>')
      expect(content).toContain('export type InsertableUser = Insertable<User>')
      expect(content).toContain('export type UpdateableUser = Updateable<User>')
    })

    test('should use inflected names for interfaces when inflection is plural', () => {
      const content = generateContent({
        table: 'user',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'kysely' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface Users {')
      expect(content).toContain('export type SelectableUsers = Selectable<Users>')
      expect(content).toContain('export type InsertableUsers = Insertable<Users>')
      expect(content).toContain('export type UpdateableUsers = Updateable<Users>')
    })
  })

  describe('Views', () => {
    test('should apply inflection to view names with Zod output', () => {
      const content = generateViewContent({
        view: 'user_profiles',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export type UserProfileViewType = z.infer')
    })

    test('should apply inflection to view names with TypeScript output', () => {
      const content = generateViewContent({
        view: 'user_profiles',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'ts' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface UserProfileView {')
    })

    test('should apply inflection to view names with Kysely output', () => {
      const content = generateViewContent({
        view: 'user_profiles',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'kysely' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      expect(content).toContain('export interface UserProfileView {')
      expect(content).toContain('export type SelectableUserProfileView = Selectable<UserProfileView>')
    })
  })

  describe('Combined with camelCase', () => {
    test('should apply inflection before camelCase conversion', () => {
      const content = generateContent({
        table: 'user_accounts',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: true,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Type should be UserAccountType (singular + PascalCase)
      expect(content).toContain('export type UserAccountType = z.infer')
    })

    test('should work with camelCase and plural inflection', () => {
      const content = generateContent({
        table: 'user_account',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'ts' },
        isCamelCase: true,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Interface should be UserAccounts (plural + PascalCase)
      expect(content).toContain('export interface UserAccounts {')
    })
  })

  describe('Edge cases', () => {
    test('should handle already singular table with singular inflection', () => {
      const content = generateContent({
        table: 'user',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Should remain UserType since it's already singular
      expect(content).toContain('export type UserType = z.infer')
    })

    test('should handle already plural table with plural inflection', () => {
      const content = generateContent({
        table: 'users',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Should remain UsersType since it's already plural
      expect(content).toContain('export type UsersType = z.infer')
    })

    test('should handle tables with underscores', () => {
      const content = generateContent({
        table: 'user_accounts',
        describes,
        config: { ...baseConfig, inflection: 'singular' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Should singularize the last part
      expect(content).toContain('export type UserAccountType = z.infer')
    })

    test('should handle tables with numbers', () => {
      const content = generateContent({
        table: 'user_v2',
        describes,
        config: { ...baseConfig, inflection: 'plural' },
        destination: { type: 'zod' },
        isCamelCase: false,
        enumDeclarations: {},
        defaultZodHeader
      })

      // Should handle the pluralization correctly
      expect(content).toContain('export type UserV2sType = z.infer')
    })
  })
})
