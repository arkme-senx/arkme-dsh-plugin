import { createArkmeSdk, type ArkmeArkoInteractionQuery, type ArkmeArkoTimelineCache } from '@senguoyun/dsh-arkme/sdk'
function assert(value: unknown): asserts value { if (!value) throw new Error('Arko public consumer contract failed') }
async function rejects(run: () => Promise<unknown>, code?: string) {
 let rejected = false
 try { await run() } catch (error) { rejected = true; if (code) assert((error as { body: { code: string } }).body.code === code) }
 assert(rejected)
}
const calls: Array<{ operation: string; params: Record<string, unknown> }> = []
const interaction = { interactionKey: 'stable', interactionRef: 'opaque-result', occurredAtMillis: 2000, sourceName: '私聊', kind: 'chat', summary: '已授权回答', suggestion: false }
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
 init?.signal?.throwIfAborted()
 const request = JSON.parse(String(init?.body)); calls.push(request)
 const value = request.operation === 'provider.capabilities' ? { contractVersion: 1, features: { arkoInteractionTimelineV1: true } }
  : request.operation === 'arko.interactions' ? { accountScope: 'test:11', items: [interaction], hasMore: false, removedKeys: [], oldestScannedAtMillis:1000 }
  : request.operation === 'arko.interaction.open' ? { accountScope: 'test:11', source: { sourceRef: 'opaque-source', kind: 'private_chat', displayName: '私聊' }, itemUid: 'synthetic-root', recordOwnerUserId: '9007199254740993', interactionKey: 'stable', occurredAtMillis: 2000, sourceAtMillis: 1000, suggestion: false, thought: { id: 'synthetic-thought', recordUid: 'synthetic-root', biz: 2, content: '已授权回答', status: 'ready' } }
  : request.params.value ?? null
 return new Response(JSON.stringify({ ok: true, value }))
} })
const query: ArkmeArkoInteractionQuery = { limit: 1 }
const page = await sdk.arkoInteractions(query)
assert(page.items[0]?.interactionRef === 'opaque-result' && page.oldestScannedAtMillis===1000)
await sdk.arkoInteractions({afterMillis:1000,observedRefs:[page.items[0]!.interactionRef]})
assert(calls.some(row=>row.operation==='arko.interactions'&&Array.isArray(row.params.observedRefs)))
const target = await sdk.arkoInteractionOpen(page.items[0].interactionRef)
assert(target.recordOwnerUserId==='9007199254740993')
assert(target.suggestion === false && target.thought?.biz === 2 && target.sourceAtMillis === 1000 && target.occurredAtMillis === 2000)
const snapshot: ArkmeArkoTimelineCache = { schemaVersion: 2, savedAtMillis: Date.now(), messages: [], interactions: page.items, interactionStartMillis:page.oldestScannedAtMillis }
assert((await sdk.arkoTimelineCache('test:11', snapshot))?.schemaVersion === 2)
assert((await sdk.arkoTimelineCache('test:11')) === undefined)
await rejects(() => sdk.arkoInteractions({}, AbortSignal.abort()))
// dispose owns managed exports/observations; ordinary one-shot reads remain usable.
sdk.dispose(); sdk.dispose(); assert((await sdk.arkoInteractions()).items.length === 1)
const unsupported = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
await rejects(() => unsupported.arkoInteractions(), 'CAPABILITY_UNSUPPORTED'); unsupported.dispose()
assert(calls.some(row => row.operation === 'arko.timeline.cache' && row.params.accountScope === 'test:11'))
console.log('PASS: installed public Arko SDK types, capability discovery, exact result, account scope, cache schema, cancellation and dispose')
