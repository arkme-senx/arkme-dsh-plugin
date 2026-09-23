// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'

const api = vi.hoisted(() => ({ allowed: true as boolean | null }))
vi.mock('../src/client/api.js', () => ({ callArkme: async () => ({ userId: 42, allowed: api.allowed }) }))
vi.mock('../src/client/realtime-client-events.js', () => ({ useArkmeRealtimeClientEvents: () => {} }))
// The native window owns navigation/exit. Keep its editor identity observable
// without running unrelated timeline polling or provider media in this test.
vi.mock('../src/client/ArkmeSidebar.js', () => ({ ArkmeSurface: () => <input aria-label="draft" defaultValue="unsent draft" /> }))
import { ArkmeConversationWindow } from '../src/client/ArkmeConversationWindow.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { socialAccessStore } from '../src/client/social-access-store.js'
import { arkmeSourceIdentityKey } from '../src/client/source-identity.js'

let root: Root | undefined
let source: ArkmeSourceItem
const focusMain = vi.fn(async () => true)
const close = vi.fn(async () => {})
beforeEach(() => {
  api.allowed = true
  socialAccessStore.activate(undefined)
  localStorage.clear()
  focusMain.mockReset().mockResolvedValue(true); close.mockReset().mockResolvedValue()
  source = { sourceRef: 'human', sourceKey: 'chat:human', kind: 'private_chat', displayName: '张三', activeAtMillis: 1, unreadCount: 0 }
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
  vi.stubGlobal('arkmeConversation', {
    version: 1,
    context: async () => ({ accountKey: 'test:42', sourceKey: arkmeSourceIdentityKey(source), source }),
    active: async () => true, focusMain, close,
  })
})
afterEach(() => {
  act(() => root?.unmount()); root = undefined
  socialAccessStore.activate(undefined)
  document.body.replaceChildren()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function mount() {
  const container = document.createElement('div'); document.body.append(container)
  await act(async () => { root = createRoot(container); root.render(<ArkmeConversationWindow />) })
}
async function refresh(allowed: boolean | null) {
  api.allowed = allowed
  await act(async () => { await socialAccessStore.refresh() })
}
it('keeps the same qualified editor and target on refresh failure or unchanged account updates', async () => {
  await mount()
  const editor = document.querySelector('input')!
  expect(editor).not.toBeNull()
  await refresh(null)
  await act(async () => { arkmeUi.authChanged(true) })
  expect(document.querySelector('input')).toBe(editor)
  expect(editor.value).toBe('unsent draft')
  expect(document.title).toBe('张三 · Arkme')
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(source)
  expect(close).not.toHaveBeenCalled(); expect(focusMain).not.toHaveBeenCalled()
})
it('removes denied content, releases the fixed target and returns to main without reopening it', async () => {
  await mount()
  await refresh(false)
  expect(document.querySelector('input')).toBeNull()
  expect(focusMain).toHaveBeenCalledExactlyOnceWith()
  expect(close).toHaveBeenCalledTimes(1)
  await act(async () => { arkmeUi.focusSendToSelf() })
  expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
  await refresh(false)
  expect(close).toHaveBeenCalledTimes(1)
})
it('never mounts a denied chat opened from an old entry', async () => {
  api.allowed = false
  await mount()
  expect(document.querySelector('input')).toBeNull()
  expect(close).toHaveBeenCalledTimes(1)
})
it('keeps personal independent windows available without social access', async () => {
  source = { ...source, kind: 'send_to_self', sourceRef: 'self', sourceKey: 'self:42' }
  api.allowed = false
  await mount()
  expect(document.querySelector('input')).not.toBeNull()
  expect(close).not.toHaveBeenCalled(); expect(focusMain).not.toHaveBeenCalled()
})
it.each(['focus', 'close'] as const)('retains an honest unavailable view if native %s fails', async failure => {
  if (failure === 'focus') focusMain.mockRejectedValue(new Error('native unavailable'))
  else close.mockRejectedValue(new Error('native unavailable'))
  await mount()
  await refresh(false)
  expect(document.querySelector('input')).toBeNull()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('当前会话暂不可用，请返回主窗口')
})
it('does not close a recovered window after a delayed native focus completes', async () => {
  let finish!: (value: boolean) => void
  focusMain.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await refresh(false)
  await refresh(true)
  await act(async () => { finish(true) })
  expect(close).not.toHaveBeenCalled()
  expect(document.querySelector('input')).not.toBeNull()
})
