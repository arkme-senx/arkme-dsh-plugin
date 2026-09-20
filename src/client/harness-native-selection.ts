import { NATIVE_FORWARD_MAX_MESSAGES, NATIVE_FORWARD_MAX_TEXT_BYTES, NATIVE_FORWARD_MAX_TOTAL_BYTES, type NativeChatForwardSnapshot } from '../native-chat-forward-contract.js'
export interface NativeSelectionSnapshot {
  readonly active: boolean
  readonly keys: ReadonlySet<string>
}

export const EMPTY_NATIVE_SELECTION: NativeSelectionSnapshot = { active: false, keys: new Set() }
export type NativeSelectionAction = { type: 'enter'; key?: string } | { type: 'exit' } | { type: 'toggle' | 'remove'; key: string }

/** Pure session-local selection rules; React owns subscription and lifetime. */
export function nativeSelectionReducer(state: NativeSelectionSnapshot, action: NativeSelectionAction): NativeSelectionSnapshot {
  if (action.type === 'exit') return state.active ? EMPTY_NATIVE_SELECTION : state
  if (action.type === 'enter') return state.active ? state : { active: true, keys: new Set(action.key ? [action.key] : []) }
  if (!state.active || (action.type === 'remove' && !state.keys.has(action.key))) return state
  const keys = new Set(state.keys)
  if (keys.has(action.key)) keys.delete(action.key)
  else keys.add(action.key)
  return { active: true, keys }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Minimal read boundary for the public ui-chat contract; no host UI imports. */
export interface NativeChat {
  readonly nodes: {
    get(key: string): unknown
    source(key: string): { subscribe(listener: () => void): () => void }
  }
}

export function readNativeChat(value: unknown): NativeChat | undefined {
  if (!object(value) || !object(value.nodes)
    || typeof value.nodes.get !== 'function' || typeof value.nodes.source !== 'function') return
  return value as unknown as NativeChat
}

export function isSelectableNativeNode(value: unknown): value is { key: string; kind: string } {
  if (!object(value) || typeof value.key !== 'string' || value.target !== 'chat' || value.visibility !== 'visible') return false
  if (value.kind === 'user') return true
  if (value.kind !== 'assistant-step' || !object(value.data) || value.data.status !== 'settled' || !Array.isArray(value.data.blocks)) return false
  return value.data.blocks.some(block => object(block) && block.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
}

/** A missing projection may be unloaded; a present ineligible node is authoritative. */
export function observeSelectedNativeNodes(chat: NativeChat, keys: ReadonlySet<string>, remove: (key: string) => void, fail: () => void): () => void {
  const subscriptions: Array<() => void> = []
  const dispose = () => { subscriptions.splice(0).forEach(unsubscribe => unsubscribe()) }
  try {
    for (const key of keys) {
      const check = () => {
        try {
          const node = chat.nodes.get(key)
          if (node !== undefined && (!isSelectableNativeNode(node) || node.key !== key)) remove(key)
        } catch { fail() }
      }
      subscriptions.push(chat.nodes.source(key).subscribe(check))
      check()
    }
    return dispose
  } catch (error) { dispose(); throw error }
}

/** Native user content and assistant display blocks are separate host contracts. */
function nativeSelectionText(chat: NativeChat, key: string): string {
  const node = chat.nodes.get(key)
  if (!isSelectableNativeNode(node) || node.key !== key || !('data' in node) || !object(node.data)) throw new Error('当前消息暂不可用，请重新选择')
  const blocks = node.kind === 'user' ? node.data.content : node.data.blocks
  if (!Array.isArray(blocks)) throw new Error('当前消息暂不可用，请重新选择')
  return blocks.filter(block => object(block) && (node.kind === 'user' ? block.type : block.kind) === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('')
}

export function nativeSelectionCopyText(chat: NativeChat, key: string): string {
  return nativeSelectionText(chat, key).trim()
}

/** Freeze the selected public projections; DOM order and selection order are not message order. */
export function nativeSelectionForwardSnapshot(chat: NativeChat, sessionId: string, keys: ReadonlySet<string>): NativeChatForwardSnapshot {
  if (!sessionId.trim() || keys.size === 0 || keys.size > NATIVE_FORWARD_MAX_MESSAGES) throw new Error('请选择 1–100 条消息')
  let bytes = 0
  const messages = [...keys].map(key => {
    const node = chat.nodes.get(key)
    if (!isSelectableNativeNode(node) || node.key !== key || !('anchorSeq' in node)
      || typeof node.anchorSeq !== 'number' || !Number.isSafeInteger(node.anchorSeq) || node.anchorSeq < 0
      || !('data' in node) || !object(node.data) || typeof node.data.time !== 'number'
      || !Number.isSafeInteger(node.data.time) || node.data.time <= 0) throw new Error('所选消息暂不可用，请重新选择')
    const text = nativeSelectionText(chat, key)
    if (!text.trim()) throw new Error('所选消息没有可转发正文，请调整选择')
    const size = new TextEncoder().encode(text).byteLength
    bytes += size
    if (size > NATIVE_FORWARD_MAX_TEXT_BYTES || bytes > NATIVE_FORWARD_MAX_TOTAL_BYTES) throw new Error('所选正文超过转发大小限制，请减少选择')
    return { key, anchorSeq: node.anchorSeq, role: node.kind === 'user' ? 'user' as const : 'assistant' as const, text, createdAtMillis: node.data.time }
  }).sort((a, b) => a.anchorSeq - b.anchorSeq)
  if (new Set(messages.map(message => message.anchorSeq)).size !== messages.length) throw new Error('所选消息顺序暂不可用，请重新选择')
  return { sessionId, messages }
}
