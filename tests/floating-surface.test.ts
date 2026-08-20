import { describe, expect, it } from 'vitest'
import { calculateArkmeFloatingFrame } from '../src/client/ArkmeConversationSurface.js'
import * as authFlowModule from '../src/client/arkme-auth-flow.js'
import {
  aiPolishStatus, arkmeArkoSurfaceKey, arkmeAuthenticatedAccountChanged, arkmeAuthView,
  arkmeLoginNeedsPhoneBinding, arkmeShouldBeginWechat,
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

    expect(arkmeAuthenticatedAccountChanged(first, first)).toBe(false)
    expect(arkmeAuthenticatedAccountChanged(first, second)).toBe(true)
    expect(arkmeArkoSurfaceKey(first)).toBe(1001)
    expect(arkmeArkoSurfaceKey(second)).toBe(2002)
    expect(arkmeArkoSurfaceKey({ status: 'logged-out', environment: 'prod' })).toBe('logged-out')
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
})
