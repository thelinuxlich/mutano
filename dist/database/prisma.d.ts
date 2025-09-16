/**
 * Prisma schema extraction utilities
 */
import type { Config, Desc } from '../types/index.js';
/**
 * Extract tables and views from Prisma schema
 */
export declare function extractPrismaEntities(config: Config): {
    tables: string[];
    views: string[];
    enumDeclarations: Record<string, string[]>;
};
/**
 * Extract column descriptions from Prisma model or view
 */
export declare function extractPrismaColumnDescriptions(config: Config, entityName: string, enumDeclarations: Record<string, string[]>): Desc[];
/**
 * Check if Prisma schema has views enabled
 */
export declare function hasViewsEnabled(config: Config): boolean;
