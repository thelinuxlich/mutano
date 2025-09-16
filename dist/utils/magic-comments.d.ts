/**
 * Utilities for parsing magic comments (@zod, @ts, @kysely)
 */
/**
 * Extract type expression from a comment with a given prefix
 * Handles nested parentheses, brackets, and braces
 */
export declare const extractTypeExpression: (comment: string, prefix: string) => string | null;
/**
 * Extract TypeScript type expression from @ts() comment
 */
export declare const extractTSExpression: (comment: string) => string | null;
/**
 * Extract Kysely type expression from @kysely() comment
 */
export declare const extractKyselyExpression: (comment: string) => string | null;
/**
 * Extract Zod type expression from @zod() comment
 */
export declare const extractZodExpression: (comment: string) => string | null;
/**
 * Check if a comment contains any magic comment
 */
export declare const hasMagicComment: (comment: string) => boolean;
/**
 * Parse all magic comments from a comment string
 */
export interface MagicComments {
    zod?: string;
    ts?: string;
    kysely?: string;
}
export declare const parseMagicComments: (comment: string) => MagicComments;
