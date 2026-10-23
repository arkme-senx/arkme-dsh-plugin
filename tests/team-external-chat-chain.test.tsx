// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import type { ArkmeTeam } from '../src/types.js'
import type { ExternalChatDirectory } from '../src/team-external-chat-contract.js'
const bridge = vi.hoisted(() => ({ call: undefined as undefined | ((op: any, params: any, signal?: AbortSignal) => Promise<unknown>) }))
vi.mock('../src/client/api.js', () => ({ callArkme: (op: any, params: any, signal?: AbortSignal) => bridge.call!(op, params, signal) }))
import { SharePrivateChat, TeamExternalChats } from '../src/client/TeamExternalChats.js'

it.skipIf(!process.env.JOTMO_EXTERNAL_CHAT_FIXTURE)('UI -> SDK -> Host -> authenticated Team -> Chat -> Record', async () => {
  const fixture = JSON.parse(await readFile(process.env.JOTMO_EXTERNAL_CHAT_FIXTURE!, 'utf8'))
  expect(new URL(fixture.url).hostname).toBe('127.0.0.1')
  let actor = 1001
  const credentials = () => ({ userId: actor, accessToken: fixture.tokens[String(actor)], refreshToken: `synthetic-${actor}` })
  const runtime = new ServiceRuntime({environment: 'test', teamBaseUrl: fixture.url, routePath: '/arkme-self/api', requestTimeoutMs: 10000} as ArkmeServiceConfig, {} as never, {uniqueCode: async () => 'isolated-cross-owner-key'} as never, fetch)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => credentials())
  vi.spyOn(runtime, 'accountScopedSession').mockImplementation(async () => credentials())
  const owner = new TeamAppService(runtime, {publicAvatarPresentationsByArkmeIds: async () => new Map()}, undefined,
    {openSourceRef: async () => ({kind: 'private_chat', ownerRef: 'shared-private'}) as never, privateRemarksByUserIds: async () => new Map()})
  const service = { executeTeamApp: owner.execute.bind(owner) }
  const options = {expectedPort: 0, allowNonLoopback: false}
  const server = createServer(createArkmeHostApi(service as never, options))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  options.expectedPort = (server.address() as {port: number}).port
  const origin = `http://127.0.0.1:${options.expectedPort}`
  const sdk = new ArkmeSdk({fetchImpl: (input, init) => fetch(new URL(String(input), origin), {...init, headers: {...init?.headers, Origin: origin}})})
  bridge.call = (op, params, signal) => sdk.call(op, params, signal)
  const container = document.createElement('div'); document.body.append(container)
  let view: Root = createRoot(container)
  const checkbox = () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!
  const text = () => document.body.textContent ?? ''
  const waitFor = async (condition: () => boolean) => {
    for (let i = 0; i < 150; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }); if (condition()) return }
    throw Error(`UI did not settle: ${text()}`)
  }
  const button = (label: string) => [...document.querySelectorAll('button')].find(v => v.textContent === label)!
  try {
    await act(async () => { view.render(<SharePrivateChat sourceRef="synthetic-source" name="外部联系人" onClose={() => {}}/>) })
    await waitFor(() => checkbox() !== null && !checkbox().disabled)
    expect(text()).toContain('完整历史和后续消息')
    await act(async () => { checkbox().click() })
    await waitFor(() => checkbox().checked === true)
    await act(async () => view.unmount())
    view = createRoot(container)
    actor = 3001
    const teams = await sdk.call<ArkmeTeam[]>('team.app.teams', {})
    await act(async () => { view.render(<TeamExternalChats teamRef={teams[0]!.teamRef} teamName="链路团队" onClose={() => {}}/>) })
    await waitFor(() => text().includes('外部联系人'))
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
    expect([...document.querySelectorAll('button')].some(v => v.textContent === '取消共享')).toBe(false)
    await act(async () => { button('外部联系人 ›').click() })
    await waitFor(() => text().includes('长文完整内容终点'))
    expect(text()).toContain('转发快记完整快照')
    await act(async () => { button('查看更早消息').click() })
    await waitFor(() => text().includes('双方已发送正文 1'))
    const granted = await sdk.call<ExternalChatDirectory>('team.app.external.list', {teamRef: teams[0]!.teamRef})
    const viewerRef = granted.items[0]!.ref
    actor = 4001
    await expect(sdk.call('team.app.external.page', {shareRef: viewerRef})).rejects.toThrow()
    actor = 1001
    const mine = await sdk.call<ExternalChatDirectory>('team.app.external.mine', {sourceRef: 'synthetic-source'})
    await sdk.call('team.app.external.unshare', {shareRef: mine.items[0]!.ref})
    actor = 3001
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => text().includes('已不可访问'))
    expect(text()).not.toContain('长文完整内容终点')
    expect(text()).not.toContain('转发快记完整快照')
  } finally {
    await act(async () => view.unmount())
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    container.remove()
    vi.restoreAllMocks()
  }
}, 30000)
