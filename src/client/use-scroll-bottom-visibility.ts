import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

/** Viewport affordance only; unrelated to auto-follow tolerance or unread state. */
export function useScrollBottomVisibility(
  viewport: RefObject<HTMLElement>,
  content: RefObject<HTMLElement>,
  active: boolean,
  contentRevision: unknown,
) {
  const [visible, setVisible] = useState(false)
  const measure = useCallback(() => {
    const body = viewport.current
    setVisible(active && body !== null && body.clientHeight > 0
      && body.scrollHeight - body.clientHeight - body.scrollTop > 100)
  }, [active, viewport])

  // Parent layout restoration may change scrollTop without changing the rows.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    if (!active || viewport.current === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport.current)
    if (content.current !== null) observer.observe(content.current)
    return () => { observer.disconnect() }
  }, [active, content, contentRevision, measure, viewport])

  return { visible: active && visible, measure }
}
