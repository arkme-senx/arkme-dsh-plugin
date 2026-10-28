import type { PersonRecordSource, PersonRecordSourcesPage } from '../person-records.js'
import type { ArkmeConversationMemberRecordPage, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { ArkmeClientError } from './api.js'

export type PersonRecordItem = ArkmeTimelineItem & { personSource?: ArkmeSourceItem }
export function personRecordKey(item: PersonRecordItem): string {
  if (!item.personSource) return item.itemUid
  return JSON.stringify([item.personSource.sourceKey ?? item.personSource.sourceRef, item.timelineItemKey ?? item.sequence ?? item.itemUid])
}
interface Stream extends PersonRecordSource { before?: number | undefined; more: boolean; attempted: boolean; failed?: string; frontier: number }
// Signed event refs can hit the Host body limit before its 500-item quota.
// Leave half of the 128 KiB request budget for source/member/cursor metadata.
const validationByteBudget = 64 * 1024
const refBytes = (ref: string) => new TextEncoder().encode(JSON.stringify(ref)).byteLength + 1
function validationBatches(refs: readonly string[]): string[][] {
  const batches: string[][] = []
  let batch: string[] = [], bytes = 2
  for (const ref of refs) {
    const size = refBytes(ref)
    if (size + 2 > validationByteBudget) throw new Error('消息来源引用过大，请重新打开')
    if (batch.length >= 500 || bytes + size > validationByteBudget) { batches.push(batch); batch = []; bytes = 2 }
    batch.push(ref); bytes += size
  }
  if (batch.length) batches.push(batch)
  return batches
}
function pageValidationRefs(refs: readonly string[]): string[] {
  const batch: string[] = []; let bytes = 2
  for (let i = refs.length - 1; i >= 0 && batch.length < 500; i--) {
    const ref = refs[i]!, size = refBytes(ref)
    if (bytes + size > validationByteBudget) break
    batch.push(ref); bytes += size
  }
  return batch.reverse()
}
export interface SharedPersonSnapshot {
  items: PersonRecordItem[]; read: number; discovered: number; discovering: boolean; hasMore: boolean; error: string
}
export interface SharedPersonPort {
  aggregate?(cursor?: string, knownEventRefs?: readonly string[], validateOnly?: boolean): Promise<import('../person-records.js').PersonRecordsPage>
  sources(cursor?: string): Promise<PersonRecordSourcesPage>
  records(source: PersonRecordSource, before?: number, limit?: number): Promise<ArkmeConversationMemberRecordPage>
}
/** Foreground-only composition of existing reads. Each stream owns its own sequence. */
export class SharedPersonRecords {
  private streams = new Map<string, Stream>()
  private items = new Map<string, PersonRecordItem>()
  private discoveryCursor: string | undefined
  private discoveryDone = false
  private discoveryError = ''
  private pending = false
  private validationQueued = false
  private aggregateEnabled: boolean | undefined
  private aggregateCursor: string | undefined
  private aggregateMore = true
  private aggregateItems = new Map<string, PersonRecordItem & { eventRef: string }>()
  constructor(private readonly entry: PersonRecordSource, private readonly port: SharedPersonPort, private readonly signal: AbortSignal, private readonly update: (value: SharedPersonSnapshot) => void) {
    this.add(entry)
  }
  private key(source: ArkmeSourceItem) { return source.sourceKey ?? source.sourceRef }
  private add(value: PersonRecordSource) {
    const key = this.key(value.source)
    if (!this.streams.has(key)) this.streams.set(key, { ...value, more: true, attempted: false, frontier: Infinity })
  }
  snapshot(): SharedPersonSnapshot {
    if (this.aggregateEnabled) {
      const items = [...this.aggregateItems.values()].sort((a,b) => b.sendAtMillis-a.sendAtMillis)
      const sources = new Set(items.map(item => item.personSource?.sourceKey ?? item.personSource?.sourceRef))
      return { items, read: sources.size, discovered: sources.size, discovering: false, hasMore: this.aggregateMore, error: this.discoveryError }
    }
    const streams = [...this.streams.values()]
    return { items: [...this.items.values()].sort((a, b) => b.sendAtMillis - a.sendAtMillis || personRecordKey(a).localeCompare(personRecordKey(b))),
      read: streams.filter(row => row.attempted && !row.failed).length, discovered: streams.length, discovering: !this.discoveryDone,
      hasMore: !this.discoveryDone || streams.some(row => row.more || row.failed),
      error: this.discoveryError || (streams.some(row => row.failed) ? '部分对话读取失败，可重试；已加载内容仍可查看。' : '') }
  }
  private emit() { this.signal.throwIfAborted(); this.update(this.snapshot()) }
  private async read(stream: Stream, older: boolean) {
    this.signal.throwIfAborted()
    try {
      const before = older ? stream.before : undefined
      const page = await this.port.records(stream, before, older ? 30 : stream === this.streams.get(this.key(this.entry.source)) ? 12 : 3)
      this.signal.throwIfAborted()
      const next = page.nextCursor?.beforeSequence
      if (page.hasMore && (next === undefined || !Number.isSafeInteger(next) || next <= 0 || (before !== undefined && next >= before))) throw new Error('快记分页游标无效，请重试')
      if ((page.source?.sourceKey && page.source.sourceKey !== stream.source.sourceKey) || (page.member?.memberRef && page.member.memberRef !== stream.memberRef)) throw new Error('消息来源不一致，请重试')
      if (page.items.some(row => row.memberRef && row.memberRef !== stream.memberRef)) throw new Error('消息发送人不一致，请重试')
      for (const row of page.items) {
        const item = { ...row, personSource: page.source ?? stream.source }
        this.items.set(personRecordKey(item), item)
      }
      stream.attempted = true; delete stream.failed
      stream.more = page.hasMore; stream.before = next
      stream.frontier = Math.min(stream.frontier, ...page.items.map(row => row.sendAtMillis))
      // Keep signed media/action references renewed with the page's source.
      stream.source = page.source ?? stream.source
    } catch (error) {
      this.signal.throwIfAborted()
      if (error instanceof ArkmeClientError && !error.body.retryable) {
        for (const [key, item] of this.items) if (item.personSource && this.key(item.personSource) === this.key(stream.source)) this.items.delete(key)
        stream.more = false; stream.attempted = true
        if (this.key(stream.source) === this.key(this.entry.source)) throw error
      }
      stream.failed = error instanceof Error ? error.message : '读取失败'
    }
    this.emit()
  }
  private async reads(streams: Stream[], older: boolean) {
    let index = 0
    await Promise.all([0, 1].map(async () => {
      while (index < streams.length) { this.signal.throwIfAborted(); const stream = streams[index++]!; await this.read(stream, older || stream.attempted) }
    }))
  }
  async revalidate(): Promise<void> {
    if (!this.aggregateEnabled || !this.port.aggregate || this.aggregateItems.size === 0) return
    if (this.pending) { this.validationQueued = true; return }
    this.pending = true
    try {
      // 500 is the server's per-request validation batch, not a history limit.
      const batches = validationBatches([...this.aggregateItems.keys()])
      for (const refs of batches) {
        this.signal.throwIfAborted()
        const page = await this.port.aggregate(undefined, refs, true)
        this.signal.throwIfAborted()
        if (!page.supported) throw new Error('人物内容权限验证暂不可用，请重试')
        for (const ref of page.removedEventRefs) this.aggregateItems.delete(ref)
        if (page.removedEventRefs.length) this.emit()
      }
      this.discoveryError = ''; this.emit()
    } catch (error) {
      this.signal.throwIfAborted()
      if (error instanceof ArkmeClientError && !error.body.retryable) { this.aggregateItems.clear(); this.aggregateMore = false }
      this.discoveryError = error instanceof Error ? error.message : '权限验证暂时失败，请重试'; this.emit()
    } finally { this.pending = false; if (this.validationQueued) { this.validationQueued = false; await this.revalidate() } }
  }
  async load(older = false): Promise<void> {
    if (this.pending) return
    this.pending = true
    try {
      this.signal.throwIfAborted()
      if (this.port.aggregate && this.aggregateEnabled !== false) {
        try {
          // Keep normal paging to one request. Permission invalidations above
          // cover all retained pages in bounded, cancellable batches.
          const page = await this.port.aggregate(this.aggregateCursor, pageValidationRefs([...this.aggregateItems.keys()]))
          this.signal.throwIfAborted()
          if (page.supported) {
            if (page.hasMore && (!page.nextCursor || page.nextCursor === this.aggregateCursor)) throw new Error('人物内容分页未推进，请重试')
            this.aggregateEnabled = true
            for (const ref of page.removedEventRefs) this.aggregateItems.delete(ref)
            for (const row of page.items) this.aggregateItems.set(row.eventRef, row)
            this.aggregateMore = page.hasMore; this.aggregateCursor = page.nextCursor; this.discoveryError = ''; this.emit(); return
          }
          if (this.aggregateEnabled) throw new Error('人物内容汇总暂不可用，请重试')
          this.aggregateEnabled = false
        } catch (error) {
          this.signal.throwIfAborted()
          if (error instanceof ArkmeClientError && !error.body.retryable) {
            this.aggregateItems.clear(); this.aggregateMore = false; this.emit(); throw error
          }
          this.discoveryError = error instanceof Error ? error.message : '汇总暂时失败，可重试'
          if (this.aggregateEnabled) { this.emit(); return }
          throw error
        }
      }
      const retry = [...this.streams.values()].filter(row => !row.attempted || row.failed)
      await this.reads(retry, false)
      // At most one discovery page per user-visible batch. Large directories
      // continue through the same load-more path instead of unbounded fanout.
      if (!this.discoveryDone) {
        try {
          const page = await this.port.sources(this.discoveryCursor)
          this.signal.throwIfAborted()
          if (page.hasMore && (!page.nextCursor || page.nextCursor === this.discoveryCursor)) throw new Error('共同对话分页未推进，请重试')
          for (const row of page.items) this.add(row)
          this.discoveryCursor = page.nextCursor; this.discoveryDone = !page.hasMore; this.discoveryError = ''
          this.emit()
          await this.reads([...this.streams.values()].filter(row => !row.attempted && !row.failed), false)
        } catch (error) {
          this.signal.throwIfAborted()
          if (error instanceof ArkmeClientError && !error.body.retryable) { this.items.clear(); throw error }
          this.discoveryError = '共同对话列表读取失败，可重试；已加载内容仍可查看。'
          this.emit()
        }
      } else if (older && !retry.length) {
    const streams = [...this.streams.values()].filter(row => row.more && !row.failed)
          .sort((a, b) => b.frontier - a.frontier).slice(0, 2)
        await this.reads(streams, true)
      }
    } finally { this.pending = false; if (this.validationQueued) { this.validationQueued = false; await this.revalidate() } }
  }
}
