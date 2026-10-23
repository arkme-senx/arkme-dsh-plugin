import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArkoMessageImages } from './ArkoImageAttachments.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr } from './locale.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkoLifecycleSync } from './arko-lifecycle-sync.js'
import type { ArkmeArkoDeletedPage, ArkmeArkoLifecycleCommand, ArkmeArkoLifecycleItem, ArkmeArkoLifecycleResult, ArkmeArkoLifecycleSnapshot } from '../arko-lifecycle-contract.js'

const retentionDescription = '删除的消息将放入「数据管理 → 最近删除」，30 天内可恢复，之后自动清空。'
const text = (error: unknown) => error instanceof Error ? error.message : '暂时无法确认消息状态，请重试'
const succeeded = (result: string) => ['applied', 'already_applied', 'already_deleted', 'already_active'].includes(result)

export function ArkoMessageDeletionDialog({ messageRefs, onClose, onFacts, onPending }: {
  messageRefs: readonly string[]; onClose(): void; onFacts(items: ArkmeArkoLifecycleItem[], settledKeys?: readonly string[]): void; onPending?(items: ArkmeArkoLifecycleItem[]): void
}) {
  const [facts, setFacts] = useState<ArkmeArkoLifecycleItem[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [unknown, setUnknown] = useState(false)
  const controller = useRef<AbortController>()
  const pendingVersions = useRef(new Map<string, number>())
  const refKey = JSON.stringify(messageRefs)
  useEffect(() => {
    const read = new AbortController(); controller.current = read
    setBusy(true)
    void callArkme<ArkmeArkoLifecycleSnapshot>('arko.lifecycle.query', { messageRefs }, read.signal)
      .then(result => { if (!read.signal.aborted) setFacts(result.items) })
      .catch(error => { if (!read.signal.aborted) setNotice(text(error)) })
      .finally(() => { if (!read.signal.aborted) setBusy(false) })
    return () => read.abort()
  }, [refKey])
  useEffect(() => () => controller.current?.abort(), [])
  const confirm = async () => {
    if (busy) return
    const read = new AbortController(); controller.current = read; setBusy(true); setNotice('')
    try {
      if (unknown || !facts.length) {
        const result = await callArkme<ArkmeArkoLifecycleSnapshot>('arko.lifecycle.query', { messageRefs }, read.signal)
        if (read.signal.aborted) return
        setFacts(result.items)
        const settled = result.items.filter(item => item.state !== 'active' || item.version > (pendingVersions.current.get(item.messageKey) ?? -1)).map(item => item.messageKey)
        for (const key of settled) pendingVersions.current.delete(key)
        onFacts(result.items, settled)
        // Same-version active state cannot prove that a timed-out write failed.
        setUnknown(pendingVersions.current.size > 0)
        setNotice(tr(pendingVersions.current.size ? '操作结果尚未确认，请稍后核对状态' : '已核对当前状态，请确认剩余消息后再操作'))
        if (result.items.every(item => item.state !== 'active')) onClose()
        return
      }
      const targets = facts.filter(item => item.state === 'active' && !item.deleteBlockedReason).map(item => ({ messageRef: item.messageRef, expectedVersion: item.version }))
      if (!targets.length) return
      const pending = facts.filter(item => targets.some(target => target.messageRef === item.messageRef))
      pendingVersions.current = new Map(pending.map(item => [item.messageKey, item.version]))
      onPending?.(pending)
      const command: ArkmeArkoLifecycleCommand = { action: 'delete', operationUid: crypto.randomUUID(), targets }
      const result = await callArkme<ArkmeArkoLifecycleResult>('arko.lifecycle.change', command as unknown as Record<string, unknown>, read.signal)
      if (read.signal.aborted) return
      const settled = result.items.filter(item => item.result !== 'unknown').map(item => item.messageKey)
      for (const key of settled) pendingVersions.current.delete(key)
      onFacts(result.items, settled); setFacts(current => current.map(item => result.items.find(next => next.messageKey === item.messageKey) ?? item))
      arkoLifecycleSync.invalidate()
      const unresolved = result.items.filter(item => item.result === 'unknown').length
      const failed = result.items.filter(item => !succeeded(item.result)).length
      setUnknown(unresolved > 0)
      if (!failed && targets.length === facts.length) onClose()
      else setNotice(unresolved ? tr('部分消息的操作结果尚未确认，请核对状态') : tr('部分消息未能删除，已保留；请核对当前状态'))
    } catch (error) { if (!read.signal.aborted) { setUnknown(true); setNotice(text(error)) } }
    finally { if (!read.signal.aborted) setBusy(false) }
  }
  const blocked = facts.filter(item => item.deleteBlockedReason).length
  return <ArkmeConfirmDialog titleId="arkme-arko-delete-title" title={tr('删除所选 {v0} 条 Arko 消息？', { v0: String(messageRefs.length) })}
    description={<>{tr(retentionDescription)}{blocked > 0 && <p role="status">{tr('部分消息仍在生成或状态暂不可确认，将保留这些消息')}</p>}{notice && <p role="status">{notice}</p>}</>}
    confirmLabel={unknown || !facts.length ? tr('核对状态') : tr('确认删除')} busyLabel={tr('处理中…')} confirmTone="danger"
    confirmDisabled={busy || (!unknown && facts.length > 0 && !facts.some(item => item.state === 'active' && !item.deleteBlockedReason))} busy={busy}
    onClose={onClose} onConfirm={() => { void confirm() }} />
}

export function ArkoDeletedMessagesNotice() {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const scope = auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : ''
  const [page, setPage] = useState<ArkmeArkoDeletedPage>({ items: [], hasMore: false })
  const [loaded, setLoaded] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const [revision, setRevision] = useState(0)
  const generation = useSyncExternalStore(arkoLifecycleSync.subscribe, arkoLifecycleSync.snapshot, arkoLifecycleSync.snapshot)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [unknown, setUnknown] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => { setCursor(undefined); setSelected(new Set()); setConfirm(false); setUnknown(false); setPage({ items: [], hasMore: false }) }, [scope])
  useEffect(() => {
    if (!scope) return
    const read = new AbortController(); controller.current = read; setBusy(true); setLoaded(false); setNotice('')
    void callArkme<ArkmeArkoDeletedPage>('arko.deleted', { ...(cursor ? { cursor } : {}) }, read.signal)
      .then(result => { if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean') throw new Error(tr('消息内容暂不可查看')); if (!read.signal.aborted) { setPage(result); setLoaded(true); setSelected(new Set()); setConfirm(false); setUnknown(false) } })
      .catch(error => { if (!read.signal.aborted) setNotice(text(error)) })
      .finally(() => { if (!read.signal.aborted) setBusy(false) })
    return () => read.abort()
  }, [scope, cursor, revision, generation])
  useEffect(() => () => controller.current?.abort(), [scope])
  // A loaded recycle-bin page must stop exposing content at the displayed
  // deadline even while offline. One deadline timer, cancelled with this page.
  useEffect(() => {
    const deadlines = page.items.map(item => item.purgeAtMillis).filter(at => at > 0)
    if (!deadlines.length) return
    const timer = setTimeout(() => {
      setPage(current => ({ ...current, items: current.items.filter(item => item.purgeAtMillis > Date.now()) }))
      setSelected(new Set()); setConfirm(false)
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now())))
    return () => clearTimeout(timer)
  }, [page])
  const restore = async () => {
    const read = new AbortController(); controller.current = read; setBusy(true)
    try {
      const result = await callArkme<ArkmeArkoLifecycleResult>('arko.lifecycle.change', { action: 'restore', operationUid: crypto.randomUUID(),
        targets: page.items.filter(item => selected.has(item.messageKey)).map(item => ({ messageRef: item.messageRef, expectedVersion: item.version })) }, read.signal)
      if (read.signal.aborted) return
      const unknownCount = result.items.filter(item => item.result === 'unknown').length
      setUnknown(unknownCount > 0)
      setNotice(unknownCount ? tr('部分恢复结果尚未确认，请刷新核对') : result.items.every(item => succeeded(item.result)) ? tr('已恢复所选消息') : tr('部分消息未能恢复，请刷新核对期限和状态'))
      setConfirm(false); arkoLifecycleSync.invalidate()
    } catch (error) { if (!read.signal.aborted) { setUnknown(true); setConfirm(false); setNotice(text(error)) } }
    finally { if (!read.signal.aborted) setBusy(false) }
  }
  return <section className="arkme-data-panel" aria-label={tr('Arko 对话消息')}>
    <strong>{tr('Arko 对话消息')}</strong><p>{tr(retentionDescription)}</p>
    {notice && <p role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>{busy ? tr('读取中…') : tr('刷新核对')}</button>
    {!!page.items.length && <button type="button" disabled={busy || unknown} onClick={() => setSelected(selected.size === page.items.length ? new Set() : new Set(page.items.map(item => item.messageKey)))}>{tr('选择本页')}</button>}
    {loaded && !busy && !page.items.length && <p>{tr('暂无最近删除的 Arko 消息')}</p>}
    <ul className="arkme-data-deleted-list">{page.items.map(item => <li key={item.messageKey}>
      <label><input type="checkbox" checked={selected.has(item.messageKey)} disabled={busy || unknown} aria-label={tr('选择消息')} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(item.messageKey)) next.delete(item.messageKey); else next.add(item.messageKey); return next })} />{!item.message ? tr('消息') : item.message.role === 'user' ? tr('提问') : tr('回复')}</label>
      <details><summary>{item.message?.text.slice(0, 80) || tr('消息内容暂不可查看')}<small>{tr('删除时间')} · {new Date(item.deletedAtMillis).toLocaleString()} · {tr('自动清空时间')} · {new Date(item.purgeAtMillis).toLocaleString()}</small></summary>
        {item.message && <small>{tr('来源')}：{item.message.sourceType === 1 ? tr('历史助手') : 'Agent'} · {tr('原会话')}：{item.message.sessionId} · {tr('发送时间')}：{new Date(item.message.createdAtMillis).toLocaleString()}</small>}
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.message?.text}</p>
        {item.message?.contentBlocks && <ArkoMessageImages blocks={item.message.contentBlocks} />}
      </details>
    </li>)}</ul>
    <button type="button" disabled={!selected.size || busy || unknown} onClick={() => setConfirm(true)}>{tr('恢复所选消息')}</button>
    {cursor && <button type="button" disabled={busy} onClick={() => setCursor(undefined)}>{tr('返回最新')}</button>}
    {page.hasMore && <button type="button" disabled={busy} onClick={() => setCursor(page.nextCursor)}>{tr('下一页')}</button>}
    {confirm && <ArkmeConfirmDialog titleId="arko-restore-title" title={tr('恢复所选消息？')} description={tr('消息将回到原会话、原时间位置。')} confirmLabel={tr('确认恢复')} busyLabel={tr('恢复中…')} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => { void restore() }} />}
  </section>
}
