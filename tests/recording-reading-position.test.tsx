import { useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { firstVisibleRecordingRow, useRecordingReadingPosition } from '../src/client/recordings/useRecordingReadingPosition.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

let renderer: ReactTestRenderer | undefined
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })

it('finds the reading row with bounded layout reads in a dense all-day transcript', () => {
  const read = vi.fn((index: number) => ({ bottom: (index + 1) * 30 }))
  const rows = Array.from({ length: 36000 }, (_, index) => ({ getBoundingClientRect: () => read(index) }))
  expect(firstVisibleRecordingRow(rows as never, 300000)).toBe(10000)
  expect(read.mock.calls.length).toBeLessThan(17)
  expect(firstVisibleRecordingRow([], 0)).toBe(-1)
  expect(firstVisibleRecordingRow(rows as never, 2000000)).toBe(-1)
})

it('updates from scrolling, coalesces frames, and clears reading state across tabs and dates', () => {
  let frame: FrameRequestCallback | undefined
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 })
  const cancel = vi.fn(() => { frame = undefined })
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  let scroll = () => {}, top = 0
  const rows = [0, 1, 2].map(index => ({
    dataset: { recordingTranscriptItem: String(index) },
    getBoundingClientRect: () => ({ top: 100 + index * 100 - top, bottom: 200 + index * 100 - top }),
  }))
  const pane = {
    querySelectorAll: () => rows,
    getBoundingClientRect: () => ({ top: 100, bottom: 300, height: 200 }),
    addEventListener: (_: string, callback: () => void) => { scroll = callback },
    removeEventListener: vi.fn(),
  }
  const items = rows.map((_, index) => ({ itemId: String(index), startAtMillis: index * 1000, endAtMillis: index * 1000 + 900 })) as ArkmeRecordingWorkbenchItem[]
  function Probe({ active = true, dateStamp = 0 }) {
    const ref = useRef(pane as unknown as HTMLDivElement)
    const range = useRecordingReadingPosition(ref, items, active, dateStamp)
    return <span data-start={range?.startAtMillis} />
  }
  const flush = () => act(() => { const callback = frame; frame = undefined; callback?.(0) })
  act(() => { renderer = create(<Probe />) }); flush()
  expect(renderer!.root.findByType('span').props['data-start']).toBe(0)
  top = 110; scroll(); scroll(); flush()
  expect(renderer!.root.findByType('span').props['data-start']).toBe(1000)
  expect(request).toHaveBeenCalledTimes(2)
  act(() => renderer!.update(<Probe dateStamp={86400000} />))
  expect(renderer!.root.findByType('span').props['data-start']).toBeUndefined()
  flush()
  act(() => renderer!.update(<Probe active={false} />))
  expect(renderer!.root.findByType('span').props['data-start']).toBeUndefined()
  expect(pane.removeEventListener).toHaveBeenCalledTimes(2)
})
