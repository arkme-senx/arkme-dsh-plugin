import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DshRemoteCommandLedger, dshRemoteCommandRpcId } from '../src/dsh-remote/command-ledger.js'

const identity = {
  accountId: 'account-1', runtimeRef: 'runtime-1', requestRef: 'request-1',
  operation: 'session.prompt' as const,
  arguments: { sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: 'top secret prompt' }] },
  executeBeforeMillis: 2_000,
}

describe('encrypted append-only remote command ledger', () => {
  it('shares the deterministic command identity with mobile', () => {
    expect(dshRemoteCommandRpcId({
      accountId: 'account_a', runtimeRef: 'runtime_ref', requestRef: 'request_ref',
    })).toBe('remote_KkImu8EdZcAnoNep7W_uWUB7rhLP3kiu')
  })

  it('persists pending before execution and returns the original completed result for duplicates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-remote-ledger-'))
    const key = Buffer.alloc(32, 9)
    const first = new DshRemoteCommandLedger(directory, key, { now: () => 1_000 })
    const began = first.begin(identity)
    expect(began.duplicate).toBe(false)
    expect(began.entry.state).toBe('pending')
    first.close()

    const reopened = new DshRemoteCommandLedger(directory, key, { now: () => 1_100 })
    expect(reopened.pending('account-1')).toHaveLength(1)
    const completed = reopened.complete(identity, { accepted: true, text: 'private result' })
    expect(completed.state).toBe('completed')
    const duplicate = reopened.begin(identity)
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.entry.payload).toEqual({ result: { accepted: true, text: 'private result' } })
    reopened.close()

    const databaseBytes = await readFile(join(directory, 'remote-command-ledger.sqlite3'))
    expect(databaseBytes.includes(Buffer.from('top secret prompt'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('private result'))).toBe(false)
  })

  it('rejects request_ref reuse with different canonical arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-remote-ledger-'))
    const ledger = new DshRemoteCommandLedger(directory, Buffer.alloc(32, 7), { now: () => 1_000 })
    ledger.begin(identity)
    expect(() => ledger.begin({ ...identity, arguments: { sessionId: 'other' } })).toThrow(/不同操作或参数/)
    ledger.close()
  })

  it('marks an uncertain crash window and never overwrites it with success', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-remote-ledger-'))
    const ledger = new DshRemoteCommandLedger(directory, Buffer.alloc(32, 5), { now: () => 1_000 })
    ledger.begin(identity)
    expect(ledger.markOutcomeUnknown(identity, 'DSH accepted before local commit')).toMatchObject({
      state: 'outcome_unknown', payload: { reason: 'DSH accepted before local commit' },
    })
    expect(() => ledger.complete(identity, { accepted: true })).toThrow(/禁止覆盖/)
    ledger.close()
  })

  it('maps the same remote request to a stable DSH rpc id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-remote-ledger-'))
    const key = Buffer.alloc(32, 3)
    const first = new DshRemoteCommandLedger(directory, key, { now: () => 1_000 })
    const rpcId = first.begin(identity).entry.dshRpcId
    first.close()
    const second = new DshRemoteCommandLedger(directory, key, { now: () => 1_100 })
    expect(second.begin(identity).entry.dshRpcId).toBe(rpcId)
    second.close()
  })

  it('keeps an accepted crash-window command eligible for reconciliation after its deadline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-remote-ledger-'))
    const ledger = new DshRemoteCommandLedger(directory, Buffer.alloc(32, 4), { now: () => 3_000 })
    ledger.begin(identity)

    expect(ledger.pending('account-1', 3_000)).toEqual([])
    expect(ledger.unsettledForReconciliation('account-1', 3_000)).toMatchObject([{
      requestRef: 'request-1',
      state: 'pending',
      executeBeforeMillis: 2_000,
    }])

    const recovered = ledger.unsettledForReconciliation('account-1', 3_000)[0]
    expect(recovered?.dshRpcId).toMatch(/^remote_/)
    expect(ledger.markOutcomeUnknown(identity, 'history did not prove the result').state).toBe('outcome_unknown')
    expect(ledger.unsettledForReconciliation('account-1', 3_000)).toEqual([])
    ledger.close()
  })
})
