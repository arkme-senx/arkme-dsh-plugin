import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link'
import type { IdentityShareLink, IdentityShareTarget } from '../identity-share-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareAccountScope } from './identity-share-ui.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeTheme as t } from './arkme-theme.js'

export async function copyIdentityShareLink(scope: string, target: IdentityShareTarget, signal?: AbortSignal) {
  if (!scope || scope !== identityShareAccountScope()) throw new Error(tr('账号已切换，请重新复制链接'))
  const result = await callArkme<IdentityShareLink>('identity.share.link', { accountScope: scope, ...target }, signal)
  signal?.throwIfAborted()
  if (scope !== identityShareAccountScope()) throw new Error(tr('账号已切换，请重新复制链接'))
  await navigator.clipboard.writeText(result.url)
}

export function IdentityCopyLinkButton({ target, label = '复制链接', accountScope, className, style, iconSize = 18 }: {
  target: IdentityShareTarget; label?: string; accountScope?: string; className?: string; style?: CSSProperties; iconSize?: number
}) {
  useArkmeLocale()
  const currentScope = useSyncExternalStore(arkmeAuthStore.subscribe, identityShareAccountScope, () => '')
  const scope = accountScope ?? currentScope, key = JSON.stringify([scope, target])
  return <CopyButton key={key} target={target} scope={scope} currentScope={currentScope} label={label} {...(className ? { className } : {})} {...(style ? { style } : {})} iconSize={iconSize} />
}
function CopyButton({ target, scope, currentScope, label, className, style, iconSize }: {
  target: IdentityShareTarget; scope: string; currentScope: string; label: string; className?: string; style?: CSSProperties; iconSize: number
}) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  const copy = async () => {
    if (request.current || !scope || scope !== identityShareAccountScope()) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setStatus('')
    try {
      await copyIdentityShareLink(scope, target, controller.signal)
      if (!controller.signal.aborted && scope === identityShareAccountScope()) setStatus(tr('链接已复制'))
    } catch (e) { if (!controller.signal.aborted && scope === identityShareAccountScope()) setError(e instanceof Error ? e.message : tr('复制失败，请重试')) }
    finally { if (request.current === controller) { request.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
  }
  return <><button type="button" data-arkme-feedback="neutral" className={className} aria-label={tr(label)} title={error || tr(label)} aria-busy={busy || undefined} disabled={busy || !scope || scope !== currentScope}
    style={style ?? { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: `1px solid ${t.border}`, borderRadius: 8, font: 'inherit', fontSize: 13, color: t.text, background: t.elevated, cursor: 'pointer' }} onClick={() => { void copy() }}>
    <LinkIcon size={iconSize} aria-hidden /><span>{busy ? tr('正在复制…') : status || tr(label)}</span>
  </button>{error && <span role="alert" style={{ color: t.danger, fontSize: 12, overflowWrap: 'anywhere' }}>{error}</span>}</>
}
