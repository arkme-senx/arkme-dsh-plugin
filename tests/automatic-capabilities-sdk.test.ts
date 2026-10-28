import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

it('SDK and Host share one account and version contract', async () => {
  const owner = {
    automaticCapabilities: vi.fn(async () => ({ accountScope: 'prod:7', settings: [] })),
    updateAutomaticCapability: vi.fn(async () => ({ accountScope: 'prod:7', settings: [] })),
  }
  const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
    const body = JSON.parse(String(init?.body))
    const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { automaticCapabilitiesV1: true } }
      : await dispatchArkmeHostOperation(owner as never, body.operation, body.params)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  await sdk.automaticCapabilities('prod:7')
  const input = { key: 'record_thought' as const, enabled: true, expectedVersion: 2, billingConsent: true }
  await sdk.updateAutomaticCapability('prod:7', input)
  expect(owner.automaticCapabilities).toHaveBeenCalledWith('prod:7', undefined)
  expect(owner.updateAutomaticCapability).toHaveBeenCalledWith(input, 'prod:7', undefined)
})

it('older providers explicitly decline without sending a write', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
  const sdk = createArkmeSdk({ fetchImpl })
  await expect(sdk.updateAutomaticCapability('prod:7', { key: 'record_thought', enabled: false, expectedVersion: 0, billingConsent: false })).rejects.toThrow('不支持自动 AI 设置')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
