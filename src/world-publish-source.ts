import type { ArkmeRecordReeditAttachmentView } from './record-reedit-contract.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from './types.js'

export function canPublishSelfNote(source: ArkmeSourceItem | undefined, item: ArkmeTimelineItem): boolean {
  return !!source && ['send_to_self', 'default_category', 'topic'].includes(source.kind)
    && item.isMe === true && !!item.itemUid && !!item.messageActionRef?.trim() && item.quickNoteDetailsSupported !== false
}

export interface WorldPublishSource { sourceRef: string; itemUid: string }
/** A committed owner-verified snapshot, independent from unsaved edit drafts. */
export interface WorldPublishSourceDraft extends WorldPublishSource {
  version: number; title: string; textContent: string; textFormat?: 'plain' | 'markdown'
  sendAtMillis: number; attachments: ArkmeRecordReeditAttachmentView[]
}
