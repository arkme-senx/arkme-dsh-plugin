import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeArchiveEntry, ArkmeArchivePage, ArkmeArchiveSetResult, ArkmeArchiveState } from '../archive-contract.js'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeTopicDialogFrame } from './ArkmeTopicManagementDialog.js'

const button: CSSProperties = { border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 6, padding: '7px 12px', background: arkmeTheme.menu, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' }
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

function useArchiveRefresh(): { userId: number | undefined; revision: string; refresh(): void } {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const [foreground, setForeground] = useState(0)
  const refresh = useCallback(() => { setForeground(value => value + 1) }, [])
  useEffect(() => {
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
    revision: `${ui.authRevision}:${ui.recordRevision}:${foreground}`, refresh }
}

/** Reads effective state from the Host; no client-side hierarchy inference. */
export function useArchiveState(sourceRef: string | undefined): { state: ArkmeArchiveState | undefined; error: string; refresh(): void } {
  const { userId, revision, refresh } = useArchiveRefresh()
  const [value, setValue] = useState<{ sourceRef: string; userId: number; state: ArkmeArchiveState }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    if (sourceRef !== undefined && userId !== undefined) {
      void callArkme<ArkmeArchiveState[]>('archives.state', { sourceRefs: [sourceRef] }, controller.signal).then(states => {
        const state = states[0]
        if (!controller.signal.aborted && state !== undefined) setValue({ sourceRef, userId, state })
      }).catch(caught => { if (!controller.signal.aborted) setError(message(caught)) })
    }
    return () => { controller.abort() }
  }, [sourceRef, userId, revision])
  return { state: value !== undefined && value.sourceRef === sourceRef && value.userId === userId ? value.state : undefined, error, refresh }
}

export function ArkmeArchiveDialog({ state, title, onClose }: { state: ArkmeArchiveState; title: string; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resolved, setResolved] = useState(false)
  const pending = useRef(false)
  const request = useRef<AbortController>()
  const initialUser = useRef(arkmeAuthStore.getSnapshot().auth?.userId)
  useEffect(() => {
    const unsubscribe = arkmeAuthStore.subscribe(() => {
      if (arkmeAuthStore.getSnapshot().auth?.userId !== initialUser.current) { request.current?.abort(); onClose() }
    })
    return () => { unsubscribe(); request.current?.abort() }
  }, [onClose])
  const archived = !state.selfArchived
  const submit = async () => {
    if (pending.current || resolved) return
    pending.current = true
    setBusy(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      const result = await callArkme<ArkmeArchiveSetResult>('archives.set', {
        sourceRef: state.sourceRef, selfArchived: archived, expectedRevision: state.revision,
      }, controller.signal)
      if (controller.signal.aborted) return
      setResolved(true)
      if (!archived && result.effectiveArchived) setError('已取消单独归档；该主题仍随父级归档，可在“已归档”中查看归档来源。')
      else onClose()
    } catch (caught) {
      if (!controller.signal.aborted) {
        // Do not silently rebase a conflicting or uncertain write onto a new revision.
        setResolved(true)
        setError(`${message(caught)}。请关闭后刷新状态，再决定是否重试。`)
      }
    } finally {
      pending.current = false
      if (!controller.signal.aborted) { setBusy(false); arkmeUi.recordChanged() }
    }
  }
  return <ArkmeTopicDialogFrame title={archived ? '归档主题' : '取消归档'} submitting={busy} onCancel={onClose}>
    <p style={{ overflowWrap: 'anywhere' }}>{title}</p>
    <p>{archived ? '此主题及其子主题将从主题列表隐藏，内容仍可搜索和引用。可在数据管理的“已归档”中恢复。'
      : '仅取消此主题的单独归档。随它归档的子主题会恢复，之前单独归档的子主题仍保留归档状态。'}</p>
    {error !== '' && <p role="status" style={{ color: arkmeTheme.secondary }}>{error}</p>}
    <div style={actions}>
      <button type="button" style={button} disabled={busy} onClick={onClose}>{resolved ? '关闭' : '取消'}</button>
      {!resolved && <button type="button" style={button} disabled={busy} onClick={() => { void submit() }}>{busy ? '处理中…' : archived ? '确认归档' : '确认取消归档'}</button>}
    </div>
  </ArkmeTopicDialogFrame>
}

export function ArkmeArchiveAction({ source, style, menu = false }: { source: ArkmeSourceItem; style?: CSSProperties | undefined; menu?: boolean }) {
  const { state, error, refresh } = useArchiveState(source.sourceRef)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => { setOpen(false); refresh() }, [refresh])
  return <>
    <button type="button" role={menu ? 'menuitem' : undefined} style={style ?? button}
      disabled={state?.ownerAvailable !== true || error !== ''} onClick={() => { setOpen(true) }}>
      {state?.selfArchived ? '取消归档' : state?.effectiveArchived ? '单独归档' : '归档'}
    </button>
    {error !== '' && <button type="button" style={button} title={error} onClick={refresh}>重试归档状态</button>}
    {open && state !== undefined && <ArkmeArchiveDialog state={state} title={source.displayName} onClose={close} />}
  </>
}

export function ArkmeArchiveStatus({ source }: { source: ArkmeSourceItem }) {
  const { state } = useArchiveState(source.sourceRef)
  if (state?.effectiveArchived !== true) return null
  return <span role="status" title="内容仍可搜索和引用；在数据管理的已归档中恢复" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>
    {state.selfArchived ? '已归档' : '随父级归档'}
  </span>
}

export function ArkmeArchiveManagementPanel({ close: closeSettings }: { close?: () => void } = {}) {
  const { userId, revision, refresh } = useArchiveRefresh()
  const [items, setItems] = useState<ArkmeArchiveEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ state: ArkmeArchiveState; title: string }>()
  const request = useRef<AbortController>()
  const close = useCallback(() => { setDialog(undefined); refresh() }, [refresh])
  const load = useCallback(async (next?: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const page = await callArkme<ArkmeArchivePage>('archives.list', next === undefined ? {} : { cursor: next }, controller.signal)
      if (controller.signal.aborted) return
      setItems(previous => next === undefined ? page.items : [...new Map([...previous, ...page.items].map(item => [item.sourceRef, item])).values()])
      setCursor(page.nextCursor)
    } catch (caught) { if (!controller.signal.aborted) setError(message(caught)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }, [])
  useEffect(() => {
    setItems([])
    setCursor(undefined)
    setDialog(undefined)
    if (userId !== undefined) void load()
    return () => { request.current?.abort() }
  }, [userId, revision, load])
  const showSource = async (source: NonNullable<ArkmeArchiveState['inheritedFrom']>) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      let cursor: string | undefined
      do {
        const page = await callArkme<ArkmeArchivePage>('archives.list', cursor === undefined ? {} : { cursor }, controller.signal)
        if (controller.signal.aborted) return
        const ancestor = page.items.find(item => item.source.topicHierarchyKey === source.topicHierarchyKey)
        if (ancestor !== undefined) {
          setDialog({ state: ancestor, title: `归档来源：${ancestor.privacyLocked ? '隐私主题' : ancestor.source.displayName}` })
          return
        }
        cursor = page.nextCursor
      } while (cursor !== undefined)
      refresh()

    } catch (caught) { if (!controller.signal.aborted) setError(message(caught)) }
  }
  return <section style={{ padding: 24, color: arkmeTheme.text, maxWidth: 900, boxSizing: 'border-box' }}>
    <h2>数据管理</h2><h3>已归档</h3>
    <p style={{ color: arkmeTheme.secondary }}>归档只影响主题列表。内容仍可搜索和引用。</p>
    <button type="button" style={button} disabled={busy || userId === undefined} onClick={refresh}>刷新</button>
    {userId === undefined && <p>请先登录</p>}
    {error !== '' && <p role="alert">{error}</p>}
    {!busy && error === '' && userId !== undefined && items.length === 0 && <p>暂无已归档主题</p>}
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {items.map(item => <li key={item.sourceRef} style={{ padding: '16px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, overflowWrap: 'anywhere' }}>
        <strong>{item.privacyLocked ? '隐私主题' : item.source.displayName}</strong>
        <p>{item.selfArchived ? '单独归档' : '随父级归档'}{item.selfArchived && item.inheritedFrom !== undefined ? ' · 同时随父级归档' : ''}</p>
        <div style={actions}>
          <button type="button" style={button} disabled={item.privacyLocked} onClick={() => { arkmeUi.selectSource(item.source); closeSettings?.() }}>打开主题</button>
          <button type="button" style={button} onClick={() => { setDialog({ state: item, title: item.source.displayName }) }}>{item.selfArchived ? '取消归档' : '单独归档'}</button>
          {item.inheritedFrom !== undefined && <button type="button" style={button} onClick={() => { void showSource(item.inheritedFrom!) }}>查看归档来源</button>}
        </div>
      </li>)}
    </ul>
    {busy && <p role="status">加载中…</p>}
    {cursor !== undefined && <button type="button" style={button} disabled={busy} onClick={() => { void load(cursor) }}>加载更多</button>}
    {dialog !== undefined && <ArkmeArchiveDialog state={dialog.state} title={dialog.title} onClose={close} />}
  </section>
}
