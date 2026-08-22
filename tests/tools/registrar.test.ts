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
      'arkme_id_set',
      'arkme_contact_search',
      'arkme_contact_add',
      'arkme_group_create',
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
      'arkme_world_publish_text',
      'arkme_extension_reviews_read',
      'arkme_extension_review_create',
      'arkme_recording_days_list',
      'arkme_recording_read',
      'arkme_recording_doubao_start',
      'arkme_wechat_conversations',
      'arkme_wechat_messages',
      'arkme_wechat_conversation_detail',
      'arkme_wechat_group_members',
      'arkme_wechat_phones',
      'arkme_wechat_common_groups',
      'arkme_wechat_money_flows',
      'arkme_wechat_locations',
      'arkme_sources_list',
      'arkme_group_member_candidates',
      'arkme_group_member_add',
      'arkme_source_read',
      'arkme_message_report',
      'arkme_related_recordings_read',
      'arkme_group_ai_polish_manage',
      'arkme_text_send',
      'arkme_direct_text_send',
      'arkme_call_start',
      'arkme_ai_video',
      'arkme_text_ai_video',
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
