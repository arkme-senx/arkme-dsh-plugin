import { useEffect, useRef, useState, isValidElement, type ReactNode } from 'react'

/** Keep nearby directory chunks mounted; measured spacers preserve the scroll range. */
function DirectoryChunk({ children, count, initial, selected }: { children: ReactNode; count: number; initial: boolean; selected: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(initial || typeof IntersectionObserver === 'undefined')
  const [focused, setFocused] = useState(false)
  const height = useRef(count * 54)
  useEffect(() => {
    const target = element.current
    if (target === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry === undefined || target.getClientRects().length === 0) return
      // A hidden retained panel is not a scroll-away event; keep its visible rows mounted.
      if (entry.isIntersecting) setVisible(true)
      else {
        const measured = target.getBoundingClientRect().height
        if (measured > 0) height.current = measured
        setVisible(false)
      }
    }, { root: target.closest('[role="tree"]'), rootMargin: '600px' })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [])
  return <div ref={element} role="none" onFocusCapture={() => { setFocused(true) }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}
    style={visible || selected || focused ? undefined : { height: height.current }} data-arkme-directory-chunk>
    {visible || selected || focused ? children : null}
  </div>
}

export function ArkmeDirectoryWindow({ children, activeKey, revealKey }: { children: ReactNode[]; activeKey?: string | undefined; revealKey?: string | undefined }) {
  const chunks: ReactNode[] = []
  for (let offset = 0; offset < children.length; offset += 20) {
    const items = children.slice(offset, offset + 20)
    chunks.push(<DirectoryChunk key={offset} count={items.length} initial={offset === 0} selected={items.some(item => isValidElement(item) && (item.key === activeKey || item.key === revealKey))}>{items}</DirectoryChunk>)
  }
  return <>{chunks}</>
}
