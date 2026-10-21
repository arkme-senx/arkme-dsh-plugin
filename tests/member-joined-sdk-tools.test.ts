import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'
import { expect, it } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { SourceService } from '../src/services/source-service.js'
import { type ServiceRuntime } from '../src/services/service.js'
import { joinedBundle } from './fixtures/member-joined.js'

it('SDK and the existing directory Tool expose the same account-bound Host activity projection', async () => {
  const session = { userId: 1, accessToken: 'fixture', refreshToken: 'fixture' }
  const runtime = { config: { environment: 'test' }, requireSession: async () => session,
    authenticatedChatPost: async () => ({ items: [joinedBundle()], has_more: false }),
    stateStore: { uniqueCode: async () => 'fixture' } } as unknown as ServiceRuntime
  const source = new SourceService(runtime, {} as never, {} as never)
  const owner = { listSources: async (directory: 'root', options: Record<string, unknown>) =>
    await source.listSources(directory, { ...options, refresh: true, firstPaint: true }) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ ok: true, value: await dispatchArkmeHostOperation(owner as never, request.operation, request.params) }))
  } })
  const page = await sdk.listSources('root')
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  try {
  const session = ctx.sessions.create()
  const agent = { id: session.id, session }
  registerArkmeTools(ctx, owner as never, 'business')
  expect(ctx.tools.schemas(agent as never).map(tool => tool.name)).toContain('arkme_sources_list')
  const result = await ctx.tools.execute({ callId: CallId('joined-preview'), name: 'arkme_sources_list',
    agent: agent as never, arguments: { directory: 'root' }, signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result)).toContain('你 添加 李四 加入群聊')
  expect(page.items[0]).toMatchObject({ latestPreview: '你 添加 李四 加入群聊', latestActivityAtMillis: 200,
    latestActivityKind: 'member_joined', unreadCount: 0 })
  expect(JSON.stringify(page)).not.toContain('join-event')
  expect(JSON.stringify(page)).not.toContain('actor_user_id')
  await expect(source.openSourceRef(page.items[0]!.sourceRef, 2)).rejects.toBeDefined()
  } finally { await ctx.fiber.dispose() }
})
