import type { ArkmeSourceItem } from '../types.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { arkmeEmojiPlainText } from './arkme-emoji.js'
import { tr } from './locale.js'
import {
  arkmeAttachmentMetadata, arkmeSourceComposerDraftKey, serializeArkmeComposerDraft, arkmeDraftActivityAtMillis,
  type ArkmeComposerDraftSnapshot, type ArkmeComposerDraftStore,
} from './composer-draft-store.js'

/** Undefined means no visible draft. An empty preview still represents an editable structure. */
export function conversationDraftPreview(draft: ArkmeComposerDraftSnapshot): string | undefined {
  const serialized = serializeArkmeComposerDraft(draft)
  const text = arkmeEmojiPlainText(serialized.textFormat === 'markdown'
    ? arkmeMarkdownPlainText(serialized.text) : serialized.text).replace(/\s+/g, ' ').trim()
  if (text) return text
  if (draft.attachments.length) return draft.attachments.map(attachment => {
    const file = arkmeAttachmentMetadata(attachment)
    const label = file.mimeType.startsWith('image/') ? tr('[图片]')
      : file.mimeType.startsWith('video/') ? tr('[视频]')
      : file.mimeType.startsWith('audio/') ? tr('[语音]') : tr('[文件]')
    return `${label} ${file.fileName}`.trim()
  }).join(' · ')
  const hasStructure = draft.markdown?.document.content?.some(node => node.type !== 'paragraph' || (node.content?.length ?? 0) > 0)
  return hasStructure || draft.extensionTarget !== undefined ? '' : undefined
}

export function selfConversationDraftPreview(store: ArkmeComposerDraftStore, userId: number | undefined,
  sources: readonly ArkmeSourceItem[],
): { source: ArkmeSourceItem; preview: string; activityAtMillis: number } | undefined {
  let selected: { source: ArkmeSourceItem; preview: string; revision: number; activityAtMillis: number } | undefined
  for (const source of sources) {
    if (source.kind !== 'send_to_self' && source.kind !== 'default_category' && source.kind !== 'topic') continue
    const key = arkmeSourceComposerDraftKey(userId, source)
    const draft = store.get(key)
    if (draft.leftAtMillis === 0) continue
    const preview = conversationDraftPreview(draft)
    if (preview === undefined) continue
    const activityAtMillis = arkmeDraftActivityAtMillis(draft)
    const revision = store.getChangeRevision(key)
    if (selected && (activityAtMillis < selected.activityAtMillis || (activityAtMillis === selected.activityAtMillis
      && (revision < selected.revision || (revision === selected.revision && source.kind !== 'send_to_self'))))) continue
    selected = { source, preview, revision, activityAtMillis }
  }
  if (!selected) return undefined
  return { source: selected.source, activityAtMillis: selected.activityAtMillis, preview: selected.source.kind === 'send_to_self' ? selected.preview
    : [selected.source.displayName, selected.preview].filter(Boolean).join(' · ') }
}

/** Directory-only activity: never write draft time into the server message/visibility projection. */
export function withConversationDraftActivity<T extends { activeAtMillis: number; pinned: boolean; source?: ArkmeSourceItem }>(
  rows: readonly T[], store: ArkmeComposerDraftStore, userId: number | undefined,
): T[] {
  return rows.map(row => {
    if (!row.source) return row
    const draft = store.get(arkmeSourceComposerDraftKey(userId, row.source))
    const activityAtMillis = conversationDraftPreview(draft) === undefined ? 0 : arkmeDraftActivityAtMillis(draft)
    return activityAtMillis > row.activeAtMillis ? { ...row, activeAtMillis: activityAtMillis } : row
  }).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.activeAtMillis - left.activeAtMillis)
}
