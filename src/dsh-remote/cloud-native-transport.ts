import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import * as surface from '@deepseek-ai/dsh-session/surface'
import { snapshotDshHistoryEntry } from './dsh-event-contract.js'
import { DshRemoteError } from './errors.js'
import { nativeRecord as object } from './native-transport.js'
import { fiveTurnPage, readFiveTurns, type NativeHistoryPage, type NativeHistoryRecord } from './native-history.js'
import { readCloudTurnHistory } from './cloud-turn-history.js'
import { DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES } from './types.js'
import type { DshRemoteHttpRequester } from './control-plane.js'
import type { DshNativeHistoryCache } from './native-history-cache.js'

const BASE = '/api/v1/dsh-remote'
const unavailable = () => new DshRemoteError('CAPABILITY_UNSUPPORTED', '云端原始历史不完整或与当前 DSH 不兼容，需要源电脑补齐')
// Old servers have no trustworthy generation fence: their persisted cache is a
// miss. History progress invalidates content; display metadata does not.
function cacheRevision(row: Record<string, unknown>): string | undefined {
  if (typeof row.history_revision !== 'string' || !row.history_revision) return
  return JSON.stringify(['cloud-history-v2', row.history_revision, row.history_storage_version, row.projection_as_of_seq, row.last_event_seq, row.history_complete_through_seq, row.turn_projection_as_of_seq, row.turn_projection_complete_through_seq])
}
function cacheGeneration(row: Record<string, unknown>): string | undefined {
  return cacheRevision(row) === undefined ? undefined : JSON.stringify([row.history_revision, row.history_storage_version])
}
function metadataRevision(row: Record<string, unknown>): string {
  return JSON.stringify([row.created_at ?? null, row.title ?? null])
}
function watchRevision(row: Record<string, unknown>): string {
  return JSON.stringify([cacheRevision(row), metadataRevision(row)])
}
type Cache = { store: Pick<DshNativeHistoryCache, 'snapshot' | 'page' | 'write'>; key(session: string): string }
type Lease = { controller: AbortController; touched: number; busy: boolean; watch?: { runtime: string; session: string; revision: string; body: Record<string, unknown>; cache: Cache | undefined } }

function nativeHistoryRecord(raw: unknown): NativeHistoryRecord {
  const validators = surface as unknown as { validateSurfaceMetadata?: (event: unknown) => void; validateSessionEventData?: (event: unknown, subject: string) => void }
  if (!validators.validateSurfaceMetadata || !validators.validateSessionEventData) {
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '当前 DSH 不支持原生日志校验，请更新当前客户端')
  }
  try {
    const entry = snapshotDshHistoryEntry(object(raw) as { event: unknown })
    if (!Number.isSafeInteger(entry.event.time) || Object.is(entry.event.seq, -0)) throw unavailable()
    validators.validateSurfaceMetadata(entry.event)
    validators.validateSessionEventData(entry.event, 'cloud session event')
    return { type: 'event', event: { ...entry.event } }
  } catch { throw unavailable() }
}

/** Read-only native bootstrap for account-owned cloud sessions. Execution stays on the source Host. */
export class DshCloudNativeTransport {
  private readonly streams = new Map<string, Lease>()
  constructor(private readonly request: DshRemoteHttpRequester, private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void> = (milliseconds, signal) => delay(milliseconds, undefined, { signal })) {}
  has(id: string): boolean { return this.streams.has(id) }
  release(id: string): void { this.streams.get(id)?.controller.abort(); this.streams.delete(id) }
  close(): void { for (const id of this.streams.keys()) this.release(id) }

  private async metadata(runtime: string, session: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const row = await this.request.post(`${BASE}/sessions/metadata`, { runtime_ref: runtime, session_ref: session }, signal)
    signal.throwIfAborted()
    if (row.session_ref !== session || (row.runtime_ref !== runtime && !(Array.isArray(row.deduplicated_runtime_refs) && row.deduplicated_runtime_refs.includes(runtime)))) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该会话')
    return row
  }

  private async sessions(runtime: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = []
    let cursor: unknown
    for (let page = 0; page < 50; page++) {
      const value = await this.request.post(`${BASE}/sessions/list`, { runtime_ref: runtime, limit: 100, ...(cursor === undefined ? {} : { cursor }) }, signal)
      if (value.items === null) value.items = []
      if (!Array.isArray(value.items)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端会话列表无效')
      items.push(...value.items.map(object))
      if (value.next_cursor === undefined) return items
      if (JSON.stringify(cursor) === JSON.stringify(value.next_cursor)) break
      cursor = value.next_cursor
    }
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端会话目录分页未完成')
  }

  private async history(runtime: string, session: string, signal: AbortSignal, through?: number, before?: number, turnObjects = false): Promise<{ page: NativeHistoryPage; complete: boolean }> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    const identity = { runtime_ref: runtime, session_ref: session }
    let emptyRawIncomplete = false, rawComplete = false
    const rawPage = async (beforeSeq?: number): Promise<NativeHistoryPage> => {
      signal.throwIfAborted()
      const value = await this.request.post(`${BASE}/session-events/list`, { ...identity, limit: 100, ...(beforeSeq === undefined ? {} : { before_seq: beforeSeq }) }, signal)
      if (!Array.isArray(value.entries) || value.entries.length > 100) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端历史响应无效')
      const records: NativeHistoryRecord[] = value.entries.map(raw => ({ type: 'event', event: { ...snapshotDshHistoryEntry(object(raw) as { event: unknown }).event } }))
      if (records.some((record, i) => (beforeSeq !== undefined && record.event.seq >= beforeSeq) || (i > 0 && record.event.seq <= records[i - 1]!.event.seq))) throw unavailable()
      if (beforeSeq === undefined) rawComplete = value.complete === true
      if (!records.length && value.complete === false) emptyRawIncomplete = true
      return { records, hasMore: value.next_cursor !== undefined }
    }
    const previous = async (beforeSeq?: number): Promise<NativeHistoryPage> => {
      if (beforeSeq === 0) return { records: [], hasMore: false }
      let turns = turnObjects ? await readCloudTurnHistory(this.request, identity, signal, beforeSeq, nativeHistoryRecord) : undefined
      const raw = await rawPage(beforeSeq)
      if (!turnObjects && raw.records.length === 0) turns = await readCloudTurnHistory(this.request, identity, signal, beforeSeq, nativeHistoryRecord)
      const bySeq = new Map<number, NativeHistoryRecord>()
      const merge = (records: NativeHistoryRecord[]) => {
        for (const record of records) {
          const existing = bySeq.get(record.event.seq)
          if (existing && !isDeepStrictEqual(existing, record)) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '云端历史事件内容冲突')
          bySeq.set(record.event.seq, record)
        }
      }
      merge(raw.records); merge(turns?.records ?? [])
      for (let pages = 0; pages < 100; pages++) {
        const records = [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
        const selected = fiveTurnPage({ records, hasMore: false })!
        const gap = selected.records.findIndex((record, i) => i > 0 && record.event.seq !== selected.records[i - 1]!.event.seq + 1)
        if (gap === -1) {
          if (!records.length && (emptyRawIncomplete || raw.hasMore || (beforeSeq !== undefined && beforeSeq > 0))) throw unavailable()
          return { records: selected.records.map(nativeHistoryRecord), hasMore: (selected.records[0]?.event.seq ?? 0) > 0 }
        }
        // Turn objects omit between-turn records. Fill only the actual gap from
        // the raw store, without inventing event seqs or replaying mobile nodes.
        const older = await rawPage(selected.records[gap]!.event.seq)
        const size = bySeq.size
        merge(older.records)
        if (size === bySeq.size || bySeq.size > 50_000) throw unavailable()
      }
      throw unavailable()
    }
    const cut = Math.min(before ?? Infinity, through === undefined ? Infinity : through + 1)
    const page = await readFiveTurns(await previous(Number.isFinite(cut) ? cut : undefined), previous)
    signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify(page)) > DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '本页云端历史超过 64MiB 安全上限')
    }
    return { page, complete: rawComplete }
  }

  async call(runtime: string, body: Record<string, unknown>, id: string, signal: AbortSignal, cache?: Cache, refreshing?: Lease, verifiedMetadata?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const mode = body.mode, endpoint = String(body.endpoint ?? '')
    for (const [key, lease] of this.streams) if (Date.now() - lease.touched > 45_000) this.release(key)
    if (mode === 'close') { this.release(id); return { done: true } }
    if (mode === 'pull' && body.endpoint === undefined) {
      const lease = this.streams.get(id)
      if (!lease) throw new DshRemoteError('REMOTE_NOT_FOUND', '云端订阅已结束', true)
      if (lease.busy) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '云端订阅请求冲突')
      lease.busy = true; lease.touched = Date.now()
      try {
        const scoped = AbortSignal.any([signal, lease.controller.signal])
        await this.wait(20_000, scoped)
        scoped.throwIfAborted()
        if (lease.watch) {
          const current = await this.metadata(lease.watch.runtime, lease.watch.session, scoped)
          if (watchRevision(current) !== lease.watch.revision) return await this.call(lease.watch.runtime, lease.watch.body, id, scoped, lease.watch.cache, lease, current)
        }
        return { items: [] }
      }
      finally { lease.busy = false; lease.touched = Date.now() }
    }
    const args = object(object(body.payload).args)
    const ok = (value: unknown) => ({ ok: true, value })
    // Journals do not contain the Host's durable task store. An offline read
    // must not manufacture an authoritative empty catalogue or delivery history.
    if (mode === 'call' && String(endpoint).startsWith('schedule/')) {
      return { ok: false, error: { code: 'RUNTIME_OFFLINE', message: '源电脑未连接，暂无法读取或修改提醒', details: {} } }
    }
    if (mode === 'call' && endpoint === 'session/list') {
      const rows = await this.sessions(runtime, signal)
      return ok({ items: rows.map(row => ({ sessionId: row.session_ref, updatedAt: row.source_updated_at, running: false, blank: row.blank === true,
        projections: { kind: 'cached', asOfSeq: row.projection_as_of_seq ?? -1, values: { title: row.title || null } } })) })
    }
    if (mode === 'call' && endpoint === 'session/canOpenWorkspacePath') return ok(false)
    let frame: unknown
    let watch: Lease['watch']
    if (mode === 'pull' && endpoint === '$events') frame = { type: 'ready', clientId: randomUUID(), host: { home: '' } }
    else if (mode === 'pull' && endpoint === 'session/control') frame = { type: 'baseline', value: { projections: {} } }
    else if (mode === 'pull' && endpoint === 'workspace/follow') frame = { type: 'baseline', value: { items: [], archivedSessionIds: (await this.sessions(runtime, signal)).filter(row => row.archived === true).map(row => row.session_ref) } }
    else if ((mode === 'pull' && endpoint === 'session/follow') || (mode === 'call' && endpoint === 'session/page')) {
      const request = object(args.request), address = object(request.address)
      if (address.kind !== 'session' || typeof address.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(address.sessionId)) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '云端不支持该会话地址')
      const session = address.sessionId
      // Prove current account ownership before consulting local cached content.
      let row = verifiedMetadata ?? await this.metadata(runtime, session, signal)
      if (endpoint === 'session/page' && (!Number.isSafeInteger(request.throughSeq) || Number(request.throughSeq) < -1 || (request.beforeSeq !== undefined && (!Number.isSafeInteger(request.beforeSeq) || Number(request.beforeSeq) < 0)))) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史分页序号无效')
      const key = cache?.key(session)
      const revision = cacheRevision(row), snapshot = key ? cache?.store.snapshot(key) : undefined
      const through = endpoint === 'session/page' ? Number(request.throughSeq) : undefined
      const before = request.beforeSeq === undefined ? undefined : Number(request.beforeSeq)
      const expectedCursor = Math.max(Number(row.projection_as_of_seq ?? -1), Number(row.last_event_seq ?? -1), Number(row.history_complete_through_seq ?? -1))
      const cached = key && revision && snapshot?.cloudRevision === revision && Number(snapshot.cursor) >= expectedCursor && (Number(snapshot.cursor) >= 0 || snapshot.cloudVerifiedComplete === true)
        ? cache?.store.page(key, through ?? Number(snapshot.cursor), before) : undefined
      const fetched = cached ? undefined : await this.history(runtime, session, signal, through, before, row.history_storage_version === 'oss_turn_v1')
      const page = cached ?? fetched!.page
      signal.throwIfAborted()
      if (!cached && revision) {
        const current = await this.metadata(runtime, session, signal)
        signal.throwIfAborted()
        if (!current || cacheRevision(current) !== revision) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '历史版本发生变化，请重新打开会话', true)
        row = current
      }
      if (mode === 'call') {
        if (cache && key && !cached && revision && snapshot?.cloudRevision === revision) cache.store.write(key, page.records)
        return ok(page)
      }
      const cursor = page.records.at(-1)?.event.seq ?? -1
      if (cursor < expectedCursor) throw unavailable()
      const complete = row.history_storage_version === 'oss_turn_v1' ? row.turn_projection_complete_through_seq : row.history_complete_through_seq
      const replacesHistory = cursor < Number(snapshot?.cursor ?? -1) || (!!snapshot && snapshot.cloudGeneration !== cacheGeneration(row))
      const verifiedComplete = typeof complete === 'number' && Number.isSafeInteger(complete) && complete >= cursor && complete >= -1
        || complete === undefined && (fetched?.complete === true || !!cached && snapshot?.cloudVerifiedComplete === true)
      if ((cursor === -1 || replacesHistory) && !verifiedComplete) throw unavailable()
      const displayRevision = metadataRevision(row)
      frame = { type: 'snapshot', cloudVerifiedComplete: verifiedComplete, cloudRevision: revision, cloudGeneration: cacheGeneration(row), cloudMetadataRevision: displayRevision,
        header: { version: 3, id: session, createdAt: Number(row.created_at ?? (cached ? object(snapshot?.header).createdAt : undefined) ?? row.source_updated_at), isSeeded: false }, cursor, ...page,
        projections: { asOfSeq: cursor, values: { title: row.title || null } }, assistantStream: { revision: 0 } }
      // A warm open must not replay the event INSERT loop. Metadata-only changes
      // replace just the small snapshot, preserving every cached older page.
      if (cache && key && (!cached || snapshot?.cloudMetadataRevision !== displayRevision)) cache.store.write(key, cached ? [] : page.records, frame as Record<string, unknown>)
      watch = { runtime, session, revision: watchRevision(row), body, cache }
    } else throw new DshRemoteError('RUNTIME_OFFLINE', '源实例暂不可执行', true)
    if (this.streams.has(id) && this.streams.get(id) !== refreshing) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '云端订阅已存在')
    if (!refreshing && this.streams.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '云端订阅数量超限')
    signal.throwIfAborted()
    refreshing?.controller.abort()
    this.streams.set(id, { controller: new AbortController(), touched: Date.now(), busy: false, ...(watch ? { watch } : {}) })
    return { items: [frame] }
  }
}
