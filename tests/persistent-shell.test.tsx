import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmePersistentDetails, ArkmePersistentSidebar, ArkmePersistentWorkspace,
} from '../src/client/ArkmePersistentShell.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('Arkme persistent DSH shell', () => {
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
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).not.toContain('与 Arkme 沟通任务')
    expect(markup).not.toContain('aria-label="新任务"')
    expect(markup).not.toContain('DSH Local Build')
    expect(markup).not.toContain('sidebar.footer.action')
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

  it('removes all plugin navigation chrome from the login screen', () => {
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
    expect(markup).toContain('width:0')
    expect(markup).not.toContain('data-arkme-owned="product-navigation"')
    expect(markup).not.toContain('aria-label="Arkme 会话列表"')
  })

  it('renders Arkme as the permanent conversation owner without its old floating card', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      renderSlot: () => null,
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-workspace"')
    expect(markup).toContain('data-arkme-owned="product-surface"')
    expect(markup).not.toContain('data-arkme-owned="product-navigation"')
    expect(markup).not.toContain('workspace-card')
    expect(markup).not.toContain('position:fixed')
    expect(markup).not.toContain('开始 Arkme 任务')
  })

  it('embeds the complete native DSH client inside the current conversation region', () => {
    arkmeUi.showHarness()
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      useSessions: (selector: (state: { current?: string; ids: string[]; byId: Record<string, never> }) => unknown) => selector({ current: 'session-1', ids: [], byId: {} }),
      renderSlot: () => null,
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-workspace"')
    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('src="/?arkme-harness-embed=1"')
    expect(markup).not.toContain('data-arkme-owned="product-surface"')
    arkmeUi.showConversations()
  })

  it('claims the details seat with an empty Arkme owner', () => {
    const markup = renderToStaticMarkup(<ArkmePersistentDetails {...({ closeDetails: vi.fn() } as never)} />)
    expect(markup).toContain('data-arkme-owned="persistent-details"')
    expect(markup).not.toContain('conversation.details.tool')
  })
})
