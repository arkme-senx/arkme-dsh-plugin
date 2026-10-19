import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog } from '../src/tools/index.js'
const page = { items: [], hasMore: true, nextCursor: 'opaque-cursor', scanned: 500, consistency: 'live' }
it('SDK discovers support and sends all read modes through the Host owner with cancellation', async () => {
 const service = { arkoMessages: vi.fn(async () => page), arkoSearch: vi.fn(async () => page), arkoContext: vi.fn(async () => ({ items: [], hasBefore: false, hasAfter: false })), arkoExport: vi.fn(async () => ({ fileRef: 'arkme-generated-v1.YQ.Yg.Yw', count: 5 })) }
 const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
   init?.signal?.throwIfAborted()
   const { operation, params } = JSON.parse(String(init?.body))
   const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: { arkoHistoryReadsV1: true } }
     : await dispatchArkmeHostOperation(service as never, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
   return new Response(JSON.stringify({ ok: true, value }))
 } })
 const signal = new AbortController().signal
 await sdk.arkoMessages({ limit: 20, direction: 'asc', startAtMillis: 1000 }, signal)
 await sdk.arkoSearch({ keyword: '[literal]', role: 'assistant', cursor: 'opaque-cursor' }, signal)
 await sdk.arkoContext({ messageRef: 'opaque', before: 2, after: 3 }, signal)
 const result = await sdk.arkoExport(signal)
 expect(service.arkoMessages).toHaveBeenCalledWith({ limit: 20, direction: 'asc', startAtMillis: 1000 }, signal)
 expect(service.arkoSearch).toHaveBeenCalledWith({ keyword: '[literal]', role: 'assistant', cursor: 'opaque-cursor' }, signal)
 expect(service.arkoContext).toHaveBeenCalledWith({ messageRef: 'opaque', before: 2, after: 3 }, signal)
 expect(service.arkoExport).toHaveBeenCalledWith(signal)
 expect(sdk.localFileUrl(result.fileRef, true)).toContain('download=1')
 await expect(sdk.arkoExport(AbortSignal.abort())).rejects.toThrow()
 const unsupported = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
 await expect(unsupported.arkoMessages()).rejects.toThrow('不支持')
})
it('registers history as a formal read Tool and bounds plaintext previews without hiding truncation', async () => {
 const service = { arkoMessages: vi.fn(async () => ({ ...page, items: [{ messageRef: 'opaque', text: 'x'.repeat(3000), role: 'assistant', status: 1, createdRecordUids: [] }] })),
   arkoSearch: vi.fn(async () => page), arkoContext: vi.fn(async () => ({ items: [] })), arkoExport: vi.fn(async () => ({ fileRef: 'opaque-artifact', count: 1 })) }
 const tool = createArkmeCoreToolDefinitions(service as never).find(tool => tool.name === 'arkme_arko_history')!
 const module = arkmeToolCatalog.modulesFor('business').find(module => module.meta.toolName === tool.name)!
 expect(module.meta.effect).toBe('read'); expect(module.meta.grant).toBeUndefined()
 expect(arkmeToolCatalog.toolNamesFor('hybrid')).toContain(tool.name)
 expect(arkmeToolCatalog.toolNamesFor('atomic')).not.toContain(tool.name)
 const exec = { signal: new AbortController().signal } as never
 const queried = JSON.parse(await tool.execute({ action: 'query' }, exec) as string)
 expect(queried.items[0].text).toHaveLength(2000); expect(queried.items[0].textTruncated).toBe(true)
 await tool.execute({ action: 'search', keyword: 'hello', role: 'user' }, exec)
 expect(service.arkoSearch).toHaveBeenCalledWith({ keyword: 'hello', role: 'user', limit: 10 }, expect.any(AbortSignal))
 await tool.execute({ action: 'context', message_ref: 'opaque' }, exec)
 expect(service.arkoContext).toHaveBeenCalledWith({ messageRef: 'opaque', before: 2, after: 2 }, expect.any(AbortSignal))
 await tool.execute({ action: 'export' }, exec)
 expect(service.arkoExport).toHaveBeenCalledWith(expect.any(AbortSignal))
 await expect(tool.execute({ action: 'delete' }, exec)).rejects.toThrow()
})
it('retains legacy history cancellation and rejects malformed public input before owner calls', async () => {
 const service = { arkoHistoryPage: vi.fn(), arkoMessages: vi.fn() }, signal = new AbortController().signal
 await dispatchArkmeHostOperation(service as never, 'arko.history', { limit: 50, offset: 20 }, undefined, undefined, undefined, undefined, signal)
 expect(service.arkoHistoryPage).toHaveBeenCalledWith(50, 20, signal)
 await expect(dispatchArkmeHostOperation(service as never, 'arko.messages', { limit: 'invalid' })).rejects.toMatchObject({ code: 'arko-history-invalid' })
 expect(service.arkoMessages).not.toHaveBeenCalled()
})
