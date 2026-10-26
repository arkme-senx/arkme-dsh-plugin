import { ArkmeClientError, createArkmeSdk, type ArkmeDeviceLockSnapshot } from '@senguoyun/dsh-arkme/sdk'

function assert(value: unknown): asserts value { if (!value) throw new Error('Device lock consumer assertion failed') }
const snapshot: ArkmeDeviceLockSnapshot = { available: true, locked: true, sessionEnded: false, message: '请在手机确认', operationState: 'awaiting_confirmation' }
const calls: string[] = []
const controller = new AbortController()
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  const input = JSON.parse(String(init?.body))
  calls.push(input.operation)
  assert(input.params === undefined) // No account/session selector or authentication proof from the consumer.
  assert(init?.signal === controller.signal)
  return new Response(JSON.stringify({ ok: true, value: snapshot }))
} })
assert((await sdk.deviceLockStatus(controller.signal)).available)
assert((await sdk.lockDevice(controller.signal)).locked)
assert((await sdk.requestDeviceUnlock(controller.signal)).operationState === 'awaiting_confirmation')
assert(snapshot.locked) // Requesting an unlock is not authorization to release the lock.
assert(calls.join(',') === 'device.lock.status,device.lock.lock,device.lock.unlock')

// A current plugin on an older native host has a safe unavailable projection.
const unavailable = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { available: false, locked: false, sessionEnded: false, message: '' } })) })
assert(!(await unavailable.deviceLockStatus()).available)
// Older plugins expose their normal typed Host error, rather than inventing an unlocked result.
const oldPlugin = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: { code: 'unsupported-operation', message: 'Upgrade required', retryable: false } })) })
try { await oldPlugin.deviceLockStatus(); throw new Error('Old plugin must reject') }
catch (error) { assert(error instanceof ArkmeClientError && error.body.code === 'unsupported-operation') }
controller.abort() // Requests are caller-owned; the SDK creates no polling/subscription resources.
console.log('External packed SDK device lock consumer: passed')
