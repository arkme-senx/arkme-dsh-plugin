import {readFile} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { LocalMessageMarkStore } from '../src/local-message-marks.js'
import { quoteSourceContent } from '../src/message-quote.js'
import type { MessageUnderlineSnapshot } from '../src/message-annotations.js'
import { describe, it, expect, vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { TeamChannel, TeamConversation, TeamOpen, TeamSendResult, TeamTimeline, TeamMembers, TeamReceipts } from '../src/team-app-contract.js'
import { parseOwnerJson, stringifyOwnerJson } from '../src/record-owner-id.js'
import { decodeArkmeTeamNotificationDataLine, decodeArkmeMemberEventDataLine } from '../src/chat-realtime.js'

const channel = { team_id: '9223372036854775800', name: '即我团队', jotmo_id: 'arkme_cn', public_ref: 'a'.repeat(32), enabled: true, revision: 1, can_manage: false }
const conversation = { conversation_uid: 'conversation-private', team_id: channel.team_id, external_user_id: 90, channel, side: 'external', last_seq: 2, latest_team_reply_seq: 1, my_read_seq: 0, unread: 1 }
const message = { message_uid: 'message-private', actor_user_id: 11, record_owner_user_id: 11, seq: 2, revision: 2, side: 'team', state: 'published', sender: { nickname: '小林', avatar_url: 'https://userfiles.jotmo.cc/test.png' }, record: { status: 'available', version: 3, text_content: '已收到', media: [{ file_asset_uid: 'asset-secret', file_name: 'photo.png', mime_type: 'image/png', size: 42, file_kind: 1, download_url: 'https://private-signed.invalid' }] } }
function fixture(handler: (path: string, body: Record<string, unknown>) => unknown | Promise<unknown> = () => ({})) {
  let session = { userId: 90, accessToken: 'app-token', refreshToken: 'app-refresh' }
  const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = parseOwnerJson(String(init?.body || '{}')) as Record<string, unknown>
    requests.push({ path, body, headers: new Headers(init?.headers) })
    const data = await handler(path, body)
    if (data instanceof Response) return data
    return new Response(stringifyOwnerJson({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
  })
  const config = { environment: 'test', teamBaseUrl: 'https://team.test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test', recordBaseUrl: 'https://record.test', subjectBaseUrl: 'https://subject.test', routePath: '/custom/api', requestTimeoutMs: 500, shareWebsite: 'https://share.test', maxTextLength: 20000 } as ArkmeServiceConfig
  const recovery=new Map<string,import('../src/team-outbound-contract.js').TeamOutboundRecovery>()
  const runtime = new ServiceRuntime(config, {} as ArkmeSessionStore, { uniqueCode: async () => 'unique-machine-key',teamOutboundTarget:vi.fn(async(scope:string,uid:string)=>recovery.get(scope+uid)),retainTeamOutboundTarget:vi.fn(async(scope:string,uid:string,value:import('../src/team-outbound-contract.js').TeamOutboundRecovery)=>{recovery.set(scope+uid,value)}) } as StateStore, fetchImpl as typeof fetch)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => ({ ...session }))
  vi.spyOn(runtime, 'accountScopedSession').mockImplementation(async () => ({ ...session }))
  const avatars = { publicAvatarPresentationsByArkmeIds: vi.fn(async () => new Map<string, { avatarRef: string }>()) }
  const privateChat = { openPrivateChatFromUser: vi.fn(async () => ({ source: { kind: 'private_chat', sourceRef: 'private-ref' } })) }
  const contacts = {
    privateRemarksByUserIds: vi.fn(async (_ids: readonly number[], _options?: unknown) => new Map<number, string>()),
    openSourceRef: vi.fn(async (ref: string, _user: number) => (ref === 'private-ref'
      ? { kind: 'private_chat', ownerRef: 'original-chat' }
      : { kind: 'group_chat', ownerRef: 'group-id' }) as never),
  }
  const candidates = { list: vi.fn<import('../src/team-member-add-contract.js').TeamMemberCandidatePort['list']>(async () => ({ items: [], hasMore: false })) }
  const outboundTargets={resolve:vi.fn(async()=>123)}
  const service = new TeamAppService(runtime, avatars, privateChat as never, contacts as never, candidates, outboundTargets)
  return { service, runtime, requests, fetchImpl, avatars, privateChat, contacts, candidates, outboundTargets, changeAccount() { session = { userId: 91, accessToken: 'other', refreshToken: 'other-refresh' } } }
}
async function open(f: ReturnType<typeof fixture>) { return await f.service.execute('team.app.open', { publicRef: channel.public_ref }) as TeamOpen }

it('projects realtime locators into the same opaque viewer keys used by current Team reads',async()=>{
 const f=fixture(path=>path.endsWith('/open')?{channel,conversation}:{conversation,messages:[message]})
 const opened=await open(f),c=opened.conversation!
 const page=await f.service.execute('team.app.timeline',{conversationRef:c.ref}) as TeamTimeline
 const hint=await f.service.changeHint({kind:'team.message.changed',messageUid:message.message_uid,conversationUid:conversation.conversation_uid,messageRevision:2,conversationRevision:99,sequence:message.seq},90)
 expect(hint).toMatchObject({messageKey:page.messages[0]!.key,conversationKeys:expect.arrayContaining([c.key])})
 expect(hint).toMatchObject({messageRevision:2,conversationRevision:99,sequence:message.seq})
 expect(JSON.stringify(hint)).not.toContain(message.message_uid)
 expect(JSON.stringify(hint)).not.toContain(conversation.conversation_uid)
 expect((await f.service.changeHint({kind:'team.message.changed',messageUid:message.message_uid},91)).messageKey).not.toBe(hint.messageKey)
})

it('opens private matching references for maximum-size Team text without cloud IO', async () => {
 const text = '长'.repeat(60_000) + ' end'
 const f = fixture(() => ({ channel, conversation, messages: [{ ...message, record: { ...message.record, text_content: text } }] }))
 const db = new DatabaseSync(':memory:')
 const store = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
 Object.assign(f.runtime.stateStore, { messageMarks: store })
 try {
  const conversationRef = (await open(f)).conversation!.ref
  const page = await f.service.execute('team.app.timeline', { conversationRef }) as TeamTimeline
  const markRef = page.messages[0]!.localMarkRef!
  expect(markRef.length).toBeLessThan(16_384)
  expect(markRef.length).toBeLessThan(512 * 1024)
  const calls = f.requests.length
  const anchor = { version: 1, projection: 'arkme-text-v1', recordVersion: 3, sourceDigest: createHash('sha256').update(quoteSourceContent({ textContent: text })).digest('hex'), start: 0, end: 1, text: '长', prefix: '', suffix: '长'.repeat(32) }
  const result = await f.service.execute('team.app.local-mark.change', { conversationRef, markRef, change: { kind: 'add', operationId: 'long', anchor, canonical: text } }) as MessageUnderlineSnapshot
  expect(result.items[0]?.anchor).toEqual(anchor)
  expect(f.requests).toHaveLength(calls)
 } finally { db.close() }
})
describe('team group frontend handoff boundary', () => {
  const member = { team_id: 17, jotmo_id: 'our_team', name: '团队', role: 3 }
  it('checks a viewer-scoped group source and returns real teams without granting delegated group access', async () => {
    const f = fixture(path => path.endsWith('/group-identity/context')?{state:'ready',membership_policy:'independent',group_join_at:9,teams:[{...member,team_id:'17',membership_kind:'member',membership_revision:3}]}:({ teams: [member] }))
    const result = await f.service.execute('team.app.group.context', { sourceRef: 'sealed-group', expectedAccountKey: 'test:90' }) as { state: string; teams: Array<{ teamRef: string }> }
    expect(result.state).toBe('ready'); expect(result.teams).toHaveLength(1)
    expect(f.contacts.openSourceRef).toHaveBeenCalledWith('sealed-group', 90)
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/chats/group-identity/context'])
    await expect(f.service.execute('team.app.group.join', { sourceRef: 'sealed-group', teamRef: result.teams[0]!.teamRef, requestUid: 'attempt-1' })).resolves.toEqual({ state: 'backend_pending' })
    await expect(f.service.execute('team.app.group.directory', { teamRef: result.teams[0]!.teamRef })).resolves.toEqual({ state: 'backend_pending' })
    expect(f.requests.slice(1).every(v => v.path === '/api/v1/team/list-mine')).toBe(true)
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('rejects an invalid source, non-group source, missing idempotency key and changed account', async () => {
    const f = fixture(() => ({ teams: [member] }))
    f.contacts.openSourceRef.mockRejectedValueOnce(new Error('invalid source'))
    await expect(f.service.execute('team.app.group.context', { sourceRef: 'forged' })).rejects.toThrow('invalid source')
    f.contacts.openSourceRef.mockResolvedValueOnce({ kind: 'private_chat' } as never)
    await expect(f.service.execute('team.app.group.context', { sourceRef: 'private' })).rejects.toThrow()
    await expect(f.service.execute('team.app.group.join', { sourceRef: 'group' })).rejects.toThrow()
    f.changeAccount()
    await expect(f.service.execute('team.app.group.context', { sourceRef: 'group', expectedAccountKey: 'test:90' })).rejects.toThrow()
    expect(f.requests).toHaveLength(0)
  })
  it('does not reuse removed team membership for either joins or the team group directory', async () => {
    let joined = true
    const f = fixture(() => ({ teams: joined ? [member] : [] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    joined = false
    await expect(f.service.execute('team.app.group.directory', { teamRef: teams[0]!.teamRef })).rejects.toThrow('无权访问')
    await expect(f.service.execute('team.app.group.join', { sourceRef: 'group', teamRef: teams[0]!.teamRef, requestUid: 'attempt-1' })).rejects.toThrow('无权访问')
  })
})

describe('team World frontend boundary', () => {
  const member = { team_id: '9223372036854775800', jotmo_id: 'our_team', name: '团队', role: 3 }
  it('reads a separate team namespace and returns no fake personal feed or publishing grant', async () => {
    const f = fixture(() => ({ teams: [member] }))
    const page = await f.service.execute('team.app.world.view', { jotmoId: 'our_team', expectedAccountKey: 'test:90' }) as import('../src/team-world-contract.js').TeamWorldView
    expect(page).toMatchObject({ state: 'backend_pending', team: { jotmoId: 'our_team' }, memberTeam: { jotmoId: 'our_team' } })
    expect(page).not.toHaveProperty('items'); expect(page).not.toHaveProperty('canPublish')
    await expect(f.service.execute('team.app.world.prepare', { teamRef: page.memberTeam!.teamRef, requestUid: 'attempt-1' })).resolves.toEqual({ state: 'backend_pending' })
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/team/list-mine', '/api/v1/team/list-mine'])
  })
  it('uses only public discovery for a non-member and never returns private membership or uses member-only profile reads', async () => {
    const f = fixture(path => path.endsWith('/list-mine') ? { teams: [] } : { team: { jotmo_id: 'public_team', name: '公开团队', requires_approval: false, state: 'not_member' } })
    const page = await f.service.execute('team.app.world.view', { jotmoId: 'public_team' }) as import('../src/team-world-contract.js').TeamWorldView
    expect(page.team).toMatchObject({ name: '公开团队', jotmoId: 'public_team' }); expect(page.memberTeam).toBeUndefined()
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/team/list-mine', '/api/v1/team/discovery/search'])
  })
  it('rechecks removed membership, account binding and malformed requests without writes', async () => {
    let joined = true
    const f = fixture(() => ({ teams: joined ? [member] : [] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    joined = false
    await expect(f.service.execute('team.app.world.prepare', { teamRef: teams[0]!.teamRef, requestUid: 'attempt-1' })).rejects.toThrow('无权访问')
    await expect(f.service.execute('team.app.world.prepare', { teamRef: teams[0]!.teamRef })).rejects.toThrow()
    await expect(f.service.execute('team.app.world.view', { jotmoId: '' })).rejects.toThrow()
    await expect(f.service.execute('team.app.world.view', { jotmoId: 'our_team', expectedAccountKey: 'test:91' })).rejects.toThrow('账号已在其他页面切换')
    expect(f.requests.every(v => v.path.endsWith('/list-mine'))).toBe(true)
  })
})

describe('team public card projection',()=>{
 const publicCard={...channel,contact:{state:'available',public_ref:channel.public_ref},navigation:{kind:'contact'},description:''}
 it('uses the pure public read and never repairs or opens a channel',async()=>{
  const f=fixture(()=>publicCard),value=await f.service.execute('team.app.public-card',{jotmoId:channel.jotmo_id,expectedAccountKey:'test:90'})
  expect(value).toMatchObject({name:channel.name,contact:{state:'available',publicRef:channel.public_ref},navigation:{kind:'contact'}})
  expect(JSON.stringify(value)).not.toContain(channel.team_id)
  expect(f.requests.map(v=>v.path)).toEqual(['/api/v1/team/public-card/get'])
 })
 it('lets a member enter inbox when public contact is disabled',async()=>{
  let value={...publicCard,contact:{state:'disabled'},navigation:{kind:'inbox'}}
  const f=fixture(()=>value)
  expect(await f.service.execute('team.app.public-card',{jotmoId:channel.jotmo_id})).toMatchObject({contact:{state:'disabled'},navigation:{kind:'inbox',teamRef:expect.any(String)}})
  value={...value,jotmo_id:'wrong'};await expect(f.service.execute('team.app.public-card',{jotmoId:channel.jotmo_id})).rejects.toThrow()
  f.changeAccount();await expect(f.service.execute('team.app.public-card',{jotmoId:channel.jotmo_id,expectedAccountKey:'test:90'})).rejects.toThrow()
 })
 it('reports an unavailable team without inventing a link',async()=>{const f=fixture(()=>({contact:{state:'unavailable'},navigation:{kind:'none'}}));await expect(f.service.execute('team.app.public-card',{jotmoId:'missing'})).resolves.toEqual({name:'',jotmoId:'missing',contact:{state:'unavailable'},navigation:{kind:'none'}})})
})

describe('internal group preparation boundary', () => {
  const owner = { team_id: 17, jotmo_id: 'our_team', name: '团队', role: 1 }
  it('validates creation and linking without writing any group membership', async () => {
    const f = fixture(() => ({ teams: [owner] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    const params = { teamRef: teams[0]!.teamRef, expectedAccountKey: 'test:90', requestUid: 'attempt-1' }
    await expect(f.service.execute('team.app.internal-group.prepare', { ...params, mode: 'create', name: '团队内部群' })).resolves.toEqual({ state: 'backend_pending' })
    await expect(f.service.execute('team.app.internal-group.prepare', { ...params, mode: 'link', sourceRef: 'sealed-group' })).resolves.toEqual({ state: 'backend_pending' })
    expect(f.contacts.openSourceRef).toHaveBeenCalledWith('sealed-group', 90)
    expect(f.requests.every(value => value.path === '/api/v1/team/list-mine')).toBe(true)
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('rejects missing names, malformed requests and non-group sources before preparing', async () => {
    const f = fixture(() => ({ teams: [owner] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    const params = { teamRef: teams[0]!.teamRef, requestUid: 'attempt-1' }
    for (const invalid of [{ mode: 'create', name: ' ' }, { mode: 'create', name: 'a'.repeat(121) }, { mode: 'create', name: '群', requestUid: '' }, { mode: 'link' }, { mode: 'other' }]) {
      await expect(f.service.execute('team.app.internal-group.prepare', { ...params, ...invalid })).rejects.toThrow()
    }
    f.contacts.openSourceRef.mockResolvedValueOnce({ kind: 'private_chat' } as never)
    await expect(f.service.execute('team.app.internal-group.prepare', { ...params, mode: 'link', sourceRef: 'private' })).rejects.toThrow()
    expect(f.requests).toHaveLength(1)
  })
  it('rechecks removed membership, admin role and account, without trusting the opened form', async () => {
    let members = [owner]
    const f = fixture(() => ({ teams: members }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    const params = { teamRef: teams[0]!.teamRef, expectedAccountKey: 'test:90', requestUid: 'attempt-1', mode: 'create', name: '内部群' }
    members = [{ ...owner, role: 3 }]
    await expect(f.service.execute('team.app.internal-group.prepare', params)).rejects.toThrow('仅团队所有者或管理员')
    members = []
    await expect(f.service.execute('team.app.internal-group.prepare', params)).rejects.toThrow('无权访问')
    f.changeAccount()
    await expect(f.service.execute('team.app.internal-group.prepare', params)).rejects.toThrow()
    expect(f.requests).toHaveLength(3)
  })
})

describe('member initiated team conversation handoff boundary', () => {
  const memberTeam = { team_id: 17, jotmo_id: 'our_team', name: '团队', role: 'member' }
  const recipient = { kind: 'chat-member', sourceRef: 'source-ref', memberRef: 'member-ref' }
  it('requires authenticated membership, freezes the target and opens the original team reception', async () => {
    const f = fixture(path => path.endsWith('/list-mine') ? { teams: [memberTeam] } : {conversation:{...conversation,channel:{...channel,...memberTeam},team_id:17,external_user_id:'123',side:'team',visitor:{kind:'person',account_state:'active',member_type:'free'}}})
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    const result = await f.service.execute('team.app.outbound.open', { expectedAccountKey: 'test:90', teamRef: teams[0]!.teamRef, recipient, requestUid: 'attempt-1' })
    expect(result).toMatchObject({state:'ready',conversation:{side:'team',visitor:{personRef:expect.any(String)}}})
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/team/list-mine', '/api/v1/team/list-mine','/api/v1/team/conversations/open-by-member'])
    expect(f.requests[2]!.body).toEqual({team_id:17,external_user_id:'123'})
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('rejects a removed member and never substitutes another team', async () => {
    let joined = true
    const f = fixture(() => ({ teams: joined ? [memberTeam] : [{ ...memberTeam, team_id: 18 }] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    joined = false
    await expect(f.service.execute('team.app.outbound.open', { teamRef: teams[0]!.teamRef, recipient, requestUid: 'attempt-1' })).rejects.toThrow('无权访问')
  })
  it('rejects malformed targets and an account changed since the UI opened', async () => {
    const f = fixture(() => ({ teams: [memberTeam] }))
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>
    await expect(f.service.execute('team.app.outbound.open', { teamRef: teams[0]!.teamRef, recipient: { kind: 'chat-member', memberRef: 'member' }, requestUid: 'attempt-1' })).rejects.toThrow()
    f.changeAccount()
    await expect(f.service.execute('team.app.outbound.open', { expectedAccountKey: 'test:90', teamRef: teams[0]!.teamRef, recipient, requestUid: 'attempt-1' })).rejects.toThrow()
    expect(f.requests).toHaveLength(1)
  })
})

it.each([
  [0, 'free'], [1, 'vip'], [2, 'svip'], ['vip', 'vip'], ['SVIP', 'svip'],
  [undefined, 'unknown'], [null, 'unknown'], [99, 'unknown'],
])('projects current visitor member_type %s consistently across directory and timeline', async (raw, expected) => {
  const visitor = { nickname: '访客', ...(raw === undefined ? {} : { member_type: raw }) }
  const value = { ...conversation, side: 'team', visitor }
  const f = fixture(path => path.endsWith('/conversations/list') ? { items: [value], has_more: false }
    : { channel, conversation: value, messages: [{ ...message, sender: { ...message.sender, member_type: 'svip' } }] })
  const page = await f.service.execute('team.app.conversations', { side: 'team' }) as { items: TeamConversation[] }
  const result = await f.service.execute('team.app.timeline', { conversationRef: page.items[0]!.ref }) as TeamTimeline
  expect(page.items[0]!.visitor?.memberType).toBe(expected)
  expect(result.conversation.visitor?.memberType).toBe(expected)
  // A team sender's membership must not be substituted for the visitor's.
  expect(result.messages[0]!.sender.memberType).toBe('svip')
  expect(f.requests).toHaveLength(2)
  expect(JSON.stringify(result.conversation)).not.toMatch(/external_user_id|member_type|actor_user_id/)
})

it('clears a former membership when a fresh response is free or unavailable', async () => {
  let visitor: Record<string, unknown> = { nickname: '访客', member_type: 'svip' }
  const f = fixture(() => ({ channel, conversation: { ...conversation, side: 'team', visitor }, messages: [] }))
  const opened = await open(f)
  expect(opened.conversation!.visitor?.memberType).toBe('svip')
  for (const raw of ['free', undefined]) {
    visitor = { nickname: '访客', member_type: raw }
    const value = await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline
    expect(value.conversation.visitor?.memberType).toBe(raw ?? 'unknown')
  }
})

it('persists private Team marks across refreshed references without cloud writes or Chat authority', async () => {
  let rawConversation = conversation, rawMessage = message
  const f = fixture(() => ({ channel, conversation: rawConversation, messages: [rawMessage] }))
  const db = new DatabaseSync(':memory:')
  const store = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
  Object.assign(f.runtime.stateStore, { messageMarks: store })
  try {
    const opened = await open(f), conversationRef = opened.conversation!.ref
    const page = await f.service.execute('team.app.timeline', { conversationRef }) as TeamTimeline
    const markRef = page.messages[0]!.localMarkRef!
    const anchor = { version: 1, projection: 'arkme-text-v1', recordVersion: 3,
      sourceDigest: createHash('sha256').update(quoteSourceContent({ textContent: '已收到' })).digest('hex'),
      start: 0, end: 2, text: '已收', prefix: '', suffix: '到' }
    const calls = f.requests.length
    expect(await f.service.execute('team.app.local-mark.capabilities', { conversationRef })).toEqual({ supported: true, maxLength: 2000, storage: 'local', maxBatchSize: 4 })
    const first = await f.service.execute('team.app.local-mark.change', { conversationRef, markRef, change: { kind: 'add', operationId: 'add', anchor, canonical: '已收到' } }) as MessageUnderlineSnapshot
    expect(first.items[0]).toMatchObject({ mine: true, actorId: 90, anchor })
    expect(f.requests).toHaveLength(calls)
    const fresh = await f.service.execute('team.app.timeline', { conversationRef }) as TeamTimeline
    const read = async (ref: string) => await f.service.execute('team.app.local-mark.list', { conversationRef, markRefs: [ref] }) as { snapshot: MessageUnderlineSnapshot }[]
    expect((await read(fresh.messages[0]!.localMarkRef!))[0]!.snapshot).toEqual(first)
    await expect(f.service.execute('team.app.local-mark.change', { conversationRef, markRef,
      change: { kind: 'add', operationId: 'invalid', canonical: '已收到', anchor: { ...anchor, text: '错字' } } })).rejects.toMatchObject({ code: 'team-local-mark-source-changed' })
    await expect(f.service.execute('team.app.local-mark.list', { conversationRef, markRefs: [page.messages[0]!.ref] })).rejects.toThrow()
    rawMessage = { ...message, record: { ...message.record, version: 4, text_content: '已经修改' } }
    const edited = await f.service.execute('team.app.timeline', { conversationRef }) as TeamTimeline
    expect((await read(edited.messages[0]!.localMarkRef!))[0]!.snapshot.items[0]?.state).toBe('stale')
    await f.service.execute('team.app.local-mark.change', { conversationRef, markRef: edited.messages[0]!.localMarkRef,
      change: { kind: 'remove', operationId: 'remove', annotationId: first.items[0]!.id } })
    expect((await read(edited.messages[0]!.localMarkRef!))[0]!.snapshot.items).toEqual([])
    rawConversation = { ...conversation, conversation_uid: 'another-conversation' }
    const other = await open(f)
    await expect(f.service.execute('team.app.local-mark.list', { conversationRef: other.conversation!.ref, markRefs: [markRef] })).rejects.toThrow()
    rawMessage = { ...message, record: { ...message.record, status: 'deleted' } }
    expect((await f.service.execute('team.app.timeline', { conversationRef }) as TeamTimeline).messages[0]!.localMarkRef).toBeUndefined()
    f.changeAccount()
    await expect(read(markRef)).rejects.toThrow()
  } finally { db.close() }
})

describe('Team App owner adapter', () => {
  it('projects a complete summary batch using stable opaque identities and the Team owner only', async()=>{
    const f=fixture((path,body)=>path.endsWith('/summary-list')
      ? {items:(body.message_uids as string[]).map(message_uid=>({message_uid,team_read:true,visitor_read:false,summary:{recipient_count:1000,read_count:200,unread_count:800}})),last_seq:2,my_read_seq:2,unread:0}
      : {channel,conversation:{...conversation,side:'team'},messages:[message,{...message,message_uid:'second-message',seq:1}]})
    const opened=await open(f), timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    const result=await f.service.execute('team.app.receipt-summaries',{messageRefs:timeline.messages.map(m=>m.ref)}) as {items:Array<{key:string;summary:unknown}>}
    expect(result.items.map(m=>m.key)).toEqual(timeline.messages.map(m=>m.key))
    expect(result.items[0]!.summary).toEqual({total:1000,read:200,unread:800})
    expect(f.requests.at(-1)!.body).toEqual({conversation_uid:conversation.conversation_uid,side:'team',message_uids:['message-private','second-message']})
    expect(f.requests.every(r=>!r.path.includes('chat')&&!r.path.includes('record')&&!r.path.includes('read-receipts/query'))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/message-private|second-message|user_id|conversation_uid/)
    await expect(f.service.execute('team.app.receipt-summaries',{messageRefs:[timeline.messages[0]!.ref,timeline.messages[0]!.ref]})).rejects.toThrow()
    f.changeAccount()
    await expect(f.service.execute('team.app.receipt-summaries',{messageRefs:[timeline.messages[0]!.ref]})).rejects.toThrow()
  })
  it('does not disclose counts or identities in an external summary even if the server supplies them',async()=>{
    const own={...message,side:'external',actor_user_id:90}
    const f=fixture(path=>path.endsWith('/summary-list') ? {items:[{message_uid:own.message_uid,team_read:true,visitor_read:true,summary:{recipient_count:1,read_count:1,unread_count:0},members:[{user_id:11}]}],last_seq:2,my_read_seq:2,unread:0} : {channel,conversation,messages:[own]})
    const opened=await open(f),timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    const result=await f.service.execute('team.app.receipt-summaries',{messageRefs:[timeline.messages[0]!.ref]})
    expect(result).toEqual({items:[{key:timeline.messages[0]!.key,teamRead:true}],lastSeq:2,myReadSeq:2,unread:0})
  })
  it.each([[],[{message_uid:message.message_uid,team_read:true,summary:{recipient_count:10,read_count:9,unread_count:0}}]])('rejects incomplete summary truth %s instead of manufacturing unread',async items=>{
    const f=fixture(path=>path.endsWith('/summary-list') ? {items,last_seq:2,my_read_seq:2,unread:0} : {channel,conversation:{...conversation,side:'team'},messages:[message]})
    const opened=await open(f),timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    await expect(f.service.execute('team.app.receipt-summaries',{messageRefs:[timeline.messages[0]!.ref]})).rejects.toThrow()
  })
  it('resolves official membership by provider identity, including users with no team conversations', async () => {
    let teams: unknown = [{ ...channel, team_id: '9223372036854775801', name: channel.name }]
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : { teams })
    await expect(f.service.execute('team.app.official.membership', {})).resolves.toEqual({ jotmoId: 'arkme_cn', isMember: false })
    teams = [{ ...channel, name: '官方改名后', role: 3 }]
    await expect(f.service.execute('team.app.official.membership', {})).resolves.toEqual({ jotmoId: 'arkme_cn', isMember: true })
    teams = []
    await expect(f.service.execute('team.app.official.membership', {})).resolves.toEqual({ jotmoId: 'arkme_cn', isMember: false })
    teams = undefined
    await expect(f.service.execute('team.app.official.membership', {})).rejects.toMatchObject({ code: 'team-reference-invalid' })
    expect(f.requests.every(r => !r.path.endsWith('/conversations/open'))).toBe(true)
  })
  it.each(['external', 'team'] as const)('projects %s-side message receipts in the internal view with stable member identities and sender exclusion', async messageSide => {
    const f=fixture(path=>path.endsWith('/read-receipts/query')
      ? {team_read:true,visitor_read:false,has_more:false,members:[
          {user_id:11,identity:{nickname:'发送者'},read:true},
          {user_id:90,identity:{nickname:'重名'},read:true,read_at:123},
          {user_id:90,identity:{nickname:'重复页'},read:true},
          {user_id:91,identity:{nickname:'重名'},read:false},
          {user_id:92,identity:{nickname:'状态未知'}}]}
      : {channel,conversation:{...conversation,side:'team'},messages:[{...message,side:messageSide,actor_user_id:messageSide==='external'?200:11}]})
    const opened=await open(f), timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    const read=()=>f.service.execute('team.app.receipts',{messageRef:timeline.messages[0]!.ref}) as Promise<TeamReceipts>
    const first=await read(),second=await read()
    expect(first.senderExcluded).toBe(true)
    expect(first.members).toHaveLength(messageSide==='team'?3:4)
    expect(first.members.map(m=>m.key)).toEqual(second.members.map(m=>m.key))
    expect(first.members.find(m=>m.isMe)).toMatchObject({nickname:'重名',read:true})
    expect(first.members.find(m=>m.isMe)?.readAt).toBe(123)
    expect(first.members.at(-1)?.read).toBeUndefined()
    expect(JSON.stringify(first)).not.toMatch(/user_id|actor_user_id|sender_user_id/)
    expect(Object.keys(f.requests.at(-1)!.body).sort()).toEqual(['conversation_uid','cursor','limit','message_uid','side'])
  })
  it('never exposes member identities in the external view, even if the server includes them',async()=>{
    const f=fixture(path=>path.endsWith('/read-receipts/query') ? {team_read:true,members:[{user_id:11,identity:{nickname:'Private'}}],has_more:true,next_cursor:'secret'} : {channel,conversation,messages:[message]})
    const opened=await open(f),timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    const result=await f.service.execute('team.app.receipts',{messageRef:timeline.messages[0]!.ref}) as TeamReceipts
    expect(result).toMatchObject({teamRead:true,members:[],hasMore:false})
    expect(result.visitorRead).toBeUndefined();expect(result.nextCursor).toBeUndefined()
  })
  it.each([{}, {members:[],has_more:true}, {has_more:false}])('rejects incomplete internal receipt pages %s',async response=>{
    const f=fixture(path=>path.endsWith('/read-receipts/query') ? response : {channel,conversation:{...conversation,side:'team'},messages:[message]})
    const opened=await open(f),timeline=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    await expect(f.service.execute('team.app.receipts',{messageRef:timeline.messages[0]!.ref})).rejects.toMatchObject({code:'team-receipts-incomplete'})
  })

  it('projects discovered teams without signed URLs or internal identity and revalidates images through discovery', async () => {
    const f = fixture(() => ({team: {name: '公开团队', jotmo_id: 'public_team', state: 'pending', requires_approval: true,
      owner_user_id: 11, team_id: 'private-id', avatar: {mode: 'custom', key: 'avatar-key', url: 'https://signed.invalid/private'}}}))
    const result = await f.service.searchContactTeam('public_team', await f.runtime.requireSession())
    expect(result).toMatchObject({name: '公开团队', state: 'pending', requiresApproval: true, avatar: {mode: 'custom', imageRef: expect.stringMatching(/^team-app-profile-image\./)}})
    expect(JSON.stringify(result)).not.toMatch(/signed.invalid|owner_user_id|private-id/)
    expect(f.requests[0]?.path).toBe('/api/v1/team/discovery/search')
    expect(f.requests[0]?.body).toEqual({jotmo_id: 'public_team'})
  })
  it('resolves a nonmember discovery avatar and rejects replaced or cross-account references', async () => {
    let avatarKey = 'asset-one'
    const f = fixture(path => path === '/avatar.jpg' ? new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}})
      : {team:{name:'公开团队',jotmo_id:'public_team',state:'none',requires_approval:true,
          avatar:{mode:'custom',key:avatarKey,url:'https://userfiles.jotmo.cc/avatar.jpg'}}})
    const result = await f.service.searchContactTeam('public_team',await f.runtime.requireSession())
    const imageRef = result!.avatar.imageRef!
    await expect(f.service.execute('team.app.image',{imageRef})).resolves.toEqual({base64:'AQID',mimeType:'image/jpeg'})
    expect(f.requests.filter(v=>v.path==='/api/v1/team/discovery/search')).toHaveLength(2)
    expect(f.requests.some(v=>v.path==='/api/v1/team/profile/get')).toBe(false)
    avatarKey = 'asset-two'
    await expect(f.service.execute('team.app.image',{imageRef})).rejects.toThrow()
    f.changeAccount()
    const count = f.requests.length
    await expect(f.service.execute('team.app.image',{imageRef})).rejects.toThrow()
    expect(f.requests).toHaveLength(count)
  })
  it.each([undefined, null, 'true', 'false', 0, 1])('rejects discovery with malformed approval policy %s', async policy => {
    const f = fixture(() => ({team: {name:'Team',jotmo_id:'approval_team',state:'none',requires_approval:policy}}))
    await expect(f.service.searchContactTeam('approval_team',await f.runtime.requireSession())).rejects.toThrow()
  })

  it('distinguishes missing teams from invalid discovery responses', async () => {
    const missing = fixture(() => ({team: null})), broken = fixture(() => ({}))
    await expect(missing.service.searchContactTeam('missing', await missing.runtime.requireSession())).resolves.toBeUndefined()
    await expect(broken.service.searchContactTeam('missing', await broken.runtime.requireSession())).rejects.toThrow()
  })

  it.each(['team.app.official','team.app.conversations','team.app.open'] as const)('rejects a stale browser account before %s can return another account data', async operation => {
    const f=fixture(()=>({channel,conversation}))
    await expect(f.service.execute(operation,{expectedAccountKey:'test:91'})).rejects.toMatchObject({code:'team-account-changed'})
    expect(f.requests).toHaveLength(0)
    await expect(f.service.execute(operation,{expectedAccountKey:'prod:90'})).rejects.toMatchObject({code:'team-account-changed'})
    expect(f.requests).toHaveLength(0)
  })

  it.each(['team', 'external'])('preserves voice preview classification for the %s conversation list', async side => {
    const f = fixture(() => ({ items: [{ ...conversation, side,
      preview: { status: 'available', text: '', has_media: true, template_kind: 3 },
    }], has_more: false }))
    const result = await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }
    expect(result.items[0]?.preview).toEqual({ status: 'available', text: '', hasMedia: true, templateKind: 3 })
  })

  it('cancels by original send identity using current conversation authority without sending content', async () => {
    const f=fixture((path,body)=>path.endsWith('/messages/cancel')
      ? {message_uid:body.client_message_uid,seq:0,state:'cancelled',side:'external',own:true,revision:1}
      : {channel,conversation,messages:[]})
    const opened=await open(f)
    const result=await f.service.execute('team.app.cancel',{conversationRef:opened.conversation!.ref,clientUid:'original-command'}) as TeamSendResult
    expect(result.message?.state).toBe('cancelled')
    expect(f.requests.at(-1)?.body).toEqual({conversation_uid:conversation.conversation_uid,side:'external',client_message_uid:'original-command'})
    expect(f.requests.some(r=>r.path.endsWith('/messages/send'))).toBe(false)
    f.changeAccount()
    await expect(f.service.execute('team.app.cancel',{conversationRef:opened.conversation!.ref,clientUid:'original-command'})).rejects.toMatchObject({code:'team-reference-invalid'})
    expect(f.requests).toHaveLength(2)
  })
  it('keeps a real minimal send ACK distinct from a hydrated timeline and binds durable task scope to its viewer', async () => {
    const f=fixture((path,body)=>path.endsWith('/messages/send')
      ? {message_uid:body.client_message_uid,seq:3,state:'published',side:'external',own:true,sender:{nickname:'我'},created_at:1,revision:1}
      : {channel,conversation,messages:[]})
    const a=await open(f), b=await open(f)
    expect(a.conversation!.ref).not.toBe(b.conversation!.ref)
    expect(await f.service.conversationKey(a.conversation!.ref,90)).toBe(await f.service.conversationKey(b.conversation!.ref,90))
    await expect(f.service.conversationKey(a.conversation!.ref,91)).rejects.toMatchObject({code:'team-reference-invalid'})
    const result=await f.service.execute('team.app.send',{conversationRef:a.conversation!.ref,clientUid:'stable',expectedReplySeq:0,content:{text_content:'hello',template_kind:1}}) as TeamSendResult
    expect(result.message).toMatchObject({own:true,state:'published',version:0,contentStatus:'',media:[]})
    expect(result.message!.content).toBeUndefined()
  })

  it('resolves Record origin under current Team authority and seals its navigation reference', async () => {
    const f = fixture(path => path.endsWith('/context')
      ? { conversation_uid: conversation.conversation_uid, side: 'external', team_name: '新团队名' }
      : { conversation, messages: [] })
    const source = await f.service.execute('team.app.source', { conversationUid: conversation.conversation_uid }) as { name: string; conversationRef: string }
    expect(source.name).toBe('新团队名')
    expect(JSON.stringify(source)).not.toContain(conversation.conversation_uid)
    await f.service.execute('team.app.timeline', { conversationRef: source.conversationRef })
    expect(f.requests[0]!.body).toEqual({ conversation_uid: conversation.conversation_uid })
    expect(f.requests[1]!.body).toMatchObject({ conversation_uid: conversation.conversation_uid, side: 'external' })
    f.changeAccount()
    await expect(f.service.execute('team.app.timeline', { conversationRef: source.conversationRef })).rejects.toMatchObject({ code: 'team-reference-invalid' })
  })
  it('does not invent a Team source when the current user lost access', async () => {
    const f = fixture(() => new Response(JSON.stringify({ code:1001, data:{reason:'not_accessible'} })))
    await expect(f.service.execute('team.app.source', {conversationUid:'source'})).rejects.toMatchObject({code:'team-not_accessible'})
  })

  it('explains an ID claim race without retrying the create mutation', async () => {
    const f = fixture(path => path.endsWith('/create') ? new Response(JSON.stringify({code:1001,message:'参数错误'})) : {available:false,reason:'taken'})
    await expect(f.service.execute('team.app.create', {name:'团队',jotmoId:'studio_1',requestUid:'request'})).rejects.toMatchObject({message:'该即我号已被占用'})
    expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/team/create','/api/v1/auth/check-jotmo-id-available'])
  })

  it.each([true, false])('checks Team IDs in team_create without personal edit restrictions: %s', async available => {
    const f = fixture(() => ({available, reason: available ? '' : 'taken'}))
    expect(await f.service.execute('team.app.create.check', {jotmoId:' studio_1 '})).toEqual({available,reason:available?'':'taken'})
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0]!.path).toBe('/api/v1/auth/check-jotmo-id-available')
    expect(f.requests[0]!.body).toEqual({name:'studio_1',scene:'team_create'})
    expect(f.requests[0]!.headers.get('authorization')).toBe('Bearer app-token')
  })

  it('distinguishes missing official setup from revoked conversation access', async () => {
    const f = fixture(() => new Response(JSON.stringify({ code: 1001, data: { reason: 'official_unavailable' } })))
    await expect(f.service.execute('team.app.official', {})).rejects.toMatchObject({ code: 'team-official_unavailable', message: '暂时无法联系作者，请稍后重试' })
  })
  it('uses the App credential and lossless Team IDs without Chat, Subject or OpenAPI', async () => {
    const f = fixture(path => path.endsWith('/official-feedback-target') ? channel : path.endsWith('/message-channel/get') ? channel : {})
    const target = await f.service.execute('team.app.official', {}) as TeamChannel
    expect(target.link).toBe(`https://share.test/team-message?channel=${channel.public_ref}`)
    expect(JSON.stringify(target)).not.toContain(channel.team_id)
    await f.service.execute('team.app.channel', { teamRef: target.teamRef })
    expect(f.requests[1]?.body.team_id).toBe(channel.team_id)
    expect(f.requests.every(r => r.headers.get('authorization') === 'Bearer app-token')).toBe(true)
    expect(f.fetchImpl.mock.calls.every(args => String(args[0]).startsWith('https://team.test/'))).toBe(true)
  })
  it.each([
    { canManage: true, canPause: false, expected: false },
    { canManage: true, canPause: true, expected: true },
    { canManage: false, canPause: false, expected: false },
    { canManage: true, canPause: undefined, expected: true },
    { canManage: false, canPause: undefined, expected: false },
  ])('maps pause capability independently and supports legacy responses: $canManage/$canPause', async ({ canManage, canPause, expected }) => {
    const raw = { ...channel, can_manage: canManage, ...(canPause === undefined ? {} : { can_pause: canPause }) }
    const f = fixture(path => path.endsWith('/open') ? { channel: raw, conversation: { ...conversation, channel: raw } } : raw)
    const official = await f.service.execute('team.app.official', {}) as TeamChannel
    const settings = await f.service.execute('team.app.channel', { teamRef: official.teamRef }) as TeamChannel
    const opened = await open(f)
    for (const value of [official, settings, opened.channel, opened.conversation!.channel]) {
      expect(value).toMatchObject({ canManage, canPause: expected })
    }
  })
  it('redacts internal owner/actor/asset IDs and signed provider URLs from external messages', async () => {
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : { conversation, messages: [message], has_more: false, before_seq: 2 })
    const opened = await open(f)
    const page = await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline
    const encoded = JSON.stringify(page)
    for (const secret of ['conversation-private', 'message-private', 'actor_user_id', 'record_owner_user_id', 'asset-secret', 'private-signed.invalid', 'userfiles.jotmo.cc']) expect(encoded).not.toContain(secret)
    expect(page.messages[0]?.sender.nickname).toBe('小林')
    expect(page.messages[0]?.content?.text_content).toBe('已收到')
    expect(page.messages[0]!.media[0]!.url).toBe(`/custom/api/team/media?ref=${encodeURIComponent(page.messages[0]!.media[0]!.ref)}`)
  })
  it.each([true,false,undefined])('preserves recipient read truth without interpreting unknown as unread: %s', async value => {
    const f=fixture(path=>path.endsWith('/open') ? {channel,conversation} : {conversation,messages:[{...message,recipient_read:value}]})
    const opened=await open(f)
    const page=await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    expect(page.messages[0]!.recipientRead).toBe(value)
  })
  it('rejects cross-account and forged references before contacting owner', async () => {
    const f = fixture(() => ({ channel, conversation }))
    const opened = await open(f), count = f.requests.length
    f.changeAccount()
    await expect(f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref })).rejects.toMatchObject({ code: 'team-reference-invalid' })
    await expect(f.service.execute('team.app.channel', { teamRef: 'team-app-team.forged' })).rejects.toMatchObject({ code: 'team-reference-invalid' })
    expect(f.requests.length).toBe(count)
  })
  it('separates stable media presentation identity from rotating encrypted access references', async () => {
    let current = structuredClone(message)
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : { conversation, messages: [current] })
    const opened = await open(f)
    const read = async () => (await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline).messages[0]!
    const first = await read(), second = await read()
    expect(second.ref).not.toBe(first.ref)
    expect(second.media[0]!.ref).not.toBe(first.media[0]!.ref)
    expect(second.media[0]!.key).toBe(first.media[0]!.key)
    expect(second.sender.imageRef).not.toBe(first.sender.imageRef)
    expect(second.sender.imageKey).toBe(first.sender.imageKey)
    current.record.version++
    current.sender.avatar_url = 'https://userfiles.jotmo.cc/changed.png'
    const edited = await read()
    expect(edited.media[0]!.key).not.toBe(first.media[0]!.key)
    expect(edited.sender.imageKey).not.toBe(first.sender.imageKey)
    f.changeAccount()
    const other = await open(f)
    const page = await f.service.execute('team.app.timeline', { conversationRef: other.conversation!.ref }) as TeamTimeline
    expect(page.messages[0]!.media[0]!.key).not.toBe(edited.media[0]!.key)
  })
  it.each([
    ['OSSAccessKeyId=one&Expires=1&Signature=first&security-token=one', 'Signature=second&Expires=2&OSSAccessKeyId=two&security-token=two'],
    ['x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-credential=one&x-oss-date=20260924T010000Z&x-oss-expires=60&x-oss-signature=first', 'x-oss-signature=second&x-oss-expires=120&x-oss-date=20260924T020000Z&x-oss-credential=two&x-oss-signature-version=OSS4-HMAC-SHA256'],
  ])('keeps avatar identity across signed URL renewal but detects changed image content: %s', async (before, after) => {
    const base = 'https://jotmo-userfiles.senguo.me/avatar.png'
    let url = `${base}?${before}&x-oss-process=image%2Fresize%2Cw_80&v=1`
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : { conversation, messages: [{ ...message, sender: { nickname: '小林', avatar_url: url } }] })
    const opened = await open(f)
    const read = async () => (await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline).messages[0]!.sender
    const first = await read()
    url = `${base}?v=1&x-oss-process=image%2Fresize%2Cw_80&${after}`
    const renewed = await read()
    expect(renewed.imageKey).toBe(first.imageKey)
    expect(renewed.imageRef).not.toBe(first.imageRef)
    url = `${base}?${after}&x-oss-process=image%2Fresize%2Cw_160&v=1`
    expect((await read()).imageKey).not.toBe(first.imageKey)
    url = `${base}?${after}&x-oss-process=image%2Fresize%2Cw_80&v=2`
    const edited = await read()
    expect(edited.imageKey).not.toBe(first.imageKey)
    f.changeAccount()
    const other = await open(f)
    const page = await f.service.execute('team.app.timeline', { conversationRef: other.conversation!.ref }) as TeamTimeline
    expect(page.messages[0]!.sender.imageKey).not.toBe(edited.imageKey)
  })
  it('keeps draft and view identities separate when a visitor later joins the same team', async () => {
    let side = 'external'
    const f = fixture(() => ({ items: [{ ...conversation, side }], has_more: false }))
    const external = await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }
    side = 'team'
    const internal = await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }
    expect(internal.items[0]!.key).not.toBe(external.items[0]!.key)
    expect((await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }).items[0]!.key).toBe(internal.items[0]!.key)
  })
  it('drops a response completed after an account change', async () => {
    let release!: () => void
    const barrier = new Promise<void>(r => { release = r })
    const f = fixture(async () => { await barrier; return channel })
    const pending = f.service.execute('team.app.official', {})
    await vi.waitFor(() => { expect(f.requests).toHaveLength(1) })
    f.changeAccount(); release()
    await expect(pending).rejects.toMatchObject({ code: 'team-account-changed' })
  })
  it('preserves accepted operation and idempotency key on reply conflict without auto-confirming', async () => {
    const pendingMessage = { ...message, state: 'preparing', side: 'team', own: true }
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation: { ...conversation, side: 'team' } } : new Response(JSON.stringify({ code: 1004, data: { reason: 'reply_conflict', operation: pendingMessage } })))
    const opened = await open(f), p = { conversationRef: opened.conversation!.ref, clientUid: 'stable-attempt', expectedReplySeq: 2, content: { text_content: 'reply', template_kind: 1 } }
    const result = await f.service.execute('team.app.send', p) as TeamSendResult
    expect(result.reason).toBe('reply_conflict'); expect(result.message?.state).toBe('preparing')
    await f.service.execute('team.app.send', p)
    expect(f.requests.filter(r => r.path.endsWith('/send')).map(r => r.body.client_message_uid)).toEqual(['stable-attempt', 'stable-attempt'])
    expect(f.requests.some(r => r.path.endsWith('/confirm-reply'))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('message-private')
  })
  it('maps a legacy reply rejection without operation to recoverable delivery, not confirmation', async () => {
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : new Response(JSON.stringify({ code: 1004, data: { reason: 'reply_conflict' } })))
    const opened = await open(f)
    await expect(f.service.execute('team.app.send', {conversationRef:opened.conversation!.ref,clientUid:'original',expectedReplySeq:0,content:{text_content:'reply',template_kind:1}})).rejects.toMatchObject({code:'team-reply_conflict',retryable:true,message:'服务暂时不可用，请使用原请求重试'})
    expect(f.requests.some(r => r.path.endsWith('/confirm-reply'))).toBe(false)
  })
  it('does not cache a previous success over a removed membership', async () => {
    let denied = false
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : denied ? new Response(JSON.stringify({ code: 1004, data: { reason: 'not_accessible' } })) : { conversation, messages: [message] })
    const opened = await open(f), p = { conversationRef: opened.conversation!.ref }
    await f.service.execute('team.app.timeline', p); denied = true
    await expect(f.service.execute('team.app.timeline', p)).rejects.toMatchObject({ code: 'team-not_accessible', retryable: false })
  })
  it('applies for protected membership without falling back to the open platform', async () => {
    const f = fixture(path => path.endsWith('/join-by-jotmo-id') ? new Response(JSON.stringify({ code: 1004, data: { reason: 'approval_required' } })) : { state: 'pending', user_id: 90, team_id: 42 })
    await expect(f.service.execute('team.app.join', { jotmoId: 'protected_team', requestUid: 'application-1' })).resolves.toEqual({ state: 'pending' })
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/team/join-by-jotmo-id', '/api/v1/team/join-requests/create'])
    expect(f.requests[1]?.body).toEqual({ jotmo_id: 'protected_team', request_uid: 'application-1' })
  })
  it.each(['joined','not_member'])('resolves an approved request replay to current %s membership', async state => {
    const f = fixture(path => path.endsWith('/join-by-jotmo-id') ? new Response(JSON.stringify({code:1004,data:{reason:'approval_required'}})) : path.endsWith('/join-requests/create') ? {state:'approved'} : {state})
    await expect(f.service.execute('team.app.join',{jotmoId:'protected_team',requestUid:'replay'})).resolves.toEqual({state})
  })
  it('recognizes approval racing with submission and rejects malformed success states', async () => {
    const f = fixture(path => new Response(JSON.stringify({code:1004,data:{reason:path.endsWith('/join-by-jotmo-id')?'approval_required':'already_member'}})))
    await expect(f.service.execute('team.app.join',{jotmoId:'protected_team',requestUid:'race'})).resolves.toEqual({state:'joined'})
    const broken = fixture(path => path.endsWith('/join-by-jotmo-id') ? new Response(JSON.stringify({code:1004,data:{reason:'approval_required'}})) : {})
    await expect(broken.service.execute('team.app.join',{jotmoId:'protected_team',requestUid:'broken'})).rejects.toThrow()
  })
  it('returns only current members and opaque removal handles', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? { items: [{ user_id: 11, display_name: '林', role: 3, can_remove: true }], total_count: 1 } : { teams: [{ ...channel, role: 1 }] })
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const members = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(members.items[0]?.canRemove).toBe(true)
    expect(members.items[0]?.codexSync).toEqual({state:'unavailable',reason:'unsupported'})
    const refreshed = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(refreshed.items[0]?.userRef).not.toBe(members.items[0]?.userRef)
    expect(refreshed.items[0]?.key).toBe(members.items[0]?.key)
    expect(JSON.stringify(members)).not.toContain('user_id')
    await f.service.execute('team.app.member.remove', { userRef: members.items[0]!.userRef })
    expect(f.requests.at(-1)?.body).toEqual({ team_id: channel.team_id, target_user_id: 11 })
  })
  it('passes only validated member sync status without additional member-by-member calls', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? { items: [
      { user_id: 11, display_name: '甲', role: 3, codex_sync: {version:1,state:'enabled',has_conversations:false,can_view_conversations:true,private_path:'/private'} },
      { user_id: 12, display_name: '乙', role: 3, codex_sync: {version:1,state:'not_connected',has_conversations:false,can_view_conversations:false} },
      { user_id: 13, display_name: '丙', role: 3, codex_sync: {version:1,state:'enabled',has_conversations:0,can_view_conversations:'true'} },
    ], total_count: 3 } : { teams: [{ ...channel, role: 1 }] })
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const result = await f.service.execute('team.app.members', {teamRef:c.teamRef,avatarMode:'deferred'}) as TeamMembers
    expect(result.items.map(item => item.codexSync)).toEqual([
      {state:'enabled',hasConversations:false,canViewConversations:true},
      {state:'not_connected',hasConversations:false,canViewConversations:false},
      {state:'unavailable',reason:'invalid'},
    ])
    expect(JSON.stringify(result)).not.toContain('/private')
    expect(f.requests.filter(r => r.path.includes('members/list'))).toHaveLength(1)
    expect(f.requests.some(r => r.path.includes('connection/status'))).toBe(false)
  })
  it('preserves optional profile avatars and unavailable identity without changing member authority', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? {
      items: [{ user_id: 11, display_name: '林', jotmo_id: 'member_lin', identity_state: 'ready', role: 3 },
        { user_id: 12, display_name: '用户', identity_state: 'unavailable', role: 3 }], total_count: 2,
    } : { teams: [{ ...channel, role: 1 }] })
    f.avatars.publicAvatarPresentationsByArkmeIds.mockResolvedValue(new Map([['member_lin', { avatarRef: 'profile-avatar' }]]))
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const members = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(members.items[0]).toMatchObject({ avatarRef: 'profile-avatar', identityState: 'ready' })
    expect(members.items[1]).toMatchObject({ identityState: 'unavailable' })
    expect(f.avatars.publicAvatarPresentationsByArkmeIds).toHaveBeenCalledWith(['member_lin'], expect.any(AbortSignal))
    f.avatars.publicAvatarPresentationsByArkmeIds.mockRejectedValue(new Error('avatar unavailable'))
    const degraded = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(degraded.items).toHaveLength(2)
    expect(degraded.items[0]?.avatarRef).toBe('profile-avatar')
    expect(degraded.avatarState).toBe('unavailable')
  })
  it('returns membership without waiting for avatars, then enriches and caches only viewer-scoped presentation', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? {
      items: [{ user_id: 11, display_name: '林', jotmo_id: 'member_lin', identity_state: 'ready', role: 3 }], total_count: 1,
    } : { teams: [{ ...channel, role: 1 }] })
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const first = await f.service.execute('team.app.members', { teamRef: c.teamRef, avatarMode: 'deferred' }) as TeamMembers
    expect(first.avatarState).toBe('pending')
    expect(f.avatars.publicAvatarPresentationsByArkmeIds).not.toHaveBeenCalled()
    f.avatars.publicAvatarPresentationsByArkmeIds.mockResolvedValue(new Map([['member_lin', { avatarRef: 'real-avatar' }]]))
    const fresh = await f.service.execute('team.app.members', { teamRef: c.teamRef, avatarMode: 'wait' }) as TeamMembers
    expect(fresh).toMatchObject({ avatarState: 'ready', items: [{ avatarRef: 'real-avatar' }] })
    const cached = await f.service.execute('team.app.members', { teamRef: c.teamRef, avatarMode: 'deferred' }) as TeamMembers
    expect(cached.items[0]?.avatarRef).toBe('real-avatar')
    // An explicit empty presentation is authoritative; a failure is not.
    f.avatars.publicAvatarPresentationsByArkmeIds.mockResolvedValue(new Map([['member_lin', {} as { avatarRef: string }]]))
    const cleared = await f.service.execute('team.app.members', { teamRef: c.teamRef, avatarMode: 'wait' }) as TeamMembers
    expect(cleared.items[0]?.avatarRef).toBeUndefined()
    f.changeAccount()
    await expect(f.service.execute('team.app.members', { teamRef: c.teamRef, avatarMode: 'deferred' })).rejects.toMatchObject({ code: 'team-reference-invalid' })
  })
  it('rechecks membership on every byte request and never forwards provider credentials or URLs', async () => {
    let denied = false
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : path.endsWith('/media') ? denied ? new Response(JSON.stringify({ code: 1004, data: { reason: 'not_accessible' } }), { headers: { 'content-type': 'application/json' } }) : new Response('bytes', { headers: { 'content-type': 'application/octet-stream' } }) : { conversation, messages: [message] })
    const opened = await open(f), timeline = await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline
    const ref = timeline.messages[0]!.media[0]!.ref
    const bytes = await f.service.fetchMedia(ref, 'bytes=0-3', new AbortController().signal)
    expect(await bytes.response.text()).toBe('bytes')
    expect(f.requests.at(-1)?.headers.get('range')).toBe('bytes=0-3')
    denied = true
    await expect(f.service.fetchMedia(ref, undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'team-not_accessible' })
  })
  it('keeps Team notifications distinct from existing member events and rejects extra payload', () => {
    const event = { t: 28, event_uid: 'e', event_at: 100, revision: 2, kind: 'team.message.changed', conversation_uid: 'c' }
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify(event)}`)).toEqual({ eventUid: 'e', eventAtMillis: 100, receiptOnly: false, change:{kind:event.kind,conversationUid:'c',conversationRevision:2} })
    expect(decodeArkmeMemberEventDataLine(`data: ${JSON.stringify(event)}`)).toBeUndefined()
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({ ...event, t: 27 })}`)).toBeUndefined()
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({ ...event, text_content: 'private' })}`)).toBeUndefined()
  })
})

const profileTeam={team_id:channel.team_id,name:'团队',jotmo_id:'test_team',role:1,profile_revision:3,can_edit_profile:true,avatar:{mode:'custom',key:'team:private:asset:secret',url:'https://bucket.s3.example/avatar?sig=private',slots:[{user_id:11,name:'所有者',avatar_url:'https://userfiles.jotmo.cc/member.png'}]}}
async function profileRef(f:ReturnType<typeof fixture>){return ((await f.service.execute('team.app.teams',{})) as Array<{teamRef:string}>)[0]!.teamRef}
describe('Team profile owner adapter',()=>{
 it.skipIf(!process.env.JOTMO_TEAM_PROFILE_HINTS_FILE)('decodes the actual Team to IM profile fanout wire',async()=>{
  const lines=(await readFile(process.env.JOTMO_TEAM_PROFILE_HINTS_FILE!,'utf8')).trim().split('\n')
  for(const line of lines)expect(decodeArkmeTeamNotificationDataLine(`data: ${line}`)).toMatchObject({eventUid:expect.any(String),eventAtMillis:expect.any(Number)})
 })

 it('seals image and team locators, keeps presentation identity through signature rotation, and rejects another account',async()=>{
  const f=fixture(path=>path.endsWith('/list-mine')?{teams:[profileTeam]}:{team:profileTeam});const ref=await profileRef(f)
  const a=await f.service.execute('team.app.profile.get',{teamRef:ref}) as import('../src/team-profile-contract.js').ArkmeTeamProfile
  const b=await f.service.execute('team.app.profile.get',{teamRef:ref}) as typeof a
  expect(a.avatar.key).toBe(b.avatar.key);expect(a.avatar.imageRef).not.toBe(b.avatar.imageRef);expect(a.avatar).not.toHaveProperty('slots')
  for(const secret of [channel.team_id,'asset:secret','sig=private','s3.example','user_id','member.png'])expect(JSON.stringify(a)).not.toContain(secret)
  f.changeAccount();await expect(f.service.execute('team.app.profile.get',{teamRef:a.profileRef})).rejects.toMatchObject({code:'team-reference-invalid'})
 })
 it.each([0,1])('recovers lost response only from this exact request receipt: %s',async accepted=>{
  const f=fixture(path=>path.endsWith('/list-mine')?{teams:[profileTeam]}:path.endsWith('/profile/update')?new Response(JSON.stringify({code:500,data:{reason:'dependency_unavailable'}})):path.endsWith('/status')?{accepted_revision:accepted,request_uid:'same',team:{...profileTeam,profile_revision:9}}:{team:profileTeam})
  const ref=await profileRef(f),call=f.service.execute('team.app.profile.update',{teamRef:ref,expectedRevision:3,requestUid:'same',name:' 新名 '})
  if(accepted)expect(await call).toMatchObject({acceptedRevision:1,requestUid:'same',profile:{profileRevision:9}})
  else await expect(call).rejects.toMatchObject({code:'team-dependency_unavailable'})
  expect(f.requests.at(-1)!.body).toEqual({team_id:channel.team_id,request_uid:'same'})
  expect(f.requests.at(-2)!.body.name).toBe('新名')
 })
 it.each(['not_owner','version_conflict','idempotency_conflict','invalid_team_profile','profile_edit_rejected'])('preserves definitive %s instead of masking it with an old receipt',async reason=>{
  const f=fixture(path=>path.endsWith('/list-mine')?{teams:[profileTeam]}:path.endsWith('/profile/update')?new Response(JSON.stringify({code:1001,data:{reason}})):{accepted_revision:4,team:profileTeam})
  const ref=await profileRef(f)
  await expect(f.service.execute('team.app.profile.update',{teamRef:ref,expectedRevision:3,requestUid:'same',name:'different'})).rejects.toMatchObject({code:`team-${reason}`})
  expect(f.requests.some(r=>r.path.endsWith('/status'))).toBe(false)
 })
 it('keeps channel writes independent and resolves a public custom avatar outside member-only profile reads',async()=>{
  const v={...channel,avatar:profileTeam.avatar}
  const f=fixture(path=>path.endsWith('/conversations/open')?{channel:v}:path.endsWith('/configure')?v:path.endsWith('/message-channel/get')?v:path.endsWith('/resolve')?v:path==='/avatar'?new Response('jpeg',{headers:{'content-type':'image/jpeg'}}):{teams:[profileTeam]})
  const opened=await open(f)
  await f.service.execute('team.app.channel.configure',{teamRef:opened.channel.teamRef,revision:1,enabled:true})
  expect(f.requests.find(r=>r.path.endsWith('/configure'))?.body.avatar_url).toBe('')
  expect(opened.channel.avatar?.mode).toBe('custom')
  await expect(f.service.execute('team.app.image',{imageRef:opened.channel.avatar!.imageRef})).resolves.toMatchObject({mimeType:'image/jpeg'})
  expect(f.requests.some(r=>r.path.endsWith('/profile/get'))).toBe(false)
  expect(f.requests.find(r=>r.path.endsWith('/resolve'))?.body).toEqual({public_ref:channel.public_ref})
 })
 it('checks actual owner before parsing or uploading bytes',async()=>{
  const f=fixture(path=>path.endsWith('/list-mine')?{teams:[profileTeam]}:{team:{...profileTeam,can_edit_profile:false}});const ref=await profileRef(f)
  await expect(f.service.execute('team.app.profile.avatar.upload',{teamRef:ref,uploadUid:'image',contentBase64:'invalid'})).rejects.toMatchObject({code:'team-not_owner'})
  expect(f.requests).toHaveLength(2)
 })
})

it('validates Team reply context, transports the quote and masks the parent locator',async()=>{
 const rawParent={message_uid:'parent-private',seq:1,record_version:3,state:'available',sender:{nickname:'成员'},text:'已收到',quote:{version:1,projection:'arkme-text-v1',recordVersion:3,sourceDigest:'a'.repeat(64),start:0,end:2,text:'已收',prefix:'',suffix:'到'}}
 const f=fixture(path=>({channel,conversation,messages:[{...message,reply:rawParent}],...(path.endsWith('/send')?{...message}: {})}))
 const opened=await open(f),ref=opened.conversation!.ref
 const page=await f.service.execute('team.app.timeline',{conversationRef:ref}) as TeamTimeline
 const parent=page.messages[0]!.reply!
 expect(parent).toMatchObject({seq:1,version:3,state:'available',quote:rawParent.quote})
 expect(JSON.stringify(parent)).not.toContain('parent-private')
 await f.service.execute('team.app.send',{conversationRef:ref,clientUid:'client',content:{text_content:'回复',template_kind:1},replyToRef:parent.ref,replyRecordVersion:3,quote:parent.quote})
 expect(f.requests.at(-1)!.body).toMatchObject({reply_to:'parent-private',reply_record_version:3,quote:rawParent.quote})
 await f.service.execute('team.app.locate',{conversationRef:ref,messageRef:parent.ref})
 expect(f.requests.at(-1)).toMatchObject({path:'/api/v1/team/conversations/timeline/locate',body:{message_uid:'parent-private'}})
 f.changeAccount()
 await expect(f.service.execute('team.app.send',{conversationRef:ref,replyToRef:parent.ref})).rejects.toMatchObject({code:'team-reference-invalid'})
})

it('reports exact authorized Team occurrences without trusting body, owner or reviewer input',async()=>{
 let current=conversation
 const f=fixture(path=>path.endsWith('/reports/create')?{report_uid:'accepted-report'}:{channel,conversation:current,messages:[message]})
 const opened=await open(f),ref=opened.conversation!.ref
 const page=await f.service.execute('team.app.timeline',{conversationRef:ref}) as TeamTimeline
 const command={conversationRef:ref,messageRef:page.messages[0]!.ref,version:3,reason:'privacy',description:'个人信息'}
 expect(await f.service.execute('team.app.report',command)).toEqual({reportUid:'accepted-report'})
 expect(f.requests.at(-1)?.body).toEqual({conversation_uid:conversation.conversation_uid,side:'external',message_uid:message.message_uid,expected_record_version:3,reason:'privacy',description:'个人信息'})
 const calls=f.requests.length
 await expect(f.service.execute('team.app.report',{...command,version:3.5})).rejects.toThrow()
 expect(f.requests).toHaveLength(calls)
 current={...conversation,conversation_uid:'foreign'}
 const other=await open(f)
 await expect(f.service.execute('team.app.report',{...command,conversationRef:other.conversation!.ref})).rejects.toThrow()
 f.changeAccount()
 await expect(f.service.execute('team.app.report',command)).rejects.toThrow()
})

it('creates the existing SID share from exact Team occurrences and never exposes raw owner input',async()=>{
 const f=fixture((path,body)=>path==='/api/v1/chats/messages/copy-link/get-or-create'
  ? new Response(JSON.stringify({code:200,data:{sid:'share-sid',url:'https://share.test/s/share-sid'}}),{headers:{'content-type':'application/json'}})
  : {channel,conversation,messages:[message]})
 const conversationRef=(await open(f)).conversation!.ref
 const page=await f.service.execute('team.app.timeline',{conversationRef}) as TeamTimeline
 const selections=[{messageRef:page.messages[0]!.ref,version:3}]
 expect(await f.service.execute('team.app.copy-link',{conversationRef,selections})).toEqual({sid:'share-sid',url:'https://share.test/s/share-sid'})
 expect(f.requests.at(-1)?.body).toEqual({sources:[{kind:'team_message',team_source:{conversation_uid:conversation.conversation_uid,message_uid:message.message_uid,side:'external',expected_record_version:3}}]})
 const count=f.requests.length
 await expect(f.service.execute('team.app.copy-link',{conversationRef,selections:[...selections,...selections]})).rejects.toThrow()
 await expect(f.service.execute('team.app.copy-link',{conversationRef,selections:[{...selections[0],version:3.5}]})).rejects.toThrow()
 expect(f.requests).toHaveLength(count)
 f.changeAccount()
 await expect(f.service.execute('team.app.copy-link',{conversationRef,selections})).rejects.toThrow()
 expect(f.requests).toHaveLength(count)
})

it('binds a frozen Team card to owner-blind target media and removes source actor actions',async()=>{
 const forward={source_type:'team_message',render_kind:'forward_records',title:'卡片',items:[{owner_name:'原作者',text:'冻结正文',files:[{file_asset_uid:'physical',media_key:'forward-owner-blind',name:'frozen.png'}]}]}
 const full={...message,record:{...message.record,content_payload:{payload_kind:1,forward_records:forward},media:[{file_asset_uid:'forward-owner-blind',file_name:'frozen.png',mime_type:'image/png',file_kind:1,size:42}]}}
 const f=fixture(()=>({channel,conversation,messages:[full]}))
 const conversationRef=(await open(f)).conversation!.ref,page=await f.service.execute('team.app.timeline',{conversationRef}) as TeamTimeline
 const card=page.messages[0]!
 expect(card.forwardRecords?.items[0]).toMatchObject({senderName:'原作者',textContent:'冻结正文',contentBlocks:[{mediaRef:card.media[0]?.ref}]})
 expect(card.forwardRecords?.items[0]).not.toHaveProperty('senderUserId')
 expect(JSON.stringify(card.forwardRecords)).not.toContain('private-signed')
})

it('projects scoped conversation cursor metadata without fetching bodies and rejects incomplete batches', async () => {
  let broken = false
  const f=fixture((path,body)=>path.endsWith('/read-state/query-list')
    ? {items:broken?[]:(body.conversation_uids as string[]).map(conversation_uid=>({conversation_uid,accessible:true,last_seq:2,my_read_seq:2,unread:0}))}
    : {channel,conversation})
  const opened=await open(f), ref=opened.conversation!.ref
  const data=await f.service.execute('team.app.read-states',{conversationRefs:[ref]})
  expect(data).toEqual([{key:opened.conversation!.key,accessible:true,lastSeq:2,myReadSeq:2,unread:0,notificationPolicy:{muted:false,policyVersion:0,notifyAfterSeq:0}}])
  expect(f.requests.at(-1)!.body).toEqual({side:'external',conversation_uids:[conversation.conversation_uid]})
  expect(JSON.stringify(data)).not.toContain(conversation.conversation_uid)
  broken=true
  await expect(f.service.execute('team.app.read-states',{conversationRefs:[ref]})).rejects.toThrow()
  await expect(f.service.execute('team.app.read-states',{conversationRefs:[ref,ref]})).rejects.toThrow()
  f.changeAccount()
  await expect(f.service.execute('team.app.read-states',{conversationRefs:[ref]})).rejects.toThrow()
})

describe('Team visitor private chat authority', () => {
  it('resolves the visitor on the host from a fresh conversation instead of client identity', async () => {
    const f = fixture(() => ({ channel, conversation: { ...conversation, side: 'team', external_user_id: 200, visitor: { nickname: '访客' } }, messages: [] }))
    const opened = await open(f)
    const result = await f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref, expectedAccountKey: 'test:90', peerUserId: 999, displayName: '伪造昵称' })
    expect(result).toEqual({ source: { kind: 'private_chat', sourceRef: 'private-ref' } })
    expect(f.privateChat.openPrivateChatFromUser).toHaveBeenCalledExactlyOnceWith(200, { presentationDisplayName: '访客', expectedViewerUserId: 90 })
    expect(f.requests.at(-1)?.body).toEqual({ conversation_uid: 'conversation-private', side: 'team', before_seq: 0, limit: 1 })
  })
  it.each([undefined, 0, 90, '9223372036854775806'])('rejects missing, self, and unsafe visitor identities: %s', async external_user_id => {
    const f = fixture(() => ({ channel, conversation: { ...conversation, side: 'team', external_user_id }, messages: [] }))
    const opened = await open(f)
    await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref })).rejects.toMatchObject({ code: 'team-visitor-identity-unavailable' })
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('does not let an external viewer use team visitor actions', async () => {
    const f = fixture(() => ({ channel, conversation, messages: [] })), opened = await open(f)
    await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref })).rejects.toThrow()
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('rejects changed account and a mismatched returned conversation', async () => {
    let current: Record<string, unknown> = { ...conversation, side: 'team', external_user_id: 200 }
    const f = fixture(() => ({ channel, conversation: current, messages: [] })), opened = await open(f)
    current = { ...current, conversation_uid: 'wrong-conversation' }
    await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref })).rejects.toThrow()
    f.changeAccount()
    await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref, expectedAccountKey: 'test:90' })).rejects.toThrow()
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
})


it('requires stable conversation identity even when a valid external sender exists in history', async () => {
  const current = { ...conversation, side: 'team', external_user_id: undefined, latest_external_seq: 7, visitor: { nickname: '访客' } }
  const f = fixture((_path, body) => ({ channel, conversation: current, messages: body.before_seq === 8
    ? [{ ...message, side: 'external', actor_user_id: 200, seq: 7 }]
    : [{ ...message, side: 'team', actor_user_id: 11, seq: 9 }] }))
  const opened = await open(f)
  await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref })).rejects.toThrow()
  expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  expect(f.requests.at(-1)!.body).toMatchObject({ before_seq: 0, limit: 1 })
})
it.each([
  { side: 'team', actor_user_id: 200, seq: 7 },
  { side: 'external', actor_user_id: 200, seq: 6 },
  { side: 'external', actor_user_id: undefined, seq: 7 },
])('never substitutes a different message or missing sender for the verified external identity', async raw => {
  const f = fixture(() => ({ channel, conversation: { ...conversation, side: 'team', external_user_id: undefined, latest_external_seq: 7 }, messages: [{ ...message, ...raw }] }))
  const opened = await open(f)
  await expect(f.service.execute('team.app.visitor.private.open', { conversationRef: opened.conversation!.ref })).rejects.toThrow()
  expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
})


describe('Team people identity and private remarks', () => {
  function setup() {
    let current = { ...conversation, side: 'team' }
    const f = fixture(() => ({ channel, conversation: current, messages: [message], has_more: false }))
    return { ...f, setConversation(uid: string) { current = { ...current, conversation_uid: uid } } }
  }
  async function target(f: ReturnType<typeof setup>) {
    const result = await open(f)
    const ref = result.conversation!.ref
    const page = await f.service.execute('team.app.timeline', { conversationRef: ref }) as TeamTimeline
    return { ref, person: page.messages[0]!.sender }
  }
  it('opens the exact internal sender with a viewer/conversation-bound reference, never its nickname', async () => {
    const f = setup(), { ref, person } = await target(f)
    expect(person.personKey).toBeTruthy(); expect(person.personRef).toBeTruthy(); expect(person.isMe).toBe(false)
    await f.service.execute('team.app.person.private.open', { conversationRef: ref, personRef: person.personRef, userId: 999 })
    expect(f.privateChat.openPrivateChatFromUser).toHaveBeenCalledWith(11, expect.objectContaining({ expectedViewerUserId: 90 }))
  })
  it('batch resolves only viewer-owned remarks without writing them to Team', async () => {
    const f = setup(), { ref, person } = await target(f)
    f.contacts.privateRemarksByUserIds.mockResolvedValue(new Map([[11, '我的同事备注']]))
    const result = await f.service.execute('team.app.people.remarks', { conversationRef: ref, personRefs: [person.personRef] })
    expect(result).toEqual({ items: [{ personKey: person.personKey, remark: '我的同事备注' }] })
    expect(f.contacts.privateRemarksByUserIds).toHaveBeenCalledWith([11], {})
    expect(JSON.stringify(f.requests)).not.toContain('我的同事备注')
    f.contacts.privateRemarksByUserIds.mockResolvedValue(new Map())
    expect(await f.service.execute('team.app.people.remarks', { conversationRef: ref, personRefs: [person.personRef] })).toEqual({items:[{personKey:person.personKey,remark:''}]})
  })
  it('rejects cross-conversation person references before contacts or private chat access', async () => {
    const f = setup(), first = await target(f)
    f.setConversation('other-conversation')
    const second = await target(f)
    await expect(f.service.execute('team.app.person.private.open', { conversationRef: second.ref, personRef: first.person.personRef })).rejects.toThrow()
    await expect(f.service.execute('team.app.people.remarks', { conversationRef: second.ref, personRefs: [first.person.personRef] })).rejects.toThrow()
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled(); expect(f.contacts.privateRemarksByUserIds).not.toHaveBeenCalled()
  })
  it('rejects stale membership and account changes before returning private remarks', async () => {
    const f = setup(), first = await target(f)
    f.setConversation('mismatched-response')
    await expect(f.service.execute('team.app.people.remarks', { conversationRef: first.ref, personRefs:[first.person.personRef] })).rejects.toThrow()
    expect(f.contacts.privateRemarksByUserIds).not.toHaveBeenCalled()
    f.changeAccount()
    await expect(f.service.execute('team.app.person.private.open', { conversationRef:first.ref,personRef:first.person.personRef })).rejects.toThrow()
  })
  it('never exposes member action references to the external viewer', async () => {
    const f = fixture(() => ({channel,conversation,messages:[message],has_more:false})), opened = await open(f)
    const page = await f.service.execute('team.app.timeline',{conversationRef:opened.conversation!.ref}) as TeamTimeline
    expect(page.messages[0]!.sender.personRef).toBeUndefined(); expect(page.messages[0]!.sender.personKey).toBeUndefined()
  })
})

it('projects server reply keys and rejects cross-conversation or cross-account reply references before sending', async () => {
  let current = conversation
  const f = fixture(path => path.endsWith('/messages/send') ? {...message,reply:{message_uid:message.message_uid,seq:1,record_version:3,state:'available',text:'原文',sender:{nickname:'同事'}}} : {channel,conversation:current,messages:[message]})
  const opened = await open(f), conversationRef = opened.conversation!.ref
  const page = await f.service.execute('team.app.timeline',{conversationRef}) as TeamTimeline
  const parent = page.messages[0]!
  const key = await f.service.replyKey(conversationRef,parent.ref,90)
  expect(key).toBe(parent.key)
  const sent = await f.service.execute('team.app.send',{conversationRef,replyToRef:parent.ref,replyRecordVersion:3,content:{text_content:'延展',template_kind:1}}) as TeamSendResult
  expect(sent.message?.reply?.key).toBe(parent.key)
  expect(f.requests.at(-1)!.body.reply_to).toBe(message.message_uid)
  current = {...conversation,conversation_uid:'another'}
  const other = await open(f), before = f.requests.length
  await expect(f.service.execute('team.app.send',{conversationRef:other.conversation!.ref,replyToRef:parent.ref})).rejects.toThrow()
  expect(f.requests).toHaveLength(before)
  f.changeAccount()
  await expect(f.service.replyKey(conversationRef,parent.ref,91)).rejects.toThrow()
})

describe('team member candidate and pending add boundary', () => {
  const owner = { team_id: 17, role: 1, name: '团队', jotmo_id: 'team' }
  type Page = import('../src/team-member-add-contract.js').TeamMemberCandidatePage
  async function ref(f: ReturnType<typeof fixture>) { return ((await f.service.execute('team.app.teams', {})) as Array<{ teamRef: string }>)[0]!.teamRef }
  const handler = (path: string) => path.endsWith('/list-mine') ? { teams: [owner] } : { items: [{ user_id: 90 }, { user_id: 12 }], has_more: false }
  it('deduplicates people by real account across sources and disables self/existing members without exposing IDs', async () => {
    const f = fixture(handler), teamRef = await ref(f)
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '备注' }, { userId: 11, displayName: '备注' }, { userId: 12, displayName: '同名' }, { userId: 90, displayName: '我' }], hasMore: false })
    const first = await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' }) as Page
    expect(first.items).toHaveLength(3)
    expect(first.items[0]).toMatchObject({ displayName: '备注', alreadyMember: false, isSelf: false })
    expect(first.items[1]).toMatchObject({ alreadyMember: true, isSelf: false })
    expect(first.items[2]).toMatchObject({ alreadyMember: true, isSelf: true })
    expect(first.items.some(item => 'userId' in item)).toBe(false)
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '群昵称' }], hasMore: false })
    const second = await f.service.execute('team.app.member-candidates', { teamRef, source: 'group', sourceRef: 'group' }) as Page
    expect(second.items[0]!.key).toBe(first.items[0]!.key)
    await expect(f.service.execute('team.app.members.add', { teamRef, candidateRefs: [second.items[0]!.candidateRef], requestUid: 'attempt-1' })).resolves.toEqual({ state: 'backend_pending' })
    expect(f.requests.every(req => /\/(list-mine|members\/list)$/.test(req.path))).toBe(true)
    expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('reads all membership pages so a later existing member cannot be selected', async () => {
    const f = fixture((path, body) => path.endsWith('/list-mine') ? { teams: [owner] } : body.page_cursor ? { items: [{ user_id: 11 }], has_more: false } : { items: [{ user_id: 90 }], has_more: true, next_page_cursor: 'next' })
    const teamRef = await ref(f)
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '人' }], hasMore: false })
    const page = await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' }) as Page
    expect(page.items[0]!.alreadyMember).toBe(true)
    await expect(f.service.execute('team.app.members.add', { teamRef, candidateRefs: [page.items[0]!.candidateRef], requestUid: '1' })).rejects.toThrow('已经加入')
  })
  it('binds cursors and sealed candidates to team, account and source', async () => {
    const f = fixture(path => path.endsWith('/list-mine') ? { teams: [owner, { ...owner, team_id: 18 }] } : { items: [], has_more: false })
    const teams = await f.service.execute('team.app.teams', {}) as Array<{ teamRef: string }>, teamRef = teams[0]!.teamRef
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '人' }], hasMore: true, nextCursor: 'opaque-upstream-cursor' })
    const page = await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' }) as Page
    await expect(f.service.execute('team.app.member-candidates', { teamRef, source: 'conversations', cursor: page.nextCursor })).rejects.toThrow()
    await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts', cursor: page.nextCursor })
    expect(f.candidates.list).toHaveBeenLastCalledWith('contacts', { cursor: 'opaque-upstream-cursor' })
    const add = { teamRef, candidateRefs: [page.items[0]!.candidateRef], requestUid: '1' }
    await expect(f.service.execute('team.app.members.add', { ...add, teamRef: teams[1]!.teamRef })).rejects.toThrow()
    await expect(f.service.execute('team.app.members.add', { ...add, candidateRefs: [...add.candidateRefs, ...add.candidateRefs] })).rejects.toThrow()
    f.changeAccount()
    await expect(f.service.execute('team.app.members.add', { ...add, expectedAccountKey: 'test:90' })).rejects.toThrow()
  })
  it('rechecks permission and joining at submit, and fails closed for malformed membership', async () => {
    let role = 1, members: unknown = { items: [], has_more: false }
    const f = fixture(path => path.endsWith('/list-mine') ? { teams: [{ ...owner, role }] } : members), teamRef = await ref(f)
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '人' }], hasMore: false })
    const page = await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' }) as Page
    const add = { teamRef, candidateRefs: [page.items[0]!.candidateRef], requestUid: '1' }
    role = 3
    await expect(f.service.execute('team.app.members.add', add)).rejects.toThrow('仅团队所有者或管理员')
    await expect(f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' })).rejects.toThrow('仅团队所有者或管理员')
    role = 2; members = { items: [{ user_id: 11 }], has_more: false }
    await expect(f.service.execute('team.app.members.add', add)).rejects.toThrow('已经加入')
    members = { items: [], has_more: true, next_page_cursor: 'loop' }
    await expect(f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' })).rejects.toThrow()
    members = { items: [] }
    await expect(f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' })).rejects.toThrow()
  })
  it('rejects expired candidates, empty selections and oversized batches', async () => {
    const f = fixture(handler), teamRef = await ref(f)
    f.candidates.list.mockResolvedValue({ items: [{ userId: 11, displayName: '人' }], hasMore: false })
    const page = await f.service.execute('team.app.member-candidates', { teamRef, source: 'contacts' }) as Page
    const add = { teamRef, candidateRefs: [page.items[0]!.candidateRef], requestUid: '1' }
    await expect(f.service.execute('team.app.members.add', { ...add, candidateRefs: [] })).rejects.toThrow()
    await expect(f.service.execute('team.app.members.add', { ...add, candidateRefs: Array(51).fill(add.candidateRefs[0]) })).rejects.toThrow()
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 3_600_001)
    try { await expect(f.service.execute('team.app.members.add', add)).rejects.toThrow() } finally { clock.mockRestore() }
  })
})

describe('explicit external private chats', () => {
  const grant = {share_uid:'grant-secret',team_id:7,sharer_user_id:90,peer_user_id:91,chat_session_uid:'original-chat',sharer_name:'成员',peer_name:'客户'}
  const page = {items:[{relation:{rel_uid:'relation-secret',seq:4,display_name_snapshot:'客户',attach_at:1700000000000},record:{status:1,payload:{version:2,text_content:'共享正文',media_display_items:[{file_asset_uid:'asset-private',file_uid:'file-private',file_name:'photo.png',mime_type:'image/png',download_url:'https://userfiles.jotmo.cc/private-signed'}]}}}],has_more:false,next_before_seq:4}
  it('projects sender direction from identity rather than names without granting message mutations', async () => {
    const messages = [90, 91, undefined].map((sender, index) => ({...page.items[0], relation: {...page.items[0]!.relation,
      rel_uid: `message-${index}`, sender_user_id: sender, display_name_snapshot: '同名用户'}}))
    const f = fixture(path => path.endsWith('/page') ? {...page, items: messages} : {items: [grant]})
    const mine = await f.service.execute('team.app.external.mine', {sourceRef: 'private-ref'}) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const result = await f.service.execute('team.app.external.page', {shareRef: mine.items[0]!.ref}) as import('../src/team-external-chat-contract.js').ExternalChatTimeline
    expect(result.items.map(item => item.senderSide)).toEqual(['sharer', 'peer', 'unknown'])
    expect(result.items.every(item => item.isMe === false)).toBe(true)
    for (const item of result.items) {
      expect(item).not.toHaveProperty('senderUserId')
      expect(item).not.toHaveProperty('mutationTarget')
      expect(item).not.toHaveProperty('ref')
    }
  })
  it.each([42, undefined])('returns reauthorized full media size %s for a partial download', async size => {
    const mediaPage = structuredClone(page)
    Object.assign(mediaPage.items[0]!.record.payload.media_display_items[0]!, { size })
    const f = fixture(path => path === '/private-signed'
      ? new Response(new Uint8Array(5), { status: 206, headers: { 'content-length': '5', 'content-range': 'bytes 0-4/42' } })
      : path.endsWith('/page') ? mediaPage : { items: [grant] })
    const mine = await f.service.execute('team.app.external.mine', { sourceRef: 'private-ref' }) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const timeline = await f.service.execute('team.app.external.page', { shareRef: mine.items[0]!.ref }) as import('../src/team-external-chat-contract.js').ExternalChatTimeline
    const result = await f.service.fetchMedia(timeline.items[0]!.contentBlocks![0]!.mediaRef, 'bytes=0-4', new AbortController().signal)
    expect(result).toMatchObject({ size: size ?? 0, fileName: 'photo.png', mimeType: 'image/png' })
    expect(result.response.status).toBe(206)
    expect(f.requests.at(-2)!.body).toEqual({ share_uid: 'grant-secret', before_seq: 5, limit: 1 })
    expect(f.requests.at(-1)!.headers.get('range')).toBe('bytes=0-4')
    await result.response.body?.cancel()
  })
  it('uses only the grant owner, hides raw identifiers and offers no mutation authority', async () => {
    const f=fixture(path=>path.endsWith('/page')?page:{items:[grant],has_more:false})
    const mine=await f.service.execute('team.app.external.mine',{sourceRef:'private-ref'}) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const result=await f.service.execute('team.app.external.page',{shareRef:mine.items[0]!.ref}) as import('../src/team-external-chat-contract.js').ExternalChatTimeline
    expect(result.items[0]).toMatchObject({textContent:'共享正文',senderName:'客户'})
    expect(result.items[0]).not.toHaveProperty('ref')
    expect(result.items[0]).not.toHaveProperty('mutationTarget')
    expect(JSON.stringify(result)).not.toMatch(/grant-secret|relation-secret|original-chat|asset-private|file-private|private-signed/)
    expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/team/external-chats/mine','/api/v1/team/external-chats/page'])
    expect(f.requests[1]!.body).toEqual({share_uid:'grant-secret',before_seq:0,limit:50})
    f.changeAccount()
    await expect(f.service.execute('team.app.external.page',{shareRef:mine.items[0]!.ref})).rejects.toThrow()
    expect(f.requests).toHaveLength(2)
  })
  it('reauthorizes media and stops before storage when sharing is revoked', async () => {
    let revoked=false
    const f=fixture(path=>path.endsWith('/page')?(revoked?new Response(JSON.stringify({code:1001,data:{reason:'external_chat_not_accessible'}}),{headers:{'content-type':'application/json'}}):page):{items:[grant]})
    const mine=await f.service.execute('team.app.external.mine',{sourceRef:'private-ref'}) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const result=await f.service.execute('team.app.external.page',{shareRef:mine.items[0]!.ref}) as import('../src/team-external-chat-contract.js').ExternalChatTimeline
    revoked=true
    await expect(f.service.execute('team.app.external.page',{shareRef:mine.items[0]!.ref})).rejects.toMatchObject({code:'team-external_chat_not_accessible'})
    await expect(f.service.fetchMedia(result.items[0]!.contentBlocks![0]!.mediaRef,undefined,new AbortController().signal)).rejects.toThrow()
    expect(f.requests.at(-1)!.body).toEqual({share_uid:'grant-secret',before_seq:5,limit:1})
    expect(f.fetchImpl.mock.calls.every(([url])=>String(url).startsWith('https://team.test/'))).toBe(true)
  })
  it('identifies a shared team across freshly sealed references and rejects non-private sources', async () => {
    const f=fixture(path=>path.endsWith('/my')?{teams:[{team_id:7,name:'团队',jotmo_id:'team'}]}:{items:[grant]})
    const a=await f.service.execute('team.app.external.mine',{sourceRef:'private-ref'}) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const b=await f.service.execute('team.app.external.mine',{sourceRef:'private-ref'}) as typeof a
    expect(a.items[0]!.teamKey).toBe(b.items[0]!.teamKey)
    expect(a.items[0]!.teamRef).not.toBe(b.items[0]!.teamRef)
    f.contacts.openSourceRef.mockResolvedValue({kind:'group_chat',ownerRef:'group'})
    await expect(f.service.execute('team.app.external.mine',{sourceRef:'group'})).rejects.toThrow()
    expect(f.requests).toHaveLength(2)
  })
  it('reads forwarded snapshot media through the grant and rejects stale versions or replaced assets', async () => {
    const current = structuredClone(page)
    const payload = current.items[0]!.record.payload as Record<string, unknown>
    payload.media_display_items = []
    payload.content_payload = { render_kind: 'forward_records', items: [{
      source_type: 'record', owner_id: 999, owner_name: '快记作者', text: '已发送快照',
      files: [{ file_uid: 'forward-file-secret', file_asset_uid: 'forward-asset-secret',
        name: 'forward.png', mime_type: 'image/png', download_url: 'https://userfiles.jotmo.cc/forward-signed' }],
      call_record_snapshot: { transcript_segments: [{ text: '通话快照', speaker_name: '说话人',
        audio_url: 'https://userfiles.jotmo.cc/call-signed' }] },
    }] }
    const f = fixture(path => path === '/forward-signed' || path === '/call-signed'
      ? new Response('media', { headers: { 'content-type': 'image/png' } })
      : path.endsWith('/page') ? current : { items: [grant] })
    const mine = await f.service.execute('team.app.external.mine', { sourceRef: 'private-ref' }) as import('../src/team-external-chat-contract.js').ExternalChatDirectory
    const result = await f.service.execute('team.app.external.page', { shareRef: mine.items[0]!.ref }) as import('../src/team-external-chat-contract.js').ExternalChatTimeline
    const forwarded = result.items[0]!.forwardRecords!.items[0]!
    expect(forwarded).toMatchObject({ textContent: '已发送快照', senderName: '快记作者' })
    expect(forwarded).not.toHaveProperty('senderUserId')
    expect(JSON.stringify(result)).not.toMatch(/forward-file-secret|forward-asset-secret|forward-signed|call-signed/)
    const ref = forwarded.contentBlocks![0]!.mediaRef
    const fetched = await f.service.fetchMedia(ref, undefined, new AbortController().signal)
    expect(await fetched.response.text()).toBe('media')
    const call = await f.service.fetchMedia(forwarded.segments![0]!.contentBlocks![0]!.mediaRef, undefined, new AbortController().signal)
    expect(await call.response.text()).toBe('media')
    payload.version = 3
    const before = f.fetchImpl.mock.calls.length
    await expect(f.service.fetchMedia(ref, undefined, new AbortController().signal)).rejects.toThrow()
    expect(f.fetchImpl.mock.calls.length).toBe(before + 1)
    payload.version = 2
    const forward = (payload.content_payload as { items: Array<{ files: Array<{ file_uid: string }> }> }).items[0]!
    forward.files[0]!.file_uid = 'replacement-file'
    await expect(f.service.fetchMedia(ref, undefined, new AbortController().signal)).rejects.toThrow()
    expect(f.fetchImpl.mock.calls.length).toBe(before + 2)
  })
})
it('policy is explicit, shared across both views, monotonic, and never clears unread',async()=>{
 let policy={muted:true,policy_version:4,notify_after_seq:10}
 const f=fixture((path,body)=>path.endsWith('/notification-policy/get')||path.endsWith('/notification-policy/set')?policy:{channel,conversation:{...conversation,notification_policy:policy}})
 const c=(await open(f)).conversation!
 expect(c.unread).toBe(1);expect(c.attentionUnread).toBe(0)
 const result=await f.service.execute('team.app.notification-policy.set',{conversationRef:c.ref,muted:true})
 expect(result).toMatchObject({muted:true,policyVersion:4});expect(f.requests.at(-1)!.body).toEqual({conversation_uid:conversation.conversation_uid,side:'external',muted:true})
 policy={muted:false,policy_version:3,notify_after_seq:0}
 expect(await f.service.execute('team.app.notification-policy.get',{conversationRef:c.ref})).toMatchObject({muted:true,policyVersion:4})
 await expect(f.service.execute('team.app.notification-policy.set',{conversationRef:c.ref,muted:'false'})).rejects.toThrow()
 f.changeAccount();await expect(f.service.execute('team.app.notification-policy.get',{conversationRef:c.ref})).rejects.toThrow()
})
it('lost policy response is resolved by owner read and is never replayed as a toggle',async()=>{
 const f=fixture(path=>path.endsWith('/notification-policy/set')?new Response('{}',{status:503}):path.endsWith('/notification-policy/get')?{muted:true,policy_version:1,notify_after_seq:3}:{channel,conversation})
 const c=(await open(f)).conversation!
 expect(await f.service.execute('team.app.notification-policy.set',{conversationRef:c.ref,muted:true})).toEqual({muted:true,policyVersion:1,notifyAfterSeq:3})
 expect(f.requests.filter(r=>r.path.endsWith('/notification-policy/set'))).toHaveLength(1)
},15000)

it('extension Host scopes both refs and seals parent media without signed URLs',async()=>{
 const f=fixture(path=>path.endsWith('/messages/extensions')
   ? {message,items:[],total_count:0,has_more:false,next_seq:0,through_seq:2}
   : {channel,conversation,messages:[{...message,reply:{message_uid:'parent-private',record_version:3,state:'available',text:'原文',title:'附件标题',sender:{nickname:'原作者'},media:message.record.media}}]})
 const ref=(await open(f)).conversation!.ref
 const timeline=await f.service.execute('team.app.timeline',{conversationRef:ref}) as TeamTimeline
 const reply=timeline.messages[0]!.reply!
 expect(reply.media?.[0]?.url).toContain('/custom/api/team/media?ref=')
 expect(JSON.stringify(reply)).not.toContain('private-signed')
 const page=await f.service.execute('team.app.extensions',{conversationRef:ref,messageRef:timeline.messages[0]!.ref,limit:2,afterSeq:0}) as import('../src/team-app-contract.js').TeamExtensionPage
 expect(page.message.key).toBe(timeline.messages[0]!.key)
 expect(f.requests.at(-1)).toMatchObject({path:'/api/v1/team/conversations/messages/extensions',body:{conversation_uid:conversation.conversation_uid,side:'external',message_uid:message.message_uid,limit:2}})
 f.changeAccount()
 await expect(f.service.execute('team.app.extensions',{conversationRef:ref,messageRef:timeline.messages[0]!.ref})).rejects.toThrow()
})

it('keeps Team mention identities inside Host and retains valid spans on edit', async () => {
  const metadata = {schema_version:1,source_checksum:'original',human_mentions:[{user_id:88,display_name_snapshot:'小林',start_index:0,length:3}]}
  const row = {...message, record:{...message.record,text_content:'@小林 hello',content_payload:{payload_kind:1,schema_version:1,text_state:1,mention_metadata:metadata}}}
  const f = fixture(path => path.endsWith('/batch-get') ? {messages:[row]} : {channel,conversation:{...conversation,side:'team'},messages:[row]})
  const conversationRef = (await open(f)).conversation!.ref
  const page = await f.service.execute('team.app.timeline',{conversationRef}) as TeamTimeline
  expect(JSON.stringify(page)).not.toContain('human_mentions')
  expect(JSON.stringify(page)).not.toContain('user_id')
  await f.service.execute('team.app.edit',{messageRef:page.messages[0]!.ref,version:3,content:{text_content:'😀 @小林 hello!',template_kind:1}})
  const write = f.requests.find(r=>r.path.endsWith('/messages/update'))!
  expect((write.body.content as any).content_payload.mention_metadata.human_mentions).toEqual([{user_id:88,display_name_snapshot:'小林',start_index:3,length:3}])
  await expect(f.service.execute('team.app.edit',{messageRef:page.messages[0]!.ref,version:2,content:{text_content:'edited',template_kind:1}})).rejects.toThrow()
})

it('projects only sealed mentions, filters a bounded page by person, and encodes a send without raw IDs', async () => {
 const metadata = {human_mentions:[{user_id:91,display_name_snapshot:'同名',start_index:0,length:3}]}
 const f = fixture((_path,body) => ({channel,conversation:{...conversation,side:'team'},messages:[{...message,actor_user_id:91,record:{...message.record,text_content:'@同名 hello',content_payload:{mention_metadata:metadata}}}],has_more:true,before_seq:5,message_uid:'sent'}))
 const ref=(await open(f)).conversation!.ref
 const page=await f.service.execute('team.app.timeline',{conversationRef:ref}) as TeamTimeline
 const mentions=page.messages[0]!.content!.mentions!
 expect(mentions).toEqual([{personRef:expect.any(String),displayName:'同名',startIndex:0,length:3}])
 expect(JSON.stringify(page)).not.toContain('user_id')
 const before=f.requests.length
 const filtered=await f.service.execute('team.app.timeline',{conversationRef:ref,personRef:mentions[0]!.personRef,personMode:'mentioned',limit:20}) as TeamTimeline
 expect(filtered.messages).toHaveLength(1);expect(filtered.hasMore).toBe(true)
 expect(f.requests.length-before).toBe(1)
 await f.service.execute('team.app.send',{conversationRef:ref,clientUid:'test',content:{text_content:'@同名 hello',template_kind:1,mentions}})
 const body=f.requests.at(-1)!.body.content as Record<string,unknown>
 expect(body.mentions).toBeUndefined()
 expect((body.content_payload as any).mention_metadata.human_mentions[0].user_id).toBe(91)
 await expect(f.service.execute('team.app.send',{conversationRef:ref,content:{text_content:'changed',template_kind:1,mentions}})).rejects.toThrow()
})

it.each([false,true])('recalls one opaque occurrence and reconciles a lost response: %s',async(lost)=>{
 const terminal={...message,own:true,state:'recalled',revision:8,recalled_at:123,can_recall:false}
 const f=fixture(path=>{
  if(path.endsWith('/messages/recall')){if(lost)throw new Error('lost response');return {message:terminal,changed:true}}
  if(path.endsWith('/messages/send-status'))return terminal
  return {channel,conversation,messages:[{...message,own:true,can_recall:true}]}
 })
 const conversationRef=(await open(f)).conversation!.ref
 const page=await f.service.execute('team.app.timeline',{conversationRef}) as TeamTimeline
 const result=await f.service.execute('team.app.recall',{conversationRef,messageRef:page.messages[0]!.ref}) as import('../src/team-message-contract.js').TeamRecallResult
 expect(result.message).toMatchObject({state:'recalled',recalledAt:123,revision:8,canRecall:false,media:[],contentStatus:'recalled'})
 expect(result.message.content).toBeUndefined()
 expect(f.requests.filter(r=>r.path.endsWith('/messages/recall'))[0]!.body).toEqual({conversation_uid:conversation.conversation_uid,side:conversation.side,message_uid:message.message_uid})
 expect(f.requests.some(r=>r.path.endsWith('/delete')||r.path.endsWith('/cancel'))).toBe(false)
})

it('preserves an explicitly classified large visitor across person refs, remarks and actual private-open target',async()=>{
 const peer='9007199254740993';const f=fixture(()=>({channel,conversation:{...conversation,side:'team',external_user_id:peer,visitor:{nickname:'客户',kind:'person',account_state:'active',member_type:'svip'}},messages:[]}))
 const opened=(await open(f)).conversation!
 expect(opened.visitor?.personRef).toBeTruthy()
 await f.service.execute('team.app.person.private.open',{conversationRef:opened.ref,personRef:opened.visitor!.personRef})
 expect(f.privateChat.openPrivateChatFromUser).toHaveBeenCalledWith(peer,expect.objectContaining({expectedViewerUserId:90}))
 await f.service.execute('team.app.people.remarks',{conversationRef:opened.ref,personRefs:[opened.visitor!.personRef]})
 expect(f.contacts.privateRemarksByUserIds).toHaveBeenCalledWith([peer],{})
})

it('recovers an uncertain open from the frozen target after Host recreation without reinterpreting expired source refs',async()=>{
 let fail=true;const f=fixture(path=>path.endsWith('/list-mine')?{teams:[{team_id:17,jotmo_id:'our_team',name:'团队',role:3}]}:fail?new Response(JSON.stringify({code:500,data:{reason:'dependency_unavailable'}})):{conversation:{...conversation,channel:{...channel,team_id:17},side:'team',external_user_id:'123',visitor:{kind:'unknown',member_type:'unknown'}}})
 const teams=await f.service.execute('team.app.teams',{}) as Array<{teamRef:string}>
 const params={teamRef:teams[0]!.teamRef,recipient:{kind:'contact-lookup',contactRef:'expired-after-first-attempt'},requestUid:'frozen-attempt'}
 await expect(f.service.execute('team.app.outbound.open',params)).rejects.toThrow()
 f.outboundTargets.resolve.mockRejectedValue(new Error('source ref expired'));fail=false
 const reopened=new TeamAppService(f.runtime,f.avatars,f.privateChat as never,f.contacts as never,f.candidates,f.outboundTargets)
 expect(await reopened.execute('team.app.outbound.open',params)).toMatchObject({state:'ready',conversation:{side:'team',visitor:{memberType:'unknown'}}})
 expect(f.outboundTargets.resolve).toHaveBeenCalledOnce()
 expect(f.requests.filter(v=>v.path.endsWith('/open-by-member')).map(v=>v.body.external_user_id)).toEqual(['123','123'])
 await expect(reopened.execute('team.app.outbound.open',{...params,recipient:{kind:'contact-lookup',contactRef:'different'}})).rejects.toThrow()
})

it('seals exact capture with account environment conversation and operation binding',async()=>{
 const f=fixture(path=>path.endsWith('/messages/send')?{...message,own:true,actor_user_id:90,side:'external',metadata_saved:true}:({conversation,channel})),destination=(await open(f)).conversation!.ref
 const uid='11111111-1111-4111-8111-111111111111'
 const metadata={record_started_at:1000,send_at:1000,capture_context:{schema_version:1,captured_at:1000,client_name:'private-original',device_state:'recorded',location_state:'permission_denied'}}
 const seal=async()=>await f.service.execute('team.app.snapshot.seal',{conversationRef:destination,operationUid:uid,kind:'send',metadata}) as {metadataRef:string}
 const a=await seal(),b=await seal()
 expect(a.metadataRef).not.toBe(b.metadataRef);expect(a.metadataRef).not.toContain('private-original')
 expect(await f.service.sendMetadataDigest(destination,uid,a.metadataRef,90)).toBe(await f.service.sendMetadataDigest(destination,uid,b.metadataRef,90))
 await expect(f.service.sendMetadataDigest(destination,'22222222-2222-4222-8222-222222222222',a.metadataRef,90)).rejects.toThrow()
 await f.service.execute('team.app.send',{conversationRef:destination,clientUid:uid,content:{text_content:'body',template_kind:1},metadataRef:a.metadataRef})
 expect(f.requests.findLast(r=>r.path.endsWith('/messages/send'))!.body.record_metadata).toEqual(metadata)
 f.changeAccount()
 await expect(f.service.sendMetadataDigest(destination,uid,a.metadataRef,90)).rejects.toThrow()
})
it('keeps unsupported capabilities separate from provider failures',async()=>{
 const old=fixture(()=>new Response('not found',{status:404}))
 await expect(old.service.execute('team.app.snapshot.capabilities',{})).resolves.toEqual({schemaVersion:0})
 const broken=fixture(()=>new Response('unavailable',{status:503}))
 await expect(broken.service.execute('team.app.snapshot.capabilities',{})).rejects.toThrow()
})

it.each([false,true])('requires saved metadata on published send and accepted error, error=%s',async errorEnvelope=>{
 let saved=false
 const f=fixture(path=>{
  if(!path.endsWith('/messages/send'))return {conversation,channel}
  const published={...message,own:true,actor_user_id:90,side:'external',...(saved?{metadata_saved:true}:{})}
  return errorEnvelope?new Response(JSON.stringify({code:1001,data:{reason:'dependency_unavailable',operation:published}}),{headers:{'content-type':'application/json'}}):published
 })
 const conversationRef=(await open(f)).conversation!.ref,operationUid='11111111-1111-4111-8111-111111111111'
 const metadata={record_started_at:1000,send_at:1000,capture_context:{schema_version:1,captured_at:1000,client_name:'private-original',device_state:'recorded',location_state:'permission_denied'}}
 const {metadataRef}=await f.service.execute('team.app.snapshot.seal',{conversationRef,operationUid,kind:'send',metadata}) as {metadataRef:string}
 const command={conversationRef,clientUid:operationUid,metadataRef,content:{template_kind:1,text_content:'frozen'}}
 await expect(f.service.execute('team.app.send',command)).rejects.toMatchObject({code:'team-dependency_unavailable',writeOutcomeUnknown:true})
 saved=true
 await expect(f.service.execute('team.app.send',command)).resolves.toMatchObject({message:{state:'published',metadataSaved:true}})
 const sends=f.requests.filter(v=>v.path.endsWith('/messages/send'))
 expect(sends).toHaveLength(2);expect(sends[0]!.body).toEqual(sends[1]!.body)
})
