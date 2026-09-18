import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type RefObject } from 'react'

export const CALENDAR_DEFAULT_HEIGHT = 760
export const CALENDAR_MIN_HEIGHT = 360
const MAX_PREFERENCE = 4096
const PADDING = 12
const preferenceKey = (account: string) => `dsh-arkme:calendar-height:v1:${encodeURIComponent(account)}`

export function readCalendarHeight(account?: string): number | undefined {
  if (!account) return undefined
  try {
    const value = Number(localStorage.getItem(preferenceKey(account)))
    return Number.isFinite(value) && value >= CALENDAR_MIN_HEIGHT && value <= MAX_PREFERENCE ? value : undefined
  } catch { return undefined }
}

export function writeCalendarHeight(account: string | undefined, height: number): void {
  if (!account || !Number.isFinite(height)) return
  try { localStorage.setItem(preferenceKey(account), String(Math.round(Math.max(CALENDAR_MIN_HEIGHT, Math.min(MAX_PREFERENCE, height))))) }
  catch { /* Local presentation preferences are optional, not required for navigation. */ }
}

export function calendarPopoverLayout(anchor: { right: number; bottom: number }, width: number, height: number, preferred: number) {
  const actualHeight = Math.max(1, Math.min(preferred, height - PADDING * 2))
  const actualWidth = Math.max(1, Math.min(354, width - PADDING * 2))
  const top = Math.max(PADDING, Math.min(anchor.bottom + 8, height - actualHeight - PADDING))
  return { top, left: Math.max(PADDING, Math.min(width - actualWidth - PADDING, anchor.right - actualWidth)),
    height: actualHeight, maxHeight: Math.max(1, height - top - PADDING) }
}

/** Shared by all conversation calendars; window constraints never overwrite a user's preference. */
export function useCalendarPopoverLayout(open: boolean, anchor: RefObject<HTMLButtonElement>, panel: RefObject<HTMLElement>, account?: string) {
  const preference = useRef({ account, height: readCalendarHeight(account) ?? CALENDAR_DEFAULT_HEIGHT })
  const [layout, setLayout] = useState({ top: 52, left: 12, height: CALENDAR_DEFAULT_HEIGHT, maxHeight: CALENDAR_DEFAULT_HEIGHT })
  const drag = useRef<{ pointerId: number; startY: number; height: number; lastHeight: number }>()
  const [resizing, setResizing] = useState(false)

  useLayoutEffect(() => {
    drag.current = undefined
    setResizing(false)
    if (!open) return
    preference.current = { account, height: readCalendarHeight(account)
      ?? (preference.current.account === account ? preference.current.height : CALENDAR_DEFAULT_HEIGHT) }
    const update = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && panel.current?.contains(event.target)) return
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      drag.current = undefined
      setResizing(false)
      setLayout(calendarPopoverLayout(rect, window.innerWidth, window.innerHeight, preference.current.height))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open, account, anchor, panel])

  const clamp = (value: number) => Math.max(Math.min(CALENDAR_MIN_HEIGHT, layout.maxHeight), Math.min(layout.maxHeight, MAX_PREFERENCE, value))
  const commit = (height: number) => {
    preference.current = { account, height: Math.max(CALENDAR_MIN_HEIGHT, height) }
    writeCalendarHeight(account, height)
  }
  const end = (event: PointerEvent<HTMLDivElement>, save: boolean) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = undefined
    setResizing(false)
    if (save) commit(current.lastHeight)
    else setLayout(value => ({ ...value, height: current.height }))
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return { layout, resizing, resizeProps: {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || drag.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = { pointerId: event.pointerId, startY: event.clientY, height: layout.height, lastHeight: layout.height }
      setResizing(true)
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      current.lastHeight = clamp(current.height + event.clientY - current.startY)
      setLayout(value => ({ ...value, height: current.lastHeight }))
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => end(event, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => end(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => end(event, false),
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const next = event.key === 'ArrowDown' ? layout.height + 40 : event.key === 'ArrowUp' ? layout.height - 40
        : event.key === 'Home' ? CALENDAR_MIN_HEIGHT : event.key === 'End' ? layout.maxHeight : undefined
      if (next === undefined) return
      event.preventDefault()
      const height = clamp(next)
      commit(height)
      setLayout(value => ({ ...value, height }))
    },
  } }
}
