import { followConversationBottom, isConversationFollowing } from './conversation-bottom-follow.js'
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
  let anchor: { row: HTMLElement; offset: number } | undefined
  const captureAnchor = () => {
    if (content === undefined) return
    const bounds = body.getBoundingClientRect()
    const visible = (row: HTMLElement) => {
      const rect = row.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom ? rect.top - bounds.top : undefined
    }
    // Reuse the mounted reading row on ordinary scroll/commits. A new search
    // touches only the bounded rendered window, never the cached message set.
    if (anchor !== undefined && content.contains(anchor.row)) {
      const offset = visible(anchor.row)
      if (offset !== undefined) { anchor.offset = offset; return }
    }
    anchor = undefined
    for (const row of content.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
      const offset = visible(row)
      if (offset !== undefined) { anchor = { row, offset }; break }
    }
  }
  captureAnchor()
  const onScroll = () => {
    // A resize can emit scroll before ResizeObserver. Don't lose the old bottom distance.
    const stable = body.clientHeight === before.clientHeight && body.scrollHeight === before.scrollHeight
    if (stable) captureAnchor()
    if (body.clientHeight === before.clientHeight
      && (content === undefined || body.scrollHeight === before.scrollHeight || body.scrollTop < before.scrollTop)) before = read()
  }
  const resize = () => {
    const after = read()
    const nextAccessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
    const accessoryDelta = nextAccessoryHeight - accessoryHeight
    const nextContentHeight = content?.getBoundingClientRect().height ?? 0
    if (isConversationFollowing(body)) {
      // Align deferred virtual-chunk/media layout before paint too. User input
      // cancels latest-edge intent instead of competing with a scroll animation.
      followConversationBottom(body)
    } else if (before.clientHeight > 0 && after.clientHeight > 0 && before.clientHeight !== after.clientHeight) {
      body.scrollTop = resizedConversationScrollTop(before, after)
    } else if (after.clientHeight > 0 && nextContentHeight !== contentHeight) {
      // Timeline commits rebase this owner below. Later virtual-chunk/media
      // layout must retain that reading row too, including when native scroll
      // anchoring cannot follow a chunk replaced by its measured height.
      if (before.scrollHeight - before.scrollTop - before.clientHeight <= 80) {
        body.scrollTop = Math.max(0, after.scrollHeight - after.clientHeight)
      } else if (anchor !== undefined && content?.contains(anchor.row)) {
        const delta = anchor.row.getBoundingClientRect().top - body.getBoundingClientRect().top - anchor.offset
        if (Math.abs(delta) > 0.5) {
          body.scrollTop = Math.max(0, Math.min(after.scrollHeight - after.clientHeight, body.scrollTop + delta))
        }
      }
    } else if (after.clientHeight > 0 && accessoryDelta !== 0) {
      // Only undo the accessory's height delta, not anchors already restored by timeline paging.
      body.scrollTop = resizedConversationScrollTop({ ...after, scrollHeight: after.scrollHeight - accessoryDelta }, after)
    }
    accessoryHeight = nextAccessoryHeight
    contentHeight = nextContentHeight
    before = read()
    captureAnchor()
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
      if (followBottom) {
        if (isConversationFollowing(body)) followConversationBottom(body)
        else body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
      }
      before = read()
      accessoryHeight = endAccessory?.getBoundingClientRect().height ?? 0
      contentHeight = content?.getBoundingClientRect().height ?? 0
      captureAnchor()
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
