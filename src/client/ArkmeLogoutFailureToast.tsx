import { useEffect, useState } from 'react'
import { Toast, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArkmeLogoutFeedback } from '../types.js'
import { callArkme } from './api.js'

const shownKey = 'arkme:logout-failure-shown'

/** Mounted outside settings so account-scope navigation cannot discard feedback. */
export function ArkmeLogoutFailureToast() {
  const [notice, setNotice] = useState<{ id: string; message: string }>()
  useEffect(() => {
    let disposed = false
    let shown: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    const show = (id: string, message: string) => {
      if (disposed || shown === id) return
      try { if (window.sessionStorage.getItem(shownKey) === id) return } catch { /* storage can be disabled */ }
      shown = id
      setNotice({ id, message })
      try { window.sessionStorage.setItem(shownKey, id) } catch { /* in-memory deduplication still works */ }
    }
    const refresh = async (fallback?: string) => {
      if (timer !== undefined) clearTimeout(timer)
      try {
        const feedback = await callArkme<ArkmeLogoutFeedback>('auth.logout.feedback', undefined, abort.signal)
        if (disposed) return
        if (feedback.status === 'pending') {
          timer = setTimeout(() => { void refresh(fallback) }, 500)
        } else if (feedback.status === 'failed' && feedback.id && feedback.message) {
          show(feedback.id, feedback.message)
        } else if (fallback) show(`transport:${Date.now()}`, `退出登录失败：${fallback}`)
      } catch {
        if (fallback) show(`transport:${Date.now()}`, `退出登录失败：${fallback}`)
      }
    }
    const failed = (event: Event) => { void refresh((event as CustomEvent<string>).detail) }
    window.addEventListener('arkme:logout-failed', failed)
    void refresh()
    return () => {
      disposed = true
      abort.abort()
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('arkme:logout-failed', failed)
    }
  }, [])
  return notice === undefined ? null : <Toast key={notice.id} text={notice.message}
    anchor={document.body} icon={<IconWarningOutline16 />} onDone={() => { setNotice(undefined) }} />
}
