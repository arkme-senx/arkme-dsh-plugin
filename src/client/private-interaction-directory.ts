import type { ArkmePrivateInteraction, ArkmeSourceItem } from '../types.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

export interface ArkmePrivateInteractionProjection {
  latest: ArkmePrivateInteraction
  unreadCount: number
  attentionCount: number
  version: string
}

function interactionPreview(item: ArkmePrivateInteraction): string {
  const direction = item.senderIsMe ? '我' : item.peerName
  const summary = item.summary.replace(/\s+/gu, ' ').trim()
  return `${item.groupName} · ${direction}：${summary}`.trim()
}

/**
 * Collapse occurrence pages into one deterministic projection per private
 * contact. The counts remain separate from direct-message unreadCount.
 */
export function projectPrivateInteractions(
  items: readonly ArkmePrivateInteraction[],
  version: string,
): ReadonlyMap<string, ArkmePrivateInteractionProjection> {
  const bySource = new Map<string, ArkmePrivateInteractionProjection>()
  const seenBySource = new Map<string, Set<string>>()
  for (const item of items) {
    const sourceRef = item.privateSourceKey?.trim() || item.privateSourceRef.trim()
    if (sourceRef === '') continue
    const seen = seenBySource.get(sourceRef) ?? new Set<string>()
    if (seen.has(item.interactionRef)) continue
    seen.add(item.interactionRef)
    seenBySource.set(sourceRef, seen)
    const previous = bySource.get(sourceRef)
    const latest = previous === undefined || item.occurredAtMillis > previous.latest.occurredAtMillis
      || (item.occurredAtMillis === previous.latest.occurredAtMillis && item.interactionRef > previous.latest.interactionRef)
      ? item : previous.latest
    bySource.set(sourceRef, {
      latest,
      unreadCount: (previous?.unreadCount ?? 0) + (item.unread ? 1 : 0),
      attentionCount: (previous?.attentionCount ?? 0) + (item.attention ? 1 : 0),
      version,
    })
  }
  return bySource
}

/** Apply a fresh server snapshot to the current (direct-message) directory. */
export function applyPrivateInteractionDirectory(
  sources: readonly ArkmeSourceItem[],
  projections: ReadonlyMap<string, ArkmePrivateInteractionProjection>,
): ArkmeSourceItem[] {
  const projected = new Map<string, ArkmeSourceItem>()
  for (const source of sources) {
    if (source.kind !== 'private_chat') {
      projected.set(arkmeSourceIdentityKey(source), source)
      continue
    }
    const interaction = projections.get(arkmeSourceIdentityKey(source))
    if (interaction === undefined) {
      projected.set(arkmeSourceIdentityKey(source), source)
      continue
    }
    const latest = interaction.latest
    const interactionIsNewer = latest.occurredAtMillis > source.activeAtMillis
    projected.set(arkmeSourceIdentityKey(source), {
      ...source,
      privateInteraction: interaction,
      ...(interactionIsNewer ? {
        latestPreview: interactionPreview(latest),
        activeAtMillis: latest.occurredAtMillis,
      } : {}),
    })
  }
  for (const interaction of projections.values()) {
    const sourceRef = interaction.latest.privateSourceRef
    const sourceKey = interaction.latest.privateSourceKey
    if (projected.has(sourceKey || sourceRef)) continue
    const latest = interaction.latest
    projected.set(sourceKey || sourceRef, {
      sourceRef,
      ...(sourceKey ? { sourceKey } : {}),
      kind: 'private_chat',
      displayName: latest.peerName || '联系人',
      privateNickname: latest.peerName || '联系人',
      activeAtMillis: latest.occurredAtMillis,
      unreadCount: 0,
      latestPreview: interactionPreview(latest),
      privateInteraction: interaction,
      directMessageAdmissionApplicable: true,
    })
  }
  return [...projected.values()].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned === true ? -1 : 1
    return right.activeAtMillis - left.activeAtMillis
  })
}

export function privateInteractionPreview(item: ArkmePrivateInteraction): string {
  return interactionPreview(item)
}

/** Server directory rows carry complete per-contact counts, even on page one. */
export function mergePrivateInteractionSources(
  sources: readonly ArkmeSourceItem[],
  interactionRows: readonly ArkmeSourceItem[],
  excludedKeys: ReadonlySet<string> = new Set(),
): ArkmeSourceItem[] {
  const rows = new Map(sources.map(source => [arkmeSourceIdentityKey(source), source]))
  for (const incoming of interactionRows) {
    const key = arkmeSourceIdentityKey(incoming)
    if (incoming.kind !== 'private_chat' || excludedKeys.has(key)) continue
    const current = rows.get(key)
    if (current === undefined) {
      if (incoming.privateInteraction !== undefined) rows.set(key, incoming)
      continue
    }
    const newer = incoming.activeAtMillis > current.activeAtMillis
      || incoming.activeAtMillis === current.activeAtMillis && (incoming.latestSequence ?? 0) >= (current.latestSequence ?? 0)
    const merged = { ...incoming, ...current }
    if (incoming.privateInteraction === undefined) delete merged.privateInteraction
    else merged.privateInteraction = incoming.privateInteraction
    if (newer) {
      merged.sourceRef = incoming.sourceRef
      merged.activeAtMillis = incoming.activeAtMillis
      if (incoming.latestPreview === undefined) delete merged.latestPreview
      else merged.latestPreview = incoming.latestPreview
    }
    rows.set(key, merged)
  }
  return [...rows.values()].sort((a, b) => Number(b.isPinned === true) - Number(a.isPinned === true) || b.activeAtMillis - a.activeAtMillis)
}
