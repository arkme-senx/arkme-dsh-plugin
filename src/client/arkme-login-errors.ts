import { ArkmeClientError } from './api.js'
import type { ArkmeLoginLocaleKey, ArkmeLoginTranslate } from './arkme-login-locales.js'

const errorKeys: Readonly<Record<string, ArkmeLoginLocaleKey>> = {
  'wechat-qr-unavailable': 'error.wechat.unavailable',
  'login-attempt-not-found': 'error.qr.expired',
  'test-login-disabled': 'error.test.disabled',
  'test-user-id-invalid': 'error.test.invalid',
  'phone-already-bound': 'error.phone.bound',
  'phone-code-invalid': 'error.code.invalid',
  'phone-code-rejected': 'error.phone.code',
  'phone-invalid': 'error.phone.invalid',
  'captcha-required': 'error.captcha.required',
  'login-expired': 'error.login.required',
  'login-required': 'error.login.required',
}

/** Keep Host diagnostics out of the opposite-language UI while retaining stable code semantics. */
export function arkmeLoginErrorMessage(error: unknown, t: ArkmeLoginTranslate): string {
  if (error instanceof ArkmeClientError) {
    const key = errorKeys[error.body.code]
    if (key !== undefined) return t(key)
  }
  return t('error.generic')
}

/** Store refresh currently retains only its raw diagnostic, so present a language-safe fallback. */
export function arkmeStoredLoginErrorMessage(error: string, t: ArkmeLoginTranslate): string {
  return error === '' ? '' : t('error.generic')
}
