import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'
import { ObservedArkmeSessionStore, type SessionTransitionObserver } from '../src/openapi-mcp/session-observer.js'

function jwt(userId: number, clientId: number, marker: string): string {
  const encoded = Buffer.from(JSON.stringify({ user_id: userId, client_id: clientId, exp: 2_000_000_000 })).toString('base64url')
  return `header.${encoded}.${marker}`
}

function session(userId: number, clientId: number, marker: string): ArkmeSessionCredentials {
  return { userId, accessToken: jwt(userId, clientId, marker), refreshToken: `refresh-${marker}` }
}

class MemorySessionStore implements ArkmeSessionStore {
  failWrite = false
  constructor(public value: ArkmeSessionCredentials | undefined, private readonly order: string[]) {}
  async read(): Promise<ArkmeSessionCredentials | undefined> { return this.value }
  async write(value: ArkmeSessionCredentials): Promise<void> {
    this.order.push('inner-write')
    if (this.failWrite) throw new Error('write failed')
    this.value = value
  }
  async delete(): Promise<void> { this.order.push('inner-delete'); this.value = undefined }
}

describe('active session observation', () => {
  it('does not run lifecycle work when an already empty session is deleted again', async () => {
    const order: string[] = []
    const inner = new MemorySessionStore(undefined, order)
    const observer: SessionTransitionObserver<string> = {
      prepare: vi.fn(async () => 'ticket'), committed: vi.fn(), rolledBack: vi.fn(),
    }
    const store = new ObservedArkmeSessionStore(inner)
    store.attach(observer)

    await store.delete()

    expect(order).toEqual(['inner-delete'])
    expect(observer.prepare).not.toHaveBeenCalled()
  })

  it('fully bypasses lifecycle work for same user and login device Access refresh', async () => {
    const order: string[] = []
    const inner = new MemorySessionStore(session(42, 7, 'old'), order)
    const observer: SessionTransitionObserver<string> = {
      prepare: vi.fn(async () => { order.push('prepare'); return 'ticket' }),
      committed: vi.fn(() => { order.push('committed') }),
      rolledBack: vi.fn(() => { order.push('rolled-back') }),
    }
    const store = new ObservedArkmeSessionStore(inner)
    store.attach(observer)

    await store.write(session(42, 7, 'refreshed'))

    expect(order).toEqual(['inner-write'])
    expect(observer.prepare).not.toHaveBeenCalled()
  })

  it('prepares before account visibility and reports commit or rollback', async () => {
    const order: string[] = []
    const inner = new MemorySessionStore(session(42, 7, 'old'), order)
    const observer: SessionTransitionObserver<string> = {
      prepare: vi.fn(async () => { order.push('prepare-dispose-old-tools'); return 'ticket' }),
      committed: vi.fn(() => { order.push('committed') }),
      rolledBack: vi.fn(() => { order.push('rolled-back') }),
    }
    const store = new ObservedArkmeSessionStore(inner)
    store.attach(observer)

    await store.write(session(99, 8, 'new'))
    expect(order).toEqual(['prepare-dispose-old-tools', 'inner-write', 'committed'])

    order.length = 0
    inner.failWrite = true
    await expect(store.write(session(100, 9, 'failed'))).rejects.toThrow('write failed')
    expect(order).toEqual(['prepare-dispose-old-tools', 'inner-write', 'rolled-back'])
  })
})
