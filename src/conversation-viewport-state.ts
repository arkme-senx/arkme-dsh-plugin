/** Presentation geometry only; never message bodies, credentials or server cursors. */
export interface ConversationViewportState {
  scrollTop: number
  stickToBottom: boolean
  anchorId?: string
  anchorOffset?: number
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
    const entry: [string, ConversationViewportState] = [source, { scrollTop: v.stickToBottom ? 0 : v.scrollTop,
      stickToBottom: v.stickToBottom, ...(v.anchorId === undefined || v.stickToBottom ? {} : { anchorId: v.anchorId }),
      ...(v.anchorOffset === undefined || v.stickToBottom ? {} : { anchorOffset: v.anchorOffset }) }]
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1
    if (bytes + size > 64 * 1024) break
    bytes += size; entries.unshift(entry)
  }
  return entries
}
