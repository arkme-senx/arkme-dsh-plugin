import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'

describe('official DSH client adapter', () => {
  it('temporarily shadows the official conversation while the Footer owns the directory', () => {
    const registered: Array<{ name: string; id?: string; priority?: number; inject?: () => unknown; dispose: ReturnType<typeof vi.fn> }> = []
    const inject = vi.fn((key: string, register: () => unknown) => {
      register()
      return () => {}
    })
    const register = vi.fn((options: { name: string; id?: string; priority?: number; inject?: () => unknown }) => {
      const dispose = vi.fn()
      registered.push({ ...options, dispose })
      return dispose
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
      toggle(sessionId: string | undefined): void
      activate(sessionId: string | undefined): void
    }
    face.toggle('session-1')
    const conversation = registered.find(item => item.name === 'conversation')!
    expect(conversation.priority).toBe(-10)
    expect(conversation.inject?.()).toMatchObject({ openedFromSession: 'session-1' })
    const surface = conversation.inject?.() as { close(): void }
    surface.close()
    expect(conversation.dispose).toHaveBeenCalledOnce()
    face.activate('session-2')
    expect(registered.filter(item => item.name === 'conversation')).toHaveLength(2)
    const secondConversation = registered.filter(item => item.name === 'conversation')[1]!
    face.toggle('session-2')
    expect(secondConversation.dispose).toHaveBeenCalledOnce()
    expect(registered.map(item => item.name)).not.toContain('sidebar.workspaces.virtual')
    expect(registered.map(item => item.name)).not.toContain('main.surface')
    expect(registered.map(item => item.name)).not.toContain('shell.overlay')
  })
})
