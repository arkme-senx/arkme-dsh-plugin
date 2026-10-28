/** Wait only for this message's first reaction result; never move the viewport after cancellation. */
export function afterReactionLayout(row: HTMLElement, locate: () => void): () => void {
  let disposed = false, frame = 0
  let observer: MutationObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    observer?.disconnect(); clearTimeout(timer)
    if (disposed || frame) return
    frame = requestAnimationFrame(() => { if (!disposed) locate() })
  }
  const ready = () => row.querySelector('[data-arkme-reaction-ready="false"]') === null
  // The mounted row already has its final layout. Do not defer its highlight
  // into a cancellable frame when the notification/view updates after the click.
  if (ready()) locate()
  else if (typeof MutationObserver === 'undefined') finish()
  else {
    observer = new MutationObserver(() => { if (ready()) finish() })
    observer.observe(row, { attributes: true, attributeFilter: ['data-arkme-reaction-ready'], childList: true, subtree: true })
    // Failed/offline reads must not trap navigation indefinitely.
    timer = setTimeout(finish, 4000)
  }
  return () => { disposed = true; observer?.disconnect(); clearTimeout(timer); if (frame) cancelAnimationFrame(frame) }
}

/** A message remains a locate target even after its last reaction is removed. */
export function afterMessageVisible(viewport: HTMLElement, row: HTMLElement, highlight: () => void): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const doc = row.ownerDocument ?? document
  const win = doc.defaultView ?? window
  const stop = () => {
    disposed = true
    clearTimeout(timer)
    viewport.removeEventListener('scroll', update)
    doc.removeEventListener('visibilitychange', update)
    win.removeEventListener('focus', update)
    win.removeEventListener('blur', update)
  }
  const update = () => {
    clearTimeout(timer)
    if (disposed || doc.hidden || !doc.hasFocus()) return
    timer = setTimeout(() => {
      if (disposed || doc.hidden || !doc.hasFocus()) return
      const bounds = viewport.getBoundingClientRect(), target = row.getBoundingClientRect()
      if (target.bottom <= bounds.top || target.top >= bounds.bottom) return
      stop()
      highlight()
    }, 180)
  }
  viewport.addEventListener('scroll', update, { passive: true })
  doc.addEventListener('visibilitychange', update)
  win.addEventListener('focus', update)
  win.addEventListener('blur', update)
  update()
  return stop
}
