import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { arkmeUi } from '../src/client/ui-controller.js'

function installDesktopGateMarker(): () => void {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { arkmeDesktop: Object.freeze({ startupAuthGate: true }) },
  })
  return () => {
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
}

describe('official DSH client adapter', () => {
  it('owns Arkme seats normally without redeclaring the DSH settings slot', () => {
    const registered: Array<{
      name: string
      id?: string
      priority?: number
      children?: Record<string, unknown>
      inject?: () => unknown
    }> = []
    const inject = vi.fn((_key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: {
      name: string
      id?: string
      priority?: number
      children?: Record<string, unknown>
      inject?: () => unknown
    }) => {
      registered.push(options)
      return vi.fn()
    })
    const toggleSidebar = vi.fn()
    const closeDetails = vi.fn()
    const cleanups: Array<() => void> = []
    arkmeUi.showConversations()
    apply({
      slots: { inject, register },
      layout: { toggleSidebar, closeDetails },
      sessions: { open: vi.fn() },
      effect: vi.fn((factory: () => unknown, label: string) => {
        if (!label.includes('native conversation seats') && !label.includes('official settings sidebar')) return
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }),
    } as never)

    expect(registered.map(item => item.name)).toEqual([
      'sidebar',
      'conversation',
      'details',
      'shell.overlay',
    ])
    expect(registered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'sidebar',
        priority: -100,
      }),
      expect.objectContaining({
        name: 'conversation',
        priority: -100,
        children: {
          'arkme.directory.entry': { kind: 'list', scope: 'root' },
        },
      }),
      expect.objectContaining({ name: 'details', priority: -100 }),
    ]))

    const sidebarFace = registered.find(item => item.name === 'sidebar')?.inject?.() as {
      collapseSidebar(): void
      closeDetails(): void
    }
    sidebarFace.collapseSidebar()
    sidebarFace.closeDetails()
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(closeDetails).toHaveBeenCalledOnce()

    expect(registered).toContainEqual(expect.objectContaining({
      name: 'shell.overlay',
      id: 'arkme-app-update-dialog',
    }))
    expect(registered.map(item => item.name)).not.toContain('sidebar.footer.action')
    expect(registered.map(item => item.name)).not.toContain('settings.general.item')
    expect(registered.find(item => item.name === 'sidebar')?.children).toBeUndefined()
    cleanups.forEach(cleanup => { cleanup() })
  })

  it('releases the native conversation and details seats while a DSH task is active', async () => {
    const disposed: string[] = []
    const cleanups: Array<() => void> = []
    const inject = vi.fn((_key: string, register: () => unknown) => register() as () => void)
    const register = vi.fn((options: { name: string }) => () => { disposed.push(options.name) })
    arkmeUi.showConversations()
    apply({
      slots: { inject, register },
      layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
      sessions: { open: vi.fn() },
      effect: vi.fn((factory: () => unknown, label: string) => {
        if (!label.includes('native conversation seats')) return
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }),
    } as never)

    arkmeUi.showTaskSession()
    await Promise.resolve()

    expect(disposed).toEqual(expect.arrayContaining(['conversation', 'details']))
    cleanups.forEach(cleanup => { cleanup() })
    arkmeUi.showConversations()
  })

  it('registers the startup authentication overlay only in the Arkme desktop shell', () => {
    const restoreWindow = installDesktopGateMarker()
    const registered: Array<{ name: string; id?: string }> = []
    const inject = vi.fn((_key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: { name: string; id?: string }) => {
      registered.push(options)
      return vi.fn()
    })

    try {
      apply({
        slots: { inject, register },
        layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
        effect: vi.fn(),
      } as never)
    } finally {
      restoreWindow()
    }

    expect(registered).toContainEqual(expect.objectContaining({
      name: 'shell.overlay',
      id: 'arkme-startup-auth-gate',
    }))
  })

  it('starts independent APP and plugin update status stores from the client lifecycle', () => {
    const effect = vi.fn()

    apply({
      slots: {
        inject: vi.fn(() => () => {}),
        register: vi.fn(),
      },
      effect,
    } as never)

    expect(effect.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([
      'dsh-arkme: client plugin update status',
      'dsh-arkme: client app update status',
    ]))
  })
})
