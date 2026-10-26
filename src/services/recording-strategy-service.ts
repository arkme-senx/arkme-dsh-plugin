import { recordingStrategy, type RecordingStrategyOptions, type RecordingStrategyPage, type RecordingStrategySources } from '../recording-strategy-contract.js'
import { recordingPlaybackLocator, type RecordingPlaybackLocator } from '../recording-playback-ref.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

export interface RecordingStrategyRefs {
  openSession(ref: string): Promise<{ sessionId: string }>
  open(ref: string): Promise<Record<string, unknown>>
  seal(payload: Record<string, unknown>): Promise<string>
  playback(viewerUserId: number, locator: RecordingPlaybackLocator, signal?: AbortSignal): Promise<string>
}
function invalid(): never { throw new ArkmePluginError('recording-strategy-invalid', '录音策略参数或结果无效，请刷新重试', false, 400) }
function text(value: unknown): string { if (typeof value !== 'string') invalid(); return value }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value }
function identifier(value: unknown): string { const s = text(value); if (!/^[a-f0-9]{24}$/.test(s) || /^0{24}$/.test(s)) invalid(); return s }
function rows(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 200) invalid(); return value }

/** Owns alternative-result reads/commands. No formal speaker or summary writes. */
export class RecordingStrategyService {
  constructor(private readonly runtime: ServiceRuntime, private readonly refs: RecordingStrategyRefs) {}
  async request(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession()
    const post = async (path: string, body: Record<string, unknown>) => {
      const result = await this.runtime.authenticatedAudioPost<unknown>(`/api/v1/audio/${path}`, body, session, signal, { bypassCache: true })
      if ((await this.runtime.requireSession()).userId !== session.userId) invalid()
      signal?.throwIfAborted()
      return result
    }
    const seal = (payload: Record<string, unknown>) => this.refs.seal({ version: 1, ...payload, viewerUserId: session.userId })
    if (input.action === 'catalog') {
      return rows(await post('strategies', {})).map(value => { const row = objectValue(value); return { id: recordingStrategy(row.id), name: text(row.name) } })
    }
    if (input.action === 'sources') {
      const { sessionId } = await this.refs.openSession(text(input.sessionRef))
      let after: string | undefined
      if (input.cursor) { const c = await this.refs.open(text(input.cursor)); if (c.kind !== 'sources' || c.sessionId !== sessionId) invalid(); after = identifier(c.after) }
      const page = objectValue(await post('strategy-comparison/sources', { session_id: sessionId, ...(after ? { after } : {}) }))
      const result: RecordingStrategySources = { items: await Promise.all(rows(page.items).map(async value => {
        const row = objectValue(value), sourceId = identifier(row.id)
        return { sourceRef: await seal({ kind: 'source', sessionId, sourceId }), fileName: text(row.file_name), startAtMillis: integer(row.start_at) }
      })) }
      if (page.next) result.nextCursor = await seal({ kind: 'sources', sessionId, after: identifier(page.next) })
      return result
    }
    if (input.action === 'playback') {
      const item = await this.refs.open(text(input.itemRef))
      if (item.kind !== 'item') invalid()
      const locator = recordingPlaybackLocator(item.locator)
      if (!locator) invalid()
      return { playbackRef: await this.refs.playback(session.userId, locator, signal), mimeType: 'audio/ogg', startOffsetMillis: 0, endOffsetMillis: integer(item.duration) }
    }
    const source = await this.refs.open(text(input.sourceRef))
    if (source.kind !== 'source') invalid()
    const sourceId = identifier(source.sourceId)
    if (input.action === 'options') {
      const raw = objectValue(await post('strategy-comparison/options', { source_id: sourceId }))
      const result: RecordingStrategyOptions = {
        strategies: rows(raw.strategies).map(value => { const row = objectValue(value); return { id: recordingStrategy(row.id), name: text(row.name) } }),
        officialStrategy: recordingStrategy(raw.official_strategy), officialComplete: raw.official_complete === true, officialFailed: raw.official_failed === true, expiresAtMillis: integer(raw.expires_at), canStart: raw.can_start === true,
        results: rows(raw.results).map(value => { const row = objectValue(value); return { strategy: recordingStrategy(row.strategy), complete: row.complete === true, failed: !!row.error } }),
      }
      return result
    }
    if (input.strategy === undefined || input.strategy === '') invalid()
    const strategy = recordingStrategy(input.strategy)
    if (input.action === 'start') { await post('strategy-comparison/start', { source_id: sourceId, strategy }); return { accepted: true } }
    if (input.action !== 'page') invalid()
    let cursor: { part: number; offset: number } | undefined
    if (input.cursor) {
      const raw = await this.refs.open(text(input.cursor))
      if (raw.kind !== 'page' || raw.sourceId !== sourceId || raw.strategy !== strategy) invalid()
      cursor = { part: integer(raw.part), offset: integer(raw.offset) }
    }
    const raw = objectValue(await post('strategy-comparison/page', { source_id: sourceId, strategy, ...(cursor ? { cursor } : {}) }))
    const result: RecordingStrategyPage = { items: await Promise.all(rows(raw.items).map(async value => {
      const row = objectValue(value), start = integer(row.start_at), end = integer(row.end_at)
      if (end < start) invalid()
      const locator = recordingPlaybackLocator({ child_id: identifier(row.result_id), source: row.media_source, ordinal: integer(row.ordinal) })
      if (!locator) invalid()
      return { itemRef: await seal({ kind: 'item', locator, duration: end - start }), startAtMillis: start, endAtMillis: end, speaker: integer(row.speaker), text: text(row.text) }
    })), complete: raw.complete === true, failed: !!raw.error }
    if (raw.next) { const next = objectValue(raw.next); result.nextCursor = await seal({ kind: 'page', sourceId, strategy, part: integer(next.part), offset: integer(next.offset) }) }
    return result
  }
}
