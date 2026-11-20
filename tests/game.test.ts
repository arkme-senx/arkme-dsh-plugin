import { describe, it, expect } from 'vitest'
import { parseGameCommand, invitation } from '../src/client/game/command.js'
import { cells, camps, createBoard, validatePath, move, timeout, retire } from '../src/client/game/checkers.js'
describe('game keys', () => {
  it('sends copied invitation as a note and executes only the bare command', () => {
    const r = 'a'.repeat(32),
      t = 'b'.repeat(64)
    expect(invitation(r,t)).toBe(`发送「/game join ${r}.${t}」到群聊加入游戏`)
    expect(parseGameCommand(invitation(r, t))).toBeNull()
    expect(parseGameCommand(`  ${invitation(r,t)}\n`)).toBeNull()
    expect(parseGameCommand(`/game join ${r}.${t}`)?.kind).toBe('join')
    expect(parseGameCommand(' /game ')).toEqual({ kind: 'create' })
  })
  it('sends text that is not an exact game command as an ordinary note', () => {
    const key = `${'a'.repeat(32)}.${'b'.repeat(64)}`
    for (const text of ['text /game', '/game 你好', '/game\n一起玩', '说明：/game 打开游戏',
      '/games', '/game join broken', '发送「/game join broken」到群聊加入游戏',
      `/game join ${key} 一起玩`, `邀请 /game join ${key}`, 'hello']) {
      expect(parseGameCommand(text)).toBeNull()
    }
  })
})
describe('Chinese checkers', () => {
  it('has 121 unique cells and six disjoint ten-piece camps', () => {
    expect(cells).toHaveLength(121)
    expect(new Set(cells.map(String)).size).toBe(121)
    expect(camps.every((c) => c.length === 10)).toBe(true)
  })
  for (const n of [2, 3, 4, 6])
    it(`initializes ${n} players`, () => {
      expect(
        Object.keys(
          createBoard(
            Array.from({ length: n }, (_, i) => String(i)),
            0,
          ).pieces,
        ),
      ).toHaveLength(n * 10)
    })
  it('allows symmetric long jumps but rejects blockers and asymmetric jumps', () => {
    const b = createBoard(['a', 'b'], 0)
    b.pieces = { '-4,0': 'a', '-1,0': 'b' }
    expect(
      validatePath(b, 'a', [
        [-4, 0],
        [2, 0],
      ]),
    ).toBe(true)
    expect(
      validatePath(b, 'a', [
        [-4, 0],
        [3, 0],
      ]),
    ).toBe(false)
    b.pieces['0,0'] = 'b'
    expect(
      validatePath(b, 'a', [
        [-4, 0],
        [2, 0],
      ]),
    ).toBe(false)
  })
  it('validates chains against the changing board and forbids revisiting', () => {
    const b = createBoard(['a', 'b'], 0)
    b.pieces = { '-4,0': 'a', '-1,0': 'b', '2,1': 'b' }
    expect(
      validatePath(b, 'a', [
        [-4, 0],
        [2, 0],
        [2, 2],
      ]),
    ).toBe(true)
    expect(
      validatePath(b, 'a', [
        [-4, 0],
        [2, 0],
        [-4, 0],
      ]),
    ).toBe(false)
    expect(
      move(
        b,
        'a',
        [
          [-4, 0],
          [2, 0],
          [2, 2],
        ],
        1,
      ).pieces['2,2'],
    ).toBe('a')
  })
  it('rejects observers and expired actions', () => {
    const b = createBoard(['a', 'b'], 0)
    expect(
      validatePath(b, 'observer', [
        [5, -4],
        [4, -4],
      ]),
    ).toBe(false)
    expect(() =>
      move(
        b,
        'a',
        [
          [5, -4],
          [4, -4],
        ],
        60000,
      ),
    ).toThrow()
    expect(timeout(b, 60000).turn).toBe(1)
  })
  it('removes a retiring player and awards remaining player', () => {
    const b = retire(createBoard(['a', 'b'], 0), 'b', 1)
    expect(b.winner).toBe('a')
    expect(Object.values(b.pieces).includes('b')).toBe(false)
  })
})

import { Authority } from '../src/client/game/authority.js'
import type { Member } from '../src/client/game/contracts.js'
const members = (n: number): Member[] =>
  Array.from({ length: n }, (_, i) => ({
    membership_id: String(i).padStart(32, '0'),
    user_id: i + 1,
    client_id: 1,
    registration_id: `u${i}`,
    binding_generation: 'b',
    join_seq: i + 1,
    status: 'active',
    lease_expires_at: 999999,
  }))
describe('host authority', () => {
  it('assigns seats by admission order and never lets an observer ready', () => {
    const m = members(8),
      a = new Authority(m[0]!.membership_id)
    a.sync([...m].reverse(), 0)
    expect(a.state.players).toEqual(m.slice(0, 6).map((x) => x.membership_id))
    expect(
      a.apply(m[7]!.membership_id, { id: 'x', round: a.state.round, version: a.state.version, kind: 'ready' }, m, 0),
    ).toContain('观察者')
  })
  it('deduplicates ready and freezes roster after start', () => {
    const m = members(6),
      a = new Authority(m[0]!.membership_id)
    a.sync(m, 0)
    const id = m[0]!.membership_id
    const action = { id: 'ready', round: a.state.round, version: a.state.version, kind: 'ready' as const }
    const guest = m[1]!.membership_id
    a.apply(guest, action, m, 0)
    a.apply(guest, action, m, 0)
    expect(a.state.ready).toEqual([id, guest])
    for (const p of m.slice(2))
      a.apply(p.membership_id, { id: 'r', round: a.state.round, version: a.state.version, kind: 'ready' }, m, 0)
    expect(a.apply(id, { id: 'start', round: a.state.round, version: a.state.version, kind: 'start' }, m, 0)).toBe('')
    a.sync([...m, ...members(8).slice(6)], 0)
    expect(a.state.players).toHaveLength(6)
  })
  it('six-player snapshot fits the wire budget', () => {
    const m = members(6),
      a = new Authority(m[0]!.membership_id)
    a.sync(m, 0)
    a.state.board = createBoard(a.state.players, 0)
    a.state.round = crypto.randomUUID()
    const packet = {
      protocol_version: 1,
      room_id: 'r'.repeat(32),
      runtime_id: crypto.randomUUID(),
      type: 'snapshot',
      payload: a.state,
    }
    expect(new TextEncoder().encode(JSON.stringify(packet)).length).toBeLessThanOrEqual(4096)
  })
  it('blocks stale versions and pending admission before start', () => {
    const m = members(2),
      a = new Authority(m[0]!.membership_id)
    a.sync(m, 0)
    expect(
      a.apply(m[0]!.membership_id, { id: 'stale', round: 'lobby', version: 0, kind: 'count', value: 2 }, m, 0),
    ).toContain('更新')
  })
})

it('uses the configured duration for the first and following turns', () => {
  for (const seconds of [30,60,90,120]) {
    const b = createBoard(['a','b'], 1000, seconds)
    expect(b.deadline).toBe(1000+seconds*1000)
    expect(timeout(b,b.deadline).deadline).toBe(b.deadline+seconds*1000)
  }
})

it('only the host changes duration in the lobby, clears ready, and freezes it for the round', () => {
  const m = members(2), a = new Authority(m[0]!.membership_id)
  a.sync(m,0)
  let id = 0
  const act = (sender: string, kind: any, value?: unknown) => a.apply(sender,
    {id: String(++id), kind, value, round:a.state.round, version:a.state.version}, m,0)
  const host=m[0]!.membership_id, guest=m[1]!.membership_id
  act(host,'count',2)
  act(host,'ready')
  expect(act(guest,'duration',30)).toContain('不能')
  expect(act(host,'duration',31)).toContain('不能')
  expect(act(host,'duration',90)).toBe('')
  expect(a.state.ready).toEqual([host])
  act(host,'ready'); act(guest,'ready'); act(host,'start')
  expect(a.state.board?.deadline).toBe(90000)
  expect(act(host,'duration',120)).toContain('不能')
  a.state.board!.ended=true
  act(host,'next')
  expect(act(host,'duration',120)).toBe('')
})
it('keeps the host ready through roster, count, duration and next-round changes', () => {
  const m=members(3), host=m[0]!.membership_id, a=new Authority(host)
  a.sync(m.slice(0,2),0)
  expect(a.state.ready).toEqual([host])
  let id=0
  const act=(sender:string,kind:any,value?:unknown)=>a.apply(sender,{id:String(++id),kind,value,round:a.state.round,version:a.state.version},m,0)
  act(host,'count',2)
  act(m[1]!.membership_id,'ready')
  expect(a.state.ready).toHaveLength(2)
  act(host,'count',3)
  expect(a.state.ready).toEqual([host])
  act(m[1]!.membership_id,'ready')
  act(host,'duration',30)
  expect(a.state.ready).toEqual([host])
  a.sync(m.slice(0,2),0)
  expect(a.state.ready).toEqual([host])
  act(host,'ready')
  expect(a.state.ready).toEqual([host])
  act(host,'count',2)
  act(m[1]!.membership_id,'ready')
  expect(act(host,'start')).toBe('')
  a.state.board!.ended=true
  act(host,'next')
  expect(a.state.ready).toEqual([host])
})
it('preserves a disconnected player and restores the seat after readmission', () => {
  const m=members(2),a=new Authority(m[0]!.membership_id)
  a.sync(m,0);a.state.board=createBoard(a.state.players,0)
  const old=m[1]!.membership_id, pieces=Object.keys(a.state.board.pieces).length
  a.sync([m[0]!],1000)
  expect(Object.keys(a.state.board.pieces)).toHaveLength(pieces)
  expect(a.state.board.ended).toBe(false)
  const returned={...m[1]!,membership_id:'returned',join_seq:3}
  a.sync([m[0]!,returned],2000)
  expect(a.state.board.players[1]!.id).toBe('returned')
  expect(Object.values(a.state.board.pieces).filter(x=>x==='returned')).toHaveLength(10)
  expect(Object.values(a.state.board.pieces)).not.toContain(old)
})
it('does not give a retired player their seat back on readmission', () => {
  const m=members(3),a=new Authority(m[0]!.membership_id)
  a.sync(m,0);a.state.board=createBoard(a.state.players,0)
  a.state.board=retire(a.state.board,m[1]!.membership_id,1000)
  a.sync([m[0]!,m[2]!,{...m[1]!,membership_id:'returned',join_seq:4}],2000)
  expect(a.state.players).not.toContain('returned')
  expect(a.state.board.players.some(p=>p.id==='returned')).toBe(false)
})
it('never restores a disconnected seat to another device or user', () => {
  const m=members(2),a=new Authority(m[0]!.membership_id)
  a.sync(m,0);a.state.board=createBoard(a.state.players,0)
  a.sync([m[0]!,{...m[1]!,membership_id:'other-device',client_id:999}],1000)
  expect(a.state.board.players[1]!.id).toBe(m[1]!.membership_id)
  expect(a.state.players).not.toContain('other-device')
})
it('still retires disconnected players only after three timed-out turns', () => {
  const m=members(3),a=new Authority(m[0]!.membership_id)
  a.sync(m,0);a.state.board=createBoard(a.state.players,0,30)
  const missing=m[1]!.membership_id
  a.sync([m[0]!,m[2]!],1000)
  for(let i=0;i<3;i++){
    a.state.board.turn=1
    a.tick(a.state.board.deadline)
  }
  expect(a.state.board.players[1]!.retired).toBe(true)
  expect(Object.values(a.state.board.pieces)).not.toContain(missing)
  a.sync([m[0]!,m[2]!,{...m[1]!,membership_id:'spectator'}],a.state.board.deadline)
  expect(a.state.players).not.toContain('spectator')
})
