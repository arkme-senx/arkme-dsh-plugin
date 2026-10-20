export interface RecordingScrollAnchor { item: string; time: number; offset: number; pane: HTMLElement; restore(): void }

export function captureRecordingScrollAnchor(pane: HTMLElement | null, preferredItemId?: string): RecordingScrollAnchor | undefined {
  if (pane === null) return undefined
  const bounds = pane.getBoundingClientRect()
  const rows = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
  const visible = (row: HTMLElement) => row.getBoundingClientRect().bottom > bounds.top && row.getBoundingClientRect().top < bounds.bottom
  const preferred = rows.find(row => row.dataset.recordingTranscriptItem === preferredItemId)
  const row = preferred && visible(preferred) ? preferred : rows.find(visible)
  if (row === undefined) return undefined
  const anchor: RecordingScrollAnchor = { item: row.dataset.recordingTranscriptItem!, time: Number(row.dataset.recordingStart), offset: row.getBoundingClientRect().top - bounds.top, pane, restore: () => { restoreRecordingScrollAnchor(pane, anchor) } }
  return anchor
}

/** Stable identity first; a replaced page falls forward to the source time. */
export function restoreRecordingScrollAnchor(pane: HTMLElement | null, anchor: RecordingScrollAnchor | undefined): void {
  if (pane === null || anchor === undefined) return
  const rows = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
  const row = rows.find(element => element.dataset.recordingTranscriptItem === anchor.item)
    ?? rows.find(element => Number(element.dataset.recordingStart) >= anchor.time) ?? rows.at(-1)
  if (row !== undefined) pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset
}
