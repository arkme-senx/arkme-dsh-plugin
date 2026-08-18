import { describe, expect, it } from 'vitest'
import { ArkmeOutgoingCallBroker } from '../src/outgoing-call-broker.js'

class FakeClock {
  now = 1_000
  private nextId = 1
  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  readonly setTimer = (callback: () => void, delay: number): number => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + delay, callback })
    return id
  }

  readonly clearTimer = (id: number): void => {
    this.timers.delete(id)
  }

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (next === undefined) break
      this.now = next[1].at
      this.timers.delete(next[0])
      next[1].callback()
    }
    this.now = target
  }
}

function setup() {
  const clock = new FakeClock()
  let sequence = 0
  const broker = new ArkmeOutgoingCallBroker({
    now: () => clock.now,
    randomId: () => `id-${String(++sequence)}`,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { broker, clock }
}

describe('ArkmeOutgoingCallBroker', () => {
  it('allows one page to claim an intent and resolves only with its one-time token', async () => {
    const { broker } = setup()
    const pending = broker.request({
      userId: 7,
      sourceRef: 'arkme-source-v1.payload.signature',
      displayName: '小林',
      mediaType: 'video',
    })

    const claim = broker.claim(7)!
    expect(claim).toMatchObject({
      sourceRef: 'arkme-source-v1.payload.signature',
      displayName: '小林',
      mediaType: 'video',
    })
    expect(broker.claim(7)).toBeNull()
    expect(() => broker.resolveIntent({
      userId: 8,
      intentId: claim.intentId,
      claimToken: claim.claimToken,
      outcome: { status: 'calling' },
    })).toThrow(/账号/)
    expect(() => broker.resolveIntent({
      userId: 7,
      intentId: claim.intentId,
      claimToken: 'wrong-token',
      outcome: { status: 'calling' },
    })).toThrow(/领取凭据/)

    broker.resolveIntent({
      userId: 7,
      intentId: claim.intentId,
      claimToken: claim.claimToken,
      outcome: { status: 'calling' },
    })

    await expect(pending).resolves.toEqual({ status: 'calling', displayName: '小林', mediaType: 'video' })
    expect(() => broker.resolveIntent({
      userId: 7,
      intentId: claim.intentId,
      claimToken: claim.claimToken,
      outcome: { status: 'calling' },
    })).toThrow(/已失效/)
  })

  it('expires an unclaimed intent after 30 seconds with call-ui-unavailable', async () => {
    const { broker, clock } = setup()
    const pending = broker.request({ userId: 7, sourceRef: 'source', displayName: '小林', mediaType: 'audio' })

    clock.advanceBy(30_001)

    await expect(pending).rejects.toMatchObject({ code: 'call-ui-unavailable' })
    expect(broker.claim(7)).toBeNull()
  })

  it('cancels an unclaimed intent when its Tool signal aborts', async () => {
    const { broker } = setup()
    const abort = new AbortController()
    const pending = broker.request({
      userId: 7,
      sourceRef: 'source',
      displayName: '小林',
      mediaType: 'audio',
      signal: abort.signal,
    })

    abort.abort()

    await expect(pending).rejects.toMatchObject({ code: 'call-cancelled' })
    expect(broker.claim(7)).toBeNull()
  })

  it('keeps a claimed browser call independent when the Tool signal aborts', async () => {
    const { broker } = setup()
    const abort = new AbortController()
    const pending = broker.request({
      userId: 7,
      sourceRef: 'source',
      displayName: '小林',
      mediaType: 'audio',
      signal: abort.signal,
    })
    const claim = broker.claim(7)!

    abort.abort()

    await expect(pending).rejects.toMatchObject({ code: 'call-cancelled' })
    expect(() => broker.resolveIntent({
      userId: 7,
      intentId: claim.intentId,
      claimToken: claim.claimToken,
      outcome: { status: 'calling' },
    })).not.toThrow()
  })

  it('isolates pending intents and clear operations by account', async () => {
    const { broker } = setup()
    const first = broker.request({ userId: 7, sourceRef: 'first', displayName: '甲', mediaType: 'audio' })
    const second = broker.request({ userId: 8, sourceRef: 'second', displayName: '乙', mediaType: 'video' })

    broker.clearUser(7, '账号已退出')

    await expect(first).rejects.toMatchObject({ code: 'call-cancelled', message: '账号已退出' })
    const claim = broker.claim(8)!
    broker.resolveIntent({
      userId: 8,
      intentId: claim.intentId,
      claimToken: claim.claimToken,
      outcome: { status: 'calling' },
    })
    await expect(second).resolves.toMatchObject({ displayName: '乙' })
  })

  it('enforces one active lease and extends it only for the matching request', () => {
    const { broker, clock } = setup()

    expect(broker.acquireLease(7, 'request-1')).toBe(121_000)
    expect(() => broker.acquireLease(7, 'request-2')).toThrow(/已有通话/)
    clock.advanceBy(15_000)
    expect(broker.heartbeatLease(7, 'request-1')).toBe(136_000)
    expect(() => broker.heartbeatLease(7, 'request-2')).toThrow(/租约/)

    clock.advanceBy(120_001)

    expect(() => broker.heartbeatLease(7, 'request-1')).toThrow(/租约/)
    expect(broker.acquireLease(7, 'request-2')).toBe(256_001)
    broker.releaseLease(7, 'request-1')
    expect(() => broker.acquireLease(7, 'request-3')).toThrow(/已有通话/)
    broker.releaseLease(7, 'request-2')
    expect(broker.acquireLease(7, 'request-3')).toBe(256_001)
  })

  it('disposes all pending requests and leases', async () => {
    const { broker } = setup()
    const pending = broker.request({ userId: 7, sourceRef: 'source', displayName: '小林', mediaType: 'audio' })
    broker.acquireLease(7, 'request-1')

    broker.dispose()

    await expect(pending).rejects.toMatchObject({ code: 'call-cancelled' })
    expect(() => broker.heartbeatLease(7, 'request-1')).toThrow(/租约/)
  })
})
