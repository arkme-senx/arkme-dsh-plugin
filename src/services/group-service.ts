import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeGroupActionResult,
  ArkmeGroupMemberAddItemResult,
  ArkmeGroupMemberAddResult,
  ArkmeGroupMemberCandidate,
  ArkmeGroupMemberCandidateGroup,
  ArkmeGroupMemberCandidateList,
  ArkmeGroupInvitePreview,
  ArkmeGroupMemberItem,
  ArkmeGroupMemberList,
  ArkmeGroupMemberRole,
  ArkmeGroupMemberStatus,
  ArkmeGroupNotificationResult,
  ArkmeGroupSettingsSnapshot,
  ArkmeSourceItem,
} from '../types.js'
import { ProfileService } from './profile-service.js'
import { SourceService, type ArkmeSourceRefPayload } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function encodeOpaqueJson(value: unknown): string { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') }
function decodeOpaqueJson(value: string): unknown { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) }

interface GroupMemberCandidatePayload {
  version: 1
  userId: number
  groupChatSessionUid: string
  targetUserId: number
  displayName: string
  privateChatSessionUid?: string
  origin: 'private_chat' | 'group_chat'
}

export interface GroupInviteTextSender {
  sendPrivateText(
    sourceRef: string,
    chatSessionUid: string,
    text: string,
    recordUid: string,
    relationUid: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void>
}

interface RawMemberCandidate {
  targetUserId: number
  displayName: string
  privateChatSessionUid?: string
  relation: 'contact' | 'stranger' | 'group'
  origin: 'private_chat' | 'group_chat'
}

function chatMessageDnd(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = value as Record<string, unknown>
  return numberValue(policy.mute_state) === 2 || numberValue(policy.notify_state) === 2
}

function chatMemberRole(value: unknown): ArkmeGroupMemberRole {
  if (value === 'owner' || value === 1) return 'owner'
  if (value === 'admin' || value === 2) return 'admin'
  if (value === 'member' || value === 'participant' || value === 3) return 'member'
  return 'unknown'
}

function chatMemberStatus(value: unknown): ArkmeGroupMemberStatus {
  if (value === 'active' || value === 1) return 'active'
  if (value === 'left' || value === 2) return 'left'
  if (value === 'removed' || value === 3) return 'removed'
  return 'unknown'
}

export class GroupService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly inviteSender?: GroupInviteTextSender,
  ) {}

  async groupInvitePreview(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupInvitePreview> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持邀请群聊协作者', false)
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/governance/invite-preview', { chat_session_uid: source.ownerRef }, session, signal,
    )
    const preview = objectValue(data.preview)
    const inviteLink = stringValue(preview.invite_link).trim()
    if (inviteLink === '') throw new ArkmePluginError('group-invite-unavailable', '邀请链接生成失败，请重试', true)
    return {
      source: await this.source.sourceItem(source),
      title: stringValue(preview.title).trim() || source.displayName,
      inviterDisplayName: stringValue(preview.creator_display_name).trim() || 'Arkme',
      inviteLink,
      expireAtMillis: numberValue(preview.expire_at),
      mode: numberValue(preview.join_mode) === 2 ? 'approval_invite' : 'direct_add',
    }
  }

  async listGroupMemberCandidates(
    sourceRef: string,
    options: { query?: string; limit?: number; groupSourceRefs?: readonly string[]; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberCandidateList> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持向群聊添加成员', false)
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const query = options.query?.trim().toLocaleLowerCase() ?? ''
    const requestedGroupSourceRefs = [...new Set((options.groupSourceRefs ?? [])
      .map(value => value.trim()).filter(value => value !== ''))].slice(0, 20)
    const [membersData, directoryData, inviteData] = await Promise.all([
      this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/members/list', { chat_session_uid: source.ownerRef, active_only: true }, session, options.signal,
      ).catch(() => ({})),
      this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list', { limit: 50 }, session, options.signal,
      ),
      this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/governance/invite-preview', { chat_session_uid: source.ownerRef }, session, options.signal,
      ).catch(() => ({})),
    ])
    const directoryBundles = listValue(directoryData.items)
    const privateBundles = directoryBundles.filter(raw => {
      const kind = numberValue(objectValue(objectValue(raw).session).session_kind)
      return kind === 1 || kind === 3
    })
    const privateTopicIds = privateBundles.map(raw => {
      const chatSession = objectValue(objectValue(raw).session)
      return numberValue(chatSession.shared_topic_id ?? chatSession.subject_id)
    }).filter(value => Number.isSafeInteger(value) && value > 0)
    const partnerData = privateTopicIds.length === 0 ? {} : await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/private/get-partner-info-v2', { rm_subject_ids: [...new Set(privateTopicIds)] }, session, options.signal,
    ).catch(() => ({}))
    const contactByTopicId = new Map<number, boolean>()
    for (const raw of listValue(partnerData.item_ls)) {
      const item = objectValue(raw)
      const topicId = numberValue(item.rm_subject_id ?? item.shared_topic_id)
      if (topicId > 0 && typeof item.is_contact === 'boolean') contactByTopicId.set(topicId, item.is_contact)
    }
    const existingMemberUserIds = new Set(listValue(objectValue(membersData).items).map(item => numberValue(objectValue(item).user_id)))
    const rawCandidates = new Map<number, RawMemberCandidate>()
    for (const raw of privateBundles) {
      const bundle = objectValue(raw)
      const chatSession = objectValue(bundle.session)
      if (numberValue(chatSession.session_kind) !== 1 && numberValue(chatSession.session_kind) !== 3) continue
      const counterpart = objectValue(bundle.private_counterpart)
      const supplement = objectValue(bundle.private_supplement)
      const targetUserId = numberValue(counterpart.user_id)
      const privateChatSessionUid = stringValue(chatSession.chat_session_uid).trim()
      const displayName = stringValue(
        supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
          ?? supplement.pending_name ?? counterpart.visible_phone,
      ).trim()
      const privateTopicId = numberValue(chatSession.shared_topic_id ?? chatSession.subject_id)
      const contactState = numberValue(supplement.contact_state)
      const relation = contactByTopicId.get(privateTopicId) === true || contactState === 1 || contactState === 3
        ? 'contact' as const : 'stranger' as const
      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId === session.userId
        || privateChatSessionUid === '' || displayName === '' || (query !== '' && !displayName.toLocaleLowerCase().includes(query))) continue
      rawCandidates.set(targetUserId, { targetUserId, displayName, privateChatSessionUid, relation, origin: 'private_chat' })
    }
    const selected = [...rawCandidates.entries()].slice(0, limit)
    const sourceByGroupUid = new Map<string, ArkmeSourceItem>()
    const groupSessionUidByIndex = new Map<number, string>()
    const groups: ArkmeSourceItem[] = []
    for (const raw of directoryBundles) {
      const bundle = objectValue(raw)
      const chatSession = objectValue(bundle.session)
      if (numberValue(chatSession.session_kind) !== 2) continue
      const groupSessionUid = stringValue(chatSession.chat_session_uid).trim()
      if (groupSessionUid === '' || groupSessionUid === source.ownerRef) continue
      const displayName = stringValue(chatSession.title ?? chatSession.subject_title ?? objectValue(bundle.participant_summary).display_name).trim()
      const groupItem: ArkmeSourceItem = {
        sourceRef: await this.source.sealSourceRef(session.userId, 'group_chat', groupSessionUid, displayName || '群聊'),
        sourceKey: await this.source.chatDirectorySourceKey(session.userId, groupSessionUid),
        kind: 'group_chat', displayName: displayName || '群聊', activeAtMillis: numberValue(chatSession.updated_at), unreadCount: 0,
      }
      const groupIndex = groups.push(groupItem) - 1
      groupSessionUidByIndex.set(groupIndex, groupSessionUid)
      sourceByGroupUid.set(groupSessionUid, groupItem)
      this.source.setChatSource(session.userId, groupSessionUid, groupItem)
    }
    try {
      await this.source.hydrateSourceAvatars(groups, new Map(), groupSessionUidByIndex, session, options.signal)
    } catch {
      // Group rows stay usable if avatar decoration is temporarily unavailable.
    }
    const requestedGroupSources: ArkmeSourceRefPayload[] = []
    for (const groupSourceRef of requestedGroupSourceRefs) {
      const groupSource = await this.source.openSourceRef(groupSourceRef, session.userId)
      if (groupSource.kind !== 'group_chat' || groupSource.ownerRef === source.ownerRef) continue
      requestedGroupSources.push(groupSource)
    }
    const groupRawByUid = new Map<string, { group: ArkmeSourceItem; raws: RawMemberCandidate[]; total: number; error?: string }>()
    const groupTargetUserIds = new Set<number>()
    for (const groupSource of requestedGroupSources) {
      const group = sourceByGroupUid.get(groupSource.ownerRef) ?? await this.source.sourceItem(groupSource)
      try {
        const groupMembersData = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/members/list',
          { chat_session_uid: groupSource.ownerRef, active_only: true },
          session,
          options.signal,
        )
        const raws: RawMemberCandidate[] = []
        const seenUserIds = new Set<number>()
        for (const rawMember of listValue(groupMembersData.items)) {
          const member = objectValue(rawMember)
          const targetUserId = numberValue(member.user_id)
          if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId === session.userId || seenUserIds.has(targetUserId)) continue
          if (chatMemberStatus(member.status) !== 'active') continue
          const privateCandidate = rawCandidates.get(targetUserId)
          if (privateCandidate !== undefined) {
            if (query === '' || privateCandidate.displayName.toLocaleLowerCase().includes(query)) {
              raws.push(privateCandidate)
              groupTargetUserIds.add(targetUserId)
              seenUserIds.add(targetUserId)
            }
            continue
          }
          const profileName = stringValue(member.profile_display_name).trim()
          const displayName = [
            stringValue(member.remark).trim(),
            stringValue(member.display_name_snapshot).trim(),
            profileName === `用户 ${String(targetUserId)}` ? '' : profileName,
            stringValue(objectValue(member.user_info).nick_name).trim(),
            String(targetUserId),
          ].find(value => value !== '' && value !== '成员' && value !== '群成员') ?? '群成员'
          if (query !== '' && !displayName.toLocaleLowerCase().includes(query)) continue
          raws.push({ targetUserId, displayName, relation: 'group', origin: 'group_chat' })
          groupTargetUserIds.add(targetUserId)
          seenUserIds.add(targetUserId)
        }
        groupRawByUid.set(groupSource.ownerRef, { group, raws: raws.slice(0, limit), total: raws.length })
      } catch (error) {
        groupRawByUid.set(groupSource.ownerRef, {
          group, raws: [], total: 0,
          error: error instanceof Error && error.message.trim() !== '' ? error.message : '群成员加载失败，请重试',
        })
      }
    }
    const profiles = await this.profile.publicProfileSummariesByUserIds(
      [...new Set([...selected.map(([userId]) => userId), ...groupTargetUserIds])],
      session,
      options.signal,
    ).catch(() => new Map())
    const preview = objectValue(objectValue(inviteData).preview)
    const approvalRequired = numberValue(preview.join_mode) === 2
    const candidateItem = async (targetUserId: number, candidate: RawMemberCandidate): Promise<ArkmeGroupMemberCandidate> => {
      const alreadyMember = existingMemberUserIds.has(targetUserId)
      const cannotInvite = approvalRequired && candidate.privateChatSessionUid === undefined
      return {
        candidateRef: await this.sealCandidateRef({
          version: 1, userId: session.userId, groupChatSessionUid: source.ownerRef, targetUserId, origin: candidate.origin,
          displayName: candidate.displayName, ...(candidate.privateChatSessionUid === undefined ? {} : { privateChatSessionUid: candidate.privateChatSessionUid }),
        }),
        displayName: candidate.displayName,
        ...(profiles.get(targetUserId)?.avatarUrl === undefined
          ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, targetUserId) }),
        origin: candidate.origin,
        relation: candidate.relation,
        ...(alreadyMember ? { disabled: true, alreadyMember: true } : {}),
        ...(!alreadyMember && cannotInvite ? { disabled: true, statusText: '无法邀请' } : {}),
      }
    }
    const items: ArkmeGroupMemberCandidate[] = await Promise.all(selected.map(async ([targetUserId, candidate]) => candidateItem(targetUserId, candidate)))
    const groupCandidates: ArkmeGroupMemberCandidateGroup[] = await Promise.all([...groupRawByUid.values()].map(async value => ({
      group: value.group,
      items: await Promise.all(value.raws.map(raw => candidateItem(raw.targetUserId, raw))),
      total: value.total,
      ...(value.error === undefined ? {} : { error: value.error }),
    })))
    return {
      source: await this.source.sourceItem(source), items, total: rawCandidates.size,
      hasMore: rawCandidates.size > items.length,
      mode: numberValue(preview.join_mode) === 2 ? 'approval_invite' : 'direct_add', groups, groupCandidates,
      contactCount: [...rawCandidates.values()].filter(item => item.relation === 'contact').length,
      strangerCount: [...rawCandidates.values()].filter(item => item.relation === 'stranger').length,
    }
  }

  async addGroupMembers(
    sourceRef: string,
    candidateRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeGroupMemberAddResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-source-invalid', '仅支持向群聊添加成员', false)
    const refs = candidateRefs.map(value => value.trim())
    if (refs.length === 0 || refs.length > 20 || refs.some(value => value === '') || new Set(refs).size !== refs.length) {
      throw new ArkmePluginError('group-member-candidates-invalid', '请选择 1-20 个不重复的成员候选项', false)
    }
    const inviteData = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/governance/invite-preview', { chat_session_uid: source.ownerRef }, session, signal,
    )
    const preview = objectValue(objectValue(inviteData).preview)
    const approvalRequired = numberValue(preview.join_mode) === 2
    const inviteLink = stringValue(preview.invite_link).trim()
    const results: ArkmeGroupMemberAddItemResult[] = []
    for (const candidateRef of refs) {
      let candidate: GroupMemberCandidatePayload | undefined
      try {
        candidate = await this.openCandidateRef(candidateRef, session.userId, source.ownerRef)
        if (approvalRequired) {
          if (candidate.privateChatSessionUid === undefined) throw new ArkmePluginError('group-candidate-invite-unavailable', '该对象暂时无法发送群聊邀请', false)
          if (this.inviteSender === undefined || inviteLink === '') throw new ArkmePluginError('group-invite-unavailable', '该群需要发送邀请，但邀请链接暂不可用', true)
          const privateSourceRef = await this.source.sealSourceRef(
            session.userId, 'private_chat', candidate.privateChatSessionUid, candidate.displayName,
          )
          await this.inviteSender.sendPrivateText(
            privateSourceRef, candidate.privateChatSessionUid,
            `邀请你加入群聊“${source.displayName}”：${inviteLink}`,
            `chat_record_${randomUUID()}`, `chat_rel_${randomUUID()}`, session, signal,
          )
          results.push({ candidateRef, displayName: candidate.displayName, status: 'invite_sent' })
          continue
        }
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/members/add',
          {
            chat_session_uid: source.ownerRef, target_user_id: candidate.targetUserId,
            join_at: Date.now(), display_name_snapshot: candidate.displayName,
            extra: { source: 'dsh_arkme_candidate' },
          },
          session, signal,
        )
        const outcome = stringValue(objectValue(data.item).outcome)
        results.push({
          candidateRef, displayName: candidate.displayName,
          status: outcome === 'idempotent_hit' ? 'already_member' : outcome === 'updated' ? 'reactivated' : 'added',
        })
      } catch (error) {
        results.push({
          candidateRef, displayName: candidate?.displayName ?? '成员', status: 'failed',
          error: error instanceof Error && error.message.trim() !== '' ? error.message : '添加成员失败',
        })
      }
    }
    return {
      source: await this.source.sourceItem(source), results,
      succeededCount: results.filter(item => item.status !== 'failed').length,
      failedCount: results.filter(item => item.status === 'failed').length,
    }
  }

  private async sealCandidateRef(payload: GroupMemberCandidatePayload): Promise<string> {
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
    return `arkme-group-candidate-v1.${encoded}.${signature}`
  }

  private async openCandidateRef(
    candidateRef: string,
    expectedUserId: number,
    expectedGroupChatSessionUid: string,
  ): Promise<GroupMemberCandidatePayload> {
    const parts = candidateRef.split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-group-candidate-v1') throw new ArkmePluginError('group-candidate-ref-invalid', '群成员候选引用无效', false)
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ArkmePluginError('group-candidate-ref-invalid', '群成员候选引用无效', false)
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('group-candidate-ref-invalid', '群成员候选引用无效', false, 400, { cause: error }) }
    const result: GroupMemberCandidatePayload = {
      version: 1, userId: numberValue(raw.userId), groupChatSessionUid: stringValue(raw.groupChatSessionUid).trim(),
      targetUserId: numberValue(raw.targetUserId),
      displayName: stringValue(raw.displayName).trim(),
      ...(stringValue(raw.privateChatSessionUid).trim() === '' ? {} : { privateChatSessionUid: stringValue(raw.privateChatSessionUid).trim() }),
      origin: raw.origin === 'group_chat' ? 'group_chat' : 'private_chat',
    }
    if (raw.version !== 1 || result.userId !== expectedUserId || result.groupChatSessionUid !== expectedGroupChatSessionUid
      || !Number.isSafeInteger(result.targetUserId)
      || result.targetUserId <= 0 || result.targetUserId === expectedUserId || result.displayName === '') {
      throw new ArkmePluginError('group-candidate-ref-invalid', '群成员候选引用与当前账号不匹配', false, 403)
    }
    return result
  }

  async createGroup(
    title: string,
    clientMutationId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceItem> {
    const normalizedTitle = title.trim()
    if (normalizedTitle === '' || Array.from(normalizedTitle).length > 80) {
      throw new ArkmePluginError('group-title-invalid', '群聊名称需为 1-80 个字符', false)
    }
    if (!UUID.test(clientMutationId)) {
      throw new ArkmePluginError('client-mutation-id-invalid', '群聊操作标识无效', false)
    }
    const session = await this.runtime.requireSession()
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/create-group',
        {
          chat_session_uid: clientMutationId,
          title: normalizedTitle,
          member_user_ids: [],
          create_at: Date.now(),
        },
        session,
        options.signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && ['arkme-network-error', 'arkme-timeout'].includes(error.code)) {
        throw new ArkmePluginError(
          'group-create-outcome-unknown',
          '群聊创建结果未知，请刷新会话列表确认；不会自动重试',
          false,
          409,
          { cause: error },
        )
      }
      throw error
    }
    const source = await this.source.chatSourceFromBundle(data, session, undefined, [])
    this.source.setChatSourceByKey(`${String(session.userId)}:${clientMutationId}`, source)
    return source
  }

  async listGroupMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberList> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持查看群聊成员', false)
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/list',
      { chat_session_uid: source.ownerRef, active_only: options.activeOnly !== false },
      session,
      options.signal,
    )
    const rawItems = listValue(data.items).map(objectValue)
    const userIds = rawItems
      .map(item => numberValue(item.user_id))
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
    const profiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, options.signal).catch(() => new Map())
    const members: ArkmeGroupMemberItem[] = []
    for (const item of rawItems) {
      const userId = numberValue(item.user_id)
      if (!Number.isSafeInteger(userId) || userId <= 0) continue
      const profile = profiles.get(userId)
      const remarkName = stringValue(item.remark).trim()
      const memberName = stringValue(item.display_name_snapshot).trim()
      const profileDisplayName = profile?.displayName.trim() ?? ''
      const publicDisplayName = profileDisplayName === `用户 ${String(userId)}` ? '' : profileDisplayName
      const displayName = [remarkName, memberName, publicDisplayName]
        .find(value => value !== '' && value !== '成员' && value !== '群成员')
        ?? '群成员'
      const secondaryName = [memberName, publicDisplayName, remarkName]
        .find(value => value !== '' && value !== '成员' && value !== '群成员' && value !== displayName)
        ?? ''
      const role = chatMemberRole(item.role)
      const status = chatMemberStatus(item.status)
      members.push({
        userId,
        displayName,
        ...(memberName === '' ? {} : { memberName }),
        ...(secondaryName === '' ? {} : { secondaryName }),
        ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }),
        role,
        status,
        isSelf: userId === session.userId,
        isOwner: role === 'owner',
        joinedAtMillis: numberValue(item.join_at),
        recordCount: Math.max(0, Math.trunc(numberValue(objectValue(item.extra).record_count))),
        mentionCount: Math.max(0, Math.trunc(numberValue(objectValue(item.extra).mention_count))),
      })
    }
    const roleRank = (role: ArkmeGroupMemberRole) => role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3
    members.sort((left, right) => roleRank(left.role) - roleRank(right.role)
      || (right.status === 'active' ? 1 : 0) - (left.status === 'active' ? 1 : 0)
      || left.joinedAtMillis - right.joinedAtMillis
      || left.userId - right.userId)
    const self = members.find(item => item.isSelf)
    const resultSource = await this.source.sourceItem(source)
    this.source.setChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`, resultSource)
    return {
      source: resultSource,
      items: members,
      total: members.length,
      activeCount: members.filter(item => item.status === 'active').length,
      selfRole: self?.role ?? 'unknown',
      selfStatus: self?.status ?? 'unknown',
    }
  }

  async groupSettings(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupSettingsSnapshot> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持查看群聊设置', false)
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail',
      { chat_session_uid: source.ownerRef },
      session,
      signal,
    )
    const chatSession = objectValue(data.session)
    const currentMember = objectValue(data.current_member)
    const title = stringValue(chatSession.title).trim() || source.displayName
    const messageDnd = chatMessageDnd(data.current_policy) ?? false
    const nextSource: ArkmeSourceItem = {
      sourceRef: await this.source.sealSourceRef(session.userId, 'group_chat', source.ownerRef, title),
      sourceKey: await this.source.chatDirectorySourceKey(session.userId, source.ownerRef),
      kind: 'group_chat',
      displayName: title,
      activeAtMillis: numberValue(chatSession.last_active_at),
      unreadCount: numberValue(objectValue(data.unread_snapshot).unread_count),
      isMuted: messageDnd,
      ...((numberValue(chatSession.last_seq)) > 0 ? { latestSequence: numberValue(chatSession.last_seq) } : {}),
    }
    try {
      await this.source.hydrateSourceAvatars([nextSource], new Map(), new Map([[0, source.ownerRef]]), session, signal)
    } catch {
      // Settings must remain readable if group-avatar decoration is temporarily unavailable.
    }
    this.source.setChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    const selfRole = chatMemberRole(currentMember.role)
    const selfStatus = chatMemberStatus(currentMember.status)
    const active = selfStatus === 'active'
    return {
      source: nextSource,
      selfRole,
      selfStatus,
      canRename: active && selfRole === 'owner',
      canDissolve: active && selfRole === 'owner',
      canLeave: active && selfRole !== 'owner',
      messageDnd,
    }
  }

  async setGroupMessageDnd(
    sourceRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupNotificationResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持设置群聊消息免打扰', false)
    }
    const current = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/get',
      { chat_session_uid: source.ownerRef },
      session,
      signal,
    )
    await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/update',
      {
        chat_session_uid: source.ownerRef,
        show_in_home_state: numberValue(current.show_in_home_state) || 1,
        privacy_state: numberValue(current.privacy_state) || 1,
        mute_state: enabled ? 2 : 1,
        pin_state: numberValue(current.pin_state) || 1,
        notify_state: enabled ? 2 : 1,
        status: numberValue(current.status) || 1,
        update_at: Date.now(),
      },
      session,
      signal,
    )
    const cacheKey = `${String(session.userId)}:${source.ownerRef}`
    const cached = this.source.cachedChatSourceByKey(cacheKey)
    if (cached !== undefined) this.source.setChatSourceByKey(cacheKey, { ...cached, isMuted: enabled })
    return {
      messageDnd: enabled,
    }
  }

  async renameGroup(sourceRef: string, title: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    const normalizedTitle = title.trim()
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持重命名群聊', false)
    }
    if (normalizedTitle === '' || normalizedTitle.length > 80) {
      throw new ArkmePluginError('group-title-invalid', '群聊名称需为 1-80 个字符', false)
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/rename',
      { chat_session_uid: source.ownerRef, title: normalizedTitle, update_at: Date.now() },
      session,
      signal,
    )
    const nextSource = await this.source.chatSourceFromBundle(data, session, this.source.cachedChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`), [])
    try {
      await this.source.hydrateSourceAvatars([nextSource], new Map(), new Map([[0, source.ownerRef]]), session, signal)
    } catch {
      // Rename success is authoritative; avatar refresh is optional.
    }
    this.source.setChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    this.source.invalidateSourceListCache(session.userId, 'root')
    return { source: nextSource, status: 'ok' }
  }

  async leaveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持退出群聊', false)
    }
    await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/update',
      { chat_session_uid: source.ownerRef, target_user_id: session.userId, action: 1 },
      session,
      signal,
    )
    const nextSource = await this.source.sourceItem(source)
    this.source.setChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    return { source: nextSource, status: 'ok' }
  }

  async dissolveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持解散群聊', false)
    }
    await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/dissolve',
      { chat_session_uid: source.ownerRef, update_at: Date.now() },
      session,
      signal,
    )
    const nextSource = await this.source.sourceItem(source)
    this.source.setChatSourceByKey(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    return { source: nextSource, status: 'ok' }
  }

  async reportGroup(sourceRef: string, reason: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持举报群聊', false)
    }
    await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/report',
      {
        chat_session_uid: source.ownerRef,
        report_type: 2,
        reason: reason.trim().slice(0, 200),
        created_at: Date.now(),
      },
      session,
      signal,
    )
    return { source: await this.source.sourceItem(source), status: 'ok' }
  }
}
