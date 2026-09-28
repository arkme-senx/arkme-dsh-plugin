import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryPage } from '../src/types.js'
import { RecognizedSpeakerDirectory, SpeakerReadDeferred } from '../src/client/recognized-speaker-directory.js'

const page = (id: string, nextCursor = ''): ArkmeDirectoryPage => ({ section: 'unmarked-speakers', items: [{ kind: 'unmarked-speaker', candidateRef: id, identityKey: id, displayName: id, subtitle: '' }], total: 2, hasMore: nextCursor !== '', nextCursor, projectionState: 'fresh' })
const signal = () => new AbortController().signal
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const loaders = (read: (cursor: string, signal: AbortSignal) => Promise<ArkmeDirectoryPage>) => ({ page: vi.fn(read), marked: vi.fn(async () => []), presence: vi.fn(async () => ({ state: 'fresh' as const, scope: 'all-history' as const, items: [] })) })
afterEach(() => { vi.useRealTimers() })

describe('shared recognized speaker directory', () => {
  it('shares an in-flight traversal and both cached sources between entry and list', async () => {
    let finish!: (value: ArkmeDirectoryPage) => void
    const source = loaders(async cursor => cursor === '' ? page('a', 'next') : await new Promise(resolve => { finish = resolve }))
    const store = new RecognizedSpeakerDirectory(source, 0)
    const a = vi.fn(), b = vi.fn()
    const first = store.readCandidates('prod:1', signal(), a)
    await flush()
    const second = store.readCandidates('prod:1', signal(), b)
    expect(b.mock.calls[0]![0].items).toHaveLength(1)
    finish(page('b'))
    expect((await first).items).toHaveLength(2)
    expect(await second).toEqual(await first)
    await store.readCandidates('prod:1', signal(), () => {})
    await Promise.all([store.readMarked('prod:1', signal()), store.readMarked('prod:1', signal())])
    await store.readMarked('prod:1', signal())
    expect(source.page.mock.calls.map(call => call[0])).toEqual(['', 'next'])
    expect(source.marked).toHaveBeenCalledOnce()
    store.clear()
  })

  it('hands off a pending read across entry unmount without aborting the list reader', async () => {
    vi.useFakeTimers()
    let finish!: (value: ArkmeDirectoryPage) => void
    const source = loaders(async () => await new Promise(resolve => { finish = resolve }))
    const store = new RecognizedSpeakerDirectory(source, 0)
    const entry = new AbortController()
    const first = store.readCandidates('a', entry.signal, () => {}).catch(error => error)
    await flush()
    entry.abort()
    const second = store.readCandidates('a', signal(), () => {})
    await vi.advanceTimersByTimeAsync(300)
    expect(source.page.mock.calls[0]![1].aborted).toBe(false)
    finish(page('a'))
    expect((await second).complete).toBe(true)
    expect(await first).toMatchObject({ name: 'AbortError' })
    expect(source.page).toHaveBeenCalledOnce()
    store.clear()
  })

  it('backs off after 429 and resumes failed pagination without re-reading successful pages', async () => {
    vi.useFakeTimers()
    let fail = true
    const source = loaders(async cursor => {
      if (cursor === '') return page('a', 'next')
      if (fail) throw new Error('Arkme 服务返回 HTTP 429')
      return page('b')
    })
    const store = new RecognizedSpeakerDirectory(source, 0)
    await expect(store.readCandidates('a', signal(), () => {})).rejects.toBeInstanceOf(SpeakerReadDeferred)
    expect(store.peekCandidates('a')?.items).toHaveLength(1)
    await expect(store.readCandidates('a', signal(), () => {})).rejects.toBeInstanceOf(SpeakerReadDeferred)
    expect(source.page).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    fail = false
    const result = await store.readCandidates('a', signal(), () => {})
    expect(result.complete).toBe(true)
    expect(source.page.mock.calls.map(call => call[0])).toEqual(['', 'next', 'next'])
    store.clear()
  })

  it('does not let refresh bypass backoff and progressively increases the retry delay', async () => {
    vi.useFakeTimers()
    const source = loaders(async () => { throw new Error('HTTP 429') })
    const store = new RecognizedSpeakerDirectory(source, 0)
    const first = await store.readCandidates('a', signal(), () => {}).catch(error => error as SpeakerReadDeferred)
    expect(first.retryAt - Date.now()).toBe(60_000)
    store.invalidate('a')
    await expect(store.readCandidates('a', signal(), () => {})).rejects.toBeInstanceOf(SpeakerReadDeferred)
    expect(source.page).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    const second = await store.readCandidates('a', signal(), () => {}).catch(error => error as SpeakerReadDeferred)
    expect(second.retryAt - Date.now()).toBe(120_000)
    store.clear()
  })

  it('keeps a complete old list visible while replacing it atomically in the background', async () => {
    vi.useFakeTimers()
    let version = 0, finish!: (value: ArkmeDirectoryPage) => void
    const source = loaders(async cursor => version === 0 ? page('old') : cursor === '' ? page('new-a', 'next') : await new Promise(resolve => { finish = resolve }))
    const store = new RecognizedSpeakerDirectory(source, 0)
    await store.readCandidates('a', signal(), () => {})
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    version = 1
    const progress = vi.fn()
    const refresh = store.readCandidates('a', signal(), progress)
    await flush()
    expect(store.peekCandidates('a')!.items.map(row => row.candidateRef)).toEqual(['old'])
    finish(page('new-b'))
    expect((await refresh).items.map(row => row.candidateRef)).toEqual(['new-a', 'new-b'])
    expect(progress.mock.calls.every(([value]) => value.complete)).toBe(true)
    store.clear()
  })

  it('preserves the previous list on a refresh failure instead of emptying it', async () => {
    const source = loaders(async () => page('old'))
    const store = new RecognizedSpeakerDirectory(source, 0)
    await store.readCandidates('a', signal(), () => {})
    source.page.mockRejectedValue(new Error('offline'))
    store.invalidate('a')
    await expect(store.readCandidates('a', signal(), () => {})).rejects.toBeInstanceOf(SpeakerReadDeferred)
    expect(store.peekCandidates('a')?.items[0]?.candidateRef).toBe('old')
    store.clear()
  })

  it('cancels unused requests and discards late responses after logout/account reset', async () => {
    vi.useFakeTimers()
    let finish!: (value: ArkmeDirectoryPage) => void
    const source = loaders(async () => await new Promise(resolve => { finish = resolve }))
    const store = new RecognizedSpeakerDirectory(source, 0)
    const controller = new AbortController()
    const read = store.readCandidates('old', controller.signal, () => {}).catch(error => error)
    await flush()
    controller.abort()
    await vi.advanceTimersByTimeAsync(251)
    expect(source.page.mock.calls[0]![1].aborted).toBe(true)
    store.clear()
    finish(page('late'))
    await read; await flush()
    expect(store.peekCandidates('old')).toBeUndefined()
    expect(store.peekCandidates('next')).toBeUndefined()
  })

  it('isolates accounts and invalidates cached marked and presence data after a mutation', async () => {
    const source = loaders(async () => page('a'))
    const store = new RecognizedSpeakerDirectory(source, 0)
    await store.readMarked('a', signal()); await store.readPresence('a', signal())
    await store.readMarked('b', signal())
    expect(source.marked).toHaveBeenCalledTimes(2)
    store.invalidate('a')
    await store.readMarked('a', signal()); await store.readPresence('a', signal())
    expect(source.marked).toHaveBeenCalledTimes(3)
    expect(source.presence).toHaveBeenCalledTimes(2)
    store.clear()
  })

  it('discards cached pages when a resumed cursor reports a stale snapshot', async () => {
    vi.useFakeTimers()
    const source = loaders(vi.fn().mockResolvedValueOnce(page('old', 'next')).mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValueOnce({ ...page(''), cursorStale: true }).mockResolvedValueOnce(page('new')))
    const store = new RecognizedSpeakerDirectory(source, 0)
    await expect(store.readCandidates('a', signal(), () => {})).rejects.toBeInstanceOf(SpeakerReadDeferred)
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await store.readCandidates('a', signal(), () => {})
    expect(result.items.map(row => row.candidateRef)).toEqual(['new'])
    expect(source.page.mock.calls.map(call => call[0])).toEqual(['', 'next', 'next', ''])
    store.clear()
  })

  it('spaces network pages while cached pages are reused without delay', async () => {
    vi.useFakeTimers()
    const source = loaders(async cursor => cursor === '' ? page('a', 'next') : page('b'))
    const store = new RecognizedSpeakerDirectory(source, 750)
    const read = store.readCandidates('a', signal(), () => {})
    await flush()
    expect(source.page).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(749)
    expect(source.page).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect((await read).complete).toBe(true)
    expect(source.page).toHaveBeenCalledTimes(2)
    store.clear()
  })
})
