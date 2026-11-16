import { describe, it, expect, vi, afterEach } from 'vitest'
const transport = vi.hoisted(() => ({
  messages: [] as any[],
  send: vi.fn(async () => {}),
  receive: undefined as undefined | ((m: any) => void),
  status: undefined as undefined | ((r: boolean) => void),
}))
vi.mock('../src/client/game/im.js', () => ({
  GameIM: class {
    group: string
    constructor(_a: number, g: string, receive: any, status: any) {
      this.group = g
      transport.receive = receive
      transport.status = status
    }
    async login() {
      transport.status?.(true)
    }
    async send(data: any) {
      transport.messages.push(data)
      return transport.send()
    }
    async destroy() {}
    async history() {
      return []
    }
    async text(text: string) {
      return { ID: 'text', type: 'TIMTextElem', payload: { text } }
    }
  },
}))
import { GameRuntime } from '../src/client/game/runtime.js'
import type { Reply } from '../src/client/game/contracts.js'
function fixture() {
  const now = Date.now(),
    member = {
      membership_id: 'host',
      user_id: 1,
      client_id: 1,
      registration_id: 'u',
      binding_generation: 'b',
      join_seq: 1,
      status: 'active' as const,
      lease_expires_at: now + 60000,
    }
  const reply: Reply = {
    server_time: now,
    membership_id: 'host',
    room: {
      room_id: 'a'.repeat(32),
      game_type: 'chinese_checkers',
      status: 'creating',
      runtime_id: 'runtime',
      host_membership_id: 'host',
      im_group_id: 'group',
      members: [member],
      membership_version: 1,
    },
    invite_token: 'b'.repeat(64),
    credentials: { sdk_app_id: 123, user_id: 'u', user_sig: 'test', expires_at: now + 3600000 },
  }
  let activateFails = false
  const actions: string[] = []
  const api = vi.fn(async (action: string) => {
    actions.push(action)
    if (action === 'activate') {
      if (activateFails) {
        activateFails = false
        throw new Error('transient')
      }
      reply.room.status = 'open'
    }
    return structuredClone(reply)
  })
  return {
    reply,
    api,
    actions,
    failActivation: () => {
      activateFails = true
    },
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  transport.messages.length = 0
})
describe('independent game runtime recovery', () => {
  it('logs in and registers through game owner before room admission', async () => {
    vi.useFakeTimers()
    const f = fixture(),
      r = new GameRuntime(
        f.api,
        () => {},
        () => {},
      )
    await r.enter({ kind: 'create' })
    expect(f.actions.slice(0, 3)).toEqual(['prepare', 'ready', 'create'])
    expect(r.host).toBe(true)
    await r.leave()
    expect(f.actions.at(-1)).toBe('close')
  })
  it('keeps a retry path and heartbeat after activation failure with existing state', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.failActivation()
    const r = new GameRuntime(
      f.api,
      () => {},
      () => {},
    )
    await r.enter({ kind: 'create' })
    expect(r.state).toBeDefined()
    expect(r.initializationFailed).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.actions).toContain('heartbeat')
    await r.retry()
    expect(r.initializationFailed).toBe(false)
    expect(r.room?.status).toBe('open')
    await r.leave()
  })
  it('compensates admission that finishes after cancellation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: () => void
    const gate = new Promise<void>((ok) => {
      release = ok
    })
    const api = async (a: string, b: Record<string, unknown>) => {
      if (a === 'create') await gate
      return f.api(a)
    }
    const r = new GameRuntime(
      api,
      () => {},
      () => {},
    )
    const entering = r.enter({ kind: 'create' })
    await vi.advanceTimersByTimeAsync(1)
    await r.leave()
    release()
    await entering
    expect(f.actions).toContain('leave')
  })
  it('uses server clock and stops retrying a terminal room', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.reply.server_time -= 120000
    f.reply.room.members[0]!.lease_expires_at -= 120000
    const r = new GameRuntime(
      f.api,
      () => {},
      () => {},
    )
    await r.enter({ kind: 'create' })
    expect(r.paused).toBe(false)
    f.reply.room.status = 'closed'
    await vi.advanceTimersByTimeAsync(11000)
    expect(r.closed).toBe(true)
    expect(r.error).toBe('房间已结束')
  })
})
