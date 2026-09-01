import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ArkmeLogin } from './ArkmeLogin.js'
import { useArkmeAuthFlow } from './arkme-auth-flow.js'
import { startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import { arkmeAuthStore } from './auth-store.js'
import { ARKME_LOGIN_LOCALE_NAMESPACE } from './arkme-login-locales.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10_000, minWidth: 0, minHeight: 0,
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
  },
  close: {
    position: 'absolute', zIndex: 5, top: 20, right: 20, width: 36, height: 36, padding: 0,
    border: 0, borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f3f4f8)',
    color: 'var(--dsw-alias-label-secondary, #68707c)', cursor: 'pointer', fontSize: 26, lineHeight: 1,
  },
}

function ArkmeWebLoginOverlayContent({ t }: ArkmeWebLoginOverlayProps) {
  const flow = useArkmeAuthFlow({ retainWebLoginDialogOnBindingRequired: true }, t)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') arkmeUi.closeWebLoginDialog()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [])

  const overlay = <div
    data-arkme-web-login-dialog="true"
    style={styles.overlay}
    role="dialog"
    aria-modal="true"
    aria-label="Arkme 登录"
  >
    <button ref={closeRef} type="button" style={styles.close} aria-label="关闭登录" onClick={() => { arkmeUi.closeWebLoginDialog() }}>×</button>
    <ArkmeLogin {...flow.loginProps} />
  </div>

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}

export type ArkmeWebLoginOverlayProps = PropsLocale<typeof ARKME_LOGIN_LOCALE_NAMESPACE>

/** Web keeps Harness in place until this full-app login overlay is explicitly requested. */
export function ArkmeWebLoginOverlay({ t }: ArkmeWebLoginOverlayProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const open = !startupAuthGateEnabled()
    && authState.auth?.status !== 'authenticated'
    && ui.webLoginDialogOpen === true

  return open ? <ArkmeWebLoginOverlayContent t={t} /> : null
}
