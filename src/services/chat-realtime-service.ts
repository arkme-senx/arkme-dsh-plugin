import {
  ArkmeChatRealtimeRuntime,
  type ArkmeChatRealtimeNotice,
  type ArkmeChatReceiveHint,
} from '../chat-realtime.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeChatClientEvent,
  ArkmeChatPinProjection,
  ArkmeChatAttentionSummary,
  ArkmeChatRealtimeState,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { arkmeTimelineConversationPreview, SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { arkmeEmojiPlainText, arkmeEmojiTokenSafePrefix } from '../arkme-emoji-text.js'
import {
  ArkmeDesktopAttentionBridge,
  type ArkmeDesktopNotificationDispatchResult,
  type ArkmeDesktopNotificationPayload,
} from './desktop-attention-bridge.js'

export interface ArkmeChatProjectionReader {
  chatTimelineItems(
    data: Record<string, unknown>,
    session: ArkmeSessionCredentials,
    chatSessionUid: string,
    sourceKind?: 'private_chat' | 'group_chat',
  ): Promise<ArkmeTimelineItem[]>
}

export interface ArkmeNativeAttentionDispatcher {
  showNotification(payload: ArkmeDesktopNotificationPayload): Promise<ArkmeDesktopNotificationDispatchResult>
  applyBadgeSummary(summary: { count: number; revision: number }): Promise<boolean>
  resetBadgeCount?(): Promise<boolean>
}

const MAX_PROJECTION_RETRIES = 5
const MAX_ATTENTION_SUMMARY_RETRIES = 5
const MAX_NATIVE_NOTIFICATION_DELIVERY_CONCURRENCY = 3
const MAX_NOTIFICATION_HINTS_PER_TIMELINE_READ = 50
const NOTIFICATION_EXPIRY_MILLIS = 5 * 60_000
const CHAT_NOTIFICATION_DIAGNOSTICS = process.env.ARKME_CHAT_NOTIFICATION_DIAGNOSTICS === '1'

function notificationDiagnostic(event: string, details: Record<string, unknown>): void {
  if (CHAT_NOTIFICATION_DIAGNOSTICS) console.info(`dsh-arkme: ${event}`, details)
}

type ArkmeMessageNotification = Extract<ArkmeChatClientEvent, { type: 'message-notification' }>['notification']

function notificationExpired(candidate: PendingChatNotificationHint, now = Date.now()): boolean {
  return now > candidate.hint.eventAtMillis + NOTIFICATION_EXPIRY_MILLIS
}

function notificationRetryDelay(attempts: number): number {
  if (attempts <= 4) return 200
  return Math.min(5_000, 500 * 2 ** Math.min(4, attempts - 5))
}

export interface PendingChatNotificationHint {
  hint: ArkmeChatReceiveHint
  connectionGeneration: number
  attempts: number
  receivedAtMillis?: number | undefined
  accountUserId?: number | undefined
  accountOwnerGeneration?: number | undefined
  baselinePassed?: boolean | undefined
  resolvedNotification?: ArkmeMessageNotification | undefined
  nextAttemptAtMillis?: number | undefined
}

export interface PendingChatProjection {
  latestSequence: number
  notificationHints: PendingChatNotificationHint[]
  refreshSource?: boolean | undefined
  accountUserId?: number | undefined
  accountOwnerGeneration?: number | undefined
}

interface ArkmeTimelineNotificationIdentity {
  relationUid: string
  itemUid: string
  sequence: number
  senderUserId: number
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function timelineNotificationIdentities(data: Record<string, unknown>): ArkmeTimelineNotificationIdentity[] {
  return listValue(data.items).flatMap(raw => {
    const item = objectValue(raw)
    const relation = objectValue(item.relation)
    const payload = objectValue(objectValue(item.record).payload)
    const identity = {
      relationUid: stringValue(relation.rel_uid ?? relation.relUid).trim(),
      itemUid: stringValue(relation.record_uid ?? relation.recordUid ?? payload.record_uid ?? payload.recordUid).trim(),
      sequence: numberValue(relation.seq ?? relation.sequence),
      senderUserId: numberValue(relation.sender_user_id ?? relation.senderUserId),
    }
    return identity.itemUid !== '' && Number.isSafeInteger(identity.sequence) && identity.sequence > 0
      && Number.isSafeInteger(identity.senderUserId) && identity.senderUserId > 0
      ? [identity] : []
  })
}

function notificationTimelineItem(
  items: readonly ArkmeTimelineItem[],
  identities: readonly ArkmeTimelineNotificationIdentity[],
  hint: ArkmeChatReceiveHint,
): ArkmeTimelineItem | undefined {
  const relationUid = hint.relationUid.trim()
  const exact = relationUid === '' ? undefined : identities.find(candidate =>
    candidate.relationUid === relationUid && candidate.senderUserId === hint.senderUserId)
  const identity = exact ?? identities.find(candidate =>
    (relationUid === '' || candidate.relationUid === '')
      && candidate.sequence === hint.latestSequence
      && candidate.senderUserId === hint.senderUserId)
  return identity === undefined ? undefined : items.find(item => item.itemUid === identity.itemUid
    && item.sequence === identity.sequence && !item.isMe)
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

export class ChatRealtimeService {
  directoryBaseline?: () => Promise<import('../types.js').ArkmeSourceList>
  private disposed = false
  private readonly chatRealtime: ArkmeChatRealtimeRuntime
  private readonly chatClientListeners = new Set<(event: ArkmeChatClientEvent) => void>()
  private readonly pendingChatProjections = new Map<string, PendingChatProjection>()
  private readonly projectionRetryCounts = new Map<string, number>()
  private projectionTimer: ReturnType<typeof setTimeout> | undefined
  private projectionTimerDueAtMillis = 0
  private projectionInFlight = false
  private projectionFailureCount = 0
  private notificationBaselineGeneration = 0
  private notificationBaselineUserId: number | undefined
  private notificationBaselineOwnerGeneration = 0
  private readonly notificationBaselineSequences = new Map<string, number>()
  private connectionBaselineRetryTimer: ReturnType<typeof setTimeout> | undefined
  private connectionBaselineRetryCount = 0
  private chatClientRevision = 0
  private attentionSummaryVersion = 0
  private attentionSummaryFingerprint = ''
  private latestAttentionSummary: ArkmeChatAttentionSummary | undefined
  private attentionOwnerGeneration = 0
  private attentionOwnerUserId: number | undefined
  private attentionRefreshInFlight: Promise<void> | undefined
  private attentionRefreshStarted = false
  private attentionRefreshDirty = false
  private attentionRetryTimer: ReturnType<typeof setTimeout> | undefined
  private attentionRetryCount = 0

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly projectionReader: ArkmeChatProjectionReader,
    private readonly nativeAttention: ArkmeNativeAttentionDispatcher = new ArkmeDesktopAttentionBridge(),
  ) {
    this.chatRealtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: runtime.config.imBaseUrl,
      readSession: async () => await runtime.sessionStore.read(),
      refreshSession: async session => {
        try { return await runtime.refreshAccessToken(session) }
        catch (error) {
          const activeSession = await runtime.sessionStore.read().catch(() => undefined)
          if (activeSession === undefined || activeSession.userId !== session.userId) this.clearAttentionOwner()
          console.warn('dsh-arkme: Chat SSE credential refresh paused:', safeFailureMessage(error))
          return undefined
        }
      },
      fetchImpl: runtime.fetchImpl,
      diagnostic: (event, details) => { console.info(`dsh-arkme: ${event}`, details) },
    })
  }

  reconnect(): void {
    void this.refreshAttentionSummary()
    this.chatRealtime.reconnect()
  }

  dispose(): void {
    this.disposed = true
    if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
    if (this.connectionBaselineRetryTimer !== undefined) clearTimeout(this.connectionBaselineRetryTimer)
    if (this.attentionRetryTimer !== undefined) clearTimeout(this.attentionRetryTimer)
    this.projectionTimer = undefined
    this.projectionTimerDueAtMillis = 0
    this.connectionBaselineRetryTimer = undefined
    this.attentionRetryTimer = undefined
    this.pendingChatProjections.clear()
    this.projectionRetryCounts.clear()
    this.notificationBaselineSequences.clear()
    this.notificationBaselineGeneration = 0
    this.notificationBaselineUserId = undefined
    this.notificationBaselineOwnerGeneration = 0
    this.chatClientListeners.clear()
  }

  startChatRealtime(): () => void {
    void this.refreshAttentionSummary()
    const unsubscribe = this.chatRealtime.subscribe(notice => { this.handleChatRealtimeNotice(notice) })
    const stop = this.chatRealtime.start()
    return () => {
      unsubscribe()
      stop()
      if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
      if (this.connectionBaselineRetryTimer !== undefined) clearTimeout(this.connectionBaselineRetryTimer)
      if (this.attentionRetryTimer !== undefined) clearTimeout(this.attentionRetryTimer)
      this.projectionTimer = undefined
      this.projectionTimerDueAtMillis = 0
      this.connectionBaselineRetryTimer = undefined
      this.attentionRetryTimer = undefined
      this.pendingChatProjections.clear()
      this.projectionRetryCounts.clear()
      this.notificationBaselineSequences.clear()
      this.notificationBaselineGeneration = 0
      this.notificationBaselineUserId = undefined
      this.notificationBaselineOwnerGeneration = 0
    }
  }

  chatRealtimeState(): ArkmeChatRealtimeState {
    return this.chatRealtime.state()
  }

  subscribeChatRealtime(listener: (event: ArkmeChatClientEvent) => void): () => void {
    this.chatClientListeners.add(listener)
    return () => { this.chatClientListeners.delete(listener) }
  }

  chatRealtimeInitialEvent(): ArkmeChatClientEvent {
    const state = this.chatRealtime.state()
    return {
      type: 'reconcile', revision: this.chatClientRevision, connected: state.connected,
      connectionGeneration: state.connectionGeneration,
      refresh: 'if-stale',
      ...(this.latestAttentionSummary === undefined ? {} : { attentionSummary: { ...this.latestAttentionSummary } }),
    }
  }

  handleChatRealtimeNotice(notice: ArkmeChatRealtimeNotice): void {
    if (notice.cause === 'chat-policy-invalidation' && notice.policyUpdated !== undefined) {
      void this.invalidateChatPolicyForCurrentSession(notice)
      return
    }
    if (notice.cause === 'chat-hint' && (notice.memberEvent !== undefined || notice.memberJoined !== undefined)) {
      void this.handleMemberEvent(notice)
      return
    }
    if (notice.cause === 'reconcile') {
      const generation = notice.state.connectionGeneration
      if (notice.connectionUserId !== undefined) this.activateAttentionOwner(notice.connectionUserId)
      this.notificationBaselineGeneration = 0
      this.notificationBaselineUserId = undefined
      this.notificationBaselineOwnerGeneration = 0
      this.notificationBaselineSequences.clear()
      this.connectionBaselineRetryCount = 0
      if (this.connectionBaselineRetryTimer !== undefined) clearTimeout(this.connectionBaselineRetryTimer)
      this.connectionBaselineRetryTimer = undefined
      this.emitChatClientEvent({
        type: 'reconcile', revision: this.nextChatClientRevision(), connected: notice.state.connected,
        connectionGeneration: generation,
        refresh: 'none',
      })
      void this.reconcileChatConnectionBaseline(generation, notice.connectionUserId)
      void this.refreshAttentionSummary()
      void this.invalidateRecordProjection()
      return
    }
    if (notice.cause === 'projection-invalidation'
      && notice.projectionInvalidation?.projection === 'chat.direct_message_admission') {
      this.emitChatClientEvent({ type: 'projection-invalidated', projection: 'chat.direct_message_admission', revision: this.nextChatClientRevision() })
      return
    }
    if (notice.cause === 'projection-invalidation'
      && notice.projectionInvalidation?.projection === 'record') {
      void this.invalidateRecordProjection()
      return
    }
    if (notice.cause === 'conversation-list-preference-invalidation'
      && notice.conversationListPreferenceUpdated !== undefined) {
      void this.invalidateConversationListPreferenceForCurrentSession(
        notice.conversationListPreferenceUpdated.userId,
      )
      return
    }
    if (notice.cause === 'chat-hint' && notice.readCursorAdvanced !== undefined) {
      void this.handleReadCursorAdvanced(notice.readCursorAdvanced)
      return
    }
    if (notice.cause === 'chat-hint' && notice.timelineChanged !== undefined) {
      void this.handleTimelineChanged(notice)
      return
    }
    if (notice.cause === 'chat-hint' && notice.messagePreparing !== undefined) {
      void this.handleChatActorHint(notice)
      return
    }
    if (notice.cause === 'chat-hint' && notice.hint !== undefined) {
      void this.handleChatActorHint(notice)
      this.scheduleMessageNotificationProjection(notice, notice.hint)
    }
  }

  private scheduleMessageNotificationProjection(
    notice: ArkmeChatRealtimeNotice,
    hint: ArkmeChatReceiveHint,
  ): void {
    const receivedAtMillis = Date.now()
    const accountUserId = notice.connectionUserId
    if (accountUserId !== undefined) this.activateAttentionOwner(accountUserId)
    const arrivedAfterConnection = notice.connectionStartedAtMillis !== undefined
      && hint.eventAtMillis >= notice.connectionStartedAtMillis
    const baselinePassed = accountUserId !== undefined
      && (arrivedAfterConnection || (
        this.notificationBaselineUserId === accountUserId
        && this.notificationBaselineOwnerGeneration === this.attentionOwnerGeneration
        && this.notificationBaselineGeneration === notice.state.connectionGeneration
        && hint.latestSequence > (this.notificationBaselineSequences.get(hint.chatSessionUid) ?? 0)
      ))
    notificationDiagnostic('notification_hint_received', {
      eventUid: hint.eventUid,
      connectionGeneration: notice.state.connectionGeneration,
      attempt: 0,
      receivedAtMillis,
    })
    this.scheduleChatSessionProjection(
      hint.chatSessionUid,
      hint.latestSequence,
      accountUserId === undefined ? undefined : {
        hint,
        connectionGeneration: notice.state.connectionGeneration,
        attempts: 0,
        receivedAtMillis,
        accountUserId,
        accountOwnerGeneration: this.attentionOwnerGeneration,
        baselinePassed,
      },
    )
  }

  private async handleChatActorHint(notice: ArkmeChatRealtimeNotice): Promise<void> {
    const hint = notice.messagePreparing ?? notice.hint
    const signal = notice.connectionSignal
    const connectionUserId = notice.connectionUserId
    if (hint === undefined || signal === undefined || connectionUserId === undefined
      || !notice.state.connected || signal.aborted || this.disposed) return
    try {
      const session = await this.runtime.sessionStore.read()
      if (session?.userId !== connectionUserId || signal.aborted || this.disposed) return
      const actorUserId = notice.messagePreparing?.actorUserId ?? notice.hint!.senderUserId
      if (actorUserId === session.userId) return
      const [sourceKey, presentation] = await Promise.all([
        this.source.chatDirectorySourceKey(session.userId, hint.chatSessionUid),
        notice.messagePreparing === undefined
          ? this.source.chatPreparingActorKey(session.userId, hint.chatSessionUid, actorUserId)
            .then(actorKey => ({ actorKey }))
          : this.source.chatPreparingActorPresentation(session.userId, hint.chatSessionUid, actorUserId),
      ])
      if (signal.aborted || this.disposed) return
      const activeSession = await this.runtime.sessionStore.read()
      if (activeSession?.userId !== connectionUserId || signal.aborted || this.disposed) return
      if (notice.messagePreparing !== undefined) {
        const preparing = notice.messagePreparing
        this.emitChatClientEvent({
          type: 'message-preparing', revision: this.nextChatClientRevision(), sourceKey, ...presentation,
          prepareAtMillis: preparing.prepareAtMillis, expireAtMillis: preparing.expireAtMillis,
          preparingState: preparing.preparingState, stateVersion: preparing.stateVersion,
          eventAtMillis: preparing.eventAtMillis,
          chatConnectionGeneration: notice.state.connectionGeneration,
          chatRevision: notice.state.revision,
        })
      } else {
        this.emitChatClientEvent({
          type: 'message-arrived', revision: this.nextChatClientRevision(), sourceKey,
          actorKey: presentation.actorKey, eventAtMillis: hint.eventAtMillis,
          chatConnectionGeneration: notice.state.connectionGeneration,
          chatRevision: notice.state.revision,
        })
      }
    } catch {
      console.warn('dsh-arkme: Chat preparing identity projection failed')
    }
  }

  private async handleTimelineChanged(
    notice: ArkmeChatRealtimeNotice,
  ): Promise<void> {
    const hint = notice.timelineChanged
    if (hint === undefined) return
    const connectionAborted = () => notice.connectionSignal?.aborted === true
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined || connectionAborted() || this.disposed
        || notice.connectionUserId !== undefined && notice.connectionUserId !== session.userId) return
      const [sourceKey, timelineItemKey] = await Promise.all([
        this.source.chatDirectorySourceKey(session.userId, hint.chatSessionUid),
        this.source.chatTimelineItemKey(session.userId, hint.chatSessionUid, hint.relationUid),
      ])
      const activeSession = await this.runtime.sessionStore.read()
      if (activeSession?.userId !== session.userId || connectionAborted() || this.disposed) return
      this.emitChatClientEvent({
        type: 'timeline-changed',
        revision: this.nextChatClientRevision(),
        sourceKey,
        timelineItemKey,
        changeKind: hint.changeKind,
        changeVersion: hint.changeVersion,
        relationTerminal: hint.relationTerminal,
        throughSequence: hint.latestSequence,
      })
      if (hint.changeKind === 'extended') {
        this.scheduleMessageNotificationProjection(notice, {
          eventUid: hint.eventUid,
          chatSessionUid: hint.chatSessionUid,
          relationUid: hint.relationUid,
          latestSequence: hint.latestSequence,
          senderUserId: hint.actorUserId,
          eventAtMillis: hint.eventAtMillis,
        })
      } else {
        this.scheduleChatSessionProjection(hint.chatSessionUid, hint.latestSequence)
      }
      void this.refreshAttentionSummary()
    } catch (error) {
      console.warn('dsh-arkme: Chat timeline invalidation failed:', safeFailureMessage(error))
    }
  }

  private async handleMemberEvent(notice: ArkmeChatRealtimeNotice): Promise<void> {
    const hint = notice.memberJoined ?? notice.memberEvent
    if (hint === undefined || notice.connectionSignal?.aborted) return
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined || (notice.connectionUserId !== undefined && notice.connectionUserId !== session.userId)) return
      this.runtime.invalidateMemberCache?.()
      const sourceKey = await this.source.chatDirectorySourceKey(session.userId, hint.chatSessionUid)
      if (notice.connectionSignal?.aborted || (await this.runtime.sessionStore.read())?.userId !== session.userId) return
      if (notice.memberJoined !== undefined) this.emitChatClientEvent({ type: 'members-invalidated', revision: this.nextChatClientRevision(), sourceKey })
      else this.emitChatClientEvent({ type:'member-events-invalidated', revision:this.nextChatClientRevision(),
        sourceKey, eventId:hint.eventUid, occurredAtMillis:hint.eventAtMillis })
    } catch (error) { console.warn('dsh-arkme: member event hint failed:', safeFailureMessage(error)) }
  }

  private async handleReadCursorAdvanced(hint: NonNullable<ArkmeChatRealtimeNotice['readCursorAdvanced']>): Promise<void> {
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined) return
      if (hint.readerUserId === session.userId) {
        this.scheduleChatSessionProjection(hint.chatSessionUid, hint.readSequence)
        return
      }
      this.emitChatClientEvent({
        type: 'read-receipts-invalidated',
        revision: this.nextChatClientRevision(),
        sourceKey: await this.source.chatDirectorySourceKey(session.userId, hint.chatSessionUid),
        throughSequence: hint.readSequence,
      })
    } catch (error) {
      console.warn('dsh-arkme: Chat read receipt invalidation failed:', safeFailureMessage(error))
    }
  }

  async invalidateRecordProjection(): Promise<void> {
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined) return
      this.source.invalidateSourceListCache(session.userId, 'send_to_self')
      this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'calendar:')
      this.emitChatClientEvent({
        type: 'projection-invalidated',
        revision: this.nextChatClientRevision(),
        projection: 'record',
      })
    } catch (error) {
      console.warn('dsh-arkme: Record projection invalidation failed:', safeFailureMessage(error))
    }
  }

  async refreshAttentionSummary(): Promise<void> {
    const session = await this.runtime.sessionStore.read()
    if (session === undefined) {
      this.clearAttentionOwner()
      this.clearAttentionSummaryRetry()
      return
    }
    this.activateAttentionOwner(session.userId)
    const existing = this.attentionRefreshInFlight
    if (existing !== undefined) {
      if (this.attentionRefreshStarted) this.attentionRefreshDirty = true
      await existing
      return
    }
    // Defer the first read by one microtask so same-turn callers coalesce into
    // one upstream request. Triggers arriving while any read is active mark a
    // trailing refresh; looping until clean guarantees the last raced mutation
    // is covered even when it arrives during a prior trailing read.
    const pending = Promise.resolve().then(async () => {
      do {
        this.attentionRefreshDirty = false
        this.attentionRefreshStarted = true
        await this.refreshAttentionSummarySerial(this.attentionOwnerGeneration)
        this.attentionRefreshStarted = false
      } while (this.attentionRefreshDirty)
    })
    this.attentionRefreshInFlight = pending
    try { await pending }
    finally {
      if (this.attentionRefreshInFlight === pending) {
        this.attentionRefreshInFlight = undefined
        this.attentionRefreshStarted = false
        this.attentionRefreshDirty = false
      }
    }
  }

  private async refreshAttentionSummarySerial(ownerGeneration: number): Promise<void> {
    try {
      if (await this.runtime.sessionStore.read() === undefined) {
        this.clearAttentionSummaryRetry()
        return
      }
      const summary: ArkmeChatAttentionSummary = await this.source.chatUnreadBadgeSummary()
      if (ownerGeneration !== this.attentionOwnerGeneration) return
      const fingerprint = JSON.stringify(summary)
      if (summary.summaryVersion < this.attentionSummaryVersion) {
        const latest = this.latestAttentionSummary
        if (latest !== undefined) {
          const applied = await this.nativeAttention.applyBadgeSummary({
            count: latest.badgeCount,
            revision: latest.summaryVersion,
          })
          if (applied) this.clearAttentionSummaryRetry()
          else this.scheduleAttentionSummaryRetry()
        }
        return
      }
      if (summary.summaryVersion === this.attentionSummaryVersion
        && fingerprint === this.attentionSummaryFingerprint) {
        // Browser already owns this snapshot, but native may have returned
        // native-failed. Reusing the exact generation/revision/count is the
        // idempotent retry contract for the client bridge.
        const applied = await this.nativeAttention.applyBadgeSummary({ count: summary.badgeCount, revision: summary.summaryVersion })
        if (applied) this.clearAttentionSummaryRetry()
        else this.scheduleAttentionSummaryRetry()
        return
      }
      this.attentionSummaryVersion = summary.summaryVersion
      this.attentionSummaryFingerprint = fingerprint
      this.latestAttentionSummary = { ...summary }
      this.emitChatClientEvent({
        type: 'attention-summary',
        revision: this.nextChatClientRevision(),
        summary,
      })
      const applied = await this.nativeAttention.applyBadgeSummary({ count: summary.badgeCount, revision: summary.summaryVersion })
      if (applied) this.clearAttentionSummaryRetry()
      else this.scheduleAttentionSummaryRetry()
    } catch (error) {
      if (await this.runtime.sessionStore.read().catch(() => undefined) === undefined) {
        this.clearAttentionOwner()
        this.clearAttentionSummaryRetry()
        return
      }
      // Attention projection is best-effort and must never make Chat reads,
      // writes, or SSE reconciliation fail.
      console.warn('dsh-arkme: Chat attention summary refresh failed:', safeFailureMessage(error))
      this.scheduleAttentionSummaryRetry()
    }
  }

  private clearAttentionSummaryRetry(): void {
    if (this.attentionRetryTimer !== undefined) clearTimeout(this.attentionRetryTimer)
    this.attentionRetryTimer = undefined
    this.attentionRetryCount = 0
  }

  private scheduleAttentionSummaryRetry(): void {
    if (this.attentionRetryTimer !== undefined || this.attentionRetryCount >= MAX_ATTENTION_SUMMARY_RETRIES) return
    this.attentionRetryCount += 1
    const delay = Math.min(15_000, 1_000 * 2 ** (this.attentionRetryCount - 1))
    this.attentionRetryTimer = setTimeout(() => {
      this.attentionRetryTimer = undefined
      void this.refreshAttentionSummary()
    }, delay)
  }

  private activateAttentionOwner(userId: number): void {
    if (this.attentionOwnerUserId === userId) return
    if (this.attentionOwnerUserId !== undefined) this.resetAttentionSummary()
    this.attentionOwnerUserId = userId
  }

  private clearAttentionOwner(): void {
    if (this.attentionOwnerUserId === undefined) return
    this.resetAttentionSummary()
  }

  resetAttentionSummary(): void {
    this.clearAttentionSummaryRetry()
    void this.nativeAttention.resetBadgeCount?.()
    this.attentionOwnerGeneration += 1
    this.attentionOwnerUserId = undefined
    if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
    this.projectionTimer = undefined
    this.projectionTimerDueAtMillis = 0
    this.pendingChatProjections.clear()
    this.projectionRetryCounts.clear()
    this.projectionFailureCount = 0
    this.notificationBaselineSequences.clear()
    this.notificationBaselineGeneration = 0
    this.notificationBaselineUserId = undefined
    this.notificationBaselineOwnerGeneration = 0
    this.connectionBaselineRetryCount = 0
    if (this.connectionBaselineRetryTimer !== undefined) clearTimeout(this.connectionBaselineRetryTimer)
    this.connectionBaselineRetryTimer = undefined
    const resetVersion = Math.max(Date.now(), this.attentionSummaryVersion + 1)
    this.emitChatClientEvent({
      type: 'attention-summary',
      revision: this.nextChatClientRevision(),
      summary: {
        badgeCount: 0,
        mutedUnreadCount: 0,
        sessionCountWithUnread: 0,
        hasAttention: false,
        summaryVersion: resetVersion,
        updatedAtMillis: resetVersion,
      },
    })
    this.attentionSummaryVersion = 0
    this.attentionSummaryFingerprint = ''
    this.latestAttentionSummary = undefined
  }

  private async invalidateChatPolicyForCurrentSession(notice: ArkmeChatRealtimeNotice): Promise<void> {
    const hint = notice.policyUpdated
    if (this.disposed || hint === undefined || notice.connectionSignal?.aborted
      || notice.connectionUserId !== hint.userId) return
    try {
      const session = await this.runtime.sessionStore.read()
      if (this.disposed || notice.connectionSignal?.aborted || session?.userId !== hint.userId) return
      this.source.invalidateSourceListCache(session.userId, 'root')
      this.emitChatClientEvent({ type: 'chat-policy-invalidated', revision: this.nextChatClientRevision() })
    } catch (error) {
      console.warn('dsh-arkme: Chat policy invalidation failed:', safeFailureMessage(error))
    }
  }

  /** Browser invalidation only; raw source/Bot caches belong to different projections. */
  async invalidateConversationListPreferenceForCurrentSession(expectedUserId?: number): Promise<void> {
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined
        || expectedUserId !== undefined && session.userId !== expectedUserId) return
      this.emitChatClientEvent({
        type: 'conversation-list-preference-invalidated',
        revision: this.nextChatClientRevision(),
      })
    } catch (error) {
      console.warn('dsh-arkme: Conversation-list preference invalidation failed:', safeFailureMessage(error))
    }
  }

  private async reconcileChatConnectionBaseline(
    connectionGeneration: number,
    expectedUserId?: number,
  ): Promise<void> {
    if (this.disposed) return
    try {
      const session = await this.runtime.requireSession()
      if (this.disposed || (expectedUserId !== undefined && session.userId !== expectedUserId)) return
      const initialState = this.chatRealtime.state()
      if (!initialState.connected || initialState.connectionGeneration !== connectionGeneration) return
      expectedUserId = session.userId
      this.activateAttentionOwner(session.userId)
      const ownerGeneration = this.attentionOwnerGeneration
      this.notificationBaselineSequences.clear()
      const sequences = new Map<string, number>()
      const pins: ArkmeChatPinProjection[] = []
      const shared = this.directoryBaseline === undefined ? undefined : await this.directoryBaseline()
      let cursor: string | undefined
      const visited = new Set<string>()
      while (true) {
        const page = shared ?? await this.source.listSources('root', {
          limit: 20, refresh: true, ...(cursor === undefined ? {} : { cursor }),
        })
        const activeSession = await this.runtime.sessionStore.read()
        const state = this.chatRealtime.state()
        if (this.disposed || !state.connected || state.connectionGeneration !== connectionGeneration
          || activeSession?.userId !== session.userId || ownerGeneration !== this.attentionOwnerGeneration) return
        for (const item of page.items) {
          if (item.kind !== 'private_chat' && item.kind !== 'group_chat') continue
          const source = await this.source.openSourceRef(item.sourceRef, session.userId)
          sequences.set(source.ownerRef, item.latestSequence ?? 0)
          if (item.sourceKey !== undefined && item.isPinned !== undefined
            && item.chatPolicyUpdatedAtMillis !== undefined) {
            pins.push({ sourceKey: item.sourceKey, pinned: item.isPinned, policyUpdatedAtMillis: item.chatPolicyUpdatedAtMillis })
          }
        }
        if (shared !== undefined || !page.hasMore) break
        if (page.nextCursor === undefined || visited.has(page.nextCursor)) throw new Error('Notification directory cursor is invalid')
        cursor = page.nextCursor
        visited.add(cursor)
      }
      const activeSession = await this.runtime.sessionStore.read()
      const state = this.chatRealtime.state()
      if (this.disposed || !state.connected || state.connectionGeneration !== connectionGeneration
        || activeSession?.userId !== session.userId
        || ownerGeneration !== this.attentionOwnerGeneration) return
      this.notificationBaselineSequences.clear()
      for (const [uid, sequence] of sequences) this.notificationBaselineSequences.set(uid, sequence)
      this.notificationBaselineGeneration = connectionGeneration
      this.notificationBaselineUserId = session.userId
      this.notificationBaselineOwnerGeneration = ownerGeneration
      this.connectionBaselineRetryCount = 0
      if (pins.length > 0) this.emitChatClientEvent({ type: 'chat-pins-reconciled', revision: this.nextChatClientRevision(), pins })
      console.info('dsh-arkme: reconcile_completed', {
        connectionGeneration,
        sessionCount: sequences.size,
      })
      if (this.pendingChatProjections.size > 0) this.scheduleProjectionFlush(0)
    } catch (error) {
      const activeSession = await this.runtime.sessionStore.read().catch(() => undefined)
      const state = this.chatRealtime.state()
      if (this.disposed || !state.connected || state.connectionGeneration !== connectionGeneration
        || expectedUserId === undefined || activeSession?.userId !== expectedUserId) return
      this.connectionBaselineRetryCount += 1
      const delay = Math.min(15_000, 1_000 * 2 ** Math.min(4, this.connectionBaselineRetryCount - 1))
      console.warn('dsh-arkme: Chat reconnect reconciliation failed:', safeFailureMessage(error))
      this.connectionBaselineRetryTimer = setTimeout(() => {
        this.connectionBaselineRetryTimer = undefined
        void this.reconcileChatConnectionBaseline(connectionGeneration, expectedUserId)
      }, delay)
    }
  }

  scheduleChatSessionProjection(
    chatSessionUid: string,
    latestSequence: number,
    notificationHint?: PendingChatNotificationHint,
  ): void {
    const uid = chatSessionUid.trim()
    if (uid === '') return
    const current = this.pendingChatProjections.get(uid)
    if (latestSequence > (current?.latestSequence ?? 0)) this.projectionRetryCounts.delete(uid)
    const notificationHints = current === undefined ? [] : [...current.notificationHints]
    if (notificationHint !== undefined
      && !notificationHints.some(item => item.hint.eventUid === notificationHint.hint.eventUid)) {
      notificationHints.push(notificationHint)
      if (notificationHints.length > 256) notificationHints.splice(0, notificationHints.length - 256)
    }
    this.pendingChatProjections.set(uid, {
      latestSequence: Math.max(latestSequence, current?.latestSequence ?? 0),
      notificationHints,
      refreshSource: true,
      accountUserId: notificationHint?.accountUserId ?? current?.accountUserId,
      accountOwnerGeneration: notificationHint?.accountOwnerGeneration ?? current?.accountOwnerGeneration,
    })
    this.scheduleProjectionFlush(200)
  }

  private scheduleProjectionFlush(delayMillis: number): void {
    if (this.projectionInFlight || this.disposed) return
    const delay = Math.max(0, Math.trunc(delayMillis))
    const dueAtMillis = Date.now() + delay
    if (this.projectionTimer !== undefined && this.projectionTimerDueAtMillis <= dueAtMillis) return
    if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
    this.projectionTimerDueAtMillis = dueAtMillis
    this.projectionTimer = setTimeout(() => {
      this.projectionTimer = undefined
      this.projectionTimerDueAtMillis = 0
      void this.flushChatSessionProjections()
    }, delay)
  }

  private pendingProjectionRetryDelay(): number {
    const now = Date.now()
    let delay = Number.POSITIVE_INFINITY
    for (const projection of this.pendingChatProjections.values()) {
      if (projection.refreshSource !== false) delay = Math.min(delay, 200)
      for (const candidate of projection.notificationHints) {
        const dueAtMillis = candidate.nextAttemptAtMillis ?? now + notificationRetryDelay(candidate.attempts)
        delay = Math.min(delay, Math.max(0, dueAtMillis - now))
      }
    }
    if (!Number.isFinite(delay)) delay = 200
    if (this.projectionFailureCount === 0) return delay
    const failureDelay = Math.min(5_000, 500 * 2 ** Math.min(3, this.projectionFailureCount - 1))
    return Math.max(delay, Math.max(100, Math.round(failureDelay * (0.8 + Math.random() * 0.4))))
  }

  private async flushChatSessionProjections(): Promise<void> {
    if (this.projectionInFlight || this.pendingChatProjections.size === 0 || this.disposed) return
    const now = Date.now()
    const pending: Array<[string, PendingChatProjection]> = []
    for (const [uid, projection] of [...this.pendingChatProjections]) {
      const liveHints = projection.notificationHints.filter(candidate => !notificationExpired(candidate, now))
      const dueHints = liveHints.filter(candidate => (candidate.nextAttemptAtMillis ?? 0) <= now)
      const unresolvedDueEventUids = new Set(dueHints
        .filter(candidate => candidate.resolvedNotification === undefined)
        .sort((left, right) => left.hint.latestSequence - right.hint.latestSequence)
        .slice(0, MAX_NOTIFICATION_HINTS_PER_TIMELINE_READ)
        .map(candidate => candidate.hint.eventUid))
      const notificationHints = dueHints.filter(candidate => candidate.resolvedNotification !== undefined
        || unresolvedDueEventUids.has(candidate.hint.eventUid))
      const selectedEventUids = new Set(notificationHints.map(candidate => candidate.hint.eventUid))
      const deferredHints = liveHints.filter(candidate => !selectedEventUids.has(candidate.hint.eventUid))
      if (projection.refreshSource === false && notificationHints.length === 0) {
        if (liveHints.length === 0) this.pendingChatProjections.delete(uid)
        else this.pendingChatProjections.set(uid, { ...projection, notificationHints: liveHints })
        continue
      }
      this.pendingChatProjections.delete(uid)
      if (deferredHints.length > 0) {
        this.pendingChatProjections.set(uid, {
          ...projection,
          notificationHints: deferredHints,
          refreshSource: false,
        })
      }
      pending.push([uid, { ...projection, notificationHints }])
      if (pending.length >= 50) break
    }
    if (pending.length === 0) {
      if (this.pendingChatProjections.size > 0) this.scheduleProjectionFlush(this.pendingProjectionRetryDelay())
      return
    }
    this.projectionInFlight = true
    try {
      const failed = await this.refreshChatSessionProjectionBatch(pending)
      for (const [uid] of pending) {
        if (!failed.some(([failedUid]) => failedUid === uid)) this.projectionRetryCounts.delete(uid)
      }
      if (failed.length === 0) {
        this.projectionFailureCount = 0
      } else {
        this.projectionFailureCount += 1
        this.requeueProjectionFailures(failed)
      }
    } catch (error) {
      console.warn('dsh-arkme: Chat incremental projection failed:', safeFailureMessage(error))
      this.projectionFailureCount += 1
      this.requeueProjectionFailures(pending)
    } finally {
      this.projectionInFlight = false
      if (this.pendingChatProjections.size > 0) this.scheduleProjectionFlush(this.pendingProjectionRetryDelay())
    }
  }

  private requeueProjectionFailures(failed: Array<[string, PendingChatProjection]>): void {
    for (const [uid, projection] of failed) {
      if (projection.accountUserId !== undefined
        && (projection.accountUserId !== this.attentionOwnerUserId
          || projection.accountOwnerGeneration !== this.attentionOwnerGeneration)) continue
      const retries = (this.projectionRetryCounts.get(uid) ?? 0) + 1
      const notificationHints = projection.notificationHints.filter(candidate => !notificationExpired(candidate))
      if (retries > MAX_PROJECTION_RETRIES && notificationHints.length === 0) {
        this.projectionRetryCounts.delete(uid)
        console.warn('dsh-arkme: Chat projection retry exhausted for one session')
        continue
      }
      this.projectionRetryCounts.set(uid, Math.min(MAX_PROJECTION_RETRIES, retries))
      this.mergePendingChatProjection(uid, { ...projection, notificationHints })
    }
  }

  private mergePendingChatProjection(uid: string, incoming: PendingChatProjection): void {
    if (incoming.accountUserId !== undefined
      && (incoming.accountUserId !== this.attentionOwnerUserId
        || incoming.accountOwnerGeneration !== this.attentionOwnerGeneration)) return
    const current = this.pendingChatProjections.get(uid)
    if (current === undefined) {
      this.pendingChatProjections.set(uid, {
        latestSequence: incoming.latestSequence,
        notificationHints: [...incoming.notificationHints],
        refreshSource: incoming.refreshSource,
        accountUserId: incoming.accountUserId,
        accountOwnerGeneration: incoming.accountOwnerGeneration,
      })
      return
    }
    if (current.accountUserId !== undefined && incoming.accountUserId !== undefined
      && current.accountUserId !== incoming.accountUserId) {
      this.pendingChatProjections.set(uid, {
        latestSequence: incoming.latestSequence,
        notificationHints: [...incoming.notificationHints],
        refreshSource: incoming.refreshSource,
        accountUserId: incoming.accountUserId,
        accountOwnerGeneration: incoming.accountOwnerGeneration,
      })
      return
    }
    const byEventUid = new Map(current.notificationHints.map(item => [item.hint.eventUid, item]))
    for (const item of incoming.notificationHints) {
      const existing = byEventUid.get(item.hint.eventUid)
      byEventUid.set(item.hint.eventUid, existing === undefined ? item : {
        ...existing,
        attempts: Math.max(existing.attempts, item.attempts),
        baselinePassed: existing.baselinePassed === true || item.baselinePassed === true,
        accountUserId: existing.accountUserId ?? item.accountUserId,
        accountOwnerGeneration: existing.accountOwnerGeneration ?? item.accountOwnerGeneration,
        receivedAtMillis: existing.receivedAtMillis ?? item.receivedAtMillis,
        resolvedNotification: existing.resolvedNotification ?? item.resolvedNotification,
        nextAttemptAtMillis: Math.max(existing.nextAttemptAtMillis ?? 0, item.nextAttemptAtMillis ?? 0) || undefined,
      })
    }
    this.pendingChatProjections.set(uid, {
      latestSequence: Math.max(current.latestSequence, incoming.latestSequence),
      notificationHints: [...byEventUid.values()].slice(-256),
      refreshSource: current.refreshSource !== false || incoming.refreshSource !== false,
      accountUserId: current.accountUserId ?? incoming.accountUserId,
      accountOwnerGeneration: current.accountOwnerGeneration ?? incoming.accountOwnerGeneration,
    })
  }

  async refreshChatSessionProjectionBatch(
    pending: Array<[string, PendingChatProjection]>,
  ): Promise<Array<[string, PendingChatProjection]>> {
    const session = await this.runtime.requireSession()
    this.activateAttentionOwner(session.userId)
    const ownerGeneration = this.attentionOwnerGeneration
    pending = pending.filter(([, projection]) => {
      projection.accountUserId ??= projection.notificationHints.find(item => item.accountUserId !== undefined)
        ?.accountUserId ?? session.userId
      projection.accountOwnerGeneration ??= projection.notificationHints
        .find(item => item.accountOwnerGeneration !== undefined)?.accountOwnerGeneration ?? ownerGeneration
      return projection.accountUserId === session.userId
        && projection.accountOwnerGeneration === ownerGeneration
    })
    if (pending.length === 0) return []
    for (const [uid, projection] of pending) {
      if (projection.refreshSource === false
        && this.source.cachedChatSourceByKey(`${String(session.userId)}:${uid}`) === undefined) {
        projection.refreshSource = true
      }
    }
    const sourcePending = pending.filter(([, projection]) => projection.refreshSource !== false)
    const bundles = new Map<string, Record<string, unknown>>()
    if (sourcePending.length > 0) {
      const sessionUids = sourcePending.map(([uid]) => uid).sort()
      const projectionBatchKey = sessionUids.join('|')
      const displayData = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/display-snapshots', { chat_session_uids: sessionUids }, session,
        undefined,
        {
          lane: sourcePending.some(([, projection]) => projection.notificationHints.length > 0)
            ? 'interactive-read' : 'background-read',
          key: `projection:display:${projectionBatchKey}`,
        },
      )
      for (const raw of listValue(displayData.items)) {
        const bundle = objectValue(raw)
        const uid = stringValue(objectValue(bundle.session).chat_session_uid).trim()
        if (uid !== '') bundles.set(uid, bundle)
      }
    }
    const tailItemsByUid = new Map<string, {
      items: ArkmeTimelineItem[]
      notificationIdentities: ArkmeTimelineNotificationIdentity[]
    }>()
    const failedUids = new Set<string>()
    const timelinePending = pending.filter(([, projection]) => projection.refreshSource !== false
      || projection.notificationHints.some(candidate => candidate.resolvedNotification === undefined))
    for (let offset = 0; offset < timelinePending.length; offset += 3) {
      const chunk = timelinePending.slice(offset, offset + 3)
      const results = await Promise.allSettled(chunk.map(async ([uid, projection]) => {
        const cached = this.source.cachedChatSourceByKey(`${String(session.userId)}:${uid}`)
        const unresolvedHints = projection.notificationHints
          .filter(candidate => candidate.resolvedNotification === undefined)
        const firstHintSequence = unresolvedHints.reduce(
          (minimum, item) => Math.min(minimum, item.hint.latestSequence),
          projection.latestSequence,
        )
        const requiredAfterSequence = Math.max(0, firstHintSequence - 1)
        const afterSequence = Math.max(0, Math.min(cached?.latestSequence ?? requiredAfterSequence, requiredAfterSequence))
        const notificationAttempt = unresolvedHints.reduce(
          (maximum, item) => Math.max(maximum, item.attempts),
          0,
        )
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chat/timeline/tail', { chat_session_uid: uid, after_seq: afterSequence, limit: 50 }, session,
          undefined,
          {
            lane: projection.notificationHints.length > 0 ? 'interactive-read' : 'background-read',
            key: `projection:tail:${uid}:${String(afterSequence)}:${String(notificationAttempt)}`,
          },
        )
        const bundle = bundles.get(uid)
        const sessionKind = numberValue(objectValue(bundle).session_kind
          ?? objectValue(objectValue(bundle).session).session_kind)
        const sourceKind = sessionKind === 2 ? 'group_chat'
          : sessionKind === 1 || sessionKind === 3 ? 'private_chat'
            : cached?.kind === 'group_chat' || cached?.kind === 'private_chat' ? cached.kind : undefined
        return [uid, {
          items: await this.projectionReader.chatTimelineItems(
            data,
            session,
            uid,
            sourceKind,
          ),
          notificationIdentities: timelineNotificationIdentities(data),
        }] as const
      }))
      results.forEach((result, index) => {
        const uid = chunk[index]?.[0]
        if (uid === undefined) return
        if (result.status === 'fulfilled') tailItemsByUid.set(result.value[0], result.value[1])
        else failedUids.add(uid)
      })
    }
    if (ownerGeneration !== this.attentionOwnerGeneration) return []
    const updates: Array<{ sourceKey: string; source: ArkmeSourceItem; timelineItems: ArkmeTimelineItem[] }> = []
    const sidebarNotificationHints: Array<{ uid: string; candidate: PendingChatNotificationHint }> = []
    const notifications: Array<{
      notification: ArkmeMessageNotification
      candidate: PendingChatNotificationHint
      uid: string
      latestSequence: number
    }> = []
    for (const [uid, projection] of pending) {
      const bundle = bundles.get(uid)
      if ((projection.refreshSource !== false && bundle === undefined) || failedUids.has(uid)) {
        failedUids.add(uid)
        continue
      }
      const cacheKey = `${String(session.userId)}:${uid}`
      const timelineProjection = tailItemsByUid.get(uid)
      const timelineItems = timelineProjection?.items ?? []
      try {
        const cachedSource = this.source.cachedChatSourceByKey(cacheKey)
        const source = projection.refreshSource === false
          ? cachedSource
          : await this.source.chatSourceFromBundle(bundle!, session, cachedSource, timelineItems)
        if (source === undefined) {
          this.mergePendingChatProjection(uid, { ...projection, refreshSource: true })
          failedUids.add(uid)
          continue
        }
        if (ownerGeneration !== this.attentionOwnerGeneration) return []
        if (projection.refreshSource !== false) this.source.setChatSourceByKey(cacheKey, source)
        const sourceKey = source.sourceKey ?? await this.source.chatDirectorySourceKey(session.userId, uid)
        if (ownerGeneration !== this.attentionOwnerGeneration) return []
        if (projection.refreshSource !== false) {
          updates.push({ sourceKey, source, timelineItems })
          for (const candidate of projection.notificationHints.filter(item => item.attempts === 0)) {
            sidebarNotificationHints.push({ uid, candidate })
          }
        }
        if (source.kind === 'private_chat' || source.kind === 'group_chat') {
          for (const candidate of projection.notificationHints
            .sort((left, right) => left.hint.latestSequence - right.hint.latestSequence)) {
            const state = this.chatRealtime.state()
            let liveCandidate = candidate
            if (candidate.baselinePassed === true) {
              if (candidate.accountUserId !== session.userId
                || candidate.accountOwnerGeneration !== ownerGeneration) continue
            } else {
              if (candidate.accountUserId !== undefined && candidate.accountUserId !== session.userId) continue
              if (candidate.connectionGeneration !== state.connectionGeneration) continue
              if (this.notificationBaselineGeneration !== candidate.connectionGeneration
                || this.notificationBaselineUserId !== session.userId) {
                this.mergePendingChatProjection(uid, {
                  latestSequence: projection.latestSequence,
                  notificationHints: [{ ...candidate, nextAttemptAtMillis: Date.now() + 200 }],
                  refreshSource: false,
                  accountUserId: session.userId,
                  accountOwnerGeneration: ownerGeneration,
                })
                continue
              }
              const baselineSequence = this.notificationBaselineSequences.get(uid) ?? 0
              if (candidate.hint.latestSequence <= baselineSequence) continue
              liveCandidate = {
                ...candidate,
                accountUserId: session.userId,
                accountOwnerGeneration: ownerGeneration,
                baselinePassed: true,
              }
            }
            if (candidate.hint.senderUserId === session.userId || source.notificationAllowed !== true) continue
            let notification = liveCandidate.resolvedNotification
            if (notification === undefined) {
              const message = notificationTimelineItem(
                timelineItems,
                timelineProjection?.notificationIdentities ?? [],
                candidate.hint,
              )
              if (message === undefined) {
                const attempts = candidate.attempts + 1
                this.mergePendingChatProjection(uid, {
                  latestSequence: projection.latestSequence,
                  notificationHints: [{
                    ...liveCandidate,
                    attempts,
                    nextAttemptAtMillis: Date.now() + notificationRetryDelay(attempts),
                  }],
                  refreshSource: false,
                  accountUserId: session.userId,
                  accountOwnerGeneration: ownerGeneration,
                })
                continue
              }
              const richPreview = arkmeTimelineConversationPreview(message)
              const body = arkmeEmojiPlainText(arkmeEmojiTokenSafePrefix(
                source.kind === 'group_chat' ? `${message.senderName}：${richPreview}` : richPreview,
                120,
              ))
              notification = {
                eventUid: candidate.hint.eventUid,
                sourceRef: source.sourceRef,
                sourceKey,
                sourceKind: source.kind,
                title: source.displayName,
                body,
                eventAtMillis: candidate.hint.eventAtMillis,
              }
              liveCandidate = { ...liveCandidate, resolvedNotification: notification }
            }
            notifications.push({ notification, candidate: liveCandidate, uid, latestSequence: projection.latestSequence })
          }
        }
      } catch {
        failedUids.add(uid)
      }
    }
    if (ownerGeneration !== this.attentionOwnerGeneration) return []
    if (updates.length > 0) {
      this.source.invalidateSourceListCache(session.userId, 'root')
      this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'calendar:')
      this.emitChatClientEvent({
        type: 'sessions-delta',
        revision: this.nextChatClientRevision(),
        updates,
      })
      const emittedAtMillis = Date.now()
      for (const { candidate } of sidebarNotificationHints) {
        notificationDiagnostic('notification_sidebar_delta_emitted', {
          eventUid: candidate.hint.eventUid,
          connectionGeneration: candidate.connectionGeneration,
          attempt: candidate.attempts,
          emittedAtMillis,
          ...(candidate.receivedAtMillis === undefined ? {} : {
            durationFromHintMillis: Math.max(0, emittedAtMillis - candidate.receivedAtMillis),
          }),
        })
      }
      void this.refreshAttentionSummary()
    }
    const deliveries: Array<{
      entry: (typeof notifications)[number]
      fallbackToBrowser: boolean
      outcome: ArkmeDesktopNotificationDispatchResult['outcome'] | 'exception'
    }> = []
    for (let offset = 0; offset < notifications.length; offset += MAX_NATIVE_NOTIFICATION_DELIVERY_CONCURRENCY) {
      const chunk = notifications.slice(offset, offset + MAX_NATIVE_NOTIFICATION_DELIVERY_CONCURRENCY)
      deliveries.push(...await Promise.all(chunk.map(async entry => {
        const { notification, candidate } = entry
        if (ownerGeneration !== this.attentionOwnerGeneration) {
          return { entry, fallbackToBrowser: false, outcome: 'exception' as const }
        }
        const dispatchStartedAtMillis = Date.now()
        try {
          const outcome = await this.nativeAttention.showNotification({
            idempotencyKey: notification.eventUid,
            kind: 'chat.message',
            occurredAtMillis: notification.eventAtMillis,
            expiresAtMillis: notification.eventAtMillis + NOTIFICATION_EXPIRY_MILLIS,
            presentation: { title: notification.title, body: notification.body },
            activation: {
              kind: 'chat-source',
              sourceRef: notification.sourceRef,
              sourceKey: notification.sourceKey,
            },
          })
          const completedAtMillis = Date.now()
          notificationDiagnostic('notification_native_dispatch_completed', {
            eventUid: notification.eventUid,
            connectionGeneration: candidate.connectionGeneration,
            attempt: candidate.attempts,
            outcome: outcome.outcome,
            completedAtMillis,
            dispatchDurationMillis: Math.max(0, completedAtMillis - dispatchStartedAtMillis),
            ...(candidate.receivedAtMillis === undefined ? {} : {
              durationFromHintMillis: Math.max(0, completedAtMillis - candidate.receivedAtMillis),
            }),
          })
          return { entry, fallbackToBrowser: outcome.fallbackToBrowser, outcome: outcome.outcome }
        } catch {
          // Retry only the same idempotency key; an uncertain native attempt must
          // never fan out into a second Browser delivery.
          const completedAtMillis = Date.now()
          notificationDiagnostic('notification_native_dispatch_completed', {
            eventUid: notification.eventUid,
            connectionGeneration: candidate.connectionGeneration,
            attempt: candidate.attempts,
            outcome: 'exception',
            completedAtMillis,
            dispatchDurationMillis: Math.max(0, completedAtMillis - dispatchStartedAtMillis),
            ...(candidate.receivedAtMillis === undefined ? {} : {
              durationFromHintMillis: Math.max(0, completedAtMillis - candidate.receivedAtMillis),
            }),
          })
          return { entry, fallbackToBrowser: false, outcome: 'exception' as const }
        }
      })))
    }
    if (ownerGeneration !== this.attentionOwnerGeneration) return []
    for (const { entry, fallbackToBrowser, outcome } of deliveries) {
      const { notification, candidate, uid, latestSequence } = entry
      if (outcome === 'native-failed' || outcome === 'rate-limited' || outcome === 'exception') {
        if (!notificationExpired(candidate)) {
          const attempts = candidate.attempts + 1
          this.mergePendingChatProjection(uid, {
            latestSequence,
            notificationHints: [{
              ...candidate,
              attempts,
              nextAttemptAtMillis: Date.now() + notificationRetryDelay(attempts),
            }],
            refreshSource: false,
            accountUserId: session.userId,
            accountOwnerGeneration: ownerGeneration,
          })
        }
        continue
      }
      if (!fallbackToBrowser) continue
      this.emitChatClientEvent({
        type: 'message-notification',
        revision: this.nextChatClientRevision(),
        notification,
      })
    }
    return pending.filter(([uid]) => failedUids.has(uid))
  }

  emitChatClientEvent(event: ArkmeChatClientEvent): void {
    for (const listener of [...this.chatClientListeners]) listener(event)
  }

  nextChatClientRevision(): number {
    this.chatClientRevision += 1
    return this.chatClientRevision
  }
}
