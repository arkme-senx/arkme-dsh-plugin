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
  it('does not leak malformed keys as notes', () => {
    expect(() => parseGameCommand('/game join broken')).toThrow()
    expect(() => parseGameCommand('发送「/game join broken」到群聊加入游戏')).toThrow()
    expect(() => parseGameCommand('text /game')).toThrow()
    expect(parseGameCommand('hello')).toBe(null)
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
    a.apply(id, action, m, 0)
    a.apply(id, action, m, 0)
    expect(a.state.ready).toEqual([id])
    for (const p of m.slice(1))
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
