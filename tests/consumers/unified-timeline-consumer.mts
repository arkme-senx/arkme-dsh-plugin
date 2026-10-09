import { createArkmeSdk, type ArkmeUnifiedTimelineQuery, type ArkmeUnifiedTimelineWindow } from '@senguoyun/dsh-arkme/sdk'
const lifecycle = new AbortController()
let supported = true
const calls: string[] = []
const window: ArkmeUnifiedTimelineWindow = { protocolVersion: 1, events: [], sources: [], complete: false,
  windowTokens: ['opaque'], hasMore: false, olderHasMore: false, newerHasMore: false }
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const { operation, params } = JSON.parse(String(init?.body))
  calls.push(operation)
  if (operation === 'source.timeline' && params.cursor.unified.mode !== 'refresh') throw new Error('query lost')
  return new Response(JSON.stringify({ ok: true, value: operation === 'provider.capabilities'
    ? { contractVersion: 1, features: supported ? { unifiedChatTimeline: true, worldRecordRead: true } : {} }
    : operation === 'world.record.read' ? { recordRef: params.recordRef, textContent: 'public note' } : { source: { sourceRef: 'source' }, items: [], unified: window, hasMore: false } }))
} })
const query: ArkmeUnifiedTimelineQuery = { mode: 'refresh', windowTokens: ['opaque'] }
const result = await sdk.readChatTimeline('source', query, lifecycle.signal)
if (result.unified?.protocolVersion !== 1 || result.unified.complete) throw new Error('partial window lost')
const detail = await sdk.readWorldRecord('opaque-world-ref')
if (detail.textContent !== 'public note') throw new Error('world detail lost')
supported = false
try { await sdk.readChatTimeline('source', query); throw new Error('unsupported accepted') }
catch (error) { if (!(error instanceof Error) || error.message === 'unsupported accepted') throw error }
if (calls.filter(call => call === 'source.timeline').length !== 1) throw new Error('unsupported host queried')
lifecycle.abort()
try { await sdk.readChatTimeline('source', query, lifecycle.signal); throw new Error('abort ignored') }
catch (error) { if (error instanceof Error && error.message === 'abort ignored') throw error }
console.log('external unified timeline SDK consumer: passed')
