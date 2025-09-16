/**
 * Database connection and schema extraction utilities
 */
import knex from 'knex';
import type { Config, Desc } from '../types/index.js';
/**
 * Create a database connection based on config
 */
export declare function createDatabaseConnection(config: Config): knex.Knex<any, unknown[]>;
/**
 * Extract table names from database
 */
export declare function extractTables(db: ReturnType<typeof knex>, config: Config): Promise<string[]>;
/**
 * Extract view names from database
 */
export declare function extractViews(db: ReturnType<typeof knex>, config: Config): Promise<string[]>;
/**
 * Extract column descriptions for a table or view
 */
export declare function extractColumnDescriptions(db: ReturnType<typeof knex>, config: Config, tableName: string): Promise<Desc[]>;
/**
 * Extract enum values for PostgreSQL user-defined types
 */
export declare function extractEnumValues(db: ReturnType<typeof knex>, config: Config, typeName: string): Promise<string[]>;
