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
  it('shadows only the native settings seat inside the embedded Harness document', () => {
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?arkme-harness-embed=1' } },
    })
    const registered: Array<{ name: string; priority?: number }> = []
    const register = vi.fn((options: { name: string; priority?: number }, component: () => unknown) => {
      registered.push(options)
      expect(component()).toBeNull()
      return vi.fn()
    })
    const inject = vi.fn((_key: string, registerEntry: () => unknown) => registerEntry())
    const effect = vi.fn()

    try {
      apply({ slots: { inject, register }, effect } as never)
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    }

    expect(inject).toHaveBeenCalledOnce()
    expect(inject.mock.calls[0]?.[0]).toBe('sidebar.settings')
    expect(effect).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledOnce()
    expect(registered).toEqual([{ name: 'sidebar.settings', priority: -100 }])
  })

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
        if (!label.includes('embedded DeepSeek Harness') && !label.includes('official settings sidebar')) return
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
        children: {
          'arkme.directory.entry': { kind: 'list', scope: 'root' },
        },
      }),
      expect.objectContaining({
        name: 'conversation',
        priority: -100,
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
    expect(registered.map(item => item.name)).not.toContain('sidebar.settings')
    expect(registered.map(item => item.name)).not.toContain('settings.general.item')
    expect(registered.find(item => item.name === 'conversation')?.children).toBeUndefined()
    cleanups.forEach(cleanup => { cleanup() })
  })

  it('keeps the Arkme shell mounted while DeepSeek Harness is embedded in its conversation seat', async () => {
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
        if (!label.includes('embedded DeepSeek Harness') && !label.includes('official settings sidebar')) return
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }),
    } as never)

    arkmeUi.showHarness()
    await Promise.resolve()

    expect(disposed).toEqual([])
    expect(register.mock.calls.map(([options]) => (options as { name: string }).name))
      .toEqual(expect.arrayContaining(['sidebar', 'conversation', 'details']))
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
