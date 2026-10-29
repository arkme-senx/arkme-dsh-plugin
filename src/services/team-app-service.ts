import {TeamMemberAddition} from './team-member-addition.js'
import { GroupRepresentationCodec } from './group-representation.js'
import { readTeamRecordMetadata, readTeamEditMetadata, decodeTeamMessageSnapshot } from '../team-snapshot-contract.js'
import { encodeMentionMetadata } from './mention-metadata-codec.js'
import { retainedRecordMentionMetadata } from './record-reedit-mentions.js'
import {projectTeamForward} from '../team-forward-presentation.js'
import { mergeTeamNotificationPolicy, type TeamNotificationPolicy } from '../team-notification-contract.js'
import { teamMessageProjection } from '../team-message-projection.js'
import type {ArkmeTeamAvatar, ArkmeTeamProfile, ArkmeTeamProfileResult} from '../team-profile-contract.js'
import {squareProfileImage,authorizedStorageURL} from './profile-image.js'
import { createHash, createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { recordOwnerId, stringifyOwnerJson } from '../record-owner-id.js'
import type { TeamMemberAvatarPort } from './team-service.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeTeam, ArkmeTeamRole, ArkmeDirectoryPage } from '../types.js'
import type { TeamChannel, TeamConversation, TeamIdentity, TeamMessage, TeamSide, TeamTimeline, TeamAppOperation, TeamMembers } from '../team-app-contract.js'
import { validTeamOutboundRecipient } from '../team-outbound-contract.js'
import type { TeamGroupContext, TeamGroupPending, TeamPublicCard } from '../team-group-contract.js'
import type { TeamWorldView, TeamWorldPrepareResult } from '../team-world-contract.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, stringValue, type ServiceRuntime } from './service.js'
import { quoteSourceContent, quoteCanonicalText, quoteMatchesCanonical, readMessageQuote } from '../message-quote.js'
import { readTeamUnderlineSnapshot, underlineId, type MessageUnderlineChange } from '../message-annotations.js'
import { arkmePeerMemberType } from '../peer-membership.js'
import { readTeamMemberCodexSync } from '../team-member-codex-sync.js'
import type { ChatService } from './chat-service.js'
import type { SourceService } from './source-service.js'
import type { TeamMemberCandidatePort, TeamMemberCandidatePage, TeamMemberCandidateSource, TeamMemberAddResult } from '../team-member-add-contract.js'
import { remapLongArticleAssets } from '../long-article-content.js'
import { sharedAttachments, sharedAttachmentAt, sharedContentBlock, sharedForwardPreview } from '../team-external-chat-presentation.js'

const obj = objectValue
const str = stringValue
const num = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) ? v : 0
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(obj) : []
const role = (v: unknown): ArkmeTeamRole => v === 1 ? 'owner' : v === 2 ? 'admin' : 'member'
function notificationPolicy(raw: unknown, required = false): TeamNotificationPolicy {
  if (raw === undefined && !required) return {muted:false,policyVersion:0,notifyAfterSeq:0}
  const value = obj(raw)
  if (typeof value.muted !== 'boolean' || !Number.isSafeInteger(value.policy_version) || Number(value.policy_version) < 0 ||
      !Number.isSafeInteger(value.notify_after_seq) || Number(value.notify_after_seq) < 0) throw invalid()
  return {muted:value.muted,policyVersion:num(value.policy_version),notifyAfterSeq:num(value.notify_after_seq)}
}
function receiptCounts(raw: unknown) {
  const v = obj(raw), keys = ['recipient_count', 'read_count', 'unread_count'] as const
  if (keys.some(k => !Number.isSafeInteger(v[k]) || Number(v[k]) < 0) || Number(v.read_count) + Number(v.unread_count) !== Number(v.recipient_count)) throw new ArkmePluginError('team-receipts-incomplete', '阅读状态返回不完整，请重试', true, 502)
  return {total: Number(v.recipient_count), read: Number(v.read_count), unread: Number(v.unread_count)}
}
const invalid = (cause?: unknown) => new ArkmePluginError('team-reference-invalid', '团队消息引用无效，请重新打开', false, 409, { cause })
const reasons: Record<string, string> = {
  invalid_recipient: '请选择当前可联系的团队外部真人用户',
  external_chat_not_accessible: '这段对外私聊已不可访问，请检查共享状态与团队资格',
  invalid_external_chat: '对外私聊请求无效，请重新打开',
  conversation_blocked: '此对话已被屏蔽，双方暂时不能发送或编辑消息',
  official_unavailable: '暂时无法联系作者，请稍后重试',
  member_management_forbidden: '仅当前团队所有者或管理员可添加成员', request_conflict: '同一批次的成员不一致，请核对原批次', snapshot_stale: '团队成员已变化，请重新加载',
  not_owner:'仅团队所有者可以编辑资料', profile_edit_rejected:'本次编辑已过期，请重新打开编辑', invalid_team_profile:'团队资料无效',
  message_recalled:'消息已撤回', message_not_published:'消息尚未发布，请取消发送',
  not_accessible: '你已无权访问该团队消息，请刷新列表', channel_paused: '团队已暂停接收新消息',
  reply_conflict: '服务暂时不可用，请使用原请求重试',
  version_conflict: '内容已被更新，请重新读取后编辑',
 content_too_large: '选中内容过大，请减少消息数量后重试',
  idempotency_conflict: '同一发送请求的内容不一致，请核对发送结果', invalid_request: '请求内容无效',
  annotation_limit:'这条消息的共享标记已达上限，请先取消不需要的标记',
  rate_limited: '操作过于频繁，请稍后使用原请求重试',
  dependency_unavailable: '服务暂时不可用，请使用原请求重试', approval_required: '已启用加入审批', already_member: '你已经是团队成员',
}

// Publication and frozen-capture persistence are separate acknowledgements.
function requireFrozenMetadataSaved(data: Record<string, unknown>, required: boolean): void {
  if (required && data.state === 'published' && data.metadata_saved !== true) {
    throw new ArkmePluginError('team-dependency_unavailable', reasons.dependency_unavailable!, true, 503, {writeOutcomeUnknown:true})
  }
}

// Signing credentials authorize a download; they do not identify its pixels.
// Preserve content/version/processing parameters so a real avatar change still
// invalidates the presentation. The original URL remains inside the access ref.
function imagePresentationIdentity(raw: string): string {
  try {
    const url = new URL(raw)
    const authorization = new Set(['ossaccesskeyid', 'expires', 'signature', 'security-token',
      'x-oss-signature', 'x-oss-signature-version', 'x-oss-credential', 'x-oss-date',
      'x-oss-expires', 'x-oss-security-token', 'x-oss-additional-headers'])
    for (const key of [...url.searchParams.keys()]) if (authorization.has(key.toLowerCase())) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.toString()
  } catch { return raw }
}

/** App business adapter. Never uses Team OpenAPI or stores Chat session state. */
export class TeamAppService {
  private readonly policies = new Map<string,TeamNotificationPolicy>()
  private policy(raw:unknown, actor:number, uid:string, required=false):TeamNotificationPolicy {
    const key=`${actor}:${uid}`, next=mergeTeamNotificationPolicy(this.policies.get(key),notificationPolicy(raw,required))
    this.policies.set(key,next)
    while(this.policies.size>2048)this.policies.delete(this.policies.keys().next().value!)
    return next
  }
  private readonly codec: EncryptedReferenceCodec
  private readonly memberAvatars = new Map<string, { expires: number; value: { avatarRef?: string; avatarFallback?: import('../types.js').ArkmeGroupAvatarFallback } }>()
  constructor(private readonly runtime: ServiceRuntime, private readonly avatars: TeamMemberAvatarPort,
    private readonly privateChat?: Pick<ChatService, 'openPrivateChatFromUser'> & Partial<Pick<ChatService, 'chatSharedRecordingPreview'>>,
    private readonly contacts?: Pick<SourceService, 'privateRemarksByUserIds'> & Partial<Pick<SourceService, 'openSourceRef'>>,
    private readonly memberCandidates?: TeamMemberCandidatePort,
 private readonly outboundTargets?: import('../team-outbound-contract.js').TeamOutboundTargetPort) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid)

  }
  private async ref(kind: string, value: Record<string, unknown>, actor: number): Promise<string> {
    return await this.codec.seal(`team-app-${kind}`, { ...value, viewer: actor, environment: this.runtime.config.environment })
  }
  private async open(kind: string, value: unknown, actor: number): Promise<Record<string, unknown>> {
    const decoded = await this.codec.open(`team-app-${kind}`, str(value))
    if (decoded.viewer !== actor || ['member-candidate','member-candidate-cursor'].includes(kind) && decoded.environment !== this.runtime.config.environment) throw invalid()
    return decoded
  }
  async resolveConversation(ref:string,actor:number):Promise<{conversation_uid:string;side:TeamSide}>{
    const value=await this.open('conversation',ref,actor)
    if(!str(value.conversation_uid)||!['team','external'].includes(str(value.side)))throw invalid()
    return {conversation_uid:str(value.conversation_uid),side:value.side as TeamSide}
  }
  async resolveMessageSelection(conversationRef:string,selections:unknown,actor:number):Promise<{conversation_uid:string;message_uid:string;side:TeamSide;expected_record_version:number}[]>{
    const context=await this.resolveConversation(conversationRef,actor)
    if(!Array.isArray(selections)||!selections.length||selections.length>100)throw invalid()
    const selected=await Promise.all(selections.map(async raw=>{const input=obj(raw),message=await this.open('message',input.messageRef,actor);if(message.conversation_uid!==context.conversation_uid||message.side!==context.side||num(input.version)<=0)throw invalid();return {...context,message_uid:str(message.message_uid),expected_record_version:num(input.version)}}))
    if(selected.some(item=>!item.message_uid)||new Set(selected.map(item=>item.message_uid)).size!==selected.length)throw invalid()
    return selected
  }
  async messageReceipt(raw:unknown,actor:number,context:{conversation_uid:string;side:TeamSide}):Promise<TeamMessage>{return this.message(raw,actor,context)}
  async conversationKey(ref: string, actor: number): Promise<string> {
    const context = await this.open('conversation', ref, actor)
    return await this.key(`${str(context.conversation_uid)}:${str(context.side)}`, actor)
  }
  async changeHint(hint:import('../chat-realtime.js').ArkmeTeamChangeHint,actor:number):Promise<import('../team-app-contract.js').TeamMessageChangeHint>{
    return {kind:hint.kind,
      ...(hint.messageRevision?{messageRevision:hint.messageRevision}:{}),
      ...(hint.conversationRevision?{conversationRevision:hint.conversationRevision}:{}),
      ...(hint.sequence?{sequence:hint.sequence}:{}),
      ...(hint.messageUid?{messageKey:await this.key(hint.messageUid,actor)}:{}),
      ...(hint.conversationUid?{conversationKeys:await Promise.all(['team','external'].map(side=>this.key(`${hint.conversationUid}:${side}`,actor)))}:{})}
  }
  async reactionTarget(conversationRef:string,messageRef:string):Promise<import('./reaction-service.js').ReactionWireTarget>{
    const actor=(await this.runtime.requireSession()).userId
    const [context,message]=await Promise.all([this.open('conversation',conversationRef,actor),this.open('message',messageRef,actor)])
    if(message.conversation_uid!==context.conversation_uid||message.side!==context.side||!['team','external'].includes(str(context.side)))throw invalid()
    return {team_conversation_uid:str(context.conversation_uid),team_message_uid:str(message.message_uid),team_side:context.side as 'team'|'external'}
  }
  /** Presentation aliases for actors already authorized by the reaction owner. */
  async reactionActorKeys(conversationRef: string, ids: readonly number[]): Promise<Map<number, string>> {
    const actor = (await this.runtime.requireSession()).userId
    const context = await this.open('conversation', conversationRef, actor)
    if (context.side !== 'team') return new Map()
    return new Map(await Promise.all([...new Set(ids)].map(async id =>
      [id, await this.key(`person:${id}`, actor)] as const)))
  }
  async replyKey(conversationRef: string, messageRef: string, actor: number): Promise<string> {
    const context = await this.open('conversation', conversationRef, actor)
    const message = await this.open('message', messageRef, actor)
    if (message.conversation_uid !== context.conversation_uid || message.side !== context.side || !str(message.message_uid)) throw invalid()
    return await this.key(str(message.message_uid), actor)
  }
  private async mentionContent(raw: unknown, actor: number, context: Record<string, unknown>) {
    const content = {...obj(raw)}, payload = {...obj(content.content_payload)}, text = str(content.text_content)
    if (payload.mention_metadata || payload.mentionMetadata) throw invalid()
    const inputs = content.mentions
    delete content.mentions
    if (inputs === undefined) return content
    if (!Array.isArray(inputs) || inputs.length > 100 || inputs.length && context.side !== 'team') throw invalid()
    const humans = []
    let end = 0
    for (const input of inputs) {
      const m = obj(input), start = m.startIndex, length = m.length
      if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < end || typeof length !== 'number' || !Number.isSafeInteger(length) || length <= 1 || start + length > text.length) throw invalid()
      const person = await this.open('person', m.personRef, actor), id = recordOwnerId(person.user_id)
      if (person.conversation_uid !== context.conversation_uid || person.side !== 'team' || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw invalid()
      const token = text.slice(start, start + length)
      if (token !== `@${str(m.displayName)}`) throw invalid()
      humans.push({user_id:id,display_name_snapshot:str(m.displayName),start_index:start,length})
      end = start + length
    }
    if (humans.length) content.content_payload = {...payload,payload_kind:payload.payload_kind ?? 1,schema_version:1,text_state:1,mention_metadata:encodeMentionMetadata(text,{humans,bots:[]})}
    return content
  }
  private async key(value: string, actor: number): Promise<string> {
    return createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(`team:${actor}:${value}`).digest('hex')
  }
  private async identity(raw: unknown, actor: number, person?: { id: unknown; context: Record<string, unknown> }): Promise<TeamIdentity> {
    const v = obj(raw), url = str(v.avatar_url)
    const id = recordOwnerId(person?.id)
    const actionable = person?.context.side === 'team' && !!id && (typeof id === 'number' || v.kind === 'person') && (v.kind === undefined || v.kind === 'person') && v.account_state !== 'cancelled'
    return { nickname: str(v.nickname) || '用户', memberType: arkmePeerMemberType(v.member_type),
      ...(actionable ? { personKey: await this.key(`person:${id}`, actor), isMe: String(id) === String(actor),
        personRef: await this.ref('person', { conversation_uid: person!.context.conversation_uid, side: 'team', user_id: id }, actor) } : {}),
      ...(url ? { imageRef: await this.ref('image', { url }, actor), imageKey: await this.key(`image:${imagePresentationIdentity(url)}`, actor) } : {}) }
  }
  async searchContactTeam(jotmoId: string, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<import('../types.js').ArkmeContactTeamSearchResult | undefined> {
    const data = obj(await this.runtime.authenticatedTeamPost('/api/v1/team/discovery/search', { jotmo_id: jotmoId }, session, signal, true))
    if (data.team === null) return undefined
    const v = obj(data.team), avatar = obj(v.avatar)
    if (!str(v.name) || !str(v.jotmo_id) || typeof v.requires_approval !== 'boolean' || !['none', 'joined', 'pending', 'rejected', 'not_member'].includes(str(v.state))) throw invalid()
    const key = await this.key(`avatar:${str(avatar.key)}`, session.userId)
    return { name: str(v.name), jotmoId: str(v.jotmo_id), state: str(v.state), requiresApproval: v.requires_approval === true,
      avatar: { mode: avatar.mode === 'custom' ? 'custom' : 'default', key: avatar.mode === 'custom' ? `team_avatar_asset://${key}` : key,
        ...(avatar.mode === 'custom' ? { imageRef: await this.ref('profile-image', { jotmo_id: v.jotmo_id, key: avatar.key }, session.userId) } : {}) } }
  }

  private async team(raw: unknown, actor: number): Promise<ArkmeTeam> {
    const v = obj(raw)
    if (!recordOwnerId(v.team_id)) throw invalid()
    return { key: await this.key(`team:${String(v.team_id)}`, actor), teamRef: await this.ref('team', { team_id: recordOwnerId(v.team_id) }, actor), name: str(v.name), jotmoId: str(v.jotmo_id),
      profileRevision:num(v.profile_revision),canEditProfile:v.can_edit_profile===true,avatar:await this.avatar(v,actor),
      currentUserRole: role(v.role), createdAtMillis: num(v.ca), updatedAtMillis: num(v.ua) }
  }
  private async avatar(raw:Record<string,unknown>,actor:number,publicRef?:string):Promise<ArkmeTeamAvatar> {
    const v=obj(raw.avatar),custom=v.mode==='custom', key=await this.key(`avatar:${str(v.key)}`,actor);
    return {mode:custom?'custom':'default',key:custom?`team_avatar_asset://${key}`:key,
      ...(custom?{imageRef:await this.ref('profile-image',{team_id:raw.team_id,key:v.key,...(publicRef?{public_ref:publicRef}:{})},actor)}:{})};
  }
  private async profile(raw:unknown,actor:number):Promise<ArkmeTeamProfile> {
    const v=obj(raw);if(!recordOwnerId(v.team_id))throw invalid();
    return {profileRef:await this.ref('team',{team_id:recordOwnerId(v.team_id)},actor),name:str(v.name),jotmoId:str(v.jotmo_id),
      profileRevision:num(v.profile_revision),canEditProfile:v.can_edit_profile===true,avatar:await this.avatar(v,actor)};
  }
  private async profileResult(raw:Record<string,unknown>,actor:number):Promise<ArkmeTeamProfileResult> {
    return {requestUid:str(raw.request_uid),acceptedRevision:num(raw.accepted_revision),...(raw.team?{profile:await this.profile(raw.team,actor)}:{})};
  }
  private async channel(raw: unknown, actor: number): Promise<TeamChannel> {
    const v = obj(raw)
    const identity = await this.identity({ nickname: v.name, avatar_url: v.avatar_url }, actor)
    const publicRef = str(v.public_ref)
    const link = new URL('/team-message', this.runtime.config.shareWebsite || 'https://www.jotmo.cc')
    link.searchParams.set('channel', publicRef)
    return { teamRef: await this.ref('team', { team_id: recordOwnerId(v.team_id) }, actor), name: str(v.name), jotmoId: str(v.jotmo_id),
      avatar: await this.avatar(v,actor,publicRef),
      ...(identity.imageRef ? { imageRef: identity.imageRef, imageKey: identity.imageKey } : {}), publicRef, link: publicRef ? link.toString() : '',
      enabled: v.enabled === true, revision: num(v.revision), canManage: v.can_manage === true,
      canPause: v.can_pause === undefined ? v.can_manage === true : v.can_pause === true }
  }
  private async conversation(raw: unknown, actor: number): Promise<TeamConversation> {
    const v = obj(raw), uid = str(v.conversation_uid), side: TeamSide = v.side === 'team' ? 'team' : 'external'
    if (!uid) throw invalid()
    // A former visitor can also be a current member. Each side owns a different
    // composer and accepted send identity, even when the conversation is shared.
    return { ref: await this.ref('conversation', { conversation_uid: uid, side }, actor), key: await this.key(`${uid}:${side}`, actor),
      channel: await this.channel(v.channel, actor), ...(v.visitor ? { visitor: await this.identity(v.visitor, actor, { id: v.external_user_id, context: { conversation_uid: uid, side } }) } : {}), side,
      lastSeq: num(v.last_seq), latestTeamReplySeq: num(v.latest_team_reply_seq), myReadSeq: num(v.my_read_seq), unread: num(v.unread),
      notificationPolicy: this.policy(v.notification_policy,actor,uid), attentionUnread: this.policy(v.notification_policy,actor,uid).muted ? 0 : num(v.unread),
      needsReply: v.needs_reply === true, blocked: v.blocked === true, revision: num(v.revision), updatedAt: num(v.updated_at), ...(v.preview ? { preview: { text: str(obj(v.preview).text), status: str(obj(v.preview).status), hasMedia: obj(v.preview).has_media === true, templateKind: num(obj(v.preview).template_kind) } } : {}) }
  }
  private async mediaItems(raw:unknown,actor:number,locator:Record<string,unknown>,version:number) {
    return await Promise.all(list(raw).map(async f => {
      const ref=await this.ref('media',{...locator,record_version:version,file_asset_uid:str(f.file_asset_uid),file_name:str(f.file_name),mime_type:str(f.mime_type),size:num(f.size)},actor)
      return {key:await this.key(`media:${str(locator.message_uid)}:${version}:${str(f.file_asset_uid)}`,actor),ref,
        url:`${this.runtime.config.routePath}/team/media?ref=${encodeURIComponent(ref)}`,name:str(f.file_name)||'附件',mimeType:str(f.mime_type),size:num(f.size),kind:num(f.file_kind)}
    }))
  }
  private async message(raw: unknown, actor: number, context: Record<string, unknown>): Promise<TeamMessage> {
    const v = obj(raw), content = v.state === 'recalled' ? {} : obj(v.record), uid = str(v.message_uid)
    const locator = { conversation_uid: context.conversation_uid, side: context.side, message_uid: uid, message_side: v.side, sender_user_id: recordOwnerId(v.actor_user_id), ...(obj(content.content_payload).mention_metadata ? { has_mentions: true } : {}) }
    const mentions = []
    if (context.side === 'team') {
      for (const m of list(obj(obj(content.content_payload).mention_metadata).human_mentions).slice(0, 100)) {
        const identity = await this.identity({}, actor, {id:m.user_id,context})
        if (identity.personRef) mentions.push({personRef:identity.personRef,displayName:str(m.display_name_snapshot) || str(content.text_content).slice(num(m.start_index)+1,num(m.start_index)+num(m.length)),startIndex:num(m.start_index),length:num(m.length)})
      }
    }
    const reply = obj(v.reply)
    const replyPreview = str(reply.message_uid) ? {
      ref: await this.ref('message', {conversation_uid:context.conversation_uid,side:context.side,message_uid:reply.message_uid},actor),
      key:await this.key(str(reply.message_uid),actor),seq:num(reply.seq),version:num(reply.record_version),
      state: ['available','edited'].includes(str(reply.state)) ? str(reply.state) as 'available'|'edited' : 'unavailable' as const,
      title: ['available','edited'].includes(str(reply.state)) ? str(reply.title) : '',
      media: ['available','edited'].includes(str(reply.state)) ? await this.mediaItems(reply.media,actor,{conversation_uid:context.conversation_uid,side:context.side,message_uid:reply.message_uid},num(reply.record_version)) : [],
      text: ['available','edited'].includes(str(reply.state)) ? str(reply.text) : '',sender:await this.identity(['available','edited'].includes(str(reply.state))?reply.sender:{},actor),
      ...(reply.state === 'available' && readMessageQuote(reply.quote) ? {quote:readMessageQuote(reply.quote)!} : {}),
    } : undefined
    const markContent = { title: str(content.title), textContent: str(content.text_content), textFormat: obj(content.content_payload).text_format === 'markdown' ? 'markdown' as const : 'plain' as const }
    const markable = v.state === 'published' && content.status === 'available' && !!(markContent.textContent || markContent.title)
    const projectedMedia = await this.mediaItems(content.media, actor, locator, num(content.version))
    const byAsset=new Map(list(content.media).map((file,index)=>[str(file.file_asset_uid),projectedMedia[index]!]))
    const forwardRecords=projectTeamForward(content.content_payload,(files,longArticle)=>files.flatMap((file,index)=>{const asset=byAsset.get(str(file.media_key)||str(file.file_asset_uid));return asset?[{kind:asset.mimeType.startsWith('image/')?'image' as const:asset.mimeType.startsWith('video/')?'video' as const:asset.mimeType.startsWith('audio/')?'audio' as const:'file' as const,mediaRef:asset.ref,fileName:asset.name,mimeType:asset.mimeType,size:asset.size,sortOrder:index,...(longArticle?{fileAssetUid:`media-${index}`}:{})}]:[]}))
    return teamMessageProjection({ ...(v.own===true&&typeof v.metadata_saved==='boolean'?{metadataSaved:v.metadata_saved}:{}), ref: await this.ref('message', locator, actor), key: await this.key(uid, actor), seq: num(v.seq), revision: num(v.revision),
      ...(markable ? { localMarkRef: await this.ref('local-mark', { ...locator, record_version: num(content.version),
        digest: createHash('sha256').update(quoteSourceContent(markContent)).digest('hex'), canonicalDigest: createHash('sha256').update(quoteCanonicalText(markContent)).digest('hex') }, actor) } : {}),
      side: v.side === 'team' ? 'team' : 'external', sender: await this.identity(v.sender, actor, { id: v.actor_user_id, context }), own: v.own === true,
      canRecall: v.can_recall === true, ...(v.state === 'recalled' ? {recalledAt:num(v.recalled_at)} : {}),
      state: str(v.state), createdAt: num(v.created_at), canEdit: v.can_edit === true, canDelete: v.can_delete === true,
      ...(typeof v.recipient_read === 'boolean' ? { recipientRead: v.recipient_read } : {}),
      ...(replyPreview ? {reply:replyPreview} : {}),
      version: num(content.version), contentStatus: str(content.status), ...(v.record && v.state !== 'recalled' ? { content: {
        ...(mentions.length ? {mentions} : {}), text_content: str(content.text_content), title: str(content.title), template_kind: num(content.template_kind) || 1,
        ...(content.content_payload ? { content_payload: (() => { const payload = {...obj(content.content_payload)}; delete payload.mention_metadata; delete payload.mentionMetadata; return payload })() } : {}),
      } } : {}),
      mediaComplete: (()=>{const payload=obj(content.content_payload),assets=new Set(list(content.media).map(media=>str(media.file_asset_uid)));return [...list(payload.media_refs).map(media=>str(media.file_asset_uid)),str(obj(payload.voice).file_asset_uid)].filter(Boolean).every(id=>assets.has(id))})(),
      media: projectedMedia,
      ...(forwardRecords?{forwardRecords}:{}),
    })
  }

  private async externalShare(v: Record<string,unknown>, actor: number): Promise<import('../team-external-chat-contract.js').ExternalChatShare> {
    return { ref: await this.ref('external-share', { share_uid: str(v.share_uid), sharer_id: v.sharer_user_id, sharer_name: str(v.sharer_name), peer_name: str(v.peer_name) }, actor), key: await this.key(`external:${str(v.share_uid)}`, actor),
      teamKey: await this.key(`team:${String(v.team_id)}`, actor), teamRef: await this.ref('team', { team_id: v.team_id }, actor), sharerKey: await this.key(`person:${String(v.sharer_user_id)}`, actor),
      sharerName: str(v.sharer_name) || '团队成员', peerName: str(v.peer_name) || '外部联系人', own: recordOwnerId(v.sharer_user_id) === actor }
  }
  async resolveMessageNotification(hint: {eventUid:string;messageUid:string;conversationUid:string}, session:ArkmeSessionCredentials, signal:AbortSignal) {
    const raw = obj(await this.runtime.authenticatedTeamPost('/api/v1/team/conversations/notifications/resolve',
      {message_uid:hint.messageUid,event_uid:hint.eventUid}, session, signal, true))
    if (raw.notification == null) return undefined
    const n = obj(raw.notification)
    if (n.event_uid !== hint.eventUid || n.message_uid !== hint.messageUid || n.conversation_uid !== hint.conversationUid ||
        !['team','external'].includes(str(n.side)) || num(n.seq)<=0 || num(n.published_at)<=0 || num(n.expires_at)-num(n.published_at)!==3600000) throw invalid()
    const current = await this.runtime.accountScopedSession()
    if (signal.aborted || current?.userId!==session.userId || current.refreshToken!==session.refreshToken) throw invalid()
    return { eventUid:hint.eventUid, sourceRef:await this.ref('notification',{conversation_uid:n.conversation_uid},session.userId),
      sourceKey:await this.key(`${str(n.conversation_uid)}:${str(n.side)}`,session.userId), sourceKind:'team_conversation' as const,
      title:str(n.title), body:str(n.body), eventAtMillis:num(n.published_at), expiresAtMillis:num(n.published_at)+300000 }
  }

  private async frozenMetadata(ref: unknown, actor: number, context: Record<string, unknown>, uid: string, kind: 'send'|'edit', messageUid?: unknown) {
    const value = await this.codec.open('team-app-capture', str(ref))
    if (value.viewer !== actor || value.environment !== this.runtime.config.environment || value.conversation_uid !== context.conversation_uid || value.side !== context.side || value.operation_uid !== uid || value.kind !== kind || (kind === 'edit' && value.message_uid !== messageUid)) throw invalid()
    return kind === 'send' ? readTeamRecordMetadata(value.metadata) : readTeamEditMetadata(value.metadata)
  }
  async sendMetadataDigest(conversationRef: string, uid: string, ref: string, actor: number): Promise<string> {
    const session = await this.assertViewer(undefined)
    if (session.userId !== actor) throw invalid()
    const context = await this.resolveConversation(conversationRef, actor)
    const metadata = await this.frozenMetadata(ref, actor, context, uid, 'send')
    return createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
  }
  async assertViewer(expectedAccountKey: unknown): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (expectedAccountKey !== undefined && expectedAccountKey !== `${this.runtime.config.environment}:${session.userId}`) {
      throw new ArkmePluginError('team-account-changed', '登录账号已在其他页面切换，请重新打开团队消息', false, 409)
    }
    return session
  }

  /** Private annotations reuse the local SQLite store. No cloud write or Chat reference. */
  private async localMarks(operation: TeamAppOperation, p: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal) {
    const actor = session.userId, context = await this.open('conversation', p.conversationRef, actor)
    const store = this.runtime.stateStore.messageMarks
    if (!store) throw new ArkmePluginError('team-local-mark-storage-unavailable', '本机标记存储暂不可用，请重试', true, 503)
    const scope = JSON.stringify([this.runtime.config.environment, actor, 'team', context.conversation_uid, context.side])
    const resolve = async (ref: string) => {
      const target = await this.open('local-mark', ref, actor)
      if (target.conversation_uid !== context.conversation_uid || target.side !== context.side
        || !str(target.message_uid) || !/^[a-f0-9]{64}$/u.test(str(target.digest)) || !/^[a-f0-9]{64}$/u.test(str(target.canonicalDigest))) throw invalid()
      return { key: str(target.message_uid), digest: str(target.digest), canonicalDigest: str(target.canonicalDigest), version: num(target.record_version) }
    }
    const assertAccount = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.accountScopedSession()
      if (current?.userId !== actor || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('team-account-changed', '登录账号已变化，请重新打开团队消息', false, 409)
    }
    if (operation === 'team.app.local-mark.capabilities') {
      await assertAccount()
      return { supported: true, maxLength: 2000, storage: 'local', maxBatchSize: 4 }
    }
    if (operation === 'team.app.local-mark.list') {
      const refs = p.markRefs
      if (!Array.isArray(refs) || !refs.length || refs.length > 4 || refs.some(ref => typeof ref !== 'string') || new Set(refs).size !== refs.length) throw invalid()
      const targets = await Promise.all(refs.map(resolve))
      await assertAccount()
      return targets.map((target, index) => ({ actionRef: refs[index], snapshot: store.read(scope, target.key, actor, target.digest) }))
    }
    const target = await resolve(str(p.markRef)), change = obj(p.change)
    if (!underlineId(change.operationId) || !['add', 'remove'].includes(str(change.kind))
      || change.kind === 'remove' && !underlineId(change.annotationId)) throw invalid()
    const anchor = change.kind === 'add' ? readMessageQuote(change.anchor) : undefined
    const canonical = str(change.canonical)
    if (change.kind === 'add' && (!anchor || anchor.sourceDigest !== target.digest
      || anchor.recordVersion !== target.version || Buffer.byteLength(canonical, 'utf8') > 256_000
      || createHash('sha256').update(canonical).digest('hex') !== target.canonicalDigest || !quoteMatchesCanonical(anchor, canonical))) {
      throw new ArkmePluginError('team-local-mark-source-changed', '选区与原文不一致，请重新选择', false, 409)
    }
    await assertAccount()
    const mutation: MessageUnderlineChange = change.kind === 'add'
      ? { kind: 'add', operationId: change.operationId, anchor: anchor! }
      : { kind: 'remove', operationId: change.operationId, annotationId: str(change.annotationId) }
    return store.change(scope, target.key, actor, target.digest, mutation)
  }

  async execute(operation: TeamAppOperation, p: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const session = await this.assertViewer(p.expectedAccountKey), actor = session.userId
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
        if (reasons[reason]) throw new ArkmePluginError(`team-${reason}`, reasons[reason], ['dependency_unavailable', 'rate_limited', 'reply_conflict'].includes(reason), reason === 'dependency_unavailable' ? 503 : reason === 'rate_limited' ? 429 : 409, { cause: error })
      }
      throw error
    }
  }

  private async checkTeamJotmoId(name: string, session: ArkmeSessionCredentials, signal?: AbortSignal) {
    const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/check-jotmo-id-available', { name, scene: 'team_create' }, session, signal,
    )
    return { available: data.available === true, reason: str(data.reason) }
  }

  private async dispatch(operation: TeamAppOperation, p: Record<string, unknown>, session: ArkmeSessionCredentials,
    post: (path: string, body?: Record<string, unknown>, read?: boolean) => Promise<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    const actor = session.userId
    if (operation === 'team.app.local-mark.capabilities' || operation === 'team.app.local-mark.list' || operation === 'team.app.local-mark.change') {
      return await this.localMarks(operation, p, session, signal)
    }
    const teamID = async () => {
      const value = await this.open('team', p.teamRef, actor)
      if ((operation === 'team.app.member-candidates' || operation.startsWith('team.app.members.add')) && value.environment !== this.runtime.config.environment) throw invalid()
      return value.team_id
    }
    const conversation = async () => {
      const v = await this.open('conversation', p.conversationRef, actor)
      return { conversation_uid: v.conversation_uid, side: v.side }
    }
    const message = async () => {
      const v = await this.open('message', p.messageRef, actor)
      return { conversation_uid: v.conversation_uid, message_uid: v.message_uid, side: v.side }
    }
    switch (operation) {
      case 'team.app.snapshot.capabilities': {
        try { const data = await post('conversations/messages/metadata/capabilities', {}, true); return { schemaVersion: data.schema_version === 1 ? 1 : 0, recordPropertiesVersion: data.schema_version === 1 && data.record_properties_version === 1 ? 1 : 0 } }
        catch (error) { if (error instanceof ArkmePluginError && error.upstreamStatus === 404) return {schemaVersion: 0,recordPropertiesVersion:0}; throw error }
      }
      case 'team.app.snapshot.seal': {
        const capability = obj(await this.dispatch('team.app.snapshot.capabilities',{},session,post,signal))
        if (capability.recordPropertiesVersion !== 1) throw new ArkmePluginError('team-snapshot-unsupported','当前服务尚不支持完整快记属性',false,409)
        if(p.kind!=='send'&&p.kind!=='edit')throw invalid()
        const context = await conversation(), uid = str(p.operationUid), kind = p.kind === 'edit' ? 'edit' : 'send'
        if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(uid) || !await this.runtime.stateStore.uniqueCode()) throw invalid()
        const target = kind === 'edit' ? await message() : undefined
        if (target && (target.conversation_uid !== context.conversation_uid || target.side !== context.side)) throw invalid()
        const metadata = kind === 'send' ? readTeamRecordMetadata(p.metadata) : readTeamEditMetadata(p.metadata)
        if (kind === 'edit' && (metadata as import('../team-snapshot-contract.js').TeamEditMetadata).revision_uid !== uid) throw invalid()
        return { metadataRef: await this.codec.seal('team-app-capture', {viewer:actor, environment:this.runtime.config.environment, ...context, operation_uid:uid, kind, ...(target ? {message_uid:target.message_uid} : {}), metadata}) }
      }
      case 'team.app.snapshot.read': case 'team.app.snapshot.receipt': {
        const context = await conversation(), target = await message()
        if (target.conversation_uid !== context.conversation_uid || target.side !== context.side) throw invalid()
        const capability=obj(await this.dispatch('team.app.snapshot.capabilities',{},session,post,signal))
        if(capability.schemaVersion!==1)throw new ArkmePluginError('team-snapshot-unsupported','当前服务尚不支持团队记忆快照',false,409)
        if (operation === 'team.app.snapshot.receipt') {
          const data = await post('conversations/messages/edit-receipt/get', {...target, revision_uid:str(p.revisionUid)}, true)
          return {revisionUid:str(data.revision_uid), accepted:data.accepted===true, ...(num(data.accepted_version)>0?{acceptedVersion:num(data.accepted_version)}:{}), ...(num(data.current_version)>0?{currentVersion:num(data.current_version)}:{})}
        }
        const raw = await post('conversations/messages/snapshot/get', target, true)
        const snapshot = decodeTeamMessageSnapshot(raw, str(p.messageRef))
        const background = await this.mediaItems(Array.isArray(raw.background_sound) ? raw.background_sound.filter(file => obj(file).delivery_state === 1) : [], actor, {...target,private_snapshot:true}, snapshot.version)
        if (background.length) {
          snapshot.detail.backgroundSound = 'available'
          snapshot.detail.backgroundSoundPlayback = {mediaRefs:[],mediaUrls:background.map(file => file.url),amplitudes:(Array.isArray(raw.background_sound_amplitudes) ? raw.background_sound_amplitudes : []).filter((n):n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1).slice(-4096)}
        }
        return snapshot
      }

      case 'team.app.external.mine': case 'team.app.external.share': {
        const source = await this.contacts?.openSourceRef?.(str(p.sourceRef), actor)
        if (!source || source.kind !== 'private_chat') throw invalid()
        const data = operation === 'team.app.external.share'
          ? await post('external-chats/share', { team_id: await teamID(), chat_session_uid: source.ownerRef })
          : await post('external-chats/mine', { chat_session_uid: source.ownerRef }, true)
        const rows = operation === 'team.app.external.share' ? [data] : list(data.items)
        return { items: await Promise.all(rows.map(v => this.externalShare(v, actor))), hasMore: false }
      }
      case 'team.app.external.unshare': {
        const v = await this.open('external-share', p.shareRef, actor)
        return await post('external-chats/unshare', { share_uid: v.share_uid })
      }
      case 'team.app.external.list': {
        const data = await post('external-chats/list', { team_id: await teamID(), limit: 50,
          ...(p.cursor ? { page_cursor: (await this.open('external-cursor', p.cursor, actor)).cursor } : {}) }, true)
        return { items: await Promise.all(list(data.items).map(v => this.externalShare(v, actor))), hasMore: data.has_more === true,
          ...(data.next_page_cursor ? { nextCursor: await this.ref('external-cursor', { cursor: data.next_page_cursor }, actor) } : {}) }
      }
      case 'team.app.external.page': {
        const grant = await this.open('external-share', p.shareRef, actor)
        const data = await post('external-chats/page', { share_uid: grant.share_uid, before_seq: num(p.beforeSeq), limit: 50 }, true)
        const mediaUrls: Record<string,string> = {}
        const items = await Promise.all(list(data.items).map(async v => {
          const rel = obj(v.relation), record = obj(v.record), body = num(record.status) === 1 ? obj(record.payload) : {}
          const attachments = sharedAttachments(body)
          const blocks = await Promise.all(attachments.map(async ({file: f, path}, sortOrder) => {
            const ref = await this.ref('media', { share_uid: grant.share_uid, seq: num(rel.seq), media_path: path, record_version: num(body.version), file_asset_uid: str(f.file_asset_uid), file_uid: str(f.file_uid), file_name: str(f.file_name) || str(f.name), mime_type: str(f.mime_type) }, actor)
            mediaUrls[ref] = `${this.runtime.config.routePath}/team/media?ref=${encodeURIComponent(ref)}`
            return sharedContentBlock(f, ref, sortOrder)
          }))
          const contentBlocks = blocks.filter((_, index) => attachments[index]?.path[0] === 'media_display_items')
          const forwardRecords = sharedForwardPreview(body, attachments, blocks, actor, num(rel.attach_at))
          const sharedRecording = this.privateChat?.chatSharedRecordingPreview?.(v)
          const sender = recordOwnerId(rel.sender_user_id), sharer = recordOwnerId(grant.sharer_id)
          return { itemUid: await this.key(`external:${String(grant.share_uid)}:${str(rel.rel_uid)}`, actor),
            senderSide: sender !== 0 && sharer !== 0 ? sender === sharer ? 'sharer' as const : 'peer' as const : 'unknown' as const,
            senderName: str(rel.display_name_snapshot) || (recordOwnerId(rel.sender_user_id) === recordOwnerId(grant.sharer_id) ? str(grant.sharer_name) || '分享成员' : str(grant.peer_name) || '聊天对方'), isMe: false,
            sendAtMillis: num(rel.attach_at), title: str(body.title), textContent: num(record.status) === 1 ? remapLongArticleAssets(str(body.text_content), new Map(list(body.media_display_items).map((f, index) => [`arkme-asset:${str(f.file_asset_uid)}`, `arkme-asset:media-${index}`]))) : '内容当前不可用',
            textFormat: obj(body.content_payload).text_format === 'markdown' ? 'markdown' as const : 'plain' as const,
            status: 1, version: num(body.version), templateKind: num(body.template_kind), displayKind: num(body.display_kind), contentBlocks,
            ...(forwardRecords ? {forwardRecords} : {}), ...(sharedRecording ? {sharedRecording} : {}) }
        }))
        return { items, hasMore: data.has_more === true, beforeSeq: num(data.next_before_seq), mediaUrls }
      }
      case 'team.app.profile.get':return await this.profile((await post('profile/get',{team_id:await teamID()},true)).team,actor)
      case 'team.app.profile.status':return await this.profileResult(await post('profile/update/status',{team_id:await teamID(),request_uid:str(p.requestUid)},true),actor)
      case 'team.app.profile.update': {
        const id=await teamID(),patch=obj(p.avatar);
        if(!Number.isSafeInteger(p.expectedRevision)||Number(p.expectedRevision)<0||!str(p.requestUid)||str(p.requestUid).length>128)throw invalid()
        if(p.name!==undefined&&(typeof p.name!=='string'||[...p.name.trim()].length<1||[...p.name.trim()].length>64))throw invalid()
        const body:Record<string,unknown>={team_id:id,expected_revision:p.expectedRevision,request_uid:p.requestUid,...(p.name===undefined?{}:{name:str(p.name).trim()})}
        if(p.avatar!==undefined){
          if(patch.action==='default')body.avatar={action:'default'}
          else if(patch.action==='custom') {const upload=await this.open('profile-upload',patch.uploadRef,actor);if(String(upload.team_id)!==String(id))throw invalid();body.avatar={action:'custom',upload_uid:upload.upload_uid}}
          else throw invalid()
        }
        let result:Record<string,unknown>
        try{result=await post('profile/update',body)}catch(error){
          // A definitive rejection must not be replaced by an older receipt for
          // the same UID with different command contents or authority.
          if(error instanceof ArkmeUpstreamResponseError &&
            ['not_owner','not_accessible','version_conflict','idempotency_conflict','invalid_team_profile','profile_edit_rejected'].includes(str(obj(error.responseData).reason)))throw error
          const status=await post('profile/update/status',{team_id:id,request_uid:p.requestUid},true).catch(()=>undefined)
          if(!status||num(status.accepted_revision)<=0)throw error
          result=status
        }
        return await this.profileResult(result,actor)
      }
      case 'team.app.profile.avatar.upload': {
        const id=await teamID(),uploadUid=str(p.uploadUid)
        if(!/^[A-Za-z0-9._:-]{1,128}$/.test(uploadUid))throw invalid()
        // Authority is checked before decoding bytes, and again when accepting the candidate.
        const current=await post('profile/get',{team_id:id},true);if(obj(current.team).can_edit_profile!==true)throw new ArkmePluginError('team-not_owner',reasons.not_owner!,false,403)
        const bytes=await squareProfileImage(str(p.contentBase64));signal?.throwIfAborted()
        const prepared=await post('profile/avatar/prepare-upload',{team_id:id,upload_uid:uploadUid,planned_size:bytes.length,file_hash:createHash('sha256').update(bytes).digest('hex'),mime_type:'image/jpeg'})
        if(!str(prepared.file_asset_uid)) {
          const headers=Object.fromEntries(Object.entries(obj(prepared.upload_headers)).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))
          const response=await this.runtime.fetchImpl(authorizedStorageURL(str(prepared.upload_url)),{method:'PUT',body:Uint8Array.from(bytes),headers,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(120_000),...(signal?[signal]:[])])})
          await response.body?.cancel();if(!response.ok)throw new ArkmePluginError('team-avatar-upload-failed','头像上传失败，请重试',true,502)
        }
        await post('profile/avatar/complete-upload',{team_id:id,upload_uid:uploadUid})
        return {uploadRef:await this.ref('profile-upload',{team_id:id,upload_uid:uploadUid},actor)}
      }
      case 'team.app.profile.avatar.abort': {const upload=await this.open('profile-upload',p.uploadRef,actor);return await post('profile/avatar/abort-upload',{team_id:upload.team_id,upload_uid:upload.upload_uid})}
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
        const items = p.countOnly === true ? [] : teams.slice(offset, offset + limit).map(v => ({ kind: 'team' as const, teamRef: v.teamRef, displayName: v.name, publicId: v.jotmoId, role: v.currentUserRole, ...(v.avatar?{avatar:v.avatar}:{}) }))
        return { section: 'teams', items, total: teams.length, hasMore: p.countOnly === true ? false : hasMore,
          ...(hasMore ? { nextCursor: await this.ref('directory-cursor', { offset: offset + limit }, actor) } : {}) } satisfies ArkmeDirectoryPage
      }
      case 'team.app.members': {
        const id = await teamID()
        const [data, mine] = await Promise.all([post('members/snapshot', { team_id: id, limit: num(p.limit) || 50, ...(p.pageCursor ? { cursor: (await this.open('member-cursor', p.pageCursor, actor)).cursor } : {}) }, true), post('list-mine', {}, true)])
        if (!Number.isSafeInteger(data.member_count) || Number(data.member_count) < 1 || !Number.isSafeInteger(data.membership_revision) || Number(data.membership_revision) < 0 || typeof data.can_add_members !== 'boolean' || typeof data.has_more !== 'boolean' || !Array.isArray(data.items) || data.has_more && !str(data.next_cursor)) throw invalid()
        const selected = list(mine.teams).find(v => String(v.team_id) === String(id))
        if (!selected) throw new ArkmePluginError('team-not_accessible', reasons.not_accessible!, false, 403)
        const members = list(data.items)
        // Membership renders immediately; the App can enrich this page separately.
        // Cache only decoration, scoped to the viewer. Membership/permissions are
        // still obtained above on every request, never from this cache.
        const ids = [...new Set(members.flatMap(v => v.jotmo_id ? [str(v.jotmo_id)] : []))]
        const presentations = new Map<string, { avatarRef?: string; avatarFallback?: import('../types.js').ArkmeGroupAvatarFallback }>()
        for (const [key, cached] of this.memberAvatars) if (cached.expires <= Date.now()) this.memberAvatars.delete(key)
        for (const id of ids) {
          const cached = this.memberAvatars.get(`${actor}:${id}`)
          if (cached) presentations.set(id, cached.value)
        }
        let avatarState: TeamMembers['avatarState'] = ids.length ? 'pending' : 'ready'
        if (ids.length && p.avatarMode !== 'deferred') {
          const avatarSignal = AbortSignal.any([AbortSignal.timeout(p.avatarMode === 'wait' ? 8_000 : 1_500), ...(signal ? [signal] : [])])
          try {
            const fresh = await this.avatars.publicAvatarPresentationsByArkmeIds(ids, avatarSignal)
            avatarState = 'ready'
            for (const id of ids) {
              const value = fresh.get(id)
              // Missing entries are not evidence of a removed avatar.
              if (value === undefined) { avatarState = 'unavailable'; continue }
              presentations.set(id, value)
              this.memberAvatars.delete(`${actor}:${id}`)
              this.memberAvatars.set(`${actor}:${id}`, { value, expires: Date.now() + 5 * 60_000 })
            }
            while (this.memberAvatars.size > 1_000) this.memberAvatars.delete(this.memberAvatars.keys().next().value!)
          } catch (error) {
            if (signal?.aborted) throw error
            avatarState = 'unavailable'
          }
        }
        return { team: await this.team(selected, actor), totalCount: num(data.member_count), membershipRevision:num(data.membership_revision), canAddMembers:data.can_add_members===true, hasMore: data.has_more === true, avatarState,
          ...(data.next_cursor ? { nextPageCursor: await this.ref('member-cursor', { cursor: data.next_cursor }, actor) } : {}),
          items: await Promise.all(members.map(async v => ({
            key: await this.key(`member:${String(id)}:${recordOwnerId(v.user_id)}`, actor),
            userRef: await this.ref('member', { team_id: id, user_id: recordOwnerId(v.user_id) }, actor), displayName: str(v.display_name) || '用户',
            ...(v.jotmo_id ? { jotmoId: str(v.jotmo_id), ...presentations.get(str(v.jotmo_id)) } : {}),
            identityState: v.identity_state === 'ready' ? 'ready' as const : v.identity_state === 'unavailable' ? 'unavailable' as const : 'incomplete' as const,
            ...(v.join_source === 3 && str(v.added_by_display_name) ? {addedByName:str(v.added_by_display_name)} : {}),
            role: role(v.role), joinedAtMillis: num(v.joined_at), canRemove: v.can_remove === true,
            codexSync: readTeamMemberCodexSync(v.codex_sync),
          }))),
        } satisfies TeamMembers
      }
      case 'team.app.member.remove': {
        const ref = await this.open('member', p.userRef, actor)
        return await post('members/remove', { team_id: ref.team_id, target_user_id: ref.user_id })
      }
      case 'team.app.leave': return await post('members/leave', { team_id: await teamID() })
      case 'team.app.create.check': return await this.checkTeamJotmoId(str(p.jotmoId).trim(), session, signal)
      case 'team.app.create': {
        try { return await this.team((await post('create', { name: str(p.name), jotmo_id: str(p.jotmoId), request_uid: str(p.requestUid) })).team, actor) }
        catch (error) {
          if (!(error instanceof ArkmePluginError) || error.code !== 'arkme-code-1001') throw error
          // Availability can change between checking the form and claiming the ID.
          // Recheck only; never repeat the creation mutation or change its request UID.
          const availability = await this.checkTeamJotmoId(str(p.jotmoId).trim(), session, signal).catch(() => undefined)
          const reason = availability?.reason
          throw new ArkmePluginError('team-create-rejected', reason === 'taken' ? '该即我号已被占用' : reason === 'invalid' ? '即我号格式不正确' : '创建未完成，请检查团队名称和即我号后重试', false, 400, { cause: error })
        }
      }
      case 'team.app.join.status': {
        const data = await post('join-requests/status', { jotmo_id: str(p.jotmoId) }, true)
        return { state: str(data.state) }
      }
      case 'team.app.join': {
        try { return { state: 'joined', team: await this.team((await post('join-by-jotmo-id', { jotmo_id: str(p.jotmoId) })).team, actor) } }
        catch (error) {
          if (!(error instanceof ArkmeUpstreamResponseError) || obj(error.responseData).reason !== 'approval_required') throw error
          try {
            const result = await post('join-requests/create', { jotmo_id: str(p.jotmoId), request_uid: str(p.requestUid) })
            if (result.state === 'pending' || result.state === 'rejected') return { state: result.state }
            // A retry may replay an old approved application after the member left.
            // Resolve current membership; approval history alone never means joined.
            if (result.state === 'approved') {
              const status = await post('join-requests/status', { jotmo_id: str(p.jotmoId) }, true)
              if (['joined', 'not_member'].includes(str(status.state))) return { state: str(status.state) }
            }
            throw invalid()
          } catch (applyError) {
            if (applyError instanceof ArkmeUpstreamResponseError && obj(applyError.responseData).reason === 'already_member') return { state: 'joined' }
            throw applyError
          }
        }
      }
      case 'team.app.world.prepare': {
        const id = await teamID()
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(str(p.requestUid))) throw invalid()
        const mine = await post('list-mine', {}, true)
        if (!Array.isArray(mine.teams)) throw invalid()
        if (!list(mine.teams).some(team => String(recordOwnerId(team.team_id)) === String(id))) {
          throw new ArkmePluginError('team-not_accessible', reasons.not_accessible!, false, 403)
        }
        // Membership only: no record, upload, publication or cloud publishing grant.
        return { state: 'backend_pending' } satisfies TeamWorldPrepareResult
      }
      case 'team.app.world.view': {
        const jotmoId = str(p.jotmoId).trim()
        if (!jotmoId || jotmoId.length > 128) throw invalid()
        const mine = await post('list-mine', {}, true)
        if (!Array.isArray(mine.teams)) throw invalid()
        const raw = list(mine.teams).find(team => str(team.jotmo_id) === jotmoId)
        if (raw) {
          const team = await this.team(raw, actor)
          return { state: 'backend_pending', team: { name: team.name, jotmoId, avatar: team.avatar }, memberTeam: team } satisfies TeamWorldView
        }
        const team = await this.searchContactTeam(jotmoId, session, signal)
        if (!team || team.jotmoId !== jotmoId) throw new ArkmePluginError('team-not_accessible', '团队资料暂不可用', false, 404)
        return { state: 'backend_pending', team: { name: team.name, jotmoId, avatar: team.avatar } } satisfies TeamWorldView
      }
      case 'team.app.channel': return await this.channel(await post('message-channel/get', { team_id: await teamID() }, true), actor)
      case 'team.app.public-card': {
        const jotmoId = str(p.jotmoId).trim()
        if (!jotmoId || jotmoId.length > 64) throw invalid()
        const raw = await post('public-card/get', {jotmo_id:jotmoId}, true)
        const contact=obj(raw.contact), navigation=obj(raw.navigation)
        if(contact.state==='unavailable')return {name:'',jotmoId,contact:{state:'unavailable'},navigation:{kind:'none'}} satisfies TeamPublicCard
        if(raw.jotmo_id!==jotmoId||!str(raw.name)||!['available','disabled'].includes(str(contact.state))||!['contact','inbox','none'].includes(str(navigation.kind))||contact.state==='available'&&!str(contact.public_ref))throw invalid()
        const teamRef=await this.ref('team',{team_id:str(raw.team_id)},actor)
        const avatar=await this.avatar({...raw,avatar:{...obj(raw.avatar),mode:'default'}},actor)
        if(obj(raw.avatar).mode==='custom')Object.assign(avatar,{mode:'custom',key:`team_avatar_asset://${avatar.key}`,imageRef:await this.ref('profile-image',{jotmo_id:jotmoId,public_card:true,key:obj(raw.avatar).key},actor)})
        return {name:str(raw.name),jotmoId,avatar,description:str(raw.description),
          contact:contact.state==='available'?{state:'available',publicRef:str(contact.public_ref)}:{state:'disabled'},
          navigation:{kind:navigation.kind as 'contact'|'inbox'|'none',...(navigation.kind==='inbox'?{teamRef}:{})}} satisfies TeamPublicCard
      }
      case 'team.app.channel.configure': { const id = await teamID(), channel = await post('message-channel/get', { team_id: id }, true); return await this.channel(await post('message-channel/configure', { team_id: id, expected_revision: num(p.revision), enabled: p.enabled === true, rotate_link: p.rotate === true, avatar_url: str(channel.avatar_url) }), actor) }
      case 'team.app.official': return await this.channel(await post('official-feedback-target', {}, true), actor)
      case 'team.app.official.membership': {
        const [official, mine] = await Promise.all([post('official-feedback-target', {}, true), post('list-mine', {}, true)])
        const officialId = recordOwnerId(official.team_id), jotmoId = str(official.jotmo_id).trim()
        if (!officialId || !jotmoId || !Array.isArray(mine.teams)
          || mine.teams.some(raw => !recordOwnerId(obj(raw).team_id))) throw invalid()
        // Compare provider-owned IDs here, never names or rotating encrypted refs.
        return { jotmoId, isMember: mine.teams.some(raw => String(recordOwnerId(obj(raw).team_id)) === String(officialId)) }
      }
      case 'team.app.group.context': {
        if(!this.contacts?.openSourceRef||!str(p.sourceRef))throw invalid()
        const source=await this.contacts.openSourceRef(str(p.sourceRef),actor)
        if(source.kind!=='group_chat')throw invalid()
        const raw=await this.runtime.authenticatedChatPost<Record<string,unknown>>('/api/v1/chats/group-identity/context',{chat_session_uid:source.ownerRef},session,signal,{lane:'interactive-read',bypassCache:true})
        if(raw.state!=='ready'||raw.membership_policy!=='independent'||!Number.isSafeInteger(raw.group_join_at)||!Array.isArray(raw.teams))throw invalid()
        const codec=new GroupRepresentationCodec(this.runtime)
        const teams=await Promise.all(list(raw.teams).map(async candidate=>{
          const snapshot=await codec.snapshot({...candidate,group_join_at:raw.group_join_at},actor)
          const team=await this.team(candidate,actor)
          if(!snapshot)throw invalid()
          return {...team,representation:{teamRef:snapshot.teamRef,membershipKind:snapshot.membershipKind,membershipRevision:snapshot.membershipRevision,groupJoinAt:snapshot.groupJoinAt}}
        }))
        return {state:'ready',membershipPolicy:'independent',groupJoinAt:num(raw.group_join_at),teams} satisfies TeamGroupContext
      }
      case 'team.app.group.join': case 'team.app.group.directory': {
        // Real team membership is sufficient to offer an identity candidate.
        // Neither the candidate nor its pending write grants teammates group access.
        if (operation !== 'team.app.group.directory') {
          if (!this.contacts?.openSourceRef || !str(p.sourceRef)) throw invalid()
          const source = await this.contacts.openSourceRef(str(p.sourceRef), actor)
          if (source.kind !== 'group_chat') throw invalid()
        }
        if (operation === 'team.app.group.join' && !/^[A-Za-z0-9._:-]{1,128}$/.test(str(p.requestUid))) throw invalid()
        const id = await teamID()
        const mine = list((await post('list-mine', {}, true)).teams)
        if (id !== undefined && !mine.some(team => String(team.team_id) === String(id))) {
          throw new ArkmePluginError('team-not_accessible', reasons.not_accessible!, false, 403)
        }
        return { state: 'backend_pending' } satisfies TeamGroupPending
      }
      case 'team.app.members.add': case 'team.app.members.add-recover': case 'team.app.members.add-retry': case 'team.app.members.add-ack': {
        const teamId = String(await teamID()), scope = `${this.runtime.config.environment}:${actor}`
        const journal = this.runtime.stateStore.teamMemberAddition
        if (!journal) throw new ArkmePluginError('team-member-storage-unavailable', '成员添加恢复存储不可用', true, 503)
        const owner = new TeamMemberAddition({actor, teamId, post,
          open: ref => this.open('member-candidate', ref, actor), key: userId => this.key(`member-candidate:${teamId}:${userId}`, actor),
          journal: change => journal.call(this.runtime.stateStore, scope, teamId, change)})
        if (operation === 'team.app.members.add-recover') return owner.recover()
        if (operation === 'team.app.members.add-retry') return owner.retry()
        if (operation === 'team.app.members.add-ack') return owner.ack(p.requestUid)
        return owner.add(p.requestUid, p.candidateRefs)
      }
      case 'team.app.member-candidates': {
        const id = await teamID()
        if (!this.memberCandidates || !['contacts', 'conversations', 'group'].includes(str(p.source))) throw invalid()
        const source = p.source as TeamMemberCandidateSource, sourceRef = str(p.sourceRef)
        if (source === 'group' && !sourceRef) throw invalid()
        const after = p.cursor ? await this.open('member-candidate-cursor', p.cursor, actor) : undefined
        if (after && (String(after.team_id) !== String(id) || after.source !== source || after.source_ref !== sourceRef)) throw invalid()
        const data = await this.memberCandidates.list(source, {
          ...(sourceRef ? { sourceRef } : {}), ...(after ? { cursor: str(after.cursor) } : {}), ...(signal ? { signal } : {}), ...(p.refresh === true && !after ? { refresh: true } : {}),
        })
        if (data.hasMore && !data.nextCursor) throw invalid()
        const unique = new Map(data.items.map(item => [item.userId, item]))
        const members = new Set<string>(), candidates = [...unique.values()]
        // Only resolve the current candidate page; no full-roster scan.
        for (let offset = 0; offset < candidates.length; offset += 50) {
          const ids = candidates.slice(offset, offset + 50).map(row => {
            if (!Number.isSafeInteger(row.userId) || row.userId <= 0) throw invalid()
            return String(row.userId)
          })
          const state = await post('members/query', {team_id: id, user_ids: ids}, true)
          if (state.can_add_members !== true || !Array.isArray(state.items) || state.items.length !== ids.length) throw invalid()
          const seen = new Set<string>()
          for (const raw of list(state.items)) {
            const key = String(recordOwnerId(raw.user_id))
            if (!ids.includes(key) || seen.has(key) || typeof raw.active !== 'boolean') throw invalid()
            seen.add(key); if (raw.active) members.add(key)
          }
        }
        if (!candidates.length) {
          const state = await post('members/query', {team_id: id, user_ids: [String(actor)]}, true)
          if (state.can_add_members !== true || !Array.isArray(state.items) || state.items.length !== 1) throw invalid()
        }
        const items = await Promise.all([...unique.values()].map(async ({ userId, ...identity }) => {
          if (!Number.isSafeInteger(userId) || userId <= 0) throw invalid()
          return { ...identity, key: await this.key(`member-candidate:${id}:${userId}`, actor),
            candidateRef: await this.ref('member-candidate', { team_id: id, user_id: userId, display_name: identity.displayName, expires: Date.now() + 60 * 60_000 }, actor),
            alreadyMember: members.has(String(userId)), isSelf: userId === actor }
        }))
        return { items, groups: data.groups ?? [], hasMore: data.hasMore,
          ...(data.coverage ? { coverage: data.coverage } : {}),
          ...(data.hasMore ? { nextCursor: await this.ref('member-candidate-cursor', { team_id: id, source, source_ref: sourceRef, cursor: data.nextCursor }, actor) } : {}),
        } satisfies TeamMemberCandidatePage
      }
      case 'team.app.internal-group.prepare': {
        // Preparation only. Never use personal create/add/remove to emulate a
        // roster binding; backend must atomically preview and confirm its delta.
        if (!['create', 'link'].includes(str(p.mode)) || !/^[A-Za-z0-9._:-]{1,128}$/.test(str(p.requestUid))) throw invalid()
        if (p.mode === 'create') {
          if (!str(p.name).trim() || str(p.name).trim().length > 120) throw invalid()
        } else {
          if (!this.contacts?.openSourceRef || !str(p.sourceRef)) throw invalid()
          const source = await this.contacts.openSourceRef(str(p.sourceRef), actor)
          if (source.kind !== 'group_chat') throw invalid()
        }
        const id = await teamID(), mine = list((await post('list-mine', {}, true)).teams)
        if (!mine.some(team => String(team.team_id) === String(id))) {
          throw new ArkmePluginError('team-not_accessible', reasons.not_accessible!, false, 403)
        }
        const currentTeam = mine.find(team => String(team.team_id) === String(id))!
        if (!['owner', 'admin'].includes(role(currentTeam.role))) {
          throw new ArkmePluginError('team-not_accessible', '仅团队所有者或管理员可创建或关联内部群', false, 403)
        }
        return { state: 'backend_pending' } satisfies TeamGroupPending
      }
      case 'team.app.outbound.open': {
        if (!validTeamOutboundRecipient(p.recipient) || !/^[A-Za-z0-9._:-]{1,128}$/.test(str(p.requestUid))) throw invalid()
        const id=await teamID(), mine=list((await post('list-mine',{},true)).teams)
        if(!mine.some(team=>String(team.team_id)===String(id)))throw new ArkmePluginError('team-not_accessible',reasons.not_accessible!,false,403)
        const scope=`${this.runtime.config.environment}:${actor}`, requestUid=str(p.requestUid)
        const selection=createHash('sha256').update(JSON.stringify(p.recipient)).digest('hex')
        const saved=await this.runtime.stateStore.teamOutboundTarget(scope,requestUid)
        if(saved && (saved.teamId!==String(id)||saved.selection!==selection))throw invalid()
        let target=recordOwnerId(saved?.targetId)
        if(!target){
          if(!this.outboundTargets)throw new ArkmePluginError('team-recipient-unavailable','无法解析联系用户，请重新选择',true,503)
          target=recordOwnerId(await this.outboundTargets.resolve(p.recipient,session,signal))
          if(!target || String(target)===String(actor))throw invalid()
          await this.runtime.stateStore.retainTeamOutboundTarget(scope,requestUid,{teamId:String(id),targetId:String(target),selection})
        }
        const data=await post('conversations/open-by-member',{team_id:id,external_user_id:String(target)})
        const current=obj(data.conversation)
        if(current.side!=='team'||String(obj(current.channel).team_id)!==String(id)||String(current.external_user_id)!==String(target))throw invalid()
        return {state:'ready' as const,conversation:await this.conversation(current,actor)}
      }
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
      case 'team.app.source': {
        const data = await post('conversations/context', { conversation_uid: str(p.conversationUid) }, true)
        if (!str(data.conversation_uid) || !['team', 'external'].includes(str(data.side)) || !str(data.team_name)) throw invalid()
        return { name: str(data.team_name), conversationRef: await this.ref('conversation',
          { conversation_uid: str(data.conversation_uid), side: str(data.side) }, actor) }
      }
      case 'team.app.report': {
        const context=await conversation(),m=await message()
        if(m.conversation_uid!==context.conversation_uid||m.side!==context.side||!Number.isSafeInteger(p.version)||num(p.version)<=0||!['spam','harassment','illegal','privacy','other'].includes(str(p.reason)))throw invalid()
        const result=await post('conversations/messages/reports/create',{...context,message_uid:m.message_uid,expected_record_version:p.version,reason:p.reason,description:str(p.description)})
        if(!str(result.report_uid))throw invalid()
        return {reportUid:str(result.report_uid)}
      }
      case 'team.app.copy-link': {
        const selected=await this.resolveMessageSelection(str(p.conversationRef),p.selections,actor)
        const sources=selected.map(source=>({kind:'team_message',team_source:source}))
        const result=obj(await this.runtime.authenticatedChatPost('/api/v1/chats/messages/copy-link/get-or-create',{sources},session,signal))
        if(!str(result.sid)||!/^https?:\/\//u.test(str(result.url)))throw invalid()
        return {sid:str(result.sid),url:str(result.url)}
      }
      case 'team.app.preflight': {
        const context=await conversation()
        const sources=await this.resolveMessageSelection(str(p.conversationRef),p.selections,actor)
        const selected=sources.map(source=>({message_uid:source.message_uid,expected_record_version:source.expected_record_version}))
        const data=await post('conversations/messages/batch-get',{...context,items:selected},true),rows=list(data.messages)
        if(rows.length!==selected.length||rows.some((row,index)=>row.message_uid!==selected[index]!.message_uid||obj(row.record).version!==selected[index]!.expected_record_version||obj(row.record).status!=='available'))throw invalid()
        return await Promise.all(rows.map(row=>this.message(row,actor,context)))
      }
      case 'team.app.mark.capabilities': {const context=await conversation();if(!['team','conversation'].includes(str(p.audience))||p.audience==='team'&&context.side!=='team')throw invalid();return {supported:true,maxLength:2000,storage:'cloud',maxBatchSize:4}}
      case 'team.app.mark.list':
      case 'team.app.mark.change': {
        const context=await conversation(),audience=p.audience
        if(!['team','conversation'].includes(str(audience))||audience==='team'&&context.side!=='team')throw invalid()
        const refs=operation==='team.app.mark.list'?p.markRefs:[p.markRef]
        if(!Array.isArray(refs)||!refs.length||refs.length>4)throw invalid()
        const targets=await Promise.all(refs.map(ref=>this.open('message',ref,actor)))
        if(targets.some(target=>target.conversation_uid!==context.conversation_uid||target.side!==context.side||!str(target.message_uid)))throw invalid()
        if(operation==='team.app.mark.list'){
          const messageUIDs=[...new Set(targets.map(target=>target.message_uid))]
          const data=await post('conversations/messages/annotations/batch-query',{...context,audience,message_uids:messageUIDs},true)
          const rows=list(data.items)
          if(rows.length!==messageUIDs.length)throw invalid()
          return targets.map((target,index)=>{const row=rows.find(row=>row.message_uid===target.message_uid&&row.audience===audience);if(!row)throw invalid();return {actionRef:refs[index],snapshot:readTeamUnderlineSnapshot(row)}})
        }
        const change=obj(p.change),kind=change.kind
        if(kind!=='add'&&kind!=='remove')throw invalid()
        const anchor=kind==='add'?readMessageQuote(change.anchor):undefined
        if(kind==='add'&&(!anchor||!str(change.operationId))||kind==='remove'&&!underlineId(change.annotationId))throw invalid()
        const data=await post('conversations/messages/annotations/change',{...context,audience,message_uid:targets[0]!.message_uid,action:kind,...(anchor?{operation_uid:change.operationId,anchor}:{annotation_uid:change.annotationId})})
        return readTeamUnderlineSnapshot(data)
      }
      case 'team.app.extensions': {
        const context=await conversation(),target=await this.open('message',p.messageRef,actor)
        if(target.conversation_uid!==context.conversation_uid||target.side!==context.side)throw invalid()
        const data=await post('conversations/messages/extensions',{...context,message_uid:target.message_uid,after_seq:num(p.afterSeq),through_seq:num(p.throughSeq),limit:num(p.limit)||30},true)
        return {message:await this.message(data.message,actor,context),items:await Promise.all(list(data.items).map(row=>this.message(row,actor,context))),
          totalCount:num(data.total_count),hasMore:data.has_more===true,nextSeq:num(data.next_seq),throughSeq:num(data.through_seq)} satisfies import('../team-app-contract.js').TeamExtensionPage
      }
      case 'team.app.locate':
      case 'team.app.timeline': {
        const context = await conversation()
        const target = operation === 'team.app.locate' ? await this.open('message', p.messageRef, actor) : undefined
        if (target && (target.conversation_uid !== context.conversation_uid || target.side !== context.side)) throw invalid()
        const data = await post(operation === 'team.app.locate' ? 'conversations/timeline/locate' : 'conversations/timeline/page', { ...context, ...(target ? {message_uid:target.message_uid} : {before_seq:num(p.beforeSeq)}), limit:Math.max(1,Math.min(100,num(p.limit)||50)) }, true)
        let rows = list(data.messages)
        if (p.personRef !== undefined) {
          const person = await this.open('person',p.personRef,actor)
          if (context.side !== 'team' || person.side !== 'team' || person.conversation_uid !== context.conversation_uid || !['owner','mentioned'].includes(str(p.personMode))) throw invalid()
          rows = rows.filter(row => row.state === 'published' && obj(row.record).status === 'available' && (p.personMode === 'owner'
            ? String(row.actor_user_id) === String(person.user_id)
            : list(obj(obj(obj(row.record).content_payload).mention_metadata).human_mentions).some(m => String(m.user_id) === String(person.user_id))))
        }
        const current = await this.conversation(data.conversation, actor)
        const external = list(data.messages).find(v => v.side === 'external')
        if (current.side === 'team' && current.visitor && !current.visitor.personKey && external) {
          current.visitor = await this.identity(obj(data.conversation).visitor, actor, { id: external.actor_user_id, context })
        }
        return { conversation: current, messages: await Promise.all(rows.map(v => this.message(v, actor, context))),
          hasMore: data.has_more === true, beforeSeq: num(data.before_seq) } satisfies TeamTimeline
      }
      case 'team.app.person.private.open':
      case 'team.app.people.remarks': {
        const context = await conversation()
        if (context.side !== 'team') throw invalid()
        const refs = operation === 'team.app.person.private.open' ? [p.personRef] : p.personRefs
        if (!Array.isArray(refs) || !refs.length || refs.length > 50) throw invalid()
        const people = await Promise.all(refs.map(async ref => {
          const person = await this.open('person', ref, actor), id = recordOwnerId(person.user_id)
          if (person.conversation_uid !== context.conversation_uid || person.side !== 'team'
            || !id) throw invalid()
          return id
        }))
        const data = await post('conversations/timeline/page', { ...context, before_seq: 0, limit: 1 }, true)
        if (obj(data.conversation).conversation_uid !== context.conversation_uid || obj(data.conversation).side !== 'team') throw invalid()
        if (operation === 'team.app.person.private.open') {
          if (!this.privateChat || String(people[0]) === String(actor)) throw invalid()
          return await this.privateChat.openPrivateChatFromUser(people[0]!, { expectedViewerUserId: actor, ...(signal ? { signal } : {}) })
        }
        if (!this.contacts) throw new ArkmePluginError('team-remarks-unavailable', '备注暂时无法读取', true, 503)
        const remarks = await this.contacts.privateRemarksByUserIds(people, signal ? { signal } : {})
        return { items: await Promise.all([...new Set(people)].map(async id => ({ personKey: await this.key(`person:${id}`, actor), remark: remarks.get(id) ?? '' }))) }
      }
      case 'team.app.visitor.private.open': {
        const context = await conversation()
        if (context.side !== 'team') throw invalid()
        // Resolve from a fresh authorized conversation, never a client-supplied name/id.
        const data = await post('conversations/timeline/page', { ...context, before_seq: 0, limit: 1 }, true)
        const current = obj(data.conversation)
        const peer = recordOwnerId(current.external_user_id)
        if (current.conversation_uid !== context.conversation_uid || current.side !== 'team') throw invalid()
        if (!peer || String(peer) === String(actor) || !this.privateChat || (typeof peer === 'string' && obj(current.visitor).kind !== 'person') || (obj(current.visitor).kind !== undefined && obj(current.visitor).kind !== 'person') || obj(current.visitor).account_state === 'cancelled') {
          throw new ArkmePluginError('team-visitor-identity-unavailable', '暂时无法确认外部用户的私聊账号，请稍后重试', true, 409)
        }
        return await this.privateChat.openPrivateChatFromUser(peer, {
          presentationDisplayName: str(obj(current.visitor).nickname), expectedViewerUserId: actor,
          ...(signal ? { signal } : {}),
        })
      }
      case 'team.app.send': {
        const context = await conversation()
        const reply = p.replyToRef ? await this.open('message',p.replyToRef,actor) : undefined
        if (reply && (reply.conversation_uid !== context.conversation_uid || reply.side !== context.side)) throw invalid()
        const quote = p.quote === undefined ? undefined : readMessageQuote(p.quote)
        if (p.quote !== undefined && (!quote || !reply || quote.recordVersion !== num(p.replyRecordVersion))) throw invalid()
        try {
          const data = await post('conversations/messages/send', { ...context, client_message_uid: str(p.clientUid), expected_reply_seq: num(p.expectedReplySeq), content: await this.mentionContent(p.content,actor,context),
            ...(p.metadataRef ? {record_metadata:await this.frozenMetadata(p.metadataRef,actor,context,str(p.clientUid),'send')} : {}),
            ...(reply ? {reply_to:reply.message_uid,...(num(p.replyRecordVersion)>0 ? {reply_record_version:num(p.replyRecordVersion)} : {}),...(quote ? {quote} : {})} : {}) })
          requireFrozenMetadataSaved(data, !!p.metadataRef)
          return { message: await this.message(data, actor, context) }
        } catch (error) {
          if (!(error instanceof ArkmeUpstreamResponseError)) throw error
          const data = obj(error.responseData), pending = obj(data.operation)
          if (!pending.message_uid) throw error
          requireFrozenMetadataSaved(pending, !!p.metadataRef)
          return { reason: str(data.reason), message: await this.message(pending, actor, context) }
        }
      }
      case 'team.app.send.status': {
        const m = await message()
        const data = await post('conversations/messages/send-status', { message_uid: m.message_uid, side: m.side })
        return { message: await this.message(data, actor, m) }
      }
      case 'team.app.edit': {
        const m = await this.open('message', p.messageRef, actor), explicitMentions = obj(p.content).mentions !== undefined, content = await this.mentionContent(p.content,actor,m), payload = {...obj(content.content_payload)}
        if (p.conversationRef) {const context=await conversation();if(context.conversation_uid!==m.conversation_uid||context.side!==m.side)throw invalid()}
        if (m.has_mentions === true && !explicitMentions) {
          const data = await post('conversations/messages/batch-get', {conversation_uid:m.conversation_uid,side:m.side,items:[{message_uid:m.message_uid,expected_record_version:num(p.version)}]}, true)
          const rows = list(data.messages), row = rows[0], original = obj(row?.record)
          if (rows.length !== 1 || row?.message_uid !== m.message_uid || original.version !== num(p.version) || original.status !== 'available') throw invalid()
          const mentions = await retainedRecordMentionMetadata(obj(original.content_payload), str(original.text_content), str(content.text_content))
          if (mentions) payload.mention_metadata = mentions
          if (Object.keys(payload).length) content.content_payload = {...payload, payload_kind:payload.payload_kind ?? 1, schema_version:1, text_state:1}
        }
        return await post('conversations/messages/update', {message_uid:m.message_uid,side:m.side,expected_record_version:num(p.version),content,
          ...(p.metadataRef ? await this.frozenMetadata(p.metadataRef,actor,m,str(p.revisionUid),'edit',m.message_uid) : p.revisionUid ? {revision_uid:str(p.revisionUid)} : {})})
      }
      case 'team.app.cancel': {
        if (p.conversationRef !== undefined) {
          const context = await conversation()
          const data = await post('conversations/messages/cancel', { ...context, client_message_uid: str(p.clientUid) })
          return { message: await this.message(data, actor, context) }
        }
        const m = await message()
        return await post('conversations/messages/cancel', { message_uid: m.message_uid, side: m.side })
      }
      case 'team.app.recall': {
        const context=await conversation(), m=await message()
        if (m.conversation_uid!==context.conversation_uid || m.side!==context.side) throw invalid()
        try {
          const data=await post('conversations/messages/recall',{...context,message_uid:m.message_uid})
          return {message:await this.message(data.message,actor,context),changed:data.changed===true}
        } catch (error) {
          signal?.throwIfAborted()
          const current=await post('conversations/messages/send-status',{message_uid:m.message_uid,side:m.side})
          if (current.state !== 'recalled') throw error
          return {message:await this.message(current,actor,context),changed:false}
        }
      }
      case 'team.app.delete': { const m = await message(); return await post('conversations/messages/delete', { message_uid: m.message_uid, side: m.side, expected_record_version: num(p.version) }) }
      case 'team.app.notification-policy.get': {
        const context=await conversation()
        return this.policy(await post('conversations/notification-policy/get',context,true),actor,str(context.conversation_uid),true)
      }
      case 'team.app.notification-policy.set': {
        if (typeof p.muted !== 'boolean') throw invalid()
        const context = await conversation()
        try { return this.policy(await post('conversations/notification-policy/set', {...context, muted:p.muted}),actor,str(context.conversation_uid),true) }
        catch (error) {
          const current = this.policy(await post('conversations/notification-policy/get', context, true),actor,str(context.conversation_uid),true)
          if (current.muted !== p.muted) throw error
          return current
        }
      }
      case 'team.app.notification.open': {
        const target = await this.open('notification', p.notificationRef, actor)
        const current = await post('conversations/context', {conversation_uid:target.conversation_uid}, true)
        if (str(current.conversation_uid) !== target.conversation_uid || !['team','external'].includes(str(current.side))) throw invalid()
        const data = await post('conversations/timeline/page', {conversation_uid:target.conversation_uid,side:current.side,limit:1}, true)
        return await this.conversation(data.conversation, actor)
      }
      case 'team.app.home.visibility': {
        const data = await post('conversations/home-visibility', { ...await conversation(), expected_version: num(p.version), ...(typeof p.showInHome === 'boolean' ? {show_in_home:p.showInHome} : {}) })
        if (typeof data.show_in_home !== 'boolean' || !Number.isSafeInteger(data.version) || num(data.version) < 0) throw invalid()
        return {showInHome:data.show_in_home,version:num(data.version)}
      }
      case 'team.app.read': return await post('conversations/read/advance', { ...await conversation(), read_seq: num(p.readSeq) })
      case 'team.app.read-states': {
        if (!Array.isArray(p.conversationRefs) || !p.conversationRefs.length || p.conversationRefs.length > 100) throw invalid()
        const contexts = await Promise.all(p.conversationRefs.map(ref => this.open('conversation', ref, actor)))
        const first = contexts[0]!, ids = contexts.map(v => str(v.conversation_uid))
        if (new Set(ids).size !== ids.length || contexts.some(v => v.side !== first.side)) throw invalid()
        const data = await post('conversations/read-state/query-list', {side: first.side, conversation_uids: ids}, true)
        const rows = list(data.items), byId = new Map(rows.map(v => [str(v.conversation_uid), v]))
        if (!Array.isArray(data.items) || rows.length !== ids.length || byId.size !== ids.length) throw invalid()
        return await Promise.all(ids.map(async id => {
          const row = byId.get(id)
          if (!row || typeof row.accessible !== 'boolean') throw invalid()
          const key = await this.key(`${id}:${str(first.side)}`, actor)
          if (!row.accessible) return {key, accessible: false}
          if (['last_seq', 'my_read_seq', 'unread'].some(k => !Number.isSafeInteger(row[k]) || Number(row[k]) < 0)) throw invalid()
          return {key, accessible: true, notificationPolicy:this.policy(row.notification_policy,actor,id), lastSeq: num(row.last_seq), myReadSeq: num(row.my_read_seq), unread: num(row.unread)}
        }))
      }
      case 'team.app.receipt-summaries': {
        if (!Array.isArray(p.messageRefs) || !p.messageRefs.length || p.messageRefs.length > 50) throw invalid()
        const contexts = await Promise.all(p.messageRefs.map(ref => this.open('message', ref, actor)))
        const first = contexts[0]!, ids = contexts.map(v => str(v.message_uid))
        if (new Set(ids).size !== ids.length || contexts.some(v => v.conversation_uid !== first.conversation_uid || v.side !== first.side)) throw invalid()
        const data = await post('conversations/read-receipts/summary-list', { conversation_uid: first.conversation_uid, side: first.side, message_uids: ids }, true)
        const rows = list(data.items), byId = new Map(rows.map(v => [str(v.message_uid), v]))
        if (!Array.isArray(data.items) || rows.length !== ids.length || byId.size !== ids.length || !Number.isSafeInteger(data.last_seq) || num(data.last_seq) < 0 || !Number.isSafeInteger(data.my_read_seq) || num(data.my_read_seq) < 0 || !Number.isSafeInteger(data.unread) || num(data.unread) < 0) throw invalid()
        return { items: await Promise.all(ids.map(async id => {
          const row = byId.get(id)
          if (!row) throw invalid()
          if (row.unavailable_reason === 'message_recalled') return {key:await this.key(id,actor),unavailableReason:'message_recalled'}
          if (typeof row.team_read !== 'boolean') throw invalid()
          return { key: await this.key(id, actor), teamRead: row.team_read,
            ...(first.side === 'team' ? { summary: receiptCounts(row.summary), ...(typeof row.visitor_read === 'boolean' ? {visitorRead: row.visitor_read} : {}) } : {}) }
        })), lastSeq: num(data.last_seq), myReadSeq: num(data.my_read_seq), unread: num(data.unread) }
      }
      case 'team.app.receipts': {
        const context = await this.open('message', p.messageRef, actor)
        const cursor = p.cursor ? await this.open('receipt-cursor', p.cursor, actor) : {}
        if (p.cursor && cursor.message_uid !== context.message_uid) throw invalid()
        const data = await post('conversations/read-receipts/query', { conversation_uid: context.conversation_uid,
          message_uid: context.message_uid, side: context.side, cursor: str(cursor.cursor), limit: 50 }, true)
        const internal = context.side === 'team', senderId = recordOwnerId(context.sender_user_id)
        if (internal && (!Array.isArray(data.members) || typeof data.has_more !== 'boolean'
          || (data.has_more && (!str(data.next_cursor) || data.next_cursor === cursor.cursor)))) throw new ArkmePluginError('team-receipts-incomplete', '阅读状态返回不完整，请重试', true, 502)
        const rows = internal ? list(data.members) : []
        const seen = new Set<string>()
        const members = []
        for (const v of rows) {
          const id = recordOwnerId(v.user_id)
          if (id && (String(id) === String(senderId) || seen.has(String(id)))) continue
          if (id) seen.add(String(id))
          members.push({ ...await this.identity(v.identity, actor, { id, context }),
            ...(id ? { key: await this.key(`receipt-member:${id}`, actor), isMe: String(id) === String(actor) } : {}),
            ...(typeof v.read === 'boolean' ? { read: v.read } : {}),
            ...(num(v.read_at) > 0 ? { readAt: num(v.read_at) } : {}) })
        }
        return { ...(typeof data.team_read === 'boolean' ? { teamRead: data.team_read } : {}),
          ...(internal && typeof data.visitor_read === 'boolean' ? { visitorRead: data.visitor_read } : {}),
          ...(internal && data.summary !== undefined ? {summary: receiptCounts(data.summary)} : {}),
          senderExcluded: context.message_side === 'external' || !!senderId,
          ...(internal ? { hasMore: data.has_more } : { hasMore: false }),
          ...(internal && data.next_cursor ? { nextCursor: await this.ref('receipt-cursor', { message_uid: context.message_uid, cursor: data.next_cursor }, actor) } : {}), members }
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
  async fetchMedia(mediaRef: string, range: string | undefined, signal: AbortSignal): Promise<{ response: Response; fileName: string; mimeType: string;size:number }> {
    const initial = await this.runtime.requireSession()
    const ref = await this.open('media', mediaRef, initial.userId)
    if (ref.share_uid) {
      const data = obj(await this.runtime.authenticatedTeamPost('/api/v1/team/external-chats/page', { share_uid: ref.share_uid, before_seq: num(ref.seq) + 1, limit: 1 }, initial, signal, true))
      const item = list(data.items).find(v => num(obj(v.relation).seq) === num(ref.seq))
      const record = obj(obj(item).record)
      const asset = num(record.status) === 1 && num(obj(record.payload).version) === num(ref.record_version)
        ? sharedAttachmentAt(obj(record.payload), ref.media_path) : undefined
      if (!asset || str(asset.file_asset_uid) !== str(ref.file_asset_uid) || str(asset.file_uid) !== str(ref.file_uid)) throw invalid()
      const url = str(asset?.download_url) || str(asset?.preview_url)
      if (!url) throw invalid()
      const response = await this.runtime.fetchImpl(authorizedStorageURL(url), { signal, redirect: 'error', ...(range ? { headers: { Range: range } } : {}) })
      const current = await this.runtime.accountScopedSession()
      if (!response.ok || !current || current.userId !== initial.userId || current.refreshToken !== initial.refreshToken) { await response.body?.cancel(); throw invalid() }
      return { response, fileName: str(ref.file_name) || '附件', mimeType: str(ref.mime_type) || 'application/octet-stream', size: num(asset.size) }
    }
    const body = { message_uid: ref.message_uid, side: ref.side, file_asset_uid: ref.file_asset_uid, record_version: ref.record_version, preview: false, ...(ref.private_snapshot === true ? {private_snapshot:true} : {}) }
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
    if (response.headers.get('content-type')?.includes('application/json')) {
      const failure=obj(await response.json())
      if(obj(failure.data).reason==='message_recalled') throw new ArkmePluginError('team-message_recalled','消息已撤回',false,409)
      throw new ArkmePluginError('team-not_accessible','附件已失效或无权访问，请刷新消息',false,403)
    }
    if (!response.ok) {await response.body?.cancel();throw new ArkmePluginError('team-not_accessible','附件已失效或无权访问，请刷新消息',false,403)}
    return { response, fileName: str(ref.file_name) || 'attachment', mimeType: str(ref.mime_type) || 'application/octet-stream',size:num(ref.size) }
  }
  private async image(p: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<unknown> {
    if(str(p.imageRef).startsWith('team-app-profile-image.')){
      const ref=await this.open('profile-image',p.imageRef,session.userId)
      const result=obj(await this.runtime.authenticatedTeamPost(
        ref.public_card ? '/api/v1/team/public-card/get' : ref.jotmo_id ? '/api/v1/team/discovery/search' : ref.public_ref?'/api/public/v1/team/message-channel/resolve':'/api/v1/team/profile/get',
        ref.jotmo_id ? {jotmo_id:ref.jotmo_id} : ref.public_ref?{public_ref:ref.public_ref}:{team_id:ref.team_id},session,signal,true))
      const avatar=obj((ref.public_card||ref.public_ref?result:obj(result.team)).avatar)
      if(avatar.mode!=='custom'||str(avatar.key)!==str(ref.key))throw invalid()
      const cacheKey=`team_avatar_asset://${await this.key(`avatar:${str(ref.key)}`,session.userId)}`
      const cached=await this.runtime.stateStore.readAvatarCache?.(session.userId,cacheKey).catch(()=>undefined)
      if(cached)return {base64:Buffer.from(cached.data).toString('base64'),mimeType:cached.mediaType}
      const response=await this.runtime.fetchImpl(authorizedStorageURL(str(avatar.url)),{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15_000),...(signal?[signal]:[])])})
      const mimeType=response.headers.get('content-type')?.split(';')[0]??''
      if(!response.ok||!['image/png','image/jpeg'].includes(mimeType)){await response.body?.cancel();throw invalid()}
      const bytes=await this.readBytes(response,2*1024*1024)
      const current=await this.runtime.accountScopedSession();if(!current||current.userId!==session.userId||current.refreshToken!==session.refreshToken)throw invalid()
      await this.runtime.stateStore.writeAvatarCache?.(session.userId,cacheKey,{data:Uint8Array.from(bytes),bytes:bytes.length,mediaType:mimeType as 'image/png'|'image/jpeg'}).catch(()=>undefined)
      return {base64:bytes.toString('base64'),mimeType}
    }
    const ref = await this.open('image', p.imageRef, session.userId), url = new URL(str(ref.url))
    const hosts = this.runtime.config.environment === 'prod' ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc'] : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw invalid()
    const response = await this.runtime.fetchImpl(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) { await response.body?.cancel(); throw invalid() }
    return { base64: (await this.readBytes(response, 5 * 1024 * 1024)).toString('base64'), mimeType }
  }
}
