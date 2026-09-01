import {
  ArkmeChatRealtimeRuntime,
  type ArkmeChatRealtimeNotice,
  type ArkmeChatReceiveHint,
} from '../chat-realtime.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeChatClientEvent,
  ArkmeChatAttentionSummary,
  ArkmeChatRealtimeState,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
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

export interface PendingChatNotificationHint {
  hint: ArkmeChatReceiveHint
  connectionGeneration: number
  attempts: number
}

export interface PendingChatProjection {
  latestSequence: number
  notificationHints: PendingChatNotificationHint[]
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

export class ChatRealtimeService {
  private readonly chatRealtime: ArkmeChatRealtimeRuntime
  private readonly chatClientListeners = new Set<(event: ArkmeChatClientEvent) => void>()
  private readonly pendingChatProjections = new Map<string, PendingChatProjection>()
  private readonly projectionRetryCounts = new Map<string, number>()
  private projectionTimer: ReturnType<typeof setTimeout> | undefined
  private projectionInFlight = false
  private projectionFailureCount = 0
  private notificationBaselineGeneration = 0
  private readonly notificationBaselineSequences = new Map<string, number>()
  private notificationBaselineRetryTimer: ReturnType<typeof setTimeout> | undefined
  private notificationBaselineRetryCount = 0
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
    if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
    if (this.notificationBaselineRetryTimer !== undefined) clearTimeout(this.notificationBaselineRetryTimer)
    if (this.attentionRetryTimer !== undefined) clearTimeout(this.attentionRetryTimer)
    this.projectionTimer = undefined
    this.notificationBaselineRetryTimer = undefined
    this.attentionRetryTimer = undefined
    this.pendingChatProjections.clear()
    this.projectionRetryCounts.clear()
    this.notificationBaselineSequences.clear()
    this.notificationBaselineGeneration = 0
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
      if (this.notificationBaselineRetryTimer !== undefined) clearTimeout(this.notificationBaselineRetryTimer)
      if (this.attentionRetryTimer !== undefined) clearTimeout(this.attentionRetryTimer)
      this.projectionTimer = undefined
      this.notificationBaselineRetryTimer = undefined
      this.attentionRetryTimer = undefined
      this.pendingChatProjections.clear()
      this.projectionRetryCounts.clear()
      this.notificationBaselineSequences.clear()
      this.notificationBaselineGeneration = 0
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
    if (notice.cause === 'reconcile') {
      const generation = notice.state.connectionGeneration
      this.notificationBaselineGeneration = 0
      this.notificationBaselineSequences.clear()
      this.notificationBaselineRetryCount = 0
      if (this.notificationBaselineRetryTimer !== undefined) clearTimeout(this.notificationBaselineRetryTimer)
      this.notificationBaselineRetryTimer = undefined
      this.emitChatClientEvent({
        type: 'reconcile', revision: this.nextChatClientRevision(), connected: notice.state.connected,
        connectionGeneration: generation,
        refresh: 'none',
      })
      void this.reconcileChatNotificationBaseline(generation)
      void this.refreshAttentionSummary()
      void this.invalidateRecordProjection()
      return
    }
    if (notice.cause === 'projection-invalidation'
      && notice.projectionInvalidation?.projection === 'record') {
      void this.invalidateRecordProjection()
      return
    }
    if (notice.cause === 'chat-hint' && notice.readCursorAdvanced !== undefined) {
      void this.handleReadCursorAdvanced(notice.readCursorAdvanced)
      return
    }
    if (notice.cause === 'chat-hint' && notice.timelineChanged !== undefined) {
      void this.handleTimelineChanged(notice.timelineChanged)
      return
    }
    if (notice.cause === 'chat-hint' && notice.hint !== undefined) {
      this.scheduleChatSessionProjection(
        notice.hint.chatSessionUid,
        notice.hint.latestSequence,
        { hint: notice.hint, connectionGeneration: notice.state.connectionGeneration, attempts: 0 },
      )
    }
  }

  private async handleTimelineChanged(
    hint: NonNullable<ArkmeChatRealtimeNotice['timelineChanged']>,
  ): Promise<void> {
    try {
      const session = await this.runtime.sessionStore.read()
      if (session === undefined) return
      this.emitChatClientEvent({
        type: 'timeline-changed',
        revision: this.nextChatClientRevision(),
        sourceKey: await this.source.chatDirectorySourceKey(session.userId, hint.chatSessionUid),
        timelineItemKey: await this.source.chatTimelineItemKey(
          session.userId, hint.chatSessionUid, hint.relationUid,
        ),
        changeKind: hint.changeKind,
        throughSequence: hint.latestSequence,
      })
      this.scheduleChatSessionProjection(hint.chatSessionUid, hint.latestSequence)
      void this.refreshAttentionSummary()
    } catch (error) {
      console.warn('dsh-arkme: Chat timeline invalidation failed:', safeFailureMessage(error))
    }
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
    this.pendingChatProjections.clear()
    this.projectionRetryCounts.clear()
    this.projectionFailureCount = 0
    this.notificationBaselineSequences.clear()
    this.notificationBaselineGeneration = 0
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

  private async reconcileChatNotificationBaseline(connectionGeneration: number): Promise<void> {
    try {
      const session = await this.runtime.requireSession()
      this.notificationBaselineSequences.clear()
      const sequences = new Map<string, number>()
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await this.source.listSources('root', {
          limit: 50,
          refresh: true,
          ...(cursor === undefined ? {} : { cursor }),
        })
        for (const item of page.items) {
          if (item.kind !== 'private_chat' && item.kind !== 'group_chat') continue
          const source = await this.source.openSourceRef(item.sourceRef, session.userId)
          sequences.set(source.ownerRef, item.latestSequence ?? 0)
        }
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      const state = this.chatRealtime.state()
      if (!state.connected || state.connectionGeneration !== connectionGeneration) return
      this.notificationBaselineSequences.clear()
      for (const [uid, sequence] of sequences) this.notificationBaselineSequences.set(uid, sequence)
      this.notificationBaselineGeneration = connectionGeneration
      this.notificationBaselineRetryCount = 0
      console.info('dsh-arkme: reconcile_completed', {
        connectionGeneration,
        sessionCount: sequences.size,
      })
      if (this.pendingChatProjections.size > 0 && this.projectionTimer === undefined && !this.projectionInFlight) {
        this.projectionTimer = setTimeout(() => {
          this.projectionTimer = undefined
          void this.flushChatSessionProjections()
        }, 0)
      }
    } catch (error) {
      const state = this.chatRealtime.state()
      if (!state.connected || state.connectionGeneration !== connectionGeneration) return
      this.notificationBaselineRetryCount += 1
      const delay = Math.min(15_000, 1_000 * 2 ** Math.min(4, this.notificationBaselineRetryCount - 1))
      console.warn('dsh-arkme: Chat reconnect reconciliation failed:', safeFailureMessage(error))
      this.notificationBaselineRetryTimer = setTimeout(() => {
        this.notificationBaselineRetryTimer = undefined
        void this.reconcileChatNotificationBaseline(connectionGeneration)
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
    })
    if (this.projectionTimer !== undefined || this.projectionInFlight) return
    this.projectionTimer = setTimeout(() => {
      this.projectionTimer = undefined
      void this.flushChatSessionProjections()
    }, 200)
  }

  private async flushChatSessionProjections(): Promise<void> {
    if (this.projectionInFlight || this.pendingChatProjections.size === 0) return
    this.projectionInFlight = true
    const pending = [...this.pendingChatProjections.entries()].slice(0, 50)
    for (const [uid] of pending) this.pendingChatProjections.delete(uid)
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
      if (this.pendingChatProjections.size > 0 && this.projectionTimer === undefined) {
        const retryDelayBase = this.projectionFailureCount === 0
          ? 200
          : Math.min(5_000, 500 * 2 ** Math.min(3, this.projectionFailureCount - 1))
        const retryDelay = Math.max(100, Math.round(retryDelayBase * (0.8 + Math.random() * 0.4)))
        this.projectionTimer = setTimeout(() => {
          this.projectionTimer = undefined
          void this.flushChatSessionProjections()
        }, retryDelay)
      }
    }
  }

  private requeueProjectionFailures(failed: Array<[string, PendingChatProjection]>): void {
    for (const [uid, projection] of failed) {
      const retries = (this.projectionRetryCounts.get(uid) ?? 0) + 1
      if (retries > MAX_PROJECTION_RETRIES) {
        this.projectionRetryCounts.delete(uid)
        console.warn('dsh-arkme: Chat projection retry exhausted for one session')
        continue
      }
      this.projectionRetryCounts.set(uid, retries)
      this.mergePendingChatProjection(uid, projection)
    }
  }

  private mergePendingChatProjection(uid: string, incoming: PendingChatProjection): void {
    const current = this.pendingChatProjections.get(uid)
    if (current === undefined) {
      this.pendingChatProjections.set(uid, {
        latestSequence: incoming.latestSequence,
        notificationHints: [...incoming.notificationHints],
      })
      return
    }
    const byEventUid = new Map(current.notificationHints.map(item => [item.hint.eventUid, item]))
    for (const item of incoming.notificationHints) byEventUid.set(item.hint.eventUid, item)
    this.pendingChatProjections.set(uid, {
      latestSequence: Math.max(current.latestSequence, incoming.latestSequence),
      notificationHints: [...byEventUid.values()].slice(-256),
    })
  }

  async refreshChatSessionProjectionBatch(
    pending: Array<[string, PendingChatProjection]>,
  ): Promise<Array<[string, PendingChatProjection]>> {
    const session = await this.runtime.requireSession()
    this.activateAttentionOwner(session.userId)
    const ownerGeneration = this.attentionOwnerGeneration
    const sessionUids = pending.map(([uid]) => uid).sort()
    const projectionBatchKey = sessionUids.join('|')
    const displayData = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/display-snapshots', { chat_session_uids: sessionUids }, session,
      undefined,
      {
        lane: 'background-read',
        key: `projection:display:${projectionBatchKey}`,
      },
    )
    const bundles = new Map(listValue(displayData.items).map(raw => {
      const bundle = objectValue(raw)
      return [stringValue(objectValue(bundle.session).chat_session_uid).trim(), bundle] as const
    }).filter(([uid]) => uid !== ''))
    const tailItemsByUid = new Map<string, ArkmeTimelineItem[]>()
    const failedUids = new Set<string>()
    for (let offset = 0; offset < pending.length; offset += 3) {
      const chunk = pending.slice(offset, offset + 3)
      const results = await Promise.allSettled(chunk.map(async ([uid, projection]) => {
        const cached = this.source.cachedChatSourceByKey(`${String(session.userId)}:${uid}`)
        const firstHintSequence = projection.notificationHints.reduce(
          (minimum, item) => Math.min(minimum, item.hint.latestSequence),
          projection.latestSequence,
        )
        const requiredAfterSequence = Math.max(0, firstHintSequence - 1)
        const afterSequence = Math.max(0, Math.min(cached?.latestSequence ?? requiredAfterSequence, requiredAfterSequence))
        const notificationAttempt = projection.notificationHints.reduce(
          (maximum, item) => Math.max(maximum, item.attempts),
          0,
        )
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chat/timeline/tail', { chat_session_uid: uid, after_seq: afterSequence, limit: 50 }, session,
          undefined,
          {
            lane: 'background-read',
            key: `projection:tail:${uid}:${String(afterSequence)}:${String(notificationAttempt)}`,
          },
        )
        const sessionKind = numberValue(objectValue(bundles.get(uid)).session_kind
          ?? objectValue(objectValue(bundles.get(uid)).session).session_kind)
        return [uid, await this.projectionReader.chatTimelineItems(
          data,
          session,
          uid,
          sessionKind === 2 ? 'group_chat' : sessionKind === 1 || sessionKind === 3 ? 'private_chat' : undefined,
        )] as const
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
    const notifications: Array<Extract<ArkmeChatClientEvent, { type: 'message-notification' }>['notification']> = []
    for (const [uid, projection] of pending) {
      const bundle = bundles.get(uid)
      if (bundle === undefined || failedUids.has(uid)) {
        failedUids.add(uid)
        continue
      }
      const cacheKey = `${String(session.userId)}:${uid}`
      const timelineItems = tailItemsByUid.get(uid) ?? []
      try {
        const source = await this.source.chatSourceFromBundle(bundle, session, this.source.cachedChatSourceByKey(cacheKey), timelineItems)
        if (ownerGeneration !== this.attentionOwnerGeneration) return []
        this.source.setChatSourceByKey(cacheKey, source)
        const sourceKey = source.sourceKey ?? await this.source.chatDirectorySourceKey(session.userId, uid)
        updates.push({ sourceKey, source, timelineItems })
        if (source.kind === 'private_chat' || source.kind === 'group_chat') {
          for (const candidate of projection.notificationHints
            .sort((left, right) => left.hint.latestSequence - right.hint.latestSequence)) {
            const state = this.chatRealtime.state()
            if (candidate.connectionGeneration !== state.connectionGeneration) continue
            if (this.notificationBaselineGeneration !== candidate.connectionGeneration) {
              this.mergePendingChatProjection(uid, {
                latestSequence: projection.latestSequence,
                notificationHints: [candidate],
              })
              continue
            }
            const baselineSequence = this.notificationBaselineSequences.get(uid) ?? 0
            if (
              candidate.hint.latestSequence <= baselineSequence
              || candidate.hint.senderUserId === session.userId
              || source.notificationAllowed !== true
            ) continue
            const message = timelineItems.find(item => item.sequence === candidate.hint.latestSequence && !item.isMe)
            if (message === undefined) {
              if (candidate.attempts < 4) {
                this.mergePendingChatProjection(uid, {
                  latestSequence: projection.latestSequence,
                  notificationHints: [{ ...candidate, attempts: candidate.attempts + 1 }],
                })
              } else {
                console.warn('dsh-arkme: Chat notification message was not projected:', candidate.hint.eventUid)
              }
              continue
            }
            const preview = message.textContent.trim() || '非文本内容'
            notifications.push({
              eventUid: candidate.hint.eventUid,
              sourceRef: source.sourceRef,
              sourceKey,
              sourceKind: source.kind,
              title: source.displayName,
              body: source.kind === 'group_chat' ? `${message.senderName}：${preview}` : preview,
              eventAtMillis: candidate.hint.eventAtMillis,
            })
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
      void this.refreshAttentionSummary()
    }
    const deliveries: Array<{
      notification: (typeof notifications)[number]
      fallbackToBrowser: boolean
    }> = []
    for (let offset = 0; offset < notifications.length; offset += MAX_NATIVE_NOTIFICATION_DELIVERY_CONCURRENCY) {
      const chunk = notifications.slice(offset, offset + MAX_NATIVE_NOTIFICATION_DELIVERY_CONCURRENCY)
      deliveries.push(...await Promise.all(chunk.map(async notification => {
        if (ownerGeneration !== this.attentionOwnerGeneration) {
          return { notification, fallbackToBrowser: false }
        }
        try {
          const outcome = await this.nativeAttention.showNotification({
            idempotencyKey: notification.eventUid,
            kind: 'chat.message',
            occurredAtMillis: notification.eventAtMillis,
            expiresAtMillis: notification.eventAtMillis + 5 * 60_000,
            presentation: { title: notification.title, body: notification.body },
            activation: {
              kind: 'chat-source',
              sourceRef: notification.sourceRef,
              sourceKey: notification.sourceKey,
            },
          })
          return { notification, fallbackToBrowser: outcome.fallbackToBrowser }
        } catch {
          // An exception after native capability ownership is uncertain. Avoid a
          // second Browser delivery; the concrete adapter reports safe fallback
          // explicitly when no side-effecting request was attempted.
          return { notification, fallbackToBrowser: false }
        }
      })))
    }
    for (const { notification, fallbackToBrowser } of deliveries) {
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
