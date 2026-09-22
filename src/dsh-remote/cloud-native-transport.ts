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
type Lease = { controller: AbortController; touched: number; busy: boolean }

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
  constructor(private readonly request: DshRemoteHttpRequester) {}
  has(id: string): boolean { return this.streams.has(id) }
  release(id: string): void { this.streams.get(id)?.controller.abort(); this.streams.delete(id) }
  close(): void { for (const id of this.streams.keys()) this.release(id) }

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

  private async history(runtime: string, session: string, signal: AbortSignal, through?: number, before?: number, turnObjects = false): Promise<NativeHistoryPage> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    const identity = { runtime_ref: runtime, session_ref: session }
    const rawPage = async (beforeSeq?: number): Promise<NativeHistoryPage> => {
      signal.throwIfAborted()
      const value = await this.request.post(`${BASE}/session-events/list`, { ...identity, limit: 100, ...(beforeSeq === undefined ? {} : { before_seq: beforeSeq }) }, signal)
      if (!Array.isArray(value.entries) || value.entries.length > 100) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端历史响应无效')
      const records: NativeHistoryRecord[] = value.entries.map(raw => ({ type: 'event', event: { ...snapshotDshHistoryEntry(object(raw) as { event: unknown }).event } }))
      if (records.some((record, i) => (beforeSeq !== undefined && record.event.seq >= beforeSeq) || (i > 0 && record.event.seq <= records[i - 1]!.event.seq))) throw unavailable()
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
          if (!records.length && (raw.hasMore || (beforeSeq !== undefined && beforeSeq > 0))) throw unavailable()
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
    return page
  }

  async call(runtime: string, body: Record<string, unknown>, id: string, signal: AbortSignal, cache?: {
    store: { snapshot: DshNativeHistoryCache['snapshot']; page: DshNativeHistoryCache['page']; write: DshNativeHistoryCache['write'] }; key(session: string): string
  }): Promise<Record<string, unknown>> {
    const mode = body.mode, endpoint = String(body.endpoint ?? '')
    for (const [key, lease] of this.streams) if (Date.now() - lease.touched > 45_000) this.release(key)
    if (mode === 'close') { this.release(id); return { done: true } }
    if (mode === 'pull' && body.endpoint === undefined) {
      const lease = this.streams.get(id)
      if (!lease) throw new DshRemoteError('REMOTE_NOT_FOUND', '云端订阅已结束', true)
      if (lease.busy) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '云端订阅请求冲突')
      lease.busy = true; lease.touched = Date.now()
      try { await delay(20_000, undefined, { signal: AbortSignal.any([signal, lease.controller.signal]) }); return { items: [] } }
      finally { lease.busy = false; lease.touched = Date.now() }
    }
    const args = object(object(body.payload).args)
    const ok = (value: unknown) => ({ ok: true, value })
    if (mode === 'call' && endpoint === 'session/list') {
      const rows = await this.sessions(runtime, signal)
      return ok({ items: rows.map(row => ({ sessionId: row.session_ref, updatedAt: row.source_updated_at, running: false, blank: row.blank === true,
        projections: { asOfSeq: row.projection_as_of_seq ?? -1, values: { title: row.title || null } } })) })
    }
    if (mode === 'call' && endpoint === 'session/canOpenWorkspacePath') return ok(false)
    let frame: unknown
    if (mode === 'pull' && endpoint === '$events') frame = { type: 'ready', clientId: randomUUID(), host: { home: '' } }
    else if (mode === 'pull' && endpoint === 'session/control') frame = { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }
    else if (mode === 'pull' && endpoint === 'workspace/follow') frame = { type: 'baseline', value: { items: [], archivedSessionIds: (await this.sessions(runtime, signal)).filter(row => row.archived === true).map(row => row.session_ref) } }
    else if ((mode === 'pull' && endpoint === 'session/follow') || (mode === 'call' && endpoint === 'session/page')) {
      const request = object(args.request), address = object(request.address)
      if (address.kind !== 'session' || typeof address.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(address.sessionId)) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '云端不支持该会话地址')
      const session = address.sessionId
      // Prove current account ownership before consulting local cached content.
      const row = (await this.sessions(runtime, signal)).find(item => item.session_ref === session)
      if (!row) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该会话')
      if (endpoint === 'session/page' && (!Number.isSafeInteger(request.throughSeq) || Number(request.throughSeq) < -1 || (request.beforeSeq !== undefined && (!Number.isSafeInteger(request.beforeSeq) || Number(request.beforeSeq) < 0)))) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史分页序号无效')
      const key = cache?.key(session), snapshot = key ? cache?.store.snapshot(key) : undefined
      const through = endpoint === 'session/page' ? Number(request.throughSeq) : undefined
      const before = request.beforeSeq === undefined ? undefined : Number(request.beforeSeq)
      const cached = key && snapshot && Number(snapshot.cursor) >= 0 ? cache?.store.page(key, through ?? Number(snapshot.cursor), before) : undefined
      const page = cached ?? await this.history(runtime, session, signal, through, before, row.history_storage_version === 'oss_turn_v1')
      signal.throwIfAborted()
      if (mode === 'call') {
        if (cache && key && !cached) cache.store.write(key, page.records)
        return ok(page)
      }
      const cursor = page.records.at(-1)?.event.seq ?? -1
      frame = { type: 'snapshot', header: snapshot?.header ?? { version: 3, id: session, createdAt: Number(row.created_at ?? row.source_updated_at), isSeeded: false }, cursor, ...page,
        projections: snapshot?.projections ?? { asOfSeq: cursor, values: { title: row.title || null } }, assistantStream: { revision: 0 } }
      if (cache && key) cache.store.write(key, page.records, frame as Record<string, unknown>)
    } else throw new DshRemoteError('RUNTIME_OFFLINE', '源实例暂不可执行', true)
    if (this.streams.has(id)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '云端订阅已存在')
    if (this.streams.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '云端订阅数量超限')
    signal.throwIfAborted()
    this.streams.set(id, { controller: new AbortController(), touched: Date.now(), busy: false })
    return { items: [frame] }
  }
}
