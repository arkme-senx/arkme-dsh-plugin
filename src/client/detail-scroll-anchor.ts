interface DetailAnchor {
  top: number
  bottom: boolean
  element?: HTMLElement
  key?: string
  offset?: number
}

/** One mounted detail owns its viewport. DOM/status refreshes never own focus. */
export function observeDetailScrollAnchor(pane: HTMLElement): () => void {
  if (!pane.style || typeof pane.querySelectorAll !== 'function' || typeof pane.getBoundingClientRect !== 'function'
    || typeof MutationObserver === 'undefined') return () => {}
  const attribute = 'data-arkme-detail-scroll-anchor'
  const previousOverflowAnchor = pane.style.overflowAnchor
  pane.style.overflowAnchor = 'none'
  let frame: number | undefined, active = true
  let appliedTop: number | undefined
  const rows = () => [...pane.querySelectorAll<HTMLElement>(`[${attribute}]`)]
  const capture = (): DetailAnchor => {
    const bounds = pane.getBoundingClientRect()
    const element = rows().find(row => {
      const rect = row.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return { top: pane.scrollTop,
      bottom: pane.scrollHeight > pane.clientHeight + 2 && pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2,
      ...(element ? { element, key: element.getAttribute(attribute)!, offset: element.getBoundingClientRect().top - bounds.top } : {}) }
  }
  let anchor = capture()
  const restore = () => {
    frame = undefined
    if (!active) return
    const element = anchor.element && pane.contains(anchor.element) ? anchor.element
      : anchor.key ? rows().find(row => row.getAttribute(attribute) === anchor.key) : undefined
    const max = Math.max(0, pane.scrollHeight - pane.clientHeight)
    const next = anchor.bottom ? max : element && anchor.offset !== undefined
      ? pane.scrollTop + element.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset : anchor.top
    const target = Math.max(0, Math.min(max, next))
    if (Math.abs(target - pane.scrollTop) > 0.5) {
      pane.scrollTop = target
      appliedTop = pane.scrollTop
    }
    anchor = capture()
  }
  const schedule = () => {
    if (active && frame === undefined) frame = requestAnimationFrame(restore)
  }
  const onScroll = () => {
    if (appliedTop !== undefined && Math.abs(pane.scrollTop - appliedTop) <= 0.5) { appliedTop = undefined; return }
    appliedTop = undefined
    anchor = capture()
  }
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
  const observed = new Set<Element>()
  const observeChildren = () => {
    const current = new Set<Element>([pane, ...pane.children])
    for (const child of observed) if (!current.has(child)) { resize?.unobserve?.(child); observed.delete(child) }
    for (const child of current) if (!observed.has(child)) { resize?.observe(child); observed.add(child) }
  }
  observeChildren()
  const mutations = new MutationObserver(() => { observeChildren(); schedule() })
  mutations.observe(pane, { childList: true, characterData: true, subtree: true })
  pane.addEventListener('scroll', onScroll, { passive: true })
  pane.addEventListener('load', schedule, true)
  return () => {
    active = false
    if (frame !== undefined) cancelAnimationFrame(frame)
    mutations.disconnect(); resize?.disconnect(); observed.clear()
    pane.removeEventListener('scroll', onScroll); pane.removeEventListener('load', schedule, true)
    if (pane.style.overflowAnchor === 'none') pane.style.overflowAnchor = previousOverflowAnchor
  }
}
