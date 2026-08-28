import { useEffect } from 'react'
import type { ArkmeAuthSnapshot, ArkmeBotSummary, ArkmeChatClientEvent } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { forgetNavigationProviderInstance } from './navigation-cache.js'
import { arkmeMessageReadReceipts } from './message-read-receipt-store.js'
import {
  reconcileArkmeProviderInstance, recoverArkmeProviderInstanceDirectory,
} from './provider-instance-runtime.js'
import { arkmeUi } from './ui-controller.js'

export function arkmeSelectedBotAffectedByChatDelta(
  selectedBot: ArkmeBotSummary | undefined,
  update: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }>,
): boolean {
  if (selectedBot?.conversationProjection !== 'chat' || selectedBot.chatSourceKey === undefined) return false
  return update.updates.some(item => item.source.kind === 'private_chat'
    && item.sourceKey === selectedBot.chatSourceKey)
}

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
      arkmeMessageReadReceipts.activateAccount(undefined)
      return
    }
    const authenticatedUserId = auth.userId
    arkmeChatDirectory.activateAccount(authenticatedUserId)
    arkmeMessageReadReceipts.activateAccount(authenticatedUserId)
    let stopped = false
    let observedRevision: number | undefined
    let events: EventSource | undefined
    const updateForeground = () => {
      arkmeMessageReadReceipts.setForeground(typeof document === 'undefined' || document.visibilityState !== 'hidden')
    }
    const reconcileReceipts = () => { arkmeMessageReadReceipts.reconcile() }
    const browserDocument = typeof document === 'undefined' ? undefined : document
    const browserWindow = typeof window === 'undefined' ? undefined : window
    const refreshUnread = async (force = false) => {
      await arkmeChatDirectory.refreshRoot({ force })
    }
    if (refreshDirectoryBaseline) void refreshUnread().catch(() => undefined)
    const handleOpen = () => {
      reconcileReceipts()
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
    const handleMessage = (event: MessageEvent<string>) => {
      if (stopped) return
      try {
        const update = JSON.parse(event.data) as ArkmeChatClientEvent
        if (!Number.isSafeInteger(update.revision) || update.revision < 0
          || (observedRevision !== undefined && update.revision <= observedRevision)) return
        observedRevision = update.revision
        if (update.type === 'reconcile') {
          arkmeInterwovenInvalidation.invalidate()
          reconcileReceipts()
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
          arkmeUi.recordChanged()
          return
        }
        if (update.type === 'read-receipts-invalidated') {
          arkmeMessageReadReceipts.invalidate(update.sourceKey, update.throughSequence)
          return
        }
        if (update.type !== 'sessions-delta') return
        arkmeChatDirectory.upsertMany(update.updates.map(item => ({
          source: item.source,
          ...(item.sourceKey === undefined ? {} : { sourceKey: item.sourceKey }),
        })))
        const timelineUpdates = update.updates
          .filter(item => item.timelineItems.length > 0)
          .map(item => ({ sourceRef: item.source.sourceRef, items: item.timelineItems }))
        if (timelineUpdates.length > 0) arkmeChatTimelineDelta.publish(timelineUpdates)
        if (arkmeSelectedBotAffectedByChatDelta(arkmeUi.getSnapshot().selectedBot, update)) arkmeUi.chatChanged()
        arkmeInterwovenInvalidation.invalidate()
      } catch { /* Ignore malformed local frames; EventSource keeps the channel alive. */ }
    }
    const disconnectEvents = () => {
      events?.close()
      events = undefined
    }
    const connectEvents = () => {
      if (stopped || events !== undefined || browserDocument?.visibilityState === 'hidden') return
      const next = new EventSource('/arkme-self/api/events')
      next.onopen = handleOpen
      next.onmessage = handleMessage
      events = next
    }
    const handleVisibilityChange = () => {
      updateForeground()
      if (browserDocument?.visibilityState === 'hidden') disconnectEvents()
      else connectEvents()
    }
    updateForeground()
    connectEvents()
    browserDocument?.addEventListener('visibilitychange', handleVisibilityChange)
    browserWindow?.addEventListener('focus', reconcileReceipts)
    return () => {
      stopped = true
      disconnectEvents()
      browserDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
      browserWindow?.removeEventListener('focus', reconcileReceipts)
    }
  }, [auth?.status, auth?.userId, authRevision, refreshDirectoryBaseline])
}
