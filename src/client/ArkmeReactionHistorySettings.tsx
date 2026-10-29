import { useEffect, useRef, useState } from 'react'
import type { ReactionHistoryPolicy, ReactionHistoryPolicyResult } from '../reaction-contract.js'
import { callArkme } from './api.js'
import { useReactionHistory } from './use-reaction-history.js'
import { ReactionLabel } from './ReactionLabel.js'
import { ArkmeSettingsToggleRow } from './ArkmeSettingsToggleRow.js'
import { tr, useArkmeLocale } from './locale.js'

export function ArkmeReactionHistoryLock({ scope }: { scope: string }) {
  useArkmeLocale()
  const [policy, setPolicy] = useState<ReactionHistoryPolicy>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController>()
  const load = async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setPolicy(undefined)
    try { const result = await callArkme<ReactionHistoryPolicy>('reactions', { action: 'history-policy-query', accountKey: scope }, abort.signal); if (!abort.signal.aborted) setPolicy(result) }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : tr('读取失败')) }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  useEffect(() => { void load(); return () => controller.current?.abort() }, [scope])
  const change = async (locked: boolean) => {
    if (!policy || busy) return
    setBusy(true); setError(''); const signal = controller.current!.signal
    try {
      const result = await callArkme<ReactionHistoryPolicyResult>('reactions', { action: 'history-policy-set', accountKey: scope, expected_revision: policy.revision, locked }, signal)
      if (signal.aborted) return
      setPolicy(result.policy)
      window.dispatchEvent(new CustomEvent('arkme-reaction-policy-changed', { detail: scope }))
      if (result.outcome === 'revision_conflict') setError(tr('设置已在其他设备更新，请重新操作'))
    } catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : tr('保存失败')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <ArkmeSettingsToggleRow title={tr('表态记录隐私锁')}
    description={tr('开启后，在数据管理、时间轴和 AI 查询中隐藏你的表态操作记录，不影响消息上的表态。')}
    checked={policy?.locked ?? false} busy={busy} disabled={!policy}
    status={busy ? tr(policy ? '正在保存…' : '读取中…') : undefined}
    feedback={error ? <div className="arkme-settings-toggle-error" role="alert"><span>{error}</span>
      <button type="button" disabled={busy} onClick={() => void load()}>{tr('重试')}</button></div> : undefined}
    onChange={locked => { void change(locked) }} />
}
function HistoryMonth({ scope, month }: { scope: string; month: string }) {
  const [year, number] = month.split('-').map(Number)
  const start = new Date(year!, number!-1, 1).getTime(), end = new Date(year!, number!, 1).getTime()
  const data = useReactionHistory(scope, Number.isFinite(start) ? start : undefined, Number.isFinite(end) ? end : undefined)
  return <>
    {data.busy && <p role="status">加载中…</p>}
    {data.error && <p role="alert">{data.error} <button type="button" onClick={() => void data.load()}>重试</button></p>}
    {!data.busy && !data.error && !data.events.length && <p>这个月没有表态记录</p>}
    <ul>{data.events.map((event,index) => <li key={index}><time>{new Date(event.at).toLocaleString()}</time> · {event.added ? '表态' : '取消表态'} <ReactionLabel label={event.label} /><p>{event.source}{event.text ? ' · '+event.text : ''}</p></li>)}</ul>
    {data.hasMore && <button type="button" disabled={data.busy} onClick={() => void data.load(true)}>加载更多</button>}
  </>
}
export function ArkmeReactionHistoryRecords({ scope }: { scope: string }) {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`)
  const [open, setOpen] = useState(false)
  return <details className="arkme-data-panel" onToggle={event => setOpen(event.currentTarget.open)}><summary>表态操作记录</summary>{open && <><label>月份 <input aria-label="表态记录月份" type="month" value={month} onChange={event => setMonth(event.target.value)} /></label><HistoryMonth key={scope+month} scope={scope} month={month} /></>}</details>
}
