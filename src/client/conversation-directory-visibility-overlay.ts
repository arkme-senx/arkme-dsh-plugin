import type {
  ArkmeBotSummary,
  ArkmeConversationDirectoryVisibility,
  ArkmeSourceItem,
} from '../types.js'

export type ConversationVisibilityOverlay = ReadonlySet<string>
export type ConversationVisibilityHydration = ReadonlySet<string>

export interface ConversationVisibilityActivityEvidence {
  sequence: number
  activityAtMillis: number
}

export interface ConversationVisibilityScope {
  sourceRefs: string[]
  botRefs: string[]
  keyByHandle: ReadonlyMap<string, string>
  keys: ReadonlySet<string>
}

export function conversationSourceVisibilityKey(
  source: Pick<ArkmeSourceItem, 'sourceRef' | 'sourceKey'>,
): string {
  return source.sourceKey?.trim() || source.sourceRef
}

export function conversationBotVisibilityKey(
  bot: Pick<ArkmeBotSummary, 'botRef' | 'directoryKey'>,
): string {
  return bot.directoryKey?.trim() || bot.botRef
}

export function conversationVisibilityKey(
  kind: 'source' | 'bot',
  stableKey: string,
): string {
  return `${kind}:${stableKey}`
}

export function conversationSourceActivityEvidence(
  source: Pick<ArkmeSourceItem, 'activeAtMillis' | 'latestSequence'>,
): ConversationVisibilityActivityEvidence {
  return { sequence: source.latestSequence ?? 0, activityAtMillis: source.activeAtMillis }
}

export function conversationBotActivityEvidence(
  bot: Pick<ArkmeBotSummary, 'createdAtMillis' | 'latestMessageAtMillis' | 'conversationListActivityAtMillis'>,
): ConversationVisibilityActivityEvidence {
  return {
    sequence: 0,
    activityAtMillis: Math.max(
      bot.createdAtMillis ?? 0,
      bot.latestMessageAtMillis ?? 0,
      bot.conversationListActivityAtMillis ?? 0,
    ),
  }
}

export function conversationVisibilityActivityAdvanced(
  before: ConversationVisibilityActivityEvidence,
  current: ConversationVisibilityActivityEvidence,
): boolean {
  return current.sequence > before.sequence || current.activityAtMillis > before.activityAtMillis
}

export function emptyConversationVisibilityOverlay(): ConversationVisibilityOverlay {
  return new Set()
}

export function emptyConversationVisibilityHydration(): ConversationVisibilityHydration {
  return new Set()
}

export function markConversationVisibilityScopeHydrated(
  current: ConversationVisibilityHydration,
  scope: ConversationVisibilityScope,
): ConversationVisibilityHydration {
  return new Set([...current, ...scope.keys])
}

export function conversationVisibilityScope(
  sources: readonly ArkmeSourceItem[],
  bots: readonly ArkmeBotSummary[],
): ConversationVisibilityScope {
  const sourceRefs = sources.map(source => source.sourceRef)
  const botRefs = bots.map(bot => bot.botRef)
  const keyByHandle = new Map<string, string>([
    ...sources.map(source => [
      `source:${source.sourceRef}`,
      conversationVisibilityKey('source', conversationSourceVisibilityKey(source)),
    ] as const),
    ...bots.map(bot => [
      `bot:${bot.botRef}`,
      conversationVisibilityKey('bot', conversationBotVisibilityKey(bot)),
    ] as const),
  ])
  return { sourceRefs, botRefs, keyByHandle, keys: new Set(keyByHandle.values()) }
}

export function applyConversationVisibilityQuerySuccess(
  current: ConversationVisibilityOverlay,
  scope: ConversationVisibilityScope,
  result: ArkmeConversationDirectoryVisibility,
  protectedKeys: ConversationVisibilityOverlay = emptyConversationVisibilityOverlay(),
): ConversationVisibilityOverlay {
  const refreshableKeys = new Set([...scope.keys].filter(key => !protectedKeys.has(key)))
  const next = withoutKeys(current, refreshableKeys)
  for (const item of result.items) {
    const key = scope.keyByHandle.get(`${item.entryKind}:${item.entryRef}`)
    if (item.hidden && key !== undefined && !protectedKeys.has(key)) next.add(key)
  }
  return next
}

export function applyConversationVisibilityQueryFailure(
  current: ConversationVisibilityOverlay,
  scope: ConversationVisibilityScope,
  protectedKeys: ConversationVisibilityOverlay = emptyConversationVisibilityOverlay(),
): ConversationVisibilityOverlay {
  return protectedKeys.size > 0 ? current : withoutKeys(current, scope.keys)
}

export function dismissConversationVisibilityEntry(
  current: ConversationVisibilityOverlay,
  entryKind: 'source' | 'bot',
  stableKey: string,
): ConversationVisibilityOverlay {
  return new Set(current).add(conversationVisibilityKey(entryKind, stableKey))
}

function withoutKeys(current: ConversationVisibilityOverlay, removed: ReadonlySet<string>): Set<string> {
  return new Set([...current].filter(key => !removed.has(key)))
}
