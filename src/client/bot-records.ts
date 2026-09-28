import type { ArkmeConversationMemberRecordMode, ArkmeTimelineItem } from '../types.js'

/** This is deliberately a loaded-window view, not a replacement for server-side Bot history. */
export function arkmeLoadedBotRecords(
  items: readonly ArkmeTimelineItem[],
  directoryKey: string | undefined,
  mode: ArkmeConversationMemberRecordMode,
): ArkmeTimelineItem[] {
  if (!directoryKey) return []
  return items.filter(item => mode === 'owner'
    ? item.senderKind === 'bot' && item.senderBotDirectoryKey === directoryKey
    : item.mentions?.some(mention => mention.kind === 'bot' && mention.botDirectoryKey === directoryKey) === true)
}
