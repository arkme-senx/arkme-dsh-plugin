import { describe, expect, it } from 'vitest'
import {
  arkmeToolCatalog, defineArkmeToolCatalog,
} from '../../src/tools/registry/catalog.js'
import {
  defineArkmeCoreToolModule, type ArkmeCoreToolModule,
} from '../../src/tools/contract/module.js'
import { ARKME_TOOL_PROMPT } from '../../src/tools/prompts/index.js'

function moduleWith(meta: Partial<ArkmeCoreToolModule['meta']> = {}): ArkmeCoreToolModule {
  return defineArkmeCoreToolModule({
    meta: {
      id: 'business.test.example.v1',
      toolName: 'arkme_test_example',
      kind: 'business',
      phase: 'core',
      effect: 'read',
      profiles: ['business', 'hybrid'],
      ...meta,
    },
    create: () => ({ name: 'arkme_test_example' }) as never,
  })
}

describe('Arkme tool catalog', () => {
  it('keeps the current business tool surface and stable order', () => {
    expect(arkmeToolCatalog.toolNamesFor('business')).toEqual([
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
      'arkme_image_read',
    ])
    expect(arkmeToolCatalog.toolNamesFor('atomic')).toEqual(['arkme_plugin_contract'])
    expect(arkmeToolCatalog.toolNamesFor('hybrid')).toEqual(arkmeToolCatalog.toolNamesFor('business'))
    expect(arkmeToolCatalog.toolNamesFor('disabled')).toEqual([])
  })

  it('separates registration phase from business kind and write policy', () => {
    const image = arkmeToolCatalog.modules.find(module => module.meta.toolName === 'arkme_image_read')
    const writes = arkmeToolCatalog.modules.filter(module => module.meta.effect === 'write')

    expect(image?.meta).toMatchObject({ kind: 'business', phase: 'attachments', effect: 'read' })
    expect(writes.map(module => module.meta.toolName)).toEqual([
      'arkme_id_set', 'arkme_contact_add', 'arkme_group_create', 'arkme_arko_session', 'arkme_arko_ask', 'arkme_arko_cancel',
      'arkme_record_create', 'arkme_bot_create', 'arkme_bot_openclaw_connect', 'arkme_bot_chat_open', 'arkme_group_bot_add', 'arkme_group_bot_remove',
      'arkme_world_voiceprint_invite', 'arkme_world_publish_text', 'arkme_extension_review_create', 'arkme_recording_doubao_start',
      'arkme_group_member_add', 'arkme_message_report', 'arkme_group_ai_polish_manage',
      'arkme_text_send', 'arkme_direct_text_send',
      'arkme_call_start',
      'arkme_ai_video',
      'arkme_text_ai_video',
    ])
    expect(writes.every(module => module.meta.grant === 'explicit-user-write')).toBe(true)
  })

  it('keeps every tool named by business guidance inside the business profile', () => {
    const mentioned = [...new Set(ARKME_TOOL_PROMPT.match(/arkme_[a-z_]+/g) ?? [])]
    const visible = new Set(arkmeToolCatalog.toolNamesFor('business'))

    expect(mentioned.filter(name => !visible.has(name))).toEqual([])
  })

  it('rejects duplicate ids and model-facing names', () => {
    expect(() => defineArkmeToolCatalog([moduleWith(), moduleWith({ toolName: 'arkme_other' })]))
      .toThrow('duplicate Arkme tool module id')
    expect(() => defineArkmeToolCatalog([moduleWith(), moduleWith({ id: 'business.test.other.v1' })]))
      .toThrow('duplicate Arkme model tool name')
  })

  it('rejects profile/category drift and writes without grant ownership', () => {
    expect(() => defineArkmeToolCatalog([moduleWith({ profiles: ['atomic'] })]))
      .toThrow('cannot join the atomic profile')
    expect(() => defineArkmeToolCatalog([moduleWith({ effect: 'write' })]))
      .toThrow('must declare explicit-user-write grant ownership')
    expect(() => defineArkmeToolCatalog([moduleWith({ id: 'business.bad.v0' })]))
      .toThrow('invalid Arkme tool module id')
  })
})
