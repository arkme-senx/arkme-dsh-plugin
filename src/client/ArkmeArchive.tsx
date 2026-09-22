import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { CircleNotch } from '@phosphor-icons/react/dist/icons/CircleNotch'
import { LockSimple } from '@phosphor-icons/react/dist/icons/LockSimple'
import type { ArkmeArchiveEntry, ArkmeArchivePage, ArkmeArchiveSetResult, ArkmeArchiveState } from '../archive-contract.js'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'
import { selfTopicDirectory } from './self-topic-directory-cache.js'

function useArchiveRefresh(): { userId: number | undefined; scope: string; revision: string; refresh(): void } {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const [foreground, setForeground] = useState(0)
  const refresh = useCallback(() => { setForeground(value => value + 1) }, [])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])
  return { userId: auth.auth?.status === 'authenticated' ? auth.auth.userId : undefined,
    scope: `${auth.auth?.status}:${auth.auth?.environment}:${auth.auth?.userId}:${ui.authRevision}`,
    revision: `${ui.authRevision}:${ui.recordRevision}:${ui.topicDirectoryRevision}:${foreground}`, refresh }
}

/** Reads effective state from the Host; no client-side hierarchy inference. */
export function useArchiveState(sourceRef: string | undefined): { state: ArkmeArchiveState | undefined; error: string; refresh(): void } {
  const { userId, scope, revision, refresh } = useArchiveRefresh()
  const [value, setValue] = useState<{ sourceRef: string; scope: string; state: ArkmeArchiveState }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    if (sourceRef !== undefined && userId !== undefined) {
      void callArkme<ArkmeArchiveState[]>('archives.state', { sourceRefs: [sourceRef] }, controller.signal).then(states => {
        const state = states[0]
        if (!controller.signal.aborted && state !== undefined) setValue({ sourceRef, scope, state })
      }).catch(() => { if (!controller.signal.aborted) setError('归档状态加载失败') })
    }
    return () => { controller.abort() }
  }, [sourceRef, userId, scope, revision])
  return { state: value !== undefined && value.sourceRef === sourceRef && value.scope === scope ? value.state : undefined, error, refresh }
}

/** The stable surface owns writes, even when its archived menu row disappears. */
export function useArchiveMutation() {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const scope = `${auth.auth?.status}:${auth.auth?.environment}:${auth.auth?.userId}:${ui.authRevision}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const requests = useRef(new Map<string, AbortController>())
  const [busyRefs, setBusyRefs] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  useEffect(() => {
    const pending = requests.current
    const cancel = () => { for (const controller of pending.values()) controller.abort(); pending.clear() }
    cancel()
    setBusyRefs(new Set())
    setError('')
    return cancel
  }, [scope])
  const submit = async (input: { sourceRef: string; selfArchived: boolean; expectedRevision?: number; source?: ArkmeSourceItem }): Promise<boolean> => {
    if (requests.current.has(input.sourceRef) || auth.auth?.status !== 'authenticated' || auth.auth.userId === undefined) return false
    const directory = selfTopicDirectory(auth.auth.userId, auth.auth.environment)
    const settleRemoval = input.source === undefined ? undefined : directory.beginArchive(input.source)
    if (input.source !== undefined && settleRemoval === undefined) return false
    const controller = new AbortController()
    requests.current.set(input.sourceRef, controller)
    setBusyRefs(new Set(requests.current.keys()))
    setError('')
    const current = () => currentScope.current === scope && requests.current.get(input.sourceRef) === controller
    let writeAttempted = false
    let accepted = false
    // Bound the entire interaction, including browser connection-queue time.
    // An uncertain write is reconciled from the owner, never replayed here.
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => { reject(controller.signal.reason) }, { once: true })
    })
    const timer = setTimeout(() => { controller.abort(new Error('归档请求超时')) }, 30_000)
    try {
      accepted = await Promise.race([cancelled, (async () => {
        let expectedRevision = input.expectedRevision
        if (expectedRevision === undefined) {
          const states = await callArkme<ArkmeArchiveState[]>('archives.state', { sourceRefs: [input.sourceRef] }, controller.signal)
          if (controller.signal.aborted || !current()) return false
          const state = states[0]
          if (states.length !== 1 || state?.sourceRef !== input.sourceRef || !state.ownerAvailable) throw new Error('Archive target unavailable')
          expectedRevision = state.revision
        }
        writeAttempted = true
        await callArkme<ArkmeArchiveSetResult>('archives.set', {
          sourceRef: input.sourceRef, selfArchived: input.selfArchived, expectedRevision,
        }, controller.signal)
        return !controller.signal.aborted && current()
      })()])
      return accepted
    } catch {
      if (current()) setError(input.selfArchived ? '归档未完成，请稍后重试' : '取消归档未完成，请稍后重试')
      return false
    } finally {
      clearTimeout(timer)
      settleRemoval?.(accepted)
      if (current()) {
        requests.current.delete(input.sourceRef)
        setBusyRefs(new Set(requests.current.keys()))
        // Reads that fail before submission cannot change directory membership.
        if (writeAttempted) {
          directory.invalidate()
          arkmeUi.topicDirectoryChanged()
        }
      }
    }
  }
  return {
    set: (state: ArkmeArchiveState) => submit({ sourceRef: state.sourceRef, selfArchived: !state.selfArchived, expectedRevision: state.revision }),
    archive: (source: ArkmeSourceItem) => submit({ sourceRef: source.sourceRef, selfArchived: true, source }),
    isBusy: (sourceRef: string) => busyRefs.has(sourceRef), error,
  }
}

export function ArkmeArchiveStatus({ source }: { source: ArkmeSourceItem }) {
  const { state } = useArchiveState(source.sourceRef)
  if (state?.effectiveArchived !== true) return null
  return <span role="status" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>
    {state.selfArchived ? '已归档' : '随父主题归档'}
  </span>
}

function ArchiveSourceDetails({ id, source, cached, mutation, open, onUnavailable }: {
  id: string
  source: NonNullable<ArkmeArchiveState['inheritedFrom']>
  cached: ArkmeArchiveEntry | undefined
  mutation: ReturnType<typeof useArchiveMutation>
  open(entry: ArkmeArchiveEntry): void
  onUnavailable(): void
}) {
  const [resolved, setResolved] = useState<ArkmeArchiveEntry>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (cached !== undefined) return
    const controller = new AbortController()
    setResolved(undefined)
    setError('')
    void (async () => {
      let cursor: string | undefined
      do {
        const page = await callArkme<ArkmeArchivePage>('archives.list', cursor === undefined ? {} : { cursor }, controller.signal)
        if (controller.signal.aborted) return
        const ancestor = page.items.find(item => item.source.topicHierarchyKey === source.topicHierarchyKey)
        if (ancestor !== undefined) { setResolved(ancestor); return }
        cursor = page.nextCursor
      } while (cursor !== undefined)
      onUnavailable()
    })().catch(() => { if (!controller.signal.aborted) setError('归档来源加载失败') })
    return () => { controller.abort() }
  }, [source.topicHierarchyKey, cached, attempt, onUnavailable])
  const entry = cached ?? resolved
  return <div id={id} className="arkme-archive-source" role="region" aria-label="归档来源">
    <span className="arkme-archive-source-label">归档来源</span>
    {entry !== undefined ? <>
      <button type="button" className="arkme-archive-source-name" disabled={entry.privacyLocked} onClick={() => { open(entry) }}>{entry.privacyLocked ? '隐私主题' : entry.source.displayName}</button>
      {entry.selfArchived && <button type="button" className="arkme-archive-action" disabled={mutation.isBusy(entry.sourceRef)} onClick={() => { void mutation.set(entry) }}>取消来源归档</button>}
    </> : error !== '' ? <div className="arkme-archive-source-feedback" role="alert">
      {error}<button type="button" className="arkme-archive-action" onClick={() => { setAttempt(value => value + 1) }}>重试</button>
    </div> : <div className="arkme-archive-loading" role="status" aria-label="正在加载归档来源"><CircleNotch size={14} aria-hidden /></div>}
  </div>
}

export function ArkmeArchiveManagementPanel({ close: closeSettings }: { close?: (() => void) | undefined } = {}) {
  const { userId, scope, revision, refresh } = useArchiveRefresh()
  const mutation = useArchiveMutation()
  const [items, setItems] = useState<ArkmeArchiveEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expandedSourceRef, setExpandedSourceRef] = useState<string>()
  const sourceDetailsId = useId()
  const request = useRef<AbortController>()
  const load = useCallback(async (next?: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const page = await callArkme<ArkmeArchivePage>('archives.list', next === undefined ? {} : { cursor: next }, controller.signal)
      if (controller.signal.aborted) return
      setItems(previous => [...new Map([...(next === undefined ? [] : previous), ...page.items].map(item => [item.source.topicHierarchyKey, item])).values()])
      setCursor(page.nextCursor)
    } catch { if (!controller.signal.aborted) setError('加载失败，请重试') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }, [])
  useEffect(() => { setItems([]); setCursor(undefined); setExpandedSourceRef(undefined); setError('') }, [scope])
  useEffect(() => {
    setExpandedSourceRef(undefined)
    if (userId !== undefined) void load()
    else setBusy(false)
    return () => { request.current?.abort() }
  }, [userId, scope, revision, load])
  const open = (item: ArkmeArchiveEntry) => { arkmeUi.selectSource(item.source); closeSettings?.() }
  return <section className="arkme-archive-group" aria-label="已归档主题" data-arkme-archive-management>
        <div>
          {userId === undefined && <p className="arkme-archive-feedback">请先登录</p>}
          {error !== '' && <div className="arkme-archive-feedback" role="alert">{error} <button type="button" className="arkme-archive-action" onClick={refresh}>重试</button></div>}
          {mutation.error !== '' && <div className="arkme-archive-feedback" role="alert">{mutation.error}</div>}
          {!busy && error === '' && userId !== undefined && items.length === 0 && <div className="arkme-archive-empty" role="img" aria-label="暂无已归档主题"><Archive size={64} weight="thin" aria-hidden /></div>}
          <ul className="arkme-archive-list">
            {items.map(item => <li key={item.source.topicHierarchyKey} className="arkme-archive-row">
              <button type="button" className="arkme-archive-topic" disabled={item.privacyLocked} aria-label={`打开主题：${item.privacyLocked ? '隐私主题' : item.source.displayName}`} onClick={() => { open(item) }}>
                {item.privacyLocked ? <LockSimple size={18} aria-hidden /> : <Archive size={18} aria-hidden />}
                <span title={item.privacyLocked ? '隐私主题' : item.source.displayName}>{item.privacyLocked ? '隐私主题' : item.source.displayName}</span>
              </button>
              {item.inheritedFrom !== undefined && <span className="arkme-archive-inherited">随父主题归档</span>}
              <div className="arkme-archive-actions">
                {item.inheritedFrom !== undefined && <button type="button" className="arkme-archive-action arkme-archive-source-toggle"
                  aria-expanded={expandedSourceRef === item.sourceRef} aria-controls={expandedSourceRef === item.sourceRef ? sourceDetailsId : undefined}
                  onClick={() => { setExpandedSourceRef(current => current === item.sourceRef ? undefined : item.sourceRef) }}>
                  {expandedSourceRef === item.sourceRef ? '收起来源' : '查看来源'}<CaretDown size={12} aria-hidden />
                </button>}
                <button type="button" className="arkme-archive-action" disabled={mutation.isBusy(item.sourceRef)} onClick={() => { void mutation.set(item) }}>{item.selfArchived ? '取消归档' : '单独归档'}</button>
              </div>
              {item.inheritedFrom !== undefined && expandedSourceRef === item.sourceRef && <ArchiveSourceDetails
                key={item.inheritedFrom.topicHierarchyKey} id={sourceDetailsId} source={item.inheritedFrom}
                cached={items.find(candidate => candidate.source.topicHierarchyKey === item.inheritedFrom!.topicHierarchyKey)}
                mutation={mutation} open={open} onUnavailable={refresh} />}
            </li>)}
          </ul>
          {busy && <div className="arkme-archive-loading" role="status" aria-label="加载中"><CircleNotch size={18} aria-hidden /></div>}
          {cursor !== undefined && <button type="button" className="arkme-archive-action arkme-archive-more" disabled={busy} onClick={() => { void load(cursor) }}>加载更多</button>}
        </div>
  </section>
}
