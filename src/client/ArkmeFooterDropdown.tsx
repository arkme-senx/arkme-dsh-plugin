import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeChatClientEvent, ArkmeSourceList } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from './ArkmeFooterAction.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from './chat-directory-store.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  panel: {
    width: '100%', height: 'min(44vh, 420px)', minHeight: 0, maxHeight: 'calc(100vh - 220px)', margin: '6px 0 2px',
    boxSizing: 'border-box', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 12, background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)',
  },
}

/** Footer action plus an inline Arkme directory that participates in sidebar layout. */
export function ArkmeFooterDropdown(props: ArkmeFooterActionProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const currentSession = props.useSessions(state => state.current)
  const [unreadCount, setUnreadCount] = useState(0)
  const hasOpened = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const auth = authState.auth
  if (ui.open) hasOpened.current = true
  useLayoutEffect(() => {
    const slot = rootRef.current?.parentElement
    if (slot?.getAttribute('data-slot') !== 'sidebar.footer.action') return
    const previous = {
      display: slot.style.display,
      flexDirection: slot.style.flexDirection,
      alignItems: slot.style.alignItems,
      width: slot.style.width,
      minWidth: slot.style.minWidth,
    }
    slot.style.display = 'flex'
    slot.style.flexDirection = 'column'
    slot.style.alignItems = 'stretch'
    slot.style.width = '100%'
    slot.style.minWidth = '0'
    return () => { Object.assign(slot.style, previous) }
  }, [])
  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [ui.authRevision])
  useEffect(() => {
    if (auth?.status !== 'authenticated') {
      setUnreadCount(0)
      arkmeChatDirectory.clear()
      return
    }
    let stopped = false
    let observedRevision: number | undefined
    let refreshGeneration = 0
    const refreshUnread = async () => {
      const generation = ++refreshGeneration
      let cursor: string | undefined
      let total = 0
      const sources: ArkmeSourceList['items'] = []
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await callArkme<ArkmeSourceList>('sources.list', {
          directory: 'root', limit: 100, ...(cursor === undefined ? {} : { cursor }),
        })
        sources.push(...page.items)
        total += page.items.reduce((sum, source) => sum + Math.max(0, Math.trunc(source.unreadCount)), 0)
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      if (!stopped && generation === refreshGeneration) {
        setUnreadCount(total)
        arkmeChatDirectory.publish(sources)
      }
    }
    const events = new EventSource('/arkme-self/api/events')
    events.onmessage = event => {
      if (stopped) return
      try {
        const update = JSON.parse(event.data) as ArkmeChatClientEvent
        if (!Number.isSafeInteger(update.revision) || update.revision < 0
          || (observedRevision !== undefined && update.revision <= observedRevision)) return
        observedRevision = update.revision
        if (update.type === 'reconcile') {
          void refreshUnread().catch(() => undefined)
          return
        }
        if (update.type === 'read-ack') {
          const previousUnread = arkmeChatDirectory.unreadCount(update.sourceRef)
          arkmeChatDirectory.updateUnread(update.sourceRef, update.unreadCount)
          setUnreadCount(current => Math.max(0, current - Math.max(0, previousUnread - update.unreadCount)))
          return
        }
        const unreadDelta = update.updates.reduce((sum, item) => {
          return sum + item.source.unreadCount - arkmeChatDirectory.unreadCount(item.source.sourceRef)
        }, 0)
        arkmeChatDirectory.upsertMany(update.updates.map(item => item.source))
        setUnreadCount(current => Math.max(0, current + unreadDelta))
        const timelineUpdates = update.updates
          .filter(item => item.timelineItems.length > 0)
          .map(item => ({ sourceRef: item.source.sourceRef, items: item.timelineItems }))
        if (timelineUpdates.length > 0) arkmeChatTimelineDelta.publish(timelineUpdates)
      } catch { /* Ignore malformed local frames; EventSource keeps the channel alive. */ }
    }
    return () => {
      stopped = true
      refreshGeneration += 1
      events.close()
    }
  }, [auth?.status, ui.authRevision])
  return <>
    <ArkmeOutgoingCallHost />
    <div ref={rootRef} style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    {hasOpened.current && <div
      id="arkme-footer-directory" role="region" aria-label="Arkme 下拉列表"
      hidden={!props.wide || !ui.open}
      style={{ ...styles.panel, display: props.wide && ui.open ? 'block' : 'none' }}
    >
      <ArkmeNavigation onActivateSurface={() => { props.activate(currentSession) }} />
    </div>}
    <ArkmeFooterAction
      {...props}
      expanded={ui.open}
      loggedOut={authState.checked && auth !== undefined && !['authenticated', 'binding-required'].includes(auth.status)}
      bindingRequired={auth?.status === 'binding-required'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authState.checked || authState.busy}
      unreadCount={unreadCount}
    />
    </div>
    {ui.surfaceOpen && <ArkmeConversationSurface
      close={props.closeSurface}
      initialAuth={auth}
      openedFromSession={props.surfaceSession()}
      useSessions={props.useSessions}
    />}
  </>
}
