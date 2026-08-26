import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ArkmeAuthSnapshot, ArkmePhoneBindingConflict, ArkmePhoneBindingConflictAction,
  ArkmePhoneVerificationResult,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { arkmeLoginErrorMessage } from './arkme-login-errors.js'
import type { ArkmeLoginTranslate } from './arkme-login-locales.js'

export interface ArkmePhoneBindingFlowOptions {
  accountScopeUserId?: number
  agreed: boolean
  captchaId: string
  phoneBindingRequired: boolean
  t: ArkmeLoginTranslate
  setBusy(value: boolean): void
  setSubmitBusy(value: boolean): void
  setError(value: string): void
  acceptAuthSnapshot(snapshot: ArkmeAuthSnapshot): void
}

/**
 * Shared phone sub-flow for both the startup gate and the legacy embedded surface.
 * Account-conflict semantics live here once; ArkmeLogin remains presentational.
 */
export function useArkmePhoneBindingFlow(options: ArkmePhoneBindingFlowOptions) {
  const {
    accountScopeUserId, agreed, captchaId, phoneBindingRequired, t,
    setBusy, setSubmitBusy, setError, acceptAuthSnapshot,
  } = options
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [phoneConflict, setPhoneConflict] = useState<ArkmePhoneBindingConflict>()
  const [phoneConflictAction, setPhoneConflictAction] = useState<ArkmePhoneBindingConflictAction>()
  const accountScopeRef = useRef(accountScopeUserId)

  useEffect(() => {
    if (accountScopeRef.current === accountScopeUserId) return
    accountScopeRef.current = accountScopeUserId
    setPhone('')
    setSmsCode('')
    setSmsCountdown(0)
    setPhoneConflict(undefined)
    setPhoneConflictAction(undefined)
  }, [accountScopeUserId])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  useEffect(() => {
    if (phoneConflict === undefined) return
    const delay = Math.max(0, phoneConflict.expiresAtMillis - Date.now())
    const timer = setTimeout(() => {
      setPhoneConflict(undefined)
      setPhoneConflictAction(undefined)
      setSmsCode('')
      setError(t('error.conflict.expired'))
    }, delay)
    return () => { clearTimeout(timer) }
  }, [phoneConflict, setError, t])

  const sendCode = useCallback(async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(t('error.phone.eleven'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const captcha = await verifyPhoneCaptcha(captchaId, phone)
      await callArkme('auth.phone.send', {
        phone,
        captcha,
        ...(phoneBindingRequired ? { resolveConflict: true } : {}),
      })
      setSmsCountdown(60)
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }, [captchaId, phone, phoneBindingRequired, setBusy, setError, t])

  const verifyCode = useCallback(async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(t('error.phone.invalid'))
      return
    }
    if (!/^\d{6}$/.test(smsCode)) {
      setError(t('error.code.invalid'))
      return
    }
    if (!agreed) {
      setError(t('error.agreement.required'))
      return
    }
    setBusy(true)
    setSubmitBusy(true)
    setError('')
    try {
      const result = await callArkme<ArkmePhoneVerificationResult>('auth.phone.verify', {
        phone,
        code: smsCode,
        ...(phoneBindingRequired ? { resolveConflict: true } : {}),
      })
      if (result.status === 'phone-binding-conflict') {
        setPhoneConflict(result)
        setPhoneConflictAction(undefined)
        return
      }
      setPhoneConflict(undefined)
      acceptAuthSnapshot(result)
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setSubmitBusy(false)
      setBusy(false)
    }
  }, [acceptAuthSnapshot, agreed, phone, phoneBindingRequired, setBusy, setError, setSubmitBusy, smsCode, t])

  const resolvePhoneConflict = useCallback(async (action: ArkmePhoneBindingConflictAction) => {
    if (phoneConflict === undefined) return
    setBusy(true)
    setSubmitBusy(true)
    setError('')
    setPhoneConflictAction(action)
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.phone.resolve', {
        conflictRef: phoneConflict.conflictRef,
        action,
      })
      setPhoneConflict(undefined)
      setPhoneConflictAction(undefined)
      setSmsCode('')
      acceptAuthSnapshot(snapshot)
    } catch (caught) {
      if (caught instanceof ArkmeClientError && [
        'phone-binding-conflict-expired',
        'phone-binding-conflict-changed',
      ].includes(caught.body.code)) {
        setPhoneConflict(undefined)
        setSmsCode('')
        setSmsCountdown(0)
      }
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setSubmitBusy(false)
      setBusy(false)
      setPhoneConflictAction(undefined)
    }
  }, [acceptAuthSnapshot, phoneConflict, setBusy, setError, setSubmitBusy, t])

  const changeConflictPhone = useCallback(() => {
    setPhone('')
    setPhoneConflict(undefined)
    setPhoneConflictAction(undefined)
    setSmsCode('')
    setSmsCountdown(0)
    setError('')
  }, [setError])

  const reset = useCallback(() => {
    setPhone('')
    setSmsCode('')
    setSmsCountdown(0)
    setPhoneConflict(undefined)
    setPhoneConflictAction(undefined)
  }, [])

  return {
    phone,
    setPhone,
    smsCode,
    setSmsCode,
    smsCountdown,
    phoneConflict,
    phoneConflictAction,
    sendCode,
    verifyCode,
    resolvePhoneConflict,
    changeConflictPhone,
    reset,
  }
}
