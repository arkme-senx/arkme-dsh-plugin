import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ArticleOutlineEntry { key: number; level: number; title: string; element: HTMLElement; offset: number }

/** Observe the actual reader/editor headings, excluding code and ordinary bold text.
 * No polling or network reads. Scroll work is one animation frame and a binary search. */
export function useArticleOutline(body: HTMLElement | null, articleKey: string, positions: Map<string, number>) {
  const [entries, setEntries] = useState<ArticleOutlineEntry[]>([])
  const [active, setActive] = useState<number>()
  const current = useRef<ArticleOutlineEntry[]>([])
  const ids = useRef(new WeakMap<HTMLElement, number>()), sequence = useRef(0)
  useLayoutEffect(() => { if (body) body.scrollTop = positions.get(articleKey) ?? 0 }, [body, articleKey, positions])
  useEffect(() => {
    setEntries([]); setActive(undefined)
    if (!body) return
    let disposed = false, frame = 0, needsMeasure = true
    const updateActive = () => {
      if (body.isConnected) positions.set(articleKey, body.scrollTop)
      const headings = current.current, top = body.scrollTop + 40
      if (body.scrollTop > 0 && body.clientHeight > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
        setActive(headings.at(-1)?.key); return
      }
      let low = 0, high = headings.length
      while (low < high) { const middle = (low + high) >>> 1; if (headings[middle]!.offset <= top) low = middle + 1; else high = middle }
      setActive(headings[Math.max(0, low - 1)]?.key)
    }
    const measure = () => {
      const top = body.getBoundingClientRect().top, scroll = body.scrollTop
      const next = [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].flatMap(element => {
        const title = element.textContent?.trim() ?? ''
        if (!title || element.closest('[hidden],[aria-hidden=true]')) return []
        let key = ids.current.get(element)
        if (key === undefined) { key = ++sequence.current; ids.current.set(element, key) }
        return [{ key, level: Number(element.tagName.slice(1)), title, element, offset: element.getBoundingClientRect().top - top + scroll }]
      })
      current.current = next
      setEntries(previous => previous.length === next.length && previous.every((entry, i) => entry.key === next[i]!.key && entry.title === next[i]!.title && entry.level === next[i]!.level) ? previous : next)
    }
    const schedule = (remeasure: boolean) => {
      needsMeasure ||= remeasure
      if (frame || disposed) return
      frame = requestAnimationFrame(() => { frame = 0; if (disposed) return; if (needsMeasure) { needsMeasure = false; measure() }; updateActive() })
    }
    const changed = () => schedule(true), scrolled = () => schedule(false)
    measure(); updateActive()
    const observer = new MutationObserver(changed)
    observer.observe(body, { childList: true, subtree: true, characterData: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(changed)
    resize?.observe(body)
    for (const child of body.children) if (child instanceof HTMLElement && child.tagName !== 'STYLE') resize?.observe(child)
    body.addEventListener('scroll', scrolled, { passive: true }); body.addEventListener('load', changed, true)
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize?.disconnect()
      body.removeEventListener('scroll', scrolled); body.removeEventListener('load', changed, true)
      if (body.isConnected) positions.set(articleKey, body.scrollTop)
    }
  }, [body, articleKey, positions])
  const navigate = useCallback((entry: ArticleOutlineEntry) => {
    if (!body || !body.contains(entry.element)) return
    const offset = entry.element.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    body.scrollTo({ top: Math.max(0, offset - 20), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setActive(entry.key)
  }, [body])
  return { entries, active, navigate }
}
