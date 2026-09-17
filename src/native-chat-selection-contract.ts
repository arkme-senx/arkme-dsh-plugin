/** Client-submitted local conversation content, not an Arkme message capability. */
export interface NativeChatSelectionSnapshot {
  sessionId: string
  messages: readonly {
    key: string
    anchorSeq: number
    role: 'user' | 'assistant'
    text: string
    createdAtMillis: number
  }[]
}
export const NATIVE_FORWARD_MAX_MESSAGES = 100
export const NATIVE_FORWARD_MAX_TEXT_BYTES = 256 * 1024
export const NATIVE_FORWARD_MAX_TOTAL_BYTES = 8 * 1024 * 1024
