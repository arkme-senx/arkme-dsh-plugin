export interface RecordingScrollAnchor { item: string; time: number; offset: number }

/** Keep the sentence at the top of the pane stationary when preceding text
 * changes height. A removed sentence falls forward to its recording time. */
export function captureRecordingScrollAnchor(pane: HTMLElement | null): RecordingScrollAnchor | undefined {
  if (pane === null) return undefined
  const top = pane.getBoundingClientRect().top
  const row = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
    .find(element => element.getBoundingClientRect().bottom > top)
  return row === undefined ? undefined : { item: row.dataset.recordingTranscriptItem!, time: Number(row.dataset.recordingStart), offset: row.getBoundingClientRect().top - top }
}

export function restoreRecordingScrollAnchor(pane: HTMLElement | null, anchor: RecordingScrollAnchor | undefined): void {
  if (pane === null || anchor === undefined) return
  const rows = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
  const row = rows.find(element => element.dataset.recordingTranscriptItem === anchor.item)
    ?? rows.find(element => Number(element.dataset.recordingStart) >= anchor.time) ?? rows.at(-1)
  if (row !== undefined) pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset
}
