import { useCallback, useEffect, useRef, useState } from 'react'
import { directMessageAdmissionMessage, type ArkmeDirectMessageAdmission } from '../direct-message-admission.js'
import { ArkmeClientError, callArkme } from './api.js'
import type { ArkmeSourceItem } from '../types.js'

export async function requireDirectMessageSendAllowed(source: ArkmeSourceItem, signal?: AbortSignal): Promise<void> {
  if (source.directMessageAdmissionApplicable !== true) return
  const admission = await callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-admission', { sourceRef: source.sourceRef }, signal)
  if (!admission.canSend) throw new Error(`${source.displayName}：${directMessageAdmissionMessage(admission)}`)
}

// Invalidation only: no business facts survive a component/account lifecycle.
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
    setView(current => ({ scope, ...(current.scope === scope && current.admission !== undefined ? { admission: current.admission } : {}), loading: true, mutating: false, error: '' }))
    void callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-admission', { sourceRef }, controller.signal)
      .then(admission => { if (!controller.signal.aborted && scopeRef.current === scope) setView({ scope, admission, loading: false, mutating: false, error: '' }) })
      .catch(error => { if (!controller.signal.aborted && scopeRef.current === scope) setView({ scope, loading: false, mutating: false, error: error instanceof Error ? error.message : '无法确认私聊发送状态' }) })
    return () => { controller.abort() }
  }, [scope, sourceRef, revision])
  const current = view.scope === scope ? view : undefined
  const toggle = async () => {
    if (scope === '' || sourceRef === undefined || current?.admission === undefined || current.loading || current.mutating || mutationAbort.current !== undefined) return
    if (!current.admission.ownRefused && current.admission.refusalCreationEnabled === false) return
    const controller = new AbortController()
    queryAbort.current?.abort()
    mutationAbort.current = controller
    const admission = current.admission
    setView({ ...current, loading: false, mutating: true, error: '' })
    let succeeded = false
    try {
      const next = await callArkme<ArkmeDirectMessageAdmission>('chat.direct-message-refusal.set',
        { sourceRef, refused: !admission.ownRefused, expectedRevision: admission.ownRevision }, controller.signal)
      if (!controller.signal.aborted && scopeRef.current === scope) {
        setView({ scope, admission: next, loading: false, mutating: false, error: '' })
        succeeded = true
      }
    } catch (error) {
      if (!controller.signal.aborted && scopeRef.current === scope) {
        const latest = error instanceof ArkmeClientError ? error.body.directMessageAdmission : undefined
        setView({ scope, ...(latest === undefined ? {} : { admission: latest }), loading: false, mutating: false, error: error instanceof Error ? error.message : '拒收设置失败' })
      }
    } finally {
      if (mutationAbort.current === controller) mutationAbort.current = undefined
      if (!controller.signal.aborted && scopeRef.current === scope) {
        if (succeeded) invalidateDirectMessageAdmission()
        else refresh()
      }
    }
  }
  const blocked = scope !== '' && (current?.admission?.canSend !== true || current.loading || current.mutating)
  return { applicable: scope !== '', admission: current?.admission, blocked,
    error: current?.error ?? '',
    busy: current?.loading === true || current?.mutating === true,
    message: current?.error || (current?.mutating ? '正在更新拒收设置…' : current?.loading || current?.admission === undefined ? '正在确认私聊发送状态…' : directMessageAdmissionMessage(current.admission)),
    refresh, toggle }
}
