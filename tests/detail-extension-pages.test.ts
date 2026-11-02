import { describe, it, expect, vi } from 'vitest'
import { readDetailExtensionPages } from '../src/client/detail-extension-pages.js'
import type { ArkmeMessageCopyLinkExtensionItem, ArkmeSourceMessageExtensionContext } from '../src/types.js'
const child = (index: number): ArkmeMessageCopyLinkExtensionItem => ({ recordUid: `reply-${index}`, recordOwnerUserId: 7, sequence: index + 1,
  parentRecordUid: 'parent', senderDisplayName: '作者', sourceKind: 'record_extension', title: '', textContent: `正文${index}`, sendAtMillis: index,
  templateKind: 1, displayKind: 0, officialMark: 0, level: 2, mediaItems: [] })
const page = (extensions: ArkmeMessageCopyLinkExtensionItem[], nextCursor?: string): ArkmeSourceMessageExtensionContext => ({
  parentRecordUid: 'parent', extensionCount: 125, extensions, ...(nextCursor ? { nextCursor } : {}) })
describe('progressive detail comment pages', () => {
  it('publishes 100 comments before the next read completes, deduplicates overlap, and preserves the last-page quotation', async () => {
    let finish!: (page: ArkmeSourceMessageExtensionContext) => void
    const loadPage = vi.fn(async (cursor?: string) => cursor ? await new Promise<ArkmeSourceMessageExtensionContext>(resolve => { finish = resolve }) : page(Array.from({ length: 100 }, (_, index) => child(index)), 'cursor-a'))
    const onPage = vi.fn(), controller = new AbortController()
    const work = readDetailExtensionPages({ parentRecordUid: 'parent', loadPage, onPage, signal: controller.signal })
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledWith('cursor-a'))
    expect(onPage.mock.calls[0]![0].extensions).toHaveLength(100)
    const quote = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '原文', prefix: '', suffix: '' }
    finish(page([...Array.from({ length: 25 }, (_, index) => child(index + 99)), { ...child(124), quote, quoteState: 'available' }]))
    await work
    const result = onPage.mock.calls.at(-1)![0]
    expect(result.extensions).toHaveLength(125); expect(result.nextCursor).toBeUndefined()
    expect(result.extensions.find((x: ArkmeMessageCopyLinkExtensionItem) => x.recordUid === 'reply-124')?.quote).toEqual(quote)
    expect(result.extensionCount).toBe(125)
  })
  it('retains the last published page on failure and resumes from its cursor without rereading the first page', async () => {
    const first = page([child(0)], 'retry-cursor'), onPage = vi.fn()
    const loadPage = vi.fn(async (cursor?: string) => { if (cursor) throw new Error('network'); return first })
    await expect(readDetailExtensionPages({ parentRecordUid: 'parent', loadPage, onPage, signal: new AbortController().signal })).rejects.toThrow('network')
    expect(onPage).toHaveBeenCalledWith(first)
    const resume = vi.fn(async () => page([child(1)]))
    await readDetailExtensionPages({ parentRecordUid: 'parent', loadPage: resume, onPage, initial: first, signal: new AbortController().signal })
    expect(resume).toHaveBeenCalledExactlyOnceWith('retry-cursor')
    expect(onPage.mock.calls.at(-1)![0].extensions).toHaveLength(2)
  })
  it('rejects another original message and stops repeated cursors', async () => {
    const onPage = vi.fn()
    await expect(readDetailExtensionPages({ parentRecordUid: 'parent', loadPage: async () => ({ ...page([child(0)]), parentRecordUid: 'other' }), onPage, signal: new AbortController().signal })).rejects.toThrow('来源已变化')
    expect(onPage).not.toHaveBeenCalled()
    const loadPage = vi.fn(async () => page([child(0)], 'same'))
    await expect(readDetailExtensionPages({ parentRecordUid: 'parent', loadPage, onPage, signal: new AbortController().signal })).rejects.toThrow('分页未前进')
    expect(loadPage).toHaveBeenCalledTimes(2)
  })
  it('does not publish a page returned after the detail was closed or switched', async () => {
    const controller = new AbortController(), onPage = vi.fn()
    await expect(readDetailExtensionPages({ parentRecordUid: 'parent', loadPage: async () => { controller.abort(); return page([child(0)], 'next') }, onPage, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(onPage).not.toHaveBeenCalled()
  })
  it('keeps different owners separate and allows a later page to redact a previously available quote', async () => {
    const onPage = vi.fn(), first = page([child(0)], 'next')
    await readDetailExtensionPages({ parentRecordUid: 'parent', initial: first, loadPage: async () => page([{ ...child(0), recordOwnerUserId: 8 }, { ...child(0), textContent: '', quoteState: 'unavailable' }]), onPage, signal: new AbortController().signal })
    const result = onPage.mock.calls[0]![0]
    expect(result.extensions).toHaveLength(2)
    expect(result.extensions.find((x: ArkmeMessageCopyLinkExtensionItem) => x.recordOwnerUserId === 7)?.quoteState).toBe('unavailable')
  })
})
