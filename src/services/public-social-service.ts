import type { ArkmeSourceItem } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { PublicGroup, PublicGroupPage, PublicGroupQuery, PublicGroupJoinResult, PublicGroupSettings, PublicPeoplePage, PublicPeopleQuery, PublicPerson } from '../public-social-contract.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { PublicJoinRequestPage, PublicSocialReadInput, PublicSocialWriteInput, PublicSocialReadResult, PublicSocialWriteResult } from '../public-social-contract.js'

const prefix = '/api/v1/chats/discovery'
function invalid(): never { throw new ArkmePluginError('public-social-response-invalid', '公开目录响应不完整，请重试', false, 502) }
function uid(value: unknown): string { const s = stringValue(value).trim(); if (!s || s.length > 256) return invalid(); return s }
function userId(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(); return value }
function text(value: unknown): string { if (typeof value !== 'string') return invalid(); return value }
function enabled(value: unknown): boolean { if (typeof value !== 'boolean') throw new ArkmePluginError('public-social-input-invalid', '请明确指定操作状态', false, 400); return value }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value }
function groupItem(value: unknown): PublicGroup {
  const v = objectValue(value), mode = v.join_mode
  if (mode !== 1 && mode !== 2 && mode !== 3) return invalid()
  const request = v.join_request === undefined || v.join_request === null ? undefined : objectValue(v.join_request)
  if (request && request.status !== 1 && request.status !== 2 && request.status !== 3) return invalid()
  return { chatSessionUid: uid(v.chat_session_uid), title: text(v.title), introduction: text(v.introduction), ownerUserId: userId(v.owner_user_id), hasJoined: boolean(v.has_joined), joinMode: mode,
    ...(request ? { joinRequest: { requestUid: uid(request.request_uid), status: request.status as 1 | 2 | 3 } } : {}) }
}
function personItem(value: unknown): PublicPerson {
  const v = objectValue(value)
  const avatar = text(v.avatar_url)
  return { userId: userId(v.user_id), isListed: boolean(v.is_listed), displayName: text(v.display_name), introduction: text(v.introduction),
    avatarUrl: /^https?:\/\//i.test(avatar) ? avatar : '' }
}
function introduction(value: string): string {
  if (typeof value !== 'string' || Array.from(value).length > 500) throw new ArkmePluginError('public-social-introduction-invalid', '介绍最多 500 个字符', false, 400)
  return value.trim()
}

/** Chat owns listing, admission and pair identity; Host only adapts DTOs and opens existing sources. */
export class PublicSocialService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), () => new ArkmePluginError('public-social-reference-invalid', '引用已失效，请重新读取', false, 409))
  }
  private async seal(scope: string, kind: string, value: unknown) { const ref = await this.codec.seal('arkme-social-v1', { scope, kind, value }); await this.session(scope); return ref }
  private async unseal(scope: string, kind: string, ref: string) {
    const p = await this.codec.open('arkme-social-v1', ref)
    if (p.scope !== scope || p.kind !== kind) throw new ArkmePluginError('public-social-reference-invalid', '引用已失效，请重新读取', false, 409)
    return p.value
  }

  private async session(scope: string): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('public-social-account-changed', '账号已切换，请重新打开页面', false, 409)
    return session
  }
  private async post(path: string, body: Record<string, unknown>, scope: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return await this.chatPost(`${prefix}${path}`, body, scope, signal)
  }
  private async chatPost(path: string, body: Record<string, unknown>, scope: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = await this.session(scope)
    try {
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(path, body, session, signal)
      signal?.throwIfAborted(); await this.session(scope)
      return result
    } catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arkme-http-error' && error.upstreamStatus === 404) throw new ArkmePluginError('public-social-unavailable', '公开社交服务尚未开放，请稍后重试', false, 503)
      throw error
    }
  }
  async queryGroups(input: PublicGroupQuery, signal?: AbortSignal): Promise<PublicGroupPage> {
    if ((input.query?.length ?? 0) > 200 || (input.userId !== undefined && (!Number.isSafeInteger(input.userId) || input.userId <= 0))) throw new ArkmePluginError('public-social-query-invalid', '查询条件无效', false, 400)
    const data = await this.post('/groups/query', { limit: 30, ...(input.query?.trim() ? { query: input.query.trim() } : {}), ...(input.cursor ? { before_uid: input.cursor } : {}), ...(input.userId ? { user_id: input.userId } : {}), ...(input.relation ? { relation: input.relation } : {}) }, input.accountScope, signal)
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') return invalid()
    const items = data.items.map(groupItem), hasMore = data.has_more
    const nextCursor = hasMore ? uid(data.next_before_uid) : undefined
    if (hasMore && (items.length === 0 || nextCursor === input.cursor)) return invalid()
    return { items, hasMore, ...(nextCursor ? { nextCursor } : {}) }
  }
  async readGroup(chatSessionUid: string, scope: string, signal?: AbortSignal): Promise<PublicGroup> {
    const group = groupItem(await this.post('/groups/read', { chat_session_uid: uid(chatSessionUid) }, scope, signal))
    if (group.chatSessionUid !== chatSessionUid) return invalid()
    return group
  }
  async queryPeople(input: PublicPeopleQuery, signal?: AbortSignal): Promise<PublicPeoplePage> {
    if (Array.from(input.query ?? '').length > 100) throw new ArkmePluginError('public-social-query-invalid', '查询条件无效', false, 400)
    const data = await this.post('/people/query', { limit: 30, ...(input.query?.trim() ? { query: input.query.trim() } : {}), ...(input.cursor ? { before_user_id: input.cursor } : {}) }, input.accountScope, signal)
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') return invalid()
    const items = data.items.map(personItem), hasMore = data.has_more
    const nextCursor = hasMore ? userId(data.next_before_user_id) : undefined
    if (hasMore && (items.length === 0 || nextCursor === input.cursor)) return invalid()
    return { items, hasMore, ...(nextCursor ? { nextCursor } : {}) }
  }
  async readPerson(targetUserId: number | undefined, scope: string, signal?: AbortSignal): Promise<PublicPerson> {
    const session = await this.session(scope)
    const data = await this.post('/people/read', targetUserId ? { user_id: userId(targetUserId) } : {}, scope, signal)
    const person = personItem(data)
    if (person.userId !== (targetUserId ?? session.userId)) return invalid()
    return person
  }
  async setPerson(scope: string, isListed: boolean, value: string, signal?: AbortSignal): Promise<PublicPerson> {
    const session = await this.session(scope)
    const result = personItem(await this.post('/people/listing/set', { is_listed: isListed, ...(isListed ? { introduction: introduction(value) } : {}) }, scope, signal))
    if (result.userId !== session.userId || result.isListed !== isListed) return invalid()
    return result
  }
  private async open(uidValue: string, scope: string, expectedKind: 'group_chat' | 'private_chat', signal?: AbortSignal): Promise<ArkmeSourceItem> {
    const session = await this.session(scope)
    const bundle = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/detail', { chat_session_uid: uidValue }, session, signal)
    await this.session(scope); signal?.throwIfAborted()
    const member = objectValue(bundle.current_member), identity = objectValue(bundle.session)
    if (identity.chat_session_uid !== uidValue || member.user_id !== session.userId || member.status !== 1) return invalid()
    const result = await this.source.chatSourceFromBundle(bundle, session, this.source.cachedChatSource(session.userId, uidValue), [])
    if (result.kind !== expectedKind) return invalid()
    await this.session(scope); signal?.throwIfAborted()
    this.source.setChatSource(session.userId, uidValue, result)
    this.source.invalidateSourceListCache(session.userId, 'root')
    return result
  }
  async joinGroup(chatSessionUid: string, requestUid: string, scope: string, signal?: AbortSignal): Promise<PublicGroupJoinResult> {
    const data = await this.post('/groups/join', { chat_session_uid: uid(chatSessionUid), request_uid: uid(requestUid) }, scope, signal)
    if (data.chat_session_uid !== chatSessionUid || (data.status !== 'joined' && data.status !== 'pending')) return invalid()
    const group = await this.readGroup(chatSessionUid, scope, signal)
    const source = data.status === 'joined' ? await this.open(chatSessionUid, scope, 'group_chat', signal) : undefined
    return { status: data.status, group, ...(source ? { source } : {}) }
  }
  async openPerson(targetUserId: number, scope: string, signal?: AbortSignal): Promise<ArkmeSourceItem> {
    const data = await this.post('/people/chat', { user_id: userId(targetUserId) }, scope, signal)
    return await this.open(uid(data.chat_session_uid), scope, 'private_chat', signal)
  }
  async openGroup(chatSessionUid: string, scope: string, signal?: AbortSignal): Promise<ArkmeSourceItem> {
    return await this.open(uid(chatSessionUid), scope, 'group_chat', signal)
  }
  async groupSettings(sourceRef: string, scope: string, signal?: AbortSignal): Promise<PublicGroupSettings> {
    const session = await this.session(scope), source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持群聊', false, 400)
    const settings = await this.post('/groups/settings/get', { chat_session_uid: source.ownerRef }, scope, signal)
    if (settings.chat_session_uid !== source.ownerRef) return invalid()
    return { chatSessionUid: source.ownerRef, isPublic: boolean(settings.is_public), introduction: text(settings.introduction), canManage: boolean(settings.can_manage), isShown: boolean(settings.is_shown) }
  }

  async setGroup(sourceRef: string, scope: string, isPublic: boolean, value: string, signal?: AbortSignal): Promise<PublicGroupSettings> {
    const session = await this.session(scope), source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持群聊', false, 400)
    await this.post('/groups/settings/set', { chat_session_uid: source.ownerRef, is_public: isPublic, introduction: introduction(value) }, scope, signal)
    return await this.groupSettings(sourceRef, scope, signal)
  }
  async setShowcase(sourceRef: string, scope: string, isShown: boolean, signal?: AbortSignal): Promise<PublicGroupSettings> {
    const session = await this.session(scope), source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持群聊', false, 400)
    await this.post('/groups/showcase/set', { chat_session_uid: source.ownerRef, is_shown: isShown }, scope, signal)
    return await this.groupSettings(sourceRef, scope, signal)
  }
  async requests(sourceRef: string, scope: string, cursor?: string, signal?: AbortSignal): Promise<PublicJoinRequestPage> {
    const session = await this.session(scope), source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持群聊', false, 400)
    const before = cursor ? objectValue(await this.unseal(scope, `requests:${source.ownerRef}`, cursor)) : undefined
    const page = await this.chatPost('/api/v1/chats/governance/join/list', { chat_session_uid: source.ownerRef, statuses: [1], limit: 30, ...(before ? { cursor: before } : {}) }, scope, signal)
    if (page.chat_session_uid !== source.ownerRef || !Array.isArray(page.items) || typeof page.has_more !== 'boolean') return invalid()
    const items = await Promise.all(page.items.map(async value => {
      const row = objectValue(value)
      if (row.chat_session_uid !== source.ownerRef || row.status !== 1 || typeof row.request_at !== 'number' || typeof row.update_at !== 'number') return invalid()
      return { requestRef: await this.seal(scope, `approval:${source.ownerRef}`, { uid: uid(row.request_uid), updateAt: row.update_at }), displayName: text(row.display_name), status: 1 as const, requestAt: row.request_at }
    }))
    const next = page.has_more ? objectValue(page.next_cursor) : undefined
    if (next && (items.length === 0 || typeof next.request_at !== 'number' || !stringValue(next.request_uid))) return invalid()
    return { items, hasMore: page.has_more, ...(next ? { nextCursor: await this.seal(scope, `requests:${source.ownerRef}`, next) } : {}) }
  }
  async resolveRequest(sourceRef: string, scope: string, requestRef: string, approved: boolean, signal?: AbortSignal) {
    const session = await this.session(scope), source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持群聊', false, 400)
    const request = objectValue(await this.unseal(scope, `approval:${source.ownerRef}`, requestRef))
    if (typeof request.updateAt !== 'number') return invalid()
    const status = approved ? 2 : 3
    const result = await this.chatPost('/api/v1/chats/governance/join/resolve', { request_uid: uid(request.uid), status, update_at: Math.max(Date.now(), request.updateAt + 1) }, scope, signal)
    const row = objectValue(result.approval)
    if (row.request_uid !== request.uid || row.chat_session_uid !== source.ownerRef || row.status !== status) return invalid()
    return { requestRef, status: status as 2 | 3 }
  }
  async read(input: PublicSocialReadInput, signal?: AbortSignal): Promise<PublicSocialReadResult> {
    const session = await this.runtime.requireSession(), scope = input.accountScope ?? `${this.runtime.config.environment}:${session.userId}`
    await this.session(scope)
    switch (input.operation) {
      case 'groups': {
        const cursor = input.cursor ? uid(await this.unseal(scope, 'group-cursor', input.cursor)) : undefined
        const profile = input.reference ? userId(await this.unseal(scope, 'person', input.reference)) : undefined
        const page = await this.queryGroups({ accountScope: scope, ...(input.query ? { query: input.query } : {}), ...(cursor ? { cursor } : {}), ...(profile ? { userId: profile } : {}) }, signal)
        return { operation: input.operation, accountScope: scope, hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: await this.seal(scope, 'group-cursor', page.nextCursor) } : {}), items: await Promise.all(page.items.map(async group => ({ reference: await this.seal(scope, 'group', group.chatSessionUid), title: group.title, introduction: group.introduction, hasJoined: group.hasJoined, joinMode: group.joinMode, approvalStatus: group.joinRequest?.status }))) }
      }
      case 'people': {
        const cursor = input.cursor ? userId(await this.unseal(scope, 'person-cursor', input.cursor)) : undefined
        const page = await this.queryPeople({ accountScope: scope, ...(input.query ? { query: input.query } : {}), ...(cursor ? { cursor } : {}) }, signal)
        return { operation: input.operation, accountScope: scope, hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: await this.seal(scope, 'person-cursor', page.nextCursor) } : {}), items: await Promise.all(page.items.map(async person => ({ reference: await this.seal(scope, 'person', person.userId), displayName: person.displayName, introduction: person.introduction, isSelf: person.userId === session.userId }))) }
      }
      case 'person': {
        const target = input.reference ? userId(await this.unseal(scope, 'person', input.reference)) : undefined
        const person = await this.readPerson(target, scope, signal)
        return { operation: input.operation, accountScope: scope, displayName: person.displayName, introduction: person.introduction, isListed: person.isListed }
      }
      case 'settings': { const v = await this.groupSettings(input.reference ?? '', scope, signal); return { operation: input.operation, accountScope: scope, isPublic: v.isPublic, isShown: v.isShown, canManage: v.canManage, introduction: v.introduction } }
      case 'requests': return { operation: input.operation, accountScope: scope, ...await this.requests(input.reference ?? '', scope, input.cursor, signal) }
      default: throw new ArkmePluginError('public-social-operation-invalid', '不支持的公开社交操作', false, 400)
    }
  }
  async write(input: PublicSocialWriteInput, signal?: AbortSignal): Promise<PublicSocialWriteResult> {
    const scope = input.accountScope
    await this.session(scope)
    const sourceResult = (source: ArkmeSourceItem) => ({ sourceRef: source.sourceRef, kind: source.kind, displayName: source.displayName })
    switch (input.operation) {
      case 'join': {
        const id = uid(await this.unseal(scope, 'group', input.reference ?? '')), group = await this.readGroup(id, scope, signal)
        const result = await this.joinGroup(id, group.joinRequest?.status !== 3 && group.joinRequest ? group.joinRequest.requestUid : uid(input.requestId ?? ''), scope, signal)
        return { operation: 'join', status: result.status, ...(result.source ? { source: sourceResult(result.source) } : {}) }
      }
      case 'chat': return { operation: 'chat', ...sourceResult(await this.openPerson(userId(await this.unseal(scope, 'person', input.reference ?? '')), scope, signal)) }
      case 'listing': { const listed = enabled(input.enabled); const introduction = input.introduction ?? (listed ? (await this.readPerson(undefined, scope, signal)).introduction : ''); const p = await this.setPerson(scope, listed, introduction, signal); return { operation: 'listing', isListed: p.isListed, introduction: p.introduction } }
      case 'group': { const isPublic = enabled(input.enabled); const introduction = input.introduction ?? (await this.groupSettings(input.reference ?? '', scope, signal)).introduction; const p = await this.setGroup(input.reference ?? '', scope, isPublic, introduction, signal); return { operation: 'group', isPublic: p.isPublic, introduction: p.introduction } }
      case 'showcase': { const p = await this.setShowcase(input.reference ?? '', scope, enabled(input.enabled), signal); return { operation: 'showcase', isShown: p.isShown } }
      case 'resolve': return { operation: 'resolve', ...await this.resolveRequest(input.reference ?? '', scope, input.requestRef ?? '', enabled(input.enabled), signal) }
      default: throw new ArkmePluginError('public-social-operation-invalid', '不支持的公开社交操作', false, 400)
    }
  }

}
