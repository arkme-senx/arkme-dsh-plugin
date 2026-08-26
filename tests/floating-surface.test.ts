import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArkmeConversationSurface } from '../src/client/ArkmeConversationSurface.js'
import { ArkmeUiController } from '../src/client/ui-controller.js'
import * as authFlowModule from '../src/client/arkme-auth-flow.js'
import {
  aiPolishStatus, ArkmeTimelineAgentSourceBadge, ArkmeTimelineMessageHeader,
  ArkmeTimelineDetailDrawer,
  arkmeSourceShowsMessageAvatars, arkmeTimelineAvatarRef, arkmeTimelineDetailSenderText, arkmeTimelineSenderName,
  arkmeArkoSurfaceKey, arkmeAuthenticatedAccountChanged, arkmeAuthView,
  arkmeLoginNeedsPhoneBinding, arkmeShouldBeginWechat,
} from '../src/client/ArkmeSidebar.js'
import type { ArkmeSourceItem, ArkmeTimelineItem, ArkmeUserProfile } from '../src/types.js'

describe('Arkme persistent conversation frame', () => {
  it('renders inline without the former floating portal geometry', () => {
    const markup = renderToStaticMarkup(createElement(ArkmeConversationSurface, {
      close: () => {},
      initialAuth: { status: 'authenticated', environment: 'prod', userId: 1 },
      openedFromSession: undefined,
      useSessions: (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' }),
      renderSlot: () => null,
    } as never))
    expect(markup).toContain('data-arkme-owned="persistent-conversation-compat"')
    expect(markup).not.toContain('position:fixed')
    expect(markup).not.toContain('workspace-card')
  })

  it('maps the host auth snapshot directly to login or content', () => {
    expect(arkmeAuthView(undefined)).toBe('login')
    expect(arkmeAuthView({ status: 'authenticated', environment: 'prod', userId: 1 })).toBe('content')
    expect(arkmeAuthView({ status: 'binding-required', environment: 'prod', userId: 1 })).toBe('login')
    expect(arkmeAuthView({ status: 'logged-out', environment: 'prod' })).toBe('login')
    expect(arkmeAuthView({ status: 'expired', environment: 'prod' })).toBe('login')
  })

  it('keeps the floating login surface in the binding view when auth is binding-required', () => {
    expect(arkmeLoginNeedsPhoneBinding({ status: 'binding-required', environment: 'prod', userId: 1 })).toBe(true)
    expect(arkmeLoginNeedsPhoneBinding({ status: 'logged-out', environment: 'prod' })).toBe(false)
  })

  it('treats authenticated user changes as account switches and remounts Arko per account', () => {
    const first = { status: 'authenticated' as const, environment: 'prod' as const, userId: 1001 }
    const second = { status: 'authenticated' as const, environment: 'prod' as const, userId: 2002 }
    const sameUserOtherEnvironment = { status: 'authenticated' as const, environment: 'test' as const, userId: 1001 }

    expect(arkmeAuthenticatedAccountChanged(first, first)).toBe(false)
    expect(arkmeAuthenticatedAccountChanged(first, second)).toBe(true)
    expect(arkmeAuthenticatedAccountChanged(first, sameUserOtherEnvironment)).toBe(true)
    expect(arkmeArkoSurfaceKey(first)).toBe(1001)
    expect(arkmeArkoSurfaceKey(second)).toBe(2002)
    expect(arkmeArkoSurfaceKey({ status: 'logged-out', environment: 'prod' })).toBe('logged-out')
  })

  it('drops the retained source when the same user switches environments', () => {
    const controller = new ArkmeUiController()
    const previous = { status: 'authenticated' as const, environment: 'test' as const, userId: 1001 }
    const next = { status: 'authenticated' as const, environment: 'prod' as const, userId: 1001 }
    controller.selectSource({
      sourceRef: 'test-source', kind: 'private_chat', displayName: '旧环境会话', activeAtMillis: 1, unreadCount: 0,
    })
    controller.showContacts()

    if (arkmeAuthenticatedAccountChanged(previous, next)) controller.authChanged(true, true)
    controller.showConversations()

    expect(controller.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(controller.getSnapshot().productMode).toBeUndefined()
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
  })

  it('does not restart WeChat login while a QR login attempt is pending', () => {
    expect(arkmeShouldBeginWechat({ status: 'logged-out', environment: 'prod' }, 'login', 'wechat', true, '', false)).toBe(true)
    expect(arkmeShouldBeginWechat({ status: 'expired', environment: 'prod' }, 'login', 'wechat', true, '', false)).toBe(true)
    expect(arkmeShouldBeginWechat({
      status: 'pending',
      environment: 'prod',
      attemptId: 'attempt-1',
      qrContent: 'weixin://qr',
      expiresAtMillis: 1,
    }, 'login', 'wechat', true, '', false)).toBe(false)
    expect(arkmeShouldBeginWechat({ status: 'logged-out', environment: 'prod' }, 'login', 'phone', true, '', false)).toBe(false)
  })

  it('does not let the hidden main surface request a QR code when the startup gate owns login', () => {
    expect(arkmeShouldBeginWechat(
      { status: 'logged-out', environment: 'prod' },
      'login',
      'wechat',
      true,
      '',
      false,
      false,
    )).toBe(false)
  })

  it('allows a fresh WeChat QR request after logout or session expiry', () => {
    const transition = Reflect.get(authFlowModule, 'arkmeWechatRequestStartedAfterAuthStatus') as unknown
    expect(transition).toBeTypeOf('function')
    if (typeof transition !== 'function') return

    const requestStartedAfterAuthStatus = transition as (
      current: boolean,
      status: 'logged-out' | 'expired' | 'pending' | 'authenticated' | undefined,
    ) => boolean
    const loggedOutRequestStarted = requestStartedAfterAuthStatus(true, 'logged-out')
    const expiredRequestStarted = requestStartedAfterAuthStatus(true, 'expired')

    expect(loggedOutRequestStarted).toBe(false)
    expect(expiredRequestStarted).toBe(false)
    expect(requestStartedAfterAuthStatus(true, 'pending')).toBe(true)
    expect(requestStartedAfterAuthStatus(true, 'authenticated')).toBe(true)
    expect(arkmeShouldBeginWechat(
      { status: 'logged-out', environment: 'prod' },
      'login',
      'wechat',
      true,
      '',
      loggedOutRequestStarted,
    )).toBe(true)
  })

  it('uses the client-compatible group polish status labels without changing ordinary messages', () => {
    const item = {
      itemUid: 'record-1', senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: '正文', status: 1,
    }
    expect(aiPolishStatus(item)).toBe('')
    expect(aiPolishStatus({ ...item, aiPolish: { state: 'polishing' } })).toBe('AI润色中...')
    expect(aiPolishStatus({ ...item, aiPolish: { state: 'polished' } })).toBe('✨已润色')
    expect(aiPolishStatus({ ...item, aiPolish: { state: 'kept_original' } })).toBe('保持原文')
    expect(aiPolishStatus({ ...item, aiPolish: { state: 'failed' } })).toBe('润色失败 · 重试')
  })

  it('fills an optimistic own message from the current profile without replacing a message avatar already supplied by the timeline', () => {
    const item: ArkmeTimelineItem = {
      itemUid: 'record-1', senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: '正文', status: 1,
    }
    const profile: ArkmeUserProfile = {
      userId: 8706,
      displayName: 'Ye',
      nickname: 'Ye',
      avatarRef: 'profile-avatar-ref',
      arkmeId: 'mbr_sylj',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: true, google: false },
      contact: {},
    }

    expect(arkmeTimelineSenderName(item, profile)).toBe('Ye')
    expect(arkmeTimelineAvatarRef(item, profile)).toBe('profile-avatar-ref')
    expect(arkmeTimelineAvatarRef({ ...item, avatarRef: 'timeline-avatar-ref' }, profile)).toBe('timeline-avatar-ref')
    expect(arkmeTimelineSenderName({ ...item, isMe: false, senderName: '小林' }, profile)).toBe('小林')
  })

  it('shows message avatars in aggregate, default-category, private-topic, and chat timelines', () => {
    const source = (kind: ArkmeSourceItem['kind']): ArkmeSourceItem => ({
      sourceRef: kind,
      kind,
      displayName: kind,
      activeAtMillis: 0,
      unreadCount: 0,
    })

    expect(arkmeSourceShowsMessageAvatars(source('send_to_self'))).toBe(true)
    expect(arkmeSourceShowsMessageAvatars(source('default_category'))).toBe(true)
    expect(arkmeSourceShowsMessageAvatars(source('topic'))).toBe(true)
    expect(arkmeSourceShowsMessageAvatars(source('private_chat'))).toBe(true)
    expect(arkmeSourceShowsMessageAvatars(source('group_chat'))).toBe(true)
    expect(arkmeSourceShowsMessageAvatars(undefined)).toBe(false)
  })

  it('puts time before nickname for own messages and keeps nickname before time for received messages', () => {
    const sendAtMillis = new Date(2026, 7, 21, 16, 38).getTime()
    const ownItem: ArkmeTimelineItem = {
      itemUid: 'record-1', senderName: 'Ye', isMe: true, sendAtMillis,
      title: '', textContent: '正文', status: 1,
    }
    const receivedItem = { ...ownItem, itemUid: 'record-2', senderName: '小林', isMe: false }
    const ownMarkup = renderToStaticMarkup(createElement(ArkmeTimelineMessageHeader, { item: ownItem }))
    const receivedMarkup = renderToStaticMarkup(createElement(ArkmeTimelineMessageHeader, { item: receivedItem }))

    expect(ownMarkup.indexOf('16:38')).toBeLessThan(ownMarkup.indexOf('Ye'))
    expect(receivedMarkup.indexOf('小林')).toBeLessThan(receivedMarkup.indexOf('16:38'))
  })

  it('renders agent-sent messages with a client-compatible source badge', () => {
    const selfItem = {
      itemUid: 'record-1', senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: '正文', status: 1,
    }
    const agentItem = {
      ...selfItem,
      agentSource: { kind: 'agent' as const, displayName: 'Codex', label: 'Codex代发' },
    }
    expect(arkmeTimelineDetailSenderText(agentItem)).toBe('我 · Codex代发')

    const agentSourceHtml = renderToStaticMarkup(createElement(ArkmeTimelineAgentSourceBadge, { item: agentItem }))
    expect(agentSourceHtml).toContain('Codex代发')
    expect(agentSourceHtml).toContain('data-arkme-agent-source="agent"')
    expect(agentSourceHtml).toContain('data-arkme-agent-source-icon="assistant"')
  })

  it('renders timeline detail images with the same rich media content as the message bubble', () => {
    const item: ArkmeTimelineItem = {
      itemUid: 'record-image-1',
      senderName: '我',
      isMe: true,
      sendAtMillis: new Date(2026, 7, 26, 9, 9, 41).getTime(),
      title: '',
      textContent: '这条快记带图片',
      status: 1,
      contentBlocks: [{
        kind: 'image',
        mediaRef: 'image-detail-ref',
        fileName: '截图.png',
        mimeType: 'image/png',
        size: 12,
        sortOrder: 0,
      }],
    }

    const markup = renderToStaticMarkup(createElement(ArkmeTimelineDetailDrawer, {
      item,
      showOriginal: false,
      onClose: () => {},
      onToggleOriginal: () => {},
    }))

    expect(markup).toContain('data-arkme-timeline-detail-rich-content="true"')
    expect(markup).toContain('/arkme-self/api/media?ref=image-detail-ref')
    expect(markup).toContain('预览图片 截图.png')
    expect(markup).toContain('这条快记带图片')
  })

  it.each([3, 4])('keeps the complete voice transcript and polish toggle in the detail drawer (type %s)', (templateKind) => {
    const originalText = '语音原文。'.repeat(120)
    const polishedText = '语音润色。'.repeat(120)
    const item: ArkmeTimelineItem = {
      itemUid: 'record-voice-detail', senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: originalText, status: 1, templateKind,
      aiPolish: { state: 'polished', originalText, polishedText },
      contentBlocks: [{
        kind: 'audio', mediaRef: 'voice-detail-ref', fileName: '语音.m4a',
        mimeType: 'audio/mp4', size: 12, sortOrder: 0, durationSec: 2,
      }],
    }
    for (const showOriginal of [false, true]) {
      const markup = renderToStaticMarkup(createElement(ArkmeTimelineDetailDrawer, {
        item, sourceRef: 'source-detail', showOriginal, onClose: () => {}, onToggleOriginal: () => {},
      }))
      expect(markup).toContain('data-arkme-voice="inline"')
      expect(markup).toContain('/arkme-self/api/media?ref=voice-detail-ref')
      expect(markup).toContain('0:02')
      expect(markup).toContain(showOriginal ? originalText : polishedText)
      expect(markup).not.toContain(showOriginal ? polishedText : originalText)
      expect(markup).toContain(showOriginal ? '显示润色' : '显示原文')
      expect(markup).not.toContain('-webkit-line-clamp')
      expect(markup).not.toContain('正在加载语音')
    }
  })

  it('keeps image preview and attachment order when a detail also contains voice', () => {
    const textContent = '图文混合语音详情。'.repeat(120)
    const item: ArkmeTimelineItem = {
      itemUid: 'record-mixed-detail', senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent, status: 1,
      contentBlocks: [
        { kind: 'image', mediaRef: 'image-mixed-ref', fileName: '截图.png', mimeType: 'image/png', size: 12, sortOrder: 0 },
        { kind: 'audio', mediaRef: 'voice-mixed-ref', fileName: '语音.m4a', mimeType: 'audio/mp4', size: 12, sortOrder: 1, durationSec: 2 },
      ],
    }
    const markup = renderToStaticMarkup(createElement(ArkmeTimelineDetailDrawer, {
      item, showOriginal: false, onClose: () => {}, onToggleOriginal: () => {},
    }))
    expect(markup).toContain('预览图片 截图.png')
    expect(markup).toContain('data-arkme-voice="inline"')
    expect(markup.indexOf('image-mixed-ref')).toBeLessThan(markup.indexOf('voice-mixed-ref'))
    expect(markup).toContain(textContent)
    expect(markup).not.toContain('data-arkme-voice-transcript')
    expect(markup).not.toContain('-webkit-line-clamp')
  })

  it('does not render the non-text fallback label for image-only timeline details', () => {
    const item: ArkmeTimelineItem = {
      itemUid: 'record-image-only',
      senderName: '我',
      isMe: true,
      sendAtMillis: new Date(2026, 7, 26, 10, 38, 58).getTime(),
      title: '',
      textContent: '',
      status: 1,
      contentBlocks: [{
        kind: 'image',
        mediaRef: 'image-only-ref',
        fileName: '纯图片.png',
        mimeType: 'image/png',
        size: 12,
        sortOrder: 0,
      }],
    }

    const markup = renderToStaticMarkup(createElement(ArkmeTimelineDetailDrawer, {
      item,
      showOriginal: false,
      onClose: () => {},
      onToggleOriginal: () => {},
    }))

    expect(markup).toContain('/arkme-self/api/media?ref=image-only-ref')
    expect(markup).toContain('预览图片 纯图片.png')
    expect(markup).not.toContain('非文本内容')
  })
})
