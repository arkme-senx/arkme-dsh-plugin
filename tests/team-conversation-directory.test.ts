// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: mock }))
import { startTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory, mergeTeamDirectoryRows } from '../src/client/team-conversation-directory.js'
let stops: Array<() => void> = []
afterEach(() => { stops.forEach(stop => stop()); stops = []; mock.mockReset() })
const channel = { teamRef: 'ref', name: '团队', jotmoId: 'team_id', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }
const item = (side: 'team' | 'external', time = 1): TeamConversation => ({ ref: `${side}-ref`, key: `${side}-key`, channel, side, lastSeq: 1, latestTeamReplySeq: 0, myReadSeq: 0, unread: 1, needsReply: true, blocked: false, revision: 1, updatedAt: time })
it('merges Team rows only in presentation and preserves pinned rows and ordinary identities', () => {
  const pinned = { kind: 'source', activeAtMillis: 1, pinned: true }, ordinary = { kind: 'source', activeAtMillis: 10, pinned: false }
  const result = mergeTeamDirectoryRows([pinned, ordinary], [item('team', 15), item('external', 5)])
  expect(result[0]).toBe(pinned); expect(result[2]).toBe(ordinary)
  expect(result.map(r => r.activeAtMillis)).toEqual([1, 15, 10, 5])
})
it('a failure on one side preserves known rows and allows the other side to refresh', async () => {
  mock.mockImplementation(async (_, { side }) => ({ items: [item(side)], hasMore: false }))
  stops.push(startTeamDirectory('a'))
  await vi.waitFor(() => expect(readTeamDirectory('a').items).toHaveLength(2))
  mock.mockImplementation(async (_, { side }) => {
    if (side === 'team') throw new Error('Team offline')
    return { items: [item(side, 3)], hasMore: false }
  })
  await refreshTeamDirectory('a')
  expect(readTeamDirectory('a').items.map(c => c.updatedAt)).toEqual([3, 1])
  expect(mock.mock.calls.every(([op]) => op === 'team.app.conversations')).toBe(true)
})
it('account switch discards late responses from the old account', async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise(ok => { resolve = ok })
  mock.mockReturnValue(pending)
  const stop = startTeamDirectory('old'); stops.push(stop); stop()
  mock.mockResolvedValue({ items: [], hasMore: false }); stops.push(startTeamDirectory('new'))
  resolve({ items: [item('team')], hasMore: false })
  await vi.waitFor(() => expect(readTeamDirectory('new').loading).toBe(false))
  expect(readTeamDirectory('new').items).toEqual([]); expect(readTeamDirectory('old').items).toEqual([])
})
it('revocation wins over in-flight old previews, while a fresh list can restore new authorization', async () => {
  mock.mockImplementation(async (_, { side }) => ({ items: side === 'team' ? [item(side)] : [], hasMore: false }))
  stops.push(startTeamDirectory('a'))
  await vi.waitFor(() => expect(readTeamDirectory('a').items).toHaveLength(1))
  let resolve!: (value: unknown) => void
  mock.mockReturnValue(new Promise(ok => { resolve = ok }))
  const pending = refreshTeamDirectory('a')
  discardTeamDirectory('a', item('team'))
  expect(readTeamDirectory('a').items).toEqual([])
  mock.mockResolvedValue({ items: [], hasMore: false })
  resolve({ items: [item('team')], hasMore: false }); await pending
  expect(readTeamDirectory('a').items).toEqual([])
})
