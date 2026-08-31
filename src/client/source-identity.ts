import type { ArkmeSourceItem } from '../types.js'

export function arkmeChatSourceIdentityKey(
  source: Pick<ArkmeSourceItem, 'sourceRef' | 'sourceKey'>,
): string {
  const sourceKey = source.sourceKey?.trim()
  return sourceKey === undefined || sourceKey === '' ? source.sourceRef : sourceKey
}

export function arkmeSourceIdentityKey(
  source: Pick<ArkmeSourceItem, 'kind' | 'sourceRef' | 'sourceKey' | 'topicHierarchyKey'>,
): string {
  if (source.kind === 'private_chat' || source.kind === 'group_chat') {
    return arkmeChatSourceIdentityKey(source)
  }
  if (source.kind === 'topic') {
    const topicHierarchyKey = source.topicHierarchyKey?.trim()
    if (topicHierarchyKey !== undefined && topicHierarchyKey !== '') return topicHierarchyKey
  }
  return source.sourceRef
}

export function arkmePrependSourceByIdentity(
  source: ArkmeSourceItem,
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] {
  const identity = arkmeSourceIdentityKey(source)
  return [source, ...sources.filter(item => arkmeSourceIdentityKey(item) !== identity)]
}
