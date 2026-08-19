import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { calculateArkmeFloatingFrame } from '../src/client/ArkmeConversationSurface.js'
import {
  aiPolishStatus, ArkmeAuthChecking, arkmeAuthView, arkmeLoginNeedsPhoneBinding, arkmeProfileHasBoundPhone,
  arkmeShouldBeginWechat,
} from '../src/client/ArkmeSidebar.js'

describe('Arkme floating conversation frame', () => {
  it('keeps a uniform floating inset inside a wide DSH conversation column', () => {
    expect(calculateArkmeFloatingFrame({ left: 280, top: 0, width: 1232, height: 674 })).toEqual({
      left: 296,
      top: 16,
      width: 1200,
      height: 642,
    })
  })

  it('keeps compact margins when the DSH conversation column is narrow', () => {
    expect(calculateArkmeFloatingFrame({ left: 64, top: 0, width: 640, height: 480 })).toEqual({
      left: 80,
      top: 16,
      width: 608,
      height: 448,
    })
  })

  it('does not treat an unresolved auth check as logged out', () => {
    expect(arkmeAuthView(undefined)).toBe('checking')
    expect(arkmeAuthView({ status: 'authenticated', environment: 'prod', userId: 1 })).toBe('content')
    expect(arkmeAuthView({ status: 'authenticated', environment: 'prod', userId: 1 }, 'checking')).toBe('checking')
    expect(arkmeAuthView({ status: 'authenticated', environment: 'prod', userId: 1 }, 'required')).toBe('login')
    expect(arkmeAuthView({ status: 'binding-required', environment: 'prod', userId: 1 })).toBe('login')
    expect(arkmeAuthView({ status: 'logged-out', environment: 'prod' })).toBe('login')
    expect(arkmeAuthView({ status: 'expired', environment: 'prod' })).toBe('login')
  })

  it('offers an explicit retry after phone binding status validation fails', () => {
    const markup = renderToStaticMarkup(ArkmeAuthChecking({
      error: '网络连接失败', busy: false, onRetry: () => undefined,
    }))

    expect(markup).toContain('网络连接失败')
    expect(markup).toContain('重新检查')
    expect(markup).toContain('type="button"')
  })

  it('treats the remote profile phone projection as the bound-phone signal', () => {
    expect(arkmeProfileHasBoundPhone({
      profile: {
        userId: 1,
        displayName: 'Arkme',
        nickname: 'Arkme',
        avatarRef: '',
        arkmeId: 'arkme',
        accountType: 1,
        createdAt: 1,
        bindings: { apple: false, wechat: true, google: false },
        contact: { phoneMasked: '138****8000' },
      },
      cachedAtMillis: 1,
      revision: 1,
    })).toBe(true)
    expect(arkmeProfileHasBoundPhone({ profile: null, cachedAtMillis: 1, revision: 1 })).toBe(false)
  })

  it('keeps the floating login surface in the binding view when auth is binding-required', () => {
    expect(arkmeLoginNeedsPhoneBinding({ status: 'binding-required', environment: 'prod', userId: 1 }, 'unknown')).toBe(true)
    expect(arkmeLoginNeedsPhoneBinding({ status: 'logged-out', environment: 'prod' }, 'required')).toBe(true)
    expect(arkmeLoginNeedsPhoneBinding({ status: 'logged-out', environment: 'prod' }, 'unknown')).toBe(false)
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
})
