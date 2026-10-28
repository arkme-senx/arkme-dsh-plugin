import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { DshRemoteError } from './errors.js'
import type { DshRemoteHttpRequester } from './control-plane.js'
import { REMOTE_HISTORY_TURNS, type NativeHistoryPage, type NativeHistoryRecord } from './native-history.js'
import { DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES } from './types.js'

const BASE = '/api/v1/dsh-remote/session-turn-objects'
const invalid = () => new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端历史对象或索引校验失败')
const tooLarge = () => new DshRemoteError('CAPABILITY_UNSUPPORTED', '本页云端历史超过 64MiB 安全上限')
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
const seq = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid()
  return Number(value)
}
type Identity = { runtime_ref: string; session_ref: string }
type Index = { object_ref: string; turn_ref: string; start_seq: number; end_seq: number; status: string; event_count: number; compressed_bytes: number; content_sha256: string }

export function parseTurnObjectIndex(value: unknown): Index {
  const row = object(value)
  for (const key of ['object_ref', 'turn_ref', 'status', 'content_sha256']) {
    if (typeof row[key] !== 'string' || !row[key] || String(row[key]).length > 256) throw invalid()
  }
  const start = seq(row.start_seq), end = seq(row.end_seq), count = seq(row.event_count), bytes = seq(row.compressed_bytes)
  if (end < start || count === 0 || bytes === 0 || !/^[a-f0-9]{64}$/.test(String(row.content_sha256))
    || !['completed', 'interrupted', 'error', 'max_tokens'].includes(String(row.status))) throw invalid()
  return { object_ref: String(row.object_ref), turn_ref: String(row.turn_ref), status: String(row.status), content_sha256: String(row.content_sha256), start_seq: start, end_seq: end, event_count: count, compressed_bytes: bytes }
}

/** Read only the requested five turns. Signed grants and object bytes stay in the Host. */
export async function readCloudTurnHistory(
  request: DshRemoteHttpRequester, identity: Identity, signal: AbortSignal,
  before: number | undefined, record: (entry: unknown) => NativeHistoryRecord,
): Promise<NativeHistoryPage | undefined> {
  if (before === 0) return { records: [], hasMore: false }
  const selected: Index[] = []
  let cursor: string | undefined, lastStart = Infinity, exhausted = false
  // ponytail: the existing opaque cursor needs a metadata scan (at most 5,000
  // turns); add a server-side seq seek if deeper history is needed. Skipped
  // turns are never downloaded and signed URLs are never cached.
  for (let page = 0; page < 50; page++) {
    signal.throwIfAborted()
    const value = await request.post(`${BASE}/list`, { ...identity, limit: 100, ...(cursor === undefined ? {} : { cursor }) }, signal)
    const items = value.items === null ? [] : value.items
    if (!Array.isArray(items) || items.length > 100) throw invalid()
    if (!items.length && Number(value.committed_turn_count ?? 0) > 0) throw invalid()
    const more = value.has_more === true
    if (more !== (typeof value.next_cursor === 'string' && value.next_cursor.length > 0)
      || (more && (items.length === 0 || value.next_cursor === cursor))) throw invalid()
    for (const raw of items) {
      const item = parseTurnObjectIndex(raw)
      if (item.end_seq >= lastStart) throw invalid()
      lastStart = item.start_seq
      if (before !== undefined && item.start_seq >= before) continue
      selected.push(item)
      if (selected.length === REMOTE_HISTORY_TURNS) break
    }
    if (selected.length === REMOTE_HISTORY_TURNS || !more) { exhausted = true; break }
    cursor = String(value.next_cursor)
  }
  if (!exhausted) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '云端历史索引分页过多')
  if (!selected.length) return undefined
  let remaining = DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES
  const records: NativeHistoryRecord[] = []
  for (const item of selected.reverse()) {
    if (item.compressed_bytes > DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES || item.event_count > 50_000) throw tooLarge()
    signal.throwIfAborted()
    const grant = await request.post(`${BASE}/read`, { ...identity, object_ref: item.object_ref }, signal)
    let url: URL
    try { url = new URL(String(grant.download_url)) } catch { throw invalid() }
    if (grant.object_ref !== item.object_ref || !Number.isSafeInteger(grant.expires_at) || Number(grant.expires_at) <= Date.now()
      || url.protocol !== 'https:' || url.username || url.password || url.hash) throw invalid()
    const headers = new Headers()
    for (const [name, value] of Object.entries(object(grant.download_headers ?? {}))) {
      if (!/^[a-z0-9-]{1,64}$/i.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)
        || ['authorization', 'cookie', 'host', 'proxy-authorization', 'accept-encoding'].includes(name.toLowerCase())) throw invalid()
      headers.set(name, value)
    }
    // OSS stores a gzip file, not an HTTP content-encoded representation.
    headers.set('accept-encoding', 'identity')
    const chunks: Buffer[] = []
    let bytes = 0, decodedBytes = 0
    const hash = createHash('sha256')
    try {
      const response = await fetch(url, { method: 'GET', headers, redirect: 'error', credentials: 'omit', signal })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', '云端历史下载失败', true)
      }
      const length = response.headers.get('content-length')
      if (length !== null && Number(length) !== item.compressed_bytes) { await response.body.cancel(); throw invalid() }
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        async function* (source) {
          for await (const chunk of source) {
            bytes += chunk.length
            if (bytes > item.compressed_bytes) throw invalid()
            hash.update(chunk)
            yield chunk
          }
        },
        createGunzip(),
        async source => {
          for await (const chunk of source) {
            decodedBytes += chunk.length
            if (decodedBytes > remaining) throw tooLarge()
            chunks.push(chunk as Buffer)
          }
        },
        { signal },
      )
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof DshRemoteError) throw error
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', '云端历史下载或解压失败', true)
    }
    signal.throwIfAborted()
    if (bytes !== item.compressed_bytes || hash.digest('hex') !== item.content_sha256) throw invalid()
    remaining -= decodedBytes
    let value: Record<string, unknown>
    try { value = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { throw invalid() }
    const turn = object(value.turn)
    if (value.schema !== 'dsh.turn.v1' || turn.turn_ref !== item.turn_ref || turn.start_seq !== item.start_seq
      || turn.end_seq !== item.end_seq || turn.status !== item.status || !Array.isArray(value.events)
      || value.events.length !== item.event_count || object(value.integrity).event_count !== item.event_count) throw invalid()
    const entries = value.events.map(record)
    if (entries[0]?.event.seq !== item.start_seq || entries.at(-1)?.event.seq !== item.end_seq
      || entries[0]?.event.type !== 'turn/start'
      || entries.some((entry, i) => i > 0 && (entry.event.seq !== entries[i - 1]!.event.seq + 1 || entry.event.type === 'turn/start'))) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '云端原始历史不完整，需要源电脑补齐')
    }
    records.push(...entries.filter(entry => before === undefined || entry.event.seq < before))
    if (records.length > 50_000) throw tooLarge()
  }
  return { records, hasMore: (records[0]?.event.seq ?? 0) > 0 }
}
