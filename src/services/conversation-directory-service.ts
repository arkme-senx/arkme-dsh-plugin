import { projectArkmeConversationAttention } from '../conversation-attention.js'
import type { ArkmeBotSummary, ArkmeChatClientEvent, ArkmeConversationDirectoryVisibilityItem, ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { projectArkmeChatAttentionFromMuted } from '../chat-attention.js'
import { retainNewerArkmeChatPolicy } from '../chat-policy-projection.js'
import type { SourceService } from './source-service.js'
import type { ConversationDirectoryVisibilityService } from './conversation-directory-visibility-service.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

const PAGE_SIZE = 20
const MAX_ROWS = 20_000
const keyOf = (source: ArkmeSourceItem) => source.sourceKey ?? source.sourceRef

/** Merge pages and live changes without interpreting page absence as removal. */
export function mergeDirectorySource(previous: ArkmeSourceItem | undefined, incoming: ArkmeSourceItem, keepLive = false): ArkmeSourceItem {
  if (previous === undefined) return incoming
  const stale = (incoming.latestSequence ?? 0) < (previous.latestSequence ?? 0)
    || keepLive && (incoming.latestSequence ?? 0) <= (previous.latestSequence ?? 0) && incoming.activeAtMillis <= previous.activeAtMillis
  const merged = { ...previous, ...incoming }
  if (stale) {
    merged.sourceRef = previous.sourceRef
    for (const field of ['latestSequence', 'latestPreview', 'activeAtMillis', 'unreadCount', 'badgeUnreadCount', 'hasUnreadMention'] as const) {
      if (previous[field] !== undefined) Object.assign(merged, { [field]: previous[field] })
    }
  }
  if (!stale && incoming.latestPreview === undefined) delete merged.latestPreview
  // Message sequence and read cursor are separate server facts; restored relations can
  // change unread counts without changing the last message sequence.
  const readSequence = Math.max(previous.readSequence ?? 0, incoming.readSequence ?? 0)
  if (readSequence > 0) {
    merged.readSequence = readSequence
    if ((merged.latestSequence ?? 0) <= readSequence) merged.unreadCount = 0
    else if ((incoming.readSequence ?? 0) < (previous.readSequence ?? 0)
      && (incoming.latestSequence ?? 0) <= (previous.latestSequence ?? 0)) merged.unreadCount = previous.unreadCount
  }
  Object.assign(merged, projectArkmeChatAttentionFromMuted(merged.unreadCount, merged.isMuted === true))
  if (merged.unreadCount === 0) merged.hasUnreadMention = false
  // A sparse realtime source carries no authoritative avatar deletion.
  if (!incoming.avatarRef && previous.avatarRef !== undefined) merged.avatarRef = previous.avatarRef
  if (!incoming.avatarRefs?.length && previous.avatarRefs !== undefined) merged.avatarRefs = previous.avatarRefs
  if (!incoming.groupAvatar?.slots.length && previous.groupAvatar !== undefined) merged.groupAvatar = previous.groupAvatar
  return retainNewerArkmeChatPolicy(previous, merged)
}

/** One account lifecycle owns cache restoration, a twenty-row scan, and directory deltas. */
export class ConversationDirectoryService {
  private userId: number | undefined
  private generation = 0
  private revision = 0
  private cachedAtMillis = 0
  private sourceRemovals = new Map<string, number>()
  private pendingReadAcks = new Map<string, { effectiveReadSequence: number; unreadCount: number }>()
  private visibilityMutations = new Map<string, number>()
  private sources = new Map<string, ArkmeSourceItem>()
  private mutations = new Map<string, number>()
  private visibility = new Map<string, ArkmeConversationDirectoryVisibilityItem>()
  private bots: ArkmeBotSummary[] = []
  private cachedBotKeys = new Map<string, string>()
  private botPinnedKeys = new Set<string>()
  private deletedBotRefs = new Set<string>()
  private special: Pick<NonNullable<ArkmeSourceList['projection']>, 'sendToSelf' | 'arkoProfile' | 'arkoPreview'> = {}
  private phase: NonNullable<ArkmeSourceList['projection']>['phase'] = 'cached'
  private error: string | undefined
  private restore: Promise<void> | undefined
  private scan: Promise<void> | undefined
  private firstPage: Promise<void> | undefined
  private rescanRequested = false
  private rawBaselineComplete = false
  private rawBaseline: Promise<ArkmeSourceList> | undefined
  private controller = new AbortController()
  private persistence = Promise.resolve()
  private diskPending = new Map<number, ArkmeSourceList>()
  private diskWriting = false
  private cacheFailure: unknown
  private lastPublished = ""
  private avatars = new Map<string, ArkmeSourceItem>()
  private avatarWork: Promise<void> | undefined

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly preferences: ConversationDirectoryVisibilityService,
    private readonly readBots: (signal: AbortSignal) => Promise<{ items: ArkmeBotSummary[] }>,
    private readonly warmAvatar: (ref: string, signal: AbortSignal) => Promise<unknown>,
    private readonly emit: (page: ArkmeSourceList) => void,
    private readonly restoreBots: (items: ArkmeBotSummary[], userId: number) => Promise<ArkmeBotSummary[]> = async items => items,
  ) {}

  reset(): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.generation++
    this.userId = undefined
    this.sourceRemovals.clear(); this.pendingReadAcks.clear(); this.sources.clear(); this.mutations.clear(); this.visibility.clear(); this.visibilityMutations.clear(); this.avatars.clear()
    this.bots = []; this.cachedBotKeys.clear(); this.botPinnedKeys.clear(); this.deletedBotRefs.clear(); this.special = {}; this.restore = undefined; this.scan = undefined; this.firstPage = undefined; this.rawBaseline = undefined; this.avatarWork = undefined
    this.phase = 'cached'; this.error = undefined; this.lastPublished = ''; this.cachedAtMillis = 0; this.rescanRequested = false; this.rawBaselineComplete = false
  }

  private async activate(): Promise<void> {
    const { userId } = await this.runtime.requireSession()
    if (userId !== this.userId) {
      this.reset(); this.userId = userId
      const generation = this.generation
      this.restore = (async () => {
        const cached = await this.runtime.stateStore.readDirectoryCache?.(userId)
        if (generation !== this.generation || cached === undefined) return
        // References are validated by the current Host before they can reach a consumer.
        if (cached.items[0] !== undefined) await this.source.openSourceRef(cached.items[0].sourceRef, userId)
        if (generation !== this.generation) return
        for (const item of cached.items) this.sources.set(keyOf(item), item)
        this.cachedAtMillis = cached.projection?.cachedAtMillis ?? 0
        for (const item of cached.projection?.visibility ?? []) this.visibility.set(`${item.entryKind}:${item.entryRef}`, item)
        const cachedBots = cached.projection?.bots ?? []
        const bots = await this.restoreBots(cachedBots, userId)
        if (generation !== this.generation) return
        this.bots = bots
        for (const bot of bots) {
          if (bot.directoryKey !== undefined) this.cachedBotKeys.set(bot.botRef, bot.directoryKey)
          const previous = cachedBots.find(item => item.directoryKey === bot.directoryKey)
          if (previous === undefined || previous.botRef === bot.botRef) continue
          const visibility = this.visibility.get(`bot:${previous.botRef}`)
          this.visibility.delete(`bot:${previous.botRef}`)
          if (visibility !== undefined) this.visibility.set(`bot:${bot.botRef}`, { ...visibility, entryRef: bot.botRef })
        }
        this.botPinnedKeys = new Set(cached.projection?.botPinnedKeys ?? [])
        this.deletedBotRefs = new Set(cached.projection?.removedBotRefs ?? [])
        this.special = { ...(cached.projection?.sendToSelf === undefined ? {} : { sendToSelf: cached.projection.sendToSelf }),
          ...(cached.projection?.arkoProfile === undefined ? {} : { arkoProfile: cached.projection.arkoProfile }),
          ...(cached.projection?.arkoPreview === undefined ? {} : { arkoPreview: cached.projection.arkoPreview }) }
        this.revision = Math.max(this.revision, cached.projection?.revision ?? 0)
        for (const key of cached.projection?.removedSourceKeys ?? []) this.sourceRemovals.set(key, this.revision)
      })().catch(() => { /* A corrupt derived cache falls back to the authoritative first page. */ })
    }
    await this.restore
  }

  async read(force = false, signal?: AbortSignal): Promise<ArkmeSourceList> {
    signal?.throwIfAborted()
    const pending = this.readSnapshot(force)
    if (signal === undefined) return await pending
    return await new Promise<ArkmeSourceList>((resolve, reject) => {
      const abort = () => { reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
    })
  }

  private async readSnapshot(force: boolean): Promise<ArkmeSourceList> {
    await this.activate()
    const generation = this.generation
    const cached = this.snapshot()
    const hasCache = cached.items.length > 0 || cached.projection!.bots.length > 0
    if (this.scan === undefined && (force || this.phase === 'cached' || this.phase === 'failed')) this.startScan()
    if (force && this.scan !== undefined && cached.projection?.phase === 'syncing') this.rescanRequested = true
    if (hasCache) return structuredClone(cached)
    await this.firstPage
    if (generation !== this.generation) throw new ArkmePluginError('login-context-changed', '账号已切换', false, 409)
    return structuredClone(this.snapshot())
  }

  /** Notification callers join the same scan, but only accept a complete current connection baseline. */
  async complete(): Promise<ArkmeSourceList> {
    await this.activate()
    // A completed raw baseline must not be reused by a later connection while Bot discovery is pending.
    if (this.rawBaselineComplete && this.scan !== undefined) await this.scan.catch(() => undefined)
    await this.activate()
    if (this.scan === undefined) this.startScan()
    return structuredClone(await this.rawBaseline!)
  }

  /** Join the directory owner; never combine its rows with a separately refreshed global count. */
  async attentionSummary(retry = false): Promise<import('../types.js').ArkmeChatAttentionSummary> {
    // Bootstrap is owned by the directory/connection baseline, not by each attention trigger.
    if (retry && this.userId !== undefined && this.phase === 'failed' && this.scan === undefined) void this.read(true).catch(() => undefined)
    const generation = this.generation
    const session = await this.runtime.accountScopedSession()
    if (generation !== this.generation || this.userId !== undefined && session?.userId !== this.userId) throw new DOMException('Account changed', 'AbortError')
    const sources = [...this.sources.values()]
    const visibility = [...this.visibility.values()]
    const visible = projectArkmeConversationAttention(sources, this.bots, visibility)
    const rows = [...visible.sources, ...visible.bots]
    const version = this.revision + 1
    return {
      ...(this.phase !== 'complete' ? { stale: true } : {}),
      badgeCount: visible.badgeCount,
      mutedUnreadCount: rows.reduce((sum, row) => sum + (row.isMuted ? Math.max(0, row.unreadCount ?? 0) : 0), 0),
      sessionCountWithUnread: rows.filter(row => (row.unreadCount ?? 0) > 0).length,
      hasAttention: visible.sources.some(row => row.hasUnreadMention === true),
      summaryVersion: version, updatedAtMillis: Math.max(1, this.cachedAtMillis),
    }
  }

  async settled(): Promise<void> { while (this.scan !== undefined) await this.scan; while (this.avatarWork !== undefined) await this.avatarWork; while (this.diskWriting) await this.persistence }

  private startScan(): void {
    const generation = this.generation
    const userId = this.userId!
    const signal = this.controller.signal
    this.phase = 'loading'; this.error = undefined; this.rawBaselineComplete = false
    let ready!: () => void
    let failed!: (error: unknown) => void
    this.firstPage = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject })
    let baselineReady!: (page: ArkmeSourceList) => void
    let baselineFailed!: (error: unknown) => void
    this.rawBaseline = new Promise<ArkmeSourceList>((resolve, reject) => { baselineReady = resolve; baselineFailed = reject })
    void this.rawBaseline.catch(() => undefined)
    const rawSources = new Map<string, ArkmeSourceItem>()
    void this.firstPage.catch(() => undefined)
    const pending = (async () => {
      let cursor: string | undefined
      const visited = new Set<string>()
      let first = true
      do {
        signal.throwIfAborted()
        if (visited.size >= MAX_ROWS / PAGE_SIZE) throw new Error("Directory page budget exceeded; synchronization incomplete")
        const atRevision = this.revision
        const page = await this.source.listSources('root', { limit: PAGE_SIZE, refresh: true, firstPaint: true, ...(cursor === undefined ? {} : { cursor }), signal })
        if (generation !== this.generation || (await this.runtime.requireSession()).userId !== userId) throw new DOMException('Account changed', 'AbortError')
        if (page.hasMore && (page.nextCursor === undefined || visited.has(page.nextCursor))) throw new ArkmePluginError('directory-cursor-invalid', '会话目录分页未完成：游标无效', true, 502)
        for (const item of page.items) rawSources.set(keyOf(item), item)
        if (!page.hasMore) { this.rawBaselineComplete = true; baselineReady({ directory: 'root', items: [...rawSources.values()], hasMore: false }) }
        const visibleCandidates = page.items.map(item => mergeDirectorySource(this.sources.get(keyOf(item)), item, (this.mutations.get(keyOf(item)) ?? 0) > atRevision))
        const visibility = await this.preferences.query(visibleCandidates.map(item => item.sourceRef), [], signal).catch(error => {
          if (signal.aborted || (error instanceof ArkmePluginError && !error.retryable && [401, 403, 409].includes(error.httpStatus))) throw error
          return { items: visibleCandidates.map(item => ({ entryKind: 'source' as const, entryRef: item.sourceRef, hidden: this.visibility.get(`source:${item.sourceRef}`)?.hidden ?? false })) }
        })
        signal.throwIfAborted()
        this.phase = 'syncing'
        this.apply(page.items, visibility.items, atRevision)
        if (first) { first = false; ready() }
        for (const item of page.items) this.avatars.set(keyOf(item), item)
        this.startAvatars(generation)
        if (!page.hasMore) break
        cursor = page.nextCursor!; visited.add(cursor)
        // Yield between pages so first-paint delivery and interactive requests can run.
        await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      } while (true)
      // Bot discovery is independent of the ordinary first page.
      const bots = await this.readBots(signal)
      if (generation !== this.generation) return
      await this.rememberBots(bots.items, userId)
      if (generation !== this.generation) return
      this.phase = 'complete'
      this.apply([])
      // Image bytes share the decoration lifecycle, never the notification baseline wait.
      const refs = new Set(this.bots.flatMap(bot => bot.avatarRef ? [bot.avatarRef] : []))
      const previousAvatarWork = this.avatarWork
      const avatarWork = (async () => {
        await previousAvatarWork
        for (const ref of refs) {
          signal.throwIfAborted()
          await this.warmAvatar(ref, signal).catch(() => undefined)
        }
      })().catch(() => undefined).finally(() => {
        if (this.avatarWork !== avatarWork) return
        this.avatarWork = undefined
        if (generation === this.generation && this.avatars.size > 0) this.startAvatars(generation)
      })
      this.avatarWork = avatarWork
    })().catch(error => {
      if (generation === this.generation) {
        this.phase = 'failed'; this.error = error instanceof Error ? error.message : '目录同步失败'
        this.publish([])
      }
      failed(error); baselineFailed(error)
      throw error
    }).finally(() => {
      if (this.scan !== pending) return
      this.scan = undefined
      if (this.rescanRequested) { this.rescanRequested = false; this.startScan() }
    })
    this.scan = pending
    void pending.catch(() => undefined)
  }

  private apply(items: ArkmeSourceItem[], visibility: ArkmeConversationDirectoryVisibilityItem[] = [], atRevision = this.revision, authoritativeAvatars = false): void {
    const changed: ArkmeSourceItem[] = []
    for (const item of items) {
      const key = keyOf(item)
      if ((this.sourceRemovals.get(key) ?? 0) > atRevision) continue
      this.sourceRemovals.delete(key)
      const previous = this.sources.get(key)
      const ack = this.pendingReadAcks.get(key) ?? this.pendingReadAcks.get(item.sourceRef)
      const incoming = ack === undefined ? item : { ...item, readSequence: Math.max(item.readSequence ?? 0, ack.effectiveReadSequence),
        ...((item.latestSequence ?? 0) <= ack.effectiveReadSequence ? { unreadCount: ack.unreadCount } : {}) }
      const merged = mergeDirectorySource(previous, incoming, (this.mutations.get(key) ?? 0) > atRevision)
      if (authoritativeAvatars) {
        merged.avatarRef = item.avatarRef ?? ''
        merged.avatarRefs = item.avatarRefs ?? []
        if (item.groupAvatar === undefined) delete merged.groupAvatar
        else merged.groupAvatar = item.groupAvatar
      }
      this.pendingReadAcks.delete(key); this.pendingReadAcks.delete(item.sourceRef)
      if (JSON.stringify(previous) === JSON.stringify(merged)) continue
      if (previous === undefined && this.sources.size >= MAX_ROWS) throw new Error('Conversation directory capacity exceeded; scan incomplete')
      if (previous !== undefined && previous.sourceRef !== merged.sourceRef) {
        const inherited = this.visibility.get(`source:${previous.sourceRef}`)
        this.visibility.delete(`source:${previous.sourceRef}`)
        this.visibilityMutations.delete(`source:${previous.sourceRef}`)
        if (inherited !== undefined && !this.visibility.has(`source:${merged.sourceRef}`)) {
          this.visibility.set(`source:${merged.sourceRef}`, { ...inherited, entryRef: merged.sourceRef })
        }
      }
      this.sources.set(key, merged); this.mutations.set(key, this.revision + 1); changed.push(merged)
    }
    const currentRefs = new Set(items.flatMap(item => { const source = this.sources.get(keyOf(item)); return source === undefined ? [] : [source.sourceRef] }))
    const acceptedVisibility = visibility.filter(entry =>
      (items.length === 0 || entry.entryKind !== 'source' || currentRefs.has(entry.entryRef))
      && (this.visibilityMutations.get(`${entry.entryKind}:${entry.entryRef}`) ?? 0) <= atRevision)
    for (const entry of acceptedVisibility) {
      const key = `${entry.entryKind}:${entry.entryRef}`
      this.visibility.set(key, entry); this.visibilityMutations.set(key, this.revision + 1)
    }
    this.publish(changed, acceptedVisibility)
  }

  private snapshot(items = [...this.sources.values()], visibility = [...this.visibility.values()]): ArkmeSourceList {
    return { directory: 'root', items, hasMore: this.phase !== 'complete', projection: {
      ...this.special, removedSourceKeys: [...this.sourceRemovals.keys()], removedBotRefs: [...this.deletedBotRefs], botPinnedKeys: [...this.botPinnedKeys], revision: this.revision, phase: this.phase, cachedAtMillis: this.cachedAtMillis, visibility, bots: this.bots,
      ...(this.error === undefined ? {} : { error: this.error }),
    } }
  }

  private publish(items: ArkmeSourceItem[], visibility: ArkmeConversationDirectoryVisibilityItem[] = []): boolean {
    const fingerprint = JSON.stringify({ items, visibility, phase: this.phase, error: this.error, bots: this.bots, special: this.special, pins: [...this.botPinnedKeys], removedBots: [...this.deletedBotRefs], removedSources: [...this.sourceRemovals.keys()] })
    if (fingerprint === this.lastPublished) return this.cacheFailure === undefined
    this.lastPublished = fingerprint
    this.revision++
    this.cachedAtMillis = Date.now()
    const page = this.snapshot(items, visibility)
    const userId = this.userId!
    this.emit(structuredClone(page))
    // The first visible page never waits for disk I/O. Serialize incremental writes in the owner.
    if (!this.diskPending.has(userId) && this.diskPending.size >= 8) {
      this.cacheFailure = new Error('Directory cache pending account capacity exceeded')
      console.warn('dsh-arkme: directory_cache_queue_full')
      return false
    }
    const queued = this.diskPending.get(userId)
    const rows = new Map((queued?.items ?? []).map(item => [keyOf(item), item]))
    for (const item of page.items) rows.set(keyOf(item), item)
    const hidden = new Map((queued?.projection?.visibility ?? []).map(item => [`${item.entryKind}:${item.entryRef}`, item]))
    for (const item of page.projection!.visibility) hidden.set(`${item.entryKind}:${item.entryRef}`, item)
    this.diskPending.set(userId, { ...page, items: [...rows.values()], projection: { ...page.projection!, visibility: [...hidden.values()] } })
    this.flushDisk()
    return true
  }

  private flushDisk(): void {
    if (this.diskWriting || this.diskPending.size === 0) return
    this.diskWriting = true
    this.persistence = (async () => {
      while (this.diskPending.size > 0) {
        await new Promise<void>(resolve => { setTimeout(resolve, 0) })
        const [userId, page] = this.diskPending.entries().next().value!
        this.diskPending.delete(userId)
        try { await this.runtime.stateStore.writeDirectoryCache?.(userId, page); this.cacheFailure = undefined }
        catch (error) { this.cacheFailure = error; console.warn('dsh-arkme: directory_cache_write_failed', error instanceof Error ? error.message : 'cache failed') }
      }
    })().finally(() => { this.diskWriting = false; this.flushDisk() })
  }

  private startAvatars(generation: number): void {
    if (this.avatarWork !== undefined) return
    const signal = this.controller.signal
    const pending = (async () => {
      while (this.avatars.size > 0 && generation === this.generation) {
        const items = [...this.avatars.values()].slice(0, PAGE_SIZE)
        for (const item of items) this.avatars.delete(keyOf(item))
        const hydrated = await this.source.hydrateDirectoryPage(items.map(item => this.sources.get(keyOf(item)) ?? item), signal)
        if (generation !== this.generation) return
        // Decorations cannot roll back message or preference changes made during hydration.
        this.apply(hydrated.filter(item => this.sources.has(keyOf(item))).map(item => {
          const updated = { ...this.sources.get(keyOf(item))!, avatarRef: item.avatarRef ?? '', avatarRefs: item.avatarRefs ?? [] }
          if (item.groupAvatar === undefined) delete updated.groupAvatar
          else updated.groupAvatar = item.groupAvatar
          return updated
        }), [], this.revision, true)
        const refs = new Set(hydrated.flatMap(item => [item.avatarRef, ...(item.avatarRefs ?? [])]).filter((ref): ref is string => ref !== undefined && ref.trim() !== ''))
        for (const ref of refs) {
          signal.throwIfAborted()
          await this.warmAvatar(ref, signal).catch(() => undefined)
        }
        if (refs.size > 0 && generation === this.generation) {
          this.revision++
          const page = this.snapshot([], [])
          this.emit({ ...page, projection: { ...page.projection!, avatarRefs: [...refs] } })
        }
      }
    })().catch(() => { /* Decorations keep their last good snapshot and retry on the next directory sync. */ })
      .finally(() => { if (this.avatarWork === pending) this.avatarWork = undefined })
    this.avatarWork = pending
  }

  async rememberBots(items: ArkmeBotSummary[], expectedUserId: number): Promise<void> {
    if (this.userId !== undefined && this.userId !== expectedUserId) return
    await this.activate()
    if (this.userId !== expectedUserId) return
    const generation = this.generation
    const atRevision = this.revision
    const visible = await this.preferences.query([], items.map(bot => bot.botRef), this.controller.signal)
    if (generation !== this.generation) return
    const merged = new Map(this.bots.map(bot => [bot.directoryKey ?? bot.botRef, bot]))
    for (const bot of items) {
      if (this.deletedBotRefs.has(bot.botRef)) continue
      const key = bot.directoryKey ?? bot.botRef
      const previous = merged.get(key)
      const next = { ...previous, ...bot }
      if ((previous?.latestMessageAtMillis ?? 0) > (bot.latestMessageAtMillis ?? 0)) {
        next.latestMessageAtMillis = previous!.latestMessageAtMillis!
        if (previous!.latestMessagePreview !== undefined) next.latestMessagePreview = previous!.latestMessagePreview
        else delete next.latestMessagePreview
      } else if (bot.latestMessageAtMillis !== undefined && bot.latestMessagePreview === undefined) {
        delete next.latestMessagePreview
      }
      next.conversationListActivityAtMillis = Math.max(previous?.conversationListActivityAtMillis ?? 0, bot.conversationListActivityAtMillis ?? 0)
      merged.set(key, next)
    }
    for (const bot of this.bots) if (bot.directoryKey !== undefined) this.cachedBotKeys.set(bot.botRef, bot.directoryKey)
    while (this.cachedBotKeys.size > MAX_ROWS) this.cachedBotKeys.delete(this.cachedBotKeys.keys().next().value!)
    this.bots = [...merged.values()]
    const currentRefs = new Set(this.bots.map(bot => bot.botRef))
    for (const [key, entry] of this.visibility) {
      if (entry.entryKind === 'bot' && !currentRefs.has(entry.entryRef)) { this.visibility.delete(key); this.visibilityMutations.delete(key) }
    }
    this.apply([], visible.items.filter(item => !this.deletedBotRefs.has(item.entryRef)), atRevision)
  }

  async forgetSource(sourceRef: string, expectedUserId: number): Promise<void> {
    await this.activate()
    if (this.userId !== expectedUserId) return
    const generation = this.generation
    const source = [...this.sources.values()].find(item => item.sourceRef === sourceRef)
    const key = source === undefined
      ? await this.source.chatDirectorySourceKey(expectedUserId, (await this.source.openSourceRef(sourceRef, expectedUserId)).ownerRef)
      : keyOf(source)
    if (generation !== this.generation) return
    this.sources.delete(key); this.mutations.delete(key); this.avatars.delete(key)
    this.visibility.delete(`source:${sourceRef}`); this.visibilityMutations.delete(`source:${sourceRef}`)
    this.sourceRemovals.set(key, this.revision + 1)
    if (this.sourceRemovals.size > MAX_ROWS) this.sourceRemovals.delete(this.sourceRemovals.keys().next().value!)
    this.publish([])
  }

  async forgetBot(botRef: string, expectedUserId?: number): Promise<void> {
    await this.activate()
    if (expectedUserId !== undefined && this.userId !== expectedUserId) return
    this.deletedBotRefs.add(botRef)
    const deleted = this.bots.find(bot => bot.botRef === botRef || bot.directoryKey !== undefined && bot.directoryKey === this.cachedBotKeys.get(botRef))
    if (deleted !== undefined) this.deletedBotRefs.add(deleted.botRef)
    while (this.deletedBotRefs.size > MAX_ROWS) this.deletedBotRefs.delete(this.deletedBotRefs.values().next().value!)
    if (deleted !== undefined) this.botPinnedKeys.delete(deleted.directoryKey ?? deleted.botRef)
    this.visibility.delete(`bot:${botRef}`); this.visibilityMutations.delete(`bot:${botRef}`)
    this.bots = this.bots.filter(bot => bot !== deleted)
    this.publish([])
  }

  async pinBot(botRef: string, pinned: boolean): Promise<void> {
    await this.activate()
    const generation = this.generation
    let bot = this.bots.find(item => item.botRef === botRef || item.directoryKey !== undefined && item.directoryKey === this.cachedBotKeys.get(botRef))
    if (bot === undefined) {
      const fresh = await this.readBots(this.controller.signal)
      if (generation !== this.generation) throw new ArkmePluginError('login-context-changed', '账号已切换', false, 409)
      bot = fresh.items.find(item => item.botRef === botRef && !this.deletedBotRefs.has(item.botRef))
      if (bot !== undefined) this.bots.push(bot)
    }
    if (bot === undefined) throw new ArkmePluginError('bot-directory-entry-unavailable', '请先加载当前账号的 Bot 目录', false, 404)
    const key = bot.directoryKey ?? bot.botRef
    const previous = this.botPinnedKeys.has(key)
    if (pinned) this.botPinnedKeys.add(key)
    else this.botPinnedKeys.delete(key)
    const admitted = this.publish([])
    while (this.diskWriting) await this.persistence
    if (generation !== this.generation) throw new ArkmePluginError('login-context-changed', '账号已切换', false, 409)
    if (!admitted || this.cacheFailure !== undefined) {
      if (previous) this.botPinnedKeys.add(key); else this.botPinnedKeys.delete(key)
      this.publish([])
      throw new ArkmePluginError('directory-cache-write-failed', '本地置顶状态保存失败，请重试', true, 500)
    }
  }

  async rememberSpecial(patch: typeof this.special, expectedUserId?: number): Promise<void> {
    await this.activate()
    if (expectedUserId !== undefined && this.userId !== expectedUserId) return
    if (patch.arkoPreview !== undefined && this.special.arkoPreview !== undefined && patch.arkoPreview.createdAtMillis < this.special.arkoPreview.createdAtMillis) delete patch.arkoPreview
    const next = { ...this.special, ...patch }
    if (JSON.stringify(next) === JSON.stringify(this.special)) return
    this.special = next
    this.publish([])
  }

  async confirmVisibility(entryKind: 'source' | 'bot', entryRef: string, hidden: boolean, expectedUserId?: number): Promise<void> {
    await this.activate()
    if (expectedUserId !== undefined && this.userId !== expectedUserId) return
    if (entryKind === 'bot') {
      const current = this.bots.find(bot => bot.botRef === entryRef || bot.directoryKey !== undefined && bot.directoryKey === this.cachedBotKeys.get(entryRef))
      if (current !== undefined) {
        const generation = this.generation
        const atRevision = this.revision
        const visible = await this.preferences.query([], [current.botRef], this.controller.signal)
        if (generation === this.generation) this.apply([], visible.items, atRevision)
        return
      }
    }
    this.apply([], [{ entryKind, entryRef, hidden }])
  }

  async confirmPin(sourceRef: string, pinned: boolean, policyUpdatedAtMillis: number, expectedUserId?: number): Promise<void> {
    await this.activate()
    if (expectedUserId !== undefined && this.userId !== expectedUserId) return
    const source = [...this.sources.values()].find(item => item.sourceRef === sourceRef)
    if (source !== undefined) this.apply([{ ...source, isPinned: pinned, chatPolicyUpdatedAtMillis: policyUpdatedAtMillis }])
  }

  async accept(event: ArkmeChatClientEvent): Promise<void> {
    const generation = this.generation
    const atRevision = this.revision
    if (this.userId === undefined || (await this.runtime.accountScopedSession())?.userId !== this.userId || generation !== this.generation) return
    if (event.type === 'sessions-delta') {
      if (event.updates.some(item => this.sourceRemovals.has(keyOf(item.source)))) {
        if (this.scan === undefined) this.startScan()
        else this.rescanRequested = true
      }
      const sources = event.updates.filter(item => !this.sourceRemovals.has(keyOf(item.source))).map(item => mergeDirectorySource(this.sources.get(keyOf(item.source)), item.source))
      try {
        const visibility = await this.preferences.query(sources.map(item => item.sourceRef), [], this.controller.signal)
        if (generation !== this.generation) return
        this.apply(sources, visibility.items, atRevision)
      } catch (error) {
        if (generation !== this.generation || this.controller.signal.aborted) return
        // Keep confirmed row facts and visibility; the existing attention retry resumes the failed directory scan.
        this.phase = 'failed'
        this.error = error instanceof Error ? error.message : '会话可见性刷新失败'
        this.apply(sources, [], atRevision)
      }
    } else if (event.type === 'read-ack') {
      const source = [...this.sources.values()].find(item => item.sourceKey === event.sourceKey || item.sourceRef === event.sourceRef)
      if (source !== undefined) this.apply([{ ...source, readSequence: Math.max(source.readSequence ?? 0, event.effectiveReadSequence),
        ...((source.latestSequence ?? 0) <= event.effectiveReadSequence ? { unreadCount: event.unreadCount, badgeUnreadCount: source.isMuted ? 0 : event.unreadCount, ...(event.unreadCount === 0 ? { hasUnreadMention: false } : {}) } : {}) }])
      else {
        const key = event.sourceKey ?? event.sourceRef
        const previous = this.pendingReadAcks.get(key)
        if (previous === undefined || previous.effectiveReadSequence < event.effectiveReadSequence) this.pendingReadAcks.set(key, event)
        if (this.pendingReadAcks.size > MAX_ROWS) this.pendingReadAcks.delete(this.pendingReadAcks.keys().next().value!)
      }
    } else if (event.type === 'chat-pins-reconciled') {
      this.apply([...this.sources.values()].flatMap(source => {
        const pin = event.pins.find(item => item.sourceKey === source.sourceKey)
        return pin === undefined ? [] : [{ ...source, isPinned: pin.pinned, chatPolicyUpdatedAtMillis: pin.policyUpdatedAtMillis }]
      }))
    } else if (event.type === 'conversation-list-preference-invalidated' || event.type === 'chat-policy-invalidated') {
      if (this.scan === undefined) this.startScan()
      else this.rescanRequested = true
    }
  }
}
