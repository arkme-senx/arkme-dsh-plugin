import { useLayoutEffect, type RefObject } from 'react'

interface ViewportMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }

export function resizedConversationScrollTop(before: ViewportMetrics, after: ViewportMetrics): number {
  const maximum = Math.max(0, after.scrollHeight - after.clientHeight)
  // Match the conversation's existing 80px near-bottom policy.
  return before.scrollHeight - before.scrollTop - before.clientHeight <= 80
    ? maximum
    : Math.max(0, Math.min(before.scrollTop, maximum))
}

/** Keep the latest content visible as the viewport or its end accessory resizes. */
export function observeConversationResize(body: HTMLElement, endAccessory?: HTMLElement): () => void {
  const read = (): ViewportMetrics => ({ scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight })
  let before = read()
  let accessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
  const onScroll = () => {
    // A resize can emit scroll before ResizeObserver. Don't lose the old bottom distance.
    if (body.clientHeight === before.clientHeight) before = read()
  }
  const observer = new ResizeObserver(() => {
    const after = read()
    const nextAccessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
    const accessoryDelta = nextAccessoryHeight - accessoryHeight
    if (before.clientHeight > 0 && after.clientHeight > 0 && before.clientHeight !== after.clientHeight) {
      body.scrollTop = resizedConversationScrollTop(before, after)
    } else if (after.clientHeight > 0 && accessoryDelta !== 0) {
      // Only undo the accessory's height delta, not anchors already restored by timeline paging.
      body.scrollTop = resizedConversationScrollTop({ ...after, scrollHeight: after.scrollHeight - accessoryDelta }, after)
    }
    accessoryHeight = nextAccessoryHeight
    before = read()
  })
  body.addEventListener('scroll', onScroll)
  observer.observe(body)
  if (endAccessory !== undefined) observer.observe(endAccessory)
  return () => { observer.disconnect(); body.removeEventListener('scroll', onScroll) }
}

export function useConversationResizeAnchor(body: RefObject<HTMLDivElement>, scope: string | undefined, endAccessory?: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    if (scope === undefined || body.current === null || typeof ResizeObserver === 'undefined') return
    return observeConversationResize(body.current, endAccessory?.current ?? undefined)
  }, [body, scope, endAccessory])
}
