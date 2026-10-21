const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error('consumer result mismatch') },
  deepEqual(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('consumer command drift') },
  async rejects(pending: Promise<unknown>, pattern?: RegExp) {
    try { await pending } catch (error) { if (!pattern || pattern.test(String(error))) return; throw error }
    throw new Error('unsupported or cancelled operation was accepted')
  },
}
import { createArkmeSdk, type TeamForwardInput, type TeamSendInput, type TeamMessagePort } from '@senguoyun/dsh-arkme/sdk'

// Copied outside the checkout and compiled against the immutable installed tgz.
// No private imports, token handling, assumed filesystem layout or Node globals
// are required by the consumer's business calls.
const lifecycle = new AbortController()
const calls: Array<{operation: string; params: Record<string, unknown>}> = []
let supported = true
const sdk: TeamMessagePort = createArkmeSdk({fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const request = JSON.parse(String(init?.body)) as (typeof calls)[number]
  calls.push(request)
  const {operation, params} = request
  const value = operation === 'provider.capabilities' ? {contractVersion: 1, features: {teamMessageInteractions: supported ? 1 : 0}}
    : operation === 'team.messages.forward' ? {sourceRef: 'target', itemUid: 'accepted-card', localState: 'synced'}
    : operation === 'team.messages.copy-link' ? {url: 'https://example.invalid/s/frozen-sid'}
    : operation === 'team.messages.report' ? {reportUid: 'evidence'}
    : operation === 'team.messages.conversations' ? {items: [], hasMore: false}
    : operation === 'team.messages.read' ? {messages: [], hasMore: false}
    : operation === 'team.messages.preflight' || operation === 'team.messages.marks-read' || operation === 'team.messages.tasks' ? []
    : operation === 'team.messages.marks-change' ? {complete: true, accessible: true, revision: 1, annotations: []}
    : operation === 'team.messages.send' ? {...params.command as object, state: 'queued', taskRef: 'stable-task'}
    : {taskRef: 'stable-task', state: 'cancelled'}
  return new Response(JSON.stringify({ok: true, value}), {headers: {'Content-Type': 'application/json'}})
}})
const selections = [{messageRef: 'account-side-version-ref', version: 3}]
const command: TeamForwardInput = {conversationRef: 'source-team', selections, target: {kind: 'team', conversationRef: 'target-team'}, requestId: 'stable-request', recordUid: 'stable-record', sendAtMillis: 1700000000000, commentText: '附言', commentRecordUid: 'stable-comment'}
assert.equal((await sdk.forwardTeamMessages(command, lifecycle.signal)).itemUid, 'accepted-card')
await sdk.forwardTeamMessages(command, lifecycle.signal)
assert.deepEqual(calls.filter(call => call.operation === 'team.messages.forward').map(call => call.params.input), [command, command])
await sdk.createTeamMessageCopyLink('source-team', selections, lifecycle.signal)
assert.equal((await sdk.reportTeamMessage('source-team', selections[0]!.messageRef, 3, 'spam', '', lifecycle.signal)).reportUid, 'evidence')
await sdk.preflightTeamMessages('source-team', selections, lifecycle.signal)
await sdk.readTeamMarks('source-team', 'team', ['mark-ref'], lifecycle.signal)
await sdk.changeTeamMark('source-team', 'conversation', 'mark-ref', {kind: 'remove', annotationId: 'own-mark', operationId: 'stable-remove'}, lifecycle.signal)
await sdk.listTeamConversations('external', {limit: 20}, lifecycle.signal)
await sdk.readTeamMessages('source-team', {messageRef: selections[0]!.messageRef}, lifecycle.signal)
const send: TeamSendInput = {conversationRef: 'source-team', clientUid: 'stable-client', expectedReplySeq: 0, content: {text_content: '引用回复', template_kind: 1}, fileRefs: [], reply: {messageRef: selections[0]!.messageRef, messageKey: 'opaque-key', version: 3, text: '', senderName: ''}}
assert.equal((await sdk.sendTeamMessage(send, lifecycle.signal)).state, 'queued')
await sdk.teamMessageTasks('source-team', lifecycle.signal)
assert.equal((await sdk.updateTeamSend('source-team', 'stable-task', 'cancel', lifecycle.signal)).state, 'cancelled')
supported = false
const before = calls.filter(call => call.operation === 'team.messages.forward').length
await assert.rejects(sdk.forwardTeamMessages(command), /Provider/)
assert.equal(calls.filter(call => call.operation === 'team.messages.forward').length, before)
lifecycle.abort()
await assert.rejects(sdk.readTeamMessages('source-team', {}, lifecycle.signal))
console.log('external Team message SDK consumer: passed (stable commands, typed targets, capability and lifecycle)')
