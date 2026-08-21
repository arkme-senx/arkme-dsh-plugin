import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY } from '../src/client/personal-test-edition.js'
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
  it('opens the profile-local personal test landing before retained Arkme content', () => {
    const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => key === ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY
          ? JSON.stringify({ version: 1, owner: '汤慧玲', defaultSurface: 'calls' })
          : null,
      },
    })
    const registered: Array<{ name: string; inject?: () => unknown }> = []
    const inject = vi.fn((_key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: { name: string; inject?: () => unknown }) => {
      registered.push(options)
      return vi.fn()
    })

    try {
      arkmeUi.showLoginSurface()
      apply({ slots: { inject, register }, effect: vi.fn() } as never)
      const footer = registered.find(item => item.name === 'sidebar.footer.action')!
      const face = footer.inject?.() as { toggle(sessionId: string | undefined, authenticated: boolean): void }

      face.toggle('personal-test-session', true)

      expect(arkmeUi.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true, mode: 'calls' })
    } finally {
      if (previousLocalStorage === undefined) delete (globalThis as { localStorage?: Storage }).localStorage
      else Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
      arkmeUi.close()
    }
  })

  it('keeps the native conversation mounted while the Footer owns a floating Arkme surface', () => {
    const registered: Array<{ name: string; id?: string; inject?: () => unknown }> = []
    const inject = vi.fn((_key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: { name: string; id?: string; inject?: () => unknown }) => {
      registered.push(options)
      return vi.fn()
    })
    apply({
      slots: { inject, register },
      effect: vi.fn(),
    } as never)

    expect(registered.map(item => item.name)).toEqual([
      'sidebar.footer.action',
      'settings.general.item',
      'shell.overlay',
    ])
    const footer = registered.find(item => item.name === 'sidebar.footer.action')!
    const face = footer.inject?.() as {
      toggle(sessionId: string | undefined, authenticated: boolean): void
      activate(sessionId: string | undefined): void
      closeSurface(): void
      surfaceSession(): string | undefined
    }

    face.toggle('session-1', true)
    expect(arkmeUi.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true, mode: 'source' })
    expect(face.surfaceSession()).toBe('session-1')
    face.closeSurface()
    expect(arkmeUi.getSnapshot()).toMatchObject({ open: true, surfaceOpen: false })
    expect(face.surfaceSession()).toBeUndefined()
    face.activate('session-2')
    expect(arkmeUi.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true })
    expect(face.surfaceSession()).toBe('session-2')
    face.toggle('session-2', true)
    expect(arkmeUi.getSnapshot()).toMatchObject({ open: false, surfaceOpen: false })
    face.toggle('session-3', false)
    expect(arkmeUi.getSnapshot()).toMatchObject({ open: false, surfaceOpen: true, mode: 'login' })
    expect(face.surfaceSession()).toBe('session-3')

    expect(registered.map(item => item.name)).not.toContain('conversation')
    expect(registered.map(item => item.name)).not.toContain('sidebar.workspaces.virtual')
    expect(registered.map(item => item.name)).not.toContain('main.surface')
    expect(registered).toContainEqual(expect.objectContaining({
      name: 'shell.overlay',
      id: 'arkme-app-update-dialog',
    }))
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
      apply({ slots: { inject, register }, effect: vi.fn() } as never)
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
