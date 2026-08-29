import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { createClientLocaleStub } from './client-locale-stub.js'

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

  it('owns Arkme seats and contributes the account section to DSH settings', () => {
    const registered: Array<{
      name: string
      id?: string
      priority?: number
      order?: number
      label?: string
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
      order?: number
      label?: string
      children?: Record<string, unknown>
      inject?: () => unknown
    }) => {
      registered.push(options)
      return vi.fn()
    })
    const toggleSidebar = vi.fn()
    const closeDetails = vi.fn()
    const cleanups: Array<() => void> = []
    const effect = vi.fn((factory: () => unknown, label: string) => {
      if (!label.includes('embedded DeepSeek Harness') && !label.includes('official settings sidebar')) return
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    })
    arkmeUi.showConversations()
    apply({
      slots: { inject, register },
      layout: { toggleSidebar, closeDetails },
      locale: createClientLocaleStub(),
      sessions: { open: vi.fn() },
      effect,
    } as never)

    expect(registered.map(item => item.name)).toEqual([
      'sidebar',
      'conversation',
      'details',
      'settings.section',
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
      expect.objectContaining({
        name: 'shell.overlay',
        id: 'arkme-web-login-overlay',
        order: 100,
      }),
      expect.objectContaining({
        name: 'settings.section',
        id: 'arkme-account',
        order: -1,
        label: '我的账户',
      }),
    ]))
    expect(effect).toHaveBeenCalledWith(
      expect.any(Function),
      'dsh-arkme: render account settings navigation icon',
    )

    const sidebarFace = registered.find(item => item.name === 'sidebar')?.inject?.() as {
      collapseSidebar(): void
      closeDetails(): void
    }
    sidebarFace.collapseSidebar()
    sidebarFace.closeDetails()
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(closeDetails).toHaveBeenCalledOnce()

    expect(registered).not.toContainEqual(expect.objectContaining({ id: 'arkme-app-update-dialog' }))
    expect(registered.map(item => item.name)).not.toContain('sidebar.footer.action')
    expect(registered.map(item => item.name)).not.toContain('sidebar.settings')
    expect(registered.map(item => item.name)).not.toContain('settings.general.item')
    expect(registered.find(item => item.name === 'conversation')?.children).toBeUndefined()
    cleanups.forEach(cleanup => { cleanup() })
  })

  it('tracks the official settings trigger instead of mistaking an unrelated dialog for settings', () => {
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    let tick: (() => void) | undefined
    let triggerExpanded = false
    const trigger = {
      click: vi.fn(() => { triggerExpanded = true }),
      getAttribute: vi.fn((name: string) => name === 'aria-expanded' ? String(triggerExpanded) : null),
    }
    const nativeSidebar = {
      querySelector: vi.fn((selector: string) => selector.includes('sidebar.settings') ? trigger : null),
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setInterval: vi.fn((callback: () => void) => { tick = callback; return 1 }),
        clearInterval: vi.fn(),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelector: vi.fn((selector: string) => {
          if (selector.includes('[role="dialog"]')) return {}
          if (selector === '[data-slot="sidebar"]') return nativeSidebar
          return null
        }),
      },
    })

    const sidebarDisposers: Array<ReturnType<typeof vi.fn>> = []
    const cleanups: Array<() => void> = []
    const register = vi.fn((options: { name: string }) => {
      const dispose = vi.fn()
      if (options.name === 'sidebar') sidebarDisposers.push(dispose)
      return dispose
    })
    try {
      apply({
        slots: {
          inject: vi.fn((_key: string, factory: () => unknown) => factory()),
          register,
        },
        locale: createClientLocaleStub(),
        layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
        effect: vi.fn((factory: () => unknown, label: string) => {
          if (!label.includes('official settings sidebar')) return
          const cleanup = factory()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        }),
      } as never)

      expect(sidebarDisposers).toHaveLength(1)
      arkmeUi.openDshSettings()
      expect(sidebarDisposers[0]).toHaveBeenCalledOnce()
      tick?.()
      expect(trigger.click).toHaveBeenCalledOnce()
      tick?.()
      triggerExpanded = false
      tick?.()
      expect(sidebarDisposers).toHaveLength(2)
    } finally {
      cleanups.forEach(cleanup => { cleanup() })
      if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
      if (previousDocument === undefined) delete (globalThis as { document?: Document }).document
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument })
    }
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
      locale: createClientLocaleStub(),
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
        locale: createClientLocaleStub(),
        effect: vi.fn(),
      } as never)
    } finally {
      restoreWindow()
    }

    expect(registered).toContainEqual(expect.objectContaining({
      name: 'shell.overlay',
      id: 'arkme-startup-auth-gate',
    }))
    expect(registered).not.toContainEqual(expect.objectContaining({
      name: 'shell.overlay',
      id: 'arkme-web-login-overlay',
    }))
  })

  it('starts only the APP update status store from the client lifecycle', () => {
    const effect = vi.fn()

    apply({
      slots: {
        inject: vi.fn(() => () => {}),
        register: vi.fn(),
      },
      locale: createClientLocaleStub(),
      effect,
    } as never)

    const labels = effect.mock.calls.map(call => call[1])
    expect(labels).toContain('dsh-arkme: client app update status')
    expect(labels).not.toContain('dsh-arkme: client plugin update status')
  })
})
