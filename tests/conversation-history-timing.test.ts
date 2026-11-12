import { expect, it, vi } from 'vitest'
import { HistoryPageTiming } from '../src/client/conversation-history-timing.js'
import type { ArkmeTimelinePage } from '../src/types.js'

it.each(['cache', 'cloud', 'cache-fallback'] as const)('records %s page readiness separately from entering the viewport', async origin => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const tick = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    now += 16
    for (const callback of callbacks) callback(now)
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('window', { innerHeight: 600 })
  let top = -100
  const row = { dataset: { arkmeConversationRow: 'private-row' },
    getBoundingClientRect: () => ({ top, bottom: top + 20, height: 20 }) }
  const root = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    querySelectorAll: () => [row],
  }) as unknown as HTMLElement
  const timing = new HistoryPageTiming(7, 'prefetch')
  const page = { cache: { origin: origin === 'cloud' ? 'network' : 'local' } } as ArkmeTimelinePage
  timing.cacheStart()
  now = 5
  if (origin !== 'cache') {
    await timing.readCloud(async () => { now += 100; return page })
    if (origin === 'cache-fallback') now += 10
  }
  timing.received(page)
  now += 3
  const done = vi.fn()
  const cleanup = timing.observe(root, new Set(['private-row']), done)
  try {
    tick(); tick()
    const logs = () => log.mock.calls.map(([line]) => JSON.parse(line.replace('arkme: history-page ', '')))
    expect(logs()).toEqual([expect.objectContaining({ phase: 'paint-ready', origin, cacheReadMs: 5, rows: 1,
      ...(origin !== 'cache' ? { cloudReadMs: 100 } : {}), ...(origin === 'cache-fallback' ? { fallbackMs: 10 } : {}) })])
    top = 200
    now += 200
    root.dispatchEvent(new Event('scroll'))
    tick(); tick()
    expect(logs()[1]).toMatchObject({ phase: 'visible', totalMs: now, sample: 7, trigger: 'prefetch' })
    expect(JSON.stringify(logs())).not.toContain('private-row')
    expect(done).toHaveBeenCalledOnce()
  } finally {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})

it('keeps queue timing with the queued request when another request admits it', async () => {
  const { bindConversationRead, measureConversationRead, recordConversationReadPhase } = await import('../src/conversation-read-diagnostics.js')
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  let admit!: () => void
  let finish!: () => void
  const waiting = new Promise<void>(resolve => { finish = resolve })
  let queuedHeaders = ''
  let otherHeaders = ''
  try {
    const queued = measureConversationRead('source.timeline', async () => {
      admit = bindConversationRead(() => recordConversationReadPhase('owner-queue', 120))
      await waiting
    }, value => { queuedHeaders = value }, '1234567812345678-1-1')
    await measureConversationRead('source.timeline', async () => { admit() },
      value => { otherHeaders = value }, '1234567812345678-1-2')
    finish()
    await queued
    expect(queuedHeaders).toContain('arkme-owner-queue;dur=120.0')
    expect(otherHeaders).not.toContain('arkme-owner-queue')
  } finally { finish(); log.mockRestore() }
})
