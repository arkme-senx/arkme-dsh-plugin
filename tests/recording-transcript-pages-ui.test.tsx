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
