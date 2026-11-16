import { useEffect, useLayoutEffect, type RefObject } from 'react'
import { useConversationScrollFrame } from './conversation-scroll-frame.js'
import { arkmeVisibleReadIntentAllowed, subscribeArkmeReadIntentAvailability } from './read-intent-visibility.js'

/** Only committed message rows can advance a read cursor. The list tail can contain other UI. */
export function visibleMessageReadSequence(viewport: HTMLElement, loadedTailSequence = 0): number {
  if (viewport.clientHeight <= 0) return 0
  const bounds = viewport.getBoundingClientRect()
  const top = Math.max(bounds.top + (viewport.clientTop || 0), 0)
  const bottom = Math.min(bounds.top + (viewport.clientTop || 0) + viewport.clientHeight, viewport.ownerDocument?.defaultView?.innerHeight ?? Infinity)
  if (bottom <= top) return 0
  // Offscreen chunks may be unmounted; the caller supplies the confirmed readable window's frontier.
  if (Number.isSafeInteger(loadedTailSequence) && loadedTailSequence > 0 && bottom - top >= viewport.clientHeight - 0.5
    && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 0.5) return loadedTailSequence
  let sequence = 0
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-arkme-read-sequence]')) {
    const candidate = Number(row.dataset.arkmeReadSequence)
    if (!Number.isSafeInteger(candidate) || candidate <= sequence) continue
    const rect = row.getBoundingClientRect()
    if (rect.bottom > rect.top && rect.bottom > top && rect.bottom <= bottom + 0.5) sequence = candidate
  }
  return sequence
}

export function useVisibleMessageRead(
  scope: string | undefined,
  viewport: RefObject<HTMLElement>,
  content: RefObject<HTMLElement>,
  rows: readonly unknown[] | undefined,
  onRead: (sequence: number) => void,
  loadedTailSequence = 0,
): () => void {
  const measure = useConversationScrollFrame(scope ?? '', () => {
    const node = viewport.current
    if (!scope || !node || !arkmeVisibleReadIntentAllowed(node.ownerDocument)) return
    const sequence = visibleMessageReadSequence(node, loadedTailSequence)
    if (sequence > 0) onRead(sequence)
  })
  useLayoutEffect(() => { if (scope && viewport.current) measure() }, [scope, rows, measure, viewport, loadedTailSequence])
  const node = viewport.current
  const list = content.current
  useEffect(() => {
    if (!scope || typeof window === 'undefined' || typeof document === 'undefined') return
    const stop = subscribeArkmeReadIntentAvailability(measure)
    window.addEventListener?.('focus', measure)
    document.addEventListener?.('visibilitychange', measure)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (viewport.current) observer?.observe(viewport.current)
    if (content.current) observer?.observe(content.current)
    return () => {
      stop()
      observer?.disconnect()
      window.removeEventListener?.('focus', measure)
      document.removeEventListener?.('visibilitychange', measure)
    }
  }, [scope, node, list, viewport, content, measure])
  return measure
}
