import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmePersistentDetails, ArkmePersistentSidebar, ArkmePersistentWorkspace,
} from '../src/client/ArkmePersistentShell.js'

describe('Arkme persistent DSH shell', () => {
  it('renders an Arkme-owned sidebar rail for the lifetime of the plugin', () => {
    const markup = renderToStaticMarkup(<ArkmePersistentSidebar {...({
      collapsed: true,
      width: 56,
      useSessions: (selector: (state: { current?: string }) => unknown) => selector({ current: 'session-1' }),
      collapseSidebar: vi.fn(),
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-sidebar"')
    expect(markup).toContain('data-arkme-sidebar-collapsed="true"')
    expect(markup).toContain('data-arkme-owned="product-navigation"')
    expect(markup).not.toContain('DSH Local Build')
    expect(markup).not.toContain('sidebar.footer.action')
  })

  it('renders Arkme as the permanent conversation owner without its old floating card', () => {
    const markup = renderToStaticMarkup(<ArkmePersistentWorkspace {...({
      sessionId: 'session-1',
      renderSlot: () => null,
      closeDetails: vi.fn(),
    } as never)} />)

    expect(markup).toContain('data-arkme-owned="persistent-workspace"')
    expect(markup).toContain('data-arkme-owned="product-surface"')
    expect(markup).not.toContain('data-arkme-owned="product-navigation"')
    expect(markup).not.toContain('workspace-card')
    expect(markup).not.toContain('position:fixed')
  })

  it('claims the details seat with an empty Arkme owner', () => {
    const markup = renderToStaticMarkup(<ArkmePersistentDetails {...({ closeDetails: vi.fn() } as never)} />)
    expect(markup).toContain('data-arkme-owned="persistent-details"')
    expect(markup).not.toContain('conversation.details.tool')
  })
})
