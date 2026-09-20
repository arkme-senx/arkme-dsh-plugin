import type { ArkmePrivateInteraction, ArkmeSourceItem } from '../types.js'

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
    const sourceRef = item.privateSourceRef.trim()
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
      projected.set(source.sourceRef, source)
      continue
    }
    const interaction = projections.get(source.sourceRef)
    if (interaction === undefined) {
      projected.set(source.sourceRef, source)
      continue
    }
    const latest = interaction.latest
    const interactionIsNewer = latest.occurredAtMillis >= source.activeAtMillis
    projected.set(source.sourceRef, {
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
    if (projected.has(sourceRef)) continue
    const latest = interaction.latest
    projected.set(sourceRef, {
      sourceRef,
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
