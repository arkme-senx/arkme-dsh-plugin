import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

const config: ArkmeServiceConfig = { environment: 'test', authBaseUrl: 'https://auth.test', recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test', audioBaseUrl: 'https://audio.test', routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'test' }
const scope = 'test:1001'
const group = (joined = false) => ({ chat_session_uid: 'group-a', title: '产品交流', introduction: '欢迎交流', owner_user_id: 1002, has_joined: joined, join_mode: 1, is_public: true, updated_at: 1 })
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
class Sessions {
  session: ArkmeSessionCredentials = { userId: 1001, accessToken: 'access', refreshToken: 'refresh' }
  async read() { return this.session }; async write(value: ArkmeSessionCredentials) { this.session = value }; async delete() {}
}
function fixture(fetcher: typeof fetch) { const sessions = new Sessions(); return { sessions, service: new ArkmeService(config, sessions, { async uniqueCode() { return 'public-social-test-secret' } } as never, fetcher) } }

describe('public social Host and service integration', () => {
  it('maps public directory and signed-in profile filters without forwarding caller identity', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const { service } = fixture(async (url, init) => { calls.push([new URL(String(url)).pathname, JSON.parse(String(init?.body))]); return ok({ items: [group()], has_more: false }) })
    const page = await dispatchArkmeHostOperation(service, 'social.groups.query', { accountScope: scope, userId: 1002, relation: 'joined', query: '产品' })
    expect(page).toMatchObject({ items: [{ chatSessionUid: 'group-a', hasJoined: false, title: '产品交流' }], hasMore: false })
    expect(calls).toEqual([['/api/v1/chats/discovery/groups/query', { user_id: 1002, relation: 'joined', query: '产品', limit: 30 }]])
    await expect(service.queryPublicGroups({ accountScope: 'test:9999' })).rejects.toMatchObject({ code: 'public-social-account-changed' })
    expect(calls).toHaveLength(1)
  })
  it('joins and opens the existing group source; pending approval never opens a source', async () => {
    let joined = false, pending = false
    const calls: string[] = []
    const { service } = fixture(async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)); calls.push(path)
      if (path.endsWith('/groups/join')) { expect(body.request_uid).toBe('stable-request'); joined = !pending; return ok({ chat_session_uid: 'group-a', status: pending ? 'pending' : 'joined' }) }
      if (path.endsWith('/groups/read')) return ok({ ...group(joined), ...(pending ? { join_mode: 2, join_request: { request_uid: 'stable-request', status: 1 } } : {}) })
      if (path.endsWith('/chats/detail')) return ok({ session: { chat_session_uid: 'group-a', session_kind: 2, title: '产品交流', last_seq: 0 }, current_member: { user_id: 1001, status: 1, role: 3 }, current_policy: {}, unread_snapshot: { unread_count: 0 } })
      throw new Error(path)
    })
    const result = await service.joinPublicGroup('group-a', 'stable-request', scope)
    expect(result).toMatchObject({ status: 'joined', source: { kind: 'group_chat', displayName: '产品交流', sourceRef: expect.any(String) } })
    calls.length = 0
    await expect(service.openPublicGroup('group-a', scope)).resolves.toMatchObject({ kind: 'group_chat' })
    expect(calls).toEqual(['/api/v1/chats/detail'])
    pending = true; calls.length = 0
    const waiting = await service.joinPublicGroup('group-a', 'stable-request', scope)
    expect(waiting.status).toBe('pending'); expect(waiting.source).toBeUndefined(); expect(calls).not.toContain('/api/v1/chats/detail')
  })
  it('opens only a confirmed active private membership and preserves refusal errors', async () => {
    let denied = false, invalidMember = false
    const { service } = fixture(async url => {
      const path = new URL(String(url)).pathname
      if (path.endsWith('/people/chat')) return denied ? new Response(JSON.stringify({ code: 1004, message: '当前无法发起聊天' })) : ok({ chat_session_uid: 'private-a' })
      return ok({ session: { chat_session_uid: 'private-a', session_kind: 1, title: '公开用户', last_seq: 0 }, current_member: { user_id: invalidMember ? 9999 : 1001, status: 1 }, private_counterpart: { user_id: 1002, display_name_snapshot: '公开昵称' }, current_policy: {}, unread_snapshot: { unread_count: 0 } })
    })
    await expect(service.openPublicPerson(1002, scope)).resolves.toMatchObject({ kind: 'private_chat', sourceRef: expect.any(String) })
    invalidMember = true
    await expect(service.openPublicPerson(1002, scope)).rejects.toMatchObject({ code: 'public-social-response-invalid' })
    denied = true
    await expect(service.openPublicPerson(1002, scope)).rejects.toMatchObject({ code: 'arkme-code-1004' })
  })
  it('does not need a profile refresh after successful unlisting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(new URL(String(url)).pathname).toBe('/api/v1/chats/discovery/people/listing/set')
      expect(JSON.parse(String(init?.body))).toEqual({ is_listed: false })
      return ok({ user_id: 1001, is_listed: false, display_name: '昵称', avatar_url: '', introduction: '保留的介绍' })
    })
    const { service } = fixture(fetcher)
    await expect(service.setPublicPerson(scope, false, '未保存的超长草稿'.repeat(100))).resolves.toMatchObject({ isListed: false, introduction: '保留的介绍' })
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(dispatchArkmeHostOperation(service, 'social.people.listing.set', { accountScope: scope })).rejects.toBeDefined()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('discards a late response after account switching', async () => {
    let finish!: (response: Response) => void, started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    const { service, sessions } = fixture(async () => { started(); return await new Promise<Response>(resolve => { finish = resolve }) })
    const read = service.queryPublicGroups({ accountScope: scope }); await began
    sessions.session = { ...sessions.session, userId: 1002 }; finish(ok({ items: [group()], has_more: false }))
    await expect(read).rejects.toMatchObject({ code: 'public-social-account-changed' })
  })
  it('fails closed for undeployed routes and malformed pagination', async () => {
    let unavailable = true
    const { service } = fixture(async () => unavailable ? new Response('not found', { status: 404 }) : ok({ items: [group()], has_more: true }))
    await expect(service.queryPublicGroups({ accountScope: scope })).rejects.toMatchObject({ code: 'public-social-unavailable' })
    unavailable = false
    await expect(service.queryPublicGroups({ accountScope: scope })).rejects.toMatchObject({ code: 'public-social-response-invalid' })
  })
  it('reads owner visibility and member-authorized showcase without guessing on read failure', async () => {
    let owner = false, shown = true, fail = false, isPublic = true
    const calls: Array<[string, Record<string, unknown>]> = []
    const { service } = fixture(async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)); calls.push([path, body])
      if (path.endsWith('/groups/join')) return ok({ chat_session_uid: 'group-a', status: 'joined' })
      if (path.endsWith('/groups/read')) return isPublic ? ok(group(true)) : new Response(JSON.stringify({ code: 2001, message: '群未公开' }))
      if (path.endsWith('/chats/detail')) return ok({ session: { chat_session_uid: 'group-a', session_kind: 2, title: '产品交流', last_seq: 0 }, current_member: { user_id: 1001, status: 1, role: owner ? 1 : 3 }, current_policy: {}, unread_snapshot: { unread_count: 0 } })
      if (path.endsWith('/groups/query')) throw new Error('settings must not scan the public directory')
      if (path.endsWith('/groups/settings/get')) {
        if (fail) throw new Error('展示状态读取失败')
        return ok({ chat_session_uid: 'group-a', is_public: isPublic, introduction: '群介绍', can_manage: owner, is_shown: isPublic && (owner || shown) })
      }
      if (path.endsWith('/groups/settings/set')) { isPublic = body.is_public as boolean; return ok({}) }
      if (path.endsWith('/groups/showcase/set')) { shown = body.is_shown as boolean; return ok({}) }
      throw new Error(path)
    })
    const result = await service.joinPublicGroup('group-a', 'request', scope), ref = result.source!.sourceRef
    await expect(service.publicGroupSettings(ref, scope)).resolves.toMatchObject({ canManage: false, isPublic: true, isShown: true })
    await expect(service.setPublicGroupShowcase(ref, scope, false)).resolves.toMatchObject({ isShown: false })
    fail = true
    await expect(service.publicGroupSettings(ref, scope)).rejects.toThrow('无法连接Arkme 服务')
    fail = false; owner = true
    await expect(service.setPublicGroup(ref, scope, false, '群介绍')).resolves.toMatchObject({ canManage: true, isPublic: false })
    expect(calls).toContainEqual(['/api/v1/chats/discovery/groups/settings/set', { chat_session_uid: 'group-a', is_public: false, introduction: '群介绍' }])
    owner = false
    await expect(service.publicGroupSettings(ref, scope)).resolves.toMatchObject({ canManage: false, isPublic: false, isShown: false })
  })
  it('forwards explicit group privacy and rejects creation under another account', async () => {
    const calls: Record<string, unknown>[] = []
    const { service } = fixture(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls.push(body)
      return ok({ session: { chat_session_uid: body.chat_session_uid, session_kind: 2, title: body.title, last_seq: 0 }, current_policy: {}, unread_snapshot: { unread_count: 0 } })
    })
    await dispatchArkmeHostOperation(service, 'group.create', { accountScope: scope, title: '硬件群', clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', isPublic: false, introduction: '  硬件交流  ' })
    expect(calls[0]).toMatchObject({ is_public: false, introduction: '硬件交流' })
    await expect(dispatchArkmeHostOperation(service, 'group.create', { accountScope: 'test:1002', title: '硬件群', clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b' })).rejects.toMatchObject({ code: 'group-create-account-changed' })
    expect(calls).toHaveLength(1)
  })
})


describe('public social safe consumer references', () => {
 it('binds public people to the account and excludes internal identities from SDK/Tool projections', async () => {
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async () => ok({items:[{user_id:1002,is_listed:true,display_name:'公开昵称',avatar_url:'https://avatar.test/a',introduction:'聊天'}],has_more:false}))
  const {service,sessions}=fixture(fetcher)
  const page=await service.publicSocialRead({operation:'people'})
  expect(page.operation).toBe('people');if(page.operation!=='people')throw new Error('wrong page')
  expect(JSON.stringify(page)).not.toMatch(/user_id|userId|avatar_url|1002|access|refresh/)
  const reference=page.items[0]!.reference
  sessions.session={...sessions.session,userId:1003}
  await expect(service.publicSocialRead({operation:'person',reference})).rejects.toMatchObject({code:'public-social-reference-invalid'})
  expect(fetcher).toHaveBeenCalledOnce()
  await expect(service.publicSocialWrite({operation:'listing',accountScope:'test:1001',enabled:true,introduction:'不得错号写入'})).rejects.toMatchObject({code:'public-social-account-changed'})
  expect(fetcher).toHaveBeenCalledOnce()
 })
 it('reads and resolves account- and group-bound approval references without leaking raw request identities', async () => {
  const calls:string[]=[]
  const {service}=fixture(async(url,init)=>{
    const path=new URL(String(url)).pathname;calls.push(path)
    if(path.endsWith('/groups/join'))return ok({chat_session_uid:'group-a',status:'joined'})
    if(path.endsWith('/groups/read'))return ok(group(true))
    if(path.endsWith('/chats/detail'))return ok({session:{chat_session_uid:'group-a',session_kind:2,title:'群',last_seq:0},current_member:{user_id:1001,status:1,role:1},current_policy:{},unread_snapshot:{unread_count:0}})
    if(path.endsWith('/join/list'))return ok({chat_session_uid:'group-a',items:[{chat_session_uid:'group-a',request_uid:'private-request-identity',requester_user_id:9999,status:1,request_at:100,update_at:100,display_name:'公开昵称'}],has_more:false})
    if(path.endsWith('/join/resolve')){const body=JSON.parse(String(init?.body));expect(body.request_uid).toBe('private-request-identity');return ok({approval:{request_uid:body.request_uid,chat_session_uid:'group-a',status:body.status}})}
    throw new Error(path)
  })
  const ref=(await service.joinPublicGroup('group-a','join',scope)).source!.sourceRef
  const page=await service.publicGroupJoinRequests(ref,scope)
  expect(JSON.stringify(page)).not.toMatch(/private-request-identity|9999|requester_user_id/)
  expect((await service.resolvePublicGroupJoinRequest(ref,scope,page.items[0]!.requestRef,true)).status).toBe(2)
  const count=calls.length
  await expect(service.resolvePublicGroupJoinRequest(ref,'test:1002',page.items[0]!.requestRef,true)).rejects.toMatchObject({code:'public-social-account-changed'})
  expect(calls).toHaveLength(count)
 })
})


it('retains the saved introduction when listing is requested without replacing the draft',async()=>{
 const writes:Record<string,unknown>[]=[]
 const {service}=fixture(async(url,init)=>{
  if(new URL(String(url)).pathname.endsWith('/people/read'))return ok({user_id:1001,is_listed:false,display_name:'昵称',avatar_url:'',introduction:'保存的草稿'})
  const body=JSON.parse(String(init?.body));writes.push(body);return ok({user_id:1001,is_listed:true,display_name:'昵称',avatar_url:'',introduction:body.introduction})
 })
 await expect(service.publicSocialWrite({operation:'listing',accountScope:scope,enabled:true})).resolves.toMatchObject({introduction:'保存的草稿'})
 expect(writes).toEqual([{is_listed:true,introduction:'保存的草稿'}])
})
