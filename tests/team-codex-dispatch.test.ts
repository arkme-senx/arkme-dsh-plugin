import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexDispatchJournal, type CodexDispatchEvidence, type CodexDispatchTarget } from '../src/team-codex-dispatch-journal.js'
import { CodexDispatchExecutor } from '../src/team-codex-dispatch.js'

const opened: DatabaseSync[] = [], directories: string[] = []
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }) })
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); opened.push(db)
  let now = 1000
  const journal = new CodexDispatchJournal(db, () => now)
  const target: CodexDispatchTarget = { ownerId: 11, teamRef: `team_v1_${'x'.repeat(32)}`, sourceId: randomUUID(), taskId: randomUUID(), threadId: randomUUID() }
  const create = (text = '下一轮检查布局', id = randomUUID()) => journal.create(target, id, text)
  const first = () => journal.list(target, target.taskId)[0]!
  const claim = () => journal.claim(target, randomUUID())!
  const evidence = (kind: 'queue' | 'turn' = 'queue'): CodexDispatchEvidence => ({ requestId: first().requestId, threadId: target.threadId, kind, nativeId: randomUUID() })
  return { db, journal, target, create, first, claim, evidence, advance: (by: number) => { now += by } }
}
describe('local native dispatch durable outbox', () => {
  it('defaults off; does not infer control authorization from collection/upload', () => {
    const f = fixture()
    expect(() => f.create()).toThrow('CONTROL_DISABLED')
    expect(f.claim()).toBeUndefined()
    f.journal.enable(f.target); expect(f.create().state).toBe('pending')
  })
  it('deduplicates the exact request, not identical text or titles, and never rebinds it', () => {
    const f = fixture(); f.journal.enable(f.target)
    const first = f.create('hello')
    expect(f.create('hello', first.requestId)).toEqual(first)
    for (const change of [{ text: 'other' }, { threadId: randomUUID() }, { taskId: randomUUID() },
      { ownerId: 22 }, { sourceId: randomUUID() }, { teamRef: `team_v1_${'y'.repeat(32)}` }]) {
      expect(() => f.journal.create({ ...f.target, ...change }, first.requestId, 'text' in change ? change.text : 'hello')).toThrow('REQUEST_CONFLICT')
    }
    f.create('hello'); expect(f.journal.list(f.target, f.target.taskId)).toHaveLength(2)
  })
  it('validates opaque scope, UUID target and exact 16KiB UTF8 payload without truncation', () => {
    const f = fixture(); f.journal.enable(f.target)
    for (const text of ['', '  ', '\0hi', '中'.repeat(5500)]) expect(() => f.create(text)).toThrow('INVALID_TEXT')
    expect(f.create('a'.repeat(16_384)).text).toHaveLength(16_384)
    for (const target of [{ ...f.target, ownerId: 0 }, { ...f.target, teamRef: 'arkme_cn' }, { ...f.target, threadId: 'codex://threads/a' }])
      expect(() => f.journal.create(target, randomUUID(), 'hi')).toThrow('CODEX_DISPATCH_INVALID')
    expect(f.create('  exact\ntext\t').text).toBe('  exact\ntext\t')
  })
  it('scopes lists to owner/team/source/task and serializes the physical input lane', () => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const lease = f.claim()
    for (const change of [{ ownerId: 22 }, { sourceId: randomUUID() }, { teamRef: `team_v1_${'y'.repeat(32)}` }])
      expect(f.journal.list({ ...f.target, ...change }, f.target.taskId)).toEqual([])
    const other = { ...f.target, sourceId: randomUUID(), taskId: randomUUID() }
    f.journal.enable(other); f.journal.create(other, randomUUID(), 'second')
    expect(f.journal.claim(other, randomUUID())).toBeUndefined()
    f.journal.wait(lease, 'draft_present')
    expect(f.journal.claim(other, randomUUID())).toBeDefined()
  })
  it('waits without touching the composer and fences old attempts', () => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const old = f.claim()
    f.journal.wait(old, 'draft_present'); const next = f.claim()
    expect(() => f.journal.beginInput(old)).toThrow('STALE_ATTEMPT')
    const mutated = { ...next, request: { ...next.request, text: 'malicious mutation', threadId: randomUUID() } }
    expect(f.journal.beginInput(mutated)?.text).toBe('下一轮检查布局')
    expect(f.first().threadId).toBe(f.target.threadId)
  })
  it('revoking and re-enabling never resurrects pending or preparing work', () => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const lease = f.claim(); f.create()
    f.journal.revoke(f.target); f.journal.enable(f.target)
    expect(f.journal.beginInput(lease)).toBeUndefined()
    expect(f.journal.list(f.target, f.target.taskId).map(r => r.state)).toEqual(['cancelled', 'cancelled'])
    expect(f.claim()).toBeUndefined()
  })
  it('expires unstarted requests; also checks expiration after preflight', () => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const lease = f.claim()
    f.advance(86_400_000); expect(f.journal.beginInput(lease)).toBeUndefined(); expect(f.first().state).toBe('expired')
    f.create(); f.advance(86_400_000); expect(f.claim()).toBeUndefined()
  })
  it.each(['queue', 'turn'] as const)('confirms %s from a matching native receipt, not task completion', kind => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const lease = f.claim()
    f.journal.beginInput(lease); const receipt = f.evidence(kind)
    expect(f.journal.finish(lease, receipt).state).toBe(kind === 'queue' ? 'queued_confirmed' : 'accepted_confirmed')
    expect(f.first().evidence).toEqual(receipt); expect(f.claim()).toBeUndefined()
    expect(() => f.journal.finish(lease, receipt)).toThrow('STALE_ATTEMPT')
  })
  it.each(['missing', 'wrong-request', 'wrong-thread', 'no-native-id'])('leaves %s evidence unknown and never retries', reason => {
    const f = fixture(); f.journal.enable(f.target); const created = f.create(); const lease = f.claim()
    f.journal.beginInput(lease)
    const receipt = reason === 'missing' ? null : { ...f.evidence(), ...(reason === 'wrong-request' ? { requestId: randomUUID() }
      : reason === 'wrong-thread' ? { threadId: randomUUID() } : { nativeId: '' }) }
    expect(f.journal.finish(lease, receipt).state).toBe('unknown')
    f.advance(86_400_001); expect(f.claim()).toBeUndefined()
    expect(f.create(created.text, created.requestId).state).toBe('unknown')
  })
  it('rechecks grant during input; still records original receipt after revocation', () => {
    const f = fixture(); f.journal.enable(f.target); f.create(); const lease = f.claim(); f.journal.beginInput(lease)
    expect(f.journal.canSubmit(lease)).toBe(true)
    f.journal.revoke(f.target); f.journal.enable(f.target)
    expect(f.journal.canSubmit(lease)).toBe(false)
    expect(f.journal.finish(lease, f.evidence()).state).toBe('queued_confirmed')
  })
  it('never confirms two requests with the same native item, even for identical text', () => {
    const f = fixture(); f.journal.enable(f.target); f.create('same'); const first = f.claim()
    f.journal.beginInput(first); const receipt = f.evidence(); f.journal.finish(first, receipt)
    const next = f.create('same'), second = f.claim(); f.journal.beginInput(second)
    expect(f.journal.finish(second, { ...receipt, requestId: next.requestId }).state).toBe('unknown')
  })
  it.each([false, true])('reopens persisted attempt safely (input begun=%s), no expiry steals lane', started => {
    const dir = mkdtempSync(join(tmpdir(), 'arkme-dispatch-test-')); directories.push(dir)
    const path = join(dir, 'dispatch.sqlite'), f = fixture(path)
    f.journal.enable(f.target); f.create(); const lease = f.claim()
    if (started) f.journal.beginInput(lease)
    const peer = new DatabaseSync(path); opened.push(peer)
    const restarted = new CodexDispatchJournal(peer, () => 1001)
    expect(restarted.claim(f.target, randomUUID())).toBeUndefined()
    restarted.recoverStoppedExecutor(randomUUID())
    expect(restarted.claim(f.target, randomUUID())).toBeUndefined()
    restarted.recoverStoppedExecutor(lease.executorId)
    expect(restarted.list(f.target, f.target.taskId)[0]?.state).toBe(started ? 'unknown' : 'waiting')
    expect(() => f.journal.beginInput(lease)).toThrow('STALE_ATTEMPT')
    expect(!!restarted.claim(f.target, randomUUID())).toBe(!started)
  })
})

describe('dispatch coordinator (fake native adapter, no real messages)', () => {
  function runner() {
    const f = fixture(); f.journal.enable(f.target); f.create()
    const inspect = vi.fn(async () => null), submit = vi.fn(async (_request, canSubmit) => await canSubmit() ? f.evidence() : null)
    const isCurrent = vi.fn(async () => true)
    const executor = new CodexDispatchExecutor(f.journal, { inspect, submit }, { isCurrent })
    return { ...f, inspect, submit, isCurrent, executor }
  }
  it('persists intent before touching UI, confirms evidence once', async () => {
    const f = runner()
    f.submit.mockImplementation(async (_request, canSubmit) => { expect(f.first().state).toBe('submitting'); expect(await canSubmit()).toBe(true); return f.evidence() })
    await f.executor.tick(f.target); await f.executor.tick(f.target)
    expect(f.first().state).toBe('queued_confirmed'); expect(f.submit).toHaveBeenCalledTimes(1)
  })
  it('returns a read-only preflight wait without native submission', async () => {
    const f = runner(); f.inspect.mockResolvedValue('draft_present' as never)
    await f.executor.tick(f.target)
    expect(f.first()).toMatchObject({ state: 'waiting', reason: 'draft_present' }); expect(f.submit).not.toHaveBeenCalled()
  })
  it('blocks on account/team/target change or synchronous fence during asynchronous checks', async () => {
    const f = runner(); f.inspect.mockImplementation(async () => { f.executor.fence(); return null })
    await f.executor.tick(f.target)
    expect(f.first().state).toBe('cancelled'); expect(f.submit).not.toHaveBeenCalled()
  })
  it('rechecks account while staging; lost authorization yields unknown, never a second press', async () => {
    const f = runner(); f.submit.mockImplementation(async (_request, canSubmit) => {
      f.isCurrent.mockResolvedValue(false); expect(await canSubmit()).toBe(false); return null
    })
    await f.executor.tick(f.target); await f.executor.tick(f.target)
    expect(f.first().state).toBe('unknown'); expect(f.submit).toHaveBeenCalledTimes(1)
  })
  it('does not persist raw adapter errors or resend after an ambiguous submit failure', async () => {
    const f = runner(); f.submit.mockRejectedValue(new Error('sensitive /private/path message text'))
    await f.executor.tick(f.target); await f.executor.tick(f.target)
    expect(f.first()).toMatchObject({ state: 'unknown', reason: 'delivery_unconfirmed' })
    expect(JSON.stringify(f.first())).not.toContain('sensitive'); expect(f.submit).toHaveBeenCalledTimes(1)
  })
  it('does not overlap async operations or reclaim a running executor on a timer', async () => {
    const f = runner(); let resolve!: (value: CodexDispatchEvidence) => void
    f.submit.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = f.executor.tick(f.target)
    await vi.waitFor(() => expect(resolve).toBeDefined())
    await f.executor.tick(f.target); f.advance(86_400_001)
    expect(f.claim()).toBeUndefined(); expect(f.submit).toHaveBeenCalledTimes(1)
    resolve(f.evidence()); await pending
    expect(f.first().state).toBe('queued_confirmed')
  })
})
