import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.read, ArkmeClientError: class extends Error {} }))
import { loadRelatedQuickNotes, relatedQuickNotesState } from '../src/client/related-quick-notes-query.js'
import type { ArkmeRelatedQuickNoteList } from '../src/types.js'
const empty: ArkmeRelatedQuickNoteList = { items: [], total: 0, recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
const degraded: ArkmeRelatedQuickNoteList = { ...empty, recallMode: 'search_fallback', retryable: true }

describe('related query recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.read.mockReset() })
  afterEach(() => vi.useRealTimers())
  it('distinguishes definitive empty from degraded empty', () => {
    expect(relatedQuickNotesState(empty).kind).toBe('empty')
    expect(relatedQuickNotesState(degraded)).toMatchObject({ kind: 'error', retryable: true })
  })
  it('recovers once and then stops', async () => {
    mocks.read.mockResolvedValue(degraded)
    const pending = loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toEqual(degraded)
    expect(mocks.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30000)
    expect(mocks.read).toHaveBeenCalledTimes(2)
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
    expect(relatedQuickNotesState(await loadRelatedQuickNotes('source.related-quick-notes.from-message', {}, new AbortController().signal)).kind).toBe('success')
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
})
