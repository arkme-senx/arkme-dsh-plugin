import { expect, it, vi } from 'vitest'
import { thoughtContinuations } from '../../src/services/thought-continuation-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'
const id = 'a'.repeat(64)
function fixture(kind: 'owned' | 'chat' = 'owned') {
  const session = { userId: 11, refreshToken: 'session-one' }
  const rows: unknown[] = [{ id, reply_record_uid: 'human-reply', status: 'ready', content: '继续讨论', reply_target_ref: 'signed-ai-result',
    visibility: kind === 'owned' ? 'user' : 'members', generation: 1, created_at: 1700000000000, can_retry: false }]
  const post = vi.fn(async (..._args: unknown[]) => ({ items: rows }))
  const auth = vi.fn(async () => session)
  const resolve = vi.fn(async () => ({ kind, viewerUserId: 11, recordUid: 'root', chatSessionUid: 'chat', recordOwnerUserId: 42 }))
  const authorize = vi.fn(async () => ({}))
  const runtime = { config: { environment: 'test' }, requireSession: auth, authenticatedIntelligentPost: post } as unknown as ServiceRuntime
  const run = (options: { cursor?: string; retryId?: string } = {}, signal?: AbortSignal) => thoughtContinuations(runtime, 'signed-source', 'signed-action', options, resolve, authorize, signal)
  return { run, rows, post, auth, resolve, authorize, session }
}
it('binds continuation reads to the signed source and rechecks owned content before and after IO', async () => {
  const f = fixture(), signal = new AbortController().signal
  const page = await f.run({}, signal)
  expect(page).toMatchObject({ accountScope: 'test:11', supported: true, items: [{ id, recordUid: 'root', replyRecordUid: 'human-reply', replyTargetRef: 'signed-ai-result' }] })
  expect(f.authorize).toHaveBeenCalledTimes(2)
  expect(f.post).toHaveBeenCalledWith('/api/v1/thought/replies/list', { kind: 'record', root_record_uid: 'root', root_record_owner_user_id: 11, limit: 20 }, f.session, signal, { lane: 'background-read', publishServiceCooldown: false })
})
it('uses the current Chat source and refuses a members-visible result for a personal source', async () => {
  const f = fixture('chat'); await f.run()
  expect(f.post.mock.calls[0]?.[1]).toMatchObject({ kind: 'chat', chat_session_uid: 'chat', root_record_uid: 'root' })
  expect(f.authorize).not.toHaveBeenCalled()
  const personal = fixture(); Object.assign(personal.rows[0]!, { visibility: 'members' })
  await expect(personal.run()).rejects.toMatchObject({ code: 'thought-continuation-response-invalid' })
})
it('rejects account or login-session changes, permission revocation, and pre-aborted requests', async () => {
  const f = fixture(); f.post.mockImplementationOnce(async () => { f.session.refreshToken = 'new-session'; return { items: f.rows } })
  // Return distinct snapshots, as the real runtime does.
  f.auth.mockImplementation(async () => ({ ...f.session }))
  await expect(f.run()).rejects.toMatchObject({ code: 'record-thought-account-changed' })
  const revoked = fixture(); revoked.authorize.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('locked'))
  await expect(revoked.run()).rejects.toThrow('locked')
  const aborted = fixture(), controller = new AbortController(); controller.abort()
  await expect(aborted.run({}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(aborted.post).not.toHaveBeenCalled()
})
it('preserves status, sends a source-bound retry once and never treats an unconfirmed write as success', async () => {
  const f = fixture(); f.post.mockResolvedValueOnce({ accepted: true } as never)
  await f.run({ retryId: id })
  expect(f.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/v1/thought/replies/retry', { kind: 'record', root_record_uid: 'root', root_record_owner_user_id: 11, limit: 20, id }])
  expect(f.post).toHaveBeenCalledTimes(2)
  const bad = fixture(); await expect(bad.run({ retryId: id })).rejects.toMatchObject({ code: 'thought-continuation-retry-unconfirmed' })
  expect(bad.post).toHaveBeenCalledOnce()
})
it('bounds and validates every response, including duplicate IDs and malformed cursors', async () => {
  const f = fixture(); await expect(f.run({ cursor: 'guess' })).rejects.toThrow('目标无效')
  expect(f.post).not.toHaveBeenCalled()
  f.rows.push(f.rows[0]); await expect(f.run()).rejects.toMatchObject({ code: 'thought-continuation-response-invalid' })
  const large = fixture(); large.rows.splice(0, 1, ...Array(21).fill(large.rows[0]))
  await expect(large.run()).rejects.toMatchObject({ code: 'thought-continuation-response-invalid' })
})
it('reports an old server as unsupported without hiding real transport or authorization failures', async () => {
  const old = fixture(); old.post.mockRejectedValueOnce(new ArkmePluginError('upstream-http', 'not found', false, 502, 404))
  // The error type's upstreamStatus is authoritative; avoid relying on constructor optional order.
  old.post.mockReset().mockRejectedValueOnce(Object.assign(new ArkmePluginError('old', 'not found', false), { upstreamStatus: 404 }))
  expect(await old.run()).toMatchObject({ supported: false, items: [] })
  const unavailable = fixture(); unavailable.post.mockRejectedValueOnce(new Error('owner unavailable'))
  await expect(unavailable.run()).rejects.toThrow('owner unavailable')
})
