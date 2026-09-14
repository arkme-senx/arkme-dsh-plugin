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

  it('does not continue a full read after its caller cancels, while retaining useful fetched text', async () => {
    const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>(), controller = new AbortController()
    calls.read.mockReturnValue(pending.promise)
    await act(async () => { renderer = create(<Harness first={page('a','one')} scope="42" />) })
    let full!: Promise<unknown>
    await act(async () => { full = pager.through(undefined, controller.signal).catch(error => error) })
    controller.abort()
    await act(async () => { pending.resolve(page('b', 'two')); await full })
    expect(calls.read).toHaveBeenCalledTimes(1)
    expect(current.items.map(item => item.text)).toEqual(['a','b'])
  })
})
