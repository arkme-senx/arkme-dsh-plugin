import { it, expect, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { worldSuggestionsReadTool, worldSuggestionsWriteTool } from '../src/tools/business/world/suggestions.js'
const response = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { headers: { 'content-type': 'application/json' } })
it('discovers the SDK contract, passes account scope and cancellation, and never replays a command', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => { expect(init?.signal).toBe(signal); const request = JSON.parse(String(init?.body)); calls.push(request); return request.operation === 'provider.capabilities' ? response({ contractVersion: 1, features: { worldSuggestionsV1: true } }) : response({ version: 1, supported: false }) } })
  await expect(sdk.worldSuggestions({ accountKey: 'prod:11', action: 'capabilities' }, signal)).resolves.toEqual({ version: 1, supported: false })
  expect(calls).toEqual([{ operation: 'provider.capabilities' }, { operation: 'world.suggestions', params: { accountKey: 'prod:11', action: 'capabilities' } }])
  const old = createArkmeSdk({ fetchImpl: async () => response({ contractVersion: 1, features: {} }) })
  await expect(old.worldSuggestions({ accountKey: 'test:1', action: 'capabilities' })).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
})
it('requires a write grant and cannot generate, dismiss, or cancel through the read adapter', async () => {
  expect(worldSuggestionsWriteTool.meta.grant).toBe('explicit-user-write')
  const owner = vi.fn().mockResolvedValue({ version: 1, supported: false }), context = { signal: new AbortController().signal }
  type Tool = { execute(input: { request_json: string }, ctx: typeof context): Promise<unknown> }
  const read = worldSuggestionsReadTool.create({ worldSuggestions: owner } as never) as unknown as Tool
  for (const action of ['create', 'hide', 'cancel']) await expect(read.execute({ request_json: JSON.stringify({ action, accountKey: 'test:1', confirmed: true }) }, context)).rejects.toThrow()
  const write = worldSuggestionsWriteTool.create({ worldSuggestions: owner } as never) as unknown as Tool
  await expect(write.execute({ request_json: JSON.stringify({ action: 'create', accountKey: 'test:1', confirmed: false }) }, context)).rejects.toThrow()
  expect(owner).not.toHaveBeenCalled()
  await read.execute({ request_json: JSON.stringify({ action: 'capabilities', accountKey: 'test:1' }) }, context)
  expect(owner).toHaveBeenCalledWith({ action: 'capabilities', accountKey: 'test:1' }, context.signal)
})
