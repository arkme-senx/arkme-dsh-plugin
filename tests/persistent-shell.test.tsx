import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmePersistentDetails, ArkmePersistentSidebar, ArkmePersistentWorkspace, shouldRestoreWebAuthenticatedWorkspace,
} from '../src/client/ArkmePersistentShell.js'
import { ArkmeWebLoginOverlay } from '../src/client/ArkmeWebLoginOverlay.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

describe('Arkme persistent DSH shell', () => {
  beforeEach(() => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10001 })
  })
  it('restores the Web workspace if authentication completes after the login dialog unmounts', () => {
    const authenticated = { status: 'authenticated' as const, environment: 'prod' as const, userId: 10002 }

    expect(shouldRestoreWebAuthenticatedWorkspace(authenticated, 'login', false)).toBe(true)
    expect(shouldRestoreWebAuthenticatedWorkspace(authenticated, 'harness', false)).toBe(false)
    expect(shouldRestoreWebAuthenticatedWorkspace(authenticated, 'login', true)).toBe(false)
  })

  it('renders an Arkme-owned sidebar rail for the lifetime of the plugin', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmePersistentSidebar {...({
      collapsed: true,
      width: 56,
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      renderSlot: () => null,
      collapseSidebar: vi.fn(),
      closeDetails: vi.fn(),
      openSession: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-sidebar"')
    expect(markup).toContain('data-arkme-sidebar-collapsed="true"')
    expect(markup).toContain('data-arkme-owned="product-navigation"')
    expect(markup).toContain('data-arkme-directory-visible="true"')
    expect(markup).not.toContain('persistent-sidebar-resize-handle-style')
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).not.toContain('与 Arkme 沟通任务')
    expect(markup).not.toContain('aria-label="新任务"')
    expect(markup).not.toContain('DSH Local Build')
    expect(markup).not.toContain('sidebar.footer.action')
  })

  it('renders registered directory entries inside the permanent sidebar directory', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmePersistentSidebar {...({
      collapsed: false,
      width: 72,
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: undefined, ids: [], byId: {} }),
      renderSlot: () => <span data-arkme-test-directory-entry>测试插件</span>,
      collapseSidebar: vi.fn(),
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-test-directory-entry="true"')
    expect(markup).toContain('测试插件')
    expect(markup).toContain('data-arkme-owned="persistent-sidebar-resize-handle-style"')
    expect(markup).toContain('--arkme-persistent-sidebar-width: 148px')
    expect(markup).toContain('left: 148px !important')
    expect(markup).toContain('data-arkme-owned="persistent-sidebar-resize-handle"')
    expect(markup).toContain('aria-valuemin="72"')
    expect(markup).toContain('data-arkme-sidebar-resizing="false"')
    expect(markup).toContain('transition: none !important')
  })

  it('only renders the conversation directory on conversation routes', () => {
    arkmeUi.showSearch()
    const markup = renderToStaticMarkup(<ArkmePersistentSidebar {...({
      collapsed: false,
      width: 72,
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: undefined, ids: [], byId: {} }),
      renderSlot: () => null,
      collapseSidebar: vi.fn(),
      closeDetails: vi.fn(),
      openSession: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-directory-visible="false"')
    expect(markup).not.toContain('aria-label="Arkme 会话列表"')
  })

  it('keeps a constrained Arkme workspace on the Web login screen', () => {
    arkmeUi.showLogin()
    const markup = renderToStaticMarkup(<ArkmePersistentSidebar {...({
      collapsed: false,
      width: 72,
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: undefined, ids: [], byId: {} }),
      renderSlot: () => null,
      collapseSidebar: vi.fn(),
      closeDetails: vi.fn(),
      openSession: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-login-mode="true"')
    expect(markup).toContain('data-arkme-web-locked="true"')
    expect(markup).toContain('data-arkme-workspace="true"')
    expect(markup).toContain('aria-label="Arkme 受限工作区导航"')
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).toContain('登录解锁更多功能')
    expect(markup).toContain('加入 DSH 内测群')
    expect(markup).toContain('联系作者')
    expect(markup).toContain('原生 DeepSeek 开发环境')
    expect(markup).toContain('width:72px')
    expect(markup).toContain('data-arkme-owned="product-navigation"')
    expect(markup).toContain('data-arkme-plugin-version=')
    expect(markup).toContain('对话')
  })

  it('renders Arkme as the permanent conversation owner without its old floating card', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-workspace"')
    expect(markup).toContain('data-arkme-owned="product-surface"')
    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('data-arkme-visible="false"')
    expect(markup).not.toContain('data-arkme-owned="product-navigation"')
    expect(markup).not.toContain('workspace-card')
    expect(markup).not.toContain('position:fixed')
    expect(markup).not.toContain('开始 Arkme 任务')
  })

  it('keeps the Arkme conversation layer mounted and inaccessible below Contacts', () => {
    arkmeUi.showContacts()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-contacts-workspace="true"')
    expect(markup).toContain('data-arkme-owned="arkme-conversation-layer"')
    expect(markup).toContain('visibility:hidden')
    expect(markup).toContain('pointer-events:none')
    expect(markup).toContain('aria-hidden="true"')
    arkmeUi.showConversations()
  })

  it('embeds the core-only native DSH client inside the current conversation region', () => {
    arkmeUi.showHarness()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      renderSlot: () => null,
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-workspace"')
    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('src="/arkme-self/harness-frame?arkme-harness-embed=1"')
    expect(markup).toContain('data-arkme-visible="true"')
    expect(markup).toContain('data-arkme-owned="product-surface"')
    expect(markup).toContain('data-arkme-owned="arkme-conversation-layer"')
    expect(markup).toContain('aria-hidden="true"')
    arkmeUi.showConversations()
  })

  it('keeps a logged-out Web user inside Harness with native settings available', () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-visible="true"')
    expect(markup).toContain('arkme-harness-native-settings=1')
  })

  it('renders the Web login above the entire app while the Harness stays mounted below', () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
    arkmeUi.showHarness()
    arkmeUi.openWebLoginDialog()
    const workspaceMarkup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      closeDetails: vi.fn(),
    } as never)} />)
    const overlayMarkup = renderToStaticMarkup(<ArkmeWebLoginOverlay {...({ t: (key: string) => key } as never)} />)

    expect(overlayMarkup).toContain('data-arkme-web-login-dialog="true"')
    expect(overlayMarkup).toContain('role="dialog"')
    expect(overlayMarkup).toContain('aria-label="Arkme 登录"')
    expect(overlayMarkup).toContain('aria-label="关闭登录"')
    expect(overlayMarkup).toContain('aria-modal="true"')
    expect(overlayMarkup).toContain('position:fixed')
    expect(workspaceMarkup).toContain('data-arkme-visible="true"')
    arkmeUi.closeWebLoginDialog()
  })

  it('claims the details seat with an empty Arkme owner', () => {
    const markup = renderToStaticMarkup(<ArkmePersistentDetails {...({ closeDetails: vi.fn() } as never)} />)
    expect(markup).toContain('data-arkme-owned="persistent-details"')
    expect(markup).not.toContain('conversation.details.tool')
  })
})
