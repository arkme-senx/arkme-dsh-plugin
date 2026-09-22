import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import { CircleNotch } from '@phosphor-icons/react/dist/icons/CircleNotch'
import { LockSimple } from '@phosphor-icons/react/dist/icons/LockSimple'
import type { ArkmeArchiveEntry, ArkmeArchivePage, ArkmeArchiveSetResult, ArkmeArchiveState } from '../archive-contract.js'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'

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
  const request = useRef<AbortController>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    request.current?.abort()
    request.current = undefined
    setBusy(false)
    setError('')
    return () => { request.current?.abort() }
  }, [scope])
  const submit = async (input: { sourceRef: string; selfArchived: boolean; expectedRevision?: number }): Promise<boolean> => {
    if (request.current !== undefined || auth.auth?.status !== 'authenticated') return false
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      // The normal directory already defines the action as Archive. Only an
      // actual click needs the write precondition; opening a menu never does.
      let expectedRevision = input.expectedRevision
      if (expectedRevision === undefined) {
        const states = await callArkme<ArkmeArchiveState[]>('archives.state', { sourceRefs: [input.sourceRef] }, controller.signal)
        if (controller.signal.aborted || currentScope.current !== scope) return false
        const state = states[0]
        if (states.length !== 1 || state?.sourceRef !== input.sourceRef || !state.ownerAvailable) {
          throw new Error('Archive target unavailable')
        }
        expectedRevision = state.revision
      }
      await callArkme<ArkmeArchiveSetResult>('archives.set', {
        sourceRef: input.sourceRef, selfArchived: input.selfArchived, expectedRevision,
      }, controller.signal)
      return !controller.signal.aborted && currentScope.current === scope
    } catch {
      if (!controller.signal.aborted && currentScope.current === scope) {
        setError(input.selfArchived ? '归档未完成，请稍后重试' : '取消归档未完成，请稍后重试')
      }
      return false
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted && currentScope.current === scope) {
        setBusy(false)
        // An uncertain reply must be re-read, never silently replayed with a new revision.
        arkmeUi.topicDirectoryChanged()
      }
    }
  }
  return {
    set: (state: ArkmeArchiveState) => submit({ sourceRef: state.sourceRef, selfArchived: !state.selfArchived, expectedRevision: state.revision }),
    archive: (sourceRef: string) => submit({ sourceRef, selfArchived: true }),
    busy, error,
  }
}

export function ArkmeArchiveStatus({ source }: { source: ArkmeSourceItem }) {
  const { state } = useArchiveState(source.sourceRef)
  if (state?.effectiveArchived !== true) return null
  return <span role="status" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>
    {state.selfArchived ? '已归档' : '随父主题归档'}
  </span>
}

export function ArkmeArchiveManagementPanel({ close: closeSettings }: { close?: (() => void) | undefined } = {}) {
  const { userId, scope, revision, refresh } = useArchiveRefresh()
  const mutation = useArchiveMutation()
  const [items, setItems] = useState<ArkmeArchiveEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sourceEntry, setSourceEntry] = useState<ArkmeArchiveEntry>()
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
  useEffect(() => { setItems([]); setCursor(undefined); setSourceEntry(undefined); setError('') }, [scope])
  useEffect(() => {
    setSourceEntry(undefined)
    if (userId !== undefined) void load()
    else setBusy(false)
    return () => { request.current?.abort() }
  }, [userId, scope, revision, load])
  const showSource = async (source: NonNullable<ArkmeArchiveState['inheritedFrom']>) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      let cursor: string | undefined
      do {
        const page = await callArkme<ArkmeArchivePage>('archives.list', cursor === undefined ? {} : { cursor }, controller.signal)
        if (controller.signal.aborted) return
        const ancestor = page.items.find(item => item.source.topicHierarchyKey === source.topicHierarchyKey)
        if (ancestor !== undefined) { setSourceEntry(ancestor); return }
        cursor = page.nextCursor
      } while (cursor !== undefined)
      refresh()
    } catch { if (!controller.signal.aborted) setError('归档来源加载失败，请重试') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
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
                {item.inheritedFrom !== undefined && <button type="button" className="arkme-archive-action" disabled={busy} onClick={() => { void showSource(item.inheritedFrom!) }}>查看来源</button>}
                <button type="button" className="arkme-archive-action" disabled={mutation.busy} onClick={() => { void mutation.set(item) }}>{item.selfArchived ? '取消归档' : '单独归档'}</button>
              </div>
            </li>)}
          </ul>
          {sourceEntry !== undefined && <div className="arkme-archive-source" role="region" aria-label="归档来源">
            <span>归档来源</span>
            <button type="button" className="arkme-archive-source-name" disabled={sourceEntry.privacyLocked} onClick={() => { open(sourceEntry) }}>{sourceEntry.privacyLocked ? '隐私主题' : sourceEntry.source.displayName}</button>
            {sourceEntry.selfArchived && <button type="button" className="arkme-archive-action" disabled={mutation.busy} onClick={() => { void mutation.set(sourceEntry) }}>取消该主题归档</button>}
          </div>}
          {busy && <div className="arkme-archive-loading" role="status" aria-label="加载中"><CircleNotch size={18} aria-hidden /></div>}
          {cursor !== undefined && <button type="button" className="arkme-archive-action arkme-archive-more" disabled={busy} onClick={() => { void load(cursor) }}>加载更多</button>}
        </div>
  </section>
}
