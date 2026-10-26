// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { WorldPublishGuide } from '../src/client/WorldPublishGuide.js'
import { useWorldPublishHost } from '../src/client/WorldPublishHost.js'
import { openWorldPublish, takeWorldPublishTeam } from '../src/client/world-publish-entry.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeTeam } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => mock.call(...args) }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  mock.call.mockReset(); mock.call.mockResolvedValue([])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const click = async (label: string) => act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === label)!.click())
it('teaches sharing from all conversations and opens self without writing or replacing its draft', async () => {
  const navigate = vi.spyOn(arkmeUi, 'focusSendToSelf'), close = vi.fn()
  await act(async () => root.render(<WorldPublishGuide onClose={close}/>))
  expect(document.body.textContent).toContain('发给自己、私聊、群聊、Arko')
  expect(document.querySelector('[role="textbox"]')).toBeNull()
  await click('去记录')
  expect(navigate).toHaveBeenCalledWith(true); expect(close).toHaveBeenCalledOnce(); expect(mock.call).not.toHaveBeenCalled()
})
it('carries the team as a suggestion for confirmation, isolated by account', async () => {
  const team = { teamRef: 'sealed', jotmoId: 'team', name: '团队' } as ArkmeTeam
  await act(async () => root.render(<WorldPublishGuide onClose={() => {}} initialTeam={team}/>))
  await click('去记录')
  expect(takeWorldPublishTeam('test:42')).toEqual(team)
  await click('去记录')
  expect(takeWorldPublishTeam('prod:42')).toBeUndefined()
})
function Host({ account = 'test:42', navigation = 'arko:88' }: { account?: string; navigation?: string }) {
  return useWorldPublishHost({ accountKey: account, navigationKey: navigation, onPublished() {} })
}
it('opens one shared confirmation and clears it on navigation, abort or account mismatch', async () => {
  await act(async () => root.render(<Host/>))
  const origin = { kind: 'local' as const, sourceRef: 'dsh:1', itemUid: 'input', textContent: '本人正文', sourceLabel: 'DSH', sendAtMillis: 1, hasAttachments: false }
  await act(async () => openWorldPublish({ accountKey: 'test:42', origin }))
  expect(document.querySelector('[aria-label="世界内容"]')?.textContent).toBe('本人正文')
  await act(async () => root.render(<Host navigation="group"/>))
  expect(document.querySelector('[aria-label="世界内容"]')).toBeNull()
  expect(() => openWorldPublish({ accountKey: 'test:99', origin })).toThrow('账号已变化')
  const controller = new AbortController()
  await act(async () => openWorldPublish({ accountKey: 'test:42', origin }, controller.signal))
  await act(async () => controller.abort())
  expect(document.querySelector('[aria-label="世界内容"]')).toBeNull()
})
