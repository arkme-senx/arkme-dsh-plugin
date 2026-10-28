import { registerMessageTextSelectionTarget, type MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { quoteDomProjection } from './message-quote-selection.js'
import type { NativeChat } from './harness-native-selection.js'

export interface NativeTextInputActions {
  captureInsertion(): { start: number; end: number; draftRev: number }
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
  persistDraft(): void
}
/** Insertion is revision guarded, never setDraft/submit; even a selected draft is preserved. */
export function insertNativeQuote(actions: NativeTextInputActions, text: string, sender: string) {
  const span = actions.captureInsertion()
  const content = `\n\n> 引用${sender}：\n${text.split(/\r?\n/u).map(line => `> ${line}`).join('\n')}\n\n`
  if (!actions.insertText(content, { ...span, start: span.end })) throw new Error('输入框正在提交或草稿已变化，请重新引用')
  actions.persistDraft()
}

export function nativeTextNode(chat: NativeChat, key: string) {
  const value = chat.nodes.get(key) as { key?: string; kind?: string; target?: string; visibility?: string; data?: { seq?: number; finalNode?: { seq?: number }; status?: string; content?: unknown[]; blocks?: unknown[]; time?: number } } | undefined
  if (!value || value.key !== key || value.target !== 'chat' || value.visibility !== 'visible' || !['user', 'assistant-step'].includes(value.kind ?? '')) return
  const blocks = value.kind === 'user' ? value.data?.content : value.data?.blocks
  if (!Array.isArray(blocks)) return
  const text = blocks.flatMap(block => {
    if (!block || typeof block !== 'object') return []
    const b = block as { type?: string; kind?: string; text?: string }
    return (value.kind === 'user' ? b.type : b.kind) === 'text' && typeof b.text === 'string' ? [b.text] : []
  }).join('')
  if (!text.trim()) return
  const eventSeq = value.kind === 'user' ? value.data?.seq : value.data?.finalNode?.seq
  return { text, eventSeq: Number.isSafeInteger(eventSeq) && eventSeq! >= 0 ? eventSeq : undefined, settled: value.kind === 'user' || value.data?.status === 'settled', isMe: value.kind === 'user', time: value.data?.time ?? 0 }
}

const rowSelector = '[data-chat-anchor-key][data-chat-flow-kind]'
/** Narrow compatibility boundary. Unknown bodies fail closed, not a replacement renderer. */
export function nativeTextRows(doc: Document, chat: NativeChat) {
  const flows = [...doc.querySelectorAll('[data-chat-flow]')].filter(flow => !flow.parentElement?.closest('[data-chat-flow]'))
  if (flows.length !== 1) return []
  const flow = flows[0]!
  const rows = [...flow.querySelectorAll<HTMLElement>(rowSelector)]
  return rows.flatMap(row => {
    const key = row.dataset.chatAnchorKey
    if (!key || row.parentElement?.closest(rowSelector) || row.closest('[hidden],[aria-hidden="true"],[data-turn-process-hidden="true"]')
      || row.dataset.chatGroupPart && row.dataset.chatGroupPart !== 'response'
      || row.dataset.chatNodeKey && row.dataset.chatNodeKey !== key
      || rows.filter(other => other.dataset.chatAnchorKey === key).length !== 1) return []
    const node = nativeTextNode(chat, key)
    if (!node) return []
    // Public user-text slot; native assistant Markdown has a CSS-module suffix.
    const prose = [...row.querySelectorAll<HTMLElement>(node.isMe ? '[data-slot="conversation.user.text.node"]' : '[class*="_markdown_"]')]
      .filter(element => element.closest(rowSelector) === row && !element.closest('button,[role="dialog"],[data-turn-process-hidden="true"]'))
      .filter((element, _, all) => !all.some(other => other !== element && other.contains(element)))
    if (!prose.length) return []
    return [{ row, key, node, prose }]
  })
}

export function observeNativeTextTargets(doc: Document, chat: NativeChat, sourceRef: string) {
  const active = new Map<HTMLElement, { signature: string; dispose: () => void }>()
  const subscriptions = new Map<string, () => void>()
  let frame = 0, disposed = false
  const scan = () => {
    frame = 0
    if (disposed) return
    const present = new Set<HTMLElement>(), keys = new Set<string>()
    for (const { row, key, node, prose } of nativeTextRows(doc, chat)) {
      keys.add(key)
      if (!subscriptions.has(key)) subscriptions.set(key, chat.nodes.source(key).subscribe(schedule))
      for (const element of prose) element.setAttribute('data-arkme-quote-prose', '')
      const text = quoteDomProjection(row).text
      if (!text) { prose.forEach(element => element.removeAttribute('data-arkme-quote-prose')); continue }
      present.add(row)
      const signature = JSON.stringify([key, text, node.settled])
      if (active.get(row)?.signature === signature) continue
      active.get(row)?.dispose()
      // Dispose removes old prose attributes too, so restore the current ones.
      for (const element of prose) element.setAttribute('data-arkme-quote-prose', '')
      const target: MessageSelectionTarget = { sourceRef, selectionDomain: 'native', localMarkRef: JSON.stringify([sourceRef, key, text, node.eventSeq === undefined ? null : { eventSeq: node.eventSeq, role: node.isMe ? 'user' : 'assistant' }]), item: {
        itemUid: key, title: '', textContent: text, textFormat: 'plain', status: node.settled ? 1 : 0,
        senderName: node.isMe ? '你' : 'DeepSeek Harness', isMe: node.isMe, sendAtMillis: node.time,
      } }
      const unregister = registerMessageTextSelectionTarget(row, node.text, target)
      active.set(row, { signature, dispose: () => { unregister(); prose.forEach(element => element.removeAttribute('data-arkme-quote-prose')) } })
    }
    for (const [row, entry] of active) if (!present.has(row)) { entry.dispose(); active.delete(row) }
    for (const [key, unsubscribe] of subscriptions) if (!keys.has(key)) { unsubscribe(); subscriptions.delete(key) }
  }
  const schedule = () => { if (!disposed && !frame) frame = doc.defaultView!.requestAnimationFrame(scan) }
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-arkme-underline-layer],[data-arkme-native-find],[data-arkme-text-selection-toolbar]'))) schedule()
  })
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true })
  // Background tabs throttle animation frames. Register before the first user
  // interaction too, so a freshly displayed message never misses its first selection.
  doc.addEventListener('mousedown', scan, true)
  scan()
  return () => { disposed = true; observer.disconnect(); doc.removeEventListener('mousedown', scan, true); doc.defaultView!.cancelAnimationFrame(frame); active.forEach(entry => entry.dispose()); subscriptions.forEach(unsubscribe => unsubscribe()) }
}
