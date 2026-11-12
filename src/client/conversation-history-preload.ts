import { MAX_ACTIVE_TIMELINE_TOKENS } from './unified-timeline-window.js'

export class ConversationHistoryPreload {
  private readonly requested = new Set<string>()
  private lastHeight: number | undefined
  private noGrowth = 0

  leaveThreshold(): void {
    this.requested.clear()
    this.lastHeight = undefined
    this.noGrowth = 0
  }

  shouldRequest(cursor: string, scrollHeight: number): boolean {
    if (this.requested.has(cursor) || this.requested.size >= MAX_ACTIVE_TIMELINE_TOKENS) return false
    // Filtered or overlapping pages may advance the cursor without extending the view.
    const noGrowth = this.lastHeight === undefined || scrollHeight > this.lastHeight ? 0 : this.noGrowth + 1
    if (noGrowth >= 2) return false
    this.noGrowth = noGrowth
    this.lastHeight = scrollHeight
    this.requested.add(cursor)
    return true
  }
}

export function observeConversationHistory(root: HTMLElement, sentinel: HTMLElement, onIntersection: (near: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  let observer: IntersectionObserver | undefined
  let currentHeight = 0
  let disposed = false
  const observe = () => {
    if (disposed || root.clientHeight === currentHeight) return
    currentHeight = root.clientHeight
    observer?.disconnect()
    observer = undefined
    if (currentHeight <= 0) return
    const next = new IntersectionObserver(([entry]) => {
      if (!disposed && observer === next) onIntersection(entry?.isIntersecting === true)
    }, { root, rootMargin: `${currentHeight * 2}px 0px 0px` })
    observer = next
    next.observe(sentinel)
  }
  observe()
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(observe)
  resize?.observe(root)
  return () => { disposed = true; observer?.disconnect(); resize?.disconnect() }
}
