import { describe, expect, it, vi } from 'vitest'
import { businessToolModules } from '../src/tools/business/index.js'
import type { ArkmeCoreToolPorts } from '../src/tools/ports/index.js'
import { SecretValue } from '../src/secret-value.js'
import { ARKME_BUSINESS_TOOL_PROMPT } from '../src/tools/prompts/business.js'

function moduleFor(name: string) {
  return businessToolModules.find(module => module.meta.toolName === name)
}

function fakePorts() {
  return {
    listBots: vi.fn(async () => ({ items: [{
      botRef: 'arkme-bot-v1.opaque', name: '总结', provider: 'openclaw' as const,
      description: '总结群聊', status: 'offline' as const, directChatAvailable: true,
    }] })),
    createBot: vi.fn(async () => ({
      bot: {
        botRef: 'arkme-bot-v1.created', name: '八卦雷达', provider: 'openclaw' as const,
        description: '高亮八卦', status: 'offline' as const, directChatAvailable: true,
      },
      secret: new SecretValue('jbot_full_secret'),
    })),
    listGroupBots: vi.fn(async (groupSourceRef: string) => ({
      groupSourceRef, displayName: '研发群', canAddBots: true, items: [],
    })),
    addGroupBot: vi.fn(async (groupSourceRef: string, botRef: string) => ({
      groupSourceRef, botRef, installed: true,
    })),
    removeGroupBot: vi.fn(async (groupSourceRef: string, botRef: string) => ({
      groupSourceRef, botRef, installed: false,
    })),
    connectOpenClawBot: vi.fn(async () => ({
      status: 'gateway_restart_confirmation_required' as const,
      resource_ref: 'openclaw.bot.v1.opaque', impact: 'profile_all_agents' as const,
    })),
    openBotChat: vi.fn(async () => ({
      sourceRef: 'arkme-source-v1.bot-chat', kind: 'private_chat' as const,
      displayName: '总结', activeAtMillis: 0, unreadCount: 0,
    })),
  } as unknown as ArkmeCoreToolPorts
}

describe('Arkme Bot tools', () => {
  it('declares the minimal Bot catalog with explicit grants on every write', () => {
    expect(['arkme_bots_list', 'arkme_group_bots_list'].map(moduleFor))
      .toSatisfy(modules => modules.every(module => module?.meta.effect === 'read'))
    expect(['arkme_bot_create', 'arkme_bot_chat_open', 'arkme_group_bot_add', 'arkme_group_bot_remove'].map(moduleFor))
      .toSatisfy(modules => modules.every(module => module?.meta.effect === 'write'
        && module.meta.grant === 'explicit-user-write'))
  })

  it('opens Bot private chat using only an opaque bot_ref and returns a reusable source_ref', async () => {
    const ports = fakePorts()
    const module = moduleFor('arkme_bot_chat_open')
    expect(module?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    const output = await module!.create(ports).execute(
      { bot_ref: 'arkme-bot-v1.opaque' },
      { callId: 'bot-chat-open-1', signal: new AbortController().signal } as never,
    ) as string
    expect(ports.openBotChat).toHaveBeenCalledWith('arkme-bot-v1.opaque', expect.any(Object))
    expect(output).toContain('arkme-source-v1.bot-chat')
    expect(output).not.toContain('bot_id')
    expect(output).not.toContain('chat_session_uid')
  })

  it('connects using only an opaque Bot reference and returns no local path or secret', async () => {
    const ports = fakePorts()
    const module = moduleFor('arkme_bot_openclaw_connect')
    expect(module?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    expect(module!.create(ports).parameters).toMatchObject({
      properties: { bot_ref: expect.any(Object) }, required: ['bot_ref'],
    })
    const output = await module!.create(ports).execute(
      { bot_ref: 'arkme-bot-v1.opaque' },
      { callId: 'bot-connect-1', signal: new AbortController().signal } as never,
    ) as string
    expect(ports.connectOpenClawBot).toHaveBeenCalledWith('arkme-bot-v1.opaque', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(output).toContain('gateway_restart_confirmation_required')
    expect(output).not.toContain('/Users/')
    expect(output).not.toContain('jbot_')
  })

  it('creates an OpenClaw Bot without serializing its token or raw owner ID', async () => {
    const ports = fakePorts()
    const module = moduleFor('arkme_bot_create')
    expect(module).toBeDefined()
    const tool = module!.create(ports)

    const output = await tool.execute(
      { name: '八卦雷达', provider: 'openclaw', description: '高亮八卦', avatar: 'file_asset://avatar-asset-1' },
      { callId: 'bot-create-1', signal: new AbortController().signal } as never,
    ) as string

    expect(ports.createBot).toHaveBeenCalledWith(
      { name: '八卦雷达', provider: 'openclaw', description: '高亮八卦', avatar: 'file_asset://avatar-asset-1' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(output).toContain('arkme-bot-v1.created')
    expect(output).not.toContain('jbot_')
    expect(output).not.toContain('secret')
    expect(output).not.toContain('bot_id')
  })

  it('requires and forwards an explicit Webhook provider when creating a Bot', async () => {
    const ports = fakePorts()
    const tool = moduleFor('arkme_bot_create')!.create(ports)

    expect(tool.parameters).toMatchObject({
      properties: {
        provider: { enum: ['openclaw', 'webhook'] },
      },
      required: expect.arrayContaining(['name', 'provider']),
    })

    await tool.execute(
      { name: '回调测试', provider: 'webhook', description: '验证回调' },
      { callId: 'bot-create-webhook-1', signal: new AbortController().signal } as never,
    )
    expect(ports.createBot).toHaveBeenCalledWith(
      { name: '回调测试', provider: 'webhook', description: '验证回调' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('describes both providers without registering a Webhook simulator', () => {
    const ports = fakePorts()
    const list = moduleFor('arkme_bots_list')!.create(ports)
    const create = moduleFor('arkme_bot_create')!.create(ports)
    const connect = moduleFor('arkme_bot_openclaw_connect')!.create(ports)
    const names = businessToolModules.map(module => module.meta.toolName)

    expect(list.description).toContain('Webhook')
    expect(create.description).toContain('provider')
    expect(connect.description).toContain('only')
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('webhook')
    expect(names.some(name => name.includes('webhook') && name.includes('trigger'))).toBe(false)
    expect(names.some(name => name.includes('webhook') && name.includes('send'))).toBe(false)
  })

  it('passes only opaque references through group Bot tools', async () => {
    const ports = fakePorts()
    const exec = { callId: 'group-bot-1', signal: new AbortController().signal } as never
    const list = moduleFor('arkme_group_bots_list')!.create(ports)
    const add = moduleFor('arkme_group_bot_add')!.create(ports)
    const remove = moduleFor('arkme_group_bot_remove')!.create(ports)

    await list.execute({ group_source_ref: 'arkme-source-v1.group' }, exec)
    await add.execute({ group_source_ref: 'arkme-source-v1.group', bot_ref: 'arkme-bot-v1.bot' }, exec)
    await remove.execute({ group_source_ref: 'arkme-source-v1.group', bot_ref: 'arkme-bot-v1.bot' }, exec)

    expect(ports.listGroupBots).toHaveBeenCalledWith('arkme-source-v1.group', expect.any(Object))
    expect(ports.addGroupBot).toHaveBeenCalledWith('arkme-source-v1.group', 'arkme-bot-v1.bot', expect.any(Object))
    expect(ports.removeGroupBot).toHaveBeenCalledWith('arkme-source-v1.group', 'arkme-bot-v1.bot', expect.any(Object))
  })

  it('requires explicit authorization and reconciliation for Bot writes', () => {
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('arkme_bots_list')
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('arkme_bot_create')
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('arkme_group_bot_add')
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('explicit human request')
    expect(ARKME_BUSINESS_TOOL_PROMPT).toContain('Never automatically retry Bot creation')
  })
})
