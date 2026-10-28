// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { captureRecordingScrollAnchor, restoreRecordingScrollAnchor } from '../src/client/recordings/recording-scroll-anchor.js'

describe('recording reading position', () => {
  it('restores the visible sentence offset after preceding text changes height', () => {
    const pane = document.createElement('div')
    pane.getBoundingClientRect = () => ({ top: 100, bottom: 900 } as DOMRect)
    const row = document.createElement('li')
    row.dataset.recordingTranscriptItem = 'sentence-b'; row.dataset.recordingStart = '2000'
    let top = 80
    row.getBoundingClientRect = () => ({ top, bottom: top + 60 } as DOMRect)
    pane.append(row); pane.scrollTop = 500
    const anchor = captureRecordingScrollAnchor(pane)
    top = 230
    restoreRecordingScrollAnchor(pane, anchor)
    expect(pane.scrollTop).toBe(650)
  })
  it('falls to the next recording time when the visible sentence was removed', () => {
    const pane = document.createElement('div'), row = document.createElement('li')
    pane.getBoundingClientRect = () => ({ top: 100, bottom: 900 } as DOMRect)
    row.dataset.recordingTranscriptItem = 'sentence-c'; row.dataset.recordingStart = '3000'
    row.getBoundingClientRect = () => ({ top: 150, bottom: 210 } as DOMRect)
    pane.append(row); pane.scrollTop = 500
    restoreRecordingScrollAnchor(pane, { item: 'removed', time: 2000, offset: 10 })
    expect(pane.scrollTop).toBe(540)
  })
})

function fixture() {
  let shift = 0, attached = true
  const pane = { scrollTop: 50000, getBoundingClientRect: () => ({ top: 100, bottom: 900 }),
    querySelectorAll: () => rows, contains: () => attached }
  const rows = [0, 1, 2].map(index => ({ dataset: { recordingTranscriptItem: `${index}` },
    getBoundingClientRect: () => ({ top: 100 + index * 150 + shift - (pane.scrollTop - 50000), bottom: 250 + index * 150 + shift - (pane.scrollTop - 50000) }) }))
  return { pane: pane as unknown as HTMLDivElement, rows, shift: (value: number) => { shift = value }, detach: () => { attached = false } }
}

it('keeps the edited sentence at the same viewport offset when preceding rows shrink or grow', () => {
  const state = fixture()
  const anchor = captureRecordingScrollAnchor(state.pane, '2')!
  const before = state.rows[2]!.getBoundingClientRect().top
  state.shift(-187); anchor.restore()
  expect(state.pane.scrollTop).toBe(49813)
  expect(state.rows[2]!.getBoundingClientRect().top).toBe(before)
  state.shift(42); anchor.restore()
  expect(state.rows[2]!.getBoundingClientRect().top).toBe(before)
})

it('preserves a visible row if the preferred fragment is not on screen and ignores detached rows', () => {
  const state = fixture()
  const anchor = captureRecordingScrollAnchor(state.pane, 'not-visible')!
  state.shift(65); anchor.restore()
  expect(state.pane.scrollTop).toBe(50065)
  state.detach(); state.shift(200); anchor.restore()
  expect(state.pane.scrollTop).toBe(50065)
  expect(captureRecordingScrollAnchor(null)).toBeUndefined()
})
