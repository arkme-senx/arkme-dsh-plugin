import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { createClientLocaleStub } from './client-locale-stub.js'

function installDesktopGateMarker(): () => void {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { hostname: 'localhost', search: '' }, arkmeDesktop: Object.freeze({ startupAuthGate: true }) },
  })
  return () => {
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
}

describe('official DSH client adapter', () => {
  it.each([
    ['?arkmeScreenshot=1', false],
    ['?arkmeConversation=1', true],
  ] as const)('scopes the social binding prompt correctly for %s', (search, expected) => {
    const effect = vi.fn()
    vi.stubGlobal('location', { search })
    vi.stubGlobal('window', { location: { search } })
    try {
      apply({ effect, slots: { register: vi.fn() } } as never)
      const prompts = effect.mock.calls.filter(([, label]) => label === 'dsh-arkme: social action binding prompt')
      expect(prompts).toHaveLength(expected ? 1 : 0)
    } finally { vi.unstubAllGlobals() }
  })

  it('leaves settings contributions to the separate embedded Harness owner', () => {
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

    expect(inject).not.toHaveBeenCalled()
    expect(effect).toHaveBeenCalledTimes(1)
    expect(effect.mock.calls[0]?.[1]).toBe('dsh-arkme: modal pointer and close interactions')
    expect(register).not.toHaveBeenCalled()
    expect(registered).toEqual([])
  })

  it('owns resident Arkme seats and delegates product settings to an independent modal', () => {
    const registered: Array<{
      name: string
      id?: string
      priority?: number
      order?: number
      label?: string
      children?: Record<string, unknown>
      inject?: () => unknown
    }> = []
    const inject = vi.fn((key: string, register: () => unknown) => {
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
      if (!label.includes('embedded DeepSeek Harness') && !label.includes('permanent Arkme sidebar')) return
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
      'arkme.topic.actions', 'arkme.send-to-self.entry', 'sidebar',
      'main', 'rightbar', 'shell.overlay', 'shell.overlay',
    ])
    expect(registered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'sidebar',
        priority: -100,
        children: {
          'arkme.directory.entry': { kind: 'list', scope: 'root' },
          'arkme.send-to-self.entry': { kind: 'single', scope: 'root' },
          'arkme.topic.actions': { kind: 'single', scope: 'root' },
        },
      }),
      expect.objectContaining({
        name: 'main',
        key: 'conversation',
        priority: -100,
      }),
      expect.objectContaining({ name: 'rightbar', priority: -100 }),
      expect.objectContaining({
        name: 'shell.overlay',
        id: 'arkme-web-login-overlay',
        order: 100,
      }),
    ]))
    expect(effect).toHaveBeenCalledWith(
      expect.any(Function),
      'dsh-arkme: independent product settings',
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
    expect(registered.map(item => item.name)).not.toContain('settings.section')
    expect(registered.find(item => item.name === 'main')?.children).toBeUndefined()
    cleanups.forEach(cleanup => { cleanup() })
  })

  it('uses the DSH 0.2 rightbar API when the legacy details API is unavailable', () => {
    let sidebarFace: { closeDetails(): void } | undefined
    const registeredNames: string[] = []
    const closeRightbar = vi.fn()
    const register = vi.fn((options: { name: string; inject?: () => unknown }) => {
      registeredNames.push(options.name)
      if (options.name === 'sidebar') sidebarFace = options.inject?.() as typeof sidebarFace
      return vi.fn()
    })
    const inject = vi.fn((key: string, registerEntry: () => unknown) => {
      return registerEntry()
    })
    const effect = vi.fn((factory: () => unknown, label: string) => {
      if (label.includes('permanent Arkme sidebar') || label.includes('embedded DeepSeek Harness')) return factory()
    })

    apply({
      slots: { inject, register },
      layout: { toggleSidebar: vi.fn(), closeRightbar },
      locale: createClientLocaleStub(),
      sessions: { open: vi.fn() },
      effect,
    } as never)

    sidebarFace?.closeDetails()
    expect(closeRightbar).toHaveBeenCalledOnce()
    expect(registeredNames).toContain('main')
  })

  it('retains the sidebar through independent settings without polling native dialogs', async () => {
    vi.useFakeTimers()
    const sidebarDispose = vi.fn()
    const cleanup: Array<() => void> = []
    const register = vi.fn((options: { name: string }) => options.name === 'sidebar' ? sidebarDispose : vi.fn())
    apply({
      slots: { inject: (_key: string, factory: () => unknown) => factory(), register },
      locale: createClientLocaleStub(),
      layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
      effect: (factory: () => unknown, label: string) => {
        if (!label.includes('permanent Arkme sidebar')) return
        const stop = factory()
        if (typeof stop === 'function') cleanup.push(stop)
      },
    } as never)
    try {
      expect(register.mock.calls.filter(([options]) => options.name === 'sidebar')).toHaveLength(1)
      arkmeUi.openDshSettings()
      await Promise.resolve()
      arkmeUi.showConversations()
      await Promise.resolve()
      expect(sidebarDispose).not.toHaveBeenCalled()
      expect(register.mock.calls.filter(([options]) => options.name === 'sidebar')).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      cleanup.forEach(stop => stop())
      vi.useRealTimers()
    }
    expect(sidebarDispose).toHaveBeenCalledOnce()
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
        if (!label.includes('embedded DeepSeek Harness') && !label.includes('permanent Arkme sidebar')) return
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }),
    } as never)

    arkmeUi.showHarness()
    await Promise.resolve()

    expect(disposed).toEqual([])
    expect(register.mock.calls.map(([options]) => (options as { name: string }).name))
      .toEqual(expect.arrayContaining(['sidebar', 'main', 'rightbar']))
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
    expect(labels.filter(label => label === 'dsh-arkme: social action binding prompt')).toHaveLength(1)
    expect(labels).toContain('dsh-arkme: client app update bridge')
    expect(labels).not.toContain('dsh-arkme: client plugin update status')
  })
})
