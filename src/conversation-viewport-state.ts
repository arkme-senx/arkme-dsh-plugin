import { recordOwnerId, type RecordOwnerId } from './record-owner-id.js'

/** Reading geometry and stable identity only; never bodies, credentials or server cursors. */
export interface ConversationViewportState {
  scrollTop: number
  stickToBottom: boolean
  anchorId?: string
  anchorOffset?: number
  messageAnchor?: { itemUid: string; recordOwnerUserId: RecordOwnerId }
}
export type ConversationViewportEntries = Array<[string, ConversationViewportState]>
export function normalizeConversationViewports(value: unknown): ConversationViewportEntries {
  if (!Array.isArray(value)) return []
  const entries: ConversationViewportEntries = []
  let bytes = 2
  for (const pair of value.slice(-40).reverse()) {
    if (!Array.isArray(pair)) continue
    const [source, v] = pair
    if (typeof source !== 'string' || source.length > 2048 || !v || typeof v.stickToBottom !== 'boolean'
      || !Number.isFinite(v.scrollTop) || v.scrollTop < 0
      || v.anchorId !== undefined && (typeof v.anchorId !== 'string' || v.anchorId.length > 1024)
      || v.anchorOffset !== undefined && !Number.isFinite(v.anchorOffset)) continue
    let messageAnchor: ConversationViewportState['messageAnchor']
    if (!v.stickToBottom && v.anchorId?.startsWith('message:') && typeof v.messageAnchor?.itemUid === 'string'
      && v.messageAnchor.itemUid.length > 0 && v.messageAnchor.itemUid.length <= 1024) {
      const owner = v.messageAnchor.recordOwnerUserId
      const parsed = typeof owner === 'string' && owner.length > 19 ? 0 : recordOwnerId(owner)
      if (parsed) messageAnchor = { itemUid: v.messageAnchor.itemUid, recordOwnerUserId: parsed }
    }
    const entry: [string, ConversationViewportState] = [source, { scrollTop: v.stickToBottom ? 0 : v.scrollTop,
      stickToBottom: v.stickToBottom, ...(v.anchorId === undefined || v.stickToBottom ? {} : { anchorId: v.anchorId }),
      ...(v.anchorOffset === undefined || v.stickToBottom ? {} : { anchorOffset: v.anchorOffset }),
      ...(messageAnchor ? { messageAnchor } : {}) }]
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1
    if (bytes + size > 64 * 1024) break
    bytes += size; entries.unshift(entry)
  }
  return entries
}
