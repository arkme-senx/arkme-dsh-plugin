import { expect, it, vi } from 'vitest'
import { ArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
it('public SDK discovers capability and routes joining through the same Host owner', async () => {
 const service = { providerCapabilities: () => ({contractVersion: 1, features: {contactTeamDiscovery: true}}), joinContactTeam: vi.fn(async () => ({state: 'pending'})) }
 const fetchImpl = vi.fn(async (_path: unknown, init?: RequestInit) => {
  const {operation, params} = JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ok: true, value: await dispatchArkmeHostOperation(service as never, operation, params, init?.signal ?? undefined)}))
 }) as typeof fetch
 const sdk = new ArkmeSdk({fetchImpl})
 expect(await sdk.joinContactTeam('arkme_cn', 'request')).toEqual({state: 'pending'})
 expect(service.joinContactTeam).toHaveBeenCalledWith('arkme_cn', 'request', undefined, undefined)
})
it('does not write when provider has no discovery capability', async () => {
 const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ok: true, value: {contractVersion: 1, features: {}}}))) as typeof fetch
 await expect(new ArkmeSdk({fetchImpl}).joinContactTeam('team', 'request')).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
