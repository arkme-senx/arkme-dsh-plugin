import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { writeFile, rm } from 'node:fs/promises'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import type { ArkmeSourceItem } from '../src/types.js'
import type { PublicGroup, PublicGroupPage, PublicGroupJoinResult, PublicGroupSettings, PublicPeoplePage, PublicPerson } from '../src/public-social-contract.js'

const bridge = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async () => ({ ...await vi.importActual('../src/client/api.js'), callArkme: bridge.call }))
import { PublicSocialDirectory } from '../src/client/PublicSocialDirectory.js'
import { PublicPersonListingDialog } from '../src/client/PublicSocialDialogs.js'
import { ArkmeGroupCreateDialog } from '../src/client/ArkmeQuickAdd.js'

const backendUrl = process.env.ARKME_PUBLIC_SOCIAL_E2E_URL
const fixtureDirectory = process.env.ARKME_PUBLIC_SOCIAL_E2E_FIXTURE_DIR
function token(userId: number): string {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ user_id: userId, client_id: userId, exp: Math.floor(Date.now() / 1000) + 600 })}`
  return `${payload}.${createHmac('sha256', 'desktop-social-fixture-access-secret').update(payload).digest('base64url')}`
}

// Opt-in only: real JWT + HTTP handlers + Mongo replica set. Never use a real
// account, remote service, shared database, or fake successful Chat response.
it.skipIf(!backendUrl || !fixtureDirectory)('desktop UI and Host cross real Chat HTTP for admission, showcase, private pairs and withdrawal', async () => {
  const base = new URL(backendUrl!)
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('disposable loopback Chat fixture required')
  const config = { environment: 'test', chatBaseUrl: base.origin, authBaseUrl: base.origin, recordBaseUrl: base.origin, botBaseUrl: base.origin, imBaseUrl: base.origin,
    webrtcBaseUrl: base.origin, worldBaseUrl: base.origin, relationBaseUrl: base.origin, intelligentBaseUrl: base.origin, audioBaseUrl: base.origin,
    routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'fixture' } satisfies ArkmeServiceConfig
  const hosts: Array<{ sdk: ArkmeSdk; service: ArkmeService; close(): Promise<void> }> = []
  const newHost = async (id: number) => {
    const session = { userId: id, accessToken: token(id), refreshToken: 'disposable-fixture' }
    const service = new ArkmeService(config, { read: async () => session, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => `desktop-social-fixture-${id}` } as never)
    const server = createServer(createArkmeHostApi(service, { expectedPort: 0 }))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const sdk = new ArkmeSdk({ fetchImpl: (input, init) => fetch(new URL(String(input), `http://127.0.0.1:${port}`), init) })
    const host = { sdk, service, async close() { service.dispose(); server.closeAllConnections(); server.close(); await once(server, 'close') } }
    hosts.push(host); return host
  }
  const raw = async (id: number, path: string, body: unknown) => {
    const response = await fetch(new URL('/api/v1/chats' + path, base), { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token(id)}` }, body: JSON.stringify(body) })
    const envelope = await response.json()
    expect(envelope.code, JSON.stringify(envelope)).toBe(200)
    return envelope.data
  }
  let renderer: ReactTestRenderer | undefined
  const requests = new Set<Promise<unknown>>()
  let current: ArkmeSdk
  bridge.call.mockImplementation((op, params, signal) => {
    const request = current.call(op, params, signal); requests.add(request)
    void request.then(() => requests.delete(request), () => requests.delete(request))
    return request
  })
  const settle = async () => {
    for (let i = 0; i < 30; i++) {
      await act(async () => { await Promise.allSettled([...requests]); await new Promise(resolve => setTimeout(resolve, 10)) })
      if (requests.size === 0) return
    }
    throw new Error('desktop requests did not settle')
  }
  const mount = async (element: React.ReactElement, sdk: ArkmeSdk) => {
    await act(async () => renderer?.unmount()); current = sdk
    await act(async () => { renderer = create(element) }); await settle()
  }
  const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!
  const click = async (label: string) => { expect(button(label), JSON.stringify(renderer!.toJSON())).toBeDefined(); await act(async () => button(label).props.onClick()); await settle() }
  const proof: string[] = []
  try {
    const owner = await newHost(99101), member = await newHost(99102), applicant = await newHost(99103)
    const activated = vi.fn(), created = vi.fn()
    await mount(<ArkmeGroupCreateDialog accountScope="test:99101" onClose={() => {}} onSourceCreated={created} />, owner.sdk)
    expect(renderer!.root.findAllByType('input').find(n => n.props.type === 'checkbox')!.props.checked).toBe(true)
    await act(async () => renderer!.root.findAllByType('input').find(n => n.props.type !== 'checkbox')!.props.onChange({ target: { value: '桌面真实接口联调群' } }))
    await click('确认')
    expect(created).toHaveBeenCalledOnce()
    const ownerSource = created.mock.calls[0]![0] as ArkmeSourceItem
    const ownSettings = await owner.sdk.call<PublicGroupSettings>('social.groups.settings', { accountScope: 'test:99101', sourceRef: ownerSource.sourceRef })
    expect(ownSettings).toMatchObject({ canManage: true, isPublic: true })
    const uid = ownSettings.chatSessionUid
    proof.push('UI default-public creation persists through real Chat transaction')

    await mount(<PublicSocialDirectory accountScope="test:99102" mode="groups" onSourceActivated={activated} />, member.sdk)
    await click('加入群聊')
    expect(activated).toHaveBeenCalledOnce()
    const memberSource = activated.mock.calls[0]![0] as ArkmeSourceItem
    expect(memberSource.kind).toBe('group_chat')
    const detail = await raw(99102, '/detail', { chat_session_uid: uid })
    expect(detail.current_member).toMatchObject({ user_id: 99102, status: 1 })
    expect(detail.current_cursor.user_id).toBe(99102)
    expect(detail.session.last_seq).toBe(0)
    await click('打开群聊')
    expect(activated).toHaveBeenCalledTimes(2)
    proof.push('public directory -> join -> active membership/cursor -> existing source; no message sent')

    const profile = () => owner.sdk.call<PublicGroupPage>('social.groups.query', { accountScope: 'test:99101', userId: 99102 })
    expect((await profile()).items).toHaveLength(0)
    await member.sdk.call('social.groups.showcase.set', { accountScope: 'test:99102', sourceRef: memberSource.sourceRef, isShown: true })
    expect((await profile()).items.map(item => item.chatSessionUid)).toContain(uid)
    await expect(member.sdk.call('social.groups.settings.set', { accountScope: 'test:99102', sourceRef: memberSource.sourceRef, isPublic: false })).rejects.toMatchObject({ body: { code: 'arkme-code-2001' } })
    proof.push('member showcase requires explicit opt-in; owner visibility cannot be changed by member')

    await raw(99101, '/governance/policy/update', { chat_session_uid: uid, join_mode: 2, able_push_state: 1, status: 1, update_at: Date.now() })
    const approved = vi.fn()
    await mount(<PublicSocialDirectory accountScope="test:99103" mode="groups" onSourceActivated={approved} />, applicant.sdk)
    await click('申请加入')
    expect(button('等待审批').props.disabled).toBe(true); expect(approved).not.toHaveBeenCalled()
    const pending = await applicant.sdk.call<PublicGroup>('social.groups.read', { accountScope: 'test:99103', chatSessionUid: uid })
    expect(pending.hasJoined).toBe(false)
    const requestUid = pending.joinRequest!.requestUid
    const again = await applicant.sdk.call<PublicGroupJoinResult>('social.groups.join', { accountScope: 'test:99103', chatSessionUid: uid, requestUid })
    expect(again.status).toBe('pending')
    await raw(99101, '/governance/join/resolve', { request_uid: requestUid, status: 2, update_at: Date.now() })
    await click('刷新'); await click('进入群聊')
    expect(approved).toHaveBeenCalledOnce()
    await raw(99101, '/members/update', { chat_session_uid: uid, target_user_id: 99103, action: 2 })
    await expect(applicant.sdk.call('social.groups.join', { accountScope: 'test:99103', chatSessionUid: uid, requestUid })).rejects.toBeDefined()
    await expect(applicant.sdk.call('social.groups.open', { accountScope: 'test:99103', chatSessionUid: uid })).rejects.toBeDefined()
    proof.push('pending does not grant membership; original approval joins once; removal prevents approval replay')

    const listed = vi.fn()
    await mount(<PublicPersonListingDialog accountScope="test:99101" onClose={() => {}} onSaved={listed} />, owner.sdk)
    await act(async () => renderer!.root.findByType('textarea').props.onChange({ currentTarget: { value: '公开介绍，想聊桌面产品' } }))
    await click('展示自己')
    expect(listed).toHaveBeenCalledWith(expect.objectContaining({ userId: 99101, isListed: true }))
    await member.sdk.call('social.people.listing.set', { accountScope: 'test:99102', isListed: true, introduction: '欢迎交流硬件' })
    const privateOpened = vi.fn()
    await mount(<PublicSocialDirectory accountScope="test:99102" mode="people" currentUserId={99102} onSourceActivated={privateOpened} />, member.sdk)
    await click('发消息')
    expect(privateOpened).toHaveBeenCalledOnce()
    expect(privateOpened.mock.calls[0]![0]).toMatchObject({ kind: 'private_chat' })
    const forward = await raw(99102, '/discovery/people/chat', { user_id: 99101 })
    const reverse = await raw(99101, '/discovery/people/chat', { user_id: 99102 })
    expect(reverse.chat_session_uid).toBe(forward.chat_session_uid)
    const privateDetail = await raw(99101, '/detail', { chat_session_uid: reverse.chat_session_uid })
    expect(privateDetail.session.last_seq).toBe(0)
    proof.push('public listing -> UI private chat -> canonical pair reused in both directions; no automatic message')

    const ownerPrivate = await owner.sdk.call<ArkmeSourceItem>('social.people.chat', { accountScope: 'test:99101', userId: 99102 })
    await owner.sdk.call('chat.direct-message-refusal.set', { sourceRef: ownerPrivate.sourceRef, refused: true, expectedRevision: 0 })
    await expect(member.sdk.call('social.people.chat', { accountScope: 'test:99102', userId: 99101 })).rejects.toMatchObject({ body: { code: 'arkme-code-1004' } })
    proof.push('existing pair refusal blocks public-directory initiation')

    const removed = vi.fn()
    await mount(<PublicPersonListingDialog accountScope="test:99101" onClose={() => {}} onSaved={removed} />, owner.sdk)
    await writeFile(fixtureDirectory! + '/profiles-unavailable', '')
    try {
      await click('下架我的展示')
      expect(removed).toHaveBeenCalledWith(expect.objectContaining({ isListed: false, introduction: '公开介绍，想聊桌面产品' }))
    } finally { await rm(fixtureDirectory! + '/profiles-unavailable', { force: true }) }
    const people = await member.sdk.call<PublicPeoplePage>('social.people.query', { accountScope: 'test:99102' })
    expect(people.items.some(person => person.userId === 99101)).toBe(false)
    const draft = await owner.sdk.call<PublicPerson>('social.people.read', { accountScope: 'test:99101' })
    expect(draft).toMatchObject({ isListed: false, introduction: '公开介绍，想聊桌面产品' })
    await expect(member.sdk.call('social.people.chat', { accountScope: 'test:99102', userId: 99101 })).rejects.toMatchObject({ body: { code: 'arkme-code-2001' } })
    proof.push('unlisting succeeds during account presentation outage, preserves introduction and stops new directory chats')

    await owner.sdk.call('social.groups.settings.set', { accountScope: 'test:99101', sourceRef: ownerSource.sourceRef, isPublic: false, introduction: '关闭公开' })
    expect((await profile()).items).toHaveLength(0)
    await expect(member.sdk.call('social.groups.open', { accountScope: 'test:99102', chatSessionUid: uid })).resolves.toMatchObject({ kind: 'group_chat' })
    await expect(member.sdk.call('social.groups.query', { accountScope: 'test:99101' })).rejects.toMatchObject({ body: { code: 'public-social-account-changed' } })
    proof.push('closing public visibility removes showcase, retains existing membership; stale account scope rejected')
    if (process.env.ARKME_PUBLIC_SOCIAL_E2E_REPORT) await writeFile(process.env.ARKME_PUBLIC_SOCIAL_E2E_REPORT, JSON.stringify({ backend: base.origin, checks: proof, passed: true }, null, 2))
  } finally {
    await act(async () => renderer?.unmount())
    await Promise.all(hosts.map(host => host.close()))
    bridge.call.mockReset()
  }
}, 60000)
