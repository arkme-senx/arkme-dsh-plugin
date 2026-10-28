// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: mock }))
import { startTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory, mergeTeamDirectoryRows, groupTeamConversations } from '../src/client/team-conversation-directory.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'
let stops: Array<() => void> = []
afterEach(() => { stops.forEach(stop => stop()); stops = []; mock.mockReset(); vi.restoreAllMocks() })
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
  expect(mock.mock.calls.every(([op]) => op === 'team.app.conversations' || op.startsWith('team.app.entries.'))).toBe(true)
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
it('distinguishes first load from background refresh and resets readiness for the next account', async () => {
  mock.mockResolvedValue({ items: [], hasMore: false })
  const stop = startTeamDirectory('a'); stops.push(stop)
  await vi.waitFor(() => expect(readTeamDirectory('a').loading).toBe(false))
  expect(readTeamDirectory('a').hasLoaded).toBe(true)
  let finish!: (value: unknown) => void
  mock.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const refreshing = refreshTeamDirectory('a')
  expect(readTeamDirectory('a')).toMatchObject({ loading: true, hasLoaded: true, items: [] })
  stop()
  stops.push(startTeamDirectory('b'))
  expect(readTeamDirectory('b')).toMatchObject({ loading: true, hasLoaded: false, items: [] })
  expect(readTeamDirectory('a').hasLoaded).toBe(false)
  finish({ items: [], hasMore: false })
  await refreshing
  await vi.waitFor(() => expect(readTeamDirectory('b').loading).toBe(false))
  expect(readTeamDirectory('b').hasLoaded).toBe(true)
})
it('shows a first-load failure and preserves it while retrying instead of pretending to reopen', async () => {
  mock.mockRejectedValue(new Error('列表暂时不可用'))
  stops.push(startTeamDirectory('a'))
  await vi.waitFor(() => expect(readTeamDirectory('a').loading).toBe(false))
  expect(readTeamDirectory('a')).toMatchObject({ hasLoaded: true, error: '列表暂时不可用' })
  let finish!: (value: unknown) => void
  mock.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const retrying = refreshTeamDirectory('a')
  expect(readTeamDirectory('a')).toMatchObject({ loading: true, hasLoaded: true, error: '列表暂时不可用' })
  finish({ items: [], hasMore: false }); await retrying
  expect(readTeamDirectory('a')).toMatchObject({ loading: false, hasLoaded: true, items: [] })
  expect(readTeamDirectory('a').error).toBeUndefined()
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

it('groups all internal visitors by stable team identity, retaining direct external entries', () => {
  const a={...item('team',10),key:'a',unread:2,visitor:{nickname:'甲'}}, b={...item('team',20),key:'b',unread:3,channel:{...channel,teamRef:'rotated'}}
  const other={...item('team',30),key:'other',channel:{...channel,jotmoId:'other'}}
  const groups=groupTeamConversations([a,b,a,other,item('external',40)],false)
  expect(groups.map(g=>g.key)).toEqual(['other','team_id'])
  expect(groups[1]).toMatchObject({unread:5,unreadExact:false,latest:b,conversations:[b,a]})
  const rows=mergeTeamDirectoryRows([], [a,b,other,item('external',40)])
  expect(rows.map(r=>r.kind)).toEqual(['team','team-folder','team-folder'])
})
it('stops invalid pagination instead of repeatedly fetching the same page', async () => {
  mock.mockImplementation(async (_, {side})=>({items:side==='team'?[item('team')]:[],hasMore:side==='team'}))
  stops.push(startTeamDirectory('a'))
  await vi.waitFor(()=>expect(readTeamDirectory('a').hasLoaded).toBe(true))
  const count=mock.mock.calls.length
  await refreshTeamDirectory('a',true)
  expect(readTeamDirectory('a').error).toContain('分页异常')
  expect(mock.mock.calls).toHaveLength(count)
  expect(readTeamDirectory('a').items).toHaveLength(1)
})

it('receipt invalidation reads only cursor metadata and retains previews, identity and pagination', async () => {
  const { invalidateTeamMessages } = await import('../src/client/team-messaging-events.js')
  const preview = {text:'保留正文预览',status:'available',hasMedia:false}
  let revoke = false
  mock.mockImplementation(async (op, p) => op === 'team.app.read-states'
    ? [{key:item('team').key,accessible:!revoke,lastSeq:1,myReadSeq:1,unread:0}]
    : {items:p.side==='team'?[{...item('team'),preview}]:[],hasMore:false})
  stops.push(startTeamDirectory('a'))
  await vi.waitFor(()=>expect(readTeamDirectory('a').items).toHaveLength(1))
  const before = readTeamDirectory('a').items[0]!
  mock.mockClear(); invalidateTeamMessages('a',true)
  await vi.waitFor(()=>expect(readTeamDirectory('a').items[0]?.unread).toBe(0))
  expect(mock.mock.calls.map(v=>v[0])).toEqual(['team.app.read-states'])
  expect(readTeamDirectory('a').items[0]!.preview).toBe(before.preview)
  expect(readTeamDirectory('a').items[0]!.channel).toBe(before.channel)
  expect(readTeamDirectory('a').loading).toBe(false)
  revoke=true;invalidateTeamMessages('a',true)
  await vi.waitFor(()=>expect(readTeamDirectory('a').items).toEqual([]))
})

it('receipt hints cannot reread hidden-folder message bodies or restore removed entries', async () => {
  const {teamDirectoryPreferences,teamFolderEntryKey,teamEntryHidden}=await import('../src/client/team-directory-preferences.js')
  const c=item('team',30),target={kind:'folder' as const,group:groupTeamConversations([c])[0]!}
  const preferences={[teamFolderEntryKey(channel.jotmoId)]:{pinned:false,dismissed:true}}
  const read=vi.spyOn(teamDirectoryPreferences,'read').mockReturnValue(preferences)
  try {
    mock.mockImplementation(async (op,p)=>{
      if(op==='team.app.timeline') throw new Error('Unverified new-message evidence')
      if(op==='team.app.read-states') return [{key:c.key,accessible:true,lastSeq:1,myReadSeq:1,unread:0}]
      return {items:p.side==='team'?[c]:[],hasMore:false}
    })
    stops.push(startTeamDirectory('hidden-folder'))
    await vi.waitFor(()=>expect(readTeamDirectory('hidden-folder').hasLoaded).toBe(true))
    expect(mock.mock.calls.some(([op])=>op==='team.app.timeline')).toBe(false)
    mock.mockClear()
    await refreshTeamDirectory('hidden-folder',false,true)
    expect(mock.mock.calls.map(([op])=>op)).toEqual(['team.app.read-states'])
    expect(teamEntryHidden(preferences,target)).toBe(true)
    expect(readTeamDirectory('hidden-folder').items[0]?.unread).toBe(0)
  } finally { read.mockRestore() }
})

it('a cloud pin cannot activate an empty conversation', async () => {
  const empty = { ...item('external'), lastSeq: 0 }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([{ kind: 'conversation', ref: empty.ref }])
  mock.mockImplementation(async op => op === 'team.app.timeline' ? { conversation: empty } : { items: [], hasMore: false })
  stops.push(startTeamDirectory('empty-pinned'))
  await vi.waitFor(() => expect(mock.mock.calls.some(([op]) => op === 'team.app.timeline')).toBe(true))
  expect(readTeamDirectory('empty-pinned').items).toEqual([])
})

it('a denied preference authority verdict retires ordinary previews without hiding the other side', async () => {
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([])
  vi.spyOn(teamDirectoryPreferences, 'canPresent').mockImplementation((_, c) => c.side === 'external')
  mock.mockImplementation(async (_, p) => ({ items: [item(p.side)], hasMore: false }))
  stops.push(startTeamDirectory('preference-access-lost'))
  await vi.waitFor(() => expect(readTeamDirectory('preference-access-lost').items.map(c => c.side)).toEqual(['external']))
})

it('a receipt during cold pin discovery preserves both the pin and the newer read state', async () => {
  const ordinary = item('team'), pinned = { ...item('external'), key: 'old-pin', entryKey: 'old-pin-key', ref: 'old-pin-ref' }
  let release!: (value: unknown) => void
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([{ kind: 'conversation', ref: pinned.ref }])
  vi.spyOn(teamDirectoryPreferences, 'read').mockReturnValue({ [pinned.entryKey]: { pinned: true, dismissed: false } })
  mock.mockImplementation(async (op, p) => {
    if (op === 'team.app.timeline') return new Promise(resolve => { release = resolve })
    if (op === 'team.app.read-states') return [{ key: ordinary.key, accessible: true, lastSeq: 1, myReadSeq: 1, unread: 0 }]
    return { items: p.side === 'team' ? [ordinary] : [], hasMore: false }
  })
  stops.push(startTeamDirectory('receipt-and-pin'))
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await refreshTeamDirectory('receipt-and-pin', false, true)
  release({ conversation: pinned })
  await vi.waitFor(() => expect(readTeamDirectory('receipt-and-pin').items).toHaveLength(2))
  expect(readTeamDirectory('receipt-and-pin').items.find(c => c.key === ordinary.key)?.unread).toBe(0)
})

it('off-page pins do not grow the pagination window and share receipt/revocation authority', async () => {
  const ordinary = item('team'), pinned = { ...item('external'), key: 'cold-pin', entryKey: 'cold-pin-key', ref: 'cold-pin-ref' }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([{ kind: 'conversation', ref: pinned.ref }])
  vi.spyOn(teamDirectoryPreferences, 'read').mockReturnValue({ [pinned.entryKey]: { pinned: true, dismissed: false } })
  let revoked = false
  mock.mockImplementation(async (op, p) => {
    if (op === 'team.app.timeline') return { conversation: pinned }
    if (op === 'team.app.read-states') return p.conversationRefs.map((ref: string) => ({key:ref === pinned.ref ? pinned.key : ordinary.key,accessible:ref !== pinned.ref || !revoked,lastSeq:1,myReadSeq:1,unread:0}))
    return { items: p.side === 'team' ? [ordinary] : [], hasMore: p.side === 'team', nextCursor: 'ordinary-page-2' }
  })
  stops.push(startTeamDirectory('pin-pagination'))
  await vi.waitFor(() => expect(readTeamDirectory('pin-pagination').items).toHaveLength(2))
  for (let i = 0; i < 3; i++) await refreshTeamDirectory('pin-pagination')
  expect(mock.mock.calls.filter(([op, p]) => op === 'team.app.conversations' && p.cursor)).toEqual([])
  await refreshTeamDirectory('pin-pagination', false, true)
  expect(readTeamDirectory('pin-pagination').items.find(c => c.key === pinned.key)?.unread).toBe(0)
  revoked = true
  await refreshTeamDirectory('pin-pagination', false, true)
  expect(readTeamDirectory('pin-pagination').items.map(c => c.key)).toEqual([ordinary.key])
})
