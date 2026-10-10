import { describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryPage } from '../src/types.js'
import { compareRecognizedSpeakers, loadSpeakerCandidateSnapshot, readRecognizedSpeakerOrder, writeRecognizedSpeakerOrder } from '../src/client/recognized-speaker-order.js'

const row = (key: string) => ({ kind: 'unmarked-speaker' as const, candidateRef: key, displayName: key, subtitle: '', appearanceDays: 1, latestAtMillis: 10 })
const page = (keys: string[], nextCursor = ''): ArkmeDirectoryPage => ({ section: 'unmarked-speakers', items: keys.map(row), total: keys.length, hasMore: nextCursor !== '', nextCursor, projectionState: 'fresh' })

describe('recognized speaker order', () => {
  const speakers = [
    { key: 'older', name: '甲', dayCount: 8, lastSeenAt: 100 },
    { key: 'newer', name: '乙', dayCount: 8, lastSeenAt: 200 },
    { key: 'recent', name: '丙', dayCount: 1, lastSeenAt: 300 },
    { key: 'unknown', name: 'A' },
  ]
  it('orders by day count then recent time, or recent time then day count', () => {
    expect([...speakers].sort((a, b) => compareRecognizedSpeakers(a, b, 'frequent')).map(x => x.key)).toEqual(['newer', 'older', 'recent', 'unknown'])
    expect([...speakers].sort((a, b) => compareRecognizedSpeakers(a, b, 'recent')).map(x => x.key)).toEqual(['recent', 'newer', 'older', 'unknown'])
    expect(compareRecognizedSpeakers({ ...speakers[0]!, lastSeenAt: 300 }, speakers[2]!, 'recent')).toBeLessThan(0)
  })
  it('uses natural names and stable identity for exact ties, ignoring invalid numbers', () => {
    expect(compareRecognizedSpeakers({ key: 'a', name: '说话人 2' }, { key: 'b', name: '说话人 10', dayCount: NaN, lastSeenAt: Infinity }, 'frequent')).toBeLessThan(0)
    expect(compareRecognizedSpeakers({ key: 'a', name: '同名' }, { key: 'b', name: '同名' }, 'recent')).toBeLessThan(0)
  })
  it('remembers each account independently and tolerates unavailable storage', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    expect(readRecognizedSpeakerOrder('a', storage)).toBe('frequent')
    writeRecognizedSpeakerOrder('a', 'recent', storage)
    expect(readRecognizedSpeakerOrder('a', storage)).toBe('recent')
    expect(readRecognizedSpeakerOrder('b', storage)).toBe('frequent')
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readRecognizedSpeakerOrder('a', blocked)).toBe('frequent')
    expect(() => writeRecognizedSpeakerOrder('a', 'recent', blocked)).not.toThrow()
  })
})

describe('complete speaker metadata traversal', () => {
  it('automatically reads later pages and deduplicates before claiming complete coverage', async () => {
    const load = vi.fn(async (cursor: string) => cursor === '' ? page(['a'], 'next') : page(['a', 'newest']))
    const progress = vi.fn()
    const result = await loadSpeakerCandidateSnapshot(load, new AbortController().signal, progress)
    expect(load.mock.calls.map(call => call[0])).toEqual(['', 'next'])
    expect(result.items.map(item => item.candidateRef)).toEqual(['a', 'newest'])
    expect(result.complete).toBe(true)
    expect(progress.mock.calls[0]![0].complete).toBe(false)
  })
  it('discards stale versions and restarts once without mixing rows', async () => {
    const load = vi.fn().mockResolvedValueOnce(page(['old'], 'next')).mockResolvedValueOnce({ ...page([]), cursorStale: true })
      .mockResolvedValueOnce(page(['new']))
    const result = await loadSpeakerCandidateSnapshot(load, new AbortController().signal, () => {})
    expect(load.mock.calls.map(call => call[0])).toEqual(['', 'next', ''])
    expect(result.items.map(item => item.candidateRef)).toEqual(['new'])
    expect(result.complete).toBe(true)
  })
  it('stops repeated stale versions, looping cursors and missing cursors as incomplete', async () => {
    const signal = new AbortController().signal
    const stale = vi.fn(async () => ({ ...page([]), cursorStale: true }))
    expect((await loadSpeakerCandidateSnapshot(stale, signal, () => {})).complete).toBe(false)
    expect(stale).toHaveBeenCalledTimes(2)
    const loop = vi.fn(async () => page(['a'], 'next'))
    expect((await loadSpeakerCandidateSnapshot(loop, signal, () => {})).complete).toBe(false)
    expect(loop).toHaveBeenCalledTimes(2)
    expect((await loadSpeakerCandidateSnapshot(async () => ({ ...page(['a']), hasMore: true }), signal, () => {})).complete).toBe(false)
  })
  it.each(['building', 'stale', 'failed'] as const)('does not claim %s data is complete or keep scanning', async projectionState => {
    const load = vi.fn(async () => ({ ...page(['a'], 'next'), projectionState }))
    const result = await loadSpeakerCandidateSnapshot(load, new AbortController().signal, () => {})
    expect(result.complete).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('bounds reads and rows without pretending the list is complete', async () => {
    const load = vi.fn(async (cursor: string) => {
      const n = Number(cursor || 0)
      return page(Array.from({ length: 50 }, (_, i) => `${n}:${i}`), String(n + 1))
    })
    const result = await loadSpeakerCandidateSnapshot(load, new AbortController().signal, () => {})
    expect(load).toHaveBeenCalledTimes(40)
    expect(result.items).toHaveLength(2000)
    expect(result.complete).toBe(false)
  })
  it('ignores a late response after cancellation and propagates page failures', async () => {
    const controller = new AbortController()
    let finish!: (value: ArkmeDirectoryPage) => void
    const progress = vi.fn()
    const result = loadSpeakerCandidateSnapshot(() => new Promise(resolve => { finish = resolve }), controller.signal, progress)
    controller.abort(); finish(page(['late']))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(progress).not.toHaveBeenCalled()
    await expect(loadSpeakerCandidateSnapshot(async () => { throw new Error('offline') }, new AbortController().signal, progress)).rejects.toThrow('offline')
  })
})
