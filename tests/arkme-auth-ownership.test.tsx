import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeAuthSnapshot } from '../src/types.js'

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  jiwoScanLoginEnabled: false,
  testLoginEnabled: false,
  pending: {
    status: 'pending',
    environment: 'prod',
    attemptId: 'gate-attempt',
    qrContent: 'weixin://gate-qr',
    expiresAtMillis: 1_800_000_000_000,
  } as ArkmeAuthSnapshot,
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: vi.fn(async (method: string) => {
    testState.calls.push(method)
    if (method === 'auth.status') return { status: 'logged-out', environment: 'prod' }
    if (method === 'auth.config') return {
      captchaId: '', testLoginEnabled: testState.testLoginEnabled, jiwoScanLoginEnabled: testState.jiwoScanLoginEnabled,
    }
    if (method === 'auth.begin' || method === 'auth.app.begin') return testState.pending
    if (method === 'auth.app.cancel') return { status: 'logged-out', environment: 'prod' }
    if (method === 'auth.poll' || method === 'auth.app.poll') return testState.pending
    throw new Error(`unexpected method ${method}`)
  }),
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { callArkme } from '../src/client/api.js'
import { ArkmeSettingsSurface } from '../src/client/ArkmeSettingsSurface.js'
import { ArkmeLogin } from '../src/client/ArkmeLogin.js'
import { arkmePendingWechatQrDataUrl, useArkmeAuthFlow } from '../src/client/arkme-auth-flow.js'
import { ArkmeStartupAuthGateView, startupAuthGateScreen } from '../src/client/ArkmeStartupAuthGate.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import {
  arkmeLoginEn, defaultArkmeLoginTranslate, type ArkmeLoginLocaleKey, type ArkmeLoginTranslate,
} from '../src/client/arkme-login-locales.js'

const english = ((key: ArkmeLoginLocaleKey) => arkmeLoginEn[key]) as ArkmeLoginTranslate

function LoginAfterLogout({ t }: { t: ArkmeLoginTranslate }) {
  const flow = useArkmeAuthFlow({}, t)
  return <ArkmeStartupAuthGateView
    screen={startupAuthGateScreen(flow.auth, flow.phoneBindingGate, flow.error)}
    error={flow.error} busy={flow.busy} onRetry={flow.retry} flow={flow} t={t}
  />
}

function BindingDialogFlowProbe({ t }: { t: ArkmeLoginTranslate }) {
  useArkmeAuthFlow({ retainWebLoginDialogOnBindingRequired: true }, t)
  return null
}

describe('Arkme WeChat login ownership', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    testState.calls = []
    testState.jiwoScanLoginEnabled = false
    testState.testLoginEnabled = false
    vi.mocked(callArkme).mockImplementation(async (method: string) => {
      testState.calls.push(method)
      if (method === 'auth.status') return { status: 'logged-out', environment: 'prod' } as never
      if (method === 'auth.config') return {
        captchaId: '', testLoginEnabled: testState.testLoginEnabled, jiwoScanLoginEnabled: testState.jiwoScanLoginEnabled,
      } as never
      if (method === 'auth.begin' || method === 'auth.app.begin') return testState.pending as never
      if (method === 'auth.app.cancel') return { status: 'logged-out', environment: 'prod' } as never
      if (method === 'auth.poll' || method === 'auth.app.poll') return testState.pending as never
      throw new Error(`unexpected method ${method}`)
    })
    arkmeAuthStore.setAuth(testState.pending)
    arkmeUi.showLogin()
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.useRealTimers()
  })

  it('keeps the login UI when the startup auth snapshot is logged out', async () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })

    await act(async () => {
      renderer = create(<ArkmeSurface ownsQrLogin />)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(arkmeUi.getSnapshot().mode).toBe('login')
    expect(renderer!.root.findAllByType(ArkmeLogin)).toHaveLength(1)
  })

  it('restores the active WeChat QR from a pending shared login attempt', () => {
    const restored = arkmePendingWechatQrDataUrl({
      status: 'pending', environment: 'prod', attemptId: 'resume-attempt', qrContent: 'weixin://resume-qr',
    })

    expect(restored.startsWith('data:image/gif;base64,')).toBe(true)
    expect(arkmePendingWechatQrDataUrl({ status: 'logged-out', environment: 'prod' })).toBe('')
  })

  it('keeps the Web dialog open when a newly signed-in account requires phone binding', async () => {
    const bindingRequired: ArkmeAuthSnapshot = { status: 'binding-required', environment: 'prod', userId: 10003 }
    vi.mocked(callArkme).mockImplementation(async method => {
      if (method === 'auth.status') return bindingRequired as never
      if (method === 'auth.config') return { captchaId: '', testLoginEnabled: false, jiwoScanLoginEnabled: false } as never
      throw new Error(`unexpected method ${method}`)
    })
    arkmeAuthStore.setAuth(bindingRequired)
    arkmeUi.showLogin()
    arkmeUi.openWebLoginDialog()

    await act(async () => {
      renderer = create(<BindingDialogFlowProbe t={defaultArkmeLoginTranslate} />)
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().mode).toBe('login')
    expect(arkmeUi.getSnapshot().webLoginDialogOpen).toBe(true)
  })

  it.each([
    ['Jiwo', true, 'auth.app.poll'],
    ['WeChat', false, 'auth.poll'],
  ] as const)('does not poll the startup gate %s attempt from a hidden non-owner surface', async (
    _mode,
    jiwoScanLoginEnabled,
    pollOperation,
  ) => {
    testState.jiwoScanLoginEnabled = jiwoScanLoginEnabled
    await act(async () => {
      renderer = create(<ArkmeSurface ownsQrLogin={false} />)
      await vi.advanceTimersByTimeAsync(1_300)
    })

    expect(testState.calls.filter(method => method === pollOperation)).toHaveLength(0)
  })

  it.each([
    ['startup gate', () => <LoginAfterLogout t={defaultArkmeLoginTranslate} />],
    ['sidebar', () => <ArkmeSurface ownsQrLogin />],
  ] as const)('keeps the user-selected login tab while canceling a pending Jiwo attempt in the %s', async (
    _surface,
    renderSurface,
  ) => {
    testState.jiwoScanLoginEnabled = true
    testState.testLoginEnabled = true

    await act(async () => {
      renderer = create(renderSurface())
    })
    expect(renderer!.root.findByType(ArkmeLogin).props.mode).toBe('jiwo')
    const phoneTab = renderer!.root.findAllByType('button')
      .find(button => button.props.role === 'tab' && button.children.includes('手机号登录'))
    expect(phoneTab).toBeDefined()

    await act(async () => { phoneTab!.props.onClick() })

    expect(renderer!.root.findByType(ArkmeLogin).props.mode).toBe('phone')
  })

  it.each([
    ['zh', defaultArkmeLoginTranslate, '登录即我'],
    ['en', english, 'Sign in to Arkme'],
  ] as const)('keeps the selected %s login language after the Chinese account settings log out', async (locale, t, title) => {
    let auth: ArkmeAuthSnapshot = { status: 'authenticated', environment: 'prod', userId: 10001 }
    arkmeAuthStore.setAuth(auth)
    vi.mocked(callArkme).mockImplementation(async method => {
      testState.calls.push(method)
      if (method === 'auth.status') return auth as never
      if (method === 'auth.config') return { captchaId: '', testLoginEnabled: false } as never
      if (method === 'user.profile' || method === 'user.profile.refresh') {
        return { profile: { displayName: 'Test', nickname: 'Test', arkmeId: 'test', contact: { phoneMasked: '138****0000' } } } as never
      }
      if (method === 'auth.logout') {
        auth = { status: 'logged-out', environment: 'prod' }
        return auth as never
      }
      if (method === 'auth.begin' || method === 'auth.poll') return testState.pending as never
      throw new Error(`unexpected method ${method}`)
    })

    await act(async () => {
      renderer = create(<><ArkmeSettingsSurface /><LoginAfterLogout t={t} /></>)
    })
    expect(renderer!.root.findAllByType(ArkmeLogin)).toHaveLength(0)
    const logout = renderer!.root.findAllByType('button')
      .find(button => button.findAllByType('strong').some(label => label.children.includes('退出登录')))
    expect(logout).toBeDefined()

    await act(async () => { logout!.props.onClick() })

    expect(testState.calls).toContain('auth.logout')
    const login = renderer!.root.findByType(ArkmeLogin)
    expect(login.props.t('locale.id')).toBe(locale)
    expect(login.findByType('h3').children).toEqual([title])
  })
})
