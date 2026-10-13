import { useEffect, useState, type RefObject } from 'react'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'

export interface RecordingReadingRange { startAtMillis: number; endAtMillis: number }

/** Read only a logarithmic number of row bounds, even for an all-day transcript. */
export function firstVisibleRecordingRow(rows: readonly Pick<HTMLElement, 'getBoundingClientRect'>[], top: number): number {
  let low = 0, high = rows.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (rows[mid]!.getBoundingClientRect().bottom <= top) low = mid + 1
    else high = mid
  }
  return low < rows.length ? low : -1
}

export function useRecordingReadingPosition(root: RefObject<HTMLDivElement>, items: readonly ArkmeRecordingWorkbenchItem[], active: boolean, dateStamp: number) {
  const [position, setPosition] = useState<{ dateStamp: number; range: RecordingReadingRange }>()
  useEffect(() => {
    const pane = root.current
    if (!active || !pane || items.length === 0) { setPosition(undefined); return }
    const rows = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
    const byId = new Map(items.map(item => [item.itemId, item]))
    let frame: number | undefined
    const measure = () => {
      frame = undefined
      const bounds = pane.getBoundingClientRect()
      if (bounds.height <= 0) return
      const index = firstVisibleRecordingRow(rows, bounds.top + 8)
      const row = rows[index]
      const item = row && row.getBoundingClientRect().top < bounds.bottom ? byId.get(row.dataset.recordingTranscriptItem ?? '') : undefined
      if (!item) return
      setPosition(previous => previous?.dateStamp === dateStamp && previous.range.startAtMillis === item.startAtMillis && previous.range.endAtMillis === item.endAtMillis
        ? previous : { dateStamp, range: { startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis } })
    }
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure) }
    pane.addEventListener('scroll', schedule, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    resize?.observe(pane)
    schedule()
    return () => { pane.removeEventListener('scroll', schedule); resize?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [root, items, active, dateStamp])
  return active && position?.dateStamp === dateStamp ? position.range : undefined
}
