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
      'arkme_source_read',
      'arkme_copy_link_extend',
      'arkme_source_members',
      'arkme_source_member_records',
      'arkme_message_read_statuses',
      'arkme_message_read_members',
      'arkme_conversation_mark_read',
      'arkme_message_report',
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '提醒这条动态的作者开启声纹' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_world_voiceprint_invite', arguments: '{}' } },
    ]
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '邀请小林认领这个声音并授权' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_voiceprint_recognized_person_invite', arguments: '{}' } },
    ]
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '给这个已绑定的人生成邀请' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_voiceprint_recognized_person_invite', arguments: '{}' } },
    ]
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '执行这项声纹操作' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name, arguments: '{}' } },
    ]
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '封禁这个私聊用户' }], source: { kind: 'user' } } },
    ]
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
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '关闭背景音' }], source: { kind: 'user' } } },
    ]
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
