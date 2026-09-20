import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeMessageReadReceipts, type ArkmeMessageReadReceiptTarget } from './message-read-receipt-store.js'

const emptyMembers: ReadonlySet<string> = new Set()
const MentionReadContext = createContext<{ sourceRef: string; itemUid: string; members: ReadonlySet<string> } | undefined>(undefined)

// Keep receipt truth scoped to the message, including portals that render another record.
export function useReadMentionMembers(itemUid: string | undefined, sourceRef: string | undefined): ReadonlySet<string> {
  const scope = useContext(MentionReadContext)
  return scope !== undefined && itemUid !== undefined && sourceRef !== undefined
    && scope.itemUid === itemUid && scope.sourceRef === sourceRef ? scope.members : emptyMembers
}

export function ArkmeMentionReadProvider(props: {
  source: ArkmeSourceItem
  item: ArkmeTimelineItem
  elementRef: RefObject<HTMLElement>
  children: ReactNode
}) {
  const { source, item } = props
  const eligible = source.kind === 'group_chat' && item.isMe && item.status === 1
    && Number.isSafeInteger(item.sequence) && item.sequence! > 0
    && item.mentions?.some(mention => mention.kind === 'member' && Boolean(mention.memberRef))
  return eligible ? <AccountMentionReadProvider {...props} />
    : <MentionReadContext.Provider value={undefined}>{props.children}</MentionReadContext.Provider>
}

function AccountMentionReadProvider(props: Parameters<typeof ArkmeMentionReadProvider>[0]) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot).auth
  const generation = useSyncExternalStore(arkmeMessageReadReceipts.subscribe, arkmeMessageReadReceipts.getAccountGeneration)
  if (auth?.status !== 'authenticated' || auth.userId === undefined) {
    return <MentionReadContext.Provider value={undefined}>{props.children}</MentionReadContext.Provider>
  }
  const identity = JSON.stringify([auth.environment, auth.userId, generation,
    props.source.sourceKey ?? props.source.sourceRef, props.item.itemUid, props.item.sequence])
  return <VisibleMentionReadProvider key={identity} {...props} />
}

function VisibleMentionReadProvider({ source, item, elementRef, children }: Parameters<typeof ArkmeMentionReadProvider>[0]) {
  const [members, setMembers] = useState<ReadonlySet<string>>(emptyMembers)
  const target = useMemo<ArkmeMessageReadReceiptTarget>(() => ({
    sourceRef: source.sourceRef, sourceKey: source.sourceKey ?? source.sourceRef,
    conversationKind: 'group_chat', itemUid: item.itemUid, sequence: item.sequence!,
  }), [source.sourceRef, source.sourceKey, item.itemUid, item.sequence])

  useEffect(() => {
    let disposed = false
    let visible = false
    let intersecting = false
    let revision = 0
    let failures = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let release: (() => void) | undefined
    const registration = arkmeMessageReadReceipts.register(target)
    const clearRetry = () => { if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined }
    const load = () => {
      if (!visible || disposed) return
      clearRetry()
      const request = ++revision
      void arkmeMessageReadReceipts.detail(target).then(detail => {
        if (disposed || !visible || request !== revision) return
        failures = 0
        setMembers(new Set(detail.items.filter(member => member.readStatus === 'read').map(member => member.memberRef)))
      }).catch(error => {
        if (disposed || !visible || request !== revision) return
        setMembers(emptyMembers)
        if ((error as { body?: { retryable?: boolean } })?.body?.retryable === false) return
        // A failed detail must recover even when the aggregate count stays unchanged.
        retryTimer = setTimeout(load, Math.min(30_000, 5_000 * 2 ** Math.min(failures++, 3)))
      })
    }
    const updateVisibility = () => {
      const next = intersecting && (typeof document === 'undefined' || document.visibilityState !== 'hidden')
      if (next === visible || disposed) return
      visible = next
      registration.setVisible(next)
      if (next) {
        release = arkmeMessageReadReceipts.observeDetail(target, load)
        load()
      } else {
        revision += 1
        clearRetry()
        release?.(); release = undefined
      }
    }
    const element = elementRef.current
    const observer = element !== null && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
        intersecting = entries.some(entry => entry.target === element && entry.isIntersecting)
        updateVisibility()
      }, { rootMargin: '120px 0px' }) : undefined
    if (observer !== undefined && element !== null) observer.observe(element)
    else { intersecting = true; updateVisibility() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      disposed = true; revision += 1
      clearRetry(); release?.(); observer?.disconnect(); registration.dispose()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [target, elementRef])

  const value = useMemo(() => ({ sourceRef: source.sourceRef, itemUid: item.itemUid, members }), [source.sourceRef, item.itemUid, members])
  return <MentionReadContext.Provider value={value}>{children}</MentionReadContext.Provider>
}
