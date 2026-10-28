import { createArkmeSdk, type ArkmeArchiveState, type ArkmeArchiveSetInput, type ArkmeArchiveEntry } from '@senguoyun/dsh-arkme/sdk'

// This fixture is copied into the freshly installed profile. It uses only the
// published SDK export and carries cancellation through its own lifecycle.
const lifecycle = new AbortController()
const calls: string[] = []
const state: ArkmeArchiveState = { entityType: 'topic', sourceRef: 'opaque-topic', ownerAvailable: true,
  selfArchived: false, effectiveArchived: true, revision: 2, displayArchiveAt: 100,
  inheritedFrom: { sourceRef: 'opaque-parent', topicHierarchyKey: 'opaque-parent-key' } }
let supported = true
const entry: ArkmeArchiveEntry = {...state, privacyLocked: false,
  source: {sourceRef: state.sourceRef, kind: 'topic', topicHierarchyKey: 'child-key', displayName: 'Child', activeAtMillis: 100, unreadCount: 0},
  inheritedFromSummary: {title: 'Parent', privacyLocked: false}}
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const { operation } = JSON.parse(String(init?.body)) as { operation: string }
  calls.push(operation)
  const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: supported ? { entityArchive: true } : {} }
    : operation === 'archives.state' ? [state]
      : operation === 'archives.list' ? { items: [entry], hasMore: false }
        : { ...state, stateChanged: true, effectiveChangedCount: 0 }
  return new Response(JSON.stringify({ ok: true, value }), { headers: { 'Content-Type': 'application/json' } })
} })
const page = await sdk.listArchives(undefined, lifecycle.signal)
if (page.items[0]?.inheritedFromSummary?.title !== 'Parent') throw new Error('missing typed source summary')
const [current] = await sdk.getArchiveStates(['opaque-topic'], lifecycle.signal)
if (current === undefined) throw new Error('missing typed archive state')
const command: ArkmeArchiveSetInput = { sourceRef: current.sourceRef, selfArchived: false, expectedRevision: current.revision }
const result = await sdk.setArchiveState(command, lifecycle.signal)
if (!result.effectiveArchived || result.selfArchived) throw new Error('inherited state lost')
for (const operation of ['archives.list', 'archives.state', 'archives.set']) {
  if (!calls.includes(operation)) throw new Error(`missing SDK operation ${operation}`)
}
supported = false
let unsupported = false
try { await sdk.listArchives() } catch { unsupported = true }
if (!unsupported) throw new Error('unsupported host accepted archive call')
lifecycle.abort()
let aborted = false
try { await sdk.getArchiveStates(['opaque-topic'], lifecycle.signal) } catch { aborted = true }
if (!aborted) throw new Error('consumer lifecycle cancellation was ignored')
console.log('external archive SDK consumer: passed')
