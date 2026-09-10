import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ArkmeMemberEventPage, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import type { MemberEventTimeline, MemberEventTimelineSnapshot } from './member-event-timeline.js'
import { arkmeMemberEvents } from './member-event-cache.js'

const EMPTY: MemberEventTimelineSnapshot = { events: [], gaps: [], loading:false, unavailable:false }

export function useMemberEventTimeline(options: {
  enabled: boolean
  /** Show previously authorized data while member identity is being refreshed. */
  restoreCached?: boolean
  accessRevoked?: boolean
  accountKey: string | undefined
  sourceKey: string
  sourceRef: string
  mode: 'latest' | 'around'
  windowRevision: number
  ready: boolean
  /** The supplied quick-note window belongs to this group, even during a background read. */
  windowReady?: boolean
  items: readonly ArkmeTimelineItem[]
  hasMoreMessages: boolean
  paginationKey: string
  bodyRef: RefObject<HTMLDivElement>
  beforeChange: () => void
}) {
  const latest = useRef(options)
  latest.current = options
  const controller = useRef<MemberEventTimeline>()
  const entry = useRef<ReturnType<typeof arkmeMemberEvents.attach>>()
  const entered = useRef(false)
  const ceiling = useRef(0)
  const armedUntil = useRef(0)
  const [state, setState] = useState<{ key:string; snapshot:MemberEventTimelineSnapshot }>({ key:'',snapshot:EMPTY })
  const key = `${options.accountKey ?? ''}:${options.sourceKey}:${options.mode}:${options.windowRevision}`
  const activeKey = (options.enabled || options.restoreCached) && !options.accessRevoked ? key : ''

  const displayWindow = useMemo(() => {
    if (!(options.windowReady ?? options.ready)) return undefined
    const times = options.items.map(item => item.sendAtMillis).filter(value => Number.isSafeInteger(value) && value > 0)
    return {
      from: !options.hasMoreMessages || times.length === 0 ? 0 : Math.min(...times),
      ...(options.mode === 'around' && times.length > 0 ? { to: Math.max(...times) } : {}),
    }
  }, [options.windowReady, options.ready, options.items, options.hasMoreMessages, options.mode])
  const visible = useMemo(() => {
    if (activeKey === '') return EMPTY
    return arkmeMemberEvents.peek(options.accountKey, options.sourceKey, options.mode, displayWindow)
      ?? (state.key === activeKey && state.snapshot.unavailable ? state.snapshot : EMPTY)
  }, [activeKey, options.accountKey, options.sourceKey, options.mode, displayWindow?.from, displayWindow?.to, state])

  useEffect(() => {
    arkmeMemberEvents.activateAccount(options.accountKey)
    if (options.accessRevoked) arkmeMemberEvents.revoke(options.accountKey, options.sourceKey)
    if (activeKey === '' || options.accountKey === undefined) { controller.current = undefined; return }
    if (!options.enabled && arkmeMemberEvents.peek(options.accountKey, options.sourceKey, options.mode, displayWindow) === undefined) return
    let live = true
    entered.current = false
    ceiling.current = Date.now()
    const current = arkmeMemberEvents.attach(options.accountKey, options.sourceKey,
      (query,signal) => callArkme<ArkmeMemberEventPage>('source.member-events', {sourceRef:options.sourceRef,...query},signal),
      () => {
        if (!live) return
        const snapshot = current.timeline.snapshot()
        armedUntil.current = 0
        latest.current.beforeChange()
        setState({key,snapshot})
      },
    )
    entry.current = current
    controller.current = current.timeline
    const documentRef = typeof document === 'undefined' ? undefined : document
    const foreground = () => current.setForeground(latest.current.enabled && latest.current.ready && entered.current && documentRef?.visibilityState !== 'hidden')
    documentRef?.addEventListener('visibilitychange',foreground)
    return () => {
      live = false
      documentRef?.removeEventListener('visibilitychange',foreground)
      current.release()
      if (entry.current === current) { entry.current = undefined; controller.current = undefined }
    }
  }, [activeKey, options.enabled, options.accountKey, options.accessRevoked, options.sourceKey])

  useEffect(() => {
    const current = latest.current
    if (!current.enabled || !current.ready || controller.current === undefined) return
    const times = current.items.map(item => item.sendAtMillis).filter(value => Number.isSafeInteger(value) && value > 0)
    const from = !current.hasMoreMessages || times.length === 0 ? 0 : Math.min(...times)
    const to = current.mode === 'around' && times.length > 0 ? Math.max(...times) : ceiling.current
    if (!entered.current) {
      entered.current = true
      void controller.current.enterWindow(from,to,current.mode)
      // Keep the cached latest ceiling for subsequent history extensions as well.
      ceiling.current = controller.current.windowUpper()
    } else void controller.current.setWindow(from,to)
    entry.current?.setForeground(typeof document === 'undefined' || document.visibilityState !== 'hidden')
    // Ordinary messages do not expand/query the event window. Only entry and pagination do.
  }, [activeKey, options.enabled, options.ready, options.paginationKey])

  useEffect(() => {
    const root = options.bodyRef.current
    if (!options.enabled || root === null) return
    const arm = () => { armedUntil.current = Date.now()+500 }
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) arm()
    }
    const onScroll = () => {
      if (Date.now() > armedUntil.current || controller.current === undefined || controller.current.snapshot().loading) return
      const bounds = root.getBoundingClientRect()
      const gap = [...root.querySelectorAll<HTMLElement>('[data-arkme-member-event-gap]')].find(element => {
        const rect = element.getBoundingClientRect()
        return rect.bottom >= bounds.top-120 && rect.top <= bounds.bottom+120
      })
      if (gap?.dataset.arkmeMemberEventGap === undefined) return
      armedUntil.current = 0
      void controller.current.loadGap(gap.dataset.arkmeMemberEventGap)
    }
    root.addEventListener('wheel',arm,{passive:true})
    root.addEventListener('touchmove',arm,{passive:true})
    root.addEventListener('pointerdown',arm,{passive:true})
    root.addEventListener('keydown',onKey)
    root.addEventListener('scroll',onScroll,{passive:true})
    return () => {
      root.removeEventListener('wheel',arm); root.removeEventListener('touchmove',arm)
      root.removeEventListener('pointerdown',arm); root.removeEventListener('keydown',onKey); root.removeEventListener('scroll',onScroll)
    }
  }, [activeKey, options.enabled, options.ready])

  const revoke = useCallback(() => { controller.current?.revoke() },[])
  return { ...visible, revoke }
}
