import type { ArkmeExtensionCatalogItem } from '../extensions/types.js'

export function mergeExtensionDiscoverItems(
  publicItems: readonly ArkmeExtensionCatalogItem[],
  ownedItems: readonly ArkmeExtensionCatalogItem[],
): ArkmeExtensionCatalogItem[] {
  const items = new Map(publicItems.map(item => [item.extension_id, { ...item }]))
  for (const owned of ownedItems) {
    if (owned.visibility === 'unlisted' || owned.status === 'deleted') continue
    const current = items.get(owned.extension_id)
    if (current === undefined) {
      if (owned.latest_stable_version === undefined && owned.version === undefined) continue
      items.set(owned.extension_id, { ...owned })
      continue
    }
    items.set(owned.extension_id, {
      ...owned,
      ...current,
      ...(current.owner_user_id ?? owned.owner_user_id) === undefined
        ? {}
        : { owner_user_id: current.owner_user_id ?? owned.owner_user_id },
      ...(current.owner_name ?? owned.owner_name) === undefined
        ? {}
        : { owner_name: current.owner_name ?? owned.owner_name },
      ...(current.owner_arkme_id ?? owned.owner_arkme_id) === undefined
        ? {}
        : { owner_arkme_id: current.owner_arkme_id ?? owned.owner_arkme_id },
      ...(current.package_name ?? owned.package_name) === undefined
        ? {}
        : { package_name: current.package_name ?? owned.package_name },
      ...(current.icon_ref ?? owned.icon_ref) === undefined
        ? {}
        : { icon_ref: current.icon_ref ?? owned.icon_ref },
    })
  }
  return [...items.values()].sort((left, right) =>
    (right.updated_at ?? 0) - (left.updated_at ?? 0) || left.extension_id.localeCompare(right.extension_id))
}

export function extensionOwnerVisibilityBadge(
  item: Pick<ArkmeExtensionCatalogItem, 'visibility'>,
): string | undefined {
  return item.visibility === 'private' ? '仅自己' : undefined
}

export function extensionTabSelection(
  current: string,
  target: string,
  loadedTabs: ReadonlySet<string>,
): { changed: boolean; mode: 'initial' | 'refresh' } {
  return { changed: current !== target, mode: loadedTabs.has(target) ? 'refresh' : 'initial' }
}
