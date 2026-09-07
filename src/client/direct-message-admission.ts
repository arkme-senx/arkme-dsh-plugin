import { useCallback, useEffect, useRef, useState } from 'react'
import { directMessageAdmissionMessage, type ArkmeDirectMessageAdmission } from '../direct-message-admission.js'
import { ArkmeClientError, callArkme } from './api.js'
import type { ArkmeSourceItem } from '../types.js'

export async function requireDirectMessageSendAllowed(source: ArkmeSourceItem, signal?: AbortSignal): Promise<void> {
  if (source.directMessageAdmissionApplicable !== true) return
  let admission: ArkmeDirectMessageAdmission | undefined
  try { admission = await callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-admission', { sourceRef: source.sourceRef }, signal) }
  catch { signal?.throwIfAborted(); return }
  if (!admission.canSend) throw new Error(`${source.displayName}：${directMessageAdmissionMessage(admission)}`)
}

function readCachedAdmission(scope: string): ArkmeDirectMessageAdmission | undefined {
  if (scope === '') return undefined
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage?.getItem(`arkme.direct-message-admission.v1:${scope}`)
    if (raw == null) return undefined
    const value = JSON.parse(raw) as ArkmeDirectMessageAdmission
    if (typeof value.ownRefused !== 'boolean' || typeof value.counterpartRefused !== 'boolean'
      || typeof value.refusalCreationEnabled !== 'boolean' || typeof value.canSend !== 'boolean'
      || !Number.isSafeInteger(value.ownRevision) || value.ownRevision < 0
      || !Number.isSafeInteger(value.counterpartRevision) || value.counterpartRevision < 0
      || (value.ownRefused && value.ownRevision === 0) || (value.counterpartRefused && value.counterpartRevision === 0)) return undefined
    const state = value.ownRefused ? value.counterpartRefused ? 'mutually_refused' : 'refused_by_self'
      : value.counterpartRefused ? 'refused_by_counterpart' : 'allowed'
    return value.state === state && value.canSend === (state === 'allowed') ? value : undefined
  } catch { return undefined }
}

function cacheAdmission(scope: string, admission: ArkmeDirectMessageAdmission): void {
  try { if (scope !== '' && typeof window !== 'undefined') window.localStorage?.setItem(`arkme.direct-message-admission.v1:${scope}`, JSON.stringify(admission)) }
  catch { /* Browser storage is optional; Chat remains the authority. */ }
}

// Hints invalidate the view; cached projections never authorize server writes.
const listeners = new Set<() => void>()
export function invalidateDirectMessageAdmission(): void { for (const listener of listeners) listener() }

export function useDirectMessageAdmission(account: string | undefined, sourceRef: string | undefined, applicable: boolean) {
  const scope = account !== undefined && sourceRef !== undefined && applicable ? `${account}:${sourceRef}` : ''
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<{ scope: string; admission?: ArkmeDirectMessageAdmission; loading: boolean; mutating: boolean; error: string }>({ scope: '', loading: false, mutating: false, error: '' })
  const queryAbort = useRef<AbortController>()
  const mutationAbort = useRef<AbortController>()
  const refresh = useCallback(() => { setRevision(value => value + 1) }, [])
  useEffect(() => {
    if (scope === '') return
    listeners.add(refresh)
    const browserWindow = typeof window === 'undefined' ? undefined : window
    const browserDocument = typeof document === 'undefined' ? undefined : document
    browserWindow?.addEventListener('focus', refresh)
    const visible = () => { if (browserDocument?.visibilityState === 'visible') refresh() }
    browserDocument?.addEventListener('visibilitychange', visible)
    return () => { listeners.delete(refresh); browserWindow?.removeEventListener('focus', refresh); browserDocument?.removeEventListener('visibilitychange', visible) }
  }, [refresh, scope])
  useEffect(() => () => { mutationAbort.current?.abort(); mutationAbort.current = undefined }, [scope])
  useEffect(() => {
    if (scope === '' || sourceRef === undefined || mutationAbort.current !== undefined) return
    const controller = new AbortController()
    queryAbort.current = controller
    setView(current => {
      const admission = current.scope === scope ? current.admission : readCachedAdmission(scope)
      return { scope, ...(admission === undefined ? {} : { admission }), loading: true, mutating: false, error: '' }
    })
    void callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-admission', { sourceRef }, controller.signal)
      .then(admission => { if (!controller.signal.aborted && scopeRef.current === scope) { cacheAdmission(scope, admission); setView({ scope, admission, loading: false, mutating: false, error: '' }) } })
      .catch(() => { if (!controller.signal.aborted && scopeRef.current === scope) setView(current => ({ ...current, scope, loading: false, mutating: false, error: '暂时无法读取拒收设置' })) })
    return () => { controller.abort() }
  }, [scope, sourceRef, revision])
  const current = view.scope === scope ? view : undefined
  const toggle = async (confirmRefusal?: () => boolean) => {
    if (scope === '' || sourceRef === undefined || current?.loading || current?.mutating || mutationAbort.current !== undefined) return
    if (current?.admission?.ownRefused === false && current.admission.refusalCreationEnabled === false) return
    const controller = new AbortController()
    queryAbort.current?.abort()
    mutationAbort.current = controller
    let admission = current?.admission
    setView({ scope, ...(admission === undefined ? {} : { admission }), loading: false, mutating: true, error: '' })
    let succeeded = false
    let attemptedMutation = false
    try {
      if (admission === undefined) {
        admission = await callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-admission', { sourceRef }, controller.signal)
        if (controller.signal.aborted || scopeRef.current !== scope) return
        cacheAdmission(scope, admission)
      }
      if (!admission.ownRefused && (!admission.refusalCreationEnabled || confirmRefusal?.() === false)) {
        setView({ scope, admission, loading: false, mutating: false, error: '' })
        return
      }
      attemptedMutation = true
      const next = await callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-refusal.set',
        { sourceRef, refused: !admission.ownRefused, expectedRevision: admission.ownRevision }, controller.signal)
      if (!controller.signal.aborted && scopeRef.current === scope) {
        cacheAdmission(scope, next)
        setView({ scope, admission: next, loading: false, mutating: false, error: '' })
        succeeded = true
      }
    } catch (error) {
      if (!controller.signal.aborted && scopeRef.current === scope) {
        const latest = error instanceof ArkmeClientError ? error.body.directMessageAdmission : undefined
        if (latest !== undefined) cacheAdmission(scope, latest)
        const retained = latest ?? admission
        setView({ scope, ...(retained === undefined ? {} : { admission: retained }), loading: false, mutating: false,
          error: !attemptedMutation ? '暂时无法读取拒收设置' : error instanceof Error ? error.message : '拒收设置失败' })
      }
    } finally {
      if (mutationAbort.current === controller) mutationAbort.current = undefined
      if (!controller.signal.aborted && scopeRef.current === scope) {
        if (succeeded) invalidateDirectMessageAdmission()
        else if (attemptedMutation) refresh()
      }
    }
  }
  const blocked = scope !== '' && current?.admission?.canSend === false
  return { applicable: scope !== '', admission: current?.admission, blocked,
    error: current?.error ?? '',
    busy: current?.loading === true || current?.mutating === true,
    message: blocked && current?.admission !== undefined ? directMessageAdmissionMessage(current.admission) : '',
    refresh, toggle }
}
