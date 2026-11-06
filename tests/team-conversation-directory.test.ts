import { invalidateTeamMessages } from '../src/client/team-messaging-events.js'
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: mock }))
import { startTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory, mergeTeamDirectoryRows, groupTeamConversations } from '../src/client/team-conversation-directory.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'
import { openedTeamConversations } from '../src/client/team-opened-conversations.js'
let stops: Array<() => void> = []
afterEach(() => { stops.forEach(stop => stop()); stops = []; openedTeamConversations.reset(); mock.mockReset(); vi.restoreAllMocks() })
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
  expect(mock.mock.calls.every(([op]) => op === 'team.app.conversations' || op==='team.app.workspace.request' || op.startsWith('team.app.entries.'))).toBe(true)
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

it('redacts previews on changed hints and prevents an older in-flight read from restoring them', async () => {
  const source={...item('team'),preview:{status:'available',text:'old preview',hasMedia:false}}
  mock.mockImplementation(async (_, {side})=>({items:side==='team'?[source]:[],hasMore:false}))
  stops.push(startTeamDirectory('recall'))
  await vi.waitFor(()=>expect(readTeamDirectory('recall').items).toHaveLength(1))
  let release!: (value: unknown)=>void
  mock.mockReturnValue(new Promise(resolve=>{release=resolve}))
  const old=refreshTeamDirectory('recall')
  invalidateTeamMessages('recall')
  expect(readTeamDirectory('recall').items[0]!.preview?.text).toBe('')
  mock.mockRejectedValue(new Error('offline'))
  release({items:[source],hasMore:false});await old
  expect(readTeamDirectory('recall').items.every(c=>!c.preview?.text)).toBe(true)
  expect(readTeamDirectory('recall').items.map(c=>c.key)).toEqual([source.key])
})
it('does not redact a conversation preview for policy or another conversation',async()=>{
 const source={...item('team'),preview:{status:'available',text:'保留的摘要',hasMedia:false}}
 mock.mockImplementation(async(_,{side})=>({items:side==='team'?[source]:[],hasMore:false}))
 stops.push(startTeamDirectory('scoped'))
 await vi.waitFor(()=>expect(readTeamDirectory('scoped').items).toHaveLength(1))
 mock.mockImplementation(()=>new Promise(()=>{}))
 invalidateTeamMessages('scoped',false,{kind:'team.notification-policy.changed'})
 expect(readTeamDirectory('scoped').items[0]!.preview?.text).toBe('保留的摘要')
 invalidateTeamMessages('scoped',false,{kind:'team.message.changed',conversationKeys:['other']})
 expect(readTeamDirectory('scoped').items[0]!.preview?.text).toBe('保留的摘要')
 invalidateTeamMessages('scoped',false,{kind:'team.message.changed',conversationKeys:[source.key]})
 expect(readTeamDirectory('scoped').items[0]!.preview?.text).toBe('')
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

it('a cold directory restores a backend-confirmed silent member contact without a process-local open', async () => {
  const silent = { ...item('team', 20), lastSeq: 0, unread: 0, needsReply: false, memberInitiated: true }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([])
  mock.mockImplementation(async (_op, p) => ({ items: p.side === 'team' ? [silent] : [], hasMore: false }))
  for (let attempt = 0; attempt < 2; attempt++) {
    openedTeamConversations.reset()
    const stop = startTeamDirectory('restarted-member'); stops.push(stop)
    await vi.waitFor(() => expect(readTeamDirectory('restarted-member').items).toHaveLength(1))
    expect(readTeamDirectory('restarted-member').items[0]).toMatchObject(silent)
    expect(openedTeamConversations.read('restarted-member')).toEqual([])
    stop()
  }
  expect(mock.mock.calls.some(([op]) => op === 'team.app.outbound.open' || op === 'team.app.send')).toBe(false)
})

it('a confirmed silent member pin is discoverable outside ordinary pages without admitting passive previews', async () => {
  const silent = { ...item('team', 20), lastSeq: 0, unread: 0, needsReply: false, memberInitiated: true }
  const passive = { ...item('external'), key: 'passive-key', ref: 'passive-ref', lastSeq: 0, memberInitiated: true }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([{ kind: 'conversation', ref: silent.ref }, { kind: 'conversation', ref: passive.ref }])
  const { teamEntryKey } = await import('../src/client/team-directory-preferences.js')
  vi.spyOn(teamDirectoryPreferences, 'read').mockReturnValue({ [teamEntryKey({ kind: 'conversation', conversation: silent })]: { pinned: true, dismissed: false } })
  mock.mockImplementation(async (op, p) => op === 'team.app.timeline'
    ? { conversation: p.conversationRef === silent.ref ? silent : passive } : { items: [], hasMore: false })
  stops.push(startTeamDirectory('silent-pin'))
  await vi.waitFor(() => expect(readTeamDirectory('silent-pin').items).toEqual([silent]))
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

it('a changed off-page pin cannot regain its old preview on a receipt or failed list refresh', async () => {
  const pinned = { ...item('external'), key: 'recalled-pin', entryKey: 'recalled-pin-key', ref: 'recalled-pin-ref', preview: { status: 'available', text: 'old pinned preview', hasMedia: false } }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([{ kind: 'conversation', ref: pinned.ref }])
  vi.spyOn(teamDirectoryPreferences, 'read').mockReturnValue({ [pinned.entryKey]: { pinned: true, dismissed: false } })
  let offline = false
  mock.mockImplementation(async (op, p) => {
    if (op === 'team.app.read-states') return [{ key: pinned.key, accessible: true, lastSeq: 1, myReadSeq: 1, unread: 0 }]
    if (offline) throw new Error('offline')
    if (op === 'team.app.timeline') return { conversation: pinned }
    return { items: [], hasMore: false }
  })
  stops.push(startTeamDirectory('changed-pin'))
  await vi.waitFor(() => expect(readTeamDirectory('changed-pin').items).toHaveLength(1))
  expect(readTeamDirectory('changed-pin').items[0]!.preview?.text).toBe('old pinned preview')
  offline = true
  invalidateTeamMessages('changed-pin', false, { kind: 'team.message.changed', conversationKeys: [pinned.key] })
  expect(readTeamDirectory('changed-pin').items[0]!.preview?.text).toBe('')
  await vi.waitFor(() => expect(readTeamDirectory('changed-pin').loading).toBe(false))
  await refreshTeamDirectory('changed-pin', false, true)
  expect(readTeamDirectory('changed-pin').items[0]!.unread).toBe(0)
  expect(readTeamDirectory('changed-pin').items[0]!.preview?.text).toBe('')
})

it('uses real group-only folders and merges later group activity without inventing a private conversation',()=>{
 const folder={channel,activityAt:50,preview:'小王 [售后]：收到',unread:2,groupCount:1,hasPublished:true,groups:[{sourceKey:'canonical-group',unread:2,lastSeq:12}]}
 const groups=groupTeamConversations([],true,[folder])
 expect(groups).toHaveLength(1)
 expect(groups[0]).toMatchObject({conversations:[],unread:2,activeAt:50,preview:folder.preview,hasPublished:true})
 expect(groups[0]!.latest).toBeUndefined()
 const merged=groupTeamConversations([item('team',10)],true,[folder])
 expect(merged).toHaveLength(1);expect(merged[0]).toMatchObject({unread:3,activeAt:50,preview:folder.preview})
 const rows=mergeTeamDirectoryRows([{activeAtMillis:20,pinned:false}],[],true,{},[folder])
 expect(rows[0]).toMatchObject({kind:'team-folder',activeAtMillis:50})
})

it('publishes group-only folders independently and drops their body on a failed fresh authority read',async()=>{
 const folder={channel,activityAt:50,preview:'已批准群消息',unread:2,groupCount:1,hasPublished:true,groups:[{sourceKey:'canonical-group',unread:2,lastSeq:12}]}
 mock.mockImplementation(async(operation,{side})=>operation==='team.app.workspace.request'?[folder]:{items:side?[item(side)]:[],hasMore:false})
 stops.push(startTeamDirectory('folders-only'))
 await vi.waitFor(()=>expect(readTeamDirectory('folders-only').workspaceFolders).toEqual([folder]))
 mock.mockImplementation(async(operation,{side})=>{if(operation==='team.app.workspace.request')throw new Error('来源权限暂时无法确认');return {items:side?[item(side)]:[],hasMore:false}})
 await refreshTeamDirectory('folders-only')
 expect(readTeamDirectory('folders-only').workspaceFolders).toEqual([])
 expect(readTeamDirectory('folders-only').items).toHaveLength(2)
 expect(readTeamDirectory('folders-only').foldersError).toBe('来源权限暂时无法确认')
})

it('a confirmed contact is visible during a pending list read and survives an absent server row', async () => {
  const empty = { ...item('team', 50), lastSeq: 0, unread: 0 }
  let release!: (value: unknown) => void
  mock.mockReturnValue(new Promise(resolve => { release = resolve }))
  stops.push(startTeamDirectory('new-contact'))
  openedTeamConversations.retain('new-contact', empty)
  expect(readTeamDirectory('new-contact')).toMatchObject({ loading: true, items: [empty] })
  mock.mockResolvedValue({ items: [], hasMore: false })
  invalidateTeamMessages('new-contact')
  release({ items: [], hasMore: false })
  await vi.waitFor(() => expect(readTeamDirectory('new-contact').loading).toBe(false))
  expect(readTeamDirectory('new-contact').items).toHaveLength(1)
  expect(readTeamDirectory('new-contact').items[0]).toMatchObject({ key: empty.key, lastSeq: 0, unread: 0 })
  await refreshTeamDirectory('new-contact')
  expect(readTeamDirectory('new-contact').items).toHaveLength(1)
})

it('first publication replaces the opened row once, and a stale reopen cannot roll back its message or read state', async () => {
  const empty = { ...item('team', 5), lastSeq: 0, unread: 0 }
  openedTeamConversations.retain('publication', empty)
  mock.mockResolvedValue({ items: [], hasMore: false })
  stops.push(startTeamDirectory('publication'))
  await vi.waitFor(() => expect(readTeamDirectory('publication').hasLoaded).toBe(true))
  const published = { ...empty, lastSeq: 2, myReadSeq: 2, unread: 0, revision: 3, updatedAt: 10, preview: { status: 'available', text: '首条真实消息', hasMedia: false } }
  mock.mockImplementation(async (_, p) => ({ items: p.side === 'team' ? [published] : [], hasMore: false }))
  await refreshTeamDirectory('publication')
  openedTeamConversations.retain('publication', { ...empty, updatedAt: 50 })
  expect(readTeamDirectory('publication').items).toEqual([expect.objectContaining(published)])
  mock.mockResolvedValue({ items: [], hasMore: false })
  await refreshTeamDirectory('publication')
  expect(readTeamDirectory('publication').items).toEqual([expect.objectContaining(published)])
})

it('opened off-page rows share receipt, revocation and recall authority with ordinary rows', async () => {
  const c = { ...item('team'), preview: { status: 'available', text: '须撤回的摘要', hasMedia: false } }
  openedTeamConversations.retain('opened-authority', c)
  let accessible = true, offline = false
  mock.mockImplementation(async (op) => {
    if (op === 'team.app.read-states') return [{ key: c.key, accessible, lastSeq: 1, myReadSeq: 1, unread: 0 }]
    if (offline) throw new Error('offline')
    return { items: [], hasMore: false }
  })
  stops.push(startTeamDirectory('opened-authority'))
  await vi.waitFor(() => expect(readTeamDirectory('opened-authority').hasLoaded).toBe(true))
  await refreshTeamDirectory('opened-authority', false, true)
  expect(readTeamDirectory('opened-authority').items[0]?.unread).toBe(0)
  offline = true
  invalidateTeamMessages('opened-authority', false, { kind: 'team.message.changed', conversationKeys: [c.key] })
  await vi.waitFor(() => expect(readTeamDirectory('opened-authority').loading).toBe(false))
  expect(readTeamDirectory('opened-authority').items[0]?.preview?.text).toBe('')
  accessible = false
  await refreshTeamDirectory('opened-authority', false, true)
  expect(readTeamDirectory('opened-authority').items).toEqual([])
  expect(openedTeamConversations.read('opened-authority')).toEqual([])
})

it('preference authority and channel revocation remove retained contacts too', async () => {
  const c = { ...item('team'), lastSeq: 0, unread: 0 }
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([])
  vi.spyOn(teamDirectoryPreferences, 'canPresent').mockReturnValue(false)
  openedTeamConversations.retain('denied-open', c)
  mock.mockResolvedValue({ items: [], hasMore: false })
  stops.push(startTeamDirectory('denied-open'))
  await vi.waitFor(() => expect(openedTeamConversations.read('denied-open')).toEqual([]))
  expect(readTeamDirectory('denied-open').items).toEqual([])
  openedTeamConversations.retain('denied-open', c)
  discardTeamDirectory('denied-open', c)
  expect(readTeamDirectory('denied-open').items).toEqual([])
  expect(openedTeamConversations.read('denied-open')).toEqual([])
})

it('clears opened contacts on account or provider reset and ignores an old owner cleanup', async () => {
  const c = { ...item('team'), lastSeq: 0, unread: 0 }
  mock.mockResolvedValue({ items: [], hasMore: false })
  const stopOld = startTeamDirectory('opened-old'); stops.push(stopOld)
  openedTeamConversations.retain('opened-old', c)
  stops.push(startTeamDirectory('opened-new'))
  expect(openedTeamConversations.read('opened-old')).toEqual([])
  openedTeamConversations.retain('opened-new', c)
  stopOld()
  expect(readTeamDirectory('opened-new').items).toEqual([expect.objectContaining(c)])
  openedTeamConversations.reset()
  expect(readTeamDirectory('opened-new').items).toEqual([])
})

it('keeps the ordinary directory and private preference protocol when workspace routes are absent', async () => {
  mock.mockImplementation(async (operation, p) => {
    if (operation === 'team.app.workspace.request') throw Object.assign(new Error('unsupported'), { body: { code: 'team-workspace-unsupported' } })
    if (operation.startsWith('team.app.entries.')) return { schemaVersion: 1, items: [], hasMore: false }
    return { items: [item(p.side)], hasMore: false }
  })
  stops.push(startTeamDirectory('legacy-backend'))
  await vi.waitFor(() => expect(readTeamDirectory('legacy-backend').hasLoaded).toBe(true))
  expect(readTeamDirectory('legacy-backend')).toMatchObject({ workspaceSupported: false, items: expect.any(Array) })
  expect(readTeamDirectory('legacy-backend').items).toHaveLength(2)
  expect(readTeamDirectory('legacy-backend').foldersError).toBeUndefined()
  await vi.waitFor(() => expect(mock.mock.calls.some(([op]) => op === 'team.app.entries.list')).toBe(true))
  expect(mock.mock.calls.filter(([op]) => op.startsWith('team.app.entries.')).every(([,p]) => !p.scope)).toBe(true)
})
it('keeps real workspace failures visible instead of pretending the old server was detected', async () => {
  mock.mockImplementation(async (operation, p) => {
    if (operation === 'team.app.workspace.request') throw Object.assign(new Error('denied'), { body: { code: 'team-not_accessible' } })
    return { items: p.side ? [item(p.side)] : [], hasMore: false }
  })
  stops.push(startTeamDirectory('denied-backend'))
  await vi.waitFor(() => expect(readTeamDirectory('denied-backend').hasLoaded).toBe(true))
  expect(readTeamDirectory('denied-backend').workspaceSupported).toBeUndefined()
  expect(readTeamDirectory('denied-backend').foldersError).toBe('denied')
})

it('publishes existing private rows while the optional workspace discovery is still pending',async()=>{
 let resolve!:(value:unknown)=>void
 const workspace=new Promise(ok=>{resolve=ok})
 mock.mockImplementation(async(op,p)=>op==='team.app.workspace.request'?workspace:op.startsWith('team.app.entries.')?{schemaVersion:1,items:[],hasMore:false}:{items:[item(p.side)],hasMore:false})
 stops.push(startTeamDirectory('slow-workspace'))
 await vi.waitFor(()=>expect(readTeamDirectory('slow-workspace').hasLoaded).toBe(true))
 expect(readTeamDirectory('slow-workspace').items).toHaveLength(2)
 expect(readTeamDirectory('slow-workspace').workspaceSupported).toBeUndefined()
 resolve([])
 await vi.waitFor(()=>expect(readTeamDirectory('slow-workspace').workspaceSupported).toBe(true))
 expect(readTeamDirectory('slow-workspace').items).toHaveLength(2)
})


it.each(['success','failure','unsupported'] as const)('does not let an older detached folder %s overwrite a newer refresh',async outcome=>{
 let finish!:(value:unknown)=>void,fail!:(reason:Error)=>void,reads=0
 const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject})
 vi.spyOn(teamDirectoryPreferences,'hydrate').mockResolvedValue()
 vi.spyOn(teamDirectoryPreferences,'reconcile').mockResolvedValue()
 vi.spyOn(teamDirectoryPreferences,'missingPins').mockReturnValue([])
 mock.mockImplementation(async(op,{side})=>op==='team.app.workspace.request'?(++reads===1?pending:[]):{items:side==='external'?[item('external')]:[],hasMore:false})
 stops.push(startTeamDirectory('folder-order'))
 // Optional folder IO must not hold the existing personal directory readiness.
 await vi.waitFor(()=>expect(readTeamDirectory('folder-order')).toMatchObject({hasLoaded:true,items:[expect.objectContaining({side:'external'})]}))
 const firstSignal=mock.mock.calls.find(([op])=>op==='team.app.workspace.request')![2] as AbortSignal
 await refreshTeamDirectory('folder-order')
 expect(reads).toBe(2)
 if(outcome==='success')finish([{teamRef:'old-team-ref',channel,groupCount:1,activityAt:100,unreadCount:1}])
 else fail(Object.assign(new Error('old folder request failed'),outcome==='unsupported'?{body:{code:'team-workspace-unsupported'}}:{}))
 await new Promise(resolve=>setTimeout(resolve,0))
 expect(readTeamDirectory('folder-order').workspaceFolders).toEqual([])
 expect(readTeamDirectory('folder-order').foldersError).toBeUndefined()
 expect(readTeamDirectory('folder-order').workspaceSupported).toBe(true)
 expect(firstSignal.aborted).toBe(true)
})
