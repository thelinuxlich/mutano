/**
 * Utilities for parsing magic comments (@zod, @ts, @kysely)
 */

/**
 * Extract type expression from a comment with a given prefix
 * Handles nested parentheses, brackets, and braces
 */
export const extractTypeExpression = (comment: string, prefix: string): string | null => {
  const start = comment.indexOf(prefix)
  if (start === -1) return null

  const typeLen = prefix.length
  let position = start + typeLen

  let depth = 1

  while (position < comment.length && depth > 0) {
    const char = comment[position]

    if (char === '(' || char === '{' || char === '<' || char === '[') {
      depth++
    } else if (char === ')' || char === '}' || char === '>' || char === ']') {
      depth--
      if (depth === 0) {
        const extracted = comment.substring(start + typeLen, position)
        return extracted
      }
    }

    position++
  }

  return null
}

/**
 * Extract TypeScript type expression from @ts() comment
 */
export const extractTSExpression = (comment: string): string | null =>
  extractTypeExpression(comment, '@ts(')

/**
 * Extract Kysely type expression from @kysely() comment
 */
export const extractKyselyExpression = (comment: string): string | null =>
  extractTypeExpression(comment, '@kysely(')

/**
 * Extract Zod type expression from @zod() comment
 */
export const extractZodExpression = (comment: string): string | null =>
  extractTypeExpression(comment, '@zod(')

/**
 * Check if a comment contains @ignore directive (for columns)
 */
export const hasIgnoreDirective = (comment: string): boolean => {
  return comment.includes('@ignore')
}

/**
 * Check if a comment contains @@ignore directive (for tables)
 */
export const hasTableIgnoreDirective = (comment: string): boolean => {
  return comment.includes('@@ignore')
}

/**
 * Check if a comment contains any magic comment
 */
export const hasMagicComment = (comment: string): boolean => {
  return comment.includes('@zod(') || comment.includes('@ts(') || comment.includes('@kysely(')
}

/**
 * Parse all magic comments from a comment string
 */
export interface MagicComments {
  zod?: string
  ts?: string
  kysely?: string
}

export const parseMagicComments = (comment: string): MagicComments => {
  const result: MagicComments = {}
  
  const zodExpression = extractZodExpression(comment)
  if (zodExpression) {
    result.zod = zodExpression
  }
  
  const tsExpression = extractTSExpression(comment)
  if (tsExpression) {
    result.ts = tsExpression
  }
  
  const kyselyExpression = extractKyselyExpression(comment)
  if (kyselyExpression) {
    result.kysely = kyselyExpression
  }
  
  return result
}
