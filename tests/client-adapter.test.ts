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
  it('keeps the native conversation mounted while the Footer owns a floating Arkme surface', () => {
    const registered: Array<{ name: string; id?: string; order?: number; label?: string; inject?: () => unknown }> = []
    const inject = vi.fn((_key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: { name: string; id?: string; order?: number; label?: string; inject?: () => unknown }) => {
      registered.push(options)
      return vi.fn()
    })
    apply({
      slots: { inject, register },
      effect: vi.fn(),
    } as never)

    expect(registered.map(item => item.name)).toEqual([
      'sidebar.footer.action',
      'settings.section',
    ])
    expect(registered).toContainEqual(expect.objectContaining({
      name: 'settings.section', id: 'arkme', order: 80, label: 'Arkme',
    }))
    expect(registered).not.toContainEqual(expect.objectContaining({
      name: 'settings.general.item', id: 'arkme-account',
    }))
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
    expect(registered.map(item => item.name)).not.toContain('shell.overlay')
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
})
