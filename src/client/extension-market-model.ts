import type { ArkmeExtensionCatalogItem } from '../extensions/types.js'

export function mergeExtensionDiscoverItems(
  publicItems: readonly ArkmeExtensionCatalogItem[],
  _ownedItems: readonly ArkmeExtensionCatalogItem[],
): ArkmeExtensionCatalogItem[] {
  return publicItems.map(item => ({ ...item }))
}

export function appendExtensionDiscoverPage(
  currentItems: readonly ArkmeExtensionCatalogItem[],
  nextItems: readonly ArkmeExtensionCatalogItem[],
): ArkmeExtensionCatalogItem[] {
  const seen = new Set(currentItems.map(item => item.extension_id))
  return [
    ...currentItems.map(item => ({ ...item })),
    ...nextItems.filter(item => !seen.has(item.extension_id)).map(item => ({ ...item })),
  ]
}

export function extensionTabSelection(
  current: string,
  target: string,
  loadedTabs: ReadonlySet<string>,
): { changed: boolean; mode: 'initial' | 'refresh' } {
  return { changed: current !== target, mode: loadedTabs.has(target) ? 'refresh' : 'initial' }
}
