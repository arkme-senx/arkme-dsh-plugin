import type { NativeForwardDelivery, NativeForwardResult } from './native-forward-entry.js'
export interface LocalSnapshotForward { userId: number; preview: { title: string; subtitle: string }; delivery: NativeForwardDelivery }
type Presenter = (content: LocalSnapshotForward, signal: AbortSignal) => Promise<NativeForwardResult>
let presenter: Presenter | undefined
/** In-process presenter for Arkme-owned surfaces. The DSH frame keeps its separate caller check. */
export function registerLocalSnapshotForward(next: Presenter) {
  presenter = next
  return () => { if (presenter === next) presenter = undefined }
}
export function openLocalSnapshotForward(content: LocalSnapshotForward, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!presenter) throw new Error('转发页面尚未就绪，请稍后重试')
  return presenter(content, signal)
}
