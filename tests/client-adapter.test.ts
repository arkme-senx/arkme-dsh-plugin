import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('official DSH client adapter', () => {
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
    expect(registered.map(item => item.name)).not.toContain('shell.overlay')
  })
})
