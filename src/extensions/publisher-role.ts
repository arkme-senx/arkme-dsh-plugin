import type { ArkmeExtensionCatalogItem, ArkmeExtensionPublisherRole } from './types.js'

type PublisherRoleProjection = Pick<ArkmeExtensionCatalogItem, 'publisher_role' | 'source'>

/**
 * Preserve historical market rows without writing them back: an explicit role
 * wins, otherwise legacy GitHub-backed rows are imports and other rows are authors.
 */
export function effectiveExtensionPublisherRole(item: PublisherRoleProjection): ArkmeExtensionPublisherRole {
  if (item.publisher_role === 'author' || item.publisher_role === 'importer') return item.publisher_role
  return item.source?.type === 'github_repository' ? 'importer' : 'author'
}
