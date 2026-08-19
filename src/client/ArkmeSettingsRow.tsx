import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'
import type { ArkmeAuthSnapshot } from '../types.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'

export type ArkmeSettingsRowProps = PropsRuntime<'settings.general.item'>

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

export function arkmeSettingsTitle(installedVersion: string | undefined): string {
  return `Arkme v${installedVersion?.trim() || '…'}`
}

export function ArkmeSettingsRow(_props: ArkmeSettingsRowProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const auth = authState.auth

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
  }, [ui.authRevision])

  const authenticated = auth?.status === 'authenticated'
  const bindingRequired = auth?.status === 'binding-required'
  const description = error !== ''
    ? error
    : !authState.checked || auth === undefined
      ? '正在读取 Arkme 登录状态…'
      : authenticated
        ? '已登录'
        : bindingRequired
          ? '当前 Arkme 账号待绑定手机号，完成绑定后才会登录成功。'
          : '当前未登录 Arkme；首次打开“默认分类”时会进入登录引导。'
  const update = updateState.status

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      arkmeAuthStore.setAuth(snapshot)
      clearLastNavigationCache()
      arkmeUi.authChanged(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <div style={styles.title}>{arkmeSettingsTitle(update?.installedVersion)}</div>
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
