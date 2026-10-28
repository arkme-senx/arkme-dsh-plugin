import { useEffect, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
const calls = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: calls.read }))
import { useRecordingTranscriptPages } from '../src/client/recordings/useRecordingTranscriptPages.js'

function page(text: string, cursor = '', viewRef = 'view'): ArkmeRecordingTranscriptPage {
  return { viewRef, nextCursor: cursor, dateStamp: 0, transcriptSource: 'system', state: 'ready', message: '', totalDurationMillis: 1000, processingCount: 0,
    items: [{ itemId: text, itemRef: `ref-${text}`, sessionKey: 'session', transcriptSource: 'system', startAtMillis: text.charCodeAt(0), endAtMillis: 1000,
      speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我', canBindSpeaker: true, isSelf: true, isBackground: false,
      text, textStartOffset: 0, textEndOffset: text.length, textTotalLength: text.length }],
  }
}
type Pager = ReturnType<typeof useRecordingTranscriptPages>
let pager: Pager, current: ArkmeRecordingTranscriptPage, renderer: ReactTestRenderer
function Harness({ first, scope }: { first: ArkmeRecordingTranscriptPage; scope: string }) {
  const [value, setValue] = useState(first)
  useEffect(() => { setValue(first) }, [first])
  const result = useRecordingTranscriptPages(value, scope, setValue)
  useEffect(() => { pager = result; current = value })
  return null
}
afterEach(async () => { await act(async () => { renderer?.unmount() }); calls.read.mockReset() })

describe('workbench page lifetime', () => {
  it('recovers an expired cursor and completes an export using only the new revision', async () => {
    calls.read.mockRejectedValueOnce({ body: { code: 'recording-view-changed', message: 'changed' } })
      .mockResolvedValueOnce(page('a', 'new-one', 'new'))
      .mockResolvedValueOnce(page('b', 'new-two', 'new'))
      .mockResolvedValueOnce(page('c', '', 'new'))
    await act(async () => { renderer = create(<Harness first={page('a', 'old-one')} scope="42" />) })
    await act(async () => { await pager.through() })
    expect(current.items.map(item => item.text)).toEqual(['a','b','c'])
    expect(current.viewRef).toBe('new')
    expect(current.nextCursor).toBe('')
    expect(pager.error).toBe('')
    expect(calls.read.mock.calls.map(call => call[1].cursor)).toEqual(['old-one', undefined, 'new-one', 'new-two'])
  })

  it('keeps the loaded prefix visible until a background revision has caught up', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    calls.read.mockResolvedValueOnce(page('b', 'old-two')).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page('c', '', 'new'))
    await act(async () => { renderer = create(<Harness first={page('a', 'old-one')} scope="42" />) })
    await act(async () => { await pager.next() })
    let refreshed!: Promise<unknown>
    await act(async () => { refreshed = pager.refresh(page('a', 'new-one', 'new')) })
    expect(current.items.map(item => item.text)).toEqual(['a','b'])
    expect(current.viewRef).toBe('view')
    await act(async () => { pending.resolve(page('b', 'new-two', 'new')); await refreshed })
    expect(current.items.map(item => item.text)).toEqual(['a','b','c'])
    expect(current.viewRef).toBe('new')
  })

  it('discards recovery after the account changes, even when the first page arrives late', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    calls.read.mockRejectedValueOnce({ body: { code: 'recording-view-changed' } }).mockReturnValueOnce(pending.promise)
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    let read!: Promise<unknown>
    await act(async () => { read = pager.next().catch(error => error) })
    const signal = calls.read.mock.calls[1]![2] as AbortSignal
    await act(async () => { renderer.update(<Harness first={page('z')} scope="43" />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(page('b', '', 'new')); await read })
    expect(current.items.map(item => item.text)).toEqual(['z'])
    expect(calls.read).toHaveBeenCalledTimes(2)
  })

  it.each(['recording-speaker-conflict','recording-owner-response-invalid','account-required'])('does not treat %s as an expired page', async code => {
    calls.read.mockRejectedValueOnce({ body: { code } })
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    await act(async () => { await pager.next().catch(() => undefined) })
    expect(calls.read).toHaveBeenCalledTimes(1)
    expect(current.items.map(item => item.text)).toEqual(['a'])
  })

  it('shares a continuation between scrolling and full reads, preserving the prefix after a failed page', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    calls.read.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(page('c'))
    await act(async () => { renderer = create(<Harness first={page('a', 'one')} scope="42" />) })
    let scroll!: Promise<unknown>, full!: Promise<unknown>
    await act(async () => { scroll = pager.next(); full = pager.through().catch(error => error); await Promise.resolve() })
    expect(calls.read).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(page('b', 'two')); await scroll; await full })
    expect(calls.read).toHaveBeenCalledTimes(2)
    expect(current.items.map(item => item.text)).toEqual(['a','b'])
    expect(pager.error).toBe('网络暂不可用')
    expect(current.nextCursor).toBe('two')
    await act(async () => { await pager.through() })
    expect(current.items.map(item => item.text)).toEqual(['a','b','c'])
    expect(current.nextCursor).toBe('')
    expect(calls.read.mock.calls.at(-1)?.[1]).toMatchObject({ cursor: 'two' })
  })

  it.each(['account','revision','unmount'] as const)('aborts a pending continuation after %s changes and discards late bytes', async change => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    calls.read.mockReturnValue(pending.promise)
    const first = page('a', 'one')
    await act(async () => { renderer = create(<Harness first={first} scope="42" />) })
    let request!: Promise<unknown>
    await act(async () => { request = pager.next().catch(error => error) })
    const signal = calls.read.mock.calls[0]![2] as AbortSignal
    await act(async () => {
      if (change === 'unmount') renderer.unmount()
      else renderer.update(<Harness first={page('z', '', change === 'revision' ? 'new-view' : 'view')} scope={change === 'account' ? '43' : '42'} />)
    })
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(page('b')); await request })
    if (change !== 'unmount') expect(current.items.map(item => item.text)).toEqual(['z'])
    expect(calls.read).toHaveBeenCalledTimes(1)
  })

  it('aborts an owned full read on caller cancellation and discards its late page', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>(), controller = new AbortController()
    calls.read.mockReturnValue(pending.promise)
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    let full!: Promise<unknown>
    await act(async () => { full = pager.through(undefined, controller.signal).catch(error => error) })
    const signal = calls.read.mock.calls[0]![2] as AbortSignal
    controller.abort()
    await act(async () => { pending.resolve(page('b', 'two')); await full })
    expect(signal.aborted).toBe(true)
    expect(calls.read).toHaveBeenCalledTimes(1)
    expect(current.items.map(item => item.text)).toEqual(['a'])
    expect(pager.error).toBe('')
  })

  it('a cancelled full read does not cancel a coalesced scrolling request', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>(), controller = new AbortController()
    calls.read.mockReturnValue(pending.promise)
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    let scroll!: Promise<unknown>, full!: Promise<unknown>
    await act(async () => {
      scroll = pager.next()
      full = pager.through(undefined, controller.signal).catch(error => error)
    })
    const signal = calls.read.mock.calls[0]![2] as AbortSignal
    controller.abort()
    await act(async () => { pending.resolve(page('b', 'two')); await scroll; await full })
    expect(signal.aborted).toBe(false)
    expect(calls.read).toHaveBeenCalledTimes(1)
    expect(current.items.map(item => item.text)).toEqual(['a','b'])
    expect(pager.error).toBe('')
  })

  it('cancels an owned full read during recovery without making a new request', async () => {
    vi.useFakeTimers()
    try {
      calls.read.mockRejectedValue({ body: { code: 'recording-view-changed' } })
      const controller = new AbortController()
      await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
      let full!: Promise<unknown>
      await act(async () => { full = pager.through(undefined, controller.signal).catch(error => error) })
      await act(async () => { await vi.advanceTimersByTimeAsync(100); controller.abort() })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); await full })
      expect(calls.read).toHaveBeenCalledTimes(2)
      expect(current.items.map(item => item.text)).toEqual(['a'])
      expect(pager.error).toBe('')
      expect(pager.loading).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each(['next', 'refresh'] as const)('bounds persistent %s conflicts while preserving validated text', async action => {
    vi.useFakeTimers()
    let request: Promise<unknown> | undefined, settled = false
    try {
      calls.read.mockRejectedValue({ body: { code: 'recording-view-changed' } })
      await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
      await act(async () => {
        request = (action === 'next' ? pager.next() : pager.refresh(page('a', 'new-one', 'new')))
          .catch(error => error).finally(() => { settled = true })
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(settled).toBe(true)
      expect(calls.read).toHaveBeenCalledTimes(3)
      expect(pager.loading).toBe(false)
      expect(pager.error).toContain('持续更新')
      expect(current.items.map(item => item.text)).toEqual(['a'])
      expect(current.viewRef).toBe('view')
    } finally {
      await act(async () => { renderer?.unmount(); await request })
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('shares a full read recovery budget across successive changing continuations', async () => {
    let freshReads = 0
    calls.read.mockImplementation(async (_method, input) => {
      if (input.cursor) throw { body: { code: 'recording-view-changed' } }
      freshReads++
      // End the old implementation too, so a red test cannot hang the suite.
      if (freshReads > 5) throw new Error('test recovery safety bound')
      const text = 'abcdef'.slice(0, freshReads + 1)
      const first = page('a', `cursor-${freshReads}`, `view-${freshReads}`)
      return { ...first, items: Array.from(text, value => page(value).items[0]) }
    })
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    const nextCommand = vi.fn()
    let result: unknown
    await act(async () => { result = await pager.through().then(nextCommand).catch(error => error) })
    expect(result).toBeInstanceOf(Error)
    expect(String(result)).toContain('持续更新')
    expect(nextCommand).not.toHaveBeenCalled()
    expect(freshReads).toBe(2)
    expect(calls.read).toHaveBeenCalledTimes(5)
    expect(current.items.map(item => item.text)).toEqual(['a','b','c'])
    expect(current.nextCursor).not.toBe('')
  })

  it('cancels a recovery delay without another request or a visible error', async () => {
    vi.useFakeTimers()
    try {
      calls.read.mockRejectedValue({ body: { code: 'recording-view-changed' } })
      const controller = new AbortController()
      await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
      let request!: Promise<unknown>
      await act(async () => { request = pager.refresh(page('a','two','new'), controller.signal).catch(error => error) })
      await act(async () => { controller.abort(); await request })
      expect(calls.read).toHaveBeenCalledTimes(1)
      expect(pager.error).toBe('')
      expect(pager.loading).toBe(false)
      expect(current.items.map(item => item.text)).toEqual(['a'])
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('counts recoveries performed by a coalesced scroll in the full read budget', async () => {
    vi.useFakeTimers()
    try {
      const changed = { body: { code: 'recording-view-changed' } }
      calls.read.mockRejectedValueOnce(changed).mockRejectedValueOnce(changed)
        .mockResolvedValueOnce({ ...page('a', 'new-two', 'new'), items: [page('a').items[0], page('b').items[0]] })
        .mockRejectedValue(changed)
      await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
      const nextCommand = vi.fn()
      let scroll!: Promise<unknown>, full!: Promise<unknown>
      await act(async () => {
        scroll = pager.next().catch(error => error)
        full = pager.through().then(nextCommand).catch(error => error)
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); await scroll; await full })
      expect(calls.read).toHaveBeenCalledTimes(4)
      expect(nextCommand).not.toHaveBeenCalled()
      expect(current.items.map(item => item.text)).toEqual(['a', 'b'])
    } finally { vi.useRealTimers() }
  })

  it('succeeds after two transient conflicts without mixing revisions', async () => {
    calls.read.mockRejectedValueOnce({ body: { code: 'recording-view-changed' } })
      .mockRejectedValueOnce({ body: { code: 'recording-view-changed' } })
      .mockResolvedValueOnce(page('a', 'new-one', 'new'))
      .mockResolvedValueOnce(page('b', '', 'new'))
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    await act(async () => { await pager.through() })
    expect(calls.read).toHaveBeenCalledTimes(4)
    expect(current.items.map(item => item.text)).toEqual(['a', 'b'])
    expect(current.viewRef).toBe('new')
    expect(current.nextCursor).toBe('')
    expect(pager.error).toBe('')
  })
})
