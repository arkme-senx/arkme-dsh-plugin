import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

const CHUNK_SIZE = 40
const MAX_MOUNTED_CHUNKS = 5

/** Variable-height chunks share one observer. Off-screen media/reaction subtrees are unmounted. */
export const WindowedTimelineRows = memo(function WindowedTimelineRows({ children, rowIds, scrollport, anchorId }: {
  children: ReactNode[]; rowIds: readonly { id: string }[]; scrollport: RefObject<HTMLDivElement>; anchorId?: string | undefined
}) {
  const chunks = useMemo(() => Array.from({ length: Math.ceil(children.length / CHUNK_SIZE) }, (_, index) => ({
    id: `${rowIds[index * CHUNK_SIZE]?.id}:${rowIds[Math.min(rowIds.length, (index + 1) * CHUNK_SIZE) - 1]?.id}`,
    rows: children.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  })), [children, rowIds])
  const anchorIndex = anchorId ? rowIds.findIndex(row => row.id === anchorId) : -1
  const target = anchorIndex >= 0 ? Math.floor(anchorIndex / CHUNK_SIZE) : Math.max(0, chunks.length - 1)
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
  const elements = useRef(new Map<string, HTMLLIElement>())
  const heights = useRef(new Map<string, number>())
  useEffect(() => {
    const ids = new Set(chunks.map(chunk => chunk.id))
    for (const key of heights.current.keys()) if (!ids.has(key)) heights.current.delete(key)
    const root = scrollport.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const candidates = new Set<string>()
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Avoid destroying a native text selection while scrolling it.
        if (typeof window.getSelection === 'function' && window.getSelection()?.isCollapsed === false) return
        const middle = root.getBoundingClientRect().top + root.clientHeight / 2
        const ordered = [...candidates].map(id => ({ id, distance: Math.abs((elements.current.get(id)?.getBoundingClientRect().top ?? 0) - middle) }))
          .sort((a, b) => a.distance - b.distance).slice(0, MAX_MOUNTED_CHUNKS).map(value => value.id)
        setVisible(previous => previous.size === ordered.length && ordered.every(id => previous.has(id)) ? previous : new Set(ordered))
      })
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.arkmeTimelineChunk!
        if (entry.isIntersecting) candidates.add(id); else candidates.delete(id)
      }
      update()
    }, { root, rootMargin: '800px 0px' })
    for (const element of elements.current.values()) observer.observe(element)
    document.addEventListener('selectionchange', update)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('selectionchange', update) }
  }, [chunks, scrollport])
  useEffect(() => {
    // A scrollbar jump can land in an estimated block before it is mounted.
    // Capture the real row anchor after layout, even if the user stops scrolling.
    const frame = requestAnimationFrame(() => scrollport.current?.dispatchEvent?.(new Event('scroll')))
    return () => cancelAnimationFrame(frame)
  }, [visible, scrollport])

  // Keep the explicit restore target mounted until the observer catches up.
  const forced = chunks[target]?.id
  return <>{chunks.map(chunk => <TimelineChunk key={chunk.id} id={chunk.id}
    mounted={chunks.length <= 3 || visible.has(chunk.id) || chunk.id === forced}
    estimate={heights.current.get(chunk.id) ?? chunk.rows.length * 100}
    register={element => { if (element) elements.current.set(chunk.id, element); else elements.current.delete(chunk.id) }}
    measured={height => heights.current.set(chunk.id, height)}>
    {chunk.rows}
  </TimelineChunk>)}</>
})

function TimelineChunk({ id, mounted, estimate, register, measured, children }: {
  id: string; mounted: boolean; estimate: number; register(element: HTMLLIElement | null): void
  measured(height: number): void; children: ReactNode[]
}) {
  const element = useRef<HTMLLIElement | null>(null)
  const [height, setHeight] = useState(estimate)
  const measureRef = useRef(measured); measureRef.current = measured
  useLayoutEffect(() => {
    const node = element.current
    if (!mounted || !node) return
    const measure = () => {
      const value = node.getBoundingClientRect().height
      if (value > 0) { setHeight(value); measureRef.current(value) }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [mounted, children])
  return <li ref={node => { element.current = node; register(node) }} data-arkme-timeline-chunk={id}
    aria-hidden={!mounted || undefined} style={{ listStyle: 'none', flex: 'none', ...(mounted ? {} : { height }) }}>
    {mounted && <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>{children}</ul>}
  </li>
}
