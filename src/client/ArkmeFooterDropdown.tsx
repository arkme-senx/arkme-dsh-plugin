import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArkmeChatClientEvent } from '../types.js'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from './ArkmeFooterAction.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
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
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUpdateUi } from './update-ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0 },
}

/** The DSH sidebar owns only the Arkme entry; all Arkme product UI lives in the right workspace. */
export type ArkmeFooterDropdownProps = ArkmeFooterActionProps & PropsRenderSlots<'arkme.directory.entry'>

export function ArkmeFooterDropdown(props: ArkmeFooterDropdownProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const chatDirectory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot, arkmeChatDirectory.getSnapshot)
  const auth = authState.auth
  const currentSession = props.useSessions(state => state.current)
  const unreadCount = auth?.status === 'authenticated' && chatDirectory.revision > 0
    ? arkmeChatDirectory.totalUnreadCount()
    : 0
  const updateInstalling = updateState.install !== undefined
    && ['preparing', 'downloading', 'verifying', 'installing', 'restarting'].includes(updateState.install.phase)
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
        if (update.type === 'projection-invalidated') {
          if (update.projection !== 'record') return
          arkmeInterwovenInvalidation.invalidate()
          arkmeUi.chatChanged()
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
    <div style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    <ArkmeFooterAction
      {...props}
      expanded
      loggedOut={authState.checked && (auth === undefined || !['authenticated', 'binding-required'].includes(auth.status))}
      bindingRequired={auth?.status === 'binding-required'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authState.checked || authState.busy}
      unreadCount={unreadCount}
      {...(updateState.status === undefined ? {} : { updateStatus: updateState.status })}
      updateBusy={updateState.busy || updateInstalling}
      onUpdate={() => {
        props.activate(currentSession)
        arkmeUpdateUi.open('plugin')
      }}
    />
    </div>
  </>
}
