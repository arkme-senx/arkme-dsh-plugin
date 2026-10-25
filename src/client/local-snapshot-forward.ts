import type { NativeForwardDelivery, NativeForwardResult } from './native-forward-entry.js'
import { isNativeForwardCaller } from './native-forward-entry.js'
import type { SelectedTextNoteQuote } from '../selected-text-note.js'
export interface LocalForwardPreview { title: string; subtitle: string; quote?: SelectedTextNoteQuote }
export interface LocalSnapshotForward { userId: number; preview: LocalForwardPreview; delivery: NativeForwardDelivery }
type Presenter = (content: LocalSnapshotForward, signal: AbortSignal) => Promise<NativeForwardResult>
const entryKey = '__arkmeSelectedTextForwardEntry'
type ForwardHost = Window & { [entryKey]?: { open(content: LocalSnapshotForward, signal: AbortSignal, caller: Window): Promise<NativeForwardResult> } }
let presenter: Presenter | undefined
/** Same picker for Arkme surfaces and its currently visible DSH frame. */
export function registerLocalSnapshotForward(next: Presenter) {
  presenter = next
  const host = typeof window === 'undefined' ? undefined : window as ForwardHost
  const entry = { open(content: LocalSnapshotForward, signal: AbortSignal, caller: Window) {
    if (!host || host[entryKey] !== entry || !isNativeForwardCaller(host, caller)) throw new Error('DSH 对话已切换，请重新选择')
    signal.throwIfAborted()
    return next(content, signal)
  } }
  if (host) host[entryKey] = entry
  return () => { if (presenter === next) presenter = undefined; if (host?.[entryKey] === entry) delete host[entryKey] }
}
export function openLocalSnapshotForward(content: LocalSnapshotForward, signal: AbortSignal) {
  signal.throwIfAborted()
  if (presenter) return presenter(content, signal)
  const caller = typeof window === 'undefined' ? undefined : window
  const entry = caller && caller.parent !== caller ? (caller.parent as ForwardHost)[entryKey] : undefined
  if (!entry || !caller) throw new Error('转发页面尚未就绪，请稍后重试')
  return entry.open(content, signal, caller)
}
