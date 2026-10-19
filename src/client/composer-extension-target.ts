import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import { readMessageQuote, type ArkmeMessageQuote } from '../message-quote.js'

export interface ArkmeComposerExtensionTarget { item: ArkmeTimelineItem; quote?: ArkmeMessageQuote }

// Host action refs encode the original text (maxTextLength allows 100,000
// code units), so the signed reference can be much larger than its UI preview.
const MAX_MESSAGE_ACTION_REF_LENGTH = 1_048_576

/** Keep only the bounded preview and opaque action reference owned by a draft. */
export function composerExtensionTarget(item: ArkmeTimelineItem, quote?: ArkmeMessageQuote): ArkmeComposerExtensionTarget {
  return { ...(quote === undefined ? {} : { quote }), item: {
    itemUid: item.itemUid, messageActionRef: item.messageActionRef!,
    senderName: item.senderName.slice(0, 256), isMe: item.isMe, sendAtMillis: item.sendAtMillis,
    title: item.title.slice(0, 500), textContent: item.textContent.slice(0, 2_000), status: item.status,
    ...(item.textFormat === undefined ? {} : { textFormat: item.textFormat }),
    ...(item.memberRef === undefined ? {} : { memberRef: item.memberRef }),
    ...(item.recordVersion === undefined ? {} : { recordVersion: item.recordVersion }),
    ...(item.recordOwnerUserId === undefined ? {} : { recordOwnerUserId: item.recordOwnerUserId }),
    ...(item.sequence === undefined ? {} : { sequence: item.sequence }),
    ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks.slice(0, 3).map(block => ({
      kind: block.kind, mediaRef: block.mediaRef, fileName: block.fileName.slice(0, 256),
      mimeType: block.mimeType, size: block.size, sortOrder: block.sortOrder,
    })) }),
  } }
}

/** Browser storage and desktop replication are JSON boundaries. */
export function readComposerExtensionTarget(value: unknown): ArkmeComposerExtensionTarget | undefined {
  const rawQuote = (value as Partial<ArkmeComposerExtensionTarget> | null)?.quote
  const quote = readMessageQuote(rawQuote)
  if (rawQuote !== undefined && quote === undefined) return undefined
  const item = (value as Partial<ArkmeComposerExtensionTarget> | null)?.item
  const bounded = (text: unknown, limit: number): text is string => typeof text === 'string' && text.length <= limit
  if (!item || !bounded(item.itemUid, 512) || item.itemUid === ''
    || !bounded(item.messageActionRef, MAX_MESSAGE_ACTION_REF_LENGTH) || item.messageActionRef.trim() === ''
    || !bounded(item.senderName, 256) || !bounded(item.title, 500) || !bounded(item.textContent, 2_000)
    || typeof item.isMe !== 'boolean' || !Number.isFinite(item.sendAtMillis) || !Number.isFinite(item.status)
    || (item.textFormat !== undefined && item.textFormat !== 'plain' && item.textFormat !== 'markdown')
    || (item.memberRef !== undefined && !bounded(item.memberRef, 16_384))) return undefined
  if (item.contentBlocks !== undefined && (!Array.isArray(item.contentBlocks) || item.contentBlocks.length > 3
    || !item.contentBlocks.every((block: ArkmeContentBlock | null) => block !== null
      && ['image', 'video', 'audio', 'file'].includes(block.kind)
      && bounded(block.mediaRef, 16_384) && bounded(block.fileName, 256) && bounded(block.mimeType, 256)
      && Number.isFinite(block.size) && Number.isFinite(block.sortOrder)))) return undefined
  return composerExtensionTarget(item, quote)
}
