function assert(value: unknown): asserts value { if (!value) throw new Error('Realtime dictation consumer assertion failed') }
import { createArkmeSdk, ArkmeClientError, type RealtimeDictationRequest, type RealtimeDictationSnapshot, type RealtimeDictationHandle } from '@senguoyun/dsh-arkme/sdk'
const calls: string[] = [], controller = new AbortController()
const snapshot: RealtimeDictationSnapshot = { version: 1, streamRef: 'opaque', phase: 'listening', text: '', revision: 0 }
const request: RealtimeDictationRequest = { action: 'start', expectedUserId: 42 }
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  assert(init?.signal === controller.signal)
  const body = JSON.parse(String(init?.body)); calls.push(body.operation)
  return new Response(JSON.stringify({ ok: true, value: body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { realtimeDictationV1: true } } : snapshot }))
} })
assert((await sdk.realtimeDictation(request, controller.signal)).streamRef === 'opaque')
assert(calls.join(',') === 'provider.capabilities,dictation.realtime')
const old = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
try { await old.openRealtimeDictation({ expectedUserId: 42, onUpdate() {}, onError() {} }); throw new Error('Old Provider must reject') }
catch (error) { assert(error instanceof ArkmeClientError && error.body.code === 'CAPABILITY_UNSUPPORTED') }
// Stable lifecycle handle is usable without any private import or native bridge.
function cleanup(handle: RealtimeDictationHandle) { handle.dispose() }
void cleanup; controller.abort()
console.log('External packed realtime dictation SDK consumer: passed')
