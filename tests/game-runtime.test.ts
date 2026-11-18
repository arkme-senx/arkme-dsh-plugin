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

it('reconnects the original membership without creating or joining again', async () => {
  vi.useFakeTimers()
  const f = fixture(), r = new GameRuntime(f.api, () => {}, () => {})
  await r.enter({kind:'create'})
  const state = r.state, me = r.me
  transport.status?.(false)
  await r.reconnect()
  expect(r.online).toBe(true)
  expect(r.state).toBe(state)
  expect(r.me).toBe(me)
  expect(f.actions.filter(a => a === 'create')).toHaveLength(1)
  expect(f.actions).toContain('credentials')
  await r.leave()
})
it('does not log in again when reconnect discovers a closed room', async () => {
  vi.useFakeTimers()
  const f = fixture(), r = new GameRuntime(f.api, () => {}, () => {})
  await r.enter({kind:'create'})
  f.reply.room.status = 'closed'
  await r.reconnect()
  expect(r.closed).toBe(true)
  expect(r.error).toBe('房间已结束')
  expect(f.actions).not.toContain('credentials')
})

it('serializes repeated reconnect clicks and retains a retry path after a transient failure', async () => {
  vi.useFakeTimers()
  const f=fixture(), r=new GameRuntime(f.api,()=>{},()=>{})
  await r.enter({kind:'create'})
  let resolve!: () => void
  const gate=new Promise<void>(r=>{resolve=r})
  f.api.mockImplementationOnce(async()=>{await gate; throw Error('请求超时，请重试')})
  const first=r.reconnect()
  expect(r.reconnecting).toBe(true)
  await r.reconnect()
  resolve(); await first
  expect(r.closed).toBe(false)
  expect(r.reconnecting).toBe(false)
  await r.reconnect()
  expect(r.error).toBe('')
  await r.leave()
})
it('ends locally after admission expires without closing a different membership', async () => {
  vi.useFakeTimers()
  const f=fixture(), r=new GameRuntime(f.api,()=>{},()=>{})
  await r.enter({kind:'create'})
  f.api.mockRejectedValueOnce(Error('房间或成员身份已失效，请退出后重新进入'))
  await r.reconnect()
  expect(r.closed).toBe(true)
  expect(f.actions).not.toContain('close')
})
it('keeps a guest paused until a new host snapshot arrives after reconnect', async () => {
  vi.useFakeTimers()
  const f=fixture()
  f.reply.room.status='open'
  f.reply.room.host_membership_id='other-host'
  f.reply.room.members.push({...f.reply.room.members[0]!,membership_id:'other-host',registration_id:'other-user',join_seq:0})
  const r=new GameRuntime(f.api,()=>{},()=>{})
  await r.enter({kind:'join',roomId:f.reply.room.room_id,token:'test'})
  transport.status?.(false)
  await r.reconnect()
  expect(r.paused).toBe(true)
  expect(f.actions).not.toContain('create')
  expect(f.actions.filter(a=>a==='join')).toHaveLength(1)
  expect(transport.messages.at(-1).type).toBe('sync')
  transport.receive?.({to:'group',from:'other-user',type:'TIMCustomElem',payload:{extension:'arkme.game.v1',data:JSON.stringify({protocol_version:1,room_id:f.reply.room.room_id,runtime_id:'runtime',type:'snapshot',payload:{version:1,round:'lobby',count:2,players:['other-host','host'],ready:[],turnSeconds:90}})}})
  expect(r.paused).toBe(false)
  expect(r.state?.turnSeconds).toBe(90)
  await r.leave()
})
it('refreshes credentials before broadcasting changed membership on reconnect', async () => {
  vi.useFakeTimers()
  const f=fixture(), r=new GameRuntime(f.api,()=>{},()=>{})
  await r.enter({kind:'create'})
  f.reply.room.members.push({...f.reply.room.members[0]!,membership_id:'new-member',registration_id:'new-user',join_seq:2})
  transport.send.mockImplementation(async()=>{
    if(!f.actions.includes('credentials'))throw Error('IM not ready')
  })
  await r.reconnect()
  expect(f.actions).toContain('credentials')
  expect(r.error).toBe('')
  transport.send.mockImplementation(async()=>{})
  await r.leave()
})
it('readmits an expired guest with a fresh idempotency key instead of ending the window', async () => {
  vi.useFakeTimers()
  const f=fixture();f.reply.room.status='open';f.reply.room.host_membership_id='another-host'
  let expired=false
  const calls: Array<{a:string,b:Record<string,unknown>}> = []
  const api=async(a:string,b:Record<string,unknown>)=>{
    calls.push({a,b})
    if(a==='heartbeat' && expired)throw Error('房间或成员身份已失效，请退出后重新进入')
    if(a==='join' && expired){
      f.reply.membership_id='new-membership';f.reply.room.members[0]!.membership_id='new-membership';expired=false
    }
    return f.api(a)
  }
  const r=new GameRuntime(api,()=>{},()=>{})
  await r.enter({kind:'join',roomId:f.reply.room.room_id,token:'original-key'})
  expired=true
  await r.reconnect()
  expect(r.closed).toBe(false)
  expect(r.me).toBe('new-membership')
  expect(r.paused).toBe(true) // only a host snapshot can restore play
  const joins=calls.filter(c=>c.a==='join')
  expect(joins).toHaveLength(2)
  expect(joins[1]!.b.request_id).not.toBe(joins[0]!.b.request_id)
  expect(joins[1]!.b.invite_token).toBe('original-key')
  expect(calls.some(c=>c.a==='create')).toBe(false)
  await r.leave()
})
