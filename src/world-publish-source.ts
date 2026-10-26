import type { ArkmeRecordReeditAttachmentView } from './record-reedit-contract.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from './types.js'

export function canPublishSelfNote(source: ArkmeSourceItem | undefined, item: ArkmeTimelineItem): boolean {
  return !!source && ['send_to_self', 'default_category', 'topic', 'private_chat', 'group_chat'].includes(source.kind)
    && item.isMe === true && !!item.itemUid && !!item.messageActionRef?.trim() && item.quickNoteDetailsSupported !== false
}

export interface WorldPublishSource { sourceRef: string; itemUid: string }
export type WorldPublishOrigin = WorldPublishSource & (
  | { kind?: 'record' }
  | { kind: 'arko'; sessionId: number; messageId: number }
  | { kind: 'action'; actionRef: string; hasAttachments: boolean }
  /** Local input snapshot, never a cloud ownership or provenance assertion. */
  | { kind: 'local'; textContent: string; sourceLabel: string; sendAtMillis: number; hasAttachments: boolean }
)
export function worldPublishSourceLabel(origin: WorldPublishOrigin): string {
  return origin.kind === 'arko' ? 'Arko' : origin.kind === 'action' ? 'Bot 对话'
    : origin.kind === 'local' ? origin.sourceLabel : '已发内容'
}

/** A committed owner-verified snapshot, independent from unsaved edit drafts. */
export interface WorldPublishSourceDraft extends WorldPublishSource {
  version: number; title: string; textContent: string; textFormat?: 'plain' | 'markdown'
  sourceLabel?: string
  sendAtMillis: number; attachments: ArkmeRecordReeditAttachmentView[]
}
