import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'react-test-renderer'
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

function darkLoginCss(patch: Partial<ArkmeLoginProps> = {}): string {
  const css = (renderLogin(patch).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '')
    .replaceAll('&gt;', '>').replaceAll('&#x27;', "'")
  return css.slice(css.indexOf('body[data-ds-dark-theme] .dsh-arkme-login-page {'))
}

describe('ArkmeLogin', () => {
  it('matches the desktop web login default with WeChat first and agreement checked', () => {
    const html = renderLogin()
    const visibleText = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')

    expect(html).toContain('登录即我')
    expect(html).toContain('即我，')
    expect(html).toContain('你的数字自我')
    expect(html).toContain('<p class="dsh-arkme-login-description">连接你的经历，成为更懂你的数字自我。</p>')
    expect(visibleText).not.toContain('选择你熟悉的方式继续')
    expect(html).not.toContain('数字方舟，真实的我')
    expect(html).not.toContain('你的内容属于你')
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
    expect(html).toContain('background: var(--arkme-login-primary-action)')
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
    expect(html).toContain('验证手机号后即可继续')
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

  it('keeps a concise product description below the English headline and a short Wechat QR tab', () => {
    const html = renderLogin({ t: english })

    expect(html).toContain('<h1>Arkme,<br/>Digital ark, true me</h1>')
    expect(html).toContain('<p class="dsh-arkme-login-description">Your experiences, connected into a digital you.</p>')
    expect(html).not.toContain('Choose the sign-in method you prefer')
    expect(html).toMatch(/role="tab"[^>]*>Wechat QR<\/button>/)
    expect(html).not.toContain('your digital self.')
    expect(html).not.toContain('Your content belongs to you')
    expect(html).not.toContain('<strong>Digital ark, true me</strong>')
    expect(html).toContain('Phone number')
    expect(html).toContain('User Agreement')
    expect(html).toContain('Privacy Policy')
  })

  it('left-aligns the WeChat QR block with the login form content', () => {
    const html = renderLogin()

    expect(html).toContain('.dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: flex-start; text-align: left; }')
    expect(html).toContain('.dsh-arkme-login-qr-title { order: 1; margin: 0; font-size: 14px;')
    expect(html).toContain('.dsh-arkme-login-qr-frame { order: 2; width: 116px; height: 116px; margin-top: 16px;')
    expect(html).not.toContain('.dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }')
  })

  it('keeps the final desktop palette on DSH semantic theme tokens', () => {
    const css = renderLogin().replaceAll('&gt;', '>')
    const desktopPalette = css.match(/\.dsh-arkme-login-page \{\s+min-height: 100%;([\s\S]+?)\/\* DSH owns light\/dark\/system;/)?.[1] ?? ''

    expect(desktopPalette).not.toBe('')
    expect(desktopPalette).toContain('background: var(--arkme-login-base);')
    expect(desktopPalette).toContain('background: var(--arkme-login-subtle);')
    expect(desktopPalette).toContain('background: var(--arkme-login-primary-action) !important;')
    expect(desktopPalette).toContain('color: var(--arkme-login-on-primary-action) !important;')
    expect(desktopPalette).toContain('background: var(--arkme-login-surface) !important;')
    expect(desktopPalette).toContain('color: var(--arkme-login-text) !important;')
    expect(desktopPalette).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('follows the host dark theme for both columns and keeps the wordmark readable', () => {
    const darkCss = darkLoginCss()

    expect(darkCss).toContain('background: var(--arkme-login-base);')
    expect(darkCss).toMatch(/\.dsh-arkme-login-story \{[^}]*background: var\(--dsw-alias-bg-layer-1\)/)
    expect(darkCss).toMatch(/\.dsh-arkme-login-definition h1 \{[^}]*color: var\(--arkme-login-text\)/)
    expect(darkCss).toContain('.dsh-arkme-login-description,')
    expect(darkCss).toContain('.dsh-arkme-login-agreement')
    expect(darkCss).toMatch(/\.dsh-arkme-login-wordmark \{[^}]*filter: invert\(1\) hue-rotate\(180deg\)/)
    expect(darkCss).not.toContain('prefers-color-scheme')
  })

  it('covers dark form interactions without losing contrasting action and checkbox labels', () => {
    const darkCss = darkLoginCss({ mode: 'phone', phoneBindingRequired: true })

    expect(darkCss).toMatch(/\.dsh-arkme-login-input \{[^}]*color: var\(--arkme-login-text\) !important/)
    expect(darkCss).toContain('.dsh-arkme-login-input-shell:focus-within')
    expect(darkCss).toContain(".dsh-arkme-login-tab[aria-selected='true']")
    expect(darkCss).toContain('.dsh-arkme-login-tab:focus-visible')
    expect(darkCss).toContain('.dsh-arkme-login-code-button:disabled')
    expect(darkCss).toMatch(/\.dsh-arkme-login-check-input:checked \+ \.dsh-arkme-login-check \{[^}]*background: var\(--arkme-login-text\);[^}]*color: var\(--arkme-login-base\)/)
    expect(darkCss).toMatch(/\.dsh-arkme-login-qr-relogin \{[^}]*background: var\(--arkme-login-text\) !important;[^}]*color: var\(--arkme-login-base\) !important/)
    expect(darkCss).toContain('.dsh-arkme-login-cancel')
  })

  it('keeps only the loaded QR surface white in dark mode, without filtering the code', () => {
    const darkCss = darkLoginCss({ qrDataUrl: 'data:image/gif;base64,fresh-qr' })

    expect(darkCss).toMatch(/\.dsh-arkme-login-qr-frame:has\(\.dsh-arkme-login-qr-image\) \{[^}]*background: #fff;/)
    expect(darkCss).not.toMatch(/\.dsh-arkme-login-qr-image\s*\{[^}]*filter:/)
    expect(darkCss).toContain('.dsh-arkme-login-qr-loading,')
    expect(darkCss).toContain(".dsh-arkme-login-qr-frame[data-state='error']")
  })

  it('keeps consistent spacing between the headline, form sections, and agreement', () => {
    const html = renderLogin({ mode: 'phone' })
    const css = html.replaceAll('&gt;', '>')

    expect(css).toContain('font-family: -apple-system, BlinkMacSystemFont')
    expect(css).toContain('.dsh-arkme-login-brand > p { margin: 0 0 8px; color: var(--arkme-login-secondary); font-size: 12px;')
    expect(css).toContain('.dsh-arkme-login-title { font-size: 30px; line-height: 1.2;')
    expect(css).toContain('.dsh-arkme-login-brand > span { margin-top: 9px; display: block; color: var(--arkme-login-secondary); font-size: 13px;')
    expect(css).toContain('.dsh-arkme-login-description { margin: 24px 0 0;')
    expect(css).toContain('.dsh-arkme-login-tabs-wrap { justify-content: flex-start; margin-top: 28px; }')
    expect(css).toContain('.dsh-arkme-login-qr-panel { min-height: 152px; justify-content: flex-start; }')
    expect(css).toContain('.dsh-arkme-login-agreement { margin-top: 32px; column-gap: 3px;')
    expect(css).toContain('.dsh-arkme-login-tabs { width: 232px;')
    expect(css).toContain('.dsh-arkme-login-tab { height: 34px; padding: 0 9px; border-radius: 9px; color: var(--arkme-login-secondary); font-size: 12px;')
    expect(css).toContain('.dsh-arkme-login-submit { height: 46px; margin-top: 18px; border-radius: 12px; background: var(--arkme-login-primary-action); font-size: 14px;')
    expect(css).toContain('.dsh-arkme-login-phone-panel > .dsh-arkme-login-submit { margin-top: 28px; }')
    expect(css).toContain('.dsh-arkme-login-card { margin: 0 auto; padding: 90px 0 48px; }')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-tab {')
    expect(css).toContain('font-size: 12px !important;')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-tab:focus {')
    expect(css).toContain('outline: none !important;')
    expect(css).toContain('.dsh-arkme-login-page .dsh-arkme-login-submit,')
    expect(css).toContain('background: var(--arkme-login-primary-action) !important;')
  })
})
