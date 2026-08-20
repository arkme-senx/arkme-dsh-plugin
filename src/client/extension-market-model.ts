import type { ArkmeExtensionCatalogItem } from '../extensions/types.js'

export function mergeExtensionDiscoverItems(
  publicItems: readonly ArkmeExtensionCatalogItem[],
  _ownedItems: readonly ArkmeExtensionCatalogItem[],
): ArkmeExtensionCatalogItem[] {
  return publicItems.map(item => ({ ...item }))
}

export function extensionTabSelection(
  current: string,
  target: string,
  loadedTabs: ReadonlySet<string>,
): { changed: boolean; mode: 'initial' | 'refresh' } {
  return { changed: current !== target, mode: loadedTabs.has(target) ? 'refresh' : 'initial' }
}
