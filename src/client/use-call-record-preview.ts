import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeCallDetail } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

type Preview = { detail: ArkmeCallDetail; revision: number | string | undefined; savedAt: number }
type Snapshot = { identity: string; detail?: ArkmeCallDetail; failed?: boolean; loading?: boolean }
const previews = new Map<string, Preview>()
const retentionMillis = 5 * 60_000
const freshMillis = 60_000
function accountKey(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
}
let account = accountKey()
let accountGeneration = 0
arkmeAuthStore.subscribe(() => {
  const next = accountKey()
  if (next === account) return
  account = next
  accountGeneration++
  previews.clear()
})
function previewScope(): string { return `${account}:${accountGeneration}` }
function cachedPreview(identity: string): Preview | undefined {
  const cached = previews.get(identity)
  if (cached && Date.now() - cached.savedAt < retentionMillis) return cached
  previews.delete(identity)
  return undefined
}

/** callRef is a rotating access capability, never the identity of a known call. */
export function useCallRecordPreview<Element extends HTMLElement = HTMLDivElement>(
  callRef: string | undefined, revision?: number | string, stableId?: string,
) {
  const scope = useSyncExternalStore(arkmeAuthStore.subscribe, previewScope, previewScope)
  const identity = `${scope}\0${stableId || callRef || ''}`
  const element = useRef<Element>(null)
  const latestRef = useRef(callRef)
  latestRef.current = callRef
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [retryVersion, setRetryVersion] = useState(0)
  const retry = useCallback(() => { setRetryVersion(value => value + 1) }, [])
  const auth = arkmeAuthStore.getSnapshot().auth
  const enabled = Boolean(callRef) && (auth === undefined || auth.status === 'authenticated')
  // Memory-only, bounded and account-scoped. Unknown auth never shares a cache.
  const cached = account ? cachedPreview(identity) : undefined
  const current = snapshot?.identity === identity ? snapshot : undefined

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let started = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const valid = () => !controller.signal.aborted && previewScope() === scope
    const saved = account ? cachedPreview(identity) : undefined
    if (saved && saved.revision === revision && Date.now() - saved.savedAt < freshMillis && retryVersion === 0) {
      setSnapshot({ identity, detail: saved.detail })
      return
    }
    const fetchPreview = () => {
      if (!valid() || !latestRef.current) return
      attempts++
      setSnapshot(previous => ({ identity, ...(previous?.identity === identity ? previous : saved ? { detail: saved.detail } : {}), loading: true }))
      void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef: latestRef.current }, controller.signal).then(detail => {
        if (!valid()) return
        if (account) {
          previews.delete(identity)
          previews.set(identity, { detail, revision, savedAt: Date.now() })
          while (previews.size > 48) previews.delete(previews.keys().next().value!)
        }
        // A successful response is authoritative, including a removed recording.
        setSnapshot({ identity, detail })
      }).catch(error => {
        if (!valid()) return
        const body = (error as { body?: { code?: string; retryable?: boolean } })?.body
        const accessLost = /(?:forbidden|unauthorized|not-found|permission|auth-|account-|call-ref-invalid)/i.test(body?.code ?? '')
        if (accessLost) previews.delete(identity)
        setSnapshot(previous => ({ identity, ...(!accessLost && previous?.identity === identity ? previous : {}), failed: true, loading: false }))
        if (!accessLost && body?.retryable !== false && attempts < 3) {
          timer = setTimeout(fetchPreview, attempts === 1 ? 1500 : 4000)
        }
      })
    }
    const start = () => { if (!started) { started = true; fetchPreview() } }
    const observer = typeof IntersectionObserver !== 'undefined' && element.current
      ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { start(); observer?.disconnect() }
      }, { rootMargin: '160px' }) : undefined
    if (observer && element.current) observer.observe(element.current)
    else start()
    return () => { observer?.disconnect(); controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [identity, scope, enabled, revision, retryVersion])
  return {
    element, detail: enabled ? current ? current.detail : cached?.detail : undefined,
    failed: enabled && current?.failed === true, loading: enabled && current?.loading === true,
    retry, retryVersion,
  }
}
