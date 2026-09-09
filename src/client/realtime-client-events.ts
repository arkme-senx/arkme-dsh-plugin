import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { arkmeConversationMembers } from './conversation-members-store.js'
import { useEffect } from 'react'
import { publishMemberEventHint } from './member-event-hints.js'
import { arkmeMemberEvents } from './member-event-cache.js'
import { invalidateDirectMessageAdmission } from './direct-message-admission.js'
import { privateChatActions } from './private-chat-actions-store.js'
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
import { arkmeMessagePreparing } from './message-preparing-store.js'
import {
  reconcileArkmeProviderInstance, recoverArkmeProviderInstanceDirectory,
} from './provider-instance-runtime.js'
import { arkmeChatSourceIdentityKey } from './source-identity.js'
import { arkmeUi } from './ui-controller.js'
import { connectArkmeRealtime } from './realtime-connection.js'

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
  { ownsMessagePreparing = false }: { ownsMessagePreparing?: boolean } = {},
): void {
  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [authRevision])

  useEffect(() => {
    if (auth?.status !== 'authenticated' || auth.userId === undefined) {
      privateChatActions.activateAccount(undefined)
      arkmeConversationMembers.activateAccount(undefined)
      arkmeMemberEvents.activateAccount(undefined)
      arkmeChatDirectory.activateAccount(undefined)
      arkmeChatTimelineDelta.activateAccount(undefined)
      arkmeInterwovenInvalidation.activateAccount(undefined)
      arkmeAttentionSummary.activateAccount(undefined)
      arkmeMessageReadReceipts.activateAccount(undefined)
      if (ownsMessagePreparing) arkmeMessagePreparing.activateAccount(undefined)
      return
    }
    const authenticatedUserId = auth.userId
    const authenticatedAccountScope = `${auth.environment}:${String(authenticatedUserId)}`
    privateChatActions.activateAccount(authenticatedAccountScope)
    arkmeConversationMembers.activateAccount(authenticatedAccountScope)
    arkmeMemberEvents.activateAccount(authenticatedAccountScope)
    arkmeChatDirectory.activateAccount(authenticatedAccountScope)
    arkmeChatTimelineDelta.activateAccount(authenticatedAccountScope)
    arkmeInterwovenInvalidation.activateAccount(authenticatedAccountScope)
    arkmeAttentionSummary.activateAccount(authenticatedUserId, authenticatedAccountScope)
    arkmeMessageReadReceipts.activateAccount(authenticatedUserId, authenticatedAccountScope)
    // Only the persistent runtime owns transient presence; optional surfaces must not clear it.
    if (ownsMessagePreparing) arkmeMessagePreparing.activateAccount(authenticatedAccountScope)
    let stopped = false
    let observedRevision: number | undefined
    let providerInstanceId: string | undefined
    let awaitingBaseline = false
    let connectionGeneration = 0
    let handledInstanceGeneration = 0
    let localReconnectGap = false
    let recoveryController: AbortController | undefined
    let lastAttentionDiagnosticAt = 0
    const diagnoseAttention = (reason: string, update: ArkmeChatClientEvent) => {
      if (update.type !== 'attention-summary' && update.type !== 'reconcile') return
      try {
        if (typeof localStorage === 'undefined' || localStorage.getItem('arkme:attention-diagnostics') !== '1') return
        const now = Date.now()
        if (now - lastAttentionDiagnosticAt < 1000) return
        lastAttentionDiagnosticAt = now
        const summary = update.type === 'attention-summary' ? update.summary : update.attentionSummary
        console.info('dsh-arkme: attention_browser', { reason, accountScope: authenticatedAccountScope,
          providerInstanceId: update.providerInstanceId, revision: update.revision,
          summaryVersion: summary?.summaryVersion, badgeCount: summary?.badgeCount,
          directoryBadgeCount: arkmeChatDirectory.totalBadgeUnreadCount(authenticatedAccountScope) })
      } catch { /* Optional diagnostics cannot affect event delivery. */ }
    }
    let events: ReturnType<typeof connectArkmeRealtime> | undefined
    const updateForeground = () => {
      arkmeConversationMembers.setForeground(typeof document === 'undefined' || document.visibilityState !== 'hidden')
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
      if (stopped) return
      const generation = ++connectionGeneration
      localReconnectGap = observedRevision !== undefined
      recoveryController?.abort()
      const recovery = new AbortController()
      recoveryController = recovery
      awaitingBaseline = true
      if (ownsMessagePreparing) arkmeMessagePreparing.reset()
      reconcileReceipts()
      arkmeConversationMembers.refreshActive()
      invalidateDirectMessageAdmission()
      void reconcileArkmeProviderInstance()
        .then(async changed => {
          if (!changed || stopped || generation !== connectionGeneration || recovery.signal.aborted) return
          if (handledInstanceGeneration === generation) return
          if (providerInstanceId !== undefined && !awaitingBaseline) {
            // A stamped baseline already established the current owner; only revalidate its cache.
            await refreshUnread(true)
            return
          }
          observedRevision = undefined
          arkmeConversationMembers.reset()
          try {
            await recoverArkmeProviderInstanceDirectory({
              accountScope: authenticatedAccountScope,
              signal: recovery.signal,
              activateAccount: scope => { arkmeChatDirectory.activateAccount(scope) },
              refreshRoot: async force => { await refreshUnread(force) },
              onRefreshed: () => {
                if (stopped || recovery.signal.aborted || generation !== connectionGeneration) return
                arkmeCalendarInvalidations.publishAll()
                arkmeUi.chatChanged()
              },
            })
          } catch (error) {
            if (!stopped && !recovery.signal.aborted && generation === connectionGeneration) forgetNavigationProviderInstance()
            throw error
          }
        })
        .catch(() => undefined)
    }
    const handleMessage = (event: MessageEvent<string>) => {
      if (stopped) return
      try {
        const update = JSON.parse(event.data) as ArkmeChatClientEvent
        if (!Number.isSafeInteger(update.revision) || update.revision < 0) return
        if (update.providerInstanceId !== undefined && (typeof update.providerInstanceId !== 'string'
          || update.providerInstanceId.length === 0 || update.providerInstanceId.length > 160)) return
        if (update.providerInstanceId !== undefined) {
          if (awaitingBaseline || providerInstanceId === undefined) {
            if (update.type !== 'reconcile') { diagnoseAttention('awaiting-baseline', update); return }
            if (providerInstanceId !== update.providerInstanceId) {
              if (providerInstanceId !== undefined) {
                handledInstanceGeneration = connectionGeneration
                arkmeChatDirectory.activateAccount(undefined)
                arkmeChatDirectory.activateAccount(authenticatedAccountScope)
                void refreshUnread(true).catch(() => undefined)
              }
              observedRevision = undefined
              arkmeAttentionSummary.clear()
            }
            providerInstanceId = update.providerInstanceId
            awaitingBaseline = false
          } else if (update.providerInstanceId !== providerInstanceId) { diagnoseAttention('old-instance', update); return }
        }
        if (observedRevision !== undefined && update.revision <= observedRevision) { diagnoseAttention('old-revision', update); return }
        observedRevision = update.revision
        diagnoseAttention('accepted', update)
        if (update.type === 'directory-update') {
          arkmeChatDirectory.applyHostPage(update.page)
          if (update.page.projection?.avatarRefs !== undefined) void arkmeAvatarImages.revalidateActive(update.page.projection.avatarRefs)
          return
        }
        if (update.type === 'members-invalidated') {
          arkmeConversationMembers.invalidate(authenticatedAccountScope, { sourceKey: update.sourceKey, sourceRef: '' })
          return
        }
        if (update.type === 'member-events-invalidated') {
          arkmeConversationMembers.invalidate(authenticatedAccountScope, { sourceKey: update.sourceKey, sourceRef: '' })
          publishMemberEventHint({ account:authenticatedAccountScope, sourceKey:update.sourceKey,
            eventId:update.eventId, occurredAtMillis:update.occurredAtMillis })
          return
        }
        if (update.type === 'message-preparing') {
          if (ownsMessagePreparing) arkmeMessagePreparing.apply(update)
          return
        }
        if (update.type === 'message-arrived') {
          if (ownsMessagePreparing) arkmeMessagePreparing.messageArrived(update)
          return
        }
        if (update.type === 'reconcile') {
          if (ownsMessagePreparing) arkmeMessagePreparing.reset()
          if (update.attentionSummary !== undefined) arkmeAttentionSummary.apply(update.attentionSummary)
          arkmeInterwovenInvalidation.invalidate()
          reconcileReceipts()
          invalidateDirectMessageAdmission()
          if (update.refresh === 'none') return
          if (update.refresh === 'if-stale' && localReconnectGap && handledInstanceGeneration !== connectionGeneration) {
            // A short local connection gap may lose deltas even while the Browser's time-based cache is fresh.
            // Read the Host's current cached directory; the Host already owns upstream reconciliation.
            arkmeChatDirectory.invalidateRoot()
          }
          localReconnectGap = false
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
          if (update.projection === 'chat.direct_message_admission') { invalidateDirectMessageAdmission(); return }
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
        if (update.type === 'timeline-changed') {
          arkmeChatTimelineDelta.applyTimelineChange(update)
          arkmeInterwovenInvalidation.invalidate(update.sourceKey)
          arkmeCalendarInvalidations.publishAll()
          return
        }
        if (update.type === 'chat-pins-reconciled') {
          arkmeChatDirectory.reconcilePins(update.pins)
          return
        }
        if (update.type === 'chat-policy-invalidated') {
          arkmeChatDirectory.invalidateRoot()
          void arkmeChatDirectory.refreshRoot({ force: true, silent: true }).catch(() => undefined)
          return
        }
        if (update.type === 'conversation-list-preference-invalidated') {
          arkmeUi.chatChanged()
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
      } catch { /* Ignore malformed local frames; transport keeps the channel alive. */ }
    }
    const disconnectEvents = () => {
      events?.close()
      events = undefined
    }
    const connectEvents = () => {
      if (stopped || events !== undefined) return
      events = connectArkmeRealtime({
        onOpen: handleOpen,
        onMessage: handleMessage,
        onDisconnect: () => { if (!stopped && ownsMessagePreparing) arkmeMessagePreparing.reset() },
      })
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
    const recoverDirectory = () => {
      if (!ownsMessagePreparing) return
      if (browserWindow?.navigator?.onLine === false) return
      void refreshUnread(true).catch(() => undefined)
    }
    browserWindow?.addEventListener('online', recoverDirectory)
    const handleWindowFocus = () => {
      if (ownsMessagePreparing) recoverDirectory()
      arkmeConversationMembers.refreshActive()
      reconcileReceipts()
      arkmeUi.chatChanged()
    }
    browserWindow?.addEventListener('focus', handleWindowFocus)
    return () => {
      stopped = true
      recoveryController?.abort()
      if (ownsMessagePreparing) arkmeMessagePreparing.reset()
      disconnectEvents()
      browserDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
      browserWindow?.removeEventListener('focus', handleWindowFocus)
      browserWindow?.removeEventListener('online', recoverDirectory)
    }
  }, [auth?.environment, auth?.status, auth?.userId, authRevision, refreshDirectoryBaseline, ownsMessagePreparing])
}
