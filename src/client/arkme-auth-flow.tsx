import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import qrcode from 'qrcode-generator'
import type { ArkmeAuthSnapshot, ArkmeUserProfileSnapshot } from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeLogin, type ArkmeLoginMode, type ArkmeLoginProps } from './ArkmeLogin.js'
import { arkmeAuthStore, type ArkmeAuthStoreSnapshot } from './auth-store.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeLoginErrorMessage, arkmeStoredLoginErrorMessage } from './arkme-login-errors.js'
import {
  defaultArkmeLoginTranslate, type ArkmeLoginTranslate,
} from './arkme-login-locales.js'

export type ArkmeAuthView = 'checking' | 'login' | 'content'
export type ArkmePhoneBindingGate = 'unknown' | 'checking' | 'ready' | 'required'

export interface ArkmeAuthFlowOptions {
  initialAuth?: ArkmeAuthSnapshot | undefined
  initialPhoneBindingGate?: ArkmePhoneBindingGate
}

export interface ArkmeAuthFlowController {
  auth: ArkmeAuthSnapshot | undefined
  authView: ArkmeAuthView
  authenticated: boolean
  busy: boolean
  error: string
  loginProps: ArkmeLoginProps
  phoneBindingGate: ArkmePhoneBindingGate
  phoneBindingRequired: boolean
  retry(): void
  storeSnapshot: ArkmeAuthStoreSnapshot
}

const styles: Record<string, CSSProperties> = {
  checking: {
    flex: 1, minHeight: 0, display: 'grid', placeItems: 'center',
    color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 13,
  },
  checkingContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  retry: {
    height: 34, padding: '0 14px', border: '1px solid var(--dsw-alias-border-l2, #e2e5e9)', borderRadius: 8,
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
    cursor: 'pointer', font: 'inherit',
  },
  loginBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
}

export function arkmeAuthView(
  auth: ArkmeAuthSnapshot | undefined,
  phoneBindingGate: ArkmePhoneBindingGate = 'ready',
): ArkmeAuthView {
  if (auth === undefined) return 'checking'
  if (auth.status === 'binding-required') return 'login'
  if (auth.status !== 'authenticated') return 'login'
  if (phoneBindingGate === 'ready') return 'content'
  if (phoneBindingGate === 'required') return 'login'
  return 'checking'
}

export function arkmeProfileHasBoundPhone(snapshot: ArkmeUserProfileSnapshot): boolean {
  return (snapshot.profile?.contact.phoneMasked?.trim() ?? '') !== ''
}

export function arkmeLoginNeedsPhoneBinding(
  auth: ArkmeAuthSnapshot | undefined,
  phoneBindingGate: ArkmePhoneBindingGate,
): boolean {
  return auth?.status === 'binding-required' || phoneBindingGate === 'required'
}

export function arkmeShouldBeginWechat(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
): boolean {
  return authView === 'login'
    && auth !== undefined
    && ['logged-out', 'expired'].includes(auth.status)
    && loginMode === 'wechat'
    && agreed
    && qr === ''
    && !qrRequestStarted
}

export function arkmeShouldBeginQrLogin(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
  jiwoScanLoginEnabled: boolean,
): boolean {
  const supportedQrMode = loginMode === 'wechat'
    || (loginMode === 'jiwo' && jiwoScanLoginEnabled)
  return authView === 'login'
    && auth !== undefined
    && ['logged-out', 'expired'].includes(auth.status)
    && supportedQrMode
    && agreed
    && qr === ''
    && !qrRequestStarted
}

export function arkmeWechatRequestStartedAfterAuthStatus(
  current: boolean,
  status: ArkmeAuthSnapshot['status'] | undefined,
): boolean {
  return status === 'logged-out' || status === 'expired' ? false : current
}

export function ArkmeAuthChecking({
  error,
  busy,
  onRetry,
  t = defaultArkmeLoginTranslate,
  statusText,
}: {
  error: string
  busy: boolean
  onRetry(): void
  t?: ArkmeLoginTranslate
  statusText?: string
}) {
  return <div style={styles.checking}>
    <div style={styles.checkingContent}>
      <span role="status">{error === '' ? statusText ?? t('gate.checking.arkme') : error}</span>
      {error !== '' && <button
        type="button"
        style={styles.retry}
        disabled={busy}
        onClick={onRetry}
      >{busy ? t('gate.retrying') : t('gate.retry')}</button>}
    </div>
  </div>
}

export function ArkmeAuthFlowContent({ flow }: { flow: ArkmeAuthFlowController }) {
  if (flow.authView === 'checking') {
    return <ArkmeAuthChecking
      error={flow.error}
      busy={flow.busy}
      onRetry={flow.retry}
      t={flow.loginProps.t ?? defaultArkmeLoginTranslate}
    />
  }
  if (flow.authView === 'login') {
    return <div style={styles.loginBody}><ArkmeLogin {...flow.loginProps} /></div>
  }
  return null
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(content)
  qr.make()
  return qr.createDataURL(6, 12)
}

function initialPhoneBindingGate(auth: ArkmeAuthSnapshot | undefined): ArkmePhoneBindingGate {
  return auth?.status === 'binding-required' ? 'required' : 'unknown'
}

export function useArkmeAuthFlow(
  options: ArkmeAuthFlowOptions = {},
  t: ArkmeLoginTranslate = defaultArkmeLoginTranslate,
): ArkmeAuthFlowController {
  const { initialAuth, initialPhoneBindingGate: initialGate } = options
  const storeSnapshot = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  )
  const auth = storeSnapshot.auth ?? initialAuth
  const [busy, setBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [error, setError] = useState(initialAuth?.status === 'binding-required' ? t('error.binding.required') : '')
  const [agreed, setAgreed] = useState(true)
  const [loginMode, setLoginMode] = useState<ArkmeLoginMode>(initialAuth?.status === 'binding-required' ? 'phone' : 'jiwo')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [testLoginEnabled, setTestLoginEnabled] = useState(false)
  const [jiwoScanLoginEnabled, setJiwoScanLoginEnabled] = useState(false)
  const [testUserId, setTestUserId] = useState('')
  const [qr, setQr] = useState('')
  const [phoneBindingGate, setPhoneBindingGate] = useState<ArkmePhoneBindingGate>(
    initialGate ?? initialPhoneBindingGate(initialAuth),
  )
  const [phoneCheckRevision, setPhoneCheckRevision] = useState(0)
  const qrRequestStartedRef = useRef(false)
  const checkedUserIdRef = useRef<number | undefined>()
  const bindingNotifiedUserIdRef = useRef<number | undefined>()
  const ignoreStaleBindingAuthRef = useRef(false)
  const qrFlowRevisionRef = useRef(0)
  const currentJiwoAttemptRef = useRef<string>()
  const pendingLoginModeSelectionRef = useRef<ArkmeLoginMode>()

  const authenticated = auth?.status === 'authenticated' && phoneBindingGate === 'ready'
  const authView = arkmeAuthView(auth, phoneBindingGate)
  const phoneBindingRequired = arkmeLoginNeedsPhoneBinding(auth, phoneBindingGate)
  const localeId = t('locale.id')
  const localeIdRef = useRef(localeId)

  useEffect(() => {
    if (localeIdRef.current === localeId) return
    localeIdRef.current = localeId
    if (authView === 'login') setError('')
  }, [authView, localeId])

  const acceptAuthSnapshot = useCallback((snapshot: ArkmeAuthSnapshot, acceptOptions: { forcePhoneCheck?: boolean } = {}) => {
    const previous = arkmeAuthStore.getSnapshot().auth
    const accountChanged = snapshot.status === 'authenticated'
      && (previous?.status !== 'authenticated' || previous.userId !== snapshot.userId || previous.environment !== snapshot.environment)
    arkmeAuthStore.setAuth(snapshot)
    if (snapshot.status === 'binding-required') {
      checkedUserIdRef.current = snapshot.userId
      setPhoneBindingGate('required')
      setLoginMode('phone')
      setAgreed(true)
      setQr('')
      setSmsCode('')
      setError(t('error.binding.required'))
      if (bindingNotifiedUserIdRef.current !== snapshot.userId) {
        bindingNotifiedUserIdRef.current = snapshot.userId
        arkmeUi.authChanged(false)
      }
      return
    }
    bindingNotifiedUserIdRef.current = undefined
    if (accountChanged) arkmeUi.authChanged(true, true)
    if (acceptOptions.forcePhoneCheck === true || snapshot.status !== 'authenticated'
      || checkedUserIdRef.current !== snapshot.userId) {
      checkedUserIdRef.current = snapshot.status === 'authenticated' ? snapshot.userId : undefined
      bindingNotifiedUserIdRef.current = undefined
      setPhoneBindingGate('unknown')
      if (snapshot.status === 'authenticated') setPhoneCheckRevision(value => value + 1)
    }
  }, [t])

  useEffect(() => {
    if (initialAuth === undefined) return
    if (ignoreStaleBindingAuthRef.current && initialAuth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && initialAuth.status === 'logged-out') return
    acceptAuthSnapshot(initialAuth)
  }, [acceptAuthSnapshot, auth?.status, initialAuth])

  useEffect(() => {
    if (storeSnapshot.auth === undefined) return
    if (ignoreStaleBindingAuthRef.current && storeSnapshot.auth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && storeSnapshot.auth.status === 'logged-out') return
    acceptAuthSnapshot(storeSnapshot.auth)
  }, [acceptAuthSnapshot, auth?.status, storeSnapshot.auth])

  useEffect(() => {
    if (storeSnapshot.config === undefined) return
    setCaptchaId(storeSnapshot.config.captchaId)
    setTestLoginEnabled(storeSnapshot.config.testLoginEnabled)
    setJiwoScanLoginEnabled(storeSnapshot.config.jiwoScanLoginEnabled)
    if (!phoneBindingRequired && (auth?.status === 'logged-out' || auth?.status === 'expired')) {
      const selectedMode = pendingLoginModeSelectionRef.current
      pendingLoginModeSelectionRef.current = undefined
      setLoginMode(selectedMode ?? (storeSnapshot.config.jiwoScanLoginEnabled
        ? 'jiwo'
        : storeSnapshot.config.testLoginEnabled ? 'test' : 'wechat'))
    }
  }, [auth?.status, phoneBindingRequired, storeSnapshot.config])

  useEffect(() => {
    if (storeSnapshot.error !== '' && authView === 'login') {
      setError(arkmeStoredLoginErrorMessage(storeSnapshot.error, t))
    }
  }, [authView, storeSnapshot.error, t])

  const refreshAuth = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const snapshot = await arkmeAuthStore.refresh()
      const config = arkmeAuthStore.getSnapshot().config
      acceptAuthSnapshot(snapshot)
      if (config !== undefined) {
        setCaptchaId(config.captchaId)
        setTestLoginEnabled(config.testLoginEnabled)
        setJiwoScanLoginEnabled(config.jiwoScanLoginEnabled)
      }
      if (!['authenticated', 'binding-required'].includes(snapshot.status)) {
        setLoginMode(config?.jiwoScanLoginEnabled === true
          ? 'jiwo'
          : config?.testLoginEnabled === true ? 'test' : 'wechat')
      }
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }, [acceptAuthSnapshot, t])

  useEffect(() => { void refreshAuth() }, [refreshAuth])

  useEffect(() => {
    if (auth?.status !== 'authenticated') {
      if (auth?.status !== 'binding-required') {
        if (phoneBindingGate !== 'unknown') setPhoneBindingGate('unknown')
        checkedUserIdRef.current = undefined
      }
      return
    }
    let active = true
    const userId = auth.userId
    setPhoneBindingGate('checking')
    setBusy(true)
    setError('')
    void callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
      .then(snapshot => {
        if (!active) return
        checkedUserIdRef.current = userId
        if (arkmeProfileHasBoundPhone(snapshot)) {
          setPhoneBindingGate('ready')
          return
        }
        setPhoneBindingGate('required')
        setLoginMode('phone')
        setAgreed(true)
        setQr('')
        setSmsCode('')
        setError(t('error.binding.required'))
      })
      .catch(caught => {
        if (!active) return
        checkedUserIdRef.current = userId
        if (caught instanceof ArkmeClientError && ['login-expired', 'login-required'].includes(caught.body.code)) {
          arkmeAuthStore.setAuth({ status: 'expired', environment: auth.environment })
          setPhoneBindingGate('unknown')
          setLoginMode(jiwoScanLoginEnabled ? 'jiwo' : testLoginEnabled ? 'test' : 'wechat')
          setQr('')
          setSmsCode('')
          setError(arkmeLoginErrorMessage(caught, t))
          arkmeUi.authChanged(false)
          return
        }
        setPhoneBindingGate('unknown')
        setError(arkmeLoginErrorMessage(caught, t))
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [auth?.environment, auth?.status, auth?.userId, jiwoScanLoginEnabled, phoneCheckRevision, t, testLoginEnabled])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  useEffect(() => {
    if (!['jiwo', 'wechat'].includes(loginMode) || !agreed || auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const flowRevision = qrFlowRevisionRef.current
    const operation = loginMode === 'jiwo' ? 'auth.app.poll' : 'auth.poll'
    const poll = async () => {
      try {
        const snapshot = await callArkme<ArkmeAuthSnapshot>(operation, { attemptId: auth.attemptId })
        if (stopped || flowRevision !== qrFlowRevisionRef.current) return
        acceptAuthSnapshot(snapshot)
        if (snapshot.status === 'authenticated' || snapshot.status === 'expired') {
          if (loginMode === 'jiwo') currentJiwoAttemptRef.current = undefined
          setQr('')
          return
        }
      } catch (caught) {
        if (!stopped) setError(arkmeLoginErrorMessage(caught, t))
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 1200)
    return () => { stopped = true; clearTimeout(timer) }
  }, [acceptAuthSnapshot, agreed, auth?.attemptId, auth?.status, loginMode, t])

  const beginQrLogin = useCallback(async (mode: 'jiwo' | 'wechat') => {
    if (!agreed) {
      setError(t('error.agreement.required'))
      return
    }
    setBusy(true)
    setError('')
    const flowRevision = ++qrFlowRevisionRef.current
    try {
      const operation = mode === 'jiwo' ? 'auth.app.begin' : 'auth.begin'
      const snapshot = await callArkme<ArkmeAuthSnapshot>(operation)
      if (flowRevision !== qrFlowRevisionRef.current) {
        if (mode === 'jiwo' && snapshot.attemptId !== undefined) {
          void callArkme('auth.app.cancel', { attemptId: snapshot.attemptId }).catch(() => undefined)
        }
        return
      }
      acceptAuthSnapshot(snapshot)
      currentJiwoAttemptRef.current = mode === 'jiwo' ? snapshot.attemptId : undefined
      setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent))
    } catch (caught) {
      if (flowRevision === qrFlowRevisionRef.current) setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      if (flowRevision === qrFlowRevisionRef.current) setBusy(false)
    }
  }, [acceptAuthSnapshot, agreed, t])

  const beginWechat = useCallback(async () => {
    await beginQrLogin('wechat')
  }, [beginQrLogin])

  const beginJiwo = useCallback(async () => {
    await beginQrLogin('jiwo')
  }, [beginQrLogin])

  useEffect(() => {
    qrRequestStartedRef.current = arkmeWechatRequestStartedAfterAuthStatus(
      qrRequestStartedRef.current,
      auth?.status,
    )
  }, [auth?.status])

  useEffect(() => {
    if (!arkmeShouldBeginQrLogin(
      auth,
      authView,
      loginMode,
      agreed,
      qr,
      qrRequestStartedRef.current,
      jiwoScanLoginEnabled,
    )) return
    qrRequestStartedRef.current = true
    void (loginMode === 'jiwo' ? beginJiwo() : beginWechat())
  }, [agreed, auth, authView, beginJiwo, beginWechat, jiwoScanLoginEnabled, loginMode, qr])

  useEffect(() => () => {
    qrFlowRevisionRef.current += 1
    const attemptId = currentJiwoAttemptRef.current
    currentJiwoAttemptRef.current = undefined
    if (attemptId !== undefined) {
      void callArkme('auth.app.cancel', { attemptId }).catch(() => undefined)
    }
  }, [])

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(t('error.phone.eleven'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const captcha = await verifyPhoneCaptcha(captchaId, phone)
      await callArkme('auth.phone.send', { phone, captcha })
      setSmsCountdown(60)
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
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
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      acceptAuthSnapshot(snapshot, { forcePhoneCheck: true })
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setSubmitBusy(false)
      setBusy(false)
    }
  }

  const testLogin = async () => {
    const userId = Number(testUserId)
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      setError(t('error.test.invalid'))
      return
    }
    if (!agreed) {
      setError(t('error.agreement.required'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.test.login', { userId })
      acceptAuthSnapshot(snapshot, { forcePhoneCheck: true })
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  const cancelBinding = async () => {
    setBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      ignoreStaleBindingAuthRef.current = true
      arkmeAuthStore.setAuth(snapshot)
      checkedUserIdRef.current = undefined
      setPhoneBindingGate('unknown')
      setPhoneCheckRevision(value => value + 1)
      setPhone('')
      setSmsCode('')
      setQr('')
      setSubmitBusy(false)
      qrRequestStartedRef.current = false
      setLoginMode(jiwoScanLoginEnabled ? 'jiwo' : testLoginEnabled ? 'test' : 'wechat')
      arkmeUi.authChanged(false)
    } catch (caught) {
      setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  const changeLoginMode = (mode: ArkmeLoginMode) => {
    const previousJiwoAttempt = currentJiwoAttemptRef.current
    qrFlowRevisionRef.current += 1
    currentJiwoAttemptRef.current = undefined
    if (previousJiwoAttempt !== undefined) {
      void callArkme('auth.app.cancel', { attemptId: previousJiwoAttempt }).catch(() => undefined)
    }
    if (auth?.status === 'pending') {
      pendingLoginModeSelectionRef.current = mode
      arkmeAuthStore.setAuth({ status: 'logged-out', environment: auth.environment })
    }
    setLoginMode(mode)
    setQr('')
    setError('')
    setBusy(false)
    qrRequestStartedRef.current = false
  }

  const retry = useCallback(() => {
    if (auth?.status === 'authenticated') {
      setPhoneCheckRevision(value => value + 1)
      return
    }
    void refreshAuth()
  }, [auth?.status, refreshAuth])

  return {
    auth,
    authView,
    authenticated,
    busy,
    error,
    loginProps: {
      t,
      mode: loginMode,
      phoneBindingRequired,
      agreed,
      busy,
      submitBusy,
      error,
      phone,
      smsCode,
      smsCountdown,
      testLoginEnabled,
      jiwoScanLoginEnabled,
      testUserId,
      qrDataUrl: qr,
      onModeChange: changeLoginMode,
      onAgreementChange: setAgreed,
      onPhoneChange: setPhone,
      onSmsCodeChange: setSmsCode,
      onTestUserIdChange: setTestUserId,
      onSendCode: () => { void sendCode() },
      onVerifyCode: () => { void verifyCode() },
      onTestLogin: () => { void testLogin() },
      onWechatLogin: () => { void beginWechat() },
      onJiwoLogin: () => { void beginJiwo() },
      onCancelBinding: () => { void cancelBinding() },
    },
    phoneBindingGate,
    phoneBindingRequired,
    retry,
    storeSnapshot,
  }
}
