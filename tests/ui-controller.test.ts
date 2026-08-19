import { describe, expect, it, vi } from 'vitest'
import { ArkmeUiController } from '../src/client/ui-controller.js'

describe('ArkmeUiController', () => {
  it('isolates the recording view from message source selection and login changes', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1',
      kind: 'private_chat' as const,
      displayName: '小林',
      activeAtMillis: 1,
      unreadCount: 0,
    }

    controller.selectSource(source)
    controller.showRecordings()
    expect(controller.getSnapshot()).toEqual({
      open: true,
      surfaceOpen: true,
      authRevision: 0,
      chatRevision: 0,
      mode: 'recordings',
    })

    controller.selectSource(source)
    controller.showArko()
    expect(controller.getSnapshot()).toEqual({
      open: true,
      surfaceOpen: true,
      authRevision: 0,
      chatRevision: 0,
      mode: 'arko',
    })
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'arko', open: true, surfaceOpen: true, authRevision: 1 })

    controller.selectSource(source)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
    controller.showRecordings()
    controller.authChanged(false)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'login' })
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
  })

  it('switches between login and an account-bound source selection', () => {
    const controller = new ArkmeUiController()
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
    expect(controller.getSnapshot()).toEqual({ open: true, surfaceOpen: true, authRevision: 0, chatRevision: 0, mode: 'source' })
    controller.deactivateSurface()
    expect(controller.getSnapshot()).toMatchObject({ open: true, surfaceOpen: false })
    controller.activateSurface()
    expect(controller.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true })
    controller.showLogin()
    expect(controller.getSnapshot()).toEqual({ open: true, surfaceOpen: true, authRevision: 0, chatRevision: 0, mode: 'login' })
    controller.showLoginSurface()
    expect(controller.getSnapshot()).toMatchObject({ open: false, surfaceOpen: true, mode: 'login' })
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ open: true, surfaceOpen: true })
    expect(controller.getSnapshot().authRevision).toBe(1)
    controller.chatChanged()
    expect(controller.getSnapshot().chatRevision).toBe(1)
    expect(listener).toHaveBeenCalledTimes(8)
    unsubscribe()
  })

  it('opens search without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showSearch()

    expect(controller.getSnapshot()).toEqual({
      open: true, surfaceOpen: true, authRevision: 0, chatRevision: 0, mode: 'search',
    })
  })

  it('publishes an updated selected source when its mute state changes', () => {
    const controller = new ArkmeUiController()
    const listener = vi.fn()
    controller.subscribe(listener)
    const source = {
      sourceRef: 'source-1',
      kind: 'group_chat' as const,
      displayName: '项目群',
      activeAtMillis: 1,
      unreadCount: 0,
      isMuted: false,
    }

    controller.selectSource(source)
    controller.selectSource({ ...source, isMuted: true })

    expect(controller.getSnapshot().selectedSource?.isMuted).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
