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
      authRevision: 0,
      chatRevision: 0,
      mode: 'recordings',
    })

    controller.selectSource(source)
    controller.showCalendar()
    expect(controller.getSnapshot()).toMatchObject({
      authRevision: 0,
      chatRevision: 0,
      mode: 'source',
      selectedSource: source,
      calendarOpen: true,
    })
    controller.hideCalendar()
    expect(controller.getSnapshot().calendarOpen).toBeUndefined()

    controller.showWorld()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0,
      chatRevision: 0,
      mode: 'world',
    })

    controller.selectSource(source)
    controller.showArko()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0,
      chatRevision: 0,
      mode: 'arko',
    })
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'arko', authRevision: 1 })

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
    expect(controller.getSnapshot()).toEqual({ authRevision: 0, chatRevision: 0, mode: 'source' })
    controller.showLogin()
    expect(controller.getSnapshot()).toEqual({ authRevision: 0, chatRevision: 0, mode: 'login' })
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
    expect(controller.getSnapshot().authRevision).toBe(1)
    controller.chatChanged()
    expect(controller.getSnapshot().chatRevision).toBe(1)
    expect(listener).toHaveBeenCalledTimes(5)
    unsubscribe()
  })

  it('opens search without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showSearch()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'search',
    })
  })

  it('opens contact add above the current conversation and restores that conversation when closed', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1', kind: 'private_chat', displayName: '联系人', activeAtMillis: 1, unreadCount: 0,
    } as const
    controller.selectSource(source)
    controller.showContactAdd()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'contact-add',
      selectedSource: source,
    })
    controller.showConversations()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
  })

  it('opens the marketplace page without retaining a conversation or recording target', () => {
    const controller = new ArkmeUiController()
    controller.showRecordingTarget(20260821, 1000)
    controller.showExtensions()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'extensions',
    })
  })

  it('opens one user World homepage and clears the target when returning to the public World', () => {
    const controller = new ArkmeUiController()
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.showUserWorld({
      userId: 7,
      displayName: '  Lucis   测试  ',
      avatarFallback: { kind: 'phone_default', colorIndex: 3, label: 'L' },
    })
    expect(controller.getSnapshot()).toMatchObject({
      mode: 'world',
      worldTarget: {
        userId: 7,
        displayName: 'Lucis 测试',
        avatarFallback: { kind: 'phone_default', colorIndex: 3, label: 'L' },
      },
    })

    controller.showUserWorld({
      userId: 7,
      displayName: 'Lucis 测试',
      avatarFallback: { kind: 'phone_default', colorIndex: 3, label: 'L' },
    })
    expect(listener).toHaveBeenCalledTimes(1)

    controller.showWorld()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'world',
    })
    expect(() => { controller.showUserWorld({ userId: 0, displayName: '无效' }) }).toThrow('世界用户 ID')
  })

  it('clears the previous account selection when authentication changes accounts', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1', kind: 'topic' as const, displayName: '旧账号主题', activeAtMillis: 1, unreadCount: 0,
    }
    controller.selectSource(source)

    controller.authChanged(true, true)

    expect(controller.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
  })

  it('opens the plugin page without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showExtensions()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'extensions',
    })
  })

  it('opens the requested account settings section without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showSettings('about')

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, mode: 'settings', settingsSection: 'about',
    })
  })

  it('returns from a utility page to the retained conversation', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1', kind: 'group_chat' as const, displayName: '产品群', activeAtMillis: 1, unreadCount: 0,
    }
    controller.selectSource(source)
    controller.showRecordings()

    controller.showConversations()

    expect(controller.getSnapshot()).toMatchObject({
      mode: 'source', selectedSource: source,
    })
  })

  it('switches between Arkme conversations and the native DeepSeek Harness mode', () => {
    const controller = new ArkmeUiController()
    controller.showHarness()
    expect(controller.getSnapshot().mode).toBe('harness')
    controller.showConversations()
    expect(controller.getSnapshot().mode).toBe('source')
    controller.showSettings()
    expect(controller.getSnapshot().mode).toBe('settings')
  })

  it('opens and closes the calendar without replacing the page underneath it', () => {
    const controller = new ArkmeUiController()

    controller.showHarness()
    controller.showCalendar()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'harness', calendarOpen: true })
    controller.hideCalendar()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'harness' })
    expect(controller.getSnapshot().calendarOpen).toBeUndefined()

    controller.showSearch()
    controller.showCalendar()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'search', calendarOpen: true })
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
