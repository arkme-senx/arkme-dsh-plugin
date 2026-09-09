import { arkmeMessageReadReceipts } from './message-read-receipt-store.js'
import { applyMemberUpdate, mergeMemberJoinEvents, validateMemberUpdate, invalidatesMemberSnapshot } from '../member-directory.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberPage, ArkmeConversationMemberPresentation, ArkmeConversationMemberUpdate, ArkmeConversationMemberCache, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'

const MAX_IDLE_GROUPS = 20
const MAX_IDLE_MEMBERS = 20_000
const MAX_AGE_MS = 30_000
const INVALIDATION_DELAY_MS = 180
type Source = Pick<ArkmeSourceItem, 'sourceRef' | 'sourceKey'>
interface LoadingOptions {
  page?: (sourceRef: string, cursor: string | undefined, signal: AbortSignal) => Promise<ArkmeConversationMemberPage>
  presentation?: (sourceRef: string, memberRefs: string[], signal: AbortSignal) => Promise<ArkmeConversationMemberPresentation>
  cached?: (sourceRef: string, signal: AbortSignal) => Promise<ArkmeConversationMemberCache | null>
}

export interface ConversationMembersSnapshot {
  items: readonly ArkmeConversationMemberItem[]
  joinEvents: ArkmeConversationMemberCache['joinEvents']
  selfRole: ArkmeConversationMemberItem['role']
  ready: boolean
  complete: boolean
  cached: boolean
  refreshing: boolean
  error: string | undefined
}

export const EMPTY_CONVERSATION_MEMBERS: ConversationMembersSnapshot = {
  items: [], joinEvents: [], selfRole: 'unknown', ready: false, complete: false, cached: false, refreshing: false, error: undefined,
}

interface Entry {
  account: string
  source: Source
  members: Map<string, ArkmeConversationMemberItem>
  snapshot: ConversationMembersSnapshot
  listeners: Set<() => void>
  revision: number
  refreshedAt: number
  stale: boolean
  pending: Promise<void> | undefined
  controller: AbortController | undefined
  timer: ReturnType<typeof setTimeout> | undefined
}

function key(source: Source): string { return source.sourceKey ?? source.sourceRef }
function entryKey(account: string | undefined, source: Source): string { return JSON.stringify([account, key(source)]) }

/** One account/runtime-scoped member directory; React only observes its snapshots. */
export class ConversationMembersStore {
  private account: string | undefined
  private entries = new Map<string, Entry>()
  private foreground = true

  constructor(private readonly loading: LoadingOptions = {}, private readonly now = Date.now) {}


  activateAccount(account: string | undefined): void {
    if (account === this.account) return
    this.account = account
    for (const [identity, entry] of [...this.entries]) {
      if (entry.account !== account) {
        this.entries.delete(identity)
        this.cancel(entry)
      }
      for (const listener of entry.listeners) listener()
      if (entry.account === account) queueMicrotask(() => { void this.ensure(entry.account, entry.source) })
    }
  }

  reset(): void {
    for (const entry of this.entries.values()) {
      this.cancel(entry)
      entry.revision += 1
      entry.members.clear()
      entry.stale = true
      entry.refreshedAt = 0
      this.publish(entry, EMPTY_CONVERSATION_MEMBERS)
      this.schedule(entry)
    }
  }

  get(account: string | undefined, source: Source | undefined): ConversationMembersSnapshot {
    return account === this.account && source !== undefined
      ? this.entries.get(entryKey(account, source))?.snapshot ?? EMPTY_CONVERSATION_MEMBERS
      : EMPTY_CONVERSATION_MEMBERS
  }

  subscribe(account: string, source: Source, listener: () => void): () => void {
    const identity = entryKey(account, source)
    let entry = this.entries.get(identity)
    if (entry === undefined) {
      entry = {
        account, source, members: new Map(), snapshot: EMPTY_CONVERSATION_MEMBERS, listeners: new Set(),
        revision: 0, refreshedAt: 0, stale: true, pending: undefined, controller: undefined, timer: undefined,
      }
      this.entries.set(identity, entry)
    }
    if (entry.source.sourceRef !== source.sourceRef) {
      entry.revision += 1
      entry.stale = true
      this.cancel(entry)
      this.publish(entry, { selfRole: 'unknown' })
    }
    entry.source = source
    entry.listeners.add(listener)
    this.entries.delete(identity)
    this.entries.set(identity, entry)
    const current = entry
    // Wait until React has finished subscribing, including Strict Mode's remount.
    queueMicrotask(() => {
      if (this.entries.get(identity) === current && current.listeners.size > 0) void this.ensure(account, current.source)
    })
    this.evict()
    return () => {
      current.listeners.delete(listener)
      queueMicrotask(() => {
        if (current.listeners.size === 0) { this.cancel(current); this.evict() }
      })
    }
  }

  async ensure(account: string, source: Source, force = false): Promise<void> {
    const entry = account === this.account ? this.entries.get(entryKey(account, source)) : undefined
    if (entry === undefined || entry.listeners.size === 0 || !this.foreground) return
    entry.source = source
    if (entry.pending !== undefined) return await entry.pending
    if (!force && !entry.stale && this.now() - entry.refreshedAt < MAX_AGE_MS) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = undefined
    const revision = ++entry.revision
    const controller = new AbortController()
    entry.controller = controller
    entry.stale = false
    this.publish(entry, { refreshing: true, complete: false, selfRole: 'unknown', error: undefined })
    entry.pending = Promise.resolve().then(() => this.loadPages(account, entry, revision, controller))
      .catch(error => {
        if (controller.signal.aborted || account !== this.account || this.entries.get(entryKey(account, source)) !== entry) return
        if (revision !== entry.revision) return
        if (invalidatesMemberSnapshot(error)) {
          controller.abort()
          entry.members.clear()
          this.publish(entry, EMPTY_CONVERSATION_MEMBERS)
        }
        entry.stale = true
        this.publish(entry, { error: error instanceof Error ? error.message : '成员加载失败，请重试' })
      })
      .finally(() => {
        if (entry.controller !== controller) return
        entry.pending = undefined
        entry.controller = undefined
        this.publish(entry, { refreshing: false })
        if (revision !== entry.revision) this.schedule(entry)
      })
    await entry.pending
  }

  private async loadPages(account: string, entry: Entry, revision: number, controller: AbortController): Promise<void> {
    const current = () => !controller.signal.aborted && this.account === account && this.entries.get(entryKey(account, entry.source)) === entry && revision === entry.revision
    let remoteProgress = false
    const sourceRef = entry.source.sourceRef
    const cached = this.loading.cached ?? ((ref, signal) => callArkme<ArkmeConversationMemberCache | null>('source.members.cached', { sourceRef: ref }, signal))
    if (!entry.snapshot.ready) void cached(sourceRef, controller.signal).then(value => {
      if (!current() || remoteProgress || value === null || value === undefined) return
      if (!Array.isArray(value.items) || value.items.length > MAX_IDLE_MEMBERS || value.items.some(member => !member.memberRef || member.status !== 'active')) return
      entry.members = new Map(value.items.map(member => [member.memberRef, member]))
      this.publish(entry, { items: value.items, joinEvents: value.joinEvents, ready: true, cached: true, complete: false })
    }).catch(() => undefined)
    const loadPage = this.loading.page ?? ((ref, cursor, signal) => callArkme<ArkmeConversationMemberPage>('source.members.page', {
      sourceRef: ref, limit: 50, ...(cursor === undefined ? {} : { cursor }),
    }, signal))
    const loadPresentation = this.loading.presentation ?? ((ref, memberRefs, signal) => callArkme<ArkmeConversationMemberPresentation>('source.members.presentation', {
      sourceRef: ref, memberRefs,
    }, signal))
    const seen = new Set<string>()
    const cursors = new Set<string>()
    const enrichmentController = new AbortController()
    const enrichmentSignal = AbortSignal.any([controller.signal, enrichmentController.signal])
    const pending = new Set<Promise<void>>()
    const queued = new Set<string>()
    let presentationFailed = false
    const drain = () => {
      while (current() && !enrichmentSignal.aborted && queued.size > 0 && pending.size < 2) {
        const refs = [...queued].slice(0, 50)
        for (const ref of refs) queued.delete(ref)
        const work = loadPresentation(sourceRef, refs, enrichmentSignal).then(update => {
          if (!current() || enrichmentSignal.aborted) return
          this.applyUpdate(entry, update)
          if (update.unavailableProfileMemberRefs.length > 0 || update.items.some(item => item.statsKnown === false)) presentationFailed = true
        }).catch(error => {
          if (!current() || enrichmentSignal.aborted) return
          if (invalidatesMemberSnapshot(error)) {
            this.clear(account, entry.source)
            this.publish(entry, { error: error instanceof Error ? error.message : '群成员访问权限已失效' })
          } else presentationFailed = true
        }).finally(() => { pending.delete(work); drain() })
        pending.add(work)
      }
    }
    const enrich = (refs: string[]) => { for (const ref of refs) queued.add(ref); drain() }
    let cursor: string | undefined
    try {
      for (let index = 0; index < 200; index++) {
        if (!current()) return
        const page = await loadPage(sourceRef, cursor, controller.signal)
        if (!current()) return
        this.applyUpdate(entry, page)
        remoteProgress = true
        this.publish(entry, { cached: false })
        for (const member of page.items) seen.add(member.memberRef)
        for (const ref of page.removedMemberRefs) seen.add(ref)
        enrich(page.items.map(member => member.memberRef))
        if (!page.hasMore) {
          // Paged live traversal is not an atomic snapshot. Verify missing cached members explicitly.
          const missing = [...entry.members.keys()].filter(ref => !seen.has(ref))
          enrich(missing)
          while (current() && pending.size > 0) await Promise.race(pending)
          if (!current()) return
          entry.refreshedAt = this.now()
          entry.stale = presentationFailed
          this.publish(entry, { complete: true, cached: false, error: presentationFailed ? '部分成员资料未更新，请重试' : undefined })
          return
        }
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('成员分页游标重复或缺失，请重试')
        cursors.add(page.nextCursor)
        cursor = page.nextCursor
      }
      throw new Error('成员分页超过本次加载上限，已保留当前列表，请重试')
    } finally {
      queued.clear()
      enrichmentController.abort()
    }
  }

  private applyUpdate(entry: Entry, page: ArkmeConversationMemberUpdate): void {
    if (key(page.source) !== key(entry.source)) throw new Error('成员响应会话不匹配')
    validateMemberUpdate(page)
    const joins = page.kind === 'membership' ? mergeMemberJoinEvents(entry.snapshot.joinEvents, page.joinEvents ?? []) : entry.snapshot.joinEvents
    const previousSelf = entry.snapshot.items.find(member => member.isSelf)
    const selfRole = page.kind === 'membership' ? page.selfRole : (previousSelf !== undefined && page.removedMemberRefs.includes(previousSelf.memberRef) ? 'unknown' : entry.snapshot.selfRole)
    const changed = applyMemberUpdate(entry.members, page)
    const rank = (role: string) => role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3
    const items = changed ? [...entry.members.values()].sort((left, right) => rank(left.role) - rank(right.role)
      || left.joinedAtMillis - right.joinedAtMillis || left.displayName.localeCompare(right.displayName)) : entry.snapshot.items
    this.publish(entry, { items, selfRole, ready: true, joinEvents: JSON.stringify(joins) === JSON.stringify(entry.snapshot.joinEvents) ? entry.snapshot.joinEvents : joins })
  }

  invalidate(account: string | undefined, source: Source): void {
    if (account === undefined || account !== this.account) return
    arkmeMessageReadReceipts.invalidate(key(source), Number.MAX_SAFE_INTEGER)
    const entry = this.entries.get(entryKey(account, source))
    if (entry === undefined) return
    entry.revision += 1
    entry.stale = true
    this.cancel(entry)
    this.publish(entry, { selfRole: 'unknown' })
    this.schedule(entry)
  }

  remove(account: string | undefined, source: Source, memberRef: string): void {
    if (account === undefined || account !== this.account) return
    const entry = this.entries.get(entryKey(account, source))
    if (entry === undefined) return
    if (entry.members.delete(memberRef)) this.publish(entry, {
      items: entry.snapshot.items.filter(member => member.memberRef !== memberRef),
    })
    this.invalidate(account, source)
  }

  clear(account: string | undefined, source: Source): void {
    if (account === undefined || account !== this.account) return
    const entry = this.entries.get(entryKey(account, source))
    if (entry === undefined) return
    this.cancel(entry)
    entry.revision += 1
    entry.members.clear()
    entry.refreshedAt = this.now()
    entry.stale = false
    this.publish(entry, EMPTY_CONVERSATION_MEMBERS)
  }

  refreshActive(): void {
    if (this.account === undefined) return
    for (const entry of this.entries.values()) {
      if (entry.stale || this.now() - entry.refreshedAt >= MAX_AGE_MS) this.schedule(entry)
    }
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    if (foreground) this.refreshActive()
    else for (const entry of this.entries.values()) this.cancel(entry)
  }

  private schedule(entry: Entry): void {
    if (entry.account !== this.account || !this.foreground || entry.listeners.size === 0 || entry.pending !== undefined || entry.timer !== undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void this.ensure(entry.account, entry.source)
    }, INVALIDATION_DELAY_MS)
  }

  private publish(entry: Entry, patch: Partial<ConversationMembersSnapshot>): void {
    if (Object.entries(patch).every(([field, value]) => entry.snapshot[field as keyof ConversationMembersSnapshot] === value)) return
    entry.snapshot = { ...entry.snapshot, ...patch }
    for (const listener of entry.listeners) listener()
  }

  private cancel(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.controller !== undefined) entry.stale = true
    entry.controller?.abort()
    entry.controller = undefined
    entry.pending = undefined
    this.publish(entry, { refreshing: false })
  }

  private evict(): void {
    let idle = [...this.entries.values()].filter(entry => entry.listeners.size === 0).length
    let members = [...this.entries.values()].reduce((total, entry) => total + (entry.listeners.size === 0 ? entry.members.size : 0), 0)
    for (const [identity, entry] of this.entries) {
      if (idle <= MAX_IDLE_GROUPS && members <= MAX_IDLE_MEMBERS) break
      if (entry.listeners.size > 0) continue
      members -= entry.members.size
      this.cancel(entry)
      this.entries.delete(identity)
      idle -= 1
    }
  }
}

export const arkmeConversationMembers = new ConversationMembersStore()
