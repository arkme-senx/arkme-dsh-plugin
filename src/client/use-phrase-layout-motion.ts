import { useLayoutEffect, useRef } from 'react'
export function usePhraseLayoutMotion(layoutKey: string) {
  const grid = useRef<HTMLDivElement>(null)
  const previous = useRef(new Map<string, { left: number; top: number }>())
  useLayoutEffect(() => {
    const container = grid.current
    const origin = container?.getBoundingClientRect()
    const elements = Array.from(container?.querySelectorAll<HTMLElement>('[data-reaction-sort]') ?? [])
    // Panel placement and scrolling are not changes to the phrase order.
    const next = new Map(elements.map(element => {
      const box = element.getBoundingClientRect()
      return [element.dataset.reactionSort!, { left: box.left - (origin?.left ?? 0) + (container?.scrollLeft ?? 0), top: box.top - (origin?.top ?? 0) + (container?.scrollTop ?? 0) }] as const
    }))
    const animations: Animation[] = []
    if (typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const element of elements) {
        const old = previous.current.get(element.dataset.reactionSort!), box = next.get(element.dataset.reactionSort!)!
        if (!old || !element.animate) continue
        const x = old.left - box.left, y = old.top - box.top
        if (Math.abs(x) + Math.abs(y) < 1) continue
        animations.push(element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }))
      }
    }
    previous.current = next
    return () => animations.forEach(animation => animation.cancel())
  }, [layoutKey])
  return grid
}
