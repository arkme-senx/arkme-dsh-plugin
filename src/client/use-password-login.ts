import { useEffect, useRef, useState } from 'react'
import type { ArkmeAuthSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { arkmeLoginErrorMessage } from './arkme-login-errors.js'
import type { ArkmeLoginTranslate } from './arkme-login-locales.js'

export interface ArkmePasswordLoginFields {
  account: string
  password: string
  onAccountChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
}

export function usePasswordLogin(options: {
  active: boolean
  agreed: boolean
  busy: boolean
  t: ArkmeLoginTranslate
  setBusy: (value: boolean) => void
  setSubmitBusy: (value: boolean) => void
  setError: (value: string) => void
  acceptAuthSnapshot: (snapshot: ArkmeAuthSnapshot) => void
}): ArkmePasswordLoginFields {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const request = useRef<AbortController>()
  useEffect(() => {
    if (!options.active) setPassword('')
    return () => { request.current?.abort() }
  }, [options.active])

  const submit = async () => {
    if (!options.active || options.busy || request.current !== undefined) return
    if (account.trim() === '') { options.setError(options.t('error.password.account')); return }
    if (password === '') { options.setError(options.t('error.password.empty')); return }
    if (!options.agreed) { options.setError(options.t('error.agreement.required')); return }
    const controller = new AbortController()
    request.current = controller
    options.setBusy(true); options.setSubmitBusy(true); options.setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.password.login', { account: account.trim(), password }, controller.signal)
      if (controller.signal.aborted) return
      setPassword('')
      options.acceptAuthSnapshot(snapshot)
    } catch (error) {
      if (!controller.signal.aborted) options.setError(arkmeLoginErrorMessage(error, options.t))
    } finally {
      request.current = undefined
      options.setBusy(false); options.setSubmitBusy(false)
    }
  }
  return { account, password, onAccountChange: setAccount, onPasswordChange: setPassword, onSubmit: () => { void submit() } }
}
