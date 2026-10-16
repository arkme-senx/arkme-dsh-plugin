import { createArkmeSdk, type ArkmeDayDigestQuery, type ArkmeDayDigestGenerateInput, type ArkmeDayDigestState } from '@senguoyun/dsh-arkme/sdk'
function check(value: unknown): asserts value { if (!value) throw new Error('Day digest consumer assertion failed') }
const query: ArkmeDayDigestQuery = { dateStamp: Date.parse('2026-10-14T00:00:00+08:00'), timeZone: 'Asia/Shanghai', timeZoneOffsetMillis: 28800000 }
const command: ArkmeDayDigestGenerateInput = { ...query, kinds: ['summary', 'timeline'], sources: ['self', 'chat', 'audio', 'call'], idempotencyKey: 'consumer-persistent-command' }
const state: ArkmeDayDigestState = { supported: true, generationEnabled: false, job: null, result: null, versions: [], hasNewContent: false }
const calls: string[] = []
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const request = JSON.parse(String(init?.body)); calls.push(request.operation)
  return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities' ? { contractVersion: 1, features: { dayDigestRead: true } } : state }))
} })
check((await sdk.dayDigest(query)).generationEnabled === false)
await new Promise<void>((resolve, reject) => { const dispose = sdk.subscribeDayDigest(query, value => { check(value.supported); dispose(); resolve() }, { onError: reject }) })
check(calls.every(x => x === 'provider.capabilities' || x === 'day-digest.read'))
try { await sdk.generateDayDigest(command); throw new Error('unexpected background generation') } catch (error) { check(String(error).includes('人类点击')) }
const old = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
check((await old.dayDigest(query)).supported === false)
try { await sdk.dayDigest(query, AbortSignal.abort()); throw new Error('expected abort') } catch (error) { check(error instanceof DOMException && error.name === 'AbortError') }
console.log('Packed SDK consumer: public types, read-only downgrade, subscription disposal, background rejection and abort passed')
