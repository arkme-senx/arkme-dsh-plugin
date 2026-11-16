import type { ArkmeTimelinePage } from '../types.js'

declare const __ARKME_LOCAL_HISTORY_TIMING__: boolean
export const historyTimingEnabled = typeof __ARKME_LOCAL_HISTORY_TIMING__ !== 'undefined' && __ARKME_LOCAL_HISTORY_TIMING__

const session = historyTimingEnabled ? crypto.randomUUID().replaceAll('-', '').slice(0, 16) : undefined
if (session) {
  performance.setResourceTimingBufferSize(2000)
  console.info('arkme: history-timing enabled v2')
}

let nextSample = 0
const ms = (duration: number) => Math.round(duration * 10) / 10

export class HistoryPageTiming {
  static start(trigger: 'prefetch' | 'manual'): HistoryPageTiming | undefined {
    if (historyTimingEnabled && nextSample < 48) return new HistoryPageTiming(++nextSample, trigger)
  }

  private readonly started = performance.now()
  private cacheStarted: number | undefined
  private cloudStarted: number | undefined
  private cloudFinished: number | undefined
  private pageReady: number | undefined
  private committedAt: number | undefined
  private origin: 'cache' | 'cloud' | 'cache-fallback' | 'unknown' = 'unknown'
  private settled = false
  private attempts = 0
  private cacheDecision: string | undefined
  queued = false

  constructor(private readonly sample: number, private readonly trigger: 'prefetch' | 'manual') {}

  cacheStart(): void { this.cacheStarted ??= performance.now() }

  cacheChecked(result: string): void { this.cacheDecision = result }

  async request(kind: 'cache' | 'cloud' | 'fallback',
    read: (trace: import('../sdk/index.js').ArkmeSdkTransportOptions['historyTrace']) => Promise<ArkmeTimelinePage>,
  ): Promise<ArkmeTimelinePage> {
    const pageId = session ? `${session}-${this.sample}` : undefined
    if (!pageId) return await read(undefined)
    const id = `${pageId}-${++this.attempts}`
    const started = performance.now()
    let status: number | undefined
    let headersAt: number | undefined
    let phases: string | null = null
    let outcome = 'ok'
    try {
      return await read({ id, response(code, timing) { status = code; phases = timing; headersAt = performance.now() } })
    } catch (error) {
      const code = (error as { body?: { code?: unknown }; name?: unknown })?.body?.code
      const name = (error as { name?: unknown })?.name
      outcome = typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code
        : name === 'AbortError' || name === 'TimeoutError' ? name : 'read-failed'
      throw error
    } finally {
      const ended = performance.now()
      // Resource Timing becomes observable after fetch resolves, including fast misses.
      setTimeout(() => {
        const entries = performance.getEntriesByType('resource').filter(entry => entry.name.endsWith(`?historyTrace=${id}`))
          .slice(-3) as PerformanceResourceTiming[]
        console.info('arkme: history-attempt ' + JSON.stringify({
          id, kind, outcome, status, phases, startedAt: ms(performance.timeOrigin + started),
          startMs: ms(started - this.started), elapsedMs: ms(ended - started),
          headersMs: headersAt === undefined ? undefined : ms(headersAt - started),
          bodyAndParseMs: headersAt === undefined ? undefined : ms(ended - headersAt),
          resources: entries.map(entry => ({
            beforeFetchMs: ms(entry.startTime - started),
            preSendMs: entry.requestStart > 0 ? ms(entry.requestStart - entry.startTime) : undefined,
            sentAt: entry.requestStart > 0 ? ms(performance.timeOrigin + entry.requestStart) : undefined,
            waitForHeadersMs: entry.responseStart > 0 ? ms(entry.responseStart - entry.requestStart) : undefined,
            transferMs: entry.responseStart > 0 ? ms(entry.responseEnd - entry.responseStart) : undefined,
          })),
        }))
      }, 0)
    }
  }

  async readCloud(read: () => Promise<ArkmeTimelinePage>): Promise<ArkmeTimelinePage> {
    this.cloudStarted ??= performance.now()
    try { return await read() } finally { this.cloudFinished = performance.now() }
  }

  received(page: ArkmeTimelinePage): void {
    this.pageReady = performance.now()
    this.origin = page.cache?.origin === 'local' ? this.cloudStarted === undefined ? 'cache' : 'cache-fallback'
      : page.cache?.origin === 'network' ? 'cloud' : 'unknown'
  }

  finish(phase: 'failed' | 'no-new-rows' | 'skipped'): void {
    if (!this.settled) this.report(phase, performance.now(), 0)
    this.settled = true
  }

  private report(phase: string, now: number, rows: number): void {
    const cacheEnd = this.cloudStarted ?? this.pageReady ?? now
    const fallbackMs = this.origin === 'cache-fallback' && this.cloudFinished !== undefined && this.pageReady !== undefined
      ? ms(this.pageReady - this.cloudFinished) : undefined
    console.info('arkme: history-page ' + JSON.stringify({
      sample: this.sample, pageId: session ? `${session}-${this.sample}` : undefined, trigger: this.trigger, phase, origin: this.origin, rows,
      attempts: this.attempts, cacheDecision: this.cacheDecision,
      totalMs: ms(now - this.started),
      cacheReadMs: this.cacheStarted === undefined ? undefined : ms(cacheEnd - this.cacheStarted),
      cloudReadMs: this.cloudStarted === undefined ? undefined : ms((this.cloudFinished ?? now) - this.cloudStarted),
      fallbackMs,
      dataReadyMs: this.pageReady === undefined ? undefined : ms(this.pageReady - this.started),
      commitMs: this.committedAt === undefined ? undefined : ms(this.committedAt - this.started),
    }))
  }

  observe(root: HTMLElement, rowIds: ReadonlySet<string>, done: () => void): () => void {
    this.committedAt = performance.now()
    let frame: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready = false
    let closed = false
    const stop = () => {
      if (closed) return
      closed = true
      if (frame !== undefined) cancelAnimationFrame(frame)
      clearTimeout(timer)
      root.removeEventListener('scroll', schedule)
      done()
    }
    const check = () => {
      frame = undefined
      if (closed) return
      const now = performance.now()
      if (!ready) { ready = true; this.report('paint-ready', now, rowIds.size) }
      if (document.visibilityState === 'hidden') return
      const viewport = root.getBoundingClientRect()
      for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-message-item-uid][data-arkme-conversation-row]')) {
        if (!rowIds.has(row.dataset.arkmeConversationRow ?? '')) continue
        const rect = row.getBoundingClientRect()
        if (rect.bottom > Math.max(0, viewport.top) && rect.top < Math.min(window.innerHeight, viewport.bottom) && rect.height > 0) {
          this.report('visible', now, rowIds.size)
          stop()
          return
        }
      }
    }
    function schedule() {
      if (!closed && frame === undefined) {
        // Wait through a paint opportunity after React commits or the user scrolls.
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(check) })
      }
    }
    root.addEventListener('scroll', schedule, { passive: true })
    timer = setTimeout(stop, 60_000)
    schedule()
    return stop
  }
}
