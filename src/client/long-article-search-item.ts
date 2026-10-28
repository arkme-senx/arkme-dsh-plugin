import type { ArkmeSearchRecordItem, ArkmeTimelineAroundPage, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export function needsLongArticleSource(item: ArkmeSearchRecordItem): boolean {
  return !item.messageActionRef && (item.targetSource?.kind === 'group_chat' || item.targetSource?.kind === 'private_chat')
}

/** Recent search may have no relation reference. Resolve just the clicked
 * original in its own source, never by looking in the viewer's private records. */
export async function resolveLongArticleSource(item: ArkmeSearchRecordItem, signal: AbortSignal): Promise<ArkmeSearchRecordItem> {
  if (!needsLongArticleSource(item)) return item
  if (item.recordOwnerUserId === undefined) throw new Error('这篇长文缺少来源身份，请刷新列表后重试')
  const page = await withArkmeReadDeadline(request => callArkme<ArkmeTimelineAroundPage>('source.timeline-around', {
    sourceRef: item.targetSource!.sourceRef, itemUid: item.recordUid,
    recordOwnerUserId: item.recordOwnerUserId, beforeLimit: 0, afterLimit: 0,
  }, request), signal)
  const original = page.items.find(candidate => candidate.itemUid === item.recordUid
    && String(candidate.recordOwnerUserId) === String(item.recordOwnerUserId))
  if (!original?.messageActionRef) throw new Error('当前无法读取这篇长文，请刷新列表后重试')
  return { ...item, messageActionRef: original.messageActionRef }
}

/** Preserve the signed source and owner together across the native bridge. */
export function longArticleSearchTimelineItem(item: ArkmeSearchRecordItem): ArkmeTimelineItem {
  return { senderName: '', isMe: false, status: 1,
    ...(item.templateKind === undefined ? {} : { templateKind: item.templateKind }),
    ...(item.displayKind === undefined ? {} : { displayKind: item.displayKind }),
    itemUid: item.recordUid, title: item.title, textContent: item.textContent, sendAtMillis: item.sendAtMillis,
    ...(item.recordOwnerUserId === undefined ? {} : { recordOwnerUserId: item.recordOwnerUserId }),
    ...(item.messageActionRef ? { messageActionRef: item.messageActionRef } : {}),
    ...(item.textFormat ? { textFormat: item.textFormat } : {}),
  }
}
