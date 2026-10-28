import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeCallDetail, ArkmeCallVideoRecord } from '../types.js'
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

function hasVideo(record: ArkmeCallVideoRecord | undefined): boolean {
  return record?.available === true && Boolean(record.videoUrl || record.posterUrl
    || record.perspectives?.some(clip => clip.videoUrl || clip.posterUrl))
}

/** Missing media is an incomplete read, not evidence that a recording was removed. */
function retainKnownVideo(previous: ArkmeCallDetail | undefined, incoming: ArkmeCallDetail): ArkmeCallDetail {
  if (incoming.videoRecord?.available === false || !hasVideo(previous?.videoRecord)) return incoming
  const known = previous!.videoRecord!
  if (!hasVideo(incoming.videoRecord)) return { ...incoming, videoRecord: known }
  const next = incoming.videoRecord!
  // One missing camera in a partial response must not remove an already known view.
  // Only match unambiguous named perspectives; never guess between unknown cameras.
  const oldViews = known.perspectives ?? []
  const newViews = next.perspectives ?? []
  const slot = (view: NonNullable<ArkmeCallVideoRecord['perspectives']>[number]) => view.userId !== undefined
    ? `user:${view.userId}` : view.perspective === 'unknown' ? undefined : view.perspective
  const matches = (old: typeof oldViews[number], fresh: typeof newViews[number]) => slot(old) !== undefined && slot(old) === slot(fresh)
    && oldViews.filter(view => slot(view) === slot(old)).length === 1 && newViews.filter(view => slot(view) === slot(fresh)).length === 1
  if (!oldViews.some(old => newViews.some(fresh => matches(old, fresh)))) return incoming
  const perspectives = oldViews.map(old => {
    const fresh = newViews.find(view => matches(old, view))
    return fresh ? { ...old, ...fresh } : old
  })
  perspectives.push(...newViews.filter(fresh => !oldViews.some(old => matches(old, fresh))))
  return { ...incoming, videoRecord: { ...next, perspectives } }
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
    let lastDetail = current?.detail ?? saved?.detail
    if (saved && saved.revision === revision && Date.now() - saved.savedAt < freshMillis && retryVersion === 0) {
      setSnapshot({ identity, detail: saved.detail })
      return
    }
    const fetchPreview = () => {
      if (!valid() || !latestRef.current) return
      attempts++
      setSnapshot(previous => ({ identity, ...(previous?.identity === identity ? previous : saved ? { detail: saved.detail } : {}), loading: true }))
      void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef: latestRef.current }, controller.signal).then(incoming => {
        if (!valid()) return
        const detail = retainKnownVideo(lastDetail, incoming)
        lastDetail = detail
        const incomplete = detail.mediaType === 'video' && detail.durationSeconds > 0
          && detail.videoRecord?.available !== false && !hasVideo(detail.videoRecord)
        if (account) {
          previews.delete(identity)
          // Do not mark an incomplete media read fresh; returning to the chat must retry it.
          if (!incomplete) previews.set(identity, { detail, revision, savedAt: Date.now() })
          while (previews.size > 48) previews.delete(previews.keys().next().value!)
        }
        setSnapshot({ identity, detail, loading: incomplete && attempts < 3, failed: incomplete && attempts >= 3 })
        if (incomplete && attempts < 3) timer = setTimeout(fetchPreview, attempts === 1 ? 1500 : 4000)
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
