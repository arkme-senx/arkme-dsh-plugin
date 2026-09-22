// @vitest-environment jsdom
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeSourceItem, ArkmePluginOperation } from '../src/types.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
import { ArkmeCommonGroupsPanel } from '../src/client/ArkmeCommonGroupsPanel.js'
import { ConversationActionsMenu, privateChatActionItems, type usePrivateChatActions } from '../src/client/PrivateChatActions.js'
import type { useDirectMessageAdmission } from '../src/client/direct-message-admission.js'

const endpoint = process.env.JOTMO_COMMON_GROUP_E2E_URL
it.skipIf(!endpoint)('walks menu, drawer, durable paging, Chat outage and server reconciliation through the real Host owner', async () => {
  expect(endpoint).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/)
  expect((await fetch(`${endpoint}/fixture/reset`, { method: 'POST' })).ok).toBe(true)
  const path = await mkdtemp(join(tmpdir(), 'common groups UI e2e '))
  const session = { userId: 1001, accessToken: 'common-group-fixture', refreshToken: 'fixture-refresh' }
  const sessions = { async read() { return session }, async write() {}, async delete() {} }
  const config = { environment: 'test', chatBaseUrl: endpoint, authBaseUrl: endpoint, requestTimeoutMs: 10000 } as ArkmeServiceConfig
  let online = true
  // Chat may be down while the account owner still authorizes local social reads.
  // Total account-owner failure is explicitly denied in social-access-boundaries.
  const request: typeof fetch = (...args) => online || String(args[0]).endsWith('/social-access/status')
    ? fetch(...args) : Promise.reject(new Error('offline'))
  const create = () => {
    const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    const runtime = new ServiceRuntime(config, sessions, db, request)
    const source = new SourceService(runtime, new ProfileService(runtime), {} as never)
    const service = new ArkmeService(config, sessions, db, request)
    return { db, source, service, close() { service.dispose(); source.dispose(); runtime.dispose(); db.close() } }
  }
  let local = create()
  const source = { kind: 'private_chat', displayName: '测试联系人', peerUserId: 2002,
    sourceRef: await local.source.sealSourceRef(1001, 'private_chat', 'private', '测试联系人') } as ArkmeSourceItem
  const observers = new Set<{ callback: IntersectionObserverCallback; targets: Set<Element> }>()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class {
    entry: { callback: IntersectionObserverCallback; targets: Set<Element> }
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, targets: new Set() }; observers.add(this.entry) }
    observe(target: Element) { this.entry.targets.add(target) }
    disconnect() { observers.delete(this.entry) }
  })
  let pendingRequests = 0
  api.mockImplementation(async (op: ArkmePluginOperation, params: Record<string, unknown>, signal: AbortSignal) => {
    pendingRequests++
    try { return await dispatchArkmeHostOperation(local.service, op, params, undefined, undefined, undefined, undefined, signal) }
    finally { pendingRequests-- }
  })
  const host = document.createElement('div'); document.body.append(host)
  let root = createRoot(host)
  const anchor = createRef<HTMLButtonElement>()
  const opened = vi.fn()
  function App() {
    const [menu, setMenu] = useState(false), [panel, setPanel] = useState(false)
    const items = privateChatActionItems({ relatedAllowed: false, canManage: false } as ReturnType<typeof usePrivateChatActions>,
      { applicable: false } as ReturnType<typeof useDirectMessageAdmission>, () => {}, undefined, () => setPanel(true))
    return <><ConversationActionsMenu items={items} anchor={anchor} onClose={() => setMenu(false)}
      trigger={{ open: menu, onOpenChange: setMenu }} />
      {panel && <ArkmeCommonGroupsPanel source={source} returnFocusRef={anchor} onClose={() => setPanel(false)} onOpen={opened} />}</>
  }
  const settle = async (check: () => void) => {
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }); check() }, { timeout: 15000 })
  }
  const open = async () => {
    await act(async () => root.render(<App />))
    await act(async () => anchor.current!.click())
    const row = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(row.textContent).toBe('共同群聊')
    await act(async () => row.click())
  }
  const bottom = async () => {
    await act(async () => {
      for (const observer of [...observers]) for (const target of observer.targets) {
        if (target.hasAttribute('data-arkme-common-groups-more')) observer.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      }
    })
  }
  const total = async () => (await local.service.listCommonGroups(source.sourceRef)).totalCached
  try {
    await open()
    await settle(() => expect(host.textContent).toContain('共同群 01'))
    await vi.waitFor(async () => expect(await total()).toBe(41), { timeout: 15000 })
    await settle(() => expect(pendingRequests).toBe(0))
    await settle(() => expect([...observers].some(observer => [...observer.targets].some(target => target.hasAttribute('data-arkme-common-groups-more')))).toBe(true))
    await bottom()
    await settle(() => expect(host.querySelectorAll('[data-arkme-directory-chunk]')).toHaveLength(2))
    await bottom()
    await settle(() => expect(host.querySelectorAll('[data-arkme-directory-chunk]')).toHaveLength(3))
    expect(api.mock.calls.filter(call => call[0] === 'group.common.list' && call[1].cursor)).toHaveLength(2)
    const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!
    await act(async () => close.click())
    expect(document.activeElement).toBe(anchor.current)
    expect(observers.size).toBe(0)
    await act(async () => root.unmount()); local.close(); local = create(); root = createRoot(host)
    online = false
    await open()
    await settle(() => expect(host.querySelector('[role="alert"]')).not.toBeNull())
    expect(host.textContent).toContain('共同群 01')
    expect(await total()).toBe(41)
    online = true
    expect((await fetch(`${endpoint}/fixture/change`, { method: 'POST' })).ok).toBe(true)
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
    await act(async () => retry.click())
    await vi.waitFor(async () => expect(await total()).toBe(40), { timeout: 15000 })
    await settle(() => {
      expect(host.textContent).toContain('改名后的共同群')
      expect(host.textContent).not.toContain('共同群 01')
      expect(host.querySelector('[role="alert"]')).toBeNull()
    })
    const group = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('改名后的共同群'))!
    await act(async () => group.click())
    await settle(() => expect(opened).toHaveBeenCalledOnce())
    expect(opened.mock.calls[0]![0]).toMatchObject({ kind: 'group_chat', displayName: '改名后的共同群' })
    expect(api.mock.calls.map(call => call[0]).filter(op => op === 'group.settings' || op === 'directory.group.open-chat'))
      .toEqual(['group.settings', 'directory.group.open-chat'])
  } finally {
    await act(async () => root.unmount()); host.remove(); local.close(); vi.unstubAllGlobals(); await rm(path, { recursive: true, force: true })
  }
}, 60000)
