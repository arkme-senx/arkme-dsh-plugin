import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.read, ArkmeClientError: class extends Error {} }))
import { loadRelatedQuickNotes } from '../src/client/related-quick-notes-query.js'
import type { ArkmeRelatedQuickNoteList } from '../src/types.js'
const empty: ArkmeRelatedQuickNoteList = { items: [], total: 0, recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
const degraded: ArkmeRelatedQuickNoteList = { ...empty, recallMode: 'search_fallback', retryable: true }

describe('related query recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.read.mockReset() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('recovers once and then stops', async () => {
    mocks.read.mockResolvedValue(degraded)
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toEqual(degraded)
    expect(mocks.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30000)
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it('keeps the completed fallback response when optional recovery has a network failure', async () => {
    mocks.read.mockResolvedValueOnce(degraded).mockRejectedValueOnce(new TypeError('network unavailable'))
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    const checked = expect(pending).resolves.toBe(degraded)
    await vi.advanceTimersByTimeAsync(2000)
    await checked
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it('does not mask a permanent error from optional recovery', async () => {
    const error = new Error('permission denied')
    mocks.read.mockResolvedValueOnce(degraded).mockRejectedValueOnce(error)
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    const checked = expect(pending).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(2000)
    await checked
  })
  it('keeps the completed fallback response when optional recovery reaches the deadline', async () => {
    mocks.read.mockResolvedValueOnce(degraded).mockImplementationOnce((_operation, _params, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    const checked = expect(pending).resolves.toBe(degraded)
    await vi.advanceTimersByTimeAsync(5000)
    await checked
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it('stops recovery when the page hides after a transport failure', async () => {
    const page = { visibilityState: 'visible' }
    vi.stubGlobal('document', page)
    const error = new TypeError('network unavailable')
    mocks.read.mockRejectedValue(error)
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    const checked = expect(pending).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(1)
    page.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(2000)
    await checked
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('never retries a successful empty result', async () => {
    mocks.read.mockResolvedValue(empty)
    expect(await loadRelatedQuickNotes('source.related-quick-notes.from-moment', {}, new AbortController().signal)).toEqual(empty)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('cancels the pending retry on leaving the source', async () => {
    mocks.read.mockResolvedValue(degraded)
    const cancellation = new AbortController()
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, cancellation.signal)
    const rejected = expect(pending).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(1)
    cancellation.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(30000)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('keeps useful fallback results without an automatic extra query', async () => {
    const list = { ...degraded, items: [{ relatedRef: 'safe', senderName: 'me', sendAtMillis: 1, title: '', textPreview: 'related' }], total: 1 }
    mocks.read.mockResolvedValue(list)
    expect(await loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)).toBe(list)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('does not recover if the page becomes hidden during the delay', async () => {
    const page = { visibilityState: 'visible' }
    vi.stubGlobal('document', page)
    mocks.read.mockResolvedValue(degraded)
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    const checked = expect(pending).resolves.toBe(degraded)
    await vi.advanceTimersByTimeAsync(1)
    page.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(2000)
    await checked
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('does not start recovery when the server cooldown exceeds the remaining lifetime', async () => {
    const response = { ...degraded, retryAfterMillis: 30_000 }
    mocks.read.mockResolvedValue(response)
    expect(await loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)).toEqual(response)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it.each(['source.related-quick-notes.from-message', 'source.related-quick-notes.from-moment'] as const)('preserves a healthy six-second initial read: %s', async operation => {
    const list = { ...empty, items: [{ relatedRef: 'safe', senderName: 'me', sendAtMillis: 1, title: '', textPreview: 'related' }], total: 1 }
    mocks.read.mockImplementation((_operation, _params, signal: AbortSignal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(list), 6000)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    }))
    const pending = loadRelatedQuickNotes(operation, {}, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.read.mock.calls[0][2].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual(list)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('still cancels a slow initial read when leaving the view', async () => {
    mocks.read.mockImplementation((_operation, _params, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const controller = new AbortController()
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, controller.signal)
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(6000)
    controller.abort()
    await checked
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
})
