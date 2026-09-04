import { useLayoutEffect, type RefObject } from 'react'

interface ViewportMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }

export function resizedConversationScrollTop(before: ViewportMetrics, after: ViewportMetrics): number {
  const maximum = Math.max(0, after.scrollHeight - after.clientHeight)
  // Match the conversation's existing 80px near-bottom policy.
  return before.scrollHeight - before.scrollTop - before.clientHeight <= 80
    ? maximum
    : Math.max(0, Math.min(before.scrollTop, maximum))
}

/** Keep the latest message above a growing composer without hijacking history reading. */
export function observeConversationResize(body: HTMLElement): () => void {
  const read = (): ViewportMetrics => ({ scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight })
  let before = read()
  const onScroll = () => {
    // A resize can emit scroll before ResizeObserver. Don't lose the old bottom distance.
    if (body.clientHeight === before.clientHeight) before = read()
  }
  const observer = new ResizeObserver(() => {
    const after = read()
    if (before.clientHeight > 0 && after.clientHeight > 0 && before.clientHeight !== after.clientHeight) {
      body.scrollTop = resizedConversationScrollTop(before, after)
    }
    before = read()
  })
  body.addEventListener('scroll', onScroll)
  observer.observe(body)
  return () => { observer.disconnect(); body.removeEventListener('scroll', onScroll) }
}

export function useConversationResizeAnchor(body: RefObject<HTMLDivElement>, scope: string | undefined) {
  useLayoutEffect(() => {
    if (scope === undefined || body.current === null || typeof ResizeObserver === 'undefined') return
    return observeConversationResize(body.current)
  }, [body, scope])
}
