/**
 * Inflection utilities for model name transformations
 */

import pluralize from 'pluralize'

/**
 * Apply inflection to a model name based on the config setting
 * @param name - The original model name (table/view name)
 * @param inflection - The inflection setting: 'singular', 'plural', or 'none'
 * @returns The transformed name
 */
export function applyInflection(name: string, inflection?: 'singular' | 'plural' | 'none'): string {
  if (inflection === 'singular') {
    return pluralize.singular(name)
  }
  if (inflection === 'plural') {
    return pluralize.plural(name)
  }
  return name
}
