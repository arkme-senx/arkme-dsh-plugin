import type {
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptSummary,
  ArkmeMessageReadReceiptSummaryList,
} from '../types.js'
import { ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS } from '../types.js'
import { callArkme } from './api.js'

const SUMMARY_DEBOUNCE_MS = 180
const SUMMARY_POLL_MS = 15_000
const SUMMARY_MAX_POLL_MS = 60_000
const DETAIL_CACHE_TTL_MS = 30_000

export interface ArkmeMessageReadReceiptTarget {
  sourceRef: string
  sourceKey: string
  conversationKind: 'private_chat' | 'group_chat'
  itemUid: string
  sequence: number
}

export type ArkmeMessageReadReceiptEntryStatus =
  | 'unknown'
  | 'provisional'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'error'

export interface ArkmeMessageReadReceiptEntry {
  target: ArkmeMessageReadReceiptTarget
  status: ArkmeMessageReadReceiptEntryStatus
  summary?: ArkmeMessageReadReceiptSummary
}

interface TrackedTarget {
  target: ArkmeMessageReadReceiptTarget
  registrations: number
}

interface DetailCacheEntry {
  target: ArkmeMessageReadReceiptTarget
  expiresAtMillis: number
  pending: Promise<ArkmeMessageReadReceiptDetail>
  value?: ArkmeMessageReadReceiptDetail
}

export interface ArkmeMessageReadReceiptStoreOptions {
  loadSummaries?: (
    sourceRef: string,
    items: readonly { itemUid: string; sequence: number }[],
    signal: AbortSignal,
  ) => Promise<ArkmeMessageReadReceiptSummaryList>
  loadDetail?: (
    sourceRef: string,
    itemUid: string,
    sequence: number,
    signal: AbortSignal,
  ) => Promise<ArkmeMessageReadReceiptDetail>
  now?: () => number
}

function targetKey(target: Pick<ArkmeMessageReadReceiptTarget, 'sourceKey' | 'itemUid' | 'sequence'>): string {
  return JSON.stringify([target.sourceKey, target.itemUid, target.sequence])
}

function sameTarget(
  left: ArkmeMessageReadReceiptTarget,
  right: Pick<ArkmeMessageReadReceiptTarget, 'sourceRef' | 'itemUid' | 'sequence'>,
): boolean {
  return left.sourceRef === right.sourceRef && left.itemUid === right.itemUid && left.sequence === right.sequence
}

function validTarget(target: ArkmeMessageReadReceiptTarget): boolean {
  return target.sourceRef.trim() !== '' && target.sourceKey.trim() !== '' && target.itemUid.trim() !== ''
    && Number.isSafeInteger(target.sequence) && target.sequence > 0
}

function needsRefresh(entry: ArkmeMessageReadReceiptEntry | undefined): boolean {
  return entry === undefined || entry.status === 'unknown' || entry.status === 'provisional'
    || entry.status === 'stale' || entry.status === 'error'
}

function shouldPoll(entry: ArkmeMessageReadReceiptEntry | undefined): boolean {
  if (entry?.status !== 'ready' || entry.summary === undefined) return true
  const summary = entry.summary
  if (summary.totalMemberCount <= 0) return true
  return summary.status !== 'read' || summary.unreadCount > 0
}

export class ArkmeMessageReadReceiptStore {
  private readonly loadSummaries: NonNullable<ArkmeMessageReadReceiptStoreOptions['loadSummaries']>
  private readonly loadDetail: NonNullable<ArkmeMessageReadReceiptStoreOptions['loadDetail']>
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private readonly entries = new Map<string, ArkmeMessageReadReceiptEntry>()
  private readonly tracked = new Map<string, TrackedTarget>()
  private readonly visible = new Set<string>()
  private readonly detailCache = new Map<string, DetailCacheEntry>()
  private readonly detailControllers = new Set<AbortController>()
  private accountUserId: number | undefined
  private generation = 0
  private revision = 0
  private foreground = true
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private summaryController: AbortController | undefined
  private summaryInFlight = false
  private refreshQueued = false
  private failureCount = 0

  constructor(options: ArkmeMessageReadReceiptStoreOptions = {}) {
    this.loadSummaries = options.loadSummaries ?? (async (sourceRef, items, signal) => await callArkme(
      'source.read-receipts.summary-list', { sourceRef, items }, signal,
    ))
    this.loadDetail = options.loadDetail ?? (async (sourceRef, itemUid, sequence, signal) => await callArkme(
      'source.read-receipts.detail', { sourceRef, itemUid, sequence }, signal,
    ))
    this.now = options.now ?? Date.now
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): number => this.revision

  activateAccount(userId: number | undefined): void {
    const normalized = userId !== undefined && Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
    if (this.accountUserId === normalized) return
    const preserveMountedTargets = this.accountUserId === undefined && normalized !== undefined
    this.accountUserId = normalized
    this.generation += 1
    this.cancelScheduledWork()
    for (const controller of this.detailControllers) controller.abort()
    this.detailControllers.clear()
    this.entries.clear()
    if (preserveMountedTargets) {
      for (const [key, item] of this.tracked) this.entries.set(key, { target: item.target, status: 'unknown' })
    } else {
      this.tracked.clear()
      this.visible.clear()
    }
    this.detailCache.clear()
    this.failureCount = 0
    this.publish()
    if (preserveMountedTargets) this.scheduleFlush(0)
  }

  register(target: ArkmeMessageReadReceiptTarget): () => void {
    if (!validTarget(target)) return () => undefined
    const normalized = {
      ...target,
      sourceRef: target.sourceRef.trim(),
      sourceKey: target.sourceKey.trim(),
      itemUid: target.itemUid.trim(),
    }
    const key = targetKey(normalized)
    const current = this.tracked.get(key)
    this.tracked.set(key, {
      target: normalized,
      registrations: (current?.registrations ?? 0) + 1,
    })
    if (!this.entries.has(key)) this.entries.set(key, { target: normalized, status: 'unknown' })
    return () => {
      const registered = this.tracked.get(key)
      if (registered === undefined) return
      if (registered.registrations > 1) {
        this.tracked.set(key, { ...registered, registrations: registered.registrations - 1 })
        return
      }
      this.tracked.delete(key)
      this.visible.delete(key)
      this.schedulePoll()
    }
  }

  setVisible(target: ArkmeMessageReadReceiptTarget, visible: boolean): void {
    const key = targetKey(target)
    if (!this.tracked.has(key)) return
    if (visible) {
      this.visible.add(key)
      if (needsRefresh(this.entries.get(key))) this.scheduleFlush()
    } else {
      this.visible.delete(key)
    }
    this.schedulePoll()
  }

  get(target: ArkmeMessageReadReceiptTarget): ArkmeMessageReadReceiptEntry | undefined {
    return this.entries.get(targetKey(target))
  }

  provision(target: ArkmeMessageReadReceiptTarget): void {
    if (!validTarget(target) || this.accountUserId === undefined) return
    const key = targetKey(target)
    this.entries.set(key, { target, status: 'provisional' })
    this.publish()
  }

  retry(target: ArkmeMessageReadReceiptTarget): void {
    const key = targetKey(target)
    const current = this.entries.get(key)
    if (current === undefined) return
    this.entries.set(key, { ...current, status: 'stale' })
    this.publish()
    if (this.visible.has(key)) this.scheduleFlush(0)
  }

  invalidate(sourceKey: string, throughSequence: number): void {
    const normalizedKey = sourceKey.trim()
    if (normalizedKey === '' || !Number.isSafeInteger(throughSequence) || throughSequence <= 0) return
    let changed = false
    for (const [key, entry] of this.entries) {
      if (entry.target.sourceKey !== normalizedKey || entry.target.sequence > throughSequence) continue
      this.entries.set(key, { ...entry, status: 'stale' })
      this.detailCache.delete(key)
      changed = true
    }
    for (const [key, entry] of this.detailCache) {
      if (entry.target.sourceKey === normalizedKey && entry.target.sequence <= throughSequence) {
        this.detailCache.delete(key)
      }
    }
    if (!changed) return
    this.publish()
    this.scheduleFlush()
  }

  reconcile(): void {
    if (this.accountUserId === undefined || this.visible.size === 0) return
    this.summaryController?.abort()
    let changed = false
    for (const key of this.visible) {
      const entry = this.entries.get(key)
      if (entry === undefined) continue
      this.entries.set(key, { ...entry, status: 'stale' })
      this.detailCache.delete(key)
      changed = true
    }
    if (changed) this.publish()
    this.scheduleFlush(0)
  }

  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return
    this.foreground = foreground
    if (!foreground) {
      if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
      this.pollTimer = undefined
      return
    }
    this.reconcile()
  }

  async detail(target: ArkmeMessageReadReceiptTarget, force = false): Promise<ArkmeMessageReadReceiptDetail> {
    if (this.accountUserId === undefined) throw new Error('登录后才能查看已读详情')
    if (!validTarget(target) || target.conversationKind !== 'group_chat') throw new Error('该消息不支持成员已读详情')
    const key = targetKey(target)
    const cached = this.detailCache.get(key)
    if (!force && cached !== undefined && cached.expiresAtMillis > this.now()) {
      return cached.value ?? await cached.pending
    }
    const generation = this.generation
    const controller = new AbortController()
    this.detailControllers.add(controller)
    const entry: DetailCacheEntry = {
      target,
      expiresAtMillis: this.now() + DETAIL_CACHE_TTL_MS,
      pending: Promise.resolve(undefined as never),
    }
    entry.pending = this.loadDetail(target.sourceRef, target.itemUid, target.sequence, controller.signal)
      .then(result => {
        if (generation !== this.generation || !sameTarget(target, result)) throw new Error('已读详情已失效')
        entry.value = result
        return result
      })
      .catch(error => {
        if (this.detailCache.get(key) === entry) this.detailCache.delete(key)
        throw error
      })
      .finally(() => { this.detailControllers.delete(controller) })
    this.detailCache.set(key, entry)
    return await entry.pending
  }

  private publish(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  private cancelScheduledWork(): void {
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.flushTimer = undefined
    this.pollTimer = undefined
    this.summaryController?.abort()
    this.summaryController = undefined
    this.summaryInFlight = false
    this.refreshQueued = false
  }

  private scheduleFlush(delay = SUMMARY_DEBOUNCE_MS): void {
    if (this.accountUserId === undefined || !this.foreground || this.visible.size === 0) return
    if (this.summaryInFlight) {
      this.refreshQueued = true
      return
    }
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, delay)
  }

  private async flush(): Promise<void> {
    if (this.summaryInFlight || this.accountUserId === undefined || !this.foreground) return
    const requested = [...this.visible]
      .map(key => ({ key, tracked: this.tracked.get(key), entry: this.entries.get(key) }))
      .filter((item): item is {
        key: string
        tracked: TrackedTarget
        entry: ArkmeMessageReadReceiptEntry
      } => item.tracked !== undefined && item.entry !== undefined && needsRefresh(item.entry))
    if (requested.length === 0) {
      this.schedulePoll()
      return
    }
    this.summaryInFlight = true
    this.refreshQueued = false
    const generation = this.generation
    const controller = new AbortController()
    this.summaryController = controller
    for (const item of requested) this.entries.set(item.key, { ...item.entry, status: 'loading' })
    this.publish()
    const groups = new Map<string, typeof requested>()
    for (const item of requested) {
      const groupKey = JSON.stringify([item.tracked.target.sourceKey, item.tracked.target.sourceRef])
      const group = groups.get(groupKey) ?? []
      group.push(item)
      groups.set(groupKey, group)
    }
    let failed = false
    try {
      for (const group of groups.values()) {
        for (let index = 0; index < group.length; index += ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS) {
          const chunk = group.slice(index, index + ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS)
          try {
            const sourceRef = chunk[0]?.tracked.target.sourceRef
            if (sourceRef === undefined) continue
            const result = await this.loadSummaries(sourceRef, chunk.map(item => ({
              itemUid: item.tracked.target.itemUid,
              sequence: item.tracked.target.sequence,
            })), controller.signal)
            if (generation !== this.generation || controller.signal.aborted) return
            const summaries = new Map(result.items.map(item => [JSON.stringify([item.itemUid, item.sequence]), item]))
            for (const item of chunk) {
              const target = item.tracked.target
              const summary = result.sourceRef === target.sourceRef
                ? summaries.get(JSON.stringify([target.itemUid, target.sequence]))
                : undefined
              this.entries.set(item.key, summary === undefined
                ? { ...item.entry, status: 'error' }
                : { target, status: 'ready', summary })
              if (summary === undefined) failed = true
            }
          } catch (error) {
            if (generation !== this.generation || controller.signal.aborted) return
            failed = true
            for (const item of chunk) this.entries.set(item.key, { ...item.entry, status: 'error' })
          }
        }
      }
      if (generation === this.generation) {
        this.failureCount = failed ? Math.min(this.failureCount + 1, 3) : 0
        this.publish()
      }
    } finally {
      if (this.summaryController === controller) this.summaryController = undefined
      this.summaryInFlight = false
      if (generation === this.generation && this.refreshQueued) this.scheduleFlush(0)
      else this.schedulePoll()
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
    if (!this.foreground || this.accountUserId === undefined || this.visible.size === 0) return
    if (![...this.visible].some(key => shouldPoll(this.entries.get(key)))) return
    const delay = Math.min(SUMMARY_MAX_POLL_MS, SUMMARY_POLL_MS * 2 ** this.failureCount)
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      for (const key of this.visible) {
        const entry = this.entries.get(key)
        if (entry !== undefined && shouldPoll(entry)) this.entries.set(key, { ...entry, status: 'stale' })
      }
      this.publish()
      this.scheduleFlush(0)
    }, delay)
  }
}

export const arkmeMessageReadReceipts = new ArkmeMessageReadReceiptStore()
