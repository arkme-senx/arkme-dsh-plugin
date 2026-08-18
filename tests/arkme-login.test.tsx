import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatLoginPhone, ArkmeLogin, type ArkmeLoginProps } from '../src/client/ArkmeLogin.js'

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
    onCancelBinding={() => undefined}
    {...patch}
  />)
}

describe('ArkmeLogin', () => {
  it('matches the desktop web login default with WeChat first and agreement checked', () => {
    const html = renderLogin()

    expect(html).toContain('登录 Arkme')
    expect(html).toContain('请使用微信扫码登录')
    expect(html).toContain('二维码加载中')
    expect(html.indexOf('微信扫码')).toBeLessThan(html.indexOf('手机号登录'))
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('《隐私条款》')
    expect(html).not.toContain('dsh-arkme-login-logo')
    expect(html).toContain('#09b83e')
    expect(html).not.toContain('#2f80ed')
  })

  it('renders the web phone form labels and formatting', () => {
    const html = renderLogin({ mode: 'phone', agreed: false, phone: '13800138000', smsCode: '123456' })

    expect(html).toContain('手机号')
    expect(html).toContain('+86')
    expect(html).toContain('138 0013 8000')
    expect(html).toContain('请输入 6 位验证码')
    expect(html).toContain('获取验证码')
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

  it('does not show binding progress before the verification submit starts', () => {
    const html = renderLogin({ phoneBindingRequired: true, mode: 'phone', busy: true, submitBusy: false })

    expect(html).toContain('完成绑定')
    expect(html).not.toContain('正在绑定')
  })

  it('renders the test account login method only when enabled', () => {
    const html = renderLogin({ mode: 'test', testLoginEnabled: true, testUserId: '10001' })

    expect(html).toContain('测试账号')
    expect(html).toContain('测试 user_id')
    expect(html).toContain('value="10001"')
    expect(html).toContain('测试账号登录')
    expect(html).not.toContain('二维码加载中')
  })

  it('formats mainland phone digits exactly like arkme-frontend-web', () => {
    expect(formatLoginPhone('13800138000')).toBe('138 0013 8000')
    expect(formatLoginPhone('138-0013-8000')).toBe('138 0013 8000')
    expect(formatLoginPhone('1380013800099')).toBe('138 0013 8000')
  })
})
