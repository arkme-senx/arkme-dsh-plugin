import type { ChangeEvent } from 'react'
import { ArkmeMark } from './ArkmeFooterAction.js'

export type ArkmeLoginMode = 'wechat' | 'phone' | 'test'

export interface ArkmeLoginProps {
  mode: ArkmeLoginMode
  phoneBindingRequired?: boolean
  agreed: boolean
  busy: boolean
  submitBusy: boolean
  error: string
  phone: string
  smsCode: string
  smsCountdown: number
  testLoginEnabled: boolean
  testUserId: string
  qrDataUrl: string
  onModeChange: (mode: ArkmeLoginMode) => void
  onAgreementChange: (agreed: boolean) => void
  onPhoneChange: (phone: string) => void
  onSmsCodeChange: (code: string) => void
  onTestUserIdChange: (userId: string) => void
  onSendCode: () => void
  onVerifyCode: () => void
  onTestLogin: () => void
  onWechatLogin: () => void
  onCancelBinding: () => void
}

const agreementWarningText = '请阅读并同意用户协议和隐私条款'

export function formatLoginPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  return digits.replace(/^(\d{3})(\d{0,4})(\d{0,4}).*/, (_match, first, second, third) => (
    [first, second, third].filter(Boolean).join(' ')
  ))
}

const loginStyles = `
  .dsh-arkme-login-page,
  .dsh-arkme-login-page * { box-sizing: border-box; }
  .dsh-arkme-login-page {
    --arkme-login-base: var(--dsw-alias-bg-base, #ffffff);
    --arkme-login-surface: var(--dsw-alias-bg-layer-2, #ffffff);
    --arkme-login-subtle: var(--dsw-alias-bg-module-platform, #f3f4f8);
    --arkme-login-hover: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06));
    --arkme-login-text: var(--dsw-alias-label-primary, #17191c);
    --arkme-login-secondary: var(--dsw-alias-label-secondary, #6f747b);
    --arkme-login-caption: var(--dsw-alias-label-caption, #9ba1a9);
    --arkme-login-border: var(--dsw-alias-border-l2, #e2e4e7);
    --arkme-login-accent: var(--dsw-alias-state-business-primary, #8295e8);
    --arkme-login-accent-soft: var(--dsw-alias-state-business-tertiary, #f1f2f6);
    --arkme-login-danger: var(--dsw-alias-state-error-primary, #b0442e);
    --arkme-login-danger-soft: var(--dsw-alias-interactive-bg-hover-danger, #fff3f0);
    --arkme-login-foreground: var(--dsw-static-neutral-bluish-00, #ffffff);
    position: relative;
    isolation: isolate;
    min-height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--arkme-login-text);
    background: radial-gradient(ellipse at center, var(--arkme-login-base) 0%, var(--arkme-login-base) 58%, var(--arkme-login-accent-soft) 145%);
  }
  .dsh-arkme-login-glow-top {
    position: absolute;
    left: calc(50% - 520px);
    top: -220px;
    z-index: -1;
    width: 560px;
    height: 560px;
    border-radius: 50%;
    background: var(--arkme-login-surface);
    opacity: .75;
    filter: blur(96px);
    pointer-events: none;
  }
  .dsh-arkme-login-glow-bottom {
    position: absolute;
    right: -210px;
    bottom: -190px;
    z-index: -1;
    width: 620px;
    height: 620px;
    border-radius: 50%;
    background: var(--arkme-login-accent-soft);
    opacity: .32;
    filter: blur(116px);
    pointer-events: none;
  }
  .dsh-arkme-login-card {
    position: relative;
    z-index: 1;
    width: min(430px, 100%);
    overflow: hidden;
    border: 1px solid var(--arkme-login-border);
    border-radius: 32px;
    padding: 32px 24px;
    background: color-mix(in srgb, var(--arkme-login-surface) 95%, transparent);
    box-shadow: var(--dsw-shadow-lv3, 0 28px 80px rgba(45,52,75,.08));
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .dsh-arkme-login-content { position: relative; z-index: 1; }
  .dsh-arkme-login-brand { display: flex; align-items: center; gap: 12px; }
  .dsh-arkme-login-title {
    margin: 0;
    color: var(--arkme-login-text);
    font-size: 30px;
    font-weight: 600;
    line-height: 36px;
    letter-spacing: 0;
  }
  .dsh-arkme-login-notice {
    margin-top: 20px;
    border: 1px solid var(--arkme-login-border);
    border-radius: 14px;
    padding: 10px 12px;
    background: var(--arkme-login-accent-soft);
    color: var(--arkme-login-text);
    font-size: 14px;
    line-height: 21px;
  }
  .dsh-arkme-login-tabs-wrap { display: flex; justify-content: center; margin-top: 32px; }
  .dsh-arkme-login-tabs {
    display: inline-flex;
    padding: 4px;
    border-radius: 999px;
    background: var(--arkme-login-subtle);
  }
  .dsh-arkme-login-tab {
    height: 40px;
    min-width: 0;
    border: 0;
    border-radius: 999px;
    padding: 0 20px;
    background: transparent;
    color: var(--arkme-login-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    transition: color .15s ease, background .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-tab:hover { color: var(--arkme-login-accent); }
  .dsh-arkme-login-tab[aria-selected='true'] {
    background: var(--arkme-login-surface);
    color: var(--arkme-login-text);
    font-weight: 600;
    box-shadow: 0 8px 20px rgba(45,52,75,.14);
  }
  .dsh-arkme-login-method { margin-top: 28px; }
  .dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .dsh-arkme-login-qr-title { color: var(--arkme-login-text); font-size: 18px; font-weight: 600; line-height: 26px; }
  .dsh-arkme-login-qr-frame {
    width: 224px;
    height: 224px;
    margin-top: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--arkme-login-border);
    border-radius: 18px;
    background: var(--arkme-login-subtle);
  }
  .dsh-arkme-login-qr-image { width: 200px; height: 200px; display: block; object-fit: contain; }
  .dsh-arkme-login-qr-loading { color: var(--arkme-login-secondary); font-size: 14px; line-height: 20px; }
  .dsh-arkme-login-qr-relogin {
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    background: var(--arkme-login-accent);
    color: var(--arkme-login-foreground);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
  }
  .dsh-arkme-login-field + .dsh-arkme-login-field { margin-top: 20px; }
  .dsh-arkme-login-label { display: block; color: var(--arkme-login-text); font-size: 14px; font-weight: 600; line-height: 20px; }
  .dsh-arkme-login-input-shell {
    position: relative;
    width: 100%;
    height: 48px;
    min-width: 0;
    margin-top: 8px;
    display: flex;
    align-items: center;
    border: 1px solid var(--arkme-login-border);
    border-radius: 14px;
    padding: 0 12px;
    background: var(--arkme-login-subtle);
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-input-shell:focus-within {
    border-color: var(--arkme-login-accent);
    box-shadow: 0 0 0 2px var(--arkme-login-accent-soft);
  }
  .dsh-arkme-login-prefix {
    flex: none;
    margin-right: 12px;
    border-right: 1px solid var(--arkme-login-border);
    padding-right: 12px;
    color: var(--arkme-login-secondary);
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }
  .dsh-arkme-login-input {
    width: 100%;
    min-width: 0;
    border: 0;
    padding: 0;
    outline: 0;
    background: transparent;
    color: var(--arkme-login-text);
    font: inherit;
    font-size: 16px;
    line-height: 24px;
  }
  .dsh-arkme-login-input::placeholder { color: var(--arkme-login-caption); opacity: 1; }
  .dsh-arkme-login-code-input { padding-right: 100px; }
  .dsh-arkme-login-test-note {
    margin: 0 0 14px;
    color: var(--arkme-login-secondary);
    font-size: 13px;
    line-height: 20px;
  }
  .dsh-arkme-login-code-action {
    position: absolute;
    right: 0;
    top: 50%;
    width: 100px;
    height: 32px;
    display: flex;
    align-items: center;
    transform: translateY(-50%);
  }
  .dsh-arkme-login-code-divider { width: 1px; height: 24px; flex: none; background: var(--arkme-login-border); }
  .dsh-arkme-login-code-button {
    height: 32px;
    min-width: 0;
    flex: 1;
    border: 0;
    border-radius: 10px;
    padding: 0;
    background: transparent;
    color: var(--arkme-login-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
  }
  .dsh-arkme-login-code-button:hover:not(:disabled) { color: var(--arkme-login-text); }
  .dsh-arkme-login-code-button:disabled { color: var(--arkme-login-caption); cursor: default; }
  .dsh-arkme-login-submit {
    width: 100%;
    height: 48px;
    margin-top: 24px;
    border: 0;
    border-radius: 14px;
    background: var(--arkme-login-accent);
    color: var(--arkme-login-foreground);
    cursor: pointer;
    font: inherit;
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
    box-shadow: var(--dsw-shadow-lv2, 0 12px 24px rgba(23,34,27,.18));
  }
  .dsh-arkme-login-submit:hover:not(:disabled) { filter: brightness(.94); }
  .dsh-arkme-login-submit:disabled { cursor: default; box-shadow: none; opacity: .72; }
  .dsh-arkme-login-actions {
    margin-top: 24px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  .dsh-arkme-login-actions .dsh-arkme-login-submit { margin-top: 0; }
  .dsh-arkme-login-cancel {
    width: 100%;
    height: 48px;
    border: 1px solid var(--arkme-login-border);
    border-radius: 14px;
    background: var(--arkme-login-surface);
    color: var(--arkme-login-text);
    cursor: pointer;
    font: inherit;
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
  }
  .dsh-arkme-login-cancel:hover:not(:disabled) { background: var(--arkme-login-hover); border-color: var(--arkme-login-border); }
  .dsh-arkme-login-cancel:disabled { cursor: default; opacity: .62; }
  .dsh-arkme-login-error {
    margin-top: 16px;
    border-radius: 12px;
    padding: 8px 12px;
    background: var(--arkme-login-danger-soft);
    color: var(--arkme-login-danger);
    font-size: 13px;
    line-height: 20px;
  }
  .dsh-arkme-login-agreement {
    margin-top: 24px;
    display: flex;
    max-width: 100%;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    row-gap: 4px;
    color: var(--arkme-login-secondary);
    font-size: 12px;
    line-height: 20px;
  }
  .dsh-arkme-login-check-label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .dsh-arkme-login-check-input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .dsh-arkme-login-check {
    width: 16px;
    height: 16px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--arkme-login-border);
    border-radius: 4px;
    background: var(--arkme-login-surface);
    color: transparent;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-check-input:checked + .dsh-arkme-login-check { border-color: var(--arkme-login-accent); background: var(--arkme-login-accent); color: var(--arkme-login-foreground); }
  .dsh-arkme-login-check-input:focus-visible + .dsh-arkme-login-check { box-shadow: 0 0 0 2px var(--arkme-login-accent-soft); }
  .dsh-arkme-login-link { color: var(--arkme-login-accent); font-weight: 600; text-decoration: none; }
  .dsh-arkme-login-link:hover { filter: brightness(.9); }
  .dsh-arkme-login-page {
    min-height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(430px, .92fr);
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
    background: #ffffff;
  }
  .dsh-arkme-login-glow-top,
  .dsh-arkme-login-glow-bottom { display: none; }
  .dsh-arkme-login-story {
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 66px 64px 48px 76px;
    border-right: 1px solid #ececef;
    background: linear-gradient(145deg, #fafaff 0%, #f5f6fb 58%, #f9f9fb 100%);
  }
  .dsh-arkme-login-story-brand { display: flex; align-items: center; gap: 9px; color: #1c1e23; font-size: 18px; font-weight: 650; }
  .dsh-arkme-login-story-copy { margin: auto 0; max-width: 610px; padding: 44px 0 70px; }
  .dsh-arkme-login-story-eyebrow { color: #777c88; font-size: 13px; line-height: 20px; letter-spacing: .12em; }
  .dsh-arkme-login-story-title {
    margin: 19px 0 0; color: #15171c; font-size: clamp(38px, 4.2vw, 58px); font-weight: 650;
    line-height: 1.08; letter-spacing: -.055em;
  }
  .dsh-arkme-login-story-tagline { margin-top: 22px; color: #454b56; font-size: 18px; line-height: 28px; }
  .dsh-arkme-login-story-description { max-width: 520px; margin: 20px 0 0; color: #7d828c; font-size: 14px; line-height: 24px; }
  .dsh-arkme-login-story-footer { color: #999da6; font-size: 11px; line-height: 18px; }
  .dsh-arkme-login-auth { min-width: 0; display: flex; align-items: center; justify-content: center; padding: 54px 44px; background: #fff; }
  .dsh-arkme-login-card {
    width: min(390px, 100%);
    overflow: visible;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .dsh-arkme-login-brand { display: block; }
  .dsh-arkme-login-welcome { display: block; margin-bottom: 7px; color: #9297a0; font-size: 13px; line-height: 20px; }
  .dsh-arkme-login-title { font-size: 28px; line-height: 36px; letter-spacing: -.025em; }
  .dsh-arkme-login-tabs-wrap { justify-content: flex-start; margin-top: 30px; }
  .dsh-arkme-login-tabs { width: 100%; border-radius: 12px; }
  .dsh-arkme-login-tab { flex: 1; padding: 0 10px; border-radius: 9px; }
  .dsh-arkme-login-tab:hover { color: var(--arkme-login-text); }
  .dsh-arkme-login-tab[aria-selected='true'] { box-shadow: 0 2px 8px rgba(45,52,75,.10); }
  .dsh-arkme-login-method { margin-top: 24px; }
  .dsh-arkme-login-qr-title { font-size: 15px; line-height: 22px; }
  .dsh-arkme-login-qr-frame { width: 210px; height: 210px; margin-top: 20px; border-radius: 16px; background: #fafafa; }
  .dsh-arkme-login-qr-image { width: 188px; height: 188px; }
  .dsh-arkme-login-submit { background: #202329; box-shadow: none; }
  .dsh-arkme-login-agreement { margin-top: 21px; }
  @media (max-width: 900px) {
    .dsh-arkme-login-page { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }
    .dsh-arkme-login-story { min-height: 300px; padding: 36px 34px 30px; border-right: 0; border-bottom: 1px solid #ececef; }
    .dsh-arkme-login-story-copy { margin: 30px 0 0; padding: 0; }
    .dsh-arkme-login-story-title { font-size: 38px; }
    .dsh-arkme-login-story-description { margin-top: 12px; }
    .dsh-arkme-login-story-footer { margin-top: 28px; }
    .dsh-arkme-login-auth { padding: 42px 24px 56px; }
  }
  @media (max-height: 720px) {
    .dsh-arkme-login-story { padding-top: 38px; padding-bottom: 32px; }
    .dsh-arkme-login-story-copy { padding-top: 24px; padding-bottom: 30px; }
    .dsh-arkme-login-auth { align-items: flex-start; padding-top: 34px; padding-bottom: 34px; overflow-y: auto; }
  }
`

export function ArkmeLogin(props: ArkmeLoginProps) {
  const effectiveMode = props.phoneBindingRequired === true
    ? 'phone'
    : props.mode === 'test' && !props.testLoginEnabled ? 'wechat' : props.mode
  const changePhone = (event: ChangeEvent<HTMLInputElement>) => {
    props.onPhoneChange(event.target.value.replace(/\D/g, '').slice(0, 11))
  }
  const changeCode = (event: ChangeEvent<HTMLInputElement>) => {
    props.onSmsCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))
  }
  const changeTestUserId = (event: ChangeEvent<HTMLInputElement>) => {
    props.onTestUserIdChange(event.target.value.replace(/\D/g, '').slice(0, 16))
  }

  return <div className="dsh-arkme-login-page">
    <style>{loginStyles}</style>
    <span className="dsh-arkme-login-glow-top" aria-hidden />
    <span className="dsh-arkme-login-glow-bottom" aria-hidden />
    <section className="dsh-arkme-login-story" aria-label="Arkme 产品介绍">
      <div className="dsh-arkme-login-story-brand"><ArkmeMark size={27} /><span>Arkme</span></div>
      <div className="dsh-arkme-login-story-copy">
        <div className="dsh-arkme-login-story-eyebrow">ARKME · DIGITAL SELF</div>
        <h2 className="dsh-arkme-login-story-title">Arkme，<br />你的数字自我。</h2>
        <div className="dsh-arkme-login-story-tagline">Digital ark, true me</div>
        <p className="dsh-arkme-login-story-description">连接你的聊天、快记与录音，让散落在不同时间里的内容持续沉淀，成为真正理解你的数字自我。</p>
      </div>
      <div className="dsh-arkme-login-story-footer">你的内容仅在授权范围内用于提供 Arkme 服务。</div>
    </section>
    <div className="dsh-arkme-login-auth"><section className="dsh-arkme-login-card" aria-labelledby="dsh-arkme-login-title">
      <div className="dsh-arkme-login-content">
        <div className="dsh-arkme-login-brand">
          <span className="dsh-arkme-login-welcome">Welcome</span>
          <h3 className="dsh-arkme-login-title" id="dsh-arkme-login-title">
            {props.phoneBindingRequired === true ? '完成登录' : '登录 Arkme'}
          </h3>
        </div>

        {props.phoneBindingRequired === true && <>
          <div className="dsh-arkme-login-notice" role="status">
            当前 Arkme 账号还没有绑定手机号，请先完成手机号验证，完成后才会登录成功。
          </div>
        </>}

        {props.phoneBindingRequired !== true && <div className="dsh-arkme-login-tabs-wrap">
          <div className="dsh-arkme-login-tabs" role="tablist" aria-label="登录方式">
            <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'wechat'} onClick={() => { props.onModeChange('wechat') }}>微信扫码</button>
            <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'phone'} onClick={() => { props.onModeChange('phone') }}>手机号登录</button>
            {props.testLoginEnabled && <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'test'} onClick={() => { props.onModeChange('test') }}>测试账号</button>}
          </div>
        </div>}

        <div className="dsh-arkme-login-method">
          {effectiveMode === 'wechat' ? <div className="dsh-arkme-login-qr-panel" role="tabpanel">
            <div className="dsh-arkme-login-qr-title">请使用微信扫码登录</div>
            <div className="dsh-arkme-login-qr-frame">
              {props.qrDataUrl === ''
                ? props.error !== '' && !props.busy
                  ? <button type="button" className="dsh-arkme-login-qr-relogin" onClick={props.onWechatLogin}>重新登录</button>
                  : <span className="dsh-arkme-login-qr-loading">二维码加载中</span>
                : <img className="dsh-arkme-login-qr-image" src={props.qrDataUrl} alt="微信扫码登录 Arkme" />}
            </div>
          </div> : effectiveMode === 'phone' ? <div role="tabpanel">
            <div className="dsh-arkme-login-field">
              <label className="dsh-arkme-login-label" htmlFor="dsh-arkme-login-phone">手机号</label>
              <div className="dsh-arkme-login-input-shell">
                <span className="dsh-arkme-login-prefix">+86</span>
                <input
                  id="dsh-arkme-login-phone"
                  className="dsh-arkme-login-input"
                  value={formatLoginPhone(props.phone)}
                  onChange={changePhone}
                  inputMode="numeric"
                  maxLength={13}
                  placeholder="请输入 11 位手机号"
                  aria-label="手机号"
                />
              </div>
            </div>
            <div className="dsh-arkme-login-field">
              <label className="dsh-arkme-login-label" htmlFor="dsh-arkme-login-code">验证码</label>
              <div className="dsh-arkme-login-input-shell">
                <input
                  id="dsh-arkme-login-code"
                  className="dsh-arkme-login-input dsh-arkme-login-code-input"
                  value={props.smsCode}
                  onChange={changeCode}
                  onKeyDown={event => { if (event.key === 'Enter') props.onVerifyCode() }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  name="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="请输入 6 位验证码"
                  aria-label="短信验证码"
                  disabled={props.busy}
                />
                <span className="dsh-arkme-login-code-action">
                  <span className="dsh-arkme-login-code-divider" aria-hidden />
                  <button type="button" className="dsh-arkme-login-code-button" disabled={props.busy || props.smsCountdown > 0} onClick={props.onSendCode}>
                    {props.smsCountdown > 0 ? `${String(props.smsCountdown)}s` : '获取验证码'}
                  </button>
                </span>
              </div>
            </div>
            {props.phoneBindingRequired === true ? <div className="dsh-arkme-login-actions">
              <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onVerifyCode}>
                {props.submitBusy ? '正在绑定…' : '完成绑定'}
              </button>
              <button type="button" className="dsh-arkme-login-cancel" disabled={props.busy} onClick={props.onCancelBinding}>
                取消绑定
              </button>
            </div> : <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onVerifyCode}>
              {props.submitBusy ? '正在登录…' : '登录'}
            </button>}
          </div> : <div role="tabpanel">
            <p className="dsh-arkme-login-test-note">测试环境可使用 user_id 直登，登录后仍会检查手机号绑定状态。</p>
            <div className="dsh-arkme-login-field">
              <label className="dsh-arkme-login-label" htmlFor="dsh-arkme-login-test-user">测试 user_id</label>
              <div className="dsh-arkme-login-input-shell">
                <input
                  id="dsh-arkme-login-test-user"
                  className="dsh-arkme-login-input"
                  value={props.testUserId}
                  onChange={changeTestUserId}
                  onKeyDown={event => { if (event.key === 'Enter') props.onTestLogin() }}
                  inputMode="numeric"
                  maxLength={16}
                  placeholder="请输入测试账号 user_id"
                  aria-label="测试账号 user_id"
                  disabled={props.busy}
                />
              </div>
            </div>
            <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onTestLogin}>
              {props.busy ? '正在登录…' : '测试账号登录'}
            </button>
          </div>}
        </div>

        {props.error !== '' && <div className="dsh-arkme-login-error" role="alert">{props.error}</div>}

        <div className="dsh-arkme-login-agreement">
          <label className="dsh-arkme-login-check-label">
            <input
              type="checkbox"
              className="dsh-arkme-login-check-input"
              checked={props.agreed}
              onChange={event => { props.onAgreementChange(event.target.checked) }}
              aria-label={agreementWarningText}
            />
            <span className="dsh-arkme-login-check" aria-hidden>✓</span>
            <span>我已阅读并同意</span>
          </label>
          <a className="dsh-arkme-login-link" href="https://www.arkme.ai/article/user-aggrement-v1.html" target="_blank" rel="noreferrer">《用户协议》</a>
          <span>、</span>
          <a className="dsh-arkme-login-link" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" target="_blank" rel="noreferrer">《隐私条款》</a>
        </div>
      </div>
    </section></div>
  </div>
}
