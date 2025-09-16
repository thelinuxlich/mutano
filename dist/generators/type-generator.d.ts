/**
 * Core type generation logic
 */
import type { Config, Desc, Destination } from '../types/index.js';
export type OperationType = 'table' | 'insertable' | 'updateable' | 'selectable';
/**
 * Generate the appropriate type for a database field
 */
export declare function getType(op: OperationType, desc: Desc, config: Config, destination: Destination): string;
