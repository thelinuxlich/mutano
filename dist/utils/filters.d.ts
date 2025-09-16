/**
 * Utilities for filtering tables and views
 */
/**
 * Filter entities (tables or views) based on include/exclude patterns
 */
export declare function filterEntities(entities: string[], included?: string[], ignored?: string[]): string[];
/**
 * Filter tables based on configuration
 */
export declare function filterTables(tables: string[], includedTables?: string[], ignoredTables?: string[]): string[];
/**
 * Filter views based on configuration
 */
export declare function filterViews(views: string[], includedViews?: string[], ignoredViews?: string[]): string[];
/**
 * Create entity objects with type information
 */
export interface EntityInfo {
    name: string;
    type: 'table' | 'view';
}
export declare function createEntityList(tables: string[], views: string[]): EntityInfo[];
