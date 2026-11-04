import { recordOwnerId, type RecordOwnerId } from '../record-owner-id.js'
import { createHash, createHmac } from 'node:crypto'
import { authorizedStorageURL } from './profile-image.js'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { TeamWorldRequest, TeamWorldReceipt, TeamWorldOriginal, TeamWorldContext, TeamWorldPreview } from '../team-world-contract.js'
import type { WorldPublishOrigin } from '../world-publish-source.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue as obj, stringValue as str, type ServiceRuntime } from './service.js'
import type { ArkmeImageBytes, ArkmeImageMediaType } from '../types.js'

const invalid = () => new ArkmePluginError('team-world-invalid', '团队世界请求或返回无效，请刷新后重试', false, 409)
const owner = (v: unknown): RecordOwnerId => { const id = recordOwnerId(v); if (!id) throw invalid(); return id }
const positive = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) <= 0) throw invalid(); return Number(v) }
const nonnegative = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 0) throw invalid(); return Number(v) }
const id = (v: unknown): string => { if (typeof v !== 'string' || !v || v.length > 128 || v.trim() !== v || /[\r\n\x00]/.test(v)) throw invalid(); return v }
const rows = (v: unknown): Record<string, unknown>[] => { if (!Array.isArray(v) || v.length > 50) throw invalid(); return v.map(obj) }
const limit = (v: unknown) => v === undefined ? 20 : Math.min(50, positive(v))
interface Ports {
  publicPreviews(refs: { recordUID: string; ancestorUID: string }[], signal?: AbortSignal): Promise<(import('../types.js').ArkmeWorldFeedItem | undefined)[]>
  actorNames(ids: number[], signal?: AbortSignal): Promise<ReadonlyMap<number, string>>
  reactionTarget(wire: { record_uid: string; world_context_uid: string; content_revision: string }): Promise<import('../reaction-contract.js').ReactionTargetRef>
  feed(teamID: RecordOwnerId, cursor?: string, limit?: number, signal?: AbortSignal): Promise<import('../types.js').ArkmeWorldFeedPage>
  teamID(ref: string, actor: number): Promise<RecordOwnerId>
  teamRef(id: RecordOwnerId, actor: number): Promise<string>
  recordRef(uid: string, signal?: AbortSignal): Promise<string>
  recordUID(ref: string): Promise<string>
  source(origin: WorldPublishOrigin, version: number, signal?: AbortSignal): Promise<Record<string, unknown>>
}
/** One Host owner: UI, SDK and Tools share account seals and exact command payloads. */
export class TeamWorldService {
  private imageUploads = 0
  private imageReads = 0
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime, private readonly ports: Ports) { this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid) }
  private async upstream<T>(call: () => Promise<T>): Promise<T> {
    try { return await call() }
    catch (error) {
      if (error instanceof ArkmeUpstreamResponseError
        && (str(obj(error.responseData).reason) === 'not_accessible' || error.message === 'team_world_not_accessible')) {
        throw new ArkmePluginError('team-world-not-accessible', '当前没有管理这份团队内容或查看内部反馈的权限，请刷新团队身份。', false, 403, { cause: error })
      }
      if (error instanceof ArkmeUpstreamResponseError && error.message === 'team_world_content_conflict') {
        throw new ArkmePluginError('team-world-content-conflict', '团队内容已变化或请求内容不一致，请刷新后重新操作。', false, 409, { cause: error })
      }
      throw error
    }
  }
  private async seal(kind: string, actor: number, value: Record<string, unknown>) { return this.codec.seal(`team-world-${kind}`, { ...value, actor, environment: this.runtime.config.environment }) }
  private async open(kind: string, actor: number, ref: string) {
    const v = await this.codec.open(`team-world-${kind}`, ref)
    if (v.actor !== actor || v.environment !== this.runtime.config.environment) throw invalid()
    return v
  }
  private async contentRef(actor: number, team: RecordOwnerId, uid: string) { return this.seal('content', actor, { team, uid }) }
  private async original(v: Record<string, unknown>, actor: number, team: RecordOwnerId): Promise<TeamWorldOriginal> {
    const uid = id(v.content_uid)
    if (!['plain', 'markdown'].includes(str(v.format)) || ['deleted', 'public_requested', 'pending'].some(k => typeof v[k] !== 'boolean')) throw invalid()
    return { contentRef: await this.contentRef(actor, team, uid), recordRef: await this.ports.recordRef(id(v.publication_uid)), revision: positive(v.revision), title: str(v.title), text: str(v.text), format: v.format as 'plain' | 'markdown', sourceKind: str(v.source_kind),
      assets: await Promise.all(rows(v.assets).map(async a => ({ imageRef: await this.seal('image', actor, { team, uid, revision: positive(v.revision), asset: { file_asset_uid: id(a.file_asset_uid), owner_user_id: owner(a.owner_user_id), upload_uid: id(a.upload_uid) } }), mimeType: str(a.mime_type), size: positive(a.size) }))),
      deleted: v.deleted === true, publicRequested: v.public_requested === true, pending: v.pending === true, updatedAt: positive(v.updated_at) }
  }
  async readImage(ref: string, options: { maxBytes?: number; signal?: AbortSignal; cacheOnly?: boolean } = {}): Promise<ArkmeImageBytes> {
    if (options.cacheOnly) throw new ArkmePluginError('image-cache-miss', '团队原稿图片必须重新检查当前权限', false, 404)
    if (this.imageReads >= 2) throw new ArkmePluginError('team-world-image-busy', '团队图片正在读取，请稍后重试', true, 429)
    this.imageReads++
    try {
      const session = await this.runtime.requireSession(), image = await this.open('image', session.userId, ref)
      const maxBytes = Math.min(20 << 20, positive(options.maxBytes ?? (20 << 20)))
      const response = await this.upstream(() => this.runtime.authenticatedRecordImage('/api/v1/team-world/images/read', {
        team_id: owner(image.team), content_uid: id(image.uid), revision: positive(image.revision), file_asset_uid: id(obj(image.asset).file_asset_uid),
      }, { expectedUserId: session.userId, maxBytes, ...(options.signal ? { signal: options.signal } : {}) }))
      const data = new Uint8Array(await response.arrayBuffer())
      options.signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw invalid()
      return { mediaType: response.headers.get('content-type') as ArkmeImageMediaType, bytes: data.length, data }
    } finally { this.imageReads-- }
  }
  private async receipt(v: Record<string, unknown>, actor: number, team: RecordOwnerId, requestUid: string): Promise<TeamWorldReceipt> {
    if (typeof v.pending !== 'boolean') throw invalid()
    const r = obj(v.result)
    if (v.result && !['published', 'pending', 'rejected', 'unpublished', 'deleted'].includes(str(r.visibility))) throw invalid()
    return { requestUid, contentRef: await this.contentRef(actor, team, id(v.content_uid)), revision: positive(v.revision), acceptedAt: nonnegative(v.accepted_at), pending: v.pending,
      ...(v.result ? { result: { visibility: r.visibility as NonNullable<TeamWorldReceipt['result']>['visibility'], contentRevision: id(r.content_revision), publicationVersion: positive(r.publication_version) } } : {}) }
  }
  async execute(input: TeamWorldRequest, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(), actor = session.userId
    if (input.accountKey !== `${this.runtime.config.environment}:${actor}`) throw new ArkmePluginError('team-world-account-changed', '账号已变化，请重新打开', false, 409)
    const record = async (path: string, body: Record<string, unknown>) => obj(await this.upstream(() => this.runtime.authenticatedPost(`/api/v1/team-world/${path}`, body, session, signal, { bypassCache: true, cacheMs: 0 })))
    const team = async (path: string, body: Record<string, unknown>, read = true) => obj(await this.upstream(() => this.runtime.authenticatedTeamPost(`/api/v1/team/world/${path}`, body, session, signal, read)))
    const cursor = async (kind: string, ref?: string) => ref ? await this.open(kind, actor, ref) : {}
    const previews = async (items: { team_id: RecordOwnerId; content_uid: string; event_uid?: string }[]) => {
      if (!items.length) return []
      const values = rows((await record('previews', { items })).items)
      if (values.length !== items.length) throw invalid()
      return Promise.all(values.map(async (v, i) => {
        const expected = items[i]!
        if (owner(v.team_id) !== expected.team_id || v.content_uid !== expected.content_uid || (v.event_uid ?? '') !== (expected.event_uid ?? '') || typeof v.readable !== 'boolean') throw invalid()
        if (!v.readable) return { wire: v, preview: undefined }
        const preview: TeamWorldPreview = { teamName: str(v.team_name), title: str(v.title), text: str(v.text), imageCount: nonnegative(v.image_count ?? 0), deleted: v.deleted === true, publicRequested: v.public_requested === true }
        const imageUIDs = v.image_uids === undefined ? [] : v.image_uids
        if (!Array.isArray(imageUIDs) || imageUIDs.length > 27) throw invalid()
        preview.imageRefs = await Promise.all(imageUIDs.map(asset => this.seal('image', actor, { team: expected.team_id, uid: expected.content_uid, revision: positive(v.revision), asset: { file_asset_uid: id(asset) } })))
        return { wire: v, preview }
      }))
    }
    let result: unknown
    switch (input.action) {
      case 'feed': {
        const v = await team('context', { jotmo_id: id(input.jotmoId) })
        if (v.jotmo_id !== input.jotmoId) throw invalid()
        result = await this.ports.feed(owner(v.team_id), input.cursor, limit(input.limit), signal); break
      }
      case 'context': {
        const v = await team('context', { jotmo_id: id(input.jotmoId) }), caps = obj(v.capabilities)
        if (str(v.jotmo_id) !== input.jotmoId || !str(v.name) || ['publish', 'manage', 'feedback', 'reply'].some(k => typeof caps[k] !== 'boolean')) throw invalid()
        result = { teamRef: await this.ports.teamRef(owner(v.team_id), actor), jotmoId: input.jotmoId, name: str(v.name), capabilities: { publish: caps.publish === true, manage: caps.manage === true, feedback: caps.feedback === true, reply: caps.reply === true } } satisfies TeamWorldContext
        break
      }
      case 'source': {
        const source = await this.ports.source(input.origin, positive(input.version), signal)
        result = { sourceRef: await this.seal('source', actor, { source }) }; break
      }
      case 'originals': {
        const teamID = await this.ports.teamID(input.teamRef, actor), c = await cursor('originals-page', input.cursor)
        if (input.cursor && (c.team !== teamID || c.deleted !== !!input.deleted)) throw invalid()
        const v = await record('list', { team_id: teamID, deleted: !!input.deleted, before_at: c.at ?? 0, before_uid: c.uid ?? '', limit: limit(input.limit) })
        result = { items: await Promise.all(rows(v.items).map(r => this.original(r, actor, teamID))), hasMore: v.has_more === true,
          ...(v.has_more === true ? { nextCursor: await this.seal('originals-page', actor, { team: teamID, deleted: !!input.deleted, at: positive(v.before_at), uid: id(v.before_uid) }) } : {}) }; break
      }
      case 'original': {
        const c = await this.open('content', actor, input.contentRef)
        result = await this.original(await record('get', { team_id: owner(c.team), content_uid: id(c.uid) }), actor, owner(c.team)); break
      }
      case 'image-upload': {
        if (this.imageUploads >= 2) throw new ArkmePluginError('team-world-upload-busy', '团队图片正在上传，请稍后使用原请求重试', true, 429)
        this.imageUploads++
        try {
        const teamID = await this.ports.teamID(input.teamRef, actor)
        const content = input.contentRef ? await this.open('content', actor, input.contentRef) : { team: teamID, uid: id(input.contentUid) }
        if (content.team !== teamID || !['image/png','image/jpeg','image/webp'].includes(input.mimeType) || typeof input.contentBase64 !== 'string' || input.contentBase64.length > Math.ceil((20 << 20) / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw invalid()
        const bytes = Buffer.from(input.contentBase64, 'base64')
        if (!bytes.length || bytes.length > 20 << 20 || bytes.toString('base64') !== input.contentBase64) throw invalid()
        const identity = { team_id: teamID, content_uid: id(content.uid), upload_uid: id(input.uploadUid) }
        const prepared = await record('images/prepare', { ...identity, planned_size: bytes.length, file_hash: createHash('sha256').update(bytes).digest('hex'), mime_type: input.mimeType })
        if (str(prepared.upload_url)) {
          const headers = Object.fromEntries(Object.entries(obj(prepared.upload_headers)).filter((v): v is [string,string] => typeof v[1] === 'string'))
          const response = await this.runtime.fetchImpl(authorizedStorageURL(str(prepared.upload_url)), { method: 'PUT', body: Uint8Array.from(bytes), headers, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) })
          await response.body?.cancel()
          if (!response.ok) throw new ArkmePluginError('team-world-image-upload-failed', '团队图片上传失败，请使用原请求重试', true, 502)
        }
        const asset = await record('images/complete', identity)
        if (owner(asset.owner_user_id) !== actor || asset.upload_uid !== input.uploadUid || !id(asset.file_asset_uid)) throw invalid()
        result = { imageRef: await this.seal('image', actor, { team: teamID, uid: content.uid, asset }), mimeType: input.mimeType, size: bytes.length }
        } finally { this.imageUploads-- }
        break
      }
      case 'submit': {
        const teamID = await this.ports.teamID(input.teamRef, actor), request = id(input.requestUid), expected = nonnegative(input.expectedRevision)
        const content = input.contentRef ? await this.open('content', actor, input.contentRef) : { team: teamID, uid: request }
        if (content.team !== teamID || !['publish','edit','unpublish','delete','restore'].includes(input.change) || !input.contentRef && (expected !== 0 || input.change !== 'publish')) throw invalid()
        let draft: Record<string, unknown> | undefined
        if (input.draft) {
          const d = input.draft
          if (!['plain','markdown'].includes(d.format) || typeof d.text !== 'string' || [...d.text].length > 2000 || typeof d.title !== 'string' || [...d.title].length > 100 || !Array.isArray(d.imageRefs) || d.imageRefs.length > 27 || (d.sourceAssetUids?.length ?? 0) > 27) throw invalid()
          const source = d.sourceRef ? obj((await this.open('source', actor, d.sourceRef)).source) : {}
          if (expected === 0 && !d.sourceRef) throw invalid()
          const assets = await Promise.all(d.imageRefs.map(async ref => {
            const image = await this.open('image', actor, ref)
            if (image.team !== teamID || image.uid !== content.uid) throw invalid()
            return obj(image.asset)
          }))
          draft = { title: d.title, text: d.text, format: d.format, source, assets, source_asset_uids: d.sourceAssetUids?.map(id) ?? [], ...(d.parentRef ? { parent_uid: await this.ports.recordUID(d.parentRef) } : {}) }
        }
        const v = await record('submit', { team_id: teamID, content_uid: id(content.uid), request_uid: request, expected_revision: expected, action: input.change, ...(draft ? { draft } : {}) })
        result = await this.receipt(v, actor, teamID, request); break
      }
      case 'status': {
        const raw = await this.runtime.authenticatedTeamPost('/api/v1/team/world/command/status', { request_uid: id(input.requestUid) }, session, signal, true)
        result = raw == null ? null : await this.receipt(obj(raw), actor, owner(obj(raw).team_id), input.requestUid); break
      }
      case 'activity': {
        const teamID = input.teamRef ? await this.ports.teamID(input.teamRef, actor) : undefined
        const c = await cursor('activity-page', input.cursor)
        if (input.cursor && c.team !== teamID) throw invalid()
        const v = await team('activity/query', { before_at: c.at ?? 0, before_id: c.uid ?? '', limit: limit(input.limit), ...(teamID === undefined ? {} : { team_id: teamID }) })
        const activity = rows(v.items)
        if (teamID !== undefined && activity.some(r => owner(r.team_id) !== teamID)) throw invalid()
        const refs = activity.map(r => ({ team_id: owner(r.team_id), content_uid: id(r.content_uid) }))
        const publicUIDs = activity.map(r => id(r.publication_uid))
        const [summaries, publications] = await Promise.all([
          previews(refs), this.ports.publicPreviews(publicUIDs.map(uid => ({ recordUID: uid, ancestorUID: '' })), signal),
        ])
        if (publications.length !== activity.length) throw invalid()
        if (v.has_more === true && (!v.items || !rows(v.items).length || positive(v.before_at) === c.at && id(v.before_id) === c.uid)) throw invalid()
        result = { items: await Promise.all(activity.map(async (r, i) => {
          if (!['publish', 'edit', 'unpublish', 'delete', 'restore'].includes(str(r.action))) throw invalid()
          return { ...await this.receipt(r, actor, owner(r.team_id), id(r.request_uid)), action: r.action,
            recordRef: await this.ports.recordRef(publicUIDs[i]!, signal),
            ...(publications[i] ? { publication: publications[i] } : {}),
            ...(summaries[i]!.preview ? { preview: summaries[i]!.preview } : {}) }
        })), hasMore: v.has_more === true,
          ...(v.has_more === true ? { nextCursor: await this.seal('activity-page', actor, { at: positive(v.before_at), uid: id(v.before_id), ...(teamID === undefined ? {} : { team: teamID }) }) } : {}) }; break
      }
      case 'feedback': {
        const teamID = await this.ports.teamID(input.teamRef, actor), v = await team('feedback/query', { team_id: teamID, after_sequence: nonnegative(input.afterSequence ?? 0), limit: limit(input.limit), include_read: !!input.includeRead })
        const feedback = rows(v.items)
        const names = await this.ports.actorNames([...new Set(feedback.map(r => positive(r.actor_user_id)))], signal)
        const summaries = await previews(feedback.map(r => ({ team_id: teamID, content_uid: id(r.content_uid), ...(r.kind === 'reaction' ? { event_uid: id(r.event_uid) } : {}) })))
        const comments = feedback.flatMap((r, i) => r.kind === 'comment' && summaries[i]?.preview ? [{ row: r, ancestorUID: id(summaries[i]!.wire.publication_uid) }] : [])
        const publicationUIDs = [...new Set(summaries.filter(value => value.preview).map(value => id(value.wire.publication_uid)))]
        const [commentValues, publications] = await Promise.all([
          this.ports.publicPreviews(comments.map(({ row, ancestorUID }) => ({ recordUID: id(row.event_uid), ancestorUID })), signal),
          this.ports.publicPreviews(publicationUIDs.map(recordUID => ({ recordUID, ancestorUID: '' })), signal),
        ])
        if (publications.length !== publicationUIDs.length) throw invalid()
        const byPublication = new Map(publicationUIDs.map((uid, index) => [uid, publications[index]]))
        const identitySecret = await this.runtime.stateStore.uniqueCode()
        if (commentValues.length !== comments.length) throw invalid()
        const byComment = new Map(comments.map(({ row }, i) => [id(row.event_uid), commentValues[i]]))
        // One capability per original within this bounded response. Randomized
        // seals are not identity keys; sharing here lets every consumer group
        // the page without exposing private UIDs or caching authorization.
        const contentRefs = new Map<string, Promise<string>>()
        for (const row of feedback) {
          const uid = id(row.content_uid)
          if (!contentRefs.has(uid)) contentRefs.set(uid, this.contentRef(actor, teamID, uid))
        }
        result = { items: await Promise.all(feedback.map(async (r, i) => {
          if (!['reaction', 'comment'].includes(str(r.kind))) throw invalid()
          const summary = summaries[i]!
          if (!summary.preview) throw new ArkmePluginError('team-world-not-accessible', '当前无法查看这份团队内容，请刷新团队身份。', false, 403)
          const event = obj(summary.wire.reaction)
          let reaction: { active: boolean; expression: import('../reaction-contract.js').ReactionExpression } | undefined
          if (r.kind === 'reaction' && summary.wire.reaction) {
            if (event.event_uid !== r.event_uid || event.actor_user_id !== r.actor_user_id || event.context_uid !== r.context_uid || event.content_revision !== r.content_revision || event.at !== r.at || typeof event.active !== 'boolean') throw invalid()
            const expression = obj(event.expression)
            if (typeof expression.text !== 'string' || ['emoji','hand','color'].some(k => expression[k] !== undefined && typeof expression[k] !== 'string')) throw invalid()
            reaction = { active: event.active, expression: { text: expression.text, ...(expression.emoji ? { emoji: str(expression.emoji) } : {}), ...(expression.hand ? { hand: str(expression.hand) } : {}), ...(expression.color ? { color: str(expression.color) } : {}) } }
          }
          return { contentKey: createHmac('sha256', identitySecret).update(JSON.stringify([this.runtime.config.environment, actor, teamID, id(r.content_uid)])).digest('hex'), ...(byPublication.get(id(summary.wire.publication_uid)) ? { publication: byPublication.get(id(summary.wire.publication_uid)) } : {}), key: await this.seal('feedback-key', actor, { id: id(r.id) }), sequence: positive(r.sequence), contentRef: await contentRefs.get(id(r.content_uid))!, kind: r.kind, isMe: positive(r.actor_user_id) === actor, actorName: names.get(positive(r.actor_user_id)) ?? '', preview: summary.preview, ...(byComment.get(id(r.event_uid)) ? { comment: byComment.get(id(r.event_uid)) } : {}), ...(reaction ? { reaction } : {}), at: positive(r.at), eventRef: await this.seal('feedback-event', actor, { team: teamID, content: id(r.content_uid), kind: r.kind, event: id(r.event_uid), context: id(r.context_uid), revision: id(r.content_revision) }) }
        })), hasMore: v.has_more === true, afterSequence: nonnegative(v.after_sequence), seenThrough: nonnegative(v.seen_through), offeredThrough: nonnegative(v.offered_through) }; break
      }
      case 'feedback-read': {
        const v = await team('feedback/read', { team_id: await this.ports.teamID(input.teamRef, actor), through_sequence: nonnegative(input.throughSequence) }, false)
        if (v.ok !== true) throw invalid(); result = { ok: true }; break
      }
      case 'feedback-target': {
        const event = await this.open('feedback-event', actor, input.eventRef)
        const original = await this.original(await record('get', { team_id: owner(event.team), content_uid: id(event.content) }), actor, owner(event.team))
        const target = await this.ports.reactionTarget({ record_uid: await this.ports.recordUID(original.recordRef), world_context_uid: id(event.context), content_revision: id(event.revision) })
        const comment = event.kind === 'comment' ? (await this.ports.publicPreviews([{ recordUID: id(event.event), ancestorUID: await this.ports.recordUID(original.recordRef) }], signal))[0] : undefined
        result = { original, target, ...(event.kind === 'comment' ? { commentRef: await this.ports.recordRef(id(event.event)), ...(comment ? { comment } : {}) } : {}) }
        break
      }
      default: throw invalid()
    }
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== actor || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('team-world-account-changed', '账号已变化，请重新打开', false, 409)
    return result
  }
}
