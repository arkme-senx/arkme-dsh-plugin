// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecordingTranscriptContext } from '../src/client/recordings/useRecordingTranscriptContext.js'
import type { ArkmeRecordingTranscriptContext, ArkmeRecordingTranscriptLocation, ArkmeRecordingWorkbenchItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
import { ArkmeClientError } from '../src/client/api.js'

const day = new Date(2026, 10, 16).getTime()
const at = day + 3_600_000
const row = (itemId: string, startAtMillis: number) => ({ itemId, startAtMillis, sessionKey: 'opaque' }) as ArkmeRecordingWorkbenchItem
const focus = row('focus', at)
const seed: ArkmeRecordingTranscriptLocation = { focusItemId: 'focus', items: [focus], revisions: { opaque: 'revision' } }
let container: HTMLDivElement, root: Root
let state: ReturnType<typeof useRecordingTranscriptContext>
const beforePublish = vi.fn()
function View({ location = seed, date = day }: { location?: ArkmeRecordingTranscriptLocation; date?: number }) {
  state = useRecordingTranscriptContext(location, date, beforePublish)
  return <ol>{state.items?.map(item => <li key={item.itemId}>{item.itemId}</li>)}</ol>
}
const page = (items: ArkmeRecordingWorkbenchItem[], revision = 'revision'): ArkmeRecordingTranscriptContext => ({ items, revisions: { opaque: revision } })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.call.mockReset(); beforePublish.mockReset()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('located transcript context', () => {
  it('loads both sides independently, deduplicates the seed, and continues at the completed edge', async () => {
    const earlier = Promise.withResolvers<ArkmeRecordingTranscriptContext>()
    const later = Promise.withResolvers<ArkmeRecordingTranscriptContext>()
    mocks.call.mockImplementation((_op, params) => params.endAtMillis === at + 1 ? earlier.promise : later.promise)
    await act(async () => root.render(<View />))
    expect(state.before).toBe('loading'); expect(state.after).toBe('loading')
    expect(container.textContent).toBe('focus')
    await act(async () => later.resolve(page([focus, row('later', at + 500)])))
    expect(container.textContent).toBe('focuslater')
    await act(async () => earlier.resolve(page([row('earlier', at - 500), focus])))
    expect(container.textContent).toBe('earlierfocuslater')
    expect(beforePublish).toHaveBeenCalledTimes(2)
    mocks.call.mockResolvedValue(page([row('next earlier', at - 80_000)]))
    await act(async () => state.load('before'))
    expect(mocks.call.mock.lastCall?.[1]).toEqual({ dateStamp: day, startAtMillis: at - 119_999, endAtMillis: at - 59_999 })
    expect(container.textContent).toBe('next earlierearlierfocuslater')
  })

  it('keeps a newer snapshot out of the visible list and reports an independent failure for retry', async () => {
    mocks.call.mockImplementation((_op, params) => params.endAtMillis === at + 1
      ? Promise.resolve(page([row('changed', at - 1)], 'new-revision')) : Promise.reject(new Error('timeout')))
    await act(async () => root.render(<View />))
    expect(state.before).toBe('changed'); expect(state.after).toBe('error')
    expect(container.textContent).toBe('focus')
    await act(async () => state.load('after'))
    expect(mocks.call).toHaveBeenCalledTimes(2)
    mocks.call.mockResolvedValue(page([row('retry', at + 1)]))
    await act(async () => state.load('after', true))
    expect(container.textContent).toBe('focusretry')
  })

  it('keeps the boundary when reducing a dense window and cancels old requests on date change', async () => {
    const hold = Promise.withResolvers<ArkmeRecordingTranscriptContext>()
    mocks.call.mockImplementationOnce(async () => {
      throw new ArkmeClientError({ code: 'recording-location-range-too-dense', message: 'dense', retryable: true })
    }).mockImplementation(() => hold.promise)
    await act(async () => root.render(<View />))
    const earlier = mocks.call.mock.calls.filter(([, params]) => params.endAtMillis === at + 1)
    expect(earlier.map(([, params]) => params.startAtMillis)).toEqual([at + 1 - 60_000, at + 1 - 20_000])
    const signals = mocks.call.mock.calls.map(([, , signal]) => signal)
    const other = row('new day', at + 86_400_000)
    await act(async () => root.render(<View date={day + 86_400_000} location={{ focusItemId: other.itemId, items: [other] }} />))
    expect(signals.slice(1).every(signal => signal.aborted)).toBe(true)
    await act(async () => hold.resolve(page([row('old arrival', at + 500)])))
    expect(container.textContent).toBe('new day')
  })
})
