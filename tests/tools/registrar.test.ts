import { Context } from '@deepseek-ai/cordis'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
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

async function mountArkmeTools(ctx: Context, profile: ArkmeToolProfile) {
  return await ctx.plugin(Object.assign(
    (toolCtx: Context) => { registerArkmeTools(toolCtx, ports, profile) },
    { inject: ['tools', 'systemPrompt'] },
  ))
}

describe('registerArkmeTools', () => {
  it('registers the unchanged core business surface and matching prompt', async () => {
    const ctx = await setup()
    await mountArkmeTools(ctx, 'business')

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'arkme_plugin_contract',
      'arkme_records_recent',
      'arkme_user_profile',
      'arkme_id_set',
      'arkme_arko_profile',
      'arkme_arko_session',
      'arkme_arko_ask',
      'arkme_arko_run_status',
      'arkme_arko_cancel',
      'arkme_records_search',
      'arkme_record_create',
      'arkme_world_recent',
      'arkme_world_publish_text',
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
      'arkme_source_read',
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
  })

  it('keeps atomic and disabled profiles free of inherited business tools and guidance', async () => {
    const atomic = await setup()
    await mountArkmeTools(atomic, 'atomic')
    expect(atomic.tools.schemas().map(schema => schema.name)).toEqual(['arkme_plugin_contract'])
    expect((await atomic.systemPrompt.assemble()).sections.some(section => section.name === 'tool:arkme')).toBe(false)

    const disabled = await setup()
    await mountArkmeTools(disabled, 'disabled')
    expect(disabled.tools.schemas()).toEqual([])
    expect((await disabled.systemPrompt.assemble()).sections.some(section => section.name === 'tool:arkme')).toBe(false)
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
