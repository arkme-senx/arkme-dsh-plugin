import { tr } from './locale.js'

class ShareSaveTimeoutError extends Error {
  constructor() { super(tr('保存超时，请重新加载后核对共享状态。')); this.name = 'ShareSaveTimeoutError' }
}
// A timeout cannot establish whether a write committed. Stop the batch and
// require an authoritative reload before editing or submitting another change.
export async function saveExternalChatWithDeadline<T>(submit: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  let rejectCancelled!: (reason: unknown) => void
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject })
  const onAbort = () => rejectCancelled(controller.signal.reason)
  controller.signal.addEventListener('abort', onAbort, {once: true})
  signal.addEventListener('abort', cancel, {once: true})
  const timer = setTimeout(() => controller.abort(new ShareSaveTimeoutError()), 30_000)
  try { return await Promise.race([submit(controller.signal), cancelled]) }
  finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
export function externalChatWriteUncertain(error: unknown): boolean {
  const code = (error as {body?: {code?: string}} | null)?.body?.code
  return error instanceof ShareSaveTimeoutError || (error instanceof Error && error.name === 'AbortError')
    || code === 'local-network-unavailable' || code === 'local-response-invalid'
}

