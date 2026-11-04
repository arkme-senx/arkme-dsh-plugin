import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactionTargetRef } from '../reaction-contract.js'
import type { WorldReactionContext, WorldReactionContextPage, WorldReactionVersionsPage } from '../world-reaction-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeReactionSelections } from './ArkmeReactionPreview.js'
import { ReactionPreviewStore } from './reaction-preview-store.js'
import { ReactionLibraryStore } from './reaction-library.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'

export function WorldReactionArchive({ accountKey, context }: { accountKey: string; context: WorldReactionContext }) {
  const [current, setCurrent] = useState<WorldReactionContext | undefined>(context)
  const [page, setPage] = useState<WorldReactionVersionsPage>(), [selected, select] = useState<ReactionTargetRef>()
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const load = async (cursor?: string, renew = false) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError('')
    try {
      let activeContext = current ?? context
      if (renew) {
        setCurrent(undefined); setPage(undefined); select(undefined)
        const prepared = await callArkme<WorldReactionContextPage>('world.reactions.prepare', { accountKey, recordRefs: [context.recordRef] }, abort.signal)
        if (abort.signal.aborted) return
        const refreshed = prepared.items.find(item => item.recordRef === context.recordRef)
        if (!refreshed) throw Error(tr('当前无法读取这份原件的世界归档'))
        activeContext = refreshed; setCurrent(refreshed)
      }
      const result = await callArkme<WorldReactionVersionsPage>('world.reactions.versions', { accountKey, target: activeContext.target, limit: 10, ...(cursor ? { cursor } : {}) }, abort.signal)
      if (!abort.signal.aborted) setPage(result)
    } catch (error) { if (!abort.signal.aborted) { setPage(undefined); select(undefined); setError(error instanceof Error ? error.message : tr('归档读取失败')) } }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    setCurrent(context); void load()
    const refresh = () => void load(undefined, true)
    window.addEventListener('focus', refresh); window.addEventListener('arkme-reaction-policy-changed', refresh)
    return () => { controller.current?.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('arkme-reaction-policy-changed', refresh) }
  }, [accountKey, context.target.worldRecordRef])
  const versions = page?.items.filter(target => target.id !== current?.target.id) ?? []
  return <section aria-label={tr('世界表态归档')} style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${c.borderSoft}` }}>
    <strong style={{ fontSize: 13 }}>{tr('世界表态')}</strong>
    {current && <><p style={{ color: c.secondary, fontSize: 12 }}>{tr(current.visibility === 'unpublished' ? '当前版本 · 已取消公开' : '当前版本')}</p>
    <ArchiveSelections accountKey={accountKey} target={current.target} onRetry={() => void load(undefined, true)} /></>}
    {(versions.length > 0 || page?.hasMore || open) && <details open={open} onToggle={event => setOpen(event.currentTarget.open)} style={{ marginTop: 12 }}>
      <summary>{tr('历史版本')}</summary>
      {versions.map((target, index) => <button type="button" style={actionStyle} key={target.id} aria-pressed={selected?.id === target.id} onClick={() => select(target)}>{tr('归档 {v0}', { v0: index + 1 })}</button>)}
      {selected && <ArchiveSelections key={selected.id} accountKey={accountKey} target={selected} onRetry={() => void load(undefined, true)} />}
      {page?.hasMore && <button type="button" style={actionStyle} disabled={busy} onClick={() => { select(undefined); void load(page.nextCursor) }}>{tr('下一页')}</button>}
      <button type="button" style={actionStyle} disabled={busy} onClick={() => { select(undefined); void load() }}>{tr('返回第一页')}</button>
    </details>}
    {error && <p role="alert" style={{ fontSize: 12, color: c.secondary }}>{error} <button type="button" style={actionStyle} disabled={busy} onClick={() => void load(undefined, true)}>{tr('重试')}</button></p>}
  </section>
}
function ArchiveSelections({ accountKey, target, onRetry }: { accountKey: string; target: ReactionTargetRef; onRetry(): void }) {
  const store = useMemo(() => new ReactionPreviewStore((input, signal) => callArkme('world.reactions.archive', input, signal), new ReactionLibraryStore()), [accountKey, target.id, target.worldRecordRef])
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { store.setScope(accountKey); const release = store.watch(accountKey, { ...target, source: '世界', text: '' }); return () => { release(); store.setScope(undefined) } }, [store, accountKey, target.worldRecordRef])
  const snapshot = store.snapshot(target.id), error = store.error(target.id)
  return <div>
    {error ? <p role="alert">{error} <button type="button" style={actionStyle} onClick={onRetry}>{tr('重试')}</button></p> : !snapshot ? <p role="status">{tr('正在读取表态…')}</p> : <>
      <ArkmeReactionSelections scope={accountKey} target={{ ...target, source: '世界', text: '' }} store={store} readOnly />
      <small style={{ color: c.secondary }}>{tr('{v0} 人表态', { v0: snapshot.actor_count ?? 0 })}</small>
    </>}
  </div>
}

/** The owned original is authoritative; a private source cannot inherit its public copy's archive. */
export function NoteWorldReactionArchive({ sourceRef, messageActionRef }: { sourceRef: string; messageActionRef: string }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const key = JSON.stringify([accountKey, sourceRef, messageActionRef])
  const [state, setState] = useState<{ key: string; context?: WorldReactionContext; error?: string }>()
  const [attempt, retry] = useState(0)
  const knownOriginal = useRef<string>()
  useEffect(() => {
    if (!accountKey) return
    const controller = new AbortController()
    void callArkme<WorldReactionContextPage>('world.reactions.from-note', { accountKey, sourceRef, messageActionRef }, controller.signal)
      .then(page => { if (!controller.signal.aborted) { if (page.items[0]) knownOriginal.current = key; setState({ key, ...(page.items[0] ? { context: page.items[0] } : {}) }) } })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : tr('世界表态读取失败') }) })
    return () => controller.abort()
  }, [key, attempt])
  if (state?.key !== key) return null
  if (state.error && knownOriginal.current !== key) return null
  if (state.error) return <p role="alert">{state.error} <button type="button" style={actionStyle} onClick={() => retry(value => value + 1)}>{tr('重试')}</button></p>
  return state.context ? <WorldReactionArchive key={key} accountKey={accountKey} context={state.context} /> : null
}

const actionStyle = { padding: '6px 8px', border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 12 }
