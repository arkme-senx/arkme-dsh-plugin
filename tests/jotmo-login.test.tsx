import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatLoginPhone, JotmoLogin, type JotmoLoginProps } from '../src/client/JotmoLogin.js'

function renderLogin(patch: Partial<JotmoLoginProps> = {}): string {
  return renderToStaticMarkup(<JotmoLogin
    mode="wechat"
    agreed
    busy={false}
    error=""
    phone=""
    smsCode=""
    smsCountdown={0}
    qrDataUrl=""
    onModeChange={() => undefined}
    onAgreementChange={() => undefined}
    onPhoneChange={() => undefined}
    onSmsCodeChange={() => undefined}
    onSendCode={() => undefined}
    onVerifyCode={() => undefined}
    {...patch}
  />)
}

describe('JotmoLogin', () => {
  it('matches the desktop web login default with WeChat first and agreement checked', () => {
    const html = renderLogin()

    expect(html).toContain('登录即我')
    expect(html).toContain('请使用微信扫码登录')
    expect(html).toContain('二维码加载中')
    expect(html.indexOf('微信扫码')).toBeLessThan(html.indexOf('手机号登录'))
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('《隐私条款》')
  })

  it('renders the web phone form labels and formatting', () => {
    const html = renderLogin({ mode: 'phone', agreed: false, phone: '13800138000', smsCode: '123456' })

    expect(html).toContain('手机号')
    expect(html).toContain('+86')
    expect(html).toContain('138 0013 8000')
    expect(html).toContain('请输入 6 位验证码')
    expect(html).toContain('获取验证码')
  })

  it('formats mainland phone digits exactly like jotmo-frontend-web', () => {
    expect(formatLoginPhone('13800138000')).toBe('138 0013 8000')
    expect(formatLoginPhone('138-0013-8000')).toBe('138 0013 8000')
    expect(formatLoginPhone('1380013800099')).toBe('138 0013 8000')
  })
})
