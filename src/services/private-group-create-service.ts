import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { PRIVATE_GROUP_MAX_PEOPLE, type PrivateGroupRequest, type PrivateGroupSelection, type PrivateGroupContext, type PrivateGroupPeoplePage, type PrivateGroupMatch, type PrivateGroupCreateInput, type PrivateGroupCreateResult } from '../private-group-create-contract.js'
import { commonGroupChanges } from './common-group-service.js'
import type { ContactDirectoryService } from './contact-directory-service.js'
import type { GroupService } from './group-service.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'

type Context = { session: ArkmeSessionCredentials; scope: string; peerId: number; peerName: string; avatarRef?: string }
const invalid = () => new ArkmePluginError('private-group-response-invalid', '已有群聊检查响应不完整，请重试', false, 502)
function userId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw invalid()
  return value
}

/** Desktop orchestration only. Chat still owns members, group creation and common-group facts. */
export class PrivateGroupCreateService {
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService,
    private readonly groups: Pick<GroupService, 'createGroup'>,
    private readonly contacts: Pick<ContactDirectoryService, 'groupCreationPeople' | 'resolveGroupCreationPerson'>) {}

  private async session(scope: string) {
    const session = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${session.userId}` !== scope) throw new ArkmePluginError('private-group-account-changed', '账号已切换，请重新打开建群', false, 409)
    return session
  }
  private async post(path: string, body: Record<string, unknown>, scope: string, signal?: AbortSignal) {
    const session = await this.session(scope)
    const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(path, body, session, signal, { lane: 'interactive-read', bypassCache: true })
    signal?.throwIfAborted(); await this.session(scope)
    return result
  }
  private async context(input: PrivateGroupRequest, signal?: AbortSignal): Promise<Context> {
    const session = await this.session(input.accountScope)
    const ref = await this.source.openSourceRef(input.sourceRef, session.userId)
    if (ref.kind !== 'private_chat') throw new ArkmePluginError('private-group-source-invalid', '仅支持从真人私聊发起群聊', false, 400)
    const bundle = await this.post('/api/v1/chats/detail', { chat_session_uid: ref.ownerRef }, input.accountScope, signal)
    const chat = objectValue(bundle.session), member = objectValue(bundle.current_member), peer = objectValue(bundle.private_counterpart)
    if (chat.chat_session_uid !== ref.ownerRef || chat.session_kind !== 1 || chat.status !== 1 || member.status !== 1 || member.user_id !== session.userId || (Array.isArray(bundle.bot_participants) && bundle.bot_participants.length > 0)) {
      throw new ArkmePluginError('private-group-source-invalid', '当前私聊不能发起群聊，请刷新后重试', false, 403)
    }
    const peerId = userId(peer.user_id)
    if (peerId === session.userId) throw invalid()
    const cached = this.source.cachedChatSource(session.userId, ref.ownerRef)
    return { session, scope: input.accountScope, peerId,
      peerName: ref.displayName || stringValue(peer.display_name_snapshot) || '私聊对象',
      ...(cached?.avatarRef ? { avatarRef: cached.avatarRef } : {}) }
  }
  async readContext(input: PrivateGroupRequest, signal?: AbortSignal): Promise<PrivateGroupContext> {
    const ctx = await this.context(input, signal)
    return { peerName: ctx.peerName, ...(ctx.avatarRef ? { peerAvatarRef: ctx.avatarRef } : {}) }
  }
  async people(input: PrivateGroupRequest & { cursor?: string }, signal?: AbortSignal): Promise<PrivateGroupPeoplePage> {
    const ctx = await this.context(input, signal)
    const page = await this.contacts.groupCreationPeople(input.cursor, signal)
    await this.session(input.accountScope); signal?.throwIfAborted()
    return { ...page, items: page.items.filter(person => person.userId !== ctx.peerId).map(({ userId: _id, ...person }) => person) }
  }
  private async selection(input: PrivateGroupSelection, signal?: AbortSignal) {
    const ctx = await this.context(input, signal)
    if (!Array.isArray(input.personRefs) || input.personRefs.length === 0 || input.personRefs.length > PRIVATE_GROUP_MAX_PEOPLE - 2 || input.personRefs.some(ref => typeof ref !== 'string' || ref.trim() === '')) {
      throw new ArkmePluginError('private-group-people-invalid', '请至少再选择一人，群成员最多 100 人', false, 400)
    }
    const people = await Promise.all([...new Set(input.personRefs)].map(ref => this.contacts.resolveGroupCreationPerson(ref, signal)))
    await this.session(input.accountScope); signal?.throwIfAborted()
    const ids = [...new Set(people.map(person => userId(person.userId)))].filter(id => id !== ctx.session.userId && id !== ctx.peerId)
    if (ids.length === 0) throw new ArkmePluginError('private-group-people-invalid', '请至少再选择一位其他联系人', false, 400)
    return { ctx, ids: [ctx.session.userId, ctx.peerId, ...ids] }
  }
  private async findMatches(ctx: Context, ids: number[], signal?: AbortSignal): Promise<PrivateGroupMatch[]> {
    let after = ''
    let candidates: Array<{ uid: string; title: string; memberCount: number }> = []
    let complete = false
    for (let page = 0; page < 100; page++) {
      const data = await this.post('/api/v1/chats/common-group/query', { target_user_id: ctx.peerId, after }, ctx.scope, signal)
      const result = commonGroupChanges(data, [], after)
      candidates.push(...result.items)
      if (!result.hasMore) { complete = true; break }
      after = result.next
    }
    if (!complete) throw new ArkmePluginError('private-group-check-incomplete', '共同群聊尚未检查完整，请重试', false, 502)
    // Intersect fresh common-group facts using the existing bounded known-UID query.
    for (const target of ids.filter(id => id !== ctx.session.userId && id !== ctx.peerId)) {
      const next: typeof candidates = []
      for (let offset = 0; offset < candidates.length; offset += 20) {
        const known = candidates.slice(offset, offset + 20).map(group => group.uid)
        const data = await this.post('/api/v1/chats/common-group/query', { target_user_id: target, known_group_uids: known }, ctx.scope, signal)
        next.push(...commonGroupChanges(data, known, '').items)
      }
      candidates = next
      if (candidates.length === 0) break
    }
    const matches: PrivateGroupMatch[] = []
    const selected = new Set(ids)
    for (const group of candidates) {
      let count = group.memberCount, exact = false
      if (count < selected.size) continue
      if (count === selected.size) {
        let roster: Record<string, unknown>
        try { roster = await this.post('/api/v1/chats/members/page', { chat_session_uid: group.uid, active_only: true, limit: Math.min(100, selected.size + 1) }, ctx.scope, signal) }
        catch (error) { if (error instanceof ArkmePluginError && error.code === 'arkme-code-2001') continue; throw error }
        if (roster.chat_session_uid !== group.uid || !Array.isArray(roster.items) || typeof roster.has_more !== 'boolean') throw invalid()
        const members = roster.items.map(raw => { const m = objectValue(raw); if (m.status !== 1) throw invalid(); return userId(m.user_id) })
        const unique = new Set(members)
        if (unique.size !== members.length) throw invalid()
        exact = !roster.has_more && unique.size === selected.size && ids.every(id => unique.has(id))
        if (!ids.every(id => unique.has(id))) continue
        count = exact ? selected.size : Math.max(count, unique.size, selected.size + 1)
      }
      const source = await this.source.sourceItem({ version: 1, userId: ctx.session.userId, kind: 'group_chat', ownerRef: group.uid, displayName: group.title || '群聊' })
      matches.push({ source, kind: exact ? 'exact' : 'includes', memberCount: count, extraCount: count - selected.size })
    }
    await this.session(ctx.scope); signal?.throwIfAborted()
    return matches.sort((a, b) => Number(b.kind === 'exact') - Number(a.kind === 'exact') || a.memberCount - b.memberCount)
  }
  async matches(input: PrivateGroupSelection, signal?: AbortSignal): Promise<PrivateGroupMatch[]> {
    const { ctx, ids } = await this.selection(input, signal)
    return await this.findMatches(ctx, ids, signal)
  }
  async create(input: PrivateGroupCreateInput, signal?: AbortSignal): Promise<PrivateGroupCreateResult> {
    if (typeof input.title !== 'string' || input.title.trim() === '' || Array.from(input.title.trim()).length > 80 || typeof input.isPublic !== 'boolean' || typeof input.allowDuplicate !== 'boolean' || typeof input.allowUnchecked !== 'boolean') {
      throw new ArkmePluginError('private-group-input-invalid', '群聊创建参数无效', false, 400)
    }
    const { ctx, ids } = await this.selection(input, signal)
    let matches: PrivateGroupMatch[] = []
    try { matches = await this.findMatches(ctx, ids, signal) }
    catch (error) {
      signal?.throwIfAborted(); await this.session(input.accountScope)
      if (!input.allowUnchecked) throw new ArkmePluginError('private-group-check-failed', '已有群聊尚未检查完整，请重新检查，或选择仍然创建群聊。', false, 502)
    }
    let ownRequestAlreadyExists = false
    for (const match of matches) {
      const payload = await this.source.openSourceRef(match.source.sourceRef, ctx.session.userId)
      if (payload.ownerRef === input.clientMutationId) ownRequestAlreadyExists = true
    }
    if (matches.length > 0 && !input.allowDuplicate && !ownRequestAlreadyExists) return { status: 'matches', matches }
    await this.session(input.accountScope); signal?.throwIfAborted()
    const source = await this.groups.createGroup(input.title, input.clientMutationId, {
      accountScope: input.accountScope, isPublic: input.isPublic, memberUserIds: ids.filter(id => id !== ctx.session.userId), ...(signal ? { signal } : {}),
    })
    await this.session(input.accountScope); signal?.throwIfAborted()
    this.source.invalidateSourceListCache(ctx.session.userId, 'root')
    return { status: 'created', source }
  }
}
