// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { captureRecordingScrollAnchor, restoreRecordingScrollAnchor } from '../src/client/recordings/recording-scroll-anchor.js'

describe('recording reading position', () => {
  it('restores the visible sentence offset after preceding text changes height', () => {
    const pane = document.createElement('div')
    pane.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
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
    pane.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    row.dataset.recordingTranscriptItem = 'sentence-c'; row.dataset.recordingStart = '3000'
    row.getBoundingClientRect = () => ({ top: 150, bottom: 210 } as DOMRect)
    pane.append(row); pane.scrollTop = 500
    restoreRecordingScrollAnchor(pane, { item: 'removed', time: 2000, offset: 10 })
    expect(pane.scrollTop).toBe(540)
  })
})
