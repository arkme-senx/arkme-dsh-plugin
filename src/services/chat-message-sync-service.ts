import { parseChatSyncPage, type ArkmeMessageSyncProgress, type ChatSyncBatch, type ChatSyncPage, type ChatSyncPlan, type ChatSyncSession } from '../chat-message-sync.js'
import { chatTimelineEventId } from './timeline-event-id.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { UnifiedChatTimelineService } from './unified-chat-timeline-service.js'
import type { SourceService } from './source-service.js'
import type { ChatService } from './chat-service.js'
import type { ArkmeChatClientEvent } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'

const ROUTE = '/api/v1/chat/sync/account'
const idle = (accountKey = ''): ArkmeMessageSyncProgress => ({ accountKey, cycle: 0, revision: 0, phase: 'idle', completed: 0, total: 0, pending: 0, terminal: 0 })

/** One lifecycle per Host; a UI mount, Tool call or SDK consumer never owns a second pump. */
export class ChatMessageSyncService {
  private progress = idle()
  private started = false
  private disposed = false
  private generation = 0
  private revision = 0
  private controller = new AbortController()
  private running: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private failures = 0
  private readonly unsubscribe?: () => void
  constructor(private readonly runtime: ServiceRuntime, private readonly timeline: UnifiedChatTimelineService,
    private readonly source: SourceService, private readonly chat: ChatService,
    private readonly publish: (progress: ArkmeMessageSyncProgress) => void) {
    this.unsubscribe = runtime.subscribeAccountScope?.(() => { this.reset(); if (this.started) this.wake(0) })
  }
  private update(progress: ArkmeMessageSyncProgress): void {
    this.progress = { ...progress, revision: ++this.revision }
    this.publish(this.progress)
  }
  start(): () => void {
    if (!this.started && !this.disposed) { this.started = true; this.wake(0) }
    return () => { this.started = false; this.reset() }
  }
  reset(): void {
    this.generation++; this.controller.abort(); this.controller = new AbortController()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined; this.dirty = false; this.failures = 0
    if (this.progress.accountKey) this.update(idle())
    else this.progress = idle()
  }
  dispose(): void { this.disposed = true; this.started = false; this.reset(); this.unsubscribe?.() }
  accept(event: ArkmeChatClientEvent): void {
    if (!this.started || this.disposed) return
    if (event.type === 'read-ack' && event.sourceKey && this.progress.accountKey) {
      void this.timeline.sync({ action: 'ack', account: this.progress.accountKey, sourceKey: event.sourceKey, through: event.effectiveReadSequence }).catch(() => undefined)
      this.wake(5000)
    }
    if (event.type === 'reconcile' && event.connected) this.wake(0)
    // One trailing account check per bounded burst, never one request per message.
    else if (event.type === 'sessions-delta' || event.type === 'timeline-changed' || event.type === 'members-invalidated') this.wake(5000)
  }
  private wake(delay: number): void {
    if (this.disposed || !this.started || this.progress.phase === 'unsupported') return
    this.dirty = true
    if (this.running || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.launch() }, delay)
    this.timer.unref?.()
  }
  private async launch(): Promise<void> {
    if (this.running || !this.started || this.disposed) return
    this.dirty = false
    const generation = this.generation, signal = this.controller.signal
    const task = this.run(generation, signal)
    this.running = task
    try { await task } finally {
      if (this.running === task) this.running = undefined
      if (this.dirty && this.started && !this.disposed && !this.timer) this.wake(generation === this.generation ? 5000 : 0)
    }
  }
  private assert(generation: number, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (generation !== this.generation || this.disposed) throw new Error('message-sync-stale')
  }
  async status(signal?: AbortSignal): Promise<ArkmeMessageSyncProgress> {
    const session = await this.runtime.requireSession(); signal?.throwIfAborted()
    const account = `${this.runtime.config.environment}:${session.userId}`
    if (this.progress.accountKey === account) return { ...this.progress }
    try {
      const plan = await this.timeline.sync<ChatSyncPlan>({ action: 'status', account })
      signal?.throwIfAborted()
      if ((await this.runtime.requireSession()).userId !== session.userId) throw new Error('message-sync-stale')
      return { ...plan.progress, revision: this.revision }
    } catch (error) {
      if (error instanceof Error && error.message === 'message-sync-account-missing') return idle(account)
      throw error
    }
  }
  async retry(signal?: AbortSignal): Promise<ArkmeMessageSyncProgress> {
    const current = await this.status(signal)
    if (this.running || current.phase === 'unsupported') return current
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined; this.failures = 0; this.started = true
    this.wake(0)
    return current
  }
  private async request(body: Record<string, unknown>, session: ArkmeSessionCredentials, signal: AbortSignal): Promise<ChatSyncPage> {
    const raw = await this.runtime.authenticatedChatPost<unknown>(ROUTE, body, session, signal, {
      lane: 'background-read', traffic: 'message-sync', cancelWhenUnobserved: true,
      key: `account-message-sync:${JSON.stringify(body)}`,
    })
    return parseChatSyncPage(raw, body.mode === 'unread_manifest')
  }
  private async identify(page: ChatSyncPage, session: ArkmeSessionCredentials, key: string, signal: AbortSignal): Promise<void> {
    for (const entry of page.sessions) {
      signal.throwIfAborted()
      entry.scope = JSON.stringify([this.runtime.config.environment, session.userId, entry.uid])
      entry.sourceKey = await this.source.chatDirectorySourceKey(session.userId, entry.uid)
      for (const work of entry.work) {
        work.eventId = chatTimelineEventId(key, session.userId, this.runtime.config.environment, entry.uid, `message:${entry.uid}:${work.id}`)
        work.itemKey = await this.source.chatTimelineItemKey(session.userId, entry.uid, work.id)
      }
      if (page.manifest || !entry.accessible) continue
      const raw = (page.bodies.get(entry.uid) ?? []).filter(body => body.state === 'available')
      if (!raw.length) continue
      // Reuse the same body projection as the live tail. No directory scan or read ACK.
      const project = () => this.chat.chatTimelineItems({ items: raw }, session, entry.uid, entry.kind === 2 ? 'group_chat' : 'private_chat', undefined, signal)
      const items = await this.runtime.runBackgroundMessageProjection(project)
      const byKey = new Map(items.map(item => [item.timelineItemKey, item]))
      for (const work of entry.work) {
        if (work.state !== 'available') continue
        const item = byKey.get(work.itemKey)
        if (!item) throw new Error('message-sync-body-incomplete')
        work.event = { kind: 'message', source: 'messages', eventId: work.eventId!, occurredAtMillis: item.sendAtMillis,
          orderTie: work.id, contentStatus: 'available', item: { ...item, timelineEventId: work.eventId! } }
      }
    }
  }
  private async run(generation: number, signal: AbortSignal): Promise<void> {
    let plan: ChatSyncPlan | undefined, account = ''
    try {
      const session = await this.runtime.accountScopedSession()
      this.assert(generation, signal)
      if (!session) return
      account = `${this.runtime.config.environment}:${session.userId}`
      plan = await this.timeline.sync<ChatSyncPlan>({ action: 'begin', account })
      this.assert(generation, signal); this.update(plan.progress)
      const key = await this.runtime.stateStore.uniqueCode()
      if (plan.progress.phase === 'discovering') {
        let ranges: Record<string, unknown> = plan.checkpoint ? {} : await this.timeline.sync({ action: 'ranges', account, epoch: plan.epoch })
        // Each page yields network admission and the writer before the next read.
        for (let pages = 0; ; pages++) {
          this.assert(generation, signal)
          if (pages >= 10000) throw new Error('message-sync-capacity')
          const ticket = await this.timeline.syncTicket()
          const page = await this.request({ mode: 'unread_manifest', limit: 1000, checkpoint: plan.checkpoint, ...ranges }, session, signal)
          this.assert(generation, signal)
          if (page.hasMore && !page.retry && page.checkpoint === plan.checkpoint && !page.sessions.some(s => s.cacheRequired)) throw new Error('message-sync-checkpoint-stale')
          await this.identify(page, session, key, signal)
          this.assert(generation, signal)
          const { bodies: _bodies, ...stored } = page
          plan = await this.timeline.sync<ChatSyncPlan>({ action: 'manifest', account, epoch: plan.epoch, expectedCheckpoint: plan.checkpoint, page: stored, ticket, now: Date.now() })
          if (page.sessions.some(s => s.cacheRequired) && !('cached' in ranges)) ranges = await this.timeline.sync({ action: 'ranges', account, epoch: plan.epoch })
          ranges = 'cached' in ranges ? { cached: ranges.cached } : {}
          if (page.retry) throw new Error('message-sync-upstream-pending')
          if (!page.hasMore) break
        }
        plan = await this.timeline.sync<ChatSyncPlan>({ action: 'freeze', account, epoch: plan.epoch })
        this.assert(generation, signal); this.update(plan.progress)
      }
      // At most 400 identities resident, 2 HTTP responses and one writer commit.
      for (;;) {
        this.assert(generation, signal)
        const pending = await this.timeline.sync<ChatSyncBatch[]>({ action: 'pending', account, epoch: plan.epoch, now: Date.now(), limit: 400 })
        if (!pending.length) break
        const batches: Record<string, string[]>[] = []; let wanted: Record<string, string[]> = {}, count = 0
        for (const entry of pending) for (const work of entry.work) {
          if (count === 100 || !(entry.uid in wanted) && Object.keys(wanted).length === 50) { batches.push(wanted); wanted = {}; count = 0 }
          ;(wanted[entry.uid] ??= []).push(work.id); count++
        }
        if (count) batches.push(wanted)
        let next = 0
        type Flight = { wanted: Record<string, string[]>; ticket: number; response: Promise<ChatSyncPage> }
        const flights: Flight[] = []
        const launch = async () => {
          while (flights.length < 2 && next < batches.length) {
            this.assert(generation, signal)
            const ticket = await this.timeline.syncTicket(), wanted = batches[next++]!
            const response = this.request({ mode: 'bodies', checkpoint: plan!.checkpoint, bodies: wanted }, session, signal)
            void response.catch(() => undefined)
            flights.push({ wanted, ticket, response })
          }
        }
        try {
          await launch()
          while (flights.length) {
            const flight = flights.shift()!, page = await flight.response
            this.assert(generation, signal)
            this.validateBodies(page.sessions, flight.wanted)
            if (page.sessions.some(s => s.accessible && s.membership !== Number(s.position.membership_version))) this.dirty = true
            // Permit the next I/O while preparing/committing this bounded page.
            await launch()
            await this.identify(page, session, key, signal)
            this.assert(generation, signal)
            const { bodies: _bodies, ...stored } = page
            plan = await this.timeline.sync<ChatSyncPlan>({ action: 'commit', account, epoch: plan.epoch, expectedCheckpoint: plan.checkpoint, page: stored, ticket: flight.ticket, now: Date.now() })
            this.assert(generation, signal); this.update(plan.progress)
          }
        } finally { await Promise.allSettled(flights.map(f => f.response)) }
      }
      plan = await this.timeline.sync<ChatSyncPlan>({ action: 'status', account })
      this.assert(generation, signal)
      if (plan.progress.pending > 0) {
        this.update({ ...plan.progress, phase: 'paused' })
        this.scheduleRetry(Math.max(2000, (plan.progress.retryAtMillis ?? 0) - Date.now()))
      } else {
        plan = await this.timeline.sync<ChatSyncPlan>({ action: 'finish', account, epoch: plan.epoch })
        this.assert(generation, signal); this.update(plan.progress); this.failures = 0
      }
    } catch (error) {
      if (signal.aborted || generation !== this.generation || this.disposed) return
      if (error instanceof ArkmePluginError && error.upstreamStatus === 404) { this.update({ ...idle(account), phase: 'unsupported' }); return }
      const message = error instanceof Error ? error.message : ''
      const reason: ArkmeMessageSyncProgress['reason'] = message.includes('capacity') ? 'capacity'
        : /storage|Timeline storage|SQLITE/.test(message) ? 'storage'
          : error instanceof ArkmePluginError && (error.upstreamStatus === 401 || error.code === 'login-expired') ? 'authentication' : 'network'
      const delay = Math.max(error instanceof ArkmePluginError ? error.retryAfterMillis ?? 0 : 0, Math.min(60000, 2000 * 2 ** Math.min(5, this.failures++)))
      this.update({ ...(plan?.progress ?? (this.progress.accountKey === account ? this.progress : idle(account))), phase: 'paused', reason, retryAtMillis: Date.now() + delay })
      if (reason !== 'authentication') this.scheduleRetry(delay)
    }
  }
  private scheduleRetry(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.launch() }, delay)
    this.timer.unref?.()
  }
  private validateBodies(sessions: ChatSyncSession[], wanted: Record<string, string[]>): void {
    if (sessions.length !== Object.keys(wanted).length) throw new Error('message-sync-body-incomplete')
    for (const session of sessions) {
      const ids = wanted[session.uid]
      if (!ids || session.accessible && (ids.length !== session.work.length || session.work.some(work => !ids.includes(work.id)))) throw new Error('message-sync-body-incomplete')
    }
  }
}
