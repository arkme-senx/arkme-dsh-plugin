import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArkmeChatClientEvent } from '../types.js'
import { ArkmeConversationSurface } from './ArkmeConversationSurface.js'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from './ArkmeFooterAction.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeUi } from './ui-controller.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  panel: {
    width: '100%', height: 'min(44vh, 420px)', minHeight: 0, maxHeight: 'calc(100vh - 220px)', margin: '6px 0 2px',
    boxSizing: 'border-box', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 12, background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)',
  },
}

/** Footer action plus an inline Arkme directory that participates in sidebar layout. */
export type ArkmeFooterDropdownProps = ArkmeFooterActionProps & PropsRenderSlots<'arkme.directory.entry'>

export function ArkmeFooterDropdown(props: ArkmeFooterDropdownProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot)
  const chatDirectory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
  const currentSession = props.useSessions(state => state.current)
  const hasOpened = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const auth = authState.auth
  const unreadCount = auth?.status === 'authenticated' && chatDirectory.revision > 0
    ? arkmeChatDirectory.totalUnreadCount()
    : 0
  const updateInstalling = updateState.install !== undefined
    && ['preparing', 'installing', 'restarting'].includes(updateState.install.phase)
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
      } catch { /* Ignore malformed local frames; EventSource keeps the channel alive. */ }
    }
    return () => {
      stopped = true
      events.close()
    }
  }, [auth?.status, auth?.userId, ui.authRevision])
  return <>
    <ArkmeOutgoingCallHost />
    <div ref={rootRef} style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    {hasOpened.current && <div
      id="arkme-footer-directory" role="region" aria-label="Arkme 下拉列表"
      hidden={!props.wide || !ui.open}
      style={{ ...styles.panel, display: props.wide && ui.open ? 'block' : 'none' }}
    >
      <ArkmeNavigation
        currentSessionId={currentSession}
        onActivateSurface={() => { props.activate(currentSession) }}
        renderSlot={props.renderSlot}
      />
    </div>}
    <ArkmeFooterAction
      {...props}
      expanded={ui.open}
      loggedOut={authState.checked && (auth === undefined || !['authenticated', 'binding-required'].includes(auth.status))}
      bindingRequired={auth?.status === 'binding-required'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authState.checked || authState.busy}
      unreadCount={unreadCount}
      {...(updateState.status === undefined ? {} : { updateStatus: updateState.status })}
      updateBusy={updateState.busy || updateInstalling}
      onUpdate={() => { void arkmePluginUpdateStore.install() }}
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
