/**
 * Mutano - Database schema to TypeScript/Zod/Kysely converter
 * Refactored for better maintainability and modularity
 */
import type { Config } from './types/index.js';
import { defaultKyselyHeader, defaultZodHeader } from './constants.js';
export { extractTypeExpression, extractTSExpression, extractKyselyExpression, extractZodExpression } from './utils/magic-comments.js';
export type { Config, Desc, Destination } from './types/index.js';
export { generateContent, generateViewContent } from './generators/content-generator.js';
export { getType } from './generators/type-generator.js';
export { defaultKyselyHeader, defaultZodHeader };
/**
 * Main generate function - orchestrates the entire schema generation process
 */
export declare function generate(config: Config): Promise<Record<string, string>>;
