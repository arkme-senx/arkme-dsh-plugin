import { ArkmeChatRealtimeRuntime } from '../chat-realtime.js'
import type { ArkmeThoughtStreamUpdate } from '../record-thought-contract.js'
import type { ArkmeChatClientEvent } from '../types.js'
import { objectValue, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'

type Notification = { records?: string[]; chat?: { session: string; relation: string; clear: boolean }; stream?: ArkmeThoughtStreamUpdate }
function parse(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  try { return objectValue(JSON.parse(value)) } catch { return {} }
}
function uid(value: unknown): string { return typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '' }

/** Decode metadata only for chat; streamed legacy content is restricted to self-record events. */
export function decodeThoughtNotification(line: string, stream: 'notify' | 'global'): Notification | undefined {
  if (!line.startsWith('data:') || line.length > 262_144) return undefined
  const row = parse(line.slice(5)), payload = parse(row.data ?? row.payload)
  if (stream === 'notify') {
    if (row.biz_type === 1 && Array.isArray(payload.record_uids)) {
      const records = [...new Set(payload.record_uids.slice(0, 100).map(uid).filter(Boolean))]
      return records.length ? { records } : undefined
    }
    if (row.biz_type === 7 && uid(payload.chat_session_uid) && uid(payload.rel_uid)
      && [1, 2, 3, 4, 5].includes(payload.scene as number) && [1, 2, 3, 4].includes(payload.status as number)
      && Number.isSafeInteger(payload.generation) && (payload.generation as number) > 0)
      return { chat: { session: uid(payload.chat_session_uid), relation: uid(payload.rel_uid), clear: payload.status === 4 } }
    return undefined
  }
  // New chat projections have separate owner validation and never consume legacy group/private deltas.
  if ((row.kind !== 7 && row.kind !== 8) || !uid(payload.record_uid)
    || (payload.chat_type !== undefined && payload.chat_type !== 0) || Number(payload.group_id ?? 0) > 0) return undefined
  const recordUid = uid(payload.record_uid), streamId = uid(payload.msg_id) || uid(row.msg_id)
  if (!streamId) return undefined
  const delta = typeof payload.delta === 'string' ? payload.delta.slice(0, 131_072) : ''
  const contentBytes = Number.isSafeInteger(payload.content_len) && (payload.content_len as number) >= 0 ? payload.content_len as number : 0
  const phase = payload.error === true || payload.status === 'error' ? 'failed' : payload.done === true || payload.status === 'done' ? 'ready' : 'generating'
  return { stream: { recordUid, streamId, biz: payload.trigger_mode === 'auto_self_whisper' ? 1 : 2,
    delta: phase === 'failed' ? '' : delta, contentBytes, phase } }
}

/** Two account-owned, receive-only upstreams share the existing Browser event transport. */
export class ThoughtRealtimeService {
  private streams: ArkmeChatRealtimeRuntime[] = []
  private stopped = false
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService,
    private readonly emit: (event: Omit<Extract<ArkmeChatClientEvent, { type: 'thought-invalidated' }>, 'revision'>) => void) {}
  start(): void {
    if (this.streams.length || this.stopped) return
    for (const [kind, path] of [['notify', '/api/v1/ainotify/sse/ai'], ['global', '/api/v1/qa/global-stream']] as const) {
      let pending = Promise.resolve()
      const connection = new ArkmeChatRealtimeRuntime({ imBaseUrl: this.runtime.config.intelligentBaseUrl,
        readSession: () => this.runtime.sessionStore.read(), fetchImpl: this.runtime.fetchImpl,
        refreshSession: async session => { try { return await this.runtime.refreshAccessToken(session) } catch { return undefined } },
        receiveStream: { path, onLine: (line, userId, signal) => { pending = pending.then(() => this.accept(line, kind, userId, signal)).catch(() => undefined) } } })
      connection.subscribe(notice => {
        if (notice.cause === 'reconcile' && notice.connectionUserId) void this.current(notice.connectionUserId, notice.connectionSignal).then(valid => {
          if (valid) this.emit({ type: 'thought-invalidated', accountScope: `${this.runtime.config.environment}:${notice.connectionUserId}` })
        }).catch(() => undefined)
      })
      this.streams.push(connection); connection.start()
    }
  }
  dispose(): void { this.stopped = true; this.streams.forEach(stream => stream.stop()); this.streams = [] }
  private async current(userId: number, signal?: AbortSignal): Promise<boolean> {
    const session = await this.runtime.sessionStore.read()
    return !this.stopped && !signal?.aborted && session?.userId === userId
  }
  private async accept(line: string, kind: 'notify' | 'global', userId: number, signal: AbortSignal): Promise<void> {
    const event = decodeThoughtNotification(line, kind)
    if (!event || !await this.current(userId, signal)) return
    const base = { type: 'thought-invalidated' as const, accountScope: `${this.runtime.config.environment}:${userId}` }
    if (event.chat) {
      const [sourceKey, timelineItemKey] = await Promise.all([
        this.source.chatDirectorySourceKey(userId, event.chat.session), this.source.chatTimelineItemKey(userId, event.chat.session, event.chat.relation) ])
      if (await this.current(userId, signal)) this.emit({ ...base, sourceKey, timelineItemKey, clear: event.chat.clear })
    } else if (event.stream) this.emit({ ...base, stream: event.stream })
    else this.emit(base)
  }
}
