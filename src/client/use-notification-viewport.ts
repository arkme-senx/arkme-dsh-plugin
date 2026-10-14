import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { arkmeVisibleReadIntentAllowed, subscribeArkmeReadIntentAvailability } from './read-intent-visibility.js'

interface Message { id: string; atMillis: number }

/** Read only committed, visible messages. Background fetches and hidden filters never acknowledge. */
export function useNotificationVisibleRead<T extends Message>(
  rootRef: RefObject<HTMLDivElement>, items: readonly T[], enabled: boolean,
  acknowledge: (items: readonly T[], signal: AbortSignal) => Promise<void>, contextKey: string,
) {
  const latest = useRef({ items, acknowledge })
  latest.current = { items, acknowledge }
  const scheduleRef = useRef<() => void>()
  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const readVisible = async () => {
      if (busy || controller.signal.aborted || !arkmeVisibleReadIntentAllowed()) return
      const bounds = root.getBoundingClientRect()
      if (bounds.height <= 0 || bounds.width <= 0) return
      const byId = new Map(latest.current.items.map(item => [item.id, item]))
      const visible = Array.from(root.querySelectorAll<HTMLElement>('[data-notification-id]')).flatMap(row => {
        const rect = row.getBoundingClientRect()
        const height = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)
        const width = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)
        const item = byId.get(row.dataset.notificationId ?? '')
        return item && rect.height > 0 && width > 0 && height >= Math.min(80, rect.height * .6) ? [item] : []
      })
      if (!visible.length) return
      busy = true
      try { await latest.current.acknowledge(visible, controller.signal) } finally { busy = false }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void readVisible() }, 250) }
    scheduleRef.current = schedule
    root.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('focus', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', schedule)
    const release = subscribeArkmeReadIntentAvailability(schedule)
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    resize?.observe(root)
    if (root.firstElementChild) resize?.observe(root.firstElementChild)
    // A failed receipt retries without adding a manual read-status interaction.
    const retry = setInterval(() => { void readVisible() }, 15_000)
    schedule()
    return () => {
      controller.abort(); clearTimeout(timer); clearInterval(retry); release(); resize?.disconnect()
      scheduleRef.current = undefined
      root.removeEventListener('scroll', schedule)
      window.removeEventListener('focus', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [rootRef, enabled, contextKey])
  useEffect(() => { scheduleRef.current?.() }, [items, acknowledge])
}

/** Keep a message anchor while history is prepended; follow incoming messages only at the bottom. */
export function useNotificationScroll(rootRef: RefObject<HTMLDivElement>, items: readonly Message[], viewKey: string) {
  const follow = useRef(true)
  const anchor = useRef<{ id: string; top: number }>()
  const previous = useRef<{ key: string; ids: Set<string>; latestAt: number }>()
  const [newMessages, setNewMessages] = useState(0)
  const toLatest = () => {
    const root = rootRef.current
    if (root) root.scrollTop = root.scrollHeight
    follow.current = true; anchor.current = undefined; setNewMessages(0)
  }
  const remember = () => {
    const root = rootRef.current
    if (!root) return
    follow.current = root.scrollHeight - root.clientHeight - root.scrollTop < 48
    if (follow.current) { anchor.current = undefined; setNewMessages(0); return }
    const top = root.getBoundingClientRect().top
    const row = Array.from(root.querySelectorAll<HTMLElement>('[data-notification-id]')).find(row => row.getBoundingClientRect().bottom > top)
    if (row?.dataset.notificationId) anchor.current = { id: row.dataset.notificationId, top: row.getBoundingClientRect().top - top }
  }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const before = previous.current
    const latestAt = items.at(-1)?.atMillis ?? 0
    if (!before || before.key !== viewKey || before.ids.size === 0 || follow.current) toLatest()
    else {
      const count = items.filter(item => !before.ids.has(item.id) && item.atMillis >= before.latestAt).length
      if (count) setNewMessages(value => value + count)
      const saved = anchor.current
      if (saved) {
        const row = Array.from(root.querySelectorAll<HTMLElement>('[data-notification-id]')).find(row => row.dataset.notificationId === saved.id)
        if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - saved.top
      }
    }
    previous.current = { key: viewKey, ids: new Set(items.map(item => item.id)), latestAt }
  }, [items, viewKey])
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (follow.current) root.scrollTop = root.scrollHeight
    })
    observer.observe(root)
    if (root.firstElementChild) observer.observe(root.firstElementChild)
    return () => observer.disconnect()
  }, [rootRef, viewKey])
  return { newMessages, toLatest, onScroll: remember }
}
