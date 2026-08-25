import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerArkmeExtensionTools } from '../../src/tools/extensions/index.js'

describe('Arkme extension tools in the DSH ToolRuntime', () => {
  it('publishes the mine-list schema and executes it for an exact Agent session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const list = vi.fn(async () => ({
      items: [{
        ownedRef: 'owned-ref', name: '天气助手', description: '天气', states: ['cordis'],
        halves: { host: true, client: false }, cordis: { packageCount: 1, active: true },
        publish: { allowed: true, mode: 'new', route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
      }],
      warnings: [],
    }))
    registerArkmeExtensionTools(ctx, {} as never, { list } as never, {} as never, 'business')
    const agent = { id: SessionId('session-1') } as Agent

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(expect.arrayContaining([
      'arkme_extension_list_mine',
      'arkme_extension_save_profile',
      'arkme_extension_publish',
      'arkme_extension_edit',
      'arkme_extension_preview_add',
      'arkme_extension_preview_delete',
      'arkme_extension_preview_reorder',
    ]))
    const result = await ctx.tools.execute({
      callId: CallId('call-1'), name: 'arkme_extension_list_mine', arguments: {}, agent,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ isError: false })
    expect(result.isError ? '' : result.value).toContain('<data_from_arkme_extensions>')
    expect(result.isError ? '' : result.value).toContain('"route": "dynamic-cordis-v2"')
    expect(result.isError ? '' : result.value).toContain('"artifactContractVersion": 2')
    expect(result.isError ? '' : result.value).toContain('"artifactKind": "dsh-bundle-tgz"')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ currentSessionId: 'session-1' }))
  })

  it('publishes a prepared batch only after a later direct human confirmation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '发布两个扩展' }], source: { kind: 'user' } } },
      { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'prepare', name: 'arkme_extension_publish', arguments: '{}' } },
    ]
    const agent = {
      id: SessionId('session-publish'),
      session: { get events() { return events } },
    } as unknown as Agent
    const publish = vi.fn(async (input: { ownedRef: string; version: string }) => ({
      extension_id: `ext-${input.ownedRef}`, version: input.version, status: 'published' as const,
    }))
    const inventory = {
      preparePublish: vi.fn(async (input: Record<string, unknown>) => ({
        input, sourceFingerprint: `fingerprint:${String(input.ownedRef)}`,
      })),
      publish,
    }
    registerArkmeExtensionTools(ctx, {} as never, inventory as never, {} as never, 'business')
    const prepare = await ctx.tools.execute({
      callId: CallId('prepare'), name: 'arkme_extension_publish', agent,
      arguments: { action: 'prepare', items: [
        { owned_ref: 'weather', name: '天气', description: '', version: '1.0.0', visibility: 'private' },
        { owned_ref: 'calendar', name: '日程', description: '', version: '1.0.0', visibility: 'private' },
      ] },
      signal: new AbortController().signal,
    })
    expect(prepare.isError).toBe(false)
    expect(prepare.isError ? '' : prepare.value).toContain('"status": "confirmation_required"')
    expect(prepare.isError ? '' : prepare.value).not.toContain('expectedReply')
    expect(publish).not.toHaveBeenCalled()

    const sameTurn = await ctx.tools.execute({
      callId: CallId('confirm-same-turn'), name: 'arkme_extension_publish', arguments: { action: 'confirm' }, agent,
      signal: new AbortController().signal,
    })
    expect(sameTurn).toMatchObject({ isError: true })
    expect(publish).not.toHaveBeenCalled()

    events.push(
      { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 4, type: 'turn/start', data: { turn: 2 } },
      { seq: 5, type: 'user/message', data: { content: [{ type: 'text', text: '这两个都可以发出去' }], source: { kind: 'user' } } },
    )
    const confirmed = await ctx.tools.execute({
      callId: CallId('confirm-later'), name: 'arkme_extension_publish', arguments: { action: 'confirm' }, agent,
      signal: new AbortController().signal,
    })
    expect(confirmed.isError).toBe(false)
    expect(confirmed.isError ? '' : confirmed.value).toContain('"published": 2')
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('keeps an explicit owned extension identity through prepare and confirm', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const events: Array<Record<string, unknown>> = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '把新版更新到原扩展' }], source: { kind: 'user' } } },
    ]
    const agent = {
      id: SessionId('session-update-existing'),
      session: { get events() { return events } },
    } as unknown as Agent
    const publish = vi.fn(async () => ({
      extension_id: 'ext-existing', version: '1.1.0', status: 'published' as const,
    }))
    const inventory = {
      preparePublish: vi.fn(async (input: Record<string, unknown>) => ({
        input, sourceFingerprint: 'fingerprint:weather',
      })),
      publish,
    }
    registerArkmeExtensionTools(ctx, {} as never, inventory as never, {} as never, 'business')

    const prepare = await ctx.tools.execute({
      callId: CallId('prepare-update-existing'), name: 'arkme_extension_publish', agent,
      arguments: { action: 'prepare', items: [{
        owned_ref: 'weather-new-source',
        extension_id: 'ext-existing',
        name: '天气',
        description: '',
        version: '1.1.0',
        visibility: 'private',
      }] },
      signal: new AbortController().signal,
    })
    expect(prepare.isError).toBe(false)
    const preview = JSON.parse(prepare.isError ? '{}' : prepare.value) as { question?: string }
    expect(preview.question).toContain('更新已有扩展 ext-existing')

    events.push(
      { seq: 2, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      { seq: 3, type: 'turn/start', data: { turn: 2 } },
      { seq: 4, type: 'user/message', data: { content: [{ type: 'text', text: '确认更新这个原扩展' }], source: { kind: 'user' } } },
    )
    const confirmed = await ctx.tools.execute({
      callId: CallId('confirm-update-existing'), name: 'arkme_extension_publish',
      arguments: { action: 'confirm' }, agent,
      signal: new AbortController().signal,
    })
    expect(confirmed.isError).toBe(false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ extensionId: 'ext-existing' }))
  })
})
