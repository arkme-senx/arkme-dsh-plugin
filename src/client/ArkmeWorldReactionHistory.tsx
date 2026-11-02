import { WorldManagementStyles, WorldEmpty, worldManagementTime } from './world-management-ui.js'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactionSetResult, ReactionTargetRef } from '../reaction-contract.js'
import type { WorldReactionHistoryEvent, WorldReactionHistoryPage, WorldReactionNotificationPage } from '../world-reaction-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeReactionSelections } from './ArkmeReactionPreview.js'
import { ReactionLibraryStore } from './reaction-library.js'
import { ReactionPreviewStore } from './reaction-preview-store.js'
import { ReactionLabel } from './ReactionLabel.js'
import { expressionIdentity, expressionLabel } from './reaction-expression.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr, useArkmeLocale } from './locale.js'

export function ArkmeWorldReactionHistory({ onClose }: { onClose(): void }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  return <ArkmeDetailShell title={tr('世界表态')} label={tr('世界表态记录')} style={{ top: 0 }} onClose={onClose}>
    {scope ? <WorldReactionHistoryContent key={scope} scope={scope} /> : <p>{tr('请先登录')}</p>}
  </ArkmeDetailShell>
}
export function WorldReactionArchive({ scope, target, title = '世界表态归档' }: { scope: string; target: ReactionTargetRef; title?: string }) {
  const store = useMemo(() => { const value = new ReactionPreviewStore((input, signal) => callArkme('world.reactions.archive', input, signal), new ReactionLibraryStore()); value.setScope(scope); return value }, [scope, target.id])
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    store.setScope(scope)
    const release = store.watch(scope, { ...target, source: '世界', text: '' })
    return () => { release(); store.setScope(undefined) }
  }, [store, scope, target.id, target.worldRecordRef])
  const snapshot = store.snapshot(target.id)
  const error = store.error(target.id)
  return <section className="wm wm-archive" aria-label={tr('世界表态归档')}>
    <WorldManagementStyles /><div className="wm-spread"><div className="wm-heading"><Archive size={17} /><strong className="wm-title">{tr(title)}</strong></div><span className="wm-badge">{tr('只读')}</span></div>
    {error ? <p className="wm-notice" role="alert">{error}</p> : !snapshot && <p className="wm-muted" role="status">{tr('正在读取表态…')}</p>}
    {snapshot?.actor_count !== undefined && <p className="wm-archive-count">{tr('该版本目前保留 {v0} 人的表态', { v0: snapshot.actor_count })}</p>}
    <ArkmeReactionSelections scope={scope} target={{ ...target, source: '世界', text: '' }} store={store} readOnly />
  </section>
}

export function WorldReactionHistoryContent({ scope }: { scope: string }) {
  useArkmeLocale()
  const [mode, setMode] = useState<'history' | 'received' | 'notifications'>('history')
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [history, setHistory] = useState<WorldReactionHistoryPage>(), [notices, setNotices] = useState<WorldReactionNotificationPage>()
  const [archive, setArchive] = useState<ReactionTargetRef>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>(), write = useRef<AbortController>()
  const pending = useRef<{ event: WorldReactionHistoryEvent; requestId: string }>()
  const load = async (more = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try {
      if (mode === 'notifications') {
        const page = await withArkmeReadDeadline(signal => callArkme<WorldReactionNotificationPage>('world.reactions', { accountKey: scope, action: mode, limit: 50, include_read: true, ...(more ? { after_id: notices?.after_id } : {}) }, signal), controller.signal)
        if (!controller.signal.aborted) setNotices(page)
      } else {
        const [year, number] = month.split('-').map(Number)
        const page = await withArkmeReadDeadline(signal => callArkme<WorldReactionHistoryPage>('world.reactions', { accountKey: scope, action: mode, limit: 50,
          ...(mode === 'history' ? { start_at: new Date(year!, number!-1, 1).getTime(), end_at: new Date(year!, number!, 1).getTime() } : { world_only: true }),
          ...(more ? { before_at: history?.before_at, before_id: history?.before_id } : {}) }, signal), controller.signal)
        if (!controller.signal.aborted) setHistory(page)
      }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tr('读取失败')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { setHistory(undefined); setNotices(undefined); setArchive(undefined); pending.current = undefined; void load(); return () => { request.current?.abort(); write.current?.abort() } }, [scope, mode, month])
  useEffect(() => {
    const clear = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== scope) return
      request.current?.abort(); write.current?.abort(); pending.current = undefined
      setHistory(undefined); setNotices(undefined); setArchive(undefined); setBusy(false)
      void load()
    }
    window.addEventListener('arkme-reaction-policy-changed', clear)
    return () => window.removeEventListener('arkme-reaction-policy-changed', clear)
  }, [scope, mode, month])
  const retract = async (event: WorldReactionHistoryEvent) => {
    if (busy || !event.state) return
    if (pending.current && pending.current.event.event_uid !== event.event_uid) {
      setError(tr('上一次取消结果尚未确认，请先重试该条记录'))
      return
    }
    const operation = pending.current?.event.event_uid === event.event_uid ? pending.current : { event, requestId: crypto.randomUUID() }
    pending.current = operation
    const controller = new AbortController(); write.current = controller; setBusy(true); setError('')
    try {
      const result = await withArkmeReadDeadline(signal => callArkme<ReactionSetResult>('world.reactions', { accountKey: scope, action: 'set', target: operation.event.target, expression: operation.event.expression, active: false, expected_revision: operation.event.state!.revision, request_id: operation.requestId }, signal), controller.signal)
      if (controller.signal.aborted) return
      pending.current = undefined
      setHistory(page => page && ({ ...page, items: page.items.map(item => item.target_id === event.target_id ? { ...item, state: result.state } : item) }))
      if (result.outcome === 'revision_conflict') setError(tr('表态已在其他设备更新，请核对后重试'))
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tr('取消失败，请重试')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const acknowledge = async (item: WorldReactionNotificationPage['items'][number]) => {
    if (busy) return
    const controller = new AbortController(); write.current = controller; setBusy(true); setError('')
    try {
      await withArkmeReadDeadline(signal => callArkme('world.reactions', { accountKey: scope, action: 'notifications-read', items: [{ id: item.id, revision: item.revision }] }, signal), controller.signal)
      if (!controller.signal.aborted) setNotices(page => page && ({ ...page, items: page.items.map(n => n.id === item.id && n.revision === item.revision ? { ...n, unread: false } : n) }))
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tr('保存失败')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  if (archive) return <div className="wm"><WorldManagementStyles /><button className="wm-button" data-kind="quiet" type="button" onClick={() => setArchive(undefined)}>{tr('返回表态记录')}</button><WorldReactionArchive key={archive.id} scope={scope} target={archive} /></div>
  return <div className="wm"><WorldManagementStyles />
    <nav className="wm-tabs" aria-label={tr('世界表态分类')}>{(['history', 'received', 'notifications'] as const).map(tab => <button className="wm-tab" type="button" key={tab} aria-current={mode === tab ? 'page' : undefined} disabled={busy} onClick={() => setMode(tab)}>{tr(tab === 'history' ? '我的表态' : tab === 'received' ? '收到的表态' : '表态提醒')}</button>)}</nav>
    <div className="wm-toolbar" style={{ marginTop:16 }}>
      {mode === 'history' ? <label className="wm-muted">{tr('月份')} <input className="wm-month" type="month" aria-label={tr('世界表态月份')} value={month} disabled={busy} onChange={event => setMonth(event.target.value)} /></label> : <span className="wm-muted">{tr(mode === 'received' ? '你的世界收到的表态' : '世界互动提醒')}</span>}
      <button className="wm-button wm-icon-button" data-kind="quiet" type="button" aria-label={tr('刷新')} title={tr('刷新')} disabled={busy} onClick={() => void load()}><ArrowClockwise size={17} /></button>
    </div>
    {busy && <p role="status" className="wm-notice">{tr('加载中…')}</p>}{error && <p role="alert" className="wm-notice">{error}</p>}
    {mode === 'notifications' ? <ul className="wm-history">{notices?.items.map(item => <li key={item.id}>
      <div className="wm-actions">{item.unread && <span className="wm-unread" aria-label={tr('未读')} />}{item.selections.map(selected => <ReactionLabel key={selected.key} label={expressionLabel(selected.expression)} />)}</div>
      <div className="wm-actions" style={{ marginTop:12 }}><button className="wm-button" type="button" onClick={() => setArchive(item.target)}>{tr('查看表态归档')}</button>
      {item.unread && <button className="wm-button" data-kind="quiet" type="button" disabled={busy} onClick={() => void acknowledge(item)}>{tr('标记已读')}</button>}</div>
    </li>)}</ul> : <ul className="wm-history">{history?.items.map(event => <li key={event.event_uid}>
      <div className="wm-spread"><span className="wm-history-action">{tr(mode === 'history' ? event.active ? '我添加了表态' : '我取消了表态' : event.active ? '对方添加了表态' : '对方取消了表态')} <ReactionLabel label={expressionLabel(event.expression)} /></span><time className="wm-caption" dateTime={new Date(event.at).toISOString()}>{worldManagementTime(event.at)}</time></div>
      {event.restricted && <p className="wm-muted">{tr('该版本内容已不可访问')}</p>}
      {mode === 'history' && event.active && event.state && !event.state.selections.some(selected => expressionIdentity(selected.expression) === expressionIdentity(event.expression)) && <span className="wm-caption">{tr('当前已取消')}</span>}

      {mode === 'received' ? <button className="wm-button" type="button" onClick={() => setArchive(event.target)}>{tr('查看表态归档')}</button>
        : event.active && event.state?.selections.some(selected => expressionIdentity(selected.expression) === expressionIdentity(event.expression)) && <button className="wm-button" data-kind="quiet" type="button" disabled={busy} onClick={() => void retract(event)}>{tr('取消我的表态')}</button>}
    </li>)}</ul>}
    {(mode === 'notifications' ? notices?.has_more : history?.has_more) && <button className="wm-button" type="button" disabled={busy} onClick={() => void load(true)}>{tr('下一页')}</button>}
    {!busy && !error && (mode === 'notifications' ? notices?.items.length === 0 : history?.items.length === 0) && <WorldEmpty icon={<ChatCircle size={24} />} title={tr('暂无记录')}>{tr('世界中的表态与提醒会显示在这里。')}</WorldEmpty>}
  </div>
}
