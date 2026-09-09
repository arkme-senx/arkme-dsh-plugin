import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

it('discovers and invokes all directory owners in a real DSH session without an attachment dependency', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const list = vi.fn(async section => ({ section, items: [], total: 0, hasMore: false, coverage: 'complete' }))
  ctx.provide('arkmeDirectory', { list })
  const session = ctx.sessions.create()
  const agent = { id: session.id, session }
  registerArkmeTools(ctx, {} as never, 'business')
  expect(ctx.tools.schemas(agent as never).map(t => t.name)).toContain('arkme_directory_list')
  for (const section of ['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts']) {
    const result = await ctx.tools.execute({ callId: CallId(`directory-${section}`), agent: agent as never,
      signal: new AbortController().signal, name: 'arkme_directory_list', arguments: { section, refresh: true, limit: 1 } })
    expect(result.isError).toBe(false)
    expect(String(result.value)).toContain(`"section": "${section}"`)
    expect(list).toHaveBeenLastCalledWith(section, expect.objectContaining({ refresh: true, limit: 1, signal: expect.any(AbortSignal) }))
  }
  await ctx.fiber.dispose()
})

it('exposes local-first discovery and dispatches it through the official session ToolRuntime', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create()
  const agent = { id: session.id, session }
  const listSources = vi.fn(async () => ({ directory: 'root', items: Array.from({ length: 80 }, (_, index) => ({ sourceRef: String(index) })), hasMore: false, projection: { phase: 'complete', bots: [], visibility: [] } }))
  registerArkmeTools(ctx, { listSources } as never, 'business')
  const schemas = ctx.tools.schemas(agent as never)
  expect(schemas.map(tool => tool.name)).toContain('arkme_bot_conversation_pin')
  expect(JSON.stringify(schemas.find(tool => tool.name === 'arkme_sources_list'))).toContain('local_first')
  const result = await ctx.tools.execute({ callId: CallId('directory-cache-read'), agent: agent as never, signal: new AbortController().signal, name: 'arkme_sources_list', arguments: { directory: 'root', local_first: true, limit: 20 } })
  expect(result.isError).toBe(false)
  expect(listSources).toHaveBeenCalledWith('root', expect.objectContaining({ localFirst: true, limit: 20 }))
  expect(String(result.value)).toContain('"cachedCount": 80')
  expect(String(result.value)).toContain('"truncated": true')
  expect(String(result.value)).toContain('local_first=false')
  expect(String(result.value)).not.toContain('"sourceRef": "20"')
})

it.skipIf(process.env.ARKME_DIRECTORY_ACCEPTANCE_ORIGIN === undefined)('reads the running desktop Host through a real session tool call', async () => {
  const origin = process.env.ARKME_DIRECTORY_ACCEPTANCE_ORIGIN!
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Acceptance only targets the task-local desktop Host')
  const { createArkmeSdk } = await import('../../src/sdk/index.js')
  const sdk = createArkmeSdk({ fetchImpl: async (path, init) => await fetch(new URL(String(path), origin), { ...init, headers: { ...init?.headers, Origin: origin } }) })
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create()
  const agent = { id: session.id, session }
  registerArkmeTools(ctx, { listSources: sdk.listSources.bind(sdk) } as never, 'business')
  expect(ctx.tools.schemas(agent as never).some(schema => schema.name === 'arkme_sources_list')).toBe(true)
  const result = await ctx.tools.execute({ callId: CallId('live-directory-read'), agent: agent as never, signal: new AbortController().signal, name: 'arkme_sources_list', arguments: { directory: 'root', local_first: true, limit: 20 } })
  expect(result.isError).toBe(false)
  expect(String(result.value)).toContain('"cachedCount"')
  expect(String(result.value)).toContain('"sourceRef"')
})
