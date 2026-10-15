/** Preserve the visible sentence while speaker identity changes alter row widths/heights. */
export function captureRecordingScrollAnchor(pane: HTMLDivElement | null, preferredItemId?: string) {
  if (!pane) return undefined
  const bounds = pane.getBoundingClientRect()
  const rows = [...pane.querySelectorAll<HTMLElement>('[data-recording-transcript-item]')]
  const preferred = rows.find(row => row.dataset.recordingTranscriptItem === preferredItemId)
  const visible = (row: HTMLElement) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > bounds.top && rect.top < bounds.bottom
  }
  const row = preferred && visible(preferred) ? preferred : rows.find(visible)
  if (!row) return undefined
  const offset = row.getBoundingClientRect().top - bounds.top
  return {
    pane,
    restore() {
      if (!pane.contains(row)) return
      pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset
    },
  }
}
