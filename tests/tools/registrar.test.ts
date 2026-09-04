import { recordToolResults, sessionEvents } from '../helpers/tool-session.js'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeToolPorts } from '../../src/tools/index.js'
import type { ArkmeToolProfile } from '../../src/tools/index.js'
import type { PreparedRecordingDirectory } from '../../src/recording-directory-import.js'
import { preparedDirectory, directoryResult } from '../helpers/recording-directory.js'
import { promptForArkmeToolProfile, registerArkmeTools } from '../../src/tools/index.js'

const ports = {
  backgroundSoundPreference: async () => ({ userId: 42, found: true, enabled: true }),
  providerCapabilities: () => ({
    contractVersion: 1,
    provider: '@senguoyun/dsh-arkme',
    sdk: '@senguoyun/dsh-arkme/sdk',
    environment: 'test',
    features: {
      authStatus: true, cachedSnapshot: true, remoteRefresh: true, search: true,
      createText: true, retryOutbox: true, revisionPolling: true, userProfile: true,
      imageRead: true, sourceDirectory: true, sourceTimeline: true, sourceTextSend: true,
    },
    limits: { maxTextLength: 20_000, maxSearchResults: 30, maxSyncPages: 20, maxImageBytes: 2_097_152 },
  }),
} as unknown as ArkmeToolPorts

const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 2048,
  maxImagePixels: 1024,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

class RecordingAttachmentStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    })
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('not used')
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
    recordToolResults(ctx)
  return ctx
}

async function mountArkmeTools(
  ctx: Context,
  profile: ArkmeToolProfile,
  runtimePorts: ArkmeToolPorts = ports,
) {
  return await ctx.plugin(Object.assign(
    (toolCtx: Context) => { registerArkmeTools(toolCtx, runtimePorts, profile) },
    { inject: ['tools', 'systemPrompt'] },
  ))
}

describe('registerArkmeTools', () => {
  it('registers the core business surface and matching prompt', async () => {
    const ctx = await setup()
    await mountArkmeTools(ctx, 'business')

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'arkme_plugin_contract',
      'arkme_records_recent',
      'arkme_user_profile',
      'arkme_background_sound_status',
      'arkme_background_sound_disable',
      'arkme_id_set',
      'arkme_contact_search',
      'arkme_contact_add',
      'arkme_contact_private_chat_open',
      'arkme_group_create',
      'arkme_group_rename',
      'arkme_arko_profile',
      'arkme_arko_session',
      'arkme_arko_ask',
      'arkme_arko_run_status',
      'arkme_arko_cancel',
      'arkme_records_search',
      'arkme_record_calendar_days',
      'arkme_record_calendar_read',
      'arkme_images_list',
      'arkme_record_create',
      'arkme_record_reedit',
      'arkme_bots_list',
      'arkme_bot_create',
      'arkme_bot_openclaw_connect',
      'arkme_bot_chat_open',
      'arkme_group_bots_list',
      'arkme_group_bot_add',
      'arkme_group_bot_remove',
      'arkme_world_recent',
      'arkme_world_mine',
      'arkme_world_user',
      'arkme_world_voiceprint_social_context',
      'arkme_world_voiceprint_invite',
      'arkme_world_private_chat_open',
      'arkme_voiceprint_status',
      'arkme_voiceprint_grants',
      'arkme_voiceprint_recognized_people',
      'arkme_voiceprint_recognized_person_invite',
      'arkme_voiceprint_invite',
      'arkme_voiceprint_revoke',
      'arkme_voiceprint_restore_playback',
      'arkme_world_publish_text',
      'arkme_extension_reviews_read',
      'arkme_extension_review_create',
      'arkme_recording_days_list',
      'arkme_recording_read',
      'arkme_recording_import',
      'arkme_recording_import_folder',
      'arkme_wechat_conversations',
      'arkme_wechat_messages',
      'arkme_wechat_conversation_detail',
      'arkme_wechat_group_members',
      'arkme_wechat_phones',
      'arkme_wechat_common_groups',
      'arkme_wechat_money_flows',
      'arkme_wechat_locations',
      'arkme_sources_list',
      'arkme_unread_conversations',
      'arkme_group_member_candidates',
      'arkme_group_member_add',
      'arkme_group_member_remove',
      'arkme_group_join_restrictions',
      'arkme_group_join_restriction_set',
      'arkme_source_read',
      'arkme_copy_link_extend',
      'arkme_source_members',
      'arkme_source_member_records',
      'arkme_message_read_statuses',
      'arkme_message_read_members',
      'arkme_conversation_mark_read',
      'arkme_message_report',
      'arkme_message_withdraw',
      'arkme_related_recordings_read',
      'arkme_user_ban_status',
      'arkme_user_ban',
      'arkme_user_unban',
      'arkme_group_ai_polish_manage',
      'arkme_favorite_stickers_list',
      'arkme_favorite_sticker_add',
      'arkme_favorite_sticker_send',
      'arkme_favorite_sticker_manage',
      'arkme_call_history',
      'arkme_call_detail',
      'arkme_call_summary_retry',
      'arkme_text_send',
      'arkme_direct_text_send',
      'arkme_call_start',
      'arkme_ai_video',
      'arkme_text_ai_video',
      'arkme_files_list', 'arkme_files_search', 'arkme_file_prepare', 'arkme_files_send', 'arkme_file_task', 'arkme_file_receive',
    ])
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'tool:arkme')?.text)
      .toBe(promptForArkmeToolProfile('business', { attachments: false }))
    const confirmationPrompt = assembly.sections
      .find(section => section.name === 'tool:arkme-conversational-confirmation')?.text
    expect(confirmationPrompt).toContain('any language or wording')
    expect(confirmationPrompt).toContain('never require a fixed phrase')
  })

  it('keeps atomic and disabled profiles free of inherited business tools and guidance', async () => {
    const atomic = await setup()
    await mountArkmeTools(atomic, 'atomic')
    expect(atomic.tools.schemas().map(schema => schema.name)).toEqual(['arkme_plugin_contract'])
    expect((await atomic.systemPrompt.assemble()).sections.some(section => section.name === 'tool:arkme')).toBe(false)
    expect((await atomic.systemPrompt.assemble()).sections.some(
      section => section.name === 'tool:arkme-conversational-confirmation',
    )).toBe(false)

    const disabled = await setup()
    await mountArkmeTools(disabled, 'disabled')
    expect(disabled.tools.schemas()).toEqual([])
    expect((await disabled.systemPrompt.assemble()).sections.some(section => section.name === 'tool:arkme')).toBe(false)
    expect((await disabled.systemPrompt.assemble()).sections.some(
      section => section.name === 'tool:arkme-conversational-confirmation',
    )).toBe(false)
  })

  it('requires a later direct confirmation before sending a World voiceprint invite', async () => {
    const ctx = await setup()
    const inviteWorldVoiceprint = vi.fn(async () => ({
      sent: true as const,
      peerDisplayName: '小林',
      messageItemUid: 'message-1',
      expiresAtMillis: 1_900_000_000_000,
    }))
    await mountArkmeTools(ctx, 'business', {
      ...ports,
      inviteWorldVoiceprint,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '提醒这条动态的作者开启声纹' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_world_voiceprint_invite', arguments: '{}' } },
    ])
    const agent = {
      id: SessionId('session-world-voiceprint-invite'),
      session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = { record_ref: 'arkme-world-record-v1.opaque' }

    const prepared = await ctx.tools.execute({
      callId: CallId('prepare'), name: 'arkme_world_voiceprint_invite', arguments: args, agent, signal,
    })
    expect(prepared.isError).toBe(false)
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(inviteWorldVoiceprint).not.toHaveBeenCalled()

    events.push(
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 4, type: 'turn/start', data: { turn: 2 } },
      { seq: 5, type: 'user/message', data: { content: [{ type: 'text', text: '确认，就提醒他吧' }], source: { kind: 'user' } } },
    )
    const confirmed = await ctx.tools.execute({
      callId: CallId('confirmed'), name: 'arkme_world_voiceprint_invite', arguments: args, agent, signal,
    })
    expect(confirmed.isError).toBe(false)
    expect(inviteWorldVoiceprint).toHaveBeenCalledWith('arkme-world-record-v1.opaque', signal)
  })

  it('requires a later direct confirmation for a targeted recognized-person invitation', async () => {
    const ctx = await setup()
    const createRecognizedPersonVoiceprintInvitation = vi.fn(async () => ({
      inviteUrl: 'https://example.test/v#t=target', expiresAtMillis: 1_900_000_000_000,
    }))
    await mountArkmeTools(ctx, 'business', {
      ...ports, createRecognizedPersonVoiceprintInvitation,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '邀请小林认领这个声音并授权' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_voiceprint_recognized_person_invite', arguments: '{}' } },
    ])
    const agent = {
      id: SessionId('session-recognized-person-invite'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = {
      person_ref: 'arkme-voiceprint-person-v1.opaque', target_contact_ref: 'arkme-contact-v1.opaque',
    }

    const prepared = await ctx.tools.execute({
      callId: CallId('prepare'), name: 'arkme_voiceprint_recognized_person_invite', arguments: args, agent, signal,
    })
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(prepared.isError ? '' : prepared.value).toContain('刚才搜索到的 Arkme 用户')
    expect(createRecognizedPersonVoiceprintInvitation).not.toHaveBeenCalled()

    events.push(
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 4, type: 'turn/start', data: { turn: 2 } },
      { seq: 5, type: 'user/message', data: { content: [{ type: 'text', text: '确认，生成专属邀请' }], source: { kind: 'user' } } },
    )
    await ctx.tools.execute({
      callId: CallId('confirmed'), name: 'arkme_voiceprint_recognized_person_invite', arguments: args, agent, signal,
    })
    expect(createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.opaque', 'arkme-contact-v1.opaque', { signal },
    )
  })

  it('confirms a bound recognized-person invitation without inventing a contact target', async () => {
    const ctx = await setup()
    const createRecognizedPersonVoiceprintInvitation = vi.fn(async () => ({
      inviteUrl: 'https://example.test/v#t=bound', expiresAtMillis: 1_900_000_000_000,
    }))
    await mountArkmeTools(ctx, 'business', {
      ...ports, createRecognizedPersonVoiceprintInvitation,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '给这个已绑定的人生成邀请' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_voiceprint_recognized_person_invite', arguments: '{}' } },
    ])
    const agent = {
      id: SessionId('session-bound-person-invite'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = { person_ref: 'arkme-voiceprint-person-v1.bound' }

    const prepared = await ctx.tools.execute({
      callId: CallId('prepare'), name: 'arkme_voiceprint_recognized_person_invite', arguments: args, agent, signal,
    })
    expect(prepared.isError ? '' : prepared.value).toContain('当前绑定用户')
    events.push(
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 4, type: 'turn/start', data: { turn: 2 } },
      { seq: 5, type: 'user/message', data: { content: [{ type: 'text', text: '确认生成' }], source: { kind: 'user' } } },
    )
    await ctx.tools.execute({
      callId: CallId('confirmed'), name: 'arkme_voiceprint_recognized_person_invite', arguments: args, agent, signal,
    })
    expect(createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.bound', undefined, { signal },
    )
  })

  it.each([
    {
      name: 'arkme_background_sound_disable', args: {}, prompt: '关闭当前 Arkme 账号的文字背景音', port: 'updateBackgroundSoundPreference',
    },
    {
      name: 'arkme_voiceprint_invite', args: {}, prompt: '24 小时有效', port: 'createVoiceprintInvitation',
    },
    {
      name: 'arkme_voiceprint_revoke', args: { grant_ref: 'arkme-voiceprint-grant-v1.opaque' },
      prompt: '不会删除已有识别数据', port: 'revokeVoiceprintPlaybackGrant',
    },
    {
      name: 'arkme_voiceprint_restore_playback', args: {}, prompt: '留底参考音频', port: 'restoreVoiceprintPlayback',
    },
  ] as const)('keeps $name behind the later-confirmation boundary', async ({ name, args, prompt, port }) => {
    const ctx = await setup()
    const write = vi.fn(async () => ({ ok: true }))
    await mountArkmeTools(ctx, 'business', { ...ports, [port]: write } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '执行这项声纹操作' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name, arguments: '{}' } },
    ])
    const agent = {
      id: SessionId(`session-${name}`), session: { get events() { return events } },
    } as unknown as Agent

    const prepared = await ctx.tools.execute({
      callId: CallId('prepare'), name, arguments: args, agent, signal: new AbortController().signal,
    })

    expect(prepared.isError).toBe(false)
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(prepared.isError ? '' : prepared.value).toContain(prompt)
    expect(write).not.toHaveBeenCalled()
  })

  it('reads a private-chat ban state without exposing bound identifiers', async () => {
    const ctx = await setup()
    const userBanStatus = vi.fn(async () => ({
      sourceRef: 'arkme-source-v1.account-bound', targetUserId: 91, displayName: '小林',
      exists: true, banned: true,
      record: {
        sourceRef: 'arkme-source-v1.account-bound', targetUserId: 91, displayName: '小林',
        status: 'banned' as const, operatorUserId: 42, remark: '违规操作',
        bannedAtMillis: 1_900_000_000_000, unbannedAtMillis: 0, updatedAtMillis: 1_900_000_000_000,
      },
    }))
    await mountArkmeTools(ctx, 'business', { ...ports, userBanStatus } as unknown as ArkmeToolPorts)
    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: CallId('user-ban-status'), name: 'arkme_user_ban_status',
      arguments: { source_ref: 'arkme-source-v1.account-bound' }, signal,
    })

    expect(result.isError).toBe(false)
    expect(result.isError ? '' : result.value).toContain('小林')
    expect(result.isError ? '' : result.value).toContain('banned')
    expect(result.isError ? '' : result.value).not.toContain('arkme-source-v1.account-bound')
    expect(result.isError ? '' : result.value).not.toContain('91')
    expect(userBanStatus).toHaveBeenCalledWith('arkme-source-v1.account-bound', signal)
  })

  it('persists a record re-edit draft before confirmation and commits only after a later user message', async () => {
    const ctx = await setup()
    const preparedContext = {
      expectedUserId: 42,
      sourceRef: 'arkme-source-v1.secret',
      sourceIdentityKey: 'arkme-record-reedit-source-v1.secret',
      sourceKind: 'group_chat' as const,
      sourceDisplayName: '研发群',
      itemUid: 'record-secret-1',
      draftRevision: 3,
      baseVersion: 8,
      baseContentFingerprint: 'a'.repeat(64),
      oldTitle: '',
      oldTextPreview: '原来的正文',
      newTitle: '',
      newTextPreview: '修改后的正文',
      sendAtMillis: 1_756_800_000_000,
      preservesAttachments: true,
    }
    const prepareRecordReedit = vi.fn(async () => preparedContext)
    const commitRecordReedit = vi.fn(async () => ({
      status: 'committed' as const,
      itemUid: 'record-secret-1',
      version: 9,
      revisionUid: 'revision-secret-1',
      projectionState: 'pending' as const,
    }))
    await mountArkmeTools(ctx, 'business', {
      ...ports, prepareRecordReedit, commitRecordReedit,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把这条改一下' }] } },
    ])
    const agent = {
      id: SessionId('session-record-reedit'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = { source_ref: 'arkme-source-v1.secret', item_uid: 'record-secret-1', new_text: '修改后的正文' }

    const prepared = await ctx.tools.execute({
      callId: CallId('record-reedit-prepare'), name: 'arkme_record_reedit', arguments: args, agent, signal,
    })
    expect(prepared.isError).toBe(false)
    const preparedValue = prepared.isError ? '' : prepared.value
    expect(preparedValue).toContain('confirmation_required')
    expect(preparedValue).toContain('研发群')
    expect(preparedValue).toContain('原来的正文')
    expect(preparedValue).toContain('修改后的正文')
    expect(preparedValue).toContain('附件将保持不变')
    expect(preparedValue).not.toContain('record-secret-1')
    expect(preparedValue).not.toContain('arkme-record-reedit-source-v1.secret')
    expect(prepareRecordReedit).toHaveBeenCalledOnce()
    expect(commitRecordReedit).not.toHaveBeenCalled()

    const repeated = await ctx.tools.execute({
      callId: CallId('record-reedit-repeat'), name: 'arkme_record_reedit', arguments: args, agent, signal,
    })
    expect(repeated.isError ? '' : repeated.value).toContain('confirmation_required')
    expect(prepareRecordReedit).toHaveBeenCalledOnce()
    expect(commitRecordReedit).not.toHaveBeenCalled()

    events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认提交' }] },
    })
    const committed = await ctx.tools.execute({
      callId: CallId('record-reedit-confirm'), name: 'arkme_record_reedit', arguments: args, agent, signal,
    })
    expect(committed.isError).toBe(false)
    const committedValue = committed.isError ? '' : committed.value
    expect(committedValue).toContain('已更新')
    expect(committedValue).not.toContain('record-secret-1')
    expect(committedValue).not.toContain('revision-secret-1')
    expect(commitRecordReedit).toHaveBeenCalledOnce()
    expect(commitRecordReedit).toHaveBeenCalledWith(preparedContext)
  })

  it('confirms discarding only the exact local re-edit draft without committing a record update', async () => {
    const ctx = await setup()
    const discardContext = {
      expectedUserId: 42,
      sourceRef: 'arkme-source-v1.secret',
      sourceIdentityKey: 'arkme-record-reedit-source-v1.secret',
      sourceDisplayName: '即我',
      itemUid: 'record-secret-1',
      draftRevision: 4,
      textPreview: '不再需要的草稿',
    }
    const prepareDiscardRecordReeditDraft = vi.fn(async () => discardContext)
    const discardRecordReeditDraft = vi.fn(async () => ({ status: 'discarded' as const, itemUid: 'record-secret-1' }))
    const commitRecordReedit = vi.fn()
    await mountArkmeTools(ctx, 'business', {
      ...ports, prepareDiscardRecordReeditDraft, discardRecordReeditDraft, commitRecordReedit,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '放弃刚才的草稿' }] } },
    ])
    const agent = {
      id: SessionId('session-record-reedit-discard'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = { source_ref: 'arkme-source-v1.secret', item_uid: 'record-secret-1', discard_draft: true }

    const prepared = await ctx.tools.execute({
      callId: CallId('record-reedit-discard-prepare'), name: 'arkme_record_reedit', arguments: args, agent, signal,
    })
    expect(prepared.isError ? '' : prepared.value).toContain('线上快记')
    expect(prepared.isError ? '' : prepared.value).toContain('不再需要的草稿')
    expect(discardRecordReeditDraft).not.toHaveBeenCalled()

    events.push({
      seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认放弃' }] },
    })
    const discarded = await ctx.tools.execute({
      callId: CallId('record-reedit-discard-confirm'), name: 'arkme_record_reedit', arguments: args, agent, signal,
    })
    expect(discarded.isError).toBe(false)
    expect(discarded.isError ? '' : discarded.value).toContain('本机草稿已放弃')
    expect(discarded.isError ? '' : discarded.value).not.toContain('record-secret-1')
    expect(discardRecordReeditDraft).toHaveBeenCalledWith(discardContext)
    expect(commitRecordReedit).not.toHaveBeenCalled()
  })

  it('rechecks the private-chat peer after confirmation before a ban write', async () => {
    const ctx = await setup()
    const sourceRef = 'arkme-source-v1.account-bound'
    const userBanStatus = vi
      .fn()
      .mockResolvedValueOnce({ sourceRef, targetUserId: 91, displayName: '小林', exists: false, banned: false })
      .mockResolvedValueOnce({ sourceRef, targetUserId: 92, displayName: '小周', exists: false, banned: false })
    const banPrivateChatUser = vi.fn()
    await mountArkmeTools(ctx, 'business', {
      ...ports, userBanStatus, banPrivateChatUser,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '封禁这个私聊用户' }], source: { kind: 'user' } } },
    ])
    const agent = {
      id: SessionId('session-user-ban-target-fence'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal
    const args = { source_ref: sourceRef, remark: '违规操作' }

    const prepared = await ctx.tools.execute({
      callId: CallId('user-ban-prepare'), name: 'arkme_user_ban', arguments: args, agent, signal,
    })
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(prepared.isError ? '' : prepared.value).toContain('其他仅离线验 JWT 的服务中，旧 Access Token 最迟约 1 小时失效')
    expect(banPrivateChatUser).not.toHaveBeenCalled()

    events.push({
      seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认封禁' }], source: { kind: 'user' } },
    })
    const confirmed = await ctx.tools.execute({
      callId: CallId('user-ban-confirm'), name: 'arkme_user_ban', arguments: args, agent, signal,
    })
    expect(confirmed.isError).toBe(true)
    expect(confirmed.isError ? confirmed.error.message : '').toContain('封禁目标已变化')
    expect(userBanStatus).toHaveBeenCalledTimes(2)
    expect(banPrivateChatUser).not.toHaveBeenCalled()
  })

  it('binds background-sound confirmation to the account verified during prepare', async () => {
    const ctx = await setup()
    let userId = 42
    const writes: number[] = []
    const backgroundSoundPreference = vi.fn(async () => ({ userId, found: true, enabled: true }))
    const updateBackgroundSoundPreference = vi.fn(async (enabled: boolean, _signal?: AbortSignal, expectedUserId?: number) => {
      if (expectedUserId !== userId) throw new Error('账号已切换，本次背景音设置未保存')
      writes.push(userId)
      return { userId, found: true, enabled }
    })
    await mountArkmeTools(ctx, 'business', {
      ...ports, backgroundSoundPreference, updateBackgroundSoundPreference,
    } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '关闭背景音' }], source: { kind: 'user' } } },
    ])
    const agent = {
      id: SessionId('session-background-sound-account-fence'), session: { get events() { return events } },
    } as unknown as Agent
    const signal = new AbortController().signal

    const prepared = await ctx.tools.execute({
      callId: CallId('prepare'), name: 'arkme_background_sound_disable', arguments: {}, agent, signal,
    })
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(backgroundSoundPreference).toHaveBeenCalledOnce()
    expect(updateBackgroundSoundPreference).not.toHaveBeenCalled()

    userId = 43
    events.push({
      seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认关闭' }], source: { kind: 'user' } },
    })
    const confirmed = await ctx.tools.execute({
      callId: CallId('confirm'), name: 'arkme_background_sound_disable', arguments: {}, agent, signal,
    })
    expect(confirmed.isError).toBe(true)
    expect(updateBackgroundSoundPreference).toHaveBeenCalledWith(false, signal, 42)
    expect(writes).toEqual([])
  })

  it('reads World voiceprint social context without entering the write confirmation flow', async () => {
    const ctx = await setup()
    const worldVoiceprintSocialContext = vi.fn(async () => ({ relations: [{
      type: 'world_interaction' as const,
      displayLine: '你们曾在世界回应过彼此',
      reasonCode: 'relationship_world',
      reasonLabel: '因为我们在世界里回应过彼此',
    }] }))
    await mountArkmeTools(ctx, 'business', {
      ...ports,
      worldVoiceprintSocialContext,
    } as unknown as ArkmeToolPorts)
    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: CallId('social-context'),
      name: 'arkme_world_voiceprint_social_context',
      arguments: { record_ref: 'arkme-world-record-v1.opaque', force_refresh: true },
      signal,
    })

    expect(result.isError).toBe(false)
    expect(result.isError ? '' : result.value).toContain('你们曾在世界回应过彼此')
    expect(worldVoiceprintSocialContext).toHaveBeenCalledWith('arkme-world-record-v1.opaque', {
      forceRefresh: true,
      signal,
    })
  })

  it('adds and withdraws attachment-phase tools with the dependency fiber', async () => {
    const ctx = await setup()
    const tools = await mountArkmeTools(ctx, 'business')
    const names = () => ctx.tools.schemas().map(schema => schema.name)
    expect(names()).not.toContain('arkme_image_read')

    const attachments = await ctx.plugin(RecordingAttachmentStore)
    await new Promise(resolve => setImmediate(resolve))
    expect(names()).toContain('arkme_image_read')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:arkme')?.text)
      .toContain('arkme_image_read')

    await attachments.dispose()
    expect(names()).not.toContain('arkme_image_read')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:arkme')?.text)
      .not.toContain('arkme_image_read')

    const remounted = await ctx.plugin(RecordingAttachmentStore)
    await new Promise(resolve => setImmediate(resolve))
    expect(names()).toContain('arkme_image_read')
    await tools.dispose()
    expect(names()).toEqual([])
    await remounted.dispose()
  })
})

describe('recording import write authorization', () => {
  async function directoryFixture() {
    const ctx = await setup()
    const prepared = preparedDirectory()
    const prepareRecordingDirectory = vi.fn(async () => prepared)
    const importRecordingDirectory = vi.fn(async () => directoryResult())
    const backgroundSoundPreference = vi.fn<ArkmeToolPorts['backgroundSoundPreference']>(async () => ({
      userId: 42, found: true, enabled: true, eligible: true, eligibilityReason: 'eligible',
    }))
    const updateBackgroundSoundPreference = vi.fn<ArkmeToolPorts['updateBackgroundSoundPreference']>(async () => ({
      userId: 42, found: true, enabled: false, eligible: true, eligibilityReason: 'eligible',
    }))
    await mountArkmeTools(ctx, 'business', { ...ports, prepareRecordingDirectory, importRecordingDirectory, backgroundSoundPreference, updateBackgroundSoundPreference })
    const events = sessionEvents()
    const agent = { id: SessionId('directory-intent'), session: { get events() { return events } } } as unknown as Agent
    let call = 0
    const args = { action: 'prepare', directory_path: '/recordings' }
    const invoke = (arguments_: Record<string, unknown> = args, signal = new AbortController().signal) => ctx.tools.execute({
      callId: CallId(`directory-${++call}`), name: 'arkme_recording_import_folder', arguments: arguments_, agent, signal,
    })
    const message = (text: string) => events.push({ seq: events.length + 1, type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
    return { ctx, prepared, prepareRecordingDirectory, importRecordingDirectory, backgroundSoundPreference, updateBackgroundSoundPreference, agent, args, invoke, message }
  }

  it.each(['preparing', 'uploading'] as const)('lets another business tool finish while a directory is %s', async phase => {
    const f = await directoryFixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    if (phase === 'uploading') {
      await f.invoke()
      f.message('确认上传')
      f.importRecordingDirectory.mockImplementationOnce(async () => { await gate; return directoryResult() })
    } else f.prepareRecordingDirectory.mockImplementationOnce(async () => { await gate; return f.prepared })
    const directory = f.invoke({ ...f.args, action: phase === 'preparing' ? 'prepare' : 'upload' })
    try {
      await vi.waitFor(() => expect(phase === 'preparing' ? f.prepareRecordingDirectory : f.importRecordingDirectory).toHaveBeenCalledOnce())
      f.message('关闭文字背景音')
      const invokeOther = (call: string) => f.ctx.tools.execute({
        callId: CallId(call), name: 'arkme_background_sound_disable', arguments: {}, agent: f.agent,
        signal: new AbortController().signal,
      })
      const prepared = await invokeOther('background-prepare')
      expect(prepared.isError).toBe(false)
      expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
      f.message('确认关闭文字背景音')
      expect((await invokeOther('background-confirm')).isError).toBe(false)
      expect(f.updateBackgroundSoundPreference).toHaveBeenCalledOnce()
    } finally { release() }
    const result = await directory
    expect(result.isError).toBe(phase === 'preparing')
    expect(f.importRecordingDirectory).toHaveBeenCalledTimes(phase === 'preparing' ? 0 : 1)
    expect((await f.invoke()).isError).toBe(false)
  })

  it('preserves the human confirmation when a missing action is corrected to upload', async () => {
    const f = await directoryFixture()
    await f.invoke({ ...f.args, action: 'prepare' })
    f.message('确认')
    const missing = await f.invoke({ directory_path: f.args.directory_path })
    const corrected = await f.invoke({ ...f.args, action: 'upload' })
    expect(missing.isError).toBe(true)
    expect(corrected.isError).toBe(false)
    expect(corrected.isError ? '' : corrected.value).not.toContain('confirmation_required')
    expect(f.prepareRecordingDirectory).toHaveBeenCalledOnce()
    expect(f.importRecordingDirectory).toHaveBeenCalledExactlyOnceWith(
      { directoryPath: '/recordings', recursive: true, ownership: 'self' }, f.prepared, expect.any(AbortSignal),
    )
  })

  it('refreshes the same directory after refusal without treating the read as upload confirmation', async () => {
    const f = await directoryFixture()
    await f.invoke()
    f.message('取消，这次先不上传')
    f.message('重新看一下这个目录现在还剩哪些录音需要上传')
    const refreshed = await f.invoke()
    expect(refreshed.isError).toBe(false)
    expect(refreshed.isError ? '' : refreshed.value).toContain('confirmation_required')
    expect(f.prepareRecordingDirectory).toHaveBeenCalledTimes(2)
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
    const earlyUpload = await f.invoke({ ...f.args, action: 'upload' })
    expect(earlyUpload.isError ? '' : earlyUpload.value).toContain('confirmation_required')
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it('repeated preparation refreshes the snapshot and only explicit upload commits it after a human message', async () => {
    const f = await directoryFixture()
    await f.invoke()
    const refreshed = { ...f.prepared, scan: { ...f.prepared.scan, files: f.prepared.scan.files.map(file => ({ ...file, sourceSnapshot: 'refreshed-source' })) } }
    f.prepareRecordingDirectory.mockResolvedValue(refreshed)
    await f.invoke({ ...f.args, action: 'prepare' })
    const early = await f.invoke({ ...f.args, action: 'upload', recursive: true, ownership: 'self' })
    expect(early.isError ? '' : early.value).toContain('confirmation_required')
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
    f.message('确认上传')
    const uploaded = await f.invoke({ ...f.args, action: 'upload', recursive: true, ownership: 'self' })
    expect(uploaded.isError).toBe(false)
    expect(f.prepareRecordingDirectory).toHaveBeenCalledTimes(2)
    expect(f.importRecordingDirectory).toHaveBeenCalledExactlyOnceWith(
      { directoryPath: '/recordings', recursive: true, ownership: 'self' }, refreshed, expect.any(AbortSignal),
    )
  })

  it('prepares an explicit upload without an existing confirmation instead of writing immediately', async () => {
    const f = await directoryFixture()
    const response = await f.invoke({ ...f.args, action: 'upload' })
    expect(response.isError ? '' : response.value).toContain('confirmation_required')
    expect(f.prepareRecordingDirectory).toHaveBeenCalledOnce()
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'omitted to empty times', prepare: {}, upload: { start_times: [] }, expectedTimes: undefined },
    { name: 'empty to omitted times', prepare: { start_times: [] }, upload: {}, expectedTimes: undefined },
    {
      name: 'reordered per-file times',
      prepare: { start_times: [
        { relative_path: 'b.wav', start_at_millis: 1_700_000_001_000 },
        { relative_path: 'a.wav', start_at_millis: 1_700_000_000_000 },
      ] },
      upload: { start_times: [
        { relative_path: 'a.wav', start_at_millis: 1_700_000_000_000 },
        { relative_path: 'b.wav', start_at_millis: 1_700_000_001_000 },
      ] },
      expectedTimes: [
        { relativePath: 'a.wav', startAtMillis: 1_700_000_000_000 },
        { relativePath: 'b.wav', startAtMillis: 1_700_000_001_000 },
      ],
    },
  ])('keeps one confirmation for equivalent directory arguments: $name', async ({ prepare, upload, expectedTimes }) => {
    const f = await directoryFixture()
    await f.invoke({ ...f.args, ...prepare })
    f.message('确认上传')
    const result = await f.invoke({ ...f.args, ...upload, action: 'upload' })
    expect(result.isError).toBe(false)
    expect(result.isError ? '' : result.value).not.toContain('confirmation_required')
    const input = { directoryPath: '/recordings', recursive: true, ownership: 'self',
      ...(expectedTimes === undefined ? {} : { startTimes: expectedTimes }) }
    expect(f.prepareRecordingDirectory).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
    expect(f.importRecordingDirectory).toHaveBeenCalledExactlyOnceWith(input, f.prepared, expect.any(AbortSignal))
  })

  it('requires fresh confirmation for an expired explicit upload', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_788_500_000_000)
    try {
      const f = await directoryFixture()
      await f.invoke()
      now.mockReturnValue(1_788_500_600_001)
      f.message('确认上传')
      const expired = await f.invoke({ ...f.args, action: 'upload' })
      expect(expired.isError ? '' : expired.value).toContain('confirmation_required')
      expect(f.prepareRecordingDirectory).toHaveBeenCalledTimes(2)
      expect(f.importRecordingDirectory).not.toHaveBeenCalled()
      f.message('确认刚才重新核对的清单')
      expect((await f.invoke({ ...f.args, action: 'upload' })).isError).toBe(false)
      expect(f.importRecordingDirectory).toHaveBeenCalledOnce()
    } finally { now.mockRestore() }
  })

  it.each([
    { directory_path: '/other-recordings' }, { recursive: false }, { ownership: 'other' },
    { start_times: [{ relative_path: 'meeting.wav', start_at_millis: 1_700_000_000_000 }] },
  ])('reconfirms changed directory scope before upload: %j', async changed => {
    const f = await directoryFixture()
    await f.invoke()
    f.message('改成这个范围上传')
    const args = { ...f.args, ...changed, action: 'upload' }
    const response = await f.invoke(args)
    expect(response.isError ? '' : response.value).toContain('confirmation_required')
    expect(f.prepareRecordingDirectory).toHaveBeenCalledTimes(2)
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
    f.message('确认更改后的范围')
    expect((await f.invoke(args)).isError).toBe(false)
    expect(f.importRecordingDirectory).toHaveBeenCalledOnce()
  })

  it('blocks concurrent upload during preparation and releases other business confirmations after cancellation', async () => {
    const f = await directoryFixture()
    const controller = new AbortController()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    f.prepareRecordingDirectory.mockImplementationOnce(async () => { await gate; controller.signal.throwIfAborted(); return f.prepared })
    const preparing = f.invoke(f.args, controller.signal)
    try {
      await vi.waitFor(() => expect(f.prepareRecordingDirectory).toHaveBeenCalledOnce())
      const concurrent = await f.invoke({ ...f.args, action: 'upload' })
      expect(concurrent.isError).toBe(true)
      expect(f.importRecordingDirectory).not.toHaveBeenCalled()
      controller.abort()
    } finally { release(); await preparing }
    const background = await f.ctx.tools.execute({ callId: CallId('after-directory-abort'), name: 'arkme_background_sound_disable',
      arguments: {}, agent: f.agent, signal: new AbortController().signal })
    expect(background.isError ? '' : background.value).toContain('confirmation_required')
    expect(f.backgroundSoundPreference).toHaveBeenCalledOnce()
  })

  it('does not replace another business confirmation during an unsolicited directory preparation', async () => {
    const f = await directoryFixture()
    await f.ctx.tools.execute({ callId: CallId('pending-background'), name: 'arkme_background_sound_disable',
      arguments: {}, agent: f.agent, signal: new AbortController().signal })
    expect((await f.invoke()).isError).toBe(true)
    expect(f.prepareRecordingDirectory).not.toHaveBeenCalled()
    f.message('先检查这个录音目录')
    const prepared = await f.invoke()
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it('executes a confirmed upload only once when another upload call arrives concurrently', async () => {
    const f = await directoryFixture()
    await f.invoke()
    f.message('确认上传')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const result = directoryResult()
    f.importRecordingDirectory.mockImplementationOnce(async () => { await gate; return result })
    const uploading = f.invoke({ ...f.args, action: 'upload' })
    try {
      await vi.waitFor(() => expect(f.importRecordingDirectory).toHaveBeenCalledOnce())
      const concurrent = await f.invoke({ ...f.args, action: 'upload' })
      expect(concurrent.isError).toBe(true)
      expect(JSON.stringify(concurrent)).toContain('正在执行')
      expect(f.importRecordingDirectory).toHaveBeenCalledOnce()
    } finally { release(); await uploading }
  })

  it('returns an empty preflight without confirmation or an import execution', async () => {
    const f = await directoryFixture()
    f.prepareRecordingDirectory.mockResolvedValue({ ...f.prepared, scan: { ...f.prepared.scan, files: [] }, preview: [] })
    const response = await f.invoke()
    expect(response.isError).toBe(false)
    expect(response.isError ? '' : response.value).not.toContain('confirmation_required')
    expect(response.isError ? '' : response.value).toContain('"total": 0')
    expect(f.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it('returns a read-only summary without confirmation when every recording is already uploaded', async () => {
    const ctx = await setup()
    const prepared = preparedDirectory([{ relativePath: 'recording.wav', outcome: 'matched_uploaded' }])
    const prepareRecordingDirectory = vi.fn(async () => prepared)
    const importRecordingDirectory = vi.fn(async () => directoryResult([{ relativePath: 'recording.wav', outcome: 'matched_uploaded' }]))
    await mountArkmeTools(ctx, 'business', { ...ports, prepareRecordingDirectory, importRecordingDirectory })
    const agent = { id: SessionId('all-uploaded-folder'), session: { events: [] } } as unknown as Agent
    const output = await ctx.tools.execute({ callId: CallId('folder-preflight'), name: 'arkme_recording_import_folder',
      arguments: { action: 'prepare', directory_path: '/recordings' }, agent, signal: new AbortController().signal })
    expect(output.isError).toBe(false)
    expect(output.isError ? '' : output.value).not.toContain('confirmation_required')
    expect(output.isError ? '' : output.value).toContain('matched_uploaded')
    expect(output.isError ? '' : output.value).toContain('"total": 1')
    expect(importRecordingDirectory).not.toHaveBeenCalled()
    expect(prepareRecordingDirectory).toHaveBeenCalledWith({ directoryPath: '/recordings', recursive: true, ownership: 'self' }, expect.any(AbortSignal))
  })

  it('identifies exceptional files before confirmation and refreshes the plan when recording times are supplied', async () => {
    const ctx = await setup()
    const preview: PreparedRecordingDirectory['preview'] = [
      { relativePath: '20260901-100000.wav', outcome: 'pending_upload' },
      { relativePath: 'unknown-one.wav', outcome: 'time_required' },
      { relativePath: 'nested/unknown-two.wav', outcome: 'time_required' },
      { relativePath: 'collision.wav', outcome: 'conflict' },
      { relativePath: 'broken.wav', outcome: 'invalid', errorCode: 'private-details-must-stay-in-host' },
    ]
    const captured = preparedDirectory(preview)
    const prepareRecordingDirectory = vi.fn(async () => captured)
    const importRecordingDirectory = vi.fn(async () => directoryResult(preview.map(item => ({
      ...item, outcome: item.outcome === 'conflict' || item.outcome === 'invalid' ? item.outcome : 'uploaded',
    }))))
    await mountArkmeTools(ctx, 'business', { ...ports, prepareRecordingDirectory, importRecordingDirectory })
    const events = sessionEvents()
    const agent = { id: SessionId('mixed-directory-confirmation'), session: { get events() { return events } } } as unknown as Agent
    const signal = new AbortController().signal
    const args = { action: 'prepare', directory_path: '/private/recordings' }
    const first = await ctx.tools.execute({ callId: CallId('mixed-preflight'), name: 'arkme_recording_import_folder', arguments: args, agent, signal })
    expect(first.isError).toBe(false)
    const text = first.isError ? '' : first.value
    expect(text).toContain('confirmation_required')
    for (const item of preview.slice(1)) expect(text).toContain(item.relativePath)
    expect(text).not.toContain('private-details-must-stay-in-host')
    expect(text).not.toContain('expectedUserId')
    expect(importRecordingDirectory).not.toHaveBeenCalled()

    const revised: PreparedRecordingDirectory = { ...captured, preview: preview.map(item => item.outcome === 'time_required'
      ? { ...item, outcome: 'pending_upload' } : item) }
    prepareRecordingDirectory.mockResolvedValue(revised)
    events.push({ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '这两个文件都是9月1日上午录的，补上时间再确认' }], source: { kind: 'user' } } })
    const corrected = { ...args, start_times: [
      { relative_path: 'unknown-one.wav', start_at_millis: 1_788_228_000_000 },
      { relative_path: 'nested/unknown-two.wav', start_at_millis: 1_788_231_600_000 },
    ] }
    const next = await ctx.tools.execute({ callId: CallId('corrected-preflight'), name: 'arkme_recording_import_folder', arguments: corrected, agent, signal })
    expect(next.isError ? '' : next.value).toContain('待上传 3')
    expect(next.isError ? '' : next.value).toContain('时间待补 0')
    expect(importRecordingDirectory).not.toHaveBeenCalled()
    events.push({ seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认上传，归属自己' }], source: { kind: 'user' } } })
    const done = await ctx.tools.execute({ callId: CallId('mixed-confirmed'), name: 'arkme_recording_import_folder', arguments: { ...corrected, action: 'upload' }, agent, signal })
    expect(done.isError).toBe(false)
    expect(prepareRecordingDirectory).toHaveBeenCalledTimes(2)
    expect(importRecordingDirectory).toHaveBeenCalledExactlyOnceWith({
      directoryPath: '/private/recordings', recursive: true, ownership: 'self',
      startTimes: [
        { relativePath: 'nested/unknown-two.wav', startAtMillis: 1_788_231_600_000 },
        { relativePath: 'unknown-one.wav', startAtMillis: 1_788_228_000_000 },
      ],
    }, revised, signal)
  })

  it('captures the directory scope before confirmation and imports that snapshot after confirmation', async () => {
    const ctx = await setup()
    const captured = preparedDirectory()
    const prepareRecordingDirectory = vi.fn(async () => captured)
    const importRecordingDirectory = vi.fn(async () => directoryResult())
    await mountArkmeTools(ctx, 'business', { ...ports, prepareRecordingDirectory, importRecordingDirectory })
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '导入这个目录及子目录的录音，归属其他' }], source: { kind: 'user' } } },
    ])
    const agent = { id: SessionId('recording-directory-confirmation'), session: { get events() { return events } } } as unknown as Agent
    const signal = new AbortController().signal
    const args = { action: 'prepare', directory_path: '/private/folder', ownership: 'other' }
    const prepared = await ctx.tools.execute({ callId: CallId('prepare-directory'), name: 'arkme_recording_import_folder', arguments: args, agent, signal })
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(prepared.isError ? '' : prepared.value).toContain('子目录')
    expect(prepared.isError ? '' : prepared.value).toContain('其他')
    expect(prepared.isError ? '' : prepared.value).toContain('/private/folder')
    expect(prepared.isError ? '' : prepared.value).toContain('待上传 1')
    expect(prepared.isError ? '' : prepared.value).toContain('已匹配上传 0')
    expect(prepareRecordingDirectory).toHaveBeenCalledOnce()
    expect(importRecordingDirectory).not.toHaveBeenCalled()
    prepareRecordingDirectory.mockResolvedValue({ ...captured, expectedUserId: 77 })
    events.push({ seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认导入' }], source: { kind: 'user' } } })
    const confirmed = await ctx.tools.execute({ callId: CallId('confirm-directory'), name: 'arkme_recording_import_folder', arguments: { ...args, action: 'upload' }, agent, signal })
    expect(confirmed.isError).toBe(false)
    expect(prepareRecordingDirectory).toHaveBeenCalledOnce()
    expect(importRecordingDirectory).toHaveBeenCalledWith(
      { directoryPath: '/private/folder', recursive: true, ownership: 'other' }, captured, signal,
    )
  })

  it.each([
    { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 },
    { action: 'retry', import_ref: 'opaque-import', revision: 3 },
  ])('confirms $action while status remains a direct read', async args => {
    const ctx = await setup()
    const job = { importRef: 'opaque-import', phase: 'prepared', revision: 3 }
    const importRecordingFile = vi.fn(async () => job)
    const retryRecordingImport = vi.fn(async () => job)
    const recordingImportStatus = vi.fn(async () => job)
    await mountArkmeTools(ctx, 'business', { ...ports, importRecordingFile, retryRecordingImport, recordingImportStatus } as unknown as ArkmeToolPorts)
    const events = sessionEvents([
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '导入这份录音' }], source: { kind: 'user' } } },
    ])
    const agent = { id: SessionId(`recording-${args.action}`), session: { get events() { return events } } } as unknown as Agent
    const signal = new AbortController().signal
    const prepared = await ctx.tools.execute({ callId: CallId('prepare'), name: 'arkme_recording_import', arguments: args, agent, signal })
    expect(prepared.isError ? '' : prepared.value).toContain('confirmation_required')
    expect(importRecordingFile).not.toHaveBeenCalled()
    expect(retryRecordingImport).not.toHaveBeenCalled()
    const status = await ctx.tools.execute({ callId: CallId('status'), name: 'arkme_recording_import', arguments: { action: 'status', import_ref: 'opaque-import' }, signal })
    expect(status.isError).toBe(false)
    expect(status.isError ? '' : status.value).not.toContain('confirmation_required')
    expect(recordingImportStatus).toHaveBeenCalledWith('opaque-import')
    // Reading status must not replace the pending write confirmation.
    events.push({ seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认' }], source: { kind: 'user' } } })
    const confirmed = await ctx.tools.execute({ callId: CallId('confirm'), name: 'arkme_recording_import', arguments: args, agent, signal })
    expect(confirmed.isError).toBe(false)
    expect(args.action === 'upload' ? importRecordingFile : retryRecordingImport).toHaveBeenCalledOnce()
  })

  it('rejects a recording write outside a human Agent session', async () => {
    const ctx = await setup()
    const importRecordingFile = vi.fn(async () => ({ phase: 'prepared' }))
    await mountArkmeTools(ctx, 'business', { ...ports, importRecordingFile } as unknown as ArkmeToolPorts)
    const result = await ctx.tools.execute({
      callId: CallId('unscoped'), name: 'arkme_recording_import',
      arguments: { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(importRecordingFile).not.toHaveBeenCalled()
  })
})
