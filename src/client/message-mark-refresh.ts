/** One owner coalesces hints, visibility recovery and fallback reconciliation. */
export function startMessageMarkRefresh(options: {
  read(): Promise<void>
  visible(): boolean
  subscribe?(invalidate: () => void): () => void
  onError(error: unknown): void
  intervalMs?: number
}) {
  let stopped = false, running = false, dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const request = (delay = 100) => {
    if (stopped) return
    dirty = true
    if (running) return
    // Repeated hints share the first scheduled read; they never postpone it.
    if (timer !== undefined && dirtyTimer) return
    clear()
    dirtyTimer = true
    timer = setTimeout(() => { timer = undefined; void run() }, delay)
  }
  let dirtyTimer = false
  const run = async () => {
    if (stopped || !options.visible()) return
    running = true; dirty = false
    try { await options.read() }
    catch (error) { if (!stopped) options.onError(error) }
    finally {
      running = false
      if (stopped) return
      if (dirty) request()
      else {
        dirtyTimer = false
        timer = setTimeout(() => { timer = undefined; void run() }, options.intervalMs ?? 15_000)
      }
    }
  }
  const unsubscribe = options.subscribe?.(() => request())
  request(0)
  return { request, dispose() { stopped = true; clear(); unsubscribe?.() } }
}
