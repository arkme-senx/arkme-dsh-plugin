import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeThoughtContinuation, ArkmeThoughtContinuationPage } from '../thought-continuation.js'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeAuthStore } from './auth-store.js'
import type { DetailExtensionSend } from './detail-extension-send.js'
import { isArkmeTransientReadFailure } from './read-retry.js'

/** One mounted detail owns one cancellable poll, suspended while hidden.
 * The backend job continues independently of the browser lifetime. */
export function useThoughtContinuations(sourceRef: string | undefined, actionRef: string | undefined, tasks: readonly DetailExtensionSend[]) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const [state, setState] = useState<{ scope: string; key: string; items: ArkmeThoughtContinuation[]; supported: boolean; cursor?: string; error?: string }>({ scope: '', key: '', items: [], supported: false })
  const [revision, setRevision] = useState(0)
  const retry = useRef<(id: string) => Promise<void>>(async () => {})
  const more = useRef<() => void>(() => {})
  const [retryingId, setRetryingId] = useState<string>()
  const key = JSON.stringify([sourceRef, actionRef])
  const sendKey = tasks.filter(t => t.thoughtReplyRef).map(t => `${t.recordUid}:${t.state}`).join('|')
  const pending = useRef<{ scope: string; key: string; ids: Set<string> }>({ scope: '', key: '', ids: new Set() })
  if (pending.current.scope !== scope || pending.current.key !== key) pending.current = { scope, key, ids: new Set() }
  for (const task of tasks) if (task.thoughtReplyRef) {
    const completed = state.scope === scope && state.key === key && state.items.some(item => item.replyRecordUid === task.recordUid && item.status !== 'generating')
    if (task.state === 'failed' || completed) pending.current.ids.delete(task.recordUid)
    else pending.current.ids.add(task.recordUid)
  }
  while (pending.current.ids.size > 20) pending.current.ids.delete(pending.current.ids.values().next().value!)
  useEffect(() => {
    if (!scope || !sourceRef || !actionRef) return
    // Sending another comment revalidates this detail without removing already
    // visible replies or its optimistic Arko status. Account/source changes
    // still clear immediately through the scoped return value below.
    const previous = state.scope === scope && state.key === key ? state : undefined
    setState(current => current.scope === scope && current.key === key ? current : { scope, key, items: [], supported: false })
    const sdk = createArkmeSdk(), controller = new AbortController(), signal = controller.signal
    if (typeof sdk.sourceMessageThoughtContinuations !== 'function') return
    let timer: ReturnType<typeof setTimeout> | undefined, inFlight = false, active = true, polls = 0
    let supported = previous?.supported ?? true
    let items: ArkmeThoughtContinuation[] = previous?.items ?? [], cursor: string | undefined = previous?.cursor
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const publish = (page: ArkmeThoughtContinuationPage, append = false) => {
      if (!active || signal.aborted || page.accountScope !== scope) return
      supported = page.supported
      const byId = new Map((append ? items : []).map(item => [item.id, item]))
      for (const item of page.items) byId.set(item.id, item)
      // Head refresh replaces older pages so revoked content cannot survive
      // through a local merge. Explicit pagination revalidates each page.
      items = [...byId.values()].slice(-60); cursor = page.nextCursor
      for (const item of items) if (item.status !== 'generating') pending.current.ids.delete(item.replyRecordUid)
      setState({ scope, key, items, supported: page.supported, ...(cursor ? { cursor } : {}) })
    }
    const fail = (error: unknown, fallback: string) => {
      if (!active || signal.aborted) return
      const code = error && typeof error === 'object'
        ? (error as { body?: { code?: unknown }; code?: unknown }).body?.code ?? (error as { code?: unknown }).code : undefined
      if (code === 'CAPABILITY_UNSUPPORTED') {
        supported = false; items = []; cursor = undefined
        setState({ scope, key, items, supported: false })
        return
      }
      if (!isArkmeTransientReadFailure(error)) { items = []; cursor = undefined; pending.current.ids.clear(); supported = false }
      setState({ scope, key, items, supported, ...(cursor ? { cursor } : {}),
        error: error instanceof Error ? error.message : fallback })
    }
    const schedule = (force = false) => {
      if (timer) clearTimeout(timer)
      const unmatched = [...pending.current.ids].some(uid => !items.some(item => item.replyRecordUid === uid))
      if (active && supported && visible() && polls < 120 && (force || unmatched || items.some(item => item.status === 'generating')))
        timer = setTimeout(() => { void read() }, 3000)
    }
    const read = async (after?: string) => {
      if (inFlight || !visible() || !active) return
      inFlight = true; polls++
      try {
        const page = await sdk.sourceMessageThoughtContinuations(sourceRef, actionRef, { ...(after ? { cursor: after } : {}), signal })
        publish(page, !!after)
      } catch (error) {
        fail(error, 'Arko 回复暂时无法读取')
      } finally { inFlight = false; schedule() }
    }
    retry.current = async id => {
      if (inFlight || !active || !visible()) return
      inFlight = true; setRetryingId(id)
      try { publish(await sdk.retrySourceMessageThoughtContinuation(sourceRef, actionRef, id, signal)) }
      catch (error) { fail(error, 'Arko 回复重试失败') }
      finally { inFlight = false; if (active) setRetryingId(undefined); schedule(true) }
    }
    more.current = () => { if (cursor) void read(cursor) }
    const focus = () => { if (visible()) { polls = 0; void read() } else if (timer) clearTimeout(timer) }
    document.addEventListener('visibilitychange', focus); window.addEventListener('focus', focus)
    void read()
    return () => {
      active = false; controller.abort(); if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', focus); window.removeEventListener('focus', focus)
      retry.current = async () => {}; more.current = () => {}
    }
  }, [scope, key, sendKey, revision])
  const current: typeof state = state.scope === scope && state.key === key ? state : { scope, key, items: [], supported: false }
  return { ...current, pendingReplyRecordUids: [...pending.current.ids], nextCursor: current.cursor, retryingId,
    retry: (id: string) => { void retry.current(id) }, loadMore: () => more.current(), refresh: () => setRevision(n => n + 1) }
}
