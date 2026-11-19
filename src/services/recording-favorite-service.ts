import type { RecordingFavorite, RecordingFavoriteDetail, RecordingFavoriteRequest, RecordingFavoriteResult, RecordingFavoriteStatus } from '../recording-favorite-contract.js'
import { recordingSearchIdentityHash } from '../recording-search-version.js'
import { TimelineTokenCodec } from './timeline-token.js'
import { ArkmePluginError, objectValue as obj, type ServiceRuntime } from './service.js'
import { favoriteInteger as integer, invalidRecordingFavorite as invalid, projectRecordingShare, type RecordingShareMedia } from './recording-share.js'

const prefix = '/api/v1/chats/recording-favorites/'
const uid = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalid(); return value }
const sid = (value: unknown): string => { if (typeof value !== 'string' || !/^[A-Za-z0-9]{16}$/.test(value)) throw invalid(); return value }
const bool = (value: unknown): boolean => { if (typeof value !== 'boolean') throw invalid(); return value }
const shortText = (value: unknown, limit: number): string => typeof value === 'string' ? Array.from(value).slice(0, limit).join('') : ''
const accountChanged = () => new ArkmePluginError('recording-favorite-account-changed', '账号已变化，请重新打开', false, 409)

/** One account-fenced owner for Browser, SDK and model Tools; no persistent audio copies. */
export class RecordingFavoriteService {
  constructor(private readonly runtime: ServiceRuntime, private readonly media: RecordingShareMedia) {}
  async request<T extends RecordingFavoriteRequest>(input: T, signal?: AbortSignal): Promise<RecordingFavoriteResult<T>> {
    if (!input || typeof input !== 'object') throw invalid()
    const session = await this.runtime.requireSession(), accountKey = `${this.runtime.config.environment}:${session.userId}`
    const write = ['save', 'remove', 'read', 'revoke'].includes(input.action)
    if ((write || input.accountKey !== undefined) && input.accountKey !== accountKey) throw accountChanged()
    const current = async () => {
      signal?.throwIfAborted()
      const active = await this.runtime.accountScopedSession()
      if (active?.userId !== session.userId || active.refreshToken !== session.refreshToken) throw accountChanged()
    }
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), accountKey)
    const seal = (value: unknown, purpose: string) => codec.seal(JSON.stringify(value), `recording-favorite:${purpose}`)
    const open = (value: unknown, purpose: string) => {
      if (typeof value !== 'string' || value.length > 4096) throw invalid()
      try { return obj(JSON.parse(codec.open(value, `recording-favorite:${purpose}`))) } catch { throw new ArkmePluginError('recording-favorite-ref-invalid', '收藏引用已失效，请刷新重试', false, 400) }
    }
    const reference = (value: unknown): { uid: string; audience: 'collector' | 'sharer' } => {
      const row = open(value, 'item')
      if (row.audience !== 'collector' && row.audience !== 'sharer') throw invalid()
      return { uid: uid(row.uid), audience: row.audience }
    }
    const post = async (operation: string, body: Record<string, unknown>, mutation = false) => {
      await current()
      try {
        const result = obj(await this.runtime.authenticatedChatPost(prefix + operation, body, session, signal,
          { lane: mutation ? 'write' : 'interactive-read', bypassCache: true, cacheMs: 0, cancelWhenUnobserved: !mutation, trackWriteOutcome: mutation, ...(mutation ? {} : { key: `recording-favorite:${operation}:${JSON.stringify(body)}` }) }))
        await current(); return result
      } catch (error) {
        await current()
        if (error instanceof ArkmePluginError && error.code === 'arkme-code-2002') throw new ArkmePluginError('recording-favorite-conflict', '收藏状态已变化，请刷新后重新操作', false, 409)
        if (error instanceof ArkmePluginError && (error.code === 'arkme-code-2001' || error.httpStatus === 404)) throw new ArkmePluginError('recording-favorite-unavailable', '这段录音已不可访问', false, 404)
        throw error
      }
    }
    const status = (raw: Record<string, unknown>): RecordingFavoriteStatus => ({ accountKey, saved: bool(raw.saved), version: integer(raw.version), available: bool(raw.available),
      ...(raw.favorite_uid ? { favoriteRef: seal({ uid: uid(raw.favorite_uid), audience: 'collector' }, 'item') } : {}) })
    const person = (raw: Record<string, unknown>, kind: 'sharer' | 'collector') => {
      const avatar = typeof raw[`${kind}_avatar_url`] === 'string' ? this.media.issueAvatarMediaRef?.(session.userId, raw[`${kind}_avatar_url`] as string) : undefined
      return { name: shortText(raw[`${kind}_display_name`], 200) || '即我用户', ...(avatar ? { avatarRef: avatar } : {}) }
    }
    const project = (raw: Record<string, unknown>, audience: 'collector' | 'sharer'): RecordingFavorite => ({ ...status(raw),
      favoriteRef: seal({ uid: uid(raw.favorite_uid), audience }, 'item'), audience,
      createdAtMillis: integer(raw.created_at), savedAtMillis: integer(raw.saved_at), readAtMillis: integer(raw.read_at),
      recordingStartedAtMillis: integer(raw.recording_started_at), segmentCount: integer(raw.segment_count), durationMillis: integer(raw.duration_millis),
      preview: shortText(raw.preview, 160), sharer: person(raw, 'sharer'), ...(audience === 'sharer' ? { collector: person(raw, 'collector') } : {}) })
    const detail = (raw: Record<string, unknown>, audience: 'collector' | 'sharer'): RecordingFavoriteDetail => {
      const item = project(raw, audience)
      if (!item.available) return { ...item, segments: [], canRevoke: false }
      if (!Array.isArray(raw.items) || raw.items.length !== 1) throw invalid()
      const snapshot = obj(raw.items[0]), content = projectRecordingShare(snapshot.structured_content, integer(snapshot.send_at ?? 0), `${prefix}${uid(raw.favorite_uid)}/audio`, session.userId, this.media)
      if (content.segments.length !== item.segmentCount || content.audio.durationMillis !== item.durationMillis) throw invalid()
      return { ...item, ...content, canRevoke: audience === 'sharer' && raw.can_revoke === true,
        ...(audience === 'sharer' && raw.source_context ? { sourceRef: seal({ uid: uid(raw.favorite_uid) }, 'source') } : {}) }
    }
    let result: unknown
    switch (input.action) {
      case 'status': result = status(await post('status', { sid: sid(input.sid) })); break
      case 'save': result = detail(await post('save', { sid: sid(input.sid), expected_version: integer(input.expectedVersion) }, true), 'collector'); break
      case 'remove': {
        const ref = reference(input.favoriteRef)
        if (ref.audience !== 'collector') throw invalid()
        const raw = await post('remove', { favorite_uid: ref.uid, expected_version: integer(input.expectedVersion, 1) }, true)
        if (raw.favorite_uid !== ref.uid || raw.saved !== false) throw invalid()
        result = status(raw); break
      }
      case 'detail': {
        const ref = reference(input.favoriteRef), raw = await post('detail', { favorite_uid: ref.uid })
        if (raw.favorite_uid !== ref.uid) throw invalid()
        result = detail(raw, ref.audience); break
      }
      case 'page': case 'notifications': {
        const notice = input.action === 'notifications', cursor = input.cursor ? open(input.cursor, input.action) : undefined
        if (cursor) { integer(cursor.at, 1); uid(cursor.uid) }
        const raw = await post(notice ? 'notifications/page' : 'page', { limit: 20, ...(cursor ? { cursor } : {}) })
        if (!Array.isArray(raw.items) || raw.items.length > 20) throw invalid()
        const items = raw.items.map(value => project(obj(value), notice ? 'sharer' : 'collector'))
        if (new Set(items.map(item => item.favoriteRef)).size !== items.length) throw invalid()
        let nextCursor: string | undefined
        if (raw.next_cursor != null) {
          const next = obj(raw.next_cursor); integer(next.at, 1); uid(next.uid)
          nextCursor = seal({ at: next.at, uid: next.uid }, input.action)
          if (!items.length || nextCursor === input.cursor) throw invalid()
        }
        result = { accountKey, items, ...(nextCursor ? { nextCursor } : {}), readThrough: seal({ through: integer(raw.server_at, 1) }, 'read') }; break
      }
      case 'summary': {
        const raw = await post('notifications/summary', {})
        result = { accountKey, unreadCount: integer(raw.unread), readThrough: seal({ through: integer(raw.server_at, 1) }, 'read') }; break
      }
      case 'read': {
        if (Boolean(input.favoriteRef) === Boolean(input.readThrough)) throw invalid()
        const ref = input.favoriteRef ? reference(input.favoriteRef) : undefined
        if (ref && ref.audience !== 'sharer') throw invalid()
        await post('notifications/read', ref ? { favorite_uid: ref.uid } : { through: integer(open(input.readThrough, 'read').through, 1) }, true)
        result = { acknowledged: true }; break
      }
      case 'revoke': {
        const ref = reference(input.favoriteRef)
        if (ref.audience !== 'sharer') throw invalid()
        await post('revoke', { favorite_uid: ref.uid }, true)
        result = { acknowledged: true }; break
      }
      case 'source': {
        const ref = open(input.sourceRef, 'source'), raw = await post('detail', { favorite_uid: uid(ref.uid) }), source = obj(raw.source_context)
        if (raw.favorite_uid !== ref.uid || raw.available !== true || !source.session_id || !source.child_id) throw new ArkmePluginError('recording-favorite-source-unavailable', '原录音已不可访问，收藏片段仍保留', false, 404)
        if (typeof source.session_id !== 'string' || source.session_id.length > 128 || typeof source.child_id !== 'string' || source.child_id.length > 128) throw invalid()
        result = { atMillis: integer(source.occurred_at, 1), identityHash: recordingSearchIdentityHash({ sessionId: source.session_id, childId: source.child_id, itemIndex: integer(source.asr_item_index), transcriptSource: 'system' }) }; break
      }
      default: throw invalid()
    }
    await current()
    return result as RecordingFavoriteResult<T>
  }
}
