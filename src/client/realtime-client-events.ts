import { useEffect } from 'react'
import type { ArkmeAuthSnapshot, ArkmeChatClientEvent } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { forgetNavigationProviderInstance } from './navigation-cache.js'
import {
  reconcileArkmeProviderInstance, recoverArkmeProviderInstanceDirectory,
} from './provider-instance-runtime.js'
import { arkmeUi } from './ui-controller.js'

export function useArkmeRealtimeClientEvents(
  auth: ArkmeAuthSnapshot | undefined,
  authRevision: number,
  refreshDirectoryBaseline: boolean,
): void {
  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [authRevision])

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
    if (refreshDirectoryBaseline) void refreshUnread().catch(() => undefined)
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
  }, [auth?.status, auth?.userId, authRevision, refreshDirectoryBaseline])
}
