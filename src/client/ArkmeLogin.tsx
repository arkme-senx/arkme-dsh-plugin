import type { ChangeEvent } from 'react'
import { ARKME_WORDMARK_DATA_URL } from './arkme-wordmark.js'
import {
  defaultArkmeLoginTranslate, type ArkmeLoginTranslate,
} from './arkme-login-locales.js'

export type ArkmeLoginMode = 'wechat' | 'phone' | 'test'

export interface ArkmeLoginProps {
  t?: ArkmeLoginTranslate
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
    --arkme-login-primary-action: var(--dsw-alias-button-primary-fill, #171923);
    --arkme-login-on-primary-action: var(--dsw-alias-label-primary-inverted, #ffffff);
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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
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
  .dsh-arkme-login-qr-panel { display: flex; flex-direction: column; align-items: flex-start; text-align: left; }
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
  .dsh-arkme-login-qr-refresh {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 0;
    border-radius: inherit;
    padding: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
  }
  .dsh-arkme-login-qr-refresh-overlay {
    position: absolute;
    inset: 4px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: rgba(23, 25, 28, .68);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    transition: opacity .15s ease;
    pointer-events: none;
  }
  .dsh-arkme-login-qr-refresh:hover .dsh-arkme-login-qr-refresh-overlay,
  .dsh-arkme-login-qr-refresh:focus-visible .dsh-arkme-login-qr-refresh-overlay,
  .dsh-arkme-login-qr-refresh:disabled .dsh-arkme-login-qr-refresh-overlay { opacity: 1; }
  .dsh-arkme-login-qr-refresh:focus-visible { outline: 2px solid var(--arkme-login-accent); outline-offset: 2px; }
  .dsh-arkme-login-qr-refresh:disabled { cursor: wait; }
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
    background: var(--arkme-login-base);
  }
  .dsh-arkme-login-page::after {
    content: '';
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: 54%;
    width: 1px;
    background: var(--arkme-login-border);
    pointer-events: none;
  }
  .dsh-arkme-login-glow-top,
  .dsh-arkme-login-glow-bottom { display: none; }
  .dsh-arkme-login-story {
    position: relative;
    z-index: 1;
    min-width: 0;
    padding: 76px 74px 54px 86px;
    display: flex;
    flex-direction: column;
    background: var(--arkme-login-subtle);
  }
  .dsh-arkme-login-wordmark { width: 106px; height: 27px; display: block; object-fit: contain; object-position: left center; }
  body[data-ds-dark-theme] .dsh-arkme-login-wordmark { filter: invert(1) hue-rotate(180deg); }
  .dsh-arkme-login-definition { width: min(540px, 92%); margin: auto 0; transform: translateY(-18px); }
  .dsh-arkme-login-definition h1 { margin: 0; color: var(--arkme-login-text); font-size: 47px; line-height: 1.16; font-weight: 600; letter-spacing: -.045em; }
  .dsh-arkme-login-description { margin: 24px 0 0; color: var(--arkme-login-secondary); font-size: 14px; line-height: 24px; font-weight: 400; }
  .dsh-arkme-login-card {
    position: relative;
    z-index: 3;
    width: 390px;
    max-width: calc(100% - 56px);
    margin: auto;
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
  .dsh-arkme-login-brand > p { margin: 0 0 8px; color: var(--arkme-login-secondary); font-size: 12px; line-height: 17px; }
  .dsh-arkme-login-title { font-size: 30px; line-height: 1.2; font-weight: 600; letter-spacing: -.04em; }
  .dsh-arkme-login-brand > span { margin-top: 9px; display: block; color: var(--arkme-login-secondary); font-size: 13px; line-height: 19px; }
  .dsh-arkme-login-notice { margin-top: 20px; border-color: var(--arkme-login-border); border-radius: 12px; padding: 10px 12px; background: var(--arkme-login-accent-soft); font-size: 12px; line-height: 18px; }
  .dsh-arkme-login-tabs-wrap { justify-content: flex-start; margin-top: 28px; }
  .dsh-arkme-login-tabs { width: 232px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 3px; border-radius: 11px; background: var(--arkme-login-subtle); }
  .dsh-arkme-login-tabs:has(.dsh-arkme-login-tab:nth-child(3)) { width: 330px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dsh-arkme-login-tab { height: 34px; padding: 0 9px; border-radius: 9px; color: var(--arkme-login-secondary); font-size: 12px; font-weight: 400; }
  .dsh-arkme-login-tab:hover { color: var(--arkme-login-text); }
  .dsh-arkme-login-tab[aria-selected='true'] { color: var(--arkme-login-text); font-weight: 500; box-shadow: var(--dsw-shadow-lv1, 0 1px 4px rgba(30,32,38,.1)); }
  .dsh-arkme-login-method { margin-top: 28px; }
  .dsh-arkme-login-qr-panel { min-height: 152px; justify-content: flex-start; }
  .dsh-arkme-login-qr-title { order: 1; margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; }
  .dsh-arkme-login-qr-frame { order: 2; width: 116px; height: 116px; margin-top: 16px; border: 0; border-radius: 0; background: transparent; }
  .dsh-arkme-login-qr-image { width: 108px; height: 108px; }
  .dsh-arkme-login-qr-refresh-overlay { border-radius: 7px; font-size: 11px; }
  .dsh-arkme-login-qr-loading { color: var(--arkme-login-caption); font-size: 11px; }
  .dsh-arkme-login-qr-relogin { border: 0; padding: 7px 10px; background: transparent; color: var(--arkme-login-secondary); font-size: 11px; font-weight: 500; }
  .dsh-arkme-login-qr-frame[data-state='error'] { width: 100%; height: 46px; }
  .dsh-arkme-login-qr-frame[data-state='error'] .dsh-arkme-login-qr-relogin {
    width: 100%;
    height: 46px;
    border-radius: 12px;
    padding: 0 16px;
    background: var(--arkme-login-primary-action);
    color: var(--arkme-login-on-primary-action);
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--dsw-shadow-lv2, 0 7px 18px rgba(25,27,35,.12));
  }
  .dsh-arkme-login-field + .dsh-arkme-login-field { margin-top: 16px; }
  .dsh-arkme-login-label { padding-left: 2px; font-size: 12px; line-height: 18px; font-weight: 500; }
  .dsh-arkme-login-input-shell { height: 46px; margin-top: 8px; border: 0; border-bottom: 1px solid var(--arkme-login-border); border-radius: 0; padding: 0 2px; background: transparent; }
  .dsh-arkme-login-input-shell:focus-within { border-color: var(--arkme-login-accent); box-shadow: none; }
  .dsh-arkme-login-prefix { margin-right: 12px; border-right: 0; padding-right: 0; color: var(--arkme-login-secondary); font-size: 13px; font-weight: 400; }
  .dsh-arkme-login-input { font-size: 14px; line-height: 22px; }
  .dsh-arkme-login-code-action { right: 0; width: 96px; }
  .dsh-arkme-login-code-divider { display: none; }
  .dsh-arkme-login-code-button { padding-left: 8px; color: var(--arkme-login-secondary); font-size: 11px; font-weight: 500; }
  .dsh-arkme-login-test-note { color: var(--arkme-login-secondary); font-size: 11px; line-height: 18px; }
  .dsh-arkme-login-submit { height: 46px; margin-top: 18px; border-radius: 12px; background: var(--arkme-login-primary-action); font-size: 14px; font-weight: 500; box-shadow: var(--dsw-shadow-lv2, 0 7px 18px rgba(25,27,35,.12)); }
  .dsh-arkme-login-phone-panel > .dsh-arkme-login-submit { margin-top: 28px; }
  .dsh-arkme-login-cancel { height: 46px; border-color: var(--arkme-login-border); border-radius: 12px; font-size: 14px; font-weight: 500; }
  .dsh-arkme-login-actions { margin-top: 18px; }
  .dsh-arkme-login-error { margin-top: 12px; border-radius: 10px; padding: 8px 10px; font-size: 11px; line-height: 17px; }
  .dsh-arkme-login-agreement { margin-top: 32px; column-gap: 3px; justify-content: flex-start; color: var(--arkme-login-secondary); font-size: 10px; line-height: 16px; }
  .dsh-arkme-login-check-label { gap: 7px; }
  .dsh-arkme-login-check { border-color: var(--arkme-login-border); border-radius: 5px; }
  .dsh-arkme-login-check-input:checked + .dsh-arkme-login-check { border-color: var(--arkme-login-primary-action); background: var(--arkme-login-primary-action); color: var(--arkme-login-on-primary-action); }
  .dsh-arkme-login-link { color: var(--arkme-login-accent); font-weight: 500; }
  .dsh-arkme-login-page .dsh-arkme-login-tab {
    background: transparent !important;
    color: var(--arkme-login-secondary) !important;
    font-family: inherit !important;
    font-size: 12px !important;
    font-weight: 400 !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-tab[aria-selected='true'] {
    background: var(--arkme-login-surface) !important;
    color: var(--arkme-login-text) !important;
    font-weight: 500 !important;
    box-shadow: var(--dsw-shadow-lv1, 0 1px 4px rgba(30,32,38,.1)) !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-tab:focus {
    outline: none !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-tab:focus-visible {
    box-shadow: 0 0 0 2px var(--arkme-login-accent-soft), var(--dsw-shadow-lv1, 0 1px 4px rgba(30,32,38,.1)) !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-input {
    border: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    color: var(--arkme-login-text) !important;
    font-family: inherit !important;
    font-size: 14px !important;
    font-weight: 400 !important;
    line-height: 22px !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-code-button {
    background: transparent !important;
    color: var(--arkme-login-secondary) !important;
    font-family: inherit !important;
    font-size: 11px !important;
    font-weight: 500 !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-submit,
  .dsh-arkme-login-page .dsh-arkme-login-qr-frame[data-state='error'] .dsh-arkme-login-qr-relogin {
    border: 0 !important;
    background: var(--arkme-login-primary-action) !important;
    color: var(--arkme-login-on-primary-action) !important;
    font-family: inherit !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    box-shadow: var(--dsw-shadow-lv2, 0 7px 18px rgba(25,27,35,.12)) !important;
  }
  .dsh-arkme-login-page .dsh-arkme-login-cancel {
    background: var(--arkme-login-surface) !important;
    color: var(--arkme-login-text) !important;
    font-family: inherit !important;
    font-size: 14px !important;
    font-weight: 500 !important;
  }
  /* DSH owns light/dark/system; keep the approved light palette above intact. */
  body[data-ds-dark-theme] .dsh-arkme-login-page {
    --arkme-login-caption: var(--dsw-alias-label-secondary);
    background: var(--arkme-login-base);
  }
  body[data-ds-dark-theme] .dsh-arkme-login-page::after { background: var(--arkme-login-border); }
  body[data-ds-dark-theme] .dsh-arkme-login-story { background: var(--dsw-alias-bg-layer-1); }
  body[data-ds-dark-theme] .dsh-arkme-login-wordmark { filter: invert(1) hue-rotate(180deg); }
  body[data-ds-dark-theme] .dsh-arkme-login-definition h1 { color: var(--arkme-login-text); }
  body[data-ds-dark-theme] .dsh-arkme-login-description,
  body[data-ds-dark-theme] .dsh-arkme-login-brand > p,
  body[data-ds-dark-theme] .dsh-arkme-login-brand > span,
  body[data-ds-dark-theme] .dsh-arkme-login-qr-loading,
  body[data-ds-dark-theme] .dsh-arkme-login-qr-relogin,
  body[data-ds-dark-theme] .dsh-arkme-login-prefix,
  body[data-ds-dark-theme] .dsh-arkme-login-test-note,
  body[data-ds-dark-theme] .dsh-arkme-login-agreement { color: var(--arkme-login-secondary); }
  body[data-ds-dark-theme] .dsh-arkme-login-notice {
    border-color: var(--arkme-login-border);
    background: var(--arkme-login-subtle);
  }
  body[data-ds-dark-theme] .dsh-arkme-login-tabs { background: var(--arkme-login-subtle); }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-tab { color: var(--arkme-login-secondary) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-tab:hover { color: var(--arkme-login-text) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-tab[aria-selected='true'] {
    background: var(--arkme-login-surface) !important;
    color: var(--arkme-login-text) !important;
    box-shadow: 0 0 0 1px var(--arkme-login-border) !important;
  }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-tab:focus-visible {
    box-shadow: 0 0 0 2px var(--arkme-login-accent) !important;
  }
  /* Keep the QR image and its quiet zone unfiltered and white for scanning. */
  body[data-ds-dark-theme] .dsh-arkme-login-qr-frame:has(.dsh-arkme-login-qr-image) { background: #fff; }
  body[data-ds-dark-theme] .dsh-arkme-login-input-shell { border-color: var(--arkme-login-border); }
  body[data-ds-dark-theme] .dsh-arkme-login-input-shell:focus-within { border-color: var(--arkme-login-accent); }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-input { color: var(--arkme-login-text) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-code-button { color: var(--arkme-login-secondary) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-code-button:hover:not(:disabled) { color: var(--arkme-login-text) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-code-button:disabled { opacity: .6; }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-submit,
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-qr-frame[data-state='error'] .dsh-arkme-login-qr-relogin {
    background: var(--arkme-login-text) !important;
    color: var(--arkme-login-base) !important;
    box-shadow: none !important;
  }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-cancel {
    border-color: var(--arkme-login-border);
    background: var(--arkme-login-surface) !important;
    color: var(--arkme-login-text) !important;
  }
  body[data-ds-dark-theme] .dsh-arkme-login-page .dsh-arkme-login-cancel:hover:not(:disabled) { background: var(--arkme-login-hover) !important; }
  body[data-ds-dark-theme] .dsh-arkme-login-check { border-color: var(--arkme-login-secondary); }
  body[data-ds-dark-theme] .dsh-arkme-login-check-input:checked + .dsh-arkme-login-check {
    border-color: var(--arkme-login-text);
    background: var(--arkme-login-text);
    color: var(--arkme-login-base);
  }
  body[data-ds-dark-theme] .dsh-arkme-login-check-input:focus-visible + .dsh-arkme-login-check {
    outline: 2px solid var(--arkme-login-accent);
    outline-offset: 2px;
  }
  body[data-ds-dark-theme] .dsh-arkme-login-link { color: var(--arkme-login-text); }
  @media (min-width: 640px) {
    .dsh-arkme-login-card { padding: 0; }
  }
  @media (max-width: 920px) {
    .dsh-arkme-login-page { grid-template-columns: 1fr; overflow-y: auto; }
    .dsh-arkme-login-page::after { display: none; }
    .dsh-arkme-login-story { display: none; }
    .dsh-arkme-login-card { margin: 0 auto; padding: 90px 0 48px; }
  }
  @media (max-height: 690px) and (min-width: 921px) {
    .dsh-arkme-login-story { padding-top: 48px; padding-bottom: 36px; }
    .dsh-arkme-login-definition { transform: none; }
    .dsh-arkme-login-definition h1 { font-size: 40px; }
    .dsh-arkme-login-card { max-height: calc(100vh - 48px); overflow-y: auto; padding: 8px 4px; }
  }
`

export function ArkmeLogin(props: ArkmeLoginProps) {
  const t = props.t ?? defaultArkmeLoginTranslate
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
    <section className="dsh-arkme-login-story" aria-label={t('story.aria')}>
      <img className="dsh-arkme-login-wordmark" src={ARKME_WORDMARK_DATA_URL} alt={t('brand.alt')} />
      <div className="dsh-arkme-login-definition">
        <h1>{t('story.title.first')}<br />{t('story.title.second')}</h1>
        <p className="dsh-arkme-login-description">{t('story.description')}</p>
      </div>
    </section>
    <section className="dsh-arkme-login-card" aria-labelledby="dsh-arkme-login-title">
      <div className="dsh-arkme-login-content">
        <div className="dsh-arkme-login-brand">
          <p>{props.phoneBindingRequired === true ? t('account.setup') : t('welcome')}</p>
          <h3 className="dsh-arkme-login-title" id="dsh-arkme-login-title">
            {props.phoneBindingRequired === true ? t('title.binding') : t('title.login')}
          </h3>
          {props.phoneBindingRequired === true && <span>{t('subtitle.binding')}</span>}
        </div>

        {props.phoneBindingRequired === true && <>
          <div className="dsh-arkme-login-notice" role="status">
            {t('binding.notice')}
          </div>
        </>}

        {props.phoneBindingRequired !== true && <div className="dsh-arkme-login-tabs-wrap">
          <div className="dsh-arkme-login-tabs" role="tablist" aria-label={t('tabs.aria')}>
            <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'wechat'} onClick={() => { props.onModeChange('wechat') }}>{t('tab.wechat')}</button>
            <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'phone'} onClick={() => { props.onModeChange('phone') }}>{t('tab.phone')}</button>
            {props.testLoginEnabled && <button type="button" className="dsh-arkme-login-tab" role="tab" aria-selected={props.mode === 'test'} onClick={() => { props.onModeChange('test') }}>{t('tab.test')}</button>}
          </div>
        </div>}

        <div className="dsh-arkme-login-method">
          {effectiveMode === 'wechat' ? <div className="dsh-arkme-login-qr-panel" role="tabpanel">
            <div className="dsh-arkme-login-qr-title">{t('qr.title')}</div>
            <div
              className="dsh-arkme-login-qr-frame"
              data-state={props.qrDataUrl !== '' ? 'ready' : props.error !== '' && !props.busy ? 'error' : 'loading'}
            >
              {props.qrDataUrl === ''
                ? props.error !== '' && !props.busy
                  ? <button type="button" className="dsh-arkme-login-qr-relogin" onClick={props.onWechatLogin}>{t('qr.relogin')}</button>
                  : <span className="dsh-arkme-login-qr-loading">{t('qr.loading')}</span>
                : <button
                    type="button"
                    className="dsh-arkme-login-qr-refresh"
                    aria-label={props.busy ? t('qr.refreshing.aria') : t('qr.refresh.aria')}
                    aria-busy={props.busy}
                    disabled={props.busy}
                    onClick={props.onWechatLogin}
                  >
                    <img className="dsh-arkme-login-qr-image" src={props.qrDataUrl} alt={t('qr.alt')} />
                    <span className="dsh-arkme-login-qr-refresh-overlay" aria-hidden>
                      {props.busy ? t('qr.refreshing') : t('qr.refresh')}
                    </span>
                  </button>}
            </div>
          </div> : effectiveMode === 'phone' ? <div className="dsh-arkme-login-phone-panel" role="tabpanel">
            <div className="dsh-arkme-login-field">
              <label className="dsh-arkme-login-label" htmlFor="dsh-arkme-login-phone">{t('phone.label')}</label>
              <div className="dsh-arkme-login-input-shell">
                <span className="dsh-arkme-login-prefix">+86</span>
                <input
                  id="dsh-arkme-login-phone"
                  className="dsh-arkme-login-input"
                  value={formatLoginPhone(props.phone)}
                  onChange={changePhone}
                  inputMode="numeric"
                  maxLength={13}
                  placeholder={t('phone.placeholder')}
                  aria-label={t('phone.aria')}
                />
              </div>
            </div>
            <div className="dsh-arkme-login-field">
              <label className="dsh-arkme-login-label" htmlFor="dsh-arkme-login-code">{t('code.label')}</label>
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
                  placeholder={t('code.placeholder')}
                  aria-label={t('code.aria')}
                  disabled={props.busy}
                />
                <span className="dsh-arkme-login-code-action">
                  <span className="dsh-arkme-login-code-divider" aria-hidden />
                  <button type="button" className="dsh-arkme-login-code-button" disabled={props.busy || props.smsCountdown > 0} onClick={props.onSendCode}>
                    {props.smsCountdown > 0 ? `${String(props.smsCountdown)}s` : t('code.get')}
                  </button>
                </span>
              </div>
            </div>
            {props.phoneBindingRequired === true ? <div className="dsh-arkme-login-actions">
              <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onVerifyCode}>
                {props.submitBusy ? t('binding.submitting') : t('binding.complete')}
              </button>
              <button type="button" className="dsh-arkme-login-cancel" disabled={props.busy} onClick={props.onCancelBinding}>
                {t('binding.cancel')}
              </button>
            </div> : <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onVerifyCode}>
              {props.submitBusy ? t('login.submitting') : t('login.submit')}
            </button>}
          </div> : <div role="tabpanel">
            <p className="dsh-arkme-login-test-note">{t('test.note')}</p>
            <div className="dsh-arkme-login-field">
              <div className="dsh-arkme-login-input-shell">
                <input
                  id="dsh-arkme-login-test-user"
                  className="dsh-arkme-login-input"
                  value={props.testUserId}
                  onChange={changeTestUserId}
                  onKeyDown={event => { if (event.key === 'Enter') props.onTestLogin() }}
                  inputMode="numeric"
                  maxLength={16}
                  placeholder={t('test.placeholder')}
                  aria-label={t('test.aria')}
                  disabled={props.busy}
                />
              </div>
            </div>
            <button type="button" className="dsh-arkme-login-submit" disabled={props.busy} onClick={props.onTestLogin}>
              {props.busy ? t('login.submitting') : t('test.submit')}
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
              aria-label={t('agreement.warning')}
            />
            <span className="dsh-arkme-login-check" aria-hidden>✓</span>
            <span>{t('agreement.prefix')}</span>
          </label>
          <a className="dsh-arkme-login-link" href="https://www.arkme.ai/article/user-aggrement-v1.html" target="_blank" rel="noreferrer">{t('agreement.user')}</a>
          <span>{t('agreement.separator')}</span>
          <a className="dsh-arkme-login-link" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" target="_blank" rel="noreferrer">{t('agreement.privacy')}</a>
        </div>
      </div>
    </section>
  </div>
}
