import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { ManagedTurnFunding } from '../src/managed-ai/operation.js'

function fixture() {
  const events: SessionEvent[] = []
  const session = { id: 'session-1', snapshotEvents: () => events } as unknown as Session
  const close = vi.fn(async (_uid: string, _bearer: string) => {})
  const failed = vi.fn()
  const funding = new ManagedTurnFunding(id => id === session.id ? session : undefined, close, failed)
  const request = { sessionId: session.id } as GenerateOptions
  const start = (turn: number) => events.push({ type: 'turn/start', seq: events.length, time: Date.now(), data: { turn } } as SessionEvent)
  const end = (turn: number) => {
    const event = { type: 'turn/end', seq: events.length, time: Date.now(), data: { turn, reason: { kind: 'completed' } } } as SessionEvent
    events.push(event)
    return event
  }
  return { events, session, close, failed, funding, request, start, end }
}

describe('managed funding follows official DSH turn boundaries', () => {
  it('shares tool follow-ups and compaction, then closes exactly that turn', async () => {
    const f = fixture()
    f.start(0)
    const uid = f.funding.prepare(f.request, 'account-a')
    expect(uid).toMatch(/^[a-f0-9]{64}$/)
    expect(f.funding.prepare(f.request, 'account-a')).toBe(uid)
    expect(f.funding.prepare({ ...f.request, purpose: 'compaction' }, 'account-a')).toBe(uid)
    expect(f.funding.prepare({ ...f.request, purpose: 'session-title' }, 'account-a')).toBeUndefined()
    const ended = f.end(0)
    f.start(1) // asynchronous end notification must never close the next turn
    const next = f.funding.prepare(f.request, 'account-a')
    expect(next).not.toBe(uid)
    await f.funding.ended(f.session, ended)
    await f.funding.ended(f.session, ended)
    expect(f.close.mock.calls).toEqual([[uid, 'account-a']])
    await f.funding.ended(f.session, f.end(1))
    expect(f.close.mock.calls[1]).toEqual([next, 'account-a'])
    expect(f.funding.prepare(f.request, 'account-a')).toBeUndefined()
  })

  it('reconstructs an open turn after restart without treating session as authorization', () => {
    const f = fixture()
    expect(f.funding.prepare(f.request, 'a')).toBeUndefined()
    f.start(0)
    const uid = f.funding.prepare(f.request, 'a')
    const restarted = new ManagedTurnFunding(() => f.session, f.close, f.failed)
    expect(restarted.prepare(f.request, 'a')).toBe(uid)
    f.end(0)
    expect(restarted.prepare(f.request, 'a')).toBeUndefined()
  })

  it('closes with captured account credentials and contains network errors', async () => {
    const f = fixture()
    f.start(0)
    f.funding.prepare(f.request, 'a')
    f.funding.prepare(f.request, 'b')
    f.close.mockRejectedValue(new Error('offline'))
    await expect(f.funding.ended(f.session, f.end(0))).resolves.toBeUndefined()
    expect(f.close.mock.calls.map(call => call[1])).toEqual(['a', 'b'])
    expect(f.failed).toHaveBeenCalledTimes(2)
  })
})
