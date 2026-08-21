import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'

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
  it('permanently replaces the visible sidebar, conversation, and details seats', () => {
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
    apply({
      slots: { inject, register },
      layout: { toggleSidebar, closeDetails },
      effect: vi.fn(),
    } as never)

    expect(registered.map(item => item.name)).toEqual([
      'sidebar',
      'conversation',
      'details',
      'shell.overlay',
    ])
    expect(registered).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'sidebar', priority: -100 }),
      expect.objectContaining({
        name: 'conversation',
        priority: -100,
        children: { 'arkme.directory.entry': { kind: 'list', scope: 'root' } },
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
