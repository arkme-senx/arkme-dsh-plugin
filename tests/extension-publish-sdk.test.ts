import { expect, it } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from '../src/types.js'

it('feature detects recovery and carries AbortSignal through read and explicit write calls', async () => {
  const calls: string[] = []
  const signals: Array<AbortSignal | null | undefined> = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { operation: string }
    calls.push(request.operation); signals.push(init?.signal)
    return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { extensionPublishRecovery: true } } : { publish_session_id: 'pub_sdk', extension_id: 'ext_sdk', version: '1.0.0', status: 'validating', execution_state: 'failed' } }), { headers: { 'Content-Type': 'application/json' } })
  } })
  const controller = new AbortController()
  await sdk.extensionPublishStatus('pub_sdk', controller.signal)
  await sdk.resumeExtensionPublish('pub_sdk', controller.signal)
  expect(calls.filter(value => value === 'extensions.publish.status')).toHaveLength(1)
  expect(calls.filter(value => value === 'extensions.publish.resume')).toHaveLength(1)
  expect(signals.every(signal => signal === controller.signal)).toBe(true)
})

it('does not call recovery operations on a Provider without the feature', async () => {
  const calls: string[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)).operation)
    return new Response(JSON.stringify({ ok: true, value: { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: {} } }))
  } })
  await expect(sdk.resumeExtensionPublish('pub_sdk')).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
  expect(calls).toEqual(['provider.capabilities'])
})
