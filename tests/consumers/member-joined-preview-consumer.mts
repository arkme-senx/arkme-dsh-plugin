import assert from 'node:assert/strict'
import { createArkmeSdk, type ArkmeSourceItem } from '@senguoyun/dsh-arkme/sdk'
const source: ArkmeSourceItem = { sourceRef: 'opaque', kind: 'group_chat', displayName: '讨论群', unreadCount: 0,
  activeAtMillis: 200, latestPreview: '李四 加入了群聊', latestActivityAtMillis: 200, latestActivityKind: 'member_joined' }
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  if (init?.signal?.aborted) throw init.signal.reason
  assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'sources.list', params: { directory: 'root' } })
  return new Response(JSON.stringify({ ok: true, value: { directory: 'root', items: [source], hasMore: false } }))
} })
const result = await sdk.listSources('root')
assert.equal(result.items[0]?.latestPreview, source.latestPreview)
assert.equal(result.items[0]?.latestActivityAtMillis, 200)
assert.equal(result.items[0]?.latestActivityKind, 'member_joined')
const controller = new AbortController(); controller.abort()
await assert.rejects(sdk.listSources('root', { signal: controller.signal }))
console.log('Public installed SDK member-join consumer: passed')
