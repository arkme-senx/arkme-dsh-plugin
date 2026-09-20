/** Reading position belongs to rendered records, not total list height or API cursors. */
export function memberRecordsViewport(body: HTMLDivElement) {
  const bounds = body.getBoundingClientRect()
  const anchors = [...body.querySelectorAll<HTMLElement>('[data-arkme-member-record-id]')]
    .flatMap(row => {
      const rect = row.getBoundingClientRect()
      const id = row.dataset.arkmeMemberRecordId
      return id !== undefined && rect.bottom > bounds.top && rect.top < bounds.bottom
        ? [{ id, offset: rect.top - bounds.top }] : []
    })
  return { scrollTop: body.scrollTop, anchors }
}

export function restoreMemberRecordsViewport(body: HTMLDivElement, snapshot: ReturnType<typeof memberRecordsViewport>): void {
  const rows = new Map([...body.querySelectorAll<HTMLElement>('[data-arkme-member-record-id]')]
    .map(row => [row.dataset.arkmeMemberRecordId, row]))
  for (const anchor of snapshot.anchors) {
    const row = rows.get(anchor.id)
    if (row === undefined) continue
    body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - anchor.offset
    return
  }
  body.scrollTop = snapshot.scrollTop
}
