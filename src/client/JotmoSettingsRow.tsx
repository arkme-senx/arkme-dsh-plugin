import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { callJotmo } from './api.js'
import { jotmoUi } from './ui-controller.js'
import type { JotmoAuthSnapshot } from '../types.js'

export type JotmoSettingsRowProps = PropsRuntime<'settings.general.item'>

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 20, minHeight: 58,
    padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, #eceef1)',
  },
  text: { flex: 1, minWidth: 0 },
  title: { color: 'var(--dsw-alias-label-primary, #17191c)', fontSize: 14, fontWeight: 500 },
  desc: { marginTop: 3, color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 12, lineHeight: '18px' },
  button: {
    flex: 'none', border: '1px solid var(--dsw-alias-border-l2, #e2e5e9)', borderRadius: 9,
    padding: '7px 12px', background: 'var(--dsw-alias-bg-base, #fff)',
    color: 'var(--dsw-alias-state-error-primary, #c2413b)', cursor: 'pointer', fontSize: 13,
  },
}

export function JotmoSettingsRow(_props: JotmoSettingsRowProps) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void callJotmo<JotmoAuthSnapshot>('auth.status').then(snapshot => {
      if (!cancelled) setAuth(snapshot)
    }).catch(caught => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { cancelled = true }
  }, [ui.authRevision])

  const authenticated = auth?.status === 'authenticated'
  const description = error !== ''
    ? error
    : auth === undefined
      ? '正在读取即我登录状态…'
      : authenticated
        ? `已登录测试环境 · 用户 ${String(auth.userId)}`
        : '当前未登录即我；首次打开“默认分类”时会进入登录引导。'

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.logout')
      setAuth(snapshot)
      jotmoUi.authChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <div style={styles.title}>即我账号</div>
        <div style={styles.desc} role={error === '' ? undefined : 'alert'}>{description}</div>
      </div>
      {authenticated && (
        <button type="button" style={styles.button} disabled={busy} onClick={() => { void logout() }}>
          {busy ? '正在退出…' : '退出登录'}
        </button>
      )}
    </div>
  )
}
