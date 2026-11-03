import type { IdentityShareActionResult, IdentityShareCard, IdentityShareLink, IdentityShareTarget } from '../identity-share-contract.js'
import { identityShareTarget } from '../identity-share-link.js'
import type { ShareLinkTarget } from '../share-link-preview.js'
import type { ChatService } from './chat-service.js'
import type { ContactDirectoryService } from './contact-directory-service.js'
import type { GroupService } from './group-service.js'
import type { ProfileService } from './profile-service.js'
import type { SourceService } from './source-service.js'
import type { WorldService } from './world-service.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'

const invalid = () => new ArkmePluginError('identity-share-invalid', '名片链接或响应无效，请刷新重试', false, 400)

/** Desktop adapter over existing public profiles and signed Chat invitations. No new cloud protocol. */
export class IdentityShareService {
  constructor(private readonly runtime: ServiceRuntime, private readonly profiles: ProfileService,
    private readonly source: SourceService, private readonly contacts: ContactDirectoryService,
    private readonly groups: GroupService, private readonly chat: ChatService, private readonly world: WorldService) {}

  private async session(scope: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    signal?.throwIfAborted()
    if (`${this.runtime.config.environment}:${session.userId}` !== scope) throw new ArkmePluginError('identity-share-account-changed', '账号已切换，请重新打开名片', false, 409)
    return session
  }
  private target(url: string) {
    const target = identityShareTarget(url)
    if (!target || target.environment !== this.runtime.config.environment) throw new ArkmePluginError('identity-share-environment-mismatch', '请在链接对应的即我环境中打开', false, 409)
    return target
  }
  private group(target: ShareLinkTarget) {
    if (target.kind !== 'topic' || !target.code || !target.stamp) throw invalid()
    let payload: Record<string, unknown>
    try { payload = objectValue(JSON.parse(Buffer.from(target.id.slice('chat_v1_'.length), 'base64url').toString('utf8'))) } catch { throw invalid() }
    const uid = stringValue(payload.c).trim()
    if (!uid || uid.length > 256 || typeof payload.i !== 'number' || !Number.isSafeInteger(payload.i) || payload.i <= 0) throw invalid()
    // This is only a locator. The existing server validates the complete token/code/stamp.
    return { uid, body: { ob_remote_subject: target.id, code: target.code, stamp: target.stamp } }
  }
  async link(scope: string, target: IdentityShareTarget, signal?: AbortSignal): Promise<IdentityShareLink> {
    const session = await this.session(scope, signal)
    let userId = session.userId
    if (target.kind === 'person') userId = target.userId
    else if (target.kind === 'contact') {
      const id = await this.contacts.resolveTeamRecipient(target.contactRef, signal)
      if (typeof id !== 'number') throw new ArkmePluginError('identity-share-person-unregistered', '当前只支持分享已注册用户', false, 400)
      userId = id
    } else if (target.kind === 'author') {
      userId = (await this.world.worldAuthorFromRef(target.authorRef)).userId
    } else if (target.kind === 'member') {
      const person = await this.chat.memberWorldTarget(target.sourceRef, target.memberRef, signal)
      if (typeof person.userId !== 'number') throw invalid()
      userId = person.userId
    } else if (target.kind === 'source') {
      const ref = await this.source.openSourceRef(target.sourceRef, session.userId)
      if (ref.kind === 'group_chat') {
        const preview = await this.groups.groupInvitePreview(target.sourceRef, signal)
        await this.session(scope, signal)
        const parsed = this.target(preview.inviteLink)
        this.group(parsed)
        return { kind: 'group', url: preview.inviteLink, expireAtMillis: preview.expireAtMillis }
      }
      if (ref.kind !== 'private_chat') throw invalid()
      const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/detail', { chat_session_uid: ref.ownerRef }, session, signal, { lane: 'interactive-read', bypassCache: true })
      const own = objectValue(detail.current_member), identity = objectValue(detail.session)
      if (identity.chat_session_uid !== ref.ownerRef || identity.session_kind !== 1 || identity.status !== 1 || own.user_id !== session.userId || own.status !== 1 || (Array.isArray(detail.bot_participants) && detail.bot_participants.length > 0)) throw invalid()
      userId = Number(objectValue(detail.private_counterpart).user_id)
    } else if (target.kind !== 'self') throw invalid()
    if (!Number.isSafeInteger(userId) || userId <= 0) throw invalid()
    const profile = (await this.profiles.publicProfileSummariesByUserIds([userId], session, signal, 0)).get(userId)
    const candidates = [...new Set([profile?.accountName, profile?.arkmeId].filter((id): id is string => Boolean(id)))]
    for (const name of candidates) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{4,31}$/.test(name)) continue
      let person
      try { person = await this.profiles.shareIdentityByArkmeId(name, signal) }
      catch (error) { if (error instanceof ArkmePluginError && error.code === 'identity-share-person-unavailable') continue; throw error }
      await this.session(scope, signal)
      if (person.userId !== userId) continue
      const origin = this.runtime.config.environment === 'prod' ? 'https://jiwo.cc' : 'https://jotmo-app.senguo.me'
      return { kind: 'person', url: `${origin}/${encodeURIComponent(person.accountName)}` }
    }
    throw new ArkmePluginError('identity-share-person-unavailable', '暂时没有可分享的个人链接，请刷新资料后重试', false, 409)
  }
  async read(scope: string, url: string, signal?: AbortSignal): Promise<IdentityShareCard> {
    const session = await this.session(scope, signal), target = this.target(url)
    if (target.kind === 'world') {
      const person = await this.profiles.shareIdentityByArkmeId(target.id, signal)
      await this.session(scope, signal)
      return { kind: 'person', url: target.url, ...person, isSelf: person.userId === session.userId }
    }
    const group = this.group(target)
    const data = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>('/api/v1/subject/invite-preview-state', group.body, session, signal)
    await this.session(scope, signal)
    if (typeof data.has_join !== 'boolean' || (data.join_mode !== 1 && data.join_mode !== 2) || typeof data.title !== 'string' || typeof data.creator_display_name !== 'string' || typeof data.expire_at !== 'number' || !Number.isFinite(data.expire_at) || typeof data.my_request_status !== 'number' || typeof data.is_grey !== 'boolean') throw invalid()
    if (data.is_grey) throw new ArkmePluginError('identity-share-group-unavailable', '该群聊暂不可用', false, 403)
    return { kind: 'group', url: target.url, displayName: data.title, creatorDisplayName: data.creator_display_name, hasJoined: data.has_join,
      joinMode: data.join_mode, requestPending: data.my_request_status === 1, expireAtMillis: data.expire_at }
  }
  private async openGroup(scope: string, uid: string, signal?: AbortSignal): Promise<IdentityShareActionResult> {
    const session = await this.session(scope, signal)
    const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/detail', { chat_session_uid: uid }, session, signal, { lane: 'interactive-read', bypassCache: true })
    await this.session(scope, signal)
    const own = objectValue(detail.current_member), identity = objectValue(detail.session)
    if (identity.chat_session_uid !== uid || identity.session_kind !== 2 || identity.status !== 1 || own.user_id !== session.userId || own.status !== 1) throw invalid()
    const source = await this.source.chatSourceFromBundle(detail, session, this.source.cachedChatSource(session.userId, uid), [])
    await this.session(scope, signal)
    if (source.kind !== 'group_chat') throw invalid()
    this.source.setChatSource(session.userId, uid, source); this.source.invalidateSourceListCache(session.userId, 'root')
    return { status: 'opened', source }
  }
  async open(scope: string, url: string, expectedUserId?: number, signal?: AbortSignal): Promise<IdentityShareActionResult> {
    const card = await this.read(scope, url, signal), session = await this.session(scope, signal)
    if (card.kind === 'person') {
      if (!Number.isSafeInteger(expectedUserId) || card.userId !== expectedUserId) throw new ArkmePluginError('identity-share-person-changed', '联系人身份已变化，请刷新名片后再操作', false, 409)
      if (card.isSelf) throw new ArkmePluginError('identity-share-self', '这是你自己的名片', false, 409)
      const result = await this.chat.openPrivateChatFromUser(card.userId, { expectedViewerUserId: session.userId, ...(signal ? { signal } : {}) })
      await this.session(scope, signal)
      return { status: 'opened', source: result.source }
    }
    if (!card.hasJoined) throw new ArkmePluginError('identity-share-not-joined', '请先加入群聊或提交申请', false, 409)
    return await this.openGroup(scope, this.group(this.target(url)).uid, signal)
  }
  async join(scope: string, url: string, signal?: AbortSignal): Promise<IdentityShareActionResult> {
    const card = await this.read(scope, url, signal)
    if (card.kind !== 'group') throw invalid()
    const group = this.group(this.target(url))
    if (card.hasJoined) return await this.openGroup(scope, group.uid, signal)
    if (card.expireAtMillis <= Date.now()) throw new ArkmePluginError('identity-share-expired', '群聊邀请已过期，请联系邀请人获取新链接', false, 410)
    if (card.requestPending) return { status: 'pending' }
    const session = await this.session(scope, signal)
    const result = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>('/api/v1/subject/request-join', { ...group.body, display_name: '', apply_note: '' }, session, signal)
    await this.session(scope, signal)
    if (result.res === 4) return { status: 'pending' }
    if (result.res === 2) throw new ArkmePluginError('identity-share-expired', '群聊邀请已过期，请联系邀请人获取新链接', false, 410)
    if (result.res === 3) throw new ArkmePluginError('identity-share-group-full', '群聊人数已满', false, 409)
    if (result.res !== 1 && result.res !== 5) throw invalid()
    return await this.openGroup(scope, group.uid, signal)
  }
}
