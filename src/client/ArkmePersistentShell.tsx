import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './slots-contract.js'
import type { ArkmeChatClientEvent, ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeSettingsSurface } from './ArkmeSettingsSurface.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import { callArkme } from './api.js'
import { DeepSeekHarnessSurface } from './DeepSeekHarnessSurface.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import {
  reconcileArkmeProviderInstance, recoverArkmeProviderInstanceDirectory,
} from './provider-instance-runtime.js'
import { forgetNavigationProviderInstance } from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'flex', overflow: 'hidden', background: '#fff',
  },
  taskDirectory: { minWidth: 0, flex: 1, overflow: 'hidden', borderLeft: '1px solid #ececef', background: '#fff' },
  workspace: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff', position: 'relative',
  },
  conversationLayer: {
    position: 'absolute', inset: 0, minWidth: 0, minHeight: 0,
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
    if (auth?.status !== 'authenticated' || auth.userId === undefined) {
      arkmeChatDirectory.activateAccount(undefined)
      return
    }
    const authenticatedUserId = auth.userId
    arkmeChatDirectory.activateAccount(authenticatedUserId)
    let stopped = false
    let observedRevision: number | undefined
    const refreshUnread = async (force = false) => {
      await arkmeChatDirectory.refreshRoot({ force })
    }
    // Establish the directory baseline before a navigation surface happens to mount.
    void refreshUnread().catch(() => undefined)
    const events = new EventSource('/arkme-self/api/events')
    events.onopen = () => {
      void reconcileArkmeProviderInstance()
        .then(async changed => {
          if (!changed || stopped) return
          try {
            await recoverArkmeProviderInstanceDirectory({
              userId: authenticatedUserId,
              activateAccount: userId => { arkmeChatDirectory.activateAccount(userId) },
              refreshRoot: async force => { await refreshUnread(force) },
              onRefreshed: () => { if (!stopped) arkmeUi.chatChanged() },
            })
          } catch (error) {
            forgetNavigationProviderInstance()
            throw error
          }
        })
        .catch(() => undefined)
    }
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

export type ArkmePersistentSidebarProps = PropsRuntime<'sidebar'>
  & PropsRenderSlots<'arkme.directory.entry'>
  & {
    collapseSidebar(): void
    closeDetails(): void
  }

/** Arkme permanently owns the DSH sidebar seat so navigation stays stable across Arkme and Harness conversations. */
export function ArkmePersistentSidebar({
  collapsed, useSessions, renderSlot, collapseSidebar, closeDetails,
}: ArkmePersistentSidebarProps) {
  const sessionState = useSessions(state => state)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const harnessMode = ui.mode === 'harness'
  const loginMode = ui.mode === 'login'
    || (authState.auth !== undefined && authState.auth.status !== 'authenticated')
  const authenticatedUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const [sendToSelfState, setSendToSelfState] = useState<{
    userId: number
    source: ArkmeSourceItem
  }>()
  const directoryVisible = !loginMode && ui.calendarOpen !== true
    && (ui.mode === 'source' || ui.mode === 'arko' || harnessMode)
  useEffect(() => {
    if (authenticatedUserId === undefined) {
      setSendToSelfState(undefined)
      return
    }
    const controller = new AbortController()
    void callArkme<ArkmeSourceList>('sources.list', {
      directory: 'send_to_self', limit: 100,
    }, controller.signal).then(page => {
      const source = page.items.find(item => item.kind === 'send_to_self')
      if (source !== undefined && !controller.signal.aborted) {
        setSendToSelfState({ userId: authenticatedUserId, source })
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [authenticatedUserId, ui.chatRevision])
  const sendToSelfSource = sendToSelfState !== undefined && sendToSelfState.userId === authenticatedUserId
    ? sendToSelfState.source
    : undefined
  useLayoutEffect(() => {
    closeDetails()
    if (collapsed) collapseSidebar()
  }, [closeDetails, collapseSidebar, collapsed])

  if (loginMode) return <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-login-mode="true"
    data-arkme-directory-visible="false"
    style={{ ...styles.sidebar, width: 0 }}
    aria-hidden
  />

  return <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-workspace
    data-arkme-sidebar-collapsed={collapsed ? 'true' : 'false'}
    data-arkme-harness-mode={harnessMode ? 'true' : 'false'}
    data-arkme-directory-visible={directoryVisible ? 'true' : 'false'}
    data-arkme-login-mode="false"
    style={styles.sidebar}
    aria-label="Arkme 功能导航栏"
  >
    <ArkmeProductNavigation
      compact={false}
      hosted
      taskExpanded
      currentSessionId={sessionState.current}
    />
    {directoryVisible && <div style={styles.taskDirectory}>
      <ArkmeNavigation
        wide
        embeddedProductShell
        showHarnessEntry
        currentSessionId={sessionState.current}
        renderSlot={renderSlot}
        {...(sendToSelfSource === undefined ? {} : { sendToSelfSource })}
      />
    </div>}
  </aside>
}

export type ArkmePersistentWorkspaceProps = PropsRuntime<'conversation'> & { closeDetails(): void }

/** Arkme keeps the conversation seat and embeds the complete native DSH client inside it. */
export function ArkmePersistentWorkspace({
  sessionId, closeDetails,
}: ArkmePersistentWorkspaceProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  useLayoutEffect(() => { closeDetails() }, [closeDetails])

  return <main data-arkme-owned="persistent-workspace" data-arkme-workspace style={styles.workspace} aria-label="Arkme 主界面">
    <ArkmePersistentClientRuntime />
    <DeepSeekHarnessSurface visible={ui.mode === 'harness'} />
    {ui.mode === 'settings'
      ? <div className="arkme-redesign-route-surface arkme-redesign-settings-page">
        <ArkmeSettingsSurface />
      </div>
      : <div
        data-arkme-owned="arkme-conversation-layer"
        style={{
          ...styles.conversationLayer,
          visibility: ui.mode === 'harness' ? 'hidden' : 'visible',
          pointerEvents: ui.mode === 'harness' ? 'none' : 'auto',
          zIndex: ui.mode === 'harness' ? 0 : 1,
        }}
        aria-hidden={ui.mode === 'harness' ? true : undefined}
      >
        <ArkmeSurface
          productChrome={false}
          productNavigation={false}
          currentSessionId={sessionId}
          onActivateSurface={() => undefined}
        />
      </div>}
  </main>
}

export type ArkmePersistentDetailsProps = PropsRuntime<'details'> & { closeDetails(): void }

/** Claim the details seat as an empty Arkme surface so the official DSH panel is never visible. */
export function ArkmePersistentDetails({ closeDetails }: ArkmePersistentDetailsProps) {
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <aside data-arkme-owned="persistent-details" style={styles.details} aria-hidden />
}
