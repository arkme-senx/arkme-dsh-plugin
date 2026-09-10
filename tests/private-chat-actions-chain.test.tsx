// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeSdk, type ArkmeSdk } from '../src/sdk/index.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import type { ArkmeSourceItem } from '../src/types.js'

const transport = vi.hoisted(() => ({ sdk: undefined as ArkmeSdk | undefined }))
// Only supply the browser's same-origin transport. No Host or business service is mocked.
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(),
  callArkme: (...args: Parameters<ArkmeSdk['call']>) => transport.sdk!.call(...args),
}))
import { ConversationActionsMenu, privateChatActionItems, usePrivateChatActions } from '../src/client/PrivateChatActions.js'
import { useDirectMessageAdmission } from '../src/client/direct-message-admission.js'
import { chatActionKey, privateChatActions } from '../src/client/private-chat-actions-store.js'

const realFetch = globalThis.fetch.bind(globalThis)
const account = 'test:7'
let service: ArkmeService; let stateDirectory: string; let hostServer: Server; let upstream: Server
let database: ArkmeLocalDatabase
let hostUrl: string; let root: Root; let mount: HTMLDivElement; let trigger: HTMLButtonElement
let source: ArkmeSourceItem; let session: ArkmeSessionCredentials | undefined
let flags: { staff: boolean; eligible: boolean; own: boolean; peer: boolean; revision: number; creation: boolean; banned: boolean; uncertain: boolean }
let beforeMembers: (() => Promise<void>) | undefined
let requests: Array<{ path: string; body: Record<string, unknown>; bearer: string }>
const anchor = createRef<HTMLButtonElement>()
const projection = () => ({ chat_session_uid: 'private-chain', own_refusal_status: flags.own ? 1 : 2,
  counterpart_refusal_status: flags.peer ? 1 : 2, own_revision: flags.revision, counterpart_revision: flags.peer ? 1 : 0,
  refusal_creation_enabled: flags.creation, admission_state: flags.own ? flags.peer ? 4 : 2 : flags.peer ? 3 : 1,
  can_send: !flags.own && !flags.peer })
const banRecord = () => ({ user_id: 42, operator_id: 7, status: flags.banned ? 1 : 2,
  banned_at: 1, unbanned_at: flags.banned ? 0 : 2, updated_at: 3, remark: '' })
const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

function Menu() {
  const admission = useDirectMessageAdmission(account, source, true)
  const actions = usePrivateChatActions(account, 7, source, true, true)
  return <><output data-send-blocked>{String(admission.blocked)}</output>
    <ConversationActionsMenu items={privateChatActionItems(actions, admission, () => {
      void transport.sdk!.relatedRecordings(source.sourceRef).catch(() => undefined)
    })} anchor={anchor} host={mount} onClose={() => undefined} /></>
}
async function ready() {
  await act(async () => { root.render(<Menu />) })
  await act(async () => { await vi.waitFor(() => {
    expect(privateChatActions.identity.get(account).error).toBeUndefined()
    expect(privateChatActions.identity.get(account).value?.profile?.userId).toBe(7)
    expect(privateChatActions.admission.get(chatActionKey({ account, source })).refreshing).toBe(false)
    expect(privateChatActions.eligibility.get(account).value?.allowed).toBe(true)
  }) })
  if (flags.staff) await act(async () => { await vi.waitFor(() => {
    expect(privateChatActions.ban.get(chatActionKey({ account, source })).value).toBeDefined()
  }) })
  expect(mount.textContent).toContain('相关录音')
}
const row = (name: string) => Array.from(mount.querySelectorAll('button')).find(button => button.textContent === name)!
async function click(name: string) {
  await act(async () => { row(name).click() })
  await act(async () => { await vi.waitFor(() => {
    expect(privateChatActions.admission.get(chatActionKey({ account, source })).mutating).toBe(false)
    expect(privateChatActions.ban.get(chatActionKey({ account, source })).mutating).toBe(false)
  }) })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  flags = { staff: true, eligible: true, own: false, peer: false, revision: 0, creation: true, banned: false, uncertain: false }
  requests = []; beforeMembers = undefined
  session = { userId: 7, accessToken: 'fixture-access-7', refreshToken: 'fixture-login-7' }
  upstream = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    const path = request.url!; requests.push({ path, body, bearer: request.headers.authorization ?? '' })
    let data: unknown; let code = 200
    if (path === '/api/v1/auth/get-user-info') data = { user_id: 7, type: flags.staff ? 2 : 1, nick_name: 'Fixture', phone: '13800138000' }
    else if (path === '/api/v1/auth/get-public-users-by-ids') data = { items: [{ user_id: 7, nick_name: 'Fixture', head_img: '' }] }
    else if (path === '/api/v1/auth/able-func') data = { able: flags.eligible }
    else if (path === '/api/v1/chats/members/list') {
      await beforeMembers?.(); data = { items: [{ user_id: 7 }, { user_id: 42 }] }
    } else if (path === '/api/v1/chats/direct-message-admission/query') data = projection()
    else if (path === '/api/v1/chats/direct-message-refusal/set') {
      if ((body.status === 1) === flags.own) { /* Chat's explicit desired-state replay precedes CAS. */ }
      else if (body.expected_revision !== flags.revision) code = 2002
      else if (body.status === 1 && !flags.creation) code = 1004
      else { flags.own = body.status === 1; flags.revision += 1 }
      data = projection()
    } else if (path === '/api/v1/chats/records/related-recordings/page') data = { items: [], has_more: false }
    else if (path.startsWith('/api/v1/user-ban/')) {
      if (!flags.staff) { code = 1001; data = {} }
      else if (path.endsWith('/status')) data = flags.banned ? { exists: true, banned: true, item: banRecord() } : { exists: false, banned: false }
      else {
        flags.banned = path.endsWith('/ban'); data = banRecord()
        if (flags.uncertain) { flags.uncertain = false; code = 1002; data = {} }
      }
    } else { code = 1001; data = {} }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code, data }))
  })
  const base = await listen(upstream)
  stateDirectory = await mkdtemp(join(tmpdir(), 'arkme menu chain '))
  const state = new ArkmeStateStore(stateDirectory)
  database = new ArkmeLocalDatabase(stateDirectory, state)
  const config: ArkmeServiceConfig = { environment: 'test', authBaseUrl: base, chatBaseUrl: base, subjectBaseUrl: base,
    recordBaseUrl: base, botBaseUrl: base, imBaseUrl: base, webrtcBaseUrl: base, worldBaseUrl: base,
    relationBaseUrl: base, intelligentBaseUrl: base, audioBaseUrl: base, routePath: '/arkme-self/api',
    requestTimeoutMs: 1000, maxTextLength: 20_000, geetestCaptchaId: '', interwovenMomentsEnabled: false }
  service = new ArkmeService(config, { read: async () => session, write: async value => { session = value }, delete: async () => { session = undefined } }, database, realFetch)
  const payload = Buffer.from(JSON.stringify({ version: 1, userId: 7, kind: 'private_chat', ownerRef: 'private-chain', displayName: 'Peer' })).toString('base64url')
  const signature = createHmac('sha256', await state.uniqueCode()).update(payload).digest('base64url')
  source = { sourceRef: `arkme-source-v1.${payload}.${signature}`, sourceKey: 'private:42', kind: 'private_chat',
    peerUserId: 42, displayName: 'Peer', activeAtMillis: 0, unreadCount: 0, directMessageAdmissionApplicable: true }
  hostServer = createServer((request, response) => {
    void createArkmeHostApi(service, { expectedPort: Number(new URL(hostUrl).port), allowNonLoopback: false })(request, response)
  })
  hostUrl = await listen(hostServer)
  transport.sdk = createArkmeSdk({ fetchImpl: (url, init) => realFetch(new URL(String(url), hostUrl), {
    ...init, headers: { ...init?.headers, Origin: hostUrl },
  }) })
  mount = document.createElement('div'); trigger = document.createElement('button'); document.body.append(trigger, mount)
  ;(anchor as { current: HTMLButtonElement }).current = trigger; root = createRoot(mount)
  privateChatActions.activateAccount(account)
})
afterEach(async () => {
  act(() => { root.unmount() }); mount.remove(); trigger.remove()
  privateChatActions.activateAccount(undefined); privateChatActions.reset(); localStorage.clear()
  service.dispose(); database.close(); hostServer.closeAllConnections(); upstream.closeAllConnections()
  await Promise.all([new Promise<void>(resolve => hostServer.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))])
  await rm(stateDirectory, { recursive: true, force: true })
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('runs actual UI → SDK HTTP → Host → service → upstream refusal and revocation contracts', async () => {
  await ready(); await click('拒收对方消息')
  expect(flags.own).toBe(true); expect(mount.querySelector('[data-send-blocked]')!.textContent).toBe('true')
  await click('拒收对方消息')
  expect(flags.own).toBe(false); expect(mount.querySelector('[data-send-blocked]')!.textContent).toBe('false')
  expect(requests.filter(item => item.path.endsWith('/direct-message-refusal/set')).map(item => item.body))
    .toEqual([{ chat_session_uid: 'private-chain', status: 1, expected_revision: 0 }, { chat_session_uid: 'private-chain', status: 2, expected_revision: 1 }])
})

it('returns real Host conflict data to the same menu snapshot without replaying the mutation', async () => {
  await ready(); flags.revision = 2; flags.peer = true
  await click('拒收对方消息')
  expect(mount.textContent).toContain('拒收状态已变化')
  expect(row('拒收对方消息').getAttribute('aria-checked')).toBe('false')
  expect(mount.querySelector('[data-send-blocked]')!.textContent).toBe('true')
  expect(requests.filter(item => item.path.endsWith('/direct-message-refusal/set'))).toHaveLength(1)
})

it('keeps ban retry direction across real error envelopes and successful read-back', async () => {
  await ready(); flags.uncertain = true
  await click('封禁用户')
  expect(flags.banned).toBe(true); expect(mount.textContent).toContain('重试封禁用户')
  await click('重试封禁用户'); expect(mount.textContent).toContain('解封用户')
  expect(requests.filter(item => /\/user-ban\/(ban|unban)$/.test(item.path)).map(item => item.path))
    .toEqual(['/api/v1/user-ban/ban', '/api/v1/user-ban/ban'])
  const value = await transport.sdk!.userBanStatus(source.sourceRef)
  expect(JSON.stringify(value)).not.toMatch(/targetUserId|operatorUserId|fixture-access/)
})

it('does not query ban for ordinary users and independently rechecks related-list eligibility', async () => {
  flags.staff = false; await ready()
  expect(mount.textContent).not.toContain('封禁用户')
  expect(requests.some(item => item.path.includes('/user-ban/'))).toBe(false)
  flags.eligible = false
  await expect(transport.sdk!.relatedRecordings(source.sourceRef)).rejects.toMatchObject({ body: { code: 'related-recordings-not-allowed' } })
  expect(requests.some(item => item.path.endsWith('/related-recordings/page'))).toBe(false)
})

it('rejects a forged origin and a cross-account source before a Backend mutation', async () => {
  const result = await realFetch(`${hostUrl}/arkme-self/api`, { method: 'POST', headers: { Origin: 'https://untrusted.test' },
    body: JSON.stringify({ operation: 'user-ban.ban', params: { sourceRef: source.sourceRef } }) })
  expect(result.status).toBe(403)
  session = { userId: 9, accessToken: 'fixture-access-9', refreshToken: 'fixture-login-9' }
  await expect(transport.sdk!.banPrivateChatUser(source.sourceRef)).rejects.toThrow()
  expect(requests).toHaveLength(0)
})

it('does not switch the operator after peer resolution crosses an account transition', async () => {
  beforeMembers = async () => { session = { userId: 9, accessToken: 'fixture-access-9', refreshToken: 'fixture-login-9' } }
  await expect(transport.sdk!.banPrivateChatUser(source.sourceRef)).rejects.toMatchObject({ body: { code: 'login-context-changed' } })
  expect(requests.some(item => item.path.includes('/user-ban/'))).toBe(false)
})
