import { createArkmeSdk, type ArkmeRecordThoughts, type ArkmeThoughtReplySnapshot, type ArkmeThoughtContinuationPage } from '@senguoyun/dsh-arkme/sdk'
const operations: string[] = []
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  const request = JSON.parse(String(init?.body)); operations.push(request.operation)
  const value = request.operation === 'provider.capabilities' ? { contractVersion: 1, features: { arkoThoughtRepliesV1: true, arkoThoughtContinuationsV1: true } }
    : request.operation.startsWith('source.message-thought-continuations.') ? { accountScope: 'test:11', supported: true, items: [] }
    : request.operation === 'source.message-thoughts.query' ? { accountScope: 'test:11', items: [{ id: 'thought', recordUid: 'root', content: 'suggestion', biz: 1, replyTargetRef: 'opaque-target' }] }
    : { recordUid: 'reply', parentRecordUid: 'root', status: 1, localState: 'synced' }
  return new Response(JSON.stringify({ ok: true, value }))
} })
const lifecycle = new AbortController()
const thoughts: ArkmeRecordThoughts = await sdk.sourceMessageThoughts('signed-source', 'signed-action', lifecycle.signal)
const target = thoughts.items[0]?.replyTargetRef
if (!target) throw new Error('Public SDK did not expose the opaque reply target')
await sdk.extendSourceMessage('signed-source', 'signed-action', 'reply', { thoughtReplyRef: target, recordUid: 'stable-child', relationUid: 'stable-relation', signal: lifecycle.signal })
await sdk.sourceMessageExtensionPage('signed-source', 'signed-action', { signal: lifecycle.signal })
const continuations: ArkmeThoughtContinuationPage = await sdk.sourceMessageThoughtContinuations('signed-source', 'signed-action', { signal: lifecycle.signal })
if (!continuations.supported) throw new Error('Continuation transport is unsupported')
await sdk.retrySourceMessageThoughtContinuation('signed-source', 'signed-action', 'a'.repeat(64), lifecycle.signal)
const snapshot: ArkmeThoughtReplySnapshot = { thoughtId: 'thought', recordUid: 'root', generation: 1, visibility: 'user', content: 'suggestion' }
if (snapshot.visibility !== 'user' || !operations.includes('source.message-extension.extend')) throw new Error('Consumer contract did not run')
lifecycle.abort()
console.log('Public Arko thought SDK consumer passed')
