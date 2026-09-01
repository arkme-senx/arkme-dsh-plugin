import { describe, expect, it, vi } from 'vitest'
import { ArkmeUiController } from '../src/client/ui-controller.js'

describe('ArkmeUiController', () => {
  it('keeps the view snapshot stable across projection-only invalidations', () => {
    const controller = new ArkmeUiController()
    const initial = controller.getViewSnapshot()

    controller.chatChanged()
    controller.recordChanged()

    expect(controller.getViewSnapshot()).toBe(initial)
    expect(controller.getChatRevision()).toBe(1)
    expect(controller.getRecordRevision()).toBe(1)

    controller.showWorld()
    expect(controller.getViewSnapshot()).not.toBe(initial)
    expect(controller.getViewSnapshot().mode).toBe('world')
  })

  it('publishes directory activity projection changes to the active conversation', () => {
    const controller = new ArkmeUiController()
    const listener = vi.fn()
    controller.subscribe(listener)
    const source = {
      sourceRef: 'source-1', kind: 'group_chat' as const, displayName: '项目群',
      latestPreview: '上一条', activeAtMillis: 1, unreadCount: 0, latestSequence: 8,
    }
    controller.selectSource(source)
    listener.mockClear()

    controller.selectSource({
      ...source,
      latestPreview: '刚发送的消息',
      activeAtMillis: 2,
      latestSequence: 9,
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().selectedSource).toMatchObject({
      latestPreview: '刚发送的消息', activeAtMillis: 2, latestSequence: 9,
    })

    listener.mockClear()
    controller.selectSource({ ...source, displayName: '已重命名的项目群' })
    expect(listener).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().selectedSource?.displayName).toBe('已重命名的项目群')
  })

  it('updates only the matching selected source projection without navigating back', () => {
    const controller = new ArkmeUiController()
    const first = {
      sourceRef: 'group-ref-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const,
      displayName: '项目一群', activeAtMillis: 1, unreadCount: 0,
    }
    const second = {
      sourceRef: 'group-ref-2', sourceKey: 'chat:group-2', kind: 'group_chat' as const,
      displayName: '项目二群', activeAtMillis: 2, unreadCount: 0,
    }
    controller.selectSource(first)

    expect(controller.updateSelectedSourceProjection({ ...first, sourceRef: 'group-ref-1-next', isMuted: true })).toBe(true)
    expect(controller.getSnapshot().selectedSource).toMatchObject({
      sourceKey: first.sourceKey,
      sourceRef: 'group-ref-1-next',
      isMuted: true,
    })
    expect(controller.getChatRevision()).toBe(0)

    controller.selectSource(second)
    expect(controller.updateSelectedSourceProjection({ ...first, displayName: '旧请求完成后的群名' })).toBe(false)
    expect(controller.getSnapshot().selectedSource).toEqual(second)
    expect(controller.getChatRevision()).toBe(0)
  })

  it('clears Contacts mode on every non-Contacts route and authenticated account reset', () => {
    const controller = new ArkmeUiController()

    controller.showContacts()
    controller.showContactAdd()
    expect(controller.getSnapshot().productMode).toBeUndefined()

    controller.showContacts()
    controller.openExtensionShare('extension:share')
    expect(controller.getSnapshot().productMode).toBeUndefined()

    controller.showContacts()
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(controller.getSnapshot().productMode).toBeUndefined()
  })

  it('opens voiceprint management as its own utility surface', () => {
    const controller = new ArkmeUiController()
    controller.authChanged(true)

    controller.showVoiceprint()

    expect(controller.getSnapshot().mode).toBe('voiceprint')
  })
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
      recordRevision: 0,
      mode: 'recordings',
    })

    controller.selectSource(source)
    controller.showCalendar()
    expect(controller.getSnapshot()).toMatchObject({
      authRevision: 0,
      chatRevision: 0,
      recordRevision: 0,
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
      recordRevision: 0,
      mode: 'world',
    })

    controller.selectSource(source)
    controller.showArko()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0,
      chatRevision: 0,
      recordRevision: 0,
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

  it('opens DeepSeek Harness when a newly started client authenticates', () => {
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
    expect(controller.getSnapshot()).toEqual({ authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'source' })
    controller.showLogin()
    expect(controller.getSnapshot()).toEqual({ authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'login' })
    controller.authChanged(true)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'harness' })
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
    expect(controller.getSnapshot().authRevision).toBe(1)
    controller.chatChanged()
    expect(controller.getSnapshot().chatRevision).toBe(1)
    expect(controller.getSnapshot().recordRevision).toBe(0)
    controller.recordChanged()
    expect(controller.getSnapshot().chatRevision).toBe(1)
    expect(controller.getSnapshot().recordRevision).toBe(1)
    expect(listener).toHaveBeenCalledTimes(6)
    unsubscribe()
  })

  it('opens and closes the Web login dialog without replacing the Harness conversation', () => {
    const controller = new ArkmeUiController()
    controller.showHarness()

    controller.openWebLoginDialog()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'harness', webLoginDialogOpen: true })

    controller.closeWebLoginDialog()
    expect(controller.getSnapshot()).toEqual({ authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'harness' })
  })

  it('opens search without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showSearch()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'search',
    })
  })

  it('opens calls without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人', activeAtMillis: 1, unreadCount: 0,
    }
    controller.selectSource(source)

    controller.showCalls()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'calls',
    })
    controller.showConversations()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
  })

  it('opens contact add above the current conversation and restores that conversation when closed', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-1', kind: 'private_chat', displayName: '联系人', activeAtMillis: 1, unreadCount: 0,
    } as const
    controller.selectSource(source)
    controller.showContactAdd()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'contact-add',
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
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'extensions',
    })
  })

  it('opens and consumes an exact conversation message target', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-search', kind: 'group_chat', displayName: '发布会项目群', activeAtMillis: 1, unreadCount: 0,
    } as const

    controller.showConversationTarget(source, 'record-search-1', 123)
    const target = controller.getSnapshot().conversationTarget
    expect(controller.getSnapshot()).toMatchObject({
      mode: 'source', selectedSource: source,
      conversationTarget: { itemUid: 'record-search-1', sendAtMillis: 123 },
    })

    controller.consumeConversationTarget(target?.revision ?? 0)
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
    expect(controller.getSnapshot().conversationTarget).toBeUndefined()
  })

  it('opens the marketplace with an exact author filter and clears it for normal marketplace navigation', () => {
    const controller = new ArkmeUiController()

    controller.showAuthorExtensions(7, '  Lucis   测试  ')

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0,
      chatRevision: 0,
      recordRevision: 0,
      mode: 'extensions',
      extensionAuthorFilter: { ownerUserId: 7, ownerName: 'Lucis 测试' },
    })

    controller.showExtensions()
    expect(controller.getSnapshot()).toEqual({
      authRevision: 0,
      chatRevision: 0,
      recordRevision: 0,
      mode: 'extensions',
    })
    expect(() => { controller.showAuthorExtensions(0, '无效') }).toThrow('插件作者用户 ID')
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
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'world',
    })
    expect(() => { controller.showUserWorld({ userId: 0, displayName: '无效' }) }).toThrow('世界用户 ID')
  })

  it('opens calls without retaining a conversation source', () => {
    const controller = new ArkmeUiController()
    controller.selectSource({
      sourceRef: 'source-1', kind: 'private_chat', displayName: '小林', activeAtMillis: 1, unreadCount: 0,
    })

    controller.showCalls()

    expect(controller.getSnapshot()).toEqual({
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'calls',
    })
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
      authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'extensions',
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

  it('keeps the native DeepSeek Harness as the current-runtime conversation', () => {
    const controller = new ArkmeUiController()
    controller.showHarness()
    expect(controller.getSnapshot().mode).toBe('harness')
    controller.showRecordings()
    controller.showConversations()
    expect(controller.getSnapshot().mode).toBe('harness')
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

  it('commits every notification activation even when the target source is already selected', () => {
    const controller = new ArkmeUiController()
    const listener = vi.fn()
    const source = {
      sourceRef: 'source-notification', sourceKey: 'source-key-notification',
      kind: 'private_chat' as const, displayName: '林溪', activeAtMillis: 1, unreadCount: 1,
    }
    controller.selectSource(source)
    controller.subscribe(listener)

    controller.activateNotificationSource(source)
    const firstRevision = controller.getSnapshot().notificationActivationRevision
    controller.activateNotificationSource(source)

    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
    expect(firstRevision).toBe(1)
    expect(controller.getSnapshot().notificationActivationRevision).toBe(2)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('atomically clears competing overlays when a notification activates a source', () => {
    const controller = new ArkmeUiController()
    const source = {
      sourceRef: 'source-notification', kind: 'group_chat' as const,
      displayName: '项目群', activeAtMillis: 1, unreadCount: 1,
    }
    controller.openExtensionShare('share-ref', 'author-chat')
    controller.openWebLoginDialog()

    controller.activateNotificationSource(source)

    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: source })
    expect(controller.getSnapshot()).not.toHaveProperty('extensionShareRef')
    expect(controller.getSnapshot()).not.toHaveProperty('extensionShareAction')
    expect(controller.getSnapshot()).not.toHaveProperty('webLoginDialogOpen')
    expect(controller.getSnapshot()).not.toHaveProperty('calendarOpen')
    expect(controller.getSnapshot()).not.toHaveProperty('productMode')
  })
})
