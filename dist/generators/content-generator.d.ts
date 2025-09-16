/**
 * Content generation for tables and views
 */
import type { GenerateContentParams, GenerateViewContentParams } from '../types/index.js';
/**
 * Generate content for database views (read-only)
 */
export declare function generateViewContent({ view, describes, config, destination, isCamelCase, enumDeclarations: _enumDeclarations, defaultZodHeader, }: GenerateViewContentParams): string;
/**
 * Generate content for database tables
 */
export declare function generateContent({ table, describes, config, destination, isCamelCase, enumDeclarations: _enumDeclarations, defaultZodHeader, }: GenerateContentParams): string;
