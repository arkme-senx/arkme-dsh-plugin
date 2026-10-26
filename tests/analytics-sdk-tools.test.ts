import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog } from '../src/tools/index.js'
const q = { accountScope: 'test:7', sourceRef: 'signed', timezone: 'Asia/Shanghai', fromDate: null, toDate: null, sender: 'all' }
it('SDK, Tools and UI share Host owners and capability discovery', async () => {
 const owner = { conversationWordsState: vi.fn(async () => ({ supported: true, result: null, job: null, stale: false })), analyticsRead: vi.fn(async () => ({ supported: true })) }
 const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
  const body = JSON.parse(String(init?.body))
  const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { analyticsV1: true } } : await dispatchArkmeHostOperation(owner as never, body.operation, body.params)
  return new Response(JSON.stringify({ ok: true, value }))
 } })
 await sdk.conversationWordsState(q)
 expect(owner.conversationWordsState).toHaveBeenCalledWith(q, undefined)
 const tools = createArkmeCoreToolDefinitions(owner as never)
 const read = tools.find(t => t.name === 'arkme_analytics_read')!
 expect(await read.execute({ kind: 'conversation_words', action: 'state', query_json: JSON.stringify(q) }, {} as never)).toContain('true')
 expect(owner.analyticsRead).toHaveBeenCalledWith({ kind: 'conversation_words', action: 'state', query: q }, undefined)
 expect(arkmeToolCatalog.modules.find(t => t.meta.toolName === 'arkme_conversation_words_generate')?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
})
it('rejects unsupported Providers before creating a word-count job', async () => {
 const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
 await expect(createArkmeSdk({ fetchImpl }).conversationWordsCreate({ ...q, requestId: 'stable-request-id-123' })).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
