import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { recordOwnerId, stringifyOwnerJson } from '../record-owner-id.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeTeam, ArkmeTeamRole, ArkmeDirectoryPage } from '../types.js'
import type { TeamChannel, TeamConversation, TeamIdentity, TeamMessage, TeamSide, TeamTimeline, TeamAppOperation, TeamMembers } from '../team-app-contract.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, stringValue, type ServiceRuntime } from './service.js'

const obj = objectValue
const str = stringValue
const num = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) ? v : 0
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(obj) : []
const role = (v: unknown): ArkmeTeamRole => v === 1 ? 'owner' : v === 2 ? 'admin' : 'member'
const invalid = (cause?: unknown) => new ArkmePluginError('team-reference-invalid', '团队消息引用无效，请重新打开', false, 409, { cause })
const reasons: Record<string, string> = {
  conversation_blocked: '此咨询已被屏蔽，双方暂时不能发送或编辑消息',
  not_accessible: '你已无权访问该团队消息，请刷新列表', channel_paused: '团队已暂停接收新消息',
  reply_conflict: '其他成员已回复，请阅读新回复后确认是否仍要发送', version_conflict: '内容已被更新，请重新读取后编辑',
  idempotency_conflict: '同一发送请求的内容不一致，请核对发送结果', invalid_request: '请求内容无效',
  rate_limited: '操作过于频繁，请稍后使用原请求重试',
  dependency_unavailable: '服务暂时不可用，请使用原请求重试', approval_required: '已启用加入审批', already_member: '你已经是团队成员',
}

/** App business adapter. Never uses Team OpenAPI or stores Chat session state. */
export class TeamAppService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid)
  }
  private async ref(kind: string, value: Record<string, unknown>, actor: number): Promise<string> {
    return await this.codec.seal(`team-app-${kind}`, { ...value, viewer: actor })
  }
  private async open(kind: string, value: unknown, actor: number): Promise<Record<string, unknown>> {
    const decoded = await this.codec.open(`team-app-${kind}`, str(value))
    if (decoded.viewer !== actor) throw invalid()
    return decoded
  }
  private async key(value: string, actor: number): Promise<string> {
    return createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(`team:${actor}:${value}`).digest('hex')
  }
  private async identity(raw: unknown, actor: number): Promise<TeamIdentity> {
    const v = obj(raw), url = str(v.avatar_url)
    return { nickname: str(v.nickname) || '用户', ...(url ? { imageRef: await this.ref('image', { url }, actor) } : {}) }
  }
  private async team(raw: unknown, actor: number): Promise<ArkmeTeam> {
    const v = obj(raw)
    if (!recordOwnerId(v.team_id)) throw invalid()
    return { teamRef: await this.ref('team', { team_id: recordOwnerId(v.team_id) }, actor), name: str(v.name), jotmoId: str(v.jotmo_id),
      currentUserRole: role(v.role), createdAtMillis: num(v.ca), updatedAtMillis: num(v.ua) }
  }
  private async channel(raw: unknown, actor: number): Promise<TeamChannel> {
    const v = obj(raw)
    const identity = await this.identity({ nickname: v.name, avatar_url: v.avatar_url }, actor)
    const publicRef = str(v.public_ref)
    const link = new URL('/team-message', this.runtime.config.shareWebsite || 'https://www.jotmo.cc')
    link.searchParams.set('channel', publicRef)
    return { teamRef: await this.ref('team', { team_id: recordOwnerId(v.team_id) }, actor), name: str(v.name), jotmoId: str(v.jotmo_id),
      ...(identity.imageRef ? { imageRef: identity.imageRef } : {}), publicRef, link: publicRef ? link.toString() : '',
      enabled: v.enabled === true, revision: num(v.revision), canManage: v.can_manage === true }
  }
  private async conversation(raw: unknown, actor: number): Promise<TeamConversation> {
    const v = obj(raw), uid = str(v.conversation_uid), side: TeamSide = v.side === 'team' ? 'team' : 'external'
    if (!uid) throw invalid()
    // A former visitor can also be a current member. Each side owns a different
    // composer and accepted send identity, even when the conversation is shared.
    return { ref: await this.ref('conversation', { conversation_uid: uid, side }, actor), key: await this.key(`${uid}:${side}`, actor),
      channel: await this.channel(v.channel, actor), ...(v.visitor ? { visitor: await this.identity(v.visitor, actor) } : {}), side,
      lastSeq: num(v.last_seq), latestTeamReplySeq: num(v.latest_team_reply_seq), myReadSeq: num(v.my_read_seq), unread: num(v.unread),
      needsReply: v.needs_reply === true, blocked: v.blocked === true, revision: num(v.revision), updatedAt: num(v.updated_at), ...(v.preview ? { preview: { text: str(obj(v.preview).text), status: str(obj(v.preview).status), hasMedia: obj(v.preview).has_media === true } } : {}) }
  }
  private async message(raw: unknown, actor: number, context: Record<string, unknown>): Promise<TeamMessage> {
    const v = obj(raw), content = obj(v.record), uid = str(v.message_uid)
    const locator = { conversation_uid: context.conversation_uid, side: context.side, message_uid: uid }
    return { ref: await this.ref('message', locator, actor), key: await this.key(uid, actor), seq: num(v.seq), revision: num(v.revision),
      side: v.side === 'team' ? 'team' : 'external', sender: await this.identity(v.sender, actor), own: v.own === true,
      state: str(v.state), createdAt: num(v.created_at), canEdit: v.can_edit === true, canWithdraw: v.can_withdraw === true,
      version: num(content.version), contentStatus: str(content.status), ...(v.record ? { content: {
        text_content: str(content.text_content), title: str(content.title), template_kind: num(content.template_kind) || 1,
        ...(content.content_payload ? { content_payload: obj(content.content_payload) } : {}),
      } } : {}),
      media: await Promise.all(list(content.media).map(async f => ({
        ref: await this.ref('media', { ...locator, record_version: num(content.version), file_asset_uid: str(f.file_asset_uid), file_name: str(f.file_name), mime_type: str(f.mime_type) }, actor),
        name: str(f.file_name) || '附件', mimeType: str(f.mime_type), size: num(f.size), kind: num(f.file_kind),
      }))),
    }
  }

  async execute(operation: TeamAppOperation, p: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(), actor = session.userId
    const assertAccount = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.accountScopedSession()
      if (!current || current.userId !== actor || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('team-account-changed', '登录账号已变化，请重新打开团队消息', false, 409)
    }
    const post = async (path: string, body: Record<string, unknown> = {}, read = false): Promise<Record<string, unknown>> => {
      await assertAccount()
      const result = await this.runtime.authenticatedTeamPost<unknown>(`/api/v1/team/${path}`, body, session, signal, read)
      await assertAccount()
      return obj(result)
    }
    try {
      const result = await this.dispatch(operation, p, session, post, signal)
      await assertAccount()
      return result
    } catch (error) {
      if (error instanceof ArkmeUpstreamResponseError) {
        const reason = str(obj(error.responseData).reason)
        if (reasons[reason]) throw new ArkmePluginError(`team-${reason}`, reasons[reason], reason === 'dependency_unavailable' || reason === 'rate_limited', reason === 'dependency_unavailable' ? 503 : reason === 'rate_limited' ? 429 : 409, { cause: error })
      }
      throw error
    }
  }

  private async dispatch(operation: TeamAppOperation, p: Record<string, unknown>, session: ArkmeSessionCredentials,
    post: (path: string, body?: Record<string, unknown>, read?: boolean) => Promise<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    const actor = session.userId
    const teamID = async () => (await this.open('team', p.teamRef, actor)).team_id
    const conversation = async () => {
      const v = await this.open('conversation', p.conversationRef, actor)
      return { conversation_uid: v.conversation_uid, side: v.side }
    }
    const message = async () => {
      const v = await this.open('message', p.messageRef, actor)
      return { conversation_uid: v.conversation_uid, message_uid: v.message_uid, side: v.side }
    }
    switch (operation) {
      case 'team.app.attention': {
        const data = await post('conversations/attention', {}, true)
        return { external: data.external === true, team: data.team === true, applications: data.applications === true }
      }
      case 'team.app.teams': case 'team.app.directory': {
        const data = await post('list-mine', {}, true)
        const teams = await Promise.all(list(data.teams).map(v => this.team(v, actor)))
        if (operation === 'team.app.teams') return teams
        const offset = p.cursor ? num((await this.open('directory-cursor', p.cursor, actor)).offset) : 0
        const limit = Math.min(100, Math.max(1, num(p.limit) || 50))
        const hasMore = offset + limit < teams.length
        const items = p.countOnly === true ? [] : teams.slice(offset, offset + limit).map(v => ({ kind: 'team' as const, teamRef: v.teamRef, displayName: v.name, publicId: v.jotmoId, role: v.currentUserRole }))
        return { section: 'teams', items, total: teams.length, hasMore: p.countOnly === true ? false : hasMore,
          ...(hasMore ? { nextCursor: await this.ref('directory-cursor', { offset: offset + limit }, actor) } : {}) } satisfies ArkmeDirectoryPage
      }
      case 'team.app.members': {
        const id = await teamID()
        const [data, mine] = await Promise.all([post('members/list', { team_id: id, limit: num(p.limit) || 50, ...(p.pageCursor ? { page_cursor: (await this.open('member-cursor', p.pageCursor, actor)).cursor } : {}) }, true), post('list-mine', {}, true)])
        const selected = list(mine.teams).find(v => String(v.team_id) === String(id))
        if (!selected) throw new ArkmePluginError('team-not_accessible', reasons.not_accessible!, false, 403)
        return { team: await this.team(selected, actor), totalCount: num(data.total_count), hasMore: data.has_more === true,
          ...(data.next_page_cursor ? { nextPageCursor: await this.ref('member-cursor', { cursor: data.next_page_cursor }, actor) } : {}),
          items: await Promise.all(list(data.items).map(async v => ({
            userRef: await this.ref('member', { team_id: id, user_id: recordOwnerId(v.user_id) }, actor), displayName: str(v.display_name) || '用户',
            ...(v.jotmo_id ? { jotmoId: str(v.jotmo_id) } : {}), identityState: v.identity_state === 'ready' ? 'ready' as const : 'incomplete' as const,
            role: role(v.role), joinedAtMillis: num(v.joined_at), canRemove: v.can_remove === true,
          }))),
        } satisfies TeamMembers
      }
      case 'team.app.member.remove': {
        const ref = await this.open('member', p.userRef, actor)
        return await post('members/remove', { team_id: ref.team_id, target_user_id: ref.user_id })
      }
      case 'team.app.leave': return await post('members/leave', { team_id: await teamID() })
      case 'team.app.create': return await this.team((await post('create', { name: str(p.name), jotmo_id: str(p.jotmoId), request_uid: str(p.requestUid) })).team, actor)
      case 'team.app.join.status': {
        const data = await post('join-requests/status', { jotmo_id: str(p.jotmoId) }, true)
        return { state: str(data.state) }
      }
      case 'team.app.join': {
        try { return { state: 'joined', team: await this.team((await post('join-by-jotmo-id', { jotmo_id: str(p.jotmoId) })).team, actor) } }
        catch (error) {
          if (!(error instanceof ArkmeUpstreamResponseError) || obj(error.responseData).reason !== 'approval_required') throw error
          const result = await post('join-requests/create', { jotmo_id: str(p.jotmoId), request_uid: str(p.requestUid) })
          return { state: str(result.state) }
        }
      }
      case 'team.app.channel': return await this.channel(await post('message-channel/get', { team_id: await teamID() }, true), actor)
      case 'team.app.channel.configure': { const id = await teamID(), channel = await post('message-channel/get', { team_id: id }, true); return await this.channel(await post('message-channel/configure', { team_id: id, expected_revision: num(p.revision), enabled: p.enabled === true, rotate_link: p.rotate === true, avatar_url: str(channel.avatar_url) }), actor) }
      case 'team.app.official': return await this.channel(await post('official-feedback-target', {}, true), actor)
      case 'team.app.open': {
        const data = await post('conversations/open', { public_ref: str(p.publicRef) })
        return { channel: await this.channel(data.channel, actor), openInbox: data.open_inbox === true,
          ...(data.conversation ? { conversation: await this.conversation(data.conversation, actor) } : {}) }
      }
      case 'team.app.conversations': {
        const data = await post('conversations/list', { side: p.side === 'team' ? 'team' : 'external', ...(p.teamRef ? { team_id: await teamID() } : {}),
          cursor: p.cursor ? str((await this.open('conversation-cursor', p.cursor, actor)).cursor) : '', limit: num(p.limit) || 30 }, true)
        return { items: await Promise.all(list(data.items).map(v => this.conversation(v, actor))), hasMore: data.has_more === true,
          ...(data.next_cursor ? { nextCursor: await this.ref('conversation-cursor', { cursor: data.next_cursor }, actor) } : {}) }
      }
      case 'team.app.timeline': {
        const context = await conversation(), data = await post('conversations/timeline/page', { ...context, before_seq: num(p.beforeSeq), limit: num(p.limit) || 50 }, true)
        return { conversation: await this.conversation(data.conversation, actor), messages: await Promise.all(list(data.messages).map(v => this.message(v, actor, context))),
          hasMore: data.has_more === true, beforeSeq: num(data.before_seq) } satisfies TeamTimeline
      }
      case 'team.app.send': {
        const context = await conversation()
        try {
          const data = await post('conversations/messages/send', { ...context, client_message_uid: str(p.clientUid), expected_reply_seq: num(p.expectedReplySeq), content: obj(p.content),
            ...(p.replyToRef ? { reply_to: (await this.open('message', p.replyToRef, actor)).message_uid } : {}) })
          return { message: await this.message(data, actor, context) }
        } catch (error) {
          if (!(error instanceof ArkmeUpstreamResponseError)) throw error
          const data = obj(error.responseData), pending = obj(data.operation)
          if (!pending.message_uid) throw error
          return { reason: str(data.reason), message: await this.message(pending, actor, context) }
        }
      }
      case 'team.app.send.status': case 'team.app.send.confirm': {
        const m = await message()
        const data = await post(operation === 'team.app.send.status' ? 'conversations/messages/send-status' : 'conversations/messages/confirm-reply',
          operation === 'team.app.send.status' ? { message_uid: m.message_uid, side: m.side } : { message_uid: m.message_uid, expected_reply_seq: num(p.expectedReplySeq) })
        return { message: await this.message(data, actor, m) }
      }
      case 'team.app.edit': { const m = await message(); return await post('conversations/messages/update', { message_uid: m.message_uid, side: m.side, expected_record_version: num(p.version), content: obj(p.content) }) }
      case 'team.app.withdraw': { const m = await message(); return await post('conversations/messages/withdraw', { message_uid: m.message_uid, side: m.side }) }
      case 'team.app.read': return await post('conversations/read/advance', { ...await conversation(), read_seq: num(p.readSeq) })
      case 'team.app.receipts': {
        const context = await message()
        const cursor = p.cursor ? await this.open('receipt-cursor', p.cursor, actor) : {}
        if (p.cursor && cursor.message_uid !== context.message_uid) throw invalid()
        const data = await post('conversations/read-receipts/query', { ...context, cursor: str(cursor.cursor), limit: 50 }, true)
        return { teamRead: data.team_read === true, visitorRead: data.visitor_read === true, hasMore: data.has_more === true,
          ...(data.next_cursor ? { nextCursor: await this.ref('receipt-cursor', { message_uid: context.message_uid, cursor: data.next_cursor }, actor) } : {}),
          members: await Promise.all(list(data.members).map(async v => ({ ...await this.identity(v.identity, actor), read: v.read === true, readAt: num(v.read_at) }))) }
      }
      case 'team.app.block': return await post('conversations/block', { conversation_uid: (await conversation()).conversation_uid, blocked: p.blocked === true })
      case 'team.app.applications': {
        const id = await teamID(), cursor = p.cursor ? await this.open('application-cursor', p.cursor, actor) : {}
        const data = await post('join-requests/list', { team_id: id, after_at: num(cursor.at), after_user_id: cursor.user_id ?? 0, limit: 50 }, true)
        const rows = list(data.items), last = rows.at(-1)
        return { items: await Promise.all(rows.map(async v => ({ ref: await this.ref('application', { team_id: id, user_id: recordOwnerId(v.user_id), revision: num(v.revision) }, actor),
          name: str(v.display_name) || '申请人', state: str(v.state), revision: num(v.revision), requestedAt: num(v.requested_at) }))), hasMore: rows.length === 50,
          ...(last && rows.length === 50 ? { nextCursor: await this.ref('application-cursor', { at: last.requested_at, user_id: last.user_id }, actor) } : {}) }
      }
      case 'team.app.application.decide': {
        const v = await this.open('application', p.applicationRef, actor)
        const data = await post('join-requests/decide', { team_id: v.team_id, user_id: v.user_id, revision: v.revision, approve: p.approve === true })
        return { state: str(data.state) }
      }
      case 'team.app.media': { await this.open('media', p.mediaRef, actor); return { url: `${this.runtime.config.routePath}/team/media?ref=${encodeURIComponent(str(p.mediaRef))}` } }
      case 'team.app.image': return await this.image(p, session, signal)
      default: throw new ArkmePluginError('operation-unsupported', '不支持该团队操作', false)
    }
  }

  private async readBytes(response: Response, maximum: number): Promise<Buffer> {
    if (!response.ok || !response.body) throw new ArkmePluginError('team-media-unavailable', '附件暂不可用，请重新打开消息', true, 502)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0
    try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength
      if (length > maximum) throw new ArkmePluginError('team-media-too-large', '附件超过浏览器预览大小限制', false, 413)
      chunks.push(part.value)
    } } finally { await reader.cancel().catch(() => {}) }
    return Buffer.concat(chunks)
  }
  async fetchMedia(mediaRef: string, range: string | undefined, signal: AbortSignal): Promise<{ response: Response; fileName: string; mimeType: string }> {
    const initial = await this.runtime.requireSession()
    const ref = await this.open('media', mediaRef, initial.userId)
    const body = { message_uid: ref.message_uid, side: ref.side, file_asset_uid: ref.file_asset_uid, record_version: ref.record_version, preview: false }
    if (!this.runtime.config.teamBaseUrl) throw invalid()
    let session = initial
    const fetchMedia = () => this.runtime.fetchImpl(`${this.runtime.config.teamBaseUrl}/api/v1/team/conversations/messages/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}`, ...(range ? { Range: range } : {}) },
      body: stringifyOwnerJson(body), redirect: 'error', signal,
    })
    let response = await fetchMedia()
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); session = await this.runtime.refreshAccessToken(session); response = await fetchMedia() }
    const current = await this.runtime.accountScopedSession()
    if (signal.aborted || !current || current.userId !== initial.userId || current.refreshToken !== initial.refreshToken) { await response.body?.cancel(); throw invalid() }
    if (!response.ok || response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new ArkmePluginError('team-not_accessible', '附件已失效或无权访问，请刷新消息', false, 403) }
    return { response, fileName: str(ref.file_name) || 'attachment', mimeType: str(ref.mime_type) || 'application/octet-stream' }
  }
  private async image(p: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<unknown> {
    const ref = await this.open('image', p.imageRef, session.userId), url = new URL(str(ref.url))
    const hosts = this.runtime.config.environment === 'prod' ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc'] : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw invalid()
    const response = await this.runtime.fetchImpl(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) { await response.body?.cancel(); throw invalid() }
    return { base64: (await this.readBytes(response, 5 * 1024 * 1024)).toString('base64'), mimeType }
  }
}
