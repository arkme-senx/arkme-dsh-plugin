import { createArkmeSdk, type TeamWorldFeedback, type TeamWorldRequest, type TeamWorldActivity, type ArkmeWorldCommentNotificationPage, type WorldReactionContextPage } from '@senguoyun/dsh-arkme/sdk'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const lifetime = new AbortController(), calls: { operation: string; params: Record<string, unknown> }[] = []
let enabled = true
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const call = JSON.parse(String(init?.body)); calls.push(call)
  const value = call.operation === 'provider.capabilities' ? { contractVersion: 1, features: { teamWorldV1: enabled, worldReactionsV1: enabled } }
    : call.operation === 'team.world' && call.params.action === 'feedback' ? { items: [{ actorName:'小李',reaction:{active:false,expression:{text:'收到'}},preview:{teamName:'团队',text:'当前正文',title:'',imageCount:1,deleted:false,publicRequested:false} }],hasMore:false }
    : call.operation === 'team.world' && call.params.action === 'activity' ? { items: [] as TeamWorldActivity[], hasMore: false }
    : call.operation === 'team.world' ? { sourceRef: 'opaque-source' }
    : { items: [], hasMore: false, unavailableRecordRefs: [] }
  return new Response(JSON.stringify({ ok: true, value }), { headers: { 'content-type': 'application/json' } })
} })
const input: TeamWorldRequest = { action: 'source', accountKey: 'test:9', version: 1, origin: { kind: 'local', sourceRef: 'consumer', itemUid: 'message', textContent: '明确的本地快照', sourceLabel: 'DSH', sendAtMillis: 1, hasAttachments: false } }
assert((await sdk.teamWorld(input, lifetime.signal)).sourceRef === 'opaque-source', 'typed source')
const feedback = await sdk.teamWorld({action:'feedback',accountKey:'test:9',teamRef:'opaque-team'})
const first: TeamWorldFeedback = feedback.items[0]!
assert(first.reaction?.active === false && first.reaction.expression.text === '收到' && first.preview.text === '当前正文', 'typed exact historical action and current preview')
await sdk.teamWorld({ action: 'activity', accountKey: 'test:9', limit: 20 }, lifetime.signal)
const contexts: WorldReactionContextPage = await sdk.prepareWorldReactions('test:9', ['opaque-record'], lifetime.signal)
assert(contexts.items.length === 0, 'typed contexts')
const original: WorldReactionContextPage = await sdk.prepareNoteWorldReactions('test:9', 'opaque-original-source', 'opaque-original-message', lifetime.signal)
assert(original.items.length === 0, 'typed original archive')
assert(calls.some(c => c.operation === 'world.reactions.from-note' && c.params.sourceRef === 'opaque-original-source'), 'original owner routed through public SDK')
const notifications: ArkmeWorldCommentNotificationPage = await sdk.worldCommentNotifications({ cursor: 'opaque-page', signal: lifetime.signal })
assert(!notifications.hasMore, 'typed notifications')
await sdk.worldReplies('opaque-parent', { cursor: 'opaque-reply-page', signal: lifetime.signal })
await sdk.worldReactions({ action: 'query', accountKey: 'test:9', targets: [] }, lifetime.signal)
assert(calls.find(c => c.operation === 'world.comment-notifications')?.params.cursor === 'opaque-page', 'cursor preserved')
enabled = false
let rejected = false
try { await sdk.teamWorld(input) } catch { rejected = true }
assert(rejected, 'old provider rejected')
lifetime.abort(); rejected = false
try { await sdk.worldCommentNotifications({ signal: lifetime.signal }) } catch { rejected = true }
assert(rejected, 'consumer lifetime cancellation')
console.log('external World SDK consumer: typed exports, capability detection, opaque scope/cursor and cancellation PASS')
