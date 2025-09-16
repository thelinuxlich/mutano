/**
 * Utilities for filtering tables and views
 */

/**
 * Filter entities (tables or views) based on include/exclude patterns
 */
export function filterEntities(
  entities: string[],
  included?: string[],
  ignored?: string[]
): string[] {
  let filtered = [...entities]

  // Apply include filter
  if (included?.length) {
    filtered = filtered.filter((entity) => included.includes(entity))
  }

  // Apply ignore filter
  if (ignored?.length) {
    const ignoredRegex = ignored.filter((ignoreString) => {
      return ignoreString.startsWith('/') && ignoreString.endsWith('/')
    })
    const ignoredNames = ignored.filter(
      (entity) => !ignoredRegex.includes(entity)
    )

    // Filter by exact names
    if (ignoredNames.length) {
      filtered = filtered.filter((entity) => !ignoredNames.includes(entity))
    }

    // Filter by regex patterns
    if (ignoredRegex.length) {
      filtered = filtered.filter((entity) => {
        let useEntity = true
        for (const text of ignoredRegex) {
          const pattern = text.substring(1, text.length - 1)
          if (entity.match(pattern) !== null) useEntity = false
        }
        return useEntity
      })
    }
  }

  return filtered
}

/**
 * Filter tables based on configuration
 */
export function filterTables(
  tables: string[],
  includedTables?: string[],
  ignoredTables?: string[]
): string[] {
  return filterEntities(tables, includedTables, ignoredTables)
}

/**
 * Filter views based on configuration
 */
export function filterViews(
  views: string[],
  includedViews?: string[],
  ignoredViews?: string[]
): string[] {
  return filterEntities(views, includedViews, ignoredViews)
}

/**
 * Create entity objects with type information
 */
export interface EntityInfo {
  name: string
  type: 'table' | 'view'
}

export function createEntityList(
  tables: string[],
  views: string[]
): EntityInfo[] {
  const allEntities = [
    ...tables.map(name => ({ name, type: 'table' as const })),
    ...views.map(name => ({ name, type: 'view' as const }))
  ]
  
  return allEntities.sort((a, b) => a.name.localeCompare(b.name))
}
