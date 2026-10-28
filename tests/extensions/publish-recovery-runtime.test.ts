import { Context } from '@deepseek-ai/cordis'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeExtensionTools } from '../../src/tools/extensions/index.js'
import { recordToolResults, sessionEvents } from '../helpers/tool-session.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

it('keeps registry upload and audit internals out of the status tool result', async () => {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); recordToolResults(ctx)
  const events = sessionEvents([])
  const agent = { id: 'publish-status-agent', session: { get events() { return events } } } as never
  const client = new ExtensionPublishClient(async <T>(): Promise<T> => ({
    publish_session_id: 'pub_status', extension_id: 'ext_status', version: '1.0.0', status: 'published',
    upload_url: 'https://objects.test/SECRET', audit_evidence: ['PRIVATE SOURCE'],
  }) as T)
  registerArkmeExtensionTools(ctx, { publishStatus: (id: string) => client.publishStatus(id) } as never, {} as never, {} as never, 'business')
  try {
    const result = await ctx.tools.execute({ callId: CallId('read-status'), name: 'arkme_extension_publish_status', arguments: { publish_session_id: 'pub_status' }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('published')
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|upload_url|audit_evidence/)
  } finally { await ctx.fiber.dispose() }
})

it('exposes read-only publication receipts and confirms recovery in the DSH runtime', async () => {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); recordToolResults(ctx)
  const events = sessionEvents([{ seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: '恢复发布' }], source: { kind: 'user' } } }])
  const agent = { id: 'publish-recovery-agent', session: { get events() { return events } } } as never
  const receipt = { publish_session_id: 'pub_recovery', extension_id: 'ext_recovery', version: '1.0.0', status: 'validating', execution_state: 'failed', error_message: '审核模型不可用', can_resume: true }
  const manager = { publishStatus: vi.fn(async () => receipt), publishSessions: vi.fn(async () => ({ items: [receipt] })), resumePublish: vi.fn(async () => ({ ...receipt, status: 'published' })) }
  registerArkmeExtensionTools(ctx, manager as never, {} as never, {} as never, 'business')
  const execute = (name: string, args: Record<string, unknown>, id: string) => ctx.tools.execute({ callId: CallId(id), name, arguments: args, agent, signal: new AbortController().signal })
  expect(ctx.tools.schemas(agent).map(item => item.name)).toEqual(expect.arrayContaining(['arkme_extension_publish_status', 'arkme_extension_publish_resume']))
  const status = await execute('arkme_extension_publish_status', {}, 'read')
  expect(status.isError).toBe(false); expect(JSON.stringify(status)).toContain('pub_recovery')
  expect(manager.resumePublish).not.toHaveBeenCalled()
  const prepare = await execute('arkme_extension_publish_resume', { publish_session_id: 'pub_recovery' }, 'prepare')
  expect(JSON.stringify(prepare)).toContain('confirmation_required')
  const sameTurn = await execute('arkme_extension_publish_resume', { publish_session_id: 'pub_recovery' }, 'same-turn')
  expect(JSON.stringify(sameTurn)).toContain('confirmation_required'); expect(manager.resumePublish).not.toHaveBeenCalled()
  events.push({ seq: 20, type: 'user/message', data: { content: [{ type: 'text', text: '确认恢复这个发布' }], source: { kind: 'user' } } })
  const result = await execute('arkme_extension_publish_resume', { publish_session_id: 'pub_recovery' }, 'confirm')
  expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain('published')
  expect(manager.resumePublish).toHaveBeenCalledTimes(1)
  await ctx.fiber.dispose()
})
