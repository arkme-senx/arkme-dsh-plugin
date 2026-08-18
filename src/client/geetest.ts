import type { ArkmeCaptchaResult } from '../types.js'

interface GeetestInstance {
  onReady(callback: () => void): void
  onSuccess(callback: () => void): void
  onError(callback: (error: unknown) => void): void
  onClose?(callback: () => void): void
  getValidate(): ArkmeCaptchaResult | undefined | null
  showCaptcha(): void
  destroy?(): void
}

type InitGeetest = (
  options: {
    captchaId: string
    product: 'bind'
    protocol: 'https://'
    language: 'zho'
    userInfo: string
  },
  ready: (instance: GeetestInstance) => void,
) => void

declare global {
  interface Window {
    initGeetest4?: InitGeetest
  }
}

let scriptPromise: Promise<void> | undefined

function loadGeetestScript(): Promise<void> {
  if (window.initGeetest4 !== undefined) return Promise.resolve()
  if (scriptPromise !== undefined) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dsh-arkme-geetest]')
    if (existing !== null) {
      existing.addEventListener('load', () => { resolve() }, { once: true })
      existing.addEventListener('error', () => { reject(new Error('安全验证组件加载失败')) }, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://static.geetest.com/v4/gt4.js'
    script.async = true
    script.defer = true
    script.dataset.dshArkmeGeetest = 'true'
    script.addEventListener('load', () => { resolve() }, { once: true })
    script.addEventListener('error', () => { reject(new Error('安全验证组件加载失败')) }, { once: true })
    document.head.appendChild(script)
  }).catch(error => {
    scriptPromise = undefined
    throw error
  })
  return scriptPromise
}

export async function verifyPhoneCaptcha(captchaId: string, phone: string): Promise<ArkmeCaptchaResult> {
  if (captchaId.trim() === '') throw new Error('安全验证未配置')
  await loadGeetestScript()
  const init = window.initGeetest4
  if (init === undefined) throw new Error('安全验证组件不可用')
  return await new Promise<ArkmeCaptchaResult>((resolve, reject) => {
    let settled = false
    let instance: GeetestInstance | undefined
    const finish = (result: ArkmeCaptchaResult | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { instance?.destroy?.() } catch { /* best-effort cleanup */ }
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const timeout = setTimeout(() => {
      finish(new Error('安全验证已超时，请重试'))
    }, 5 * 60 * 1000)
    try {
      init({
        captchaId,
        product: 'bind',
        protocol: 'https://',
        language: 'zho',
        userInfo: `86:${phone.replace(/\D/g, '')}`,
      }, value => {
        instance = value
        instance.onReady(() => { instance?.showCaptcha() })
        instance.onSuccess(() => {
          const result = instance?.getValidate()
          if (result === undefined || result === null) {
            finish(new Error('安全验证结果为空，请重试'))
            return
          }
          const normalized = {
            lot_number: String(result.lot_number ?? '').trim(),
            captcha_output: String(result.captcha_output ?? '').trim(),
            pass_token: String(result.pass_token ?? '').trim(),
            gen_time: String(result.gen_time ?? '').trim(),
          }
          if (Object.values(normalized).some(item => item === '')) {
            finish(new Error('安全验证结果不完整，请重试'))
            return
          }
          finish(normalized)
        })
        instance.onError(error => {
          finish(new Error(error instanceof Error ? error.message : '安全验证失败，请重试'))
        })
        instance.onClose?.(() => {
          finish(new Error('已取消安全验证'))
        })
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error('安全验证初始化失败'))
    }
  })
}
