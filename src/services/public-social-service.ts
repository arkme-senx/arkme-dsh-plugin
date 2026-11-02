import type { ArkmeSourceItem } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { PublicGroup, PublicGroupPage, PublicGroupQuery, PublicGroupJoinResult, PublicGroupSettings, PublicPeoplePage, PublicPeopleQuery, PublicPerson } from '../public-social-contract.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'
import type { GroupService } from './group-service.js'

const prefix = '/api/v1/chats/discovery'
function invalid(): never { throw new ArkmePluginError('public-social-response-invalid', '公开目录响应不完整，请重试', false, 502) }
function uid(value: unknown): string { const s = stringValue(value).trim(); if (!s || s.length > 256) return invalid(); return s }
function userId(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(); return value }
function text(value: unknown): string { if (typeof value !== 'string') return invalid(); return value }
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
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService, private readonly groups: Pick<GroupService, 'groupSettings'>) {}

  private async session(scope: string): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('public-social-account-changed', '账号已切换，请重新打开页面', false, 409)
    return session
  }
  private async post(path: string, body: Record<string, unknown>, scope: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const session = await this.session(scope)
    try {
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(`${prefix}${path}`, body, session, signal)
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
    const membership = await this.groups.groupSettings(sourceRef, signal)
    await this.session(scope)
    const canManage = membership.selfRole === 'owner' && membership.selfStatus === 'active'
    if (membership.selfStatus !== 'active') throw new ArkmePluginError('public-social-membership-inactive', '你已不在此群中', false, 403)
    if (canManage) {
      const settings = await this.post('/groups/settings/get', { chat_session_uid: source.ownerRef }, scope, signal)
      if (settings.chat_session_uid !== source.ownerRef) return invalid()
      return { chatSessionUid: source.ownerRef, isPublic: boolean(settings.is_public), introduction: text(settings.introduction), canManage, isShown: boolean(settings.is_public) }
    }
    let group: PublicGroup
    try { group = await this.readGroup(source.ownerRef, scope, signal) }
    catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arkme-code-2001') return { chatSessionUid: source.ownerRef, isPublic: false, introduction: '', canManage, isShown: false }
      throw error
    }
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const shown = await this.queryGroups({ accountScope: scope, userId: session.userId, relation: 'joined', ...(cursor ? { cursor } : {}) }, signal)
      if (shown.items.some(item => item.chatSessionUid === source.ownerRef)) return { chatSessionUid: source.ownerRef, isPublic: true, introduction: group.introduction, canManage, isShown: true }
      if (!shown.hasMore) return { chatSessionUid: source.ownerRef, isPublic: true, introduction: group.introduction, canManage, isShown: false }
      cursor = shown.nextCursor
    }
    throw new ArkmePluginError('public-social-showcase-incomplete', '群展示状态未完整返回，请重试', false, 502)
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
}
