import { timelineRowChunks, type TimelineRowChunk } from './timeline-row-chunks.js'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

const CHUNK_SIZE = 40
const MAX_MOUNTED_ROWS = 200

/** Variable-height chunks share one observer. Off-screen media/reaction subtrees are unmounted. */
export const WindowedTimelineRows = memo(function WindowedTimelineRows({ children, rowIds, scrollport, anchorId }: {
  children: ReactNode[]; rowIds: readonly { id: string }[]; scrollport: RefObject<HTMLDivElement>; anchorId?: string | undefined
}) {
  const previousChunks = useRef<TimelineRowChunk[]>([])
  const chunks = useMemo(() => {
    const partition = timelineRowChunks(rowIds, previousChunks.current, CHUNK_SIZE)
    let offset = 0
    return partition.map(chunk => {
      const rows = children.slice(offset, offset + chunk.rowIds.length)
      offset += chunk.rowIds.length
      return { ...chunk, rows }
    })
  }, [children, rowIds])
  useLayoutEffect(() => { previousChunks.current = chunks }, [chunks])
  const chunkIdentity = chunks.map(chunk => chunk.id).join('\0')
  const target = anchorId ? chunks.findIndex(chunk => chunk.rowIds.includes(anchorId)) : -1
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
  const elements = useRef(new Map<string, HTMLLIElement>())
  const heights = useRef(new Map<string, number>())
  useEffect(() => {
    const ids = new Set(chunkIdentity.split('\0'))
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
        const sizes = new Map(previousChunks.current.map(chunk => [chunk.id, chunk.rowIds.length]))
        const nearby = [...candidates].map(id => ({ id, distance: Math.abs((elements.current.get(id)?.getBoundingClientRect().top ?? 0) - middle) }))
          .sort((a, b) => a.distance - b.distance)
        const ordered: string[] = []
        let count = 0
        for (const { id } of nearby) {
          const size = sizes.get(id) ?? CHUNK_SIZE
          if (count + size > MAX_MOUNTED_ROWS) break
          count += size; ordered.push(id)
        }
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
    const ownerDocument = root.ownerDocument
    ownerDocument?.addEventListener('selectionchange', update)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); ownerDocument?.removeEventListener('selectionchange', update) }
  }, [chunkIdentity, scrollport])
  useEffect(() => {
    // A scrollbar jump can land in an estimated block before it is mounted.
    // Capture the real row anchor after layout, even if the user stops scrolling.
    const frame = requestAnimationFrame(() => scrollport.current?.dispatchEvent?.(new Event('scroll')))
    return () => cancelAnimationFrame(frame)
  }, [visible, scrollport])

  // Keep the explicit restore target mounted until the observer catches up.
  const forced = chunks[target >= 0 ? target : chunks.length - 1]?.id
  return <>{chunks.map(chunk => <TimelineChunk key={chunk.id} id={chunk.id}
    mounted={children.length <= 3 * CHUNK_SIZE || visible.has(chunk.id) || chunk.id === forced}
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
  }, [mounted])
  return <li ref={node => { element.current = node; register(node) }} data-arkme-timeline-chunk={id}
    aria-hidden={!mounted || undefined} style={{ listStyle: 'none', flex: 'none', ...(mounted ? {} : { height }) }}>
    {mounted && <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>{children}</ul>}
  </li>
}
