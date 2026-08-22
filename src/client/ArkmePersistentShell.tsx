import { useEffect, useLayoutEffect, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './slots-contract.js'
import type { ArkmeChatClientEvent } from '../types.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fbfbfc',
  },
  workspace: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff',
  },
  details: { width: 0, height: 0, overflow: 'hidden' },
}

/** Permanent browser-side lifecycles that used to be owned by the optional DSH footer entry. */
export function ArkmePersistentClientRuntime() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authState.auth

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [ui.authRevision])

  useEffect(() => {
    if (auth?.status !== 'authenticated') {
      arkmeChatDirectory.activateAccount(undefined)
      return
    }
    arkmeChatDirectory.activateAccount(auth.userId)
    let stopped = false
    let observedRevision: number | undefined
    const refreshUnread = async (force = false) => {
      await arkmeChatDirectory.refreshRoot({ force })
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
          arkmeInterwovenInvalidation.invalidate()
          if (update.refresh === 'none') return
          void refreshUnread(update.refresh === 'force')
            .then(() => { if (!stopped) arkmeUi.chatChanged() })
            .catch(() => undefined)
          return
        }
        if (update.type === 'read-ack') {
          arkmeChatDirectory.updateReadAck(
            update.sourceRef,
            update.sourceKey,
            update.effectiveReadSequence,
            update.unreadCount,
          )
          return
        }
        if (update.type === 'message-notification') {
          void arkmeDesktopNotifications.show(update.notification)
          return
        }
        arkmeChatDirectory.upsertMany(update.updates.map(item => ({
          source: item.source,
          ...(item.sourceKey === undefined ? {} : { sourceKey: item.sourceKey }),
        })))
        const timelineUpdates = update.updates
          .filter(item => item.timelineItems.length > 0)
          .map(item => ({ sourceRef: item.source.sourceRef, items: item.timelineItems }))
        if (timelineUpdates.length > 0) arkmeChatTimelineDelta.publish(timelineUpdates)
        arkmeInterwovenInvalidation.invalidate()
      } catch { /* A malformed local frame must not unmount the persistent shell. */ }
    }
    return () => {
      stopped = true
      events.close()
    }
  }, [auth?.status, auth?.userId])

  return <ArkmeOutgoingCallHost />
}

export type ArkmePersistentSidebarProps = PropsRuntime<'sidebar'> & {
  collapseSidebar(): void
  closeDetails(): void
}

/** Arkme permanently owns the DSH sidebar seat and keeps it in compact-rail geometry. */
export function ArkmePersistentSidebar({
  collapsed, useSessions, collapseSidebar, closeDetails,
}: ArkmePersistentSidebarProps) {
  const currentSessionId = useSessions(state => state.current)
  useLayoutEffect(() => {
    closeDetails()
    if (!collapsed) collapseSidebar()
  }, [closeDetails, collapseSidebar, collapsed])

  return <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-sidebar-collapsed={collapsed ? 'true' : 'false'}
    style={styles.sidebar}
    aria-label="Arkme 功能导航栏"
  >
    <ArkmeProductNavigation compact={false} hosted currentSessionId={currentSessionId} />
  </aside>
}

export type ArkmePersistentWorkspaceProps = PropsRuntime<'conversation'>
  & PropsRenderSlots<'arkme.directory.entry'>
  & { closeDetails(): void }

/** Arkme permanently owns the whole DSH conversation seat. */
export function ArkmePersistentWorkspace({
  sessionId, renderSlot, closeDetails,
}: ArkmePersistentWorkspaceProps) {
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <main data-arkme-owned="persistent-workspace" style={styles.workspace} aria-label="Arkme 主界面">
    <ArkmePersistentClientRuntime />
    <ArkmeSurface
      productNavigation={false}
      currentSessionId={sessionId}
      renderSlot={renderSlot}
    />
  </main>
}

export type ArkmePersistentDetailsProps = PropsRuntime<'details'> & { closeDetails(): void }

/** Claim the details seat as an empty Arkme surface so the official DSH panel is never visible. */
export function ArkmePersistentDetails({ closeDetails }: ArkmePersistentDetailsProps) {
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <aside data-arkme-owned="persistent-details" style={styles.details} aria-hidden />
}
