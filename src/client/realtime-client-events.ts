import { useEffect } from 'react'
import type { ArkmeAuthSnapshot, ArkmeBotSummary, ArkmeChatClientEvent } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
import { arkmeAttentionSummary } from './attention-summary-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { forgetNavigationProviderInstance } from './navigation-cache.js'
import { arkmeMessageReadReceipts } from './message-read-receipt-store.js'
import {
  reconcileArkmeProviderInstance, recoverArkmeProviderInstanceDirectory,
} from './provider-instance-runtime.js'
import { arkmeChatSourceIdentityKey } from './source-identity.js'
import { arkmeUi } from './ui-controller.js'

export function arkmeSelectedBotAffectedByChatDelta(
  selectedBot: ArkmeBotSummary | undefined,
  update: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }>,
): boolean {
  if (selectedBot?.conversationProjection !== 'chat' || selectedBot.chatSourceKey === undefined) return false
  return update.updates.some(item => item.source.kind === 'private_chat'
    && item.sourceKey === selectedBot.chatSourceKey)
}

export function arkmeChatDeltaSourceKeys(
  update: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }>,
): string[] {
  return [...new Set(update.updates.map(item => arkmeChatSourceIdentityKey({
    sourceRef: item.source.sourceRef,
    ...(item.sourceKey ?? item.source.sourceKey) === undefined
      ? {}
      : { sourceKey: item.sourceKey ?? item.source.sourceKey },
  })))]
}

export function arkmeChatDeltaCalendarDateStamps(
  update: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }>,
): number[] {
  return [...new Set(update.updates.flatMap(item => [
    item.source.activeAtMillis,
    ...item.timelineItems.map(timelineItem => timelineItem.sendAtMillis),
  ]).filter(value => Number.isFinite(value) && value > 0))]
}

export function arkmeRealtimeTimelineDeliveryAllowed(
  visibilityState: DocumentVisibilityState | undefined,
  hasFocus = true,
): boolean {
  return visibilityState !== 'hidden' && hasFocus
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
      arkmeChatTimelineDelta.activateAccount(undefined)
      arkmeInterwovenInvalidation.activateAccount(undefined)
      arkmeAttentionSummary.activateAccount(undefined)
      arkmeMessageReadReceipts.activateAccount(undefined)
      return
    }
    const authenticatedUserId = auth.userId
    const authenticatedAccountScope = `${auth.environment}:${String(authenticatedUserId)}`
    arkmeChatDirectory.activateAccount(authenticatedAccountScope)
    arkmeChatTimelineDelta.activateAccount(authenticatedAccountScope)
    arkmeInterwovenInvalidation.activateAccount(authenticatedAccountScope)
    arkmeAttentionSummary.activateAccount(authenticatedUserId, authenticatedAccountScope)
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
              accountScope: authenticatedAccountScope,
              activateAccount: scope => { arkmeChatDirectory.activateAccount(scope) },
              refreshRoot: async force => { await refreshUnread(force) },
              onRefreshed: () => {
                if (stopped) return
                arkmeCalendarInvalidations.publishAll()
                arkmeUi.chatChanged()
              },
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
          if (update.attentionSummary !== undefined) arkmeAttentionSummary.apply(update.attentionSummary)
          arkmeInterwovenInvalidation.invalidate()
          reconcileReceipts()
          if (update.refresh === 'none') return
          void refreshUnread(update.refresh === 'force')
            .then(() => {
              if (stopped) return
              arkmeCalendarInvalidations.publishAll()
              arkmeUi.chatChanged()
            })
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
        if (update.type === 'attention-summary') {
          arkmeAttentionSummary.apply(update.summary)
          return
        }
        if (update.type === 'message-notification') {
          void arkmeDesktopNotifications.show(update.notification)
          return
        }
        if (update.type === 'projection-invalidated') {
          if (update.projection !== 'record') return
          arkmeInterwovenInvalidation.invalidate()
          arkmeCalendarInvalidations.publishAll()
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
          .map(item => {
            const sourceKey = item.sourceKey ?? item.source.sourceKey
            return {
              source: {
                sourceRef: item.source.sourceRef,
                ...(sourceKey === undefined ? {} : { sourceKey }),
                ...(item.source.latestSequence === undefined ? {} : { latestSequence: item.source.latestSequence }),
              },
              items: item.timelineItems,
            }
          })
        const foreground = arkmeRealtimeTimelineDeliveryAllowed(
          browserDocument?.visibilityState,
          browserDocument?.hasFocus?.() ?? true,
        )
        if (foreground && timelineUpdates.length > 0) arkmeChatTimelineDelta.publish(timelineUpdates)
        for (const dateStamp of arkmeChatDeltaCalendarDateStamps(update)) {
          arkmeCalendarInvalidations.publish({ dateStamp })
        }
        if (foreground && arkmeSelectedBotAffectedByChatDelta(arkmeUi.getSnapshot().selectedBot, update)) arkmeUi.chatChanged()
        for (const sourceKey of arkmeChatDeltaSourceKeys(update)) arkmeInterwovenInvalidation.invalidate(sourceKey)
      } catch { /* Ignore malformed local frames; EventSource keeps the channel alive. */ }
    }
    const disconnectEvents = () => {
      events?.close()
      events = undefined
    }
    const connectEvents = () => {
      if (stopped || events !== undefined) return
      const next = new EventSource('/arkme-self/api/events')
      next.onopen = handleOpen
      next.onmessage = handleMessage
      events = next
    }
    const handleVisibilityChange = () => {
      updateForeground()
      connectEvents()
      if (browserDocument?.visibilityState !== 'hidden') {
        reconcileReceipts()
        void refreshUnread(true)
          .then(() => { if (!stopped) arkmeUi.chatChanged() })
          .catch(() => undefined)
      }
    }
    updateForeground()
    connectEvents()
    browserDocument?.addEventListener('visibilitychange', handleVisibilityChange)
    const handleWindowFocus = () => {
      reconcileReceipts()
      arkmeUi.chatChanged()
    }
    browserWindow?.addEventListener('focus', handleWindowFocus)
    return () => {
      stopped = true
      disconnectEvents()
      browserDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
      browserWindow?.removeEventListener('focus', handleWindowFocus)
    }
  }, [auth?.environment, auth?.status, auth?.userId, authRevision, refreshDirectoryBaseline])
}
