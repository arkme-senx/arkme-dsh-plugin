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
    position: relative;
    isolation: isolate;
    min-height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: #17221b;
    background: radial-gradient(ellipse at center, rgba(255,255,252,.99) 0%, rgba(253,255,253,.98) 40%, rgba(248,253,250,.98) 76%, rgba(240,251,244,1) 100%);
  }
  .dsh-arkme-login-glow-top {
    position: absolute;
    left: calc(50% - 520px);
    top: -220px;
    z-index: -1;
    width: 560px;
    height: 560px;
    border-radius: 50%;
    background: #fff;
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
    background: #e8faee;
    opacity: .32;
    filter: blur(116px);
    pointer-events: none;
  }
  .dsh-arkme-login-card {
    position: relative;
    z-index: 1;
    width: min(430px, 100%);
    overflow: hidden;
    border: 1px solid #dde6de;
    border-radius: 32px;
    padding: 32px 24px;
    background: rgba(255,255,255,.95);
    box-shadow: 0 28px 80px rgba(9,184,62,.08);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .dsh-arkme-login-content { position: relative; z-index: 1; }
  .dsh-arkme-login-brand { display: flex; align-items: center; gap: 12px; }
  .dsh-arkme-login-title {
    margin: 0;
    color: #17221b;
    font-size: 30px;
    font-weight: 600;
    line-height: 36px;
    letter-spacing: 0;
  }
  .dsh-arkme-login-notice {
    margin-top: 20px;
    border: 1px solid #d7eadc;
    border-radius: 14px;
    padding: 10px 12px;
    background: #f2fbf5;
    color: #2f5f3d;
    font-size: 14px;
    line-height: 21px;
  }
  .dsh-arkme-login-tabs-wrap { display: flex; justify-content: center; margin-top: 32px; }
  .dsh-arkme-login-tabs {
    display: inline-flex;
    padding: 4px;
    border-radius: 999px;
    background: #eff8f2;
  }
  .dsh-arkme-login-tab {
    height: 40px;
    min-width: 0;
    border: 0;
    border-radius: 999px;
    padding: 0 20px;
    background: transparent;
    color: #69756d;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    transition: color .15s ease, background .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-tab:hover { color: #09b83e; }
  .dsh-arkme-login-tab[aria-selected='true'] {
    background: #fff;
    color: #17221b;
    font-weight: 600;
    box-shadow: 0 8px 20px rgba(9,184,62,.14);
  }
  .dsh-arkme-login-method { margin-top: 28px; }
  .dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .dsh-arkme-login-qr-title { color: #17221b; font-size: 18px; font-weight: 600; line-height: 26px; }
  .dsh-arkme-login-qr-frame {
    width: 224px;
    height: 224px;
    margin-top: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid #dde5de;
    border-radius: 18px;
    background: #fafbf9;
  }
  .dsh-arkme-login-qr-image { width: 200px; height: 200px; display: block; object-fit: contain; }
  .dsh-arkme-login-qr-loading { color: #6f7d73; font-size: 14px; line-height: 20px; }
  .dsh-arkme-login-qr-relogin {
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    background: #17221b;
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
  }
  .dsh-arkme-login-field + .dsh-arkme-login-field { margin-top: 20px; }
  .dsh-arkme-login-label { display: block; color: #2f3d34; font-size: 14px; font-weight: 600; line-height: 20px; }
  .dsh-arkme-login-input-shell {
    position: relative;
    width: 100%;
    height: 48px;
    min-width: 0;
    margin-top: 8px;
    display: flex;
    align-items: center;
    border: 1px solid #dde5de;
    border-radius: 14px;
    padding: 0 12px;
    background: #fafbf9;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-input-shell:focus-within {
    border-color: #09b83e;
    box-shadow: 0 0 0 2px #dff7e7;
  }
  .dsh-arkme-login-prefix {
    flex: none;
    margin-right: 12px;
    border-right: 1px solid #dde5de;
    padding-right: 12px;
    color: #69756d;
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
    color: #17221b;
    font: inherit;
    font-size: 16px;
    line-height: 24px;
  }
  .dsh-arkme-login-input::placeholder { color: #9aae9f; opacity: 1; }
  .dsh-arkme-login-code-input { padding-right: 100px; }
  .dsh-arkme-login-test-note {
    margin: 0 0 14px;
    color: #617068;
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
  .dsh-arkme-login-code-divider { width: 1px; height: 24px; flex: none; background: #dde5de; }
  .dsh-arkme-login-code-button {
    height: 32px;
    min-width: 0;
    flex: 1;
    border: 0;
    border-radius: 10px;
    padding: 0;
    background: transparent;
    color: #68766d;
    cursor: pointer;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
  }
  .dsh-arkme-login-code-button:hover:not(:disabled) { color: #4f5a50; }
  .dsh-arkme-login-code-button:disabled { color: #a7b3aa; cursor: default; }
  .dsh-arkme-login-submit {
    width: 100%;
    height: 48px;
    margin-top: 24px;
    border: 0;
    border-radius: 14px;
    background: #17221b;
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
    box-shadow: 0 12px 24px rgba(23,34,27,.18);
  }
  .dsh-arkme-login-submit:hover:not(:disabled) { background: #253129; }
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
    border: 1px solid #d3ded6;
    border-radius: 14px;
    background: #fff;
    color: #334239;
    cursor: pointer;
    font: inherit;
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
  }
  .dsh-arkme-login-cancel:hover:not(:disabled) { background: #f6faf7; border-color: #bacbc0; }
  .dsh-arkme-login-cancel:disabled { cursor: default; opacity: .62; }
  .dsh-arkme-login-error {
    margin-top: 16px;
    border-radius: 12px;
    padding: 8px 12px;
    background: #fff3f0;
    color: #b0442e;
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
    color: #68766d;
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
    border: 1px solid #c8d5cb;
    border-radius: 4px;
    background: #fff;
    color: transparent;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease;
  }
  .dsh-arkme-login-check-input:checked + .dsh-arkme-login-check { border-color: #09b83e; background: #09b83e; color: #fff; }
  .dsh-arkme-login-check-input:focus-visible + .dsh-arkme-login-check { box-shadow: 0 0 0 2px #dff7e7; }
  .dsh-arkme-login-link { color: #09b83e; font-weight: 600; text-decoration: none; }
  .dsh-arkme-login-link:hover { color: #079b35; }
  @media (min-width: 640px) {
    .dsh-arkme-login-card { padding: 36px 32px; }
  }
  @media (max-height: 720px) {
    .dsh-arkme-login-page { align-items: flex-start; padding-top: 28px; padding-bottom: 28px; }
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
    <section className="dsh-arkme-login-card" aria-labelledby="dsh-arkme-login-title">
      <div className="dsh-arkme-login-content">
        <div className="dsh-arkme-login-brand">
          <ArkmeMark size={56} />
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
    </section>
  </div>
}
