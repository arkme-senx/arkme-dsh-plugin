import { describe, expect, it, vi } from 'vitest'
import { JotmoUiController } from '../src/client/ui-controller.js'

describe('JotmoUiController', () => {
  it('switches between login and an account-bound source selection', () => {
    const controller = new JotmoUiController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const source = {
      sourceRef: 'source-1',
      kind: 'private_chat' as const,
      displayName: '小林',
      activeAtMillis: 1,
      unreadCount: 0,
    }

    controller.selectSource(source)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
    controller.focusSendToSelf()
    expect(controller.getSnapshot()).toEqual({ open: true, surfaceOpen: true, authRevision: 0, mode: 'source' })
    controller.deactivateSurface()
    expect(controller.getSnapshot()).toMatchObject({ open: true, surfaceOpen: false })
    controller.activateSurface()
    expect(controller.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true })
    controller.showLogin()
    expect(controller.getSnapshot()).toEqual({ open: true, surfaceOpen: true, authRevision: 0, mode: 'login' })
    controller.authChanged()
    expect(controller.getSnapshot().authRevision).toBe(1)
    expect(listener).toHaveBeenCalledTimes(6)
    unsubscribe()
  })
})
