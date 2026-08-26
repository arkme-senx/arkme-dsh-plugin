import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { formatLoginPhone, ArkmeLogin, type ArkmeLoginProps } from '../src/client/ArkmeLogin.js'
import {
  arkmeLoginEn, type ArkmeLoginLocaleKey, type ArkmeLoginTranslate,
} from '../src/client/arkme-login-locales.js'

const english: ArkmeLoginTranslate = ((key: ArkmeLoginLocaleKey) => arkmeLoginEn[key]) as ArkmeLoginTranslate

function renderLogin(patch: Partial<ArkmeLoginProps> = {}): string {
  return renderToStaticMarkup(<ArkmeLogin
    mode="wechat"
    agreed
    busy={false}
    submitBusy={false}
    error=""
    phone=""
    smsCode=""
    smsCountdown={0}
    testLoginEnabled={false}
    testUserId=""
    qrDataUrl=""
    onModeChange={() => undefined}
    onAgreementChange={() => undefined}
    onPhoneChange={() => undefined}
    onSmsCodeChange={() => undefined}
    onTestUserIdChange={() => undefined}
    onSendCode={() => undefined}
    onVerifyCode={() => undefined}
    onTestLogin={() => undefined}
    onWechatLogin={() => undefined}
    onCancelBinding={() => undefined}
    {...patch}
  />)
}

describe('ArkmeLogin', () => {
  it('matches the desktop web login default with WeChat first and agreement checked', () => {
    const html = renderLogin()
    const visibleText = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')

    expect(html).toContain('登录即我')
    expect(html).toContain('即我，')
    expect(html).toContain('你的数字自我。')
    expect(html).toContain('数字方舟，真实的我')
    expect(html).not.toContain('Digital ark, true me')
    expect(html).toContain('dsh-arkme-login-story')
    expect(html).toContain('dsh-arkme-login-wordmark')
    expect(html).not.toContain('<p>即我</p>')
    expect(html).toContain('请使用微信扫码登录')
    expect(html).toContain('二维码加载中')
    expect(html).not.toContain('dsh-arkme-login-qr-hint')
    expect(html.indexOf('微信扫码')).toBeLessThan(html.indexOf('手机号登录'))
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('《隐私条款》')
    expect(html).not.toContain('dsh-arkme-login-logo')
    expect(html).toContain('#8295e8')
    expect(html).not.toContain('state-success')
    expect(html).not.toContain('#2f80ed')
    expect(visibleText).not.toMatch(/[A-Za-z]/)
  })

  it('renders the web phone form labels and formatting', () => {
    const html = renderLogin({ mode: 'phone', agreed: false, phone: '13800138000', smsCode: '123456' })

    expect(html).toContain('手机号')
    expect(html).toContain('dsh-arkme-login-phone-panel')
    expect(html).toContain('+86')
    expect(html).toContain('138 0013 8000')
    expect(html).toContain('请输入 6 位验证码')
    expect(html).toContain('获取验证码')
  })

  it('keeps an authentication failure on the login page and offers a fresh login attempt', () => {
    const html = renderLogin({ error: '登录凭据已失效' })

    expect(html).toContain('登录即我')
    expect(html).toContain('登录凭据已失效')
    expect(html).toContain('重新登录')
    expect(html).toContain('data-state="error"')
    expect(html).toContain('.dsh-arkme-login-qr-frame[data-state=')
    expect(html).toContain('] .dsh-arkme-login-qr-relogin')
    expect(html).toContain('background: #171923')
    expect(html).not.toContain('二维码加载中')
  })

  it('refreshes a loaded WeChat QR code when the QR control is clicked', () => {
    const onWechatLogin = vi.fn()
    const renderer = create(<ArkmeLogin
      mode="wechat"
      agreed
      busy={false}
      submitBusy={false}
      error=""
      phone=""
      smsCode=""
      smsCountdown={0}
      testLoginEnabled={false}
      testUserId=""
      qrDataUrl="data:image/gif;base64,fresh-qr"
      onModeChange={() => undefined}
      onAgreementChange={() => undefined}
      onPhoneChange={() => undefined}
      onSmsCodeChange={() => undefined}
      onTestUserIdChange={() => undefined}
      onSendCode={() => undefined}
      onVerifyCode={() => undefined}
      onTestLogin={() => undefined}
      onWechatLogin={onWechatLogin}
      onCancelBinding={() => undefined}
    />)

    renderer.root.findByProps({ 'aria-label': '刷新微信登录二维码' }).props.onClick()

    expect(onWechatLogin).toHaveBeenCalledTimes(1)
  })

  it('disables QR refresh while a new WeChat QR code is loading', () => {
    const html = renderLogin({
      busy: true,
      qrDataUrl: 'data:image/gif;base64,current-qr',
    })

    expect(html).toContain('aria-label="正在刷新微信登录二维码"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('正在刷新')
  })

  it('renders the bound-phone gate as a focused phone verification flow', () => {
    const html = renderLogin({ phoneBindingRequired: true, mode: 'wechat' })

    expect(html).toContain('完成登录')
    expect(html).toContain('完成后才会登录成功')
    expect(html).toContain('完成绑定')
    expect(html).toContain('取消绑定')
    expect(html).toContain('请输入 11 位手机号')
    expect(html).toContain('dsh-arkme-login-actions')
    expect(html).not.toContain('换账号登录')
    expect(html).not.toContain('微信扫码')
    expect(html).not.toContain('二维码加载中')
  })

  it('explains the two independent accounts without exposing a backend ticket', () => {
    const html = renderLogin({
      phoneBindingRequired: true,
      mode: 'phone',
      phoneConflict: {
        status: 'phone-binding-conflict',
        conflictRef: 'browser-safe-ref',
        phoneMasked: '178****3182',
        currentAccount: {
          displayName: '扫码账号', arkmeId: 'scan-account', registeredAtMillis: 1_700_000_000_000,
          avatarFallback: { kind: 'phone_default', colorIndex: 2, label: '扫' },
        },
        phoneAccount: {
          displayName: '一雨今生', arkmeId: 'phone-account', registeredAtMillis: 1_600_000_000_000,
          avatarFallback: { kind: 'phone_default', colorIndex: 5, label: '一' },
        },
        expiresAtMillis: Date.now() + 300_000,
      },
    })

    expect(html).toContain('这个手机号已有账号')
    expect(html).toContain('两个账号的数据不会合并')
    expect(html).toContain('本次也不会变更微信绑定')
    expect(html).toContain('178****3182')
    expect(html).toContain('扫码账号')
    expect(html).toContain('一雨今生')
    expect(html).toContain('即我号：scan-account')
    expect(html).toContain('即我号：phone-account')
    expect(html).toContain('注册时间：')
    expect(html).not.toContain('账号 ID')
    expect(html).not.toContain('10001')
    expect(html).not.toContain('10002')
    expect(html).toContain('登录手机号账号（推荐）')
    expect(html).toContain('将手机号换绑到扫码账号')
    expect(html).toContain('换一个手机号')
    expect(html).not.toContain('backend-ticket')
    expect(html).not.toContain('browser-safe-ref')
    expect(html).not.toContain('<div class="dsh-arkme-login-agreement">')
  })

  it('requires a second confirmation before moving the phone binding', async () => {
    const onResolvePhoneConflict = vi.fn()
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<ArkmeLogin
        mode="phone"
        phoneBindingRequired
        phoneConflict={{
          status: 'phone-binding-conflict',
          conflictRef: 'browser-safe-ref',
          phoneMasked: '178****3182',
          currentAccount: {
            displayName: '扫码账号', arkmeId: 'scan-account', registeredAtMillis: 1_700_000_000_000,
          },
          phoneAccount: {
            displayName: '手机号账号', arkmeId: 'phone-account', registeredAtMillis: 1_600_000_000_000,
          },
          expiresAtMillis: Date.now() + 300_000,
        }}
        agreed
        busy={false}
        submitBusy={false}
        error=""
        phone="17871673182"
        smsCode="123456"
        smsCountdown={0}
        testLoginEnabled={false}
        testUserId=""
        qrDataUrl=""
        onModeChange={() => undefined}
        onAgreementChange={() => undefined}
        onPhoneChange={() => undefined}
        onSmsCodeChange={() => undefined}
        onTestUserIdChange={() => undefined}
        onSendCode={() => undefined}
        onVerifyCode={() => undefined}
        onTestLogin={() => undefined}
        onWechatLogin={() => undefined}
        onCancelBinding={() => undefined}
        onResolvePhoneConflict={onResolvePhoneConflict}
      />)
    })

    const transferLabel = renderer!.root.findAllByType('strong')
      .find(item => item.children.join('') === '将手机号换绑到扫码账号')
    const transferOption = transferLabel?.parent
    if (transferOption === null || transferOption === undefined) throw new Error('transfer option missing')
    await act(async () => { transferOption.props.onClick() })
    expect(onResolvePhoneConflict).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).toContain('两个账号的数据仍保持独立')
    const confirm = renderer!.root.findAllByType('button')
      .find(item => item.props['data-danger'] !== undefined)
    if (confirm === undefined) throw new Error('transfer confirmation missing')
    await act(async () => { confirm.props.onClick() })
    expect(onResolvePhoneConflict).toHaveBeenCalledWith('transfer_to_current')
  })

  it('does not show binding progress before the verification submit starts', () => {
    const html = renderLogin({ phoneBindingRequired: true, mode: 'phone', busy: true, submitBusy: false })

    expect(html).toContain('完成绑定')
    expect(html).not.toContain('正在绑定')
  })

  it('renders the test account login method only when enabled', () => {
    const html = renderLogin({ mode: 'test', testLoginEnabled: true, testUserId: '10001' })

    expect(html).toContain('测试账号')
    expect(html).toContain('测试用户编号')
    expect(html).not.toContain('<label class="dsh-arkme-login-label" for="dsh-arkme-login-test-user">')
    expect(html).toContain('value="10001"')
    expect(html).toContain('测试账号登录')
    expect(html).not.toContain('二维码加载中')
  })

  it('formats mainland phone digits exactly like arkme-frontend-web', () => {
    expect(formatLoginPhone('13800138000')).toBe('138 0013 8000')
    expect(formatLoginPhone('138-0013-8000')).toBe('138 0013 8000')
    expect(formatLoginPhone('1380013800099')).toBe('138 0013 8000')
  })

  it('renders the complete login surface in English without Chinese copy', () => {
    const html = renderLogin({ t: english, mode: 'phone', phoneBindingRequired: true })

    expect(html).toContain('Finish signing in')
    expect(html).toContain('Phone number')
    expect(html).toContain('User Agreement')
    expect(html).toContain('Privacy Policy')
    expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('left-aligns the WeChat QR block with the login form content', () => {
    const html = renderLogin()

    expect(html).toContain('.dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: flex-start; text-align: left; }')
    expect(html).toContain('.dsh-arkme-login-qr-title { order: 1; margin: 0; font-size: 14px;')
    expect(html).toContain('.dsh-arkme-login-qr-frame { order: 2; width: 116px; height: 116px; margin-top: 18px;')
    expect(html).not.toContain('.dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }')
  })

  it('pins the Demo typography, tabs, and primary button geometry', () => {
    const html = renderLogin({ mode: 'phone' })
    const css = html.replaceAll('&gt;', '>')

    expect(css).toContain('font-family: -apple-system, BlinkMacSystemFont')
    expect(css).toContain('.dsh-arkme-login-brand > p { margin: 0 0 12px; color: #858a94; font-size: 12px;')
    expect(css).toContain('.dsh-arkme-login-title { font-size: 30px; line-height: 1.2;')
    expect(css).toContain('.dsh-arkme-login-brand > span { margin-top: 9px; display: block; color: #858992; font-size: 13px;')
    expect(css).toContain('.dsh-arkme-login-tabs { width: 232px;')
    expect(css).toContain('.dsh-arkme-login-tab { height: 34px; padding: 0 9px; border-radius: 9px; color: #777b84; font-size: 12px;')
    expect(css).toContain('.dsh-arkme-login-submit { height: 46px; margin-top: 18px; border-radius: 12px; background: #171923; font-size: 14px;')
    expect(css).toContain('.dsh-arkme-login-phone-panel > .dsh-arkme-login-submit { margin-top: 48px; }')
    expect(css).toContain('.dsh-arkme-login-card { margin: 0 auto; padding: 90px 0 48px; }')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-tab {')
    expect(css).toContain('font-size: 12px !important;')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-tab:focus {')
    expect(css).toContain('outline: none !important;')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-submit,')
    expect(css).toContain('background: #171923 !important;')
  })
})
