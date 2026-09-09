/** Bound interactive reads, including browser connection-queue time. Never retry writes here. */
export async function withArkmeReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => { controller.abort(signal?.reason) }
  let rejectCancelled!: (reason: unknown) => void
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject })
  const onAbort = () => { rejectCancelled(controller.signal.reason) }
  controller.signal.addEventListener('abort', onAbort, { once: true })
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('读取超时，请重试')) }, 30_000)
  try {
    return await Promise.race([read(controller.signal), cancelled])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
