import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { ArkmeAuthSnapshot } from '../types.js'
import { ArkmeAuthChecking, useArkmeAuthFlow, type ArkmeAuthFlowController, type ArkmePhoneBindingGate } from './arkme-auth-flow.js'
import { ArkmeLogin } from './ArkmeLogin.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'

declare global {
  interface Window {
    readonly arkmeDesktop?: Readonly<{ startupAuthGate?: boolean }>
  }
}

export type ArkmeStartupGateScreen = 'checking' | 'login' | 'error' | 'authenticated'

interface DesktopCapabilityScope {
  arkmeDesktop?: { startupAuthGate?: boolean }
}

interface InertableElement {
  inert: boolean
  parentElement: InertableElement | null
  readonly children: ArrayLike<unknown>
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  removeAttribute(name: string): void
  setAttribute(name: string, value: string): void
}

const styles: Record<string, CSSProperties> = {
  gate: {
    position: 'absolute', inset: 0, zIndex: 1000, width: '100%', height: '100%', minWidth: 0,
    overflow: 'auto', display: 'flex', background: arkmeTheme.base, color: arkmeTheme.text, pointerEvents: 'auto',
  },
  center: { width: '100%', minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 },
  errorCard: {
    width: 'min(420px, 100%)', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 24,
    padding: '32px 28px', background: arkmeTheme.layer2, boxShadow: arkmeTheme.shadow, textAlign: 'center',
  },
  errorTitle: { margin: 0, color: arkmeTheme.text, fontSize: 22, lineHeight: '30px', fontWeight: 600 },
  errorText: { margin: '14px 0 0', color: arkmeTheme.secondary, fontSize: 14, lineHeight: '22px', wordBreak: 'break-word' },
  retry: {
    height: 42, marginTop: 24, border: 0, borderRadius: 12, padding: '0 22px', background: arkmeTheme.accent,
    color: arkmeTheme.foreground, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
  },
}

export function startupAuthGateEnabled(
  scope: DesktopCapabilityScope = typeof window === 'undefined' ? {} : window,
): boolean {
  return scope.arkmeDesktop?.startupAuthGate === true
}

export function startupAuthGateScreen(
  auth: ArkmeAuthSnapshot | undefined,
  phoneBindingGate: ArkmePhoneBindingGate,
  error: string,
): ArkmeStartupGateScreen {
  if (auth === undefined) return error === '' ? 'checking' : 'error'
  if (auth.status === 'authenticated') {
    if (phoneBindingGate === 'ready') return 'authenticated'
    if (phoneBindingGate === 'required') return 'login'
    return error === '' ? 'checking' : 'error'
  }
  return 'login'
}

/** Close any Host-owned modal before its AppFrame branch becomes inert. */
export function syncAuthGateHostDialogs(
  wasActive: boolean,
  screen: ArkmeStartupGateScreen,
  eventTarget: Pick<Document, 'dispatchEvent'>,
): boolean {
  const active = screen !== 'authenticated'
  if (active && !wasActive) {
    eventTarget.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
  }
  return active
}

/** Make AppFrame content inaccessible while preserving every pre-existing attribute for cleanup. */
export function inertArkmeAppFrameSiblings(overlayLayer: InertableElement): () => void {
  const frame = overlayLayer.parentElement
  if (frame === null) return () => undefined
  const snapshots = (Array.from(frame.children) as InertableElement[])
    .filter(element => element !== overlayLayer)
    .map(element => ({
      element,
      inert: element.inert,
      hadAriaHidden: element.hasAttribute('aria-hidden'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
  for (const snapshot of snapshots) {
    snapshot.element.inert = true
    snapshot.element.setAttribute('aria-hidden', 'true')
  }
  return () => {
    for (const snapshot of snapshots) {
      snapshot.element.inert = snapshot.inert
      if (snapshot.hadAriaHidden) snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden ?? '')
      else snapshot.element.removeAttribute('aria-hidden')
    }
  }
}

export function ArkmeStartupAuthGateView({
  screen,
  error,
  busy,
  onRetry,
  flow,
}: {
  screen: ArkmeStartupGateScreen
  error: string
  busy: boolean
  onRetry(): void
  flow?: ArkmeAuthFlowController
}) {
  if (screen === 'authenticated') return null
  if (screen === 'login' && flow !== undefined) return <ArkmeLogin {...flow.loginProps} />
  if (screen === 'error') {
    return <div style={styles.center}>
      <section style={styles.errorCard} role="alert">
        <h1 style={styles.errorTitle}>暂时无法确认登录状态</h1>
        <p style={styles.errorText}>{error}</p>
        <button type="button" style={styles.retry} disabled={busy} onClick={onRetry}>
          {busy ? '正在重试…' : '重试'}
        </button>
      </section>
    </div>
  }
  return <ArkmeAuthChecking
    error=""
    busy={busy}
    onRetry={onRetry}
    statusText="正在确认登录状态…"
  />
}

export function ArkmeStartupAuthGate() {
  const flow = useArkmeAuthFlow()
  const screen = startupAuthGateScreen(flow.auth, flow.phoneBindingGate, flow.error)
  const rootRef = useRef<HTMLDivElement>(null)
  const gateActiveRef = useRef(false)

  useLayoutEffect(() => {
    gateActiveRef.current = syncAuthGateHostDialogs(gateActiveRef.current, screen, document)
    if (screen === 'authenticated') return
    arkmeUi.deactivateSurface()
    const root = rootRef.current
    if (root === null) return
    const overlayLayer = root.closest<HTMLElement>('[data-shell-overlay]')
    if (overlayLayer === null) return
    const restore = inertArkmeAppFrameSiblings(overlayLayer)
    root.focus({ preventScroll: true })
    return restore
  }, [screen])

  if (screen === 'authenticated') return null
  return <div
    ref={rootRef}
    style={styles.gate}
    role="dialog"
    aria-modal="true"
    aria-label="Arkme 登录"
    tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }}
  >
    <ArkmeStartupAuthGateView
      screen={screen}
      error={flow.error}
      busy={flow.busy}
      onRetry={flow.retry}
      flow={flow}
    />
  </div>
}
