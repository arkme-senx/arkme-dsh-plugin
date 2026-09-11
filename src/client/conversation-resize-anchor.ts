import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react'

interface ViewportMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }

export function resizedConversationScrollTop(before: ViewportMetrics, after: ViewportMetrics): number {
  const maximum = Math.max(0, after.scrollHeight - after.clientHeight)
  // Match the conversation's existing 80px near-bottom policy.
  return before.scrollHeight - before.scrollTop - before.clientHeight <= 80
    ? maximum
    : Math.max(0, Math.min(before.scrollTop, maximum))
}

/** Keep the latest content visible through viewport and deferred message layout. */
export function observeConversationResize(body: HTMLElement, endAccessory?: HTMLElement, content?: HTMLElement) {
  const read = (): ViewportMetrics => ({ scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight })
  let before = read()
  let accessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
  let contentHeight = content?.getBoundingClientRect().height ?? 0
  const onScroll = () => {
    // A resize can emit scroll before ResizeObserver. Don't lose the old bottom distance.
    if (body.clientHeight === before.clientHeight
      && (content === undefined || body.scrollHeight === before.scrollHeight || body.scrollTop < before.scrollTop)) before = read()
  }
  const resize = () => {
    const after = read()
    const nextAccessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
    const accessoryDelta = nextAccessoryHeight - accessoryHeight
    const nextContentHeight = content?.getBoundingClientRect().height ?? 0
    if (before.clientHeight > 0 && after.clientHeight > 0 && before.clientHeight !== after.clientHeight) {
      body.scrollTop = resizedConversationScrollTop(before, after)
    } else if (after.clientHeight > 0 && nextContentHeight !== contentHeight) {
      // Timeline commits have already restored their own anchors. Only follow
      // later layout (images, rich text, cards) if that restored view was at the
      // bottom; leave history and the browser's reading anchor untouched.
      if (before.scrollHeight - before.scrollTop - before.clientHeight <= 80) {
        body.scrollTop = Math.max(0, after.scrollHeight - after.clientHeight)
      }
    } else if (after.clientHeight > 0 && accessoryDelta !== 0) {
      // Only undo the accessory's height delta, not anchors already restored by timeline paging.
      body.scrollTop = resizedConversationScrollTop({ ...after, scrollHeight: after.scrollHeight - accessoryDelta }, after)
    }
    accessoryHeight = nextAccessoryHeight
    contentHeight = nextContentHeight
    before = read()
  }
  const observer = new ResizeObserver(resize)
  body.addEventListener('scroll', onScroll)
  observer.observe(body)
  if (endAccessory !== undefined) observer.observe(endAccessory)
  if (content !== undefined) observer.observe(content)
  const dispose = () => { observer.disconnect(); body.removeEventListener('scroll', onScroll) }
  return Object.assign(dispose, {
    commit(followBottom?: boolean) {
      if (followBottom === undefined) {
        // A React commit can precede ResizeObserver delivery. Process it with
        // the previous metrics instead of forgetting the bottom position.
        resize()
        return
      }
      if (followBottom) body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
      before = read()
      accessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
      contentHeight = content?.getBoundingClientRect().height ?? 0
    },
  })
}

export function useConversationResizeAnchor(body: RefObject<HTMLDivElement>, scope: string | undefined, endAccessory?: RefObject<HTMLDivElement>, selecting = false, content?: RefObject<HTMLElement>, restoreIntent?: MutableRefObject<boolean | undefined>) {
  const observation = useRef<{
    body: HTMLElement; content: HTMLElement | undefined; accessory: HTMLElement | undefined
    scope: string; selecting: boolean; dispose: ReturnType<typeof observeConversationResize>
  }>()
  useLayoutEffect(() => {
    const node = body.current
    const list = content?.current ?? undefined
    const accessory = endAccessory?.current ?? undefined
    const current = observation.current
    if (current !== undefined && (current.body !== node || current.content !== list
      || current.accessory !== accessory || current.scope !== scope || current.selecting !== selecting)) {
      current.dispose()
      observation.current = undefined
    }
    if (observation.current === undefined && scope !== undefined && node !== null && typeof ResizeObserver !== 'undefined') {
      observation.current = { body: node, content: list, accessory, scope, selecting,
        dispose: observeConversationResize(node, accessory, list) }
    }
    observation.current?.dispose.commit(restoreIntent?.current)
    if (restoreIntent !== undefined) restoreIntent.current = undefined
  })
  useLayoutEffect(() => () => { observation.current?.dispose(); observation.current = undefined }, [])
}
