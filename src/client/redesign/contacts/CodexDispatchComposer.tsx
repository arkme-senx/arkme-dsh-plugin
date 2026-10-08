import { useEffect, useRef, useState } from 'react'
import type { CodexDispatchRequest } from '../../../team-codex-dispatch-journal.js'
import { tr, useArkmeLocale } from '../../locale.js'

export type CodexDispatchAvailability = 'ready' | 'integration_pending' | 'helper_unavailable' | 'authorization_required' | 'remote_readonly' | 'blocked'
type DispatchSummary = Pick<CodexDispatchRequest, 'requestId' | 'state' | 'reason' | 'createdAt' | 'updatedAt'>
export interface CodexDispatchComposerProps {
  /** Caller must include the authenticated account AND team/source/task identity. */
  scopeKey: string
  availability: CodexDispatchAvailability
  latest?: DispatchSummary
  submit?(requestId: string, text: string): Promise<DispatchSummary>
  onConnect?: () => void
}
const hints: Record<Exclude<CodexDispatchAvailability, 'ready'>, string> = {
  integration_pending: '助手派发功能接入中，暂不可发送',
  helper_unavailable: '本机助手尚未就绪，暂不能派发',
  authorization_required: '请先在本机助手开启自动输入',
  remote_readonly: '这项任务来自其他电脑，云端派发尚未接通',
  blocked: '当前账号、团队或任务暂不允许派发',
}
export function codexDispatchStatus(value: Pick<CodexDispatchRequest, 'state' | 'reason'>): string {
  if (value.state === 'waiting') {
    const reasons: Record<string, string> = {
      draft_present: '等待 Codex 草稿处理，不会覆盖原文', locked: '等待来源电脑解锁',
      permission_required: '等待本机助手授权', user_active: '等待本机空闲，不打断正在输入',
      codex_unavailable: '等待 Codex 可用', target_unavailable: '等待核对目标对话', executor_restarted: '等待助手恢复',
    }
    return reasons[value.reason] ?? '等待本机助手处理'
  }
  const states: Record<CodexDispatchRequest['state'], string> = {
    pending: '已保存到本机，等待派发', preparing: '正在检查本机状态', waiting: '等待本机助手处理',
    submitting: '正在提交，尚未确认入队', queued_confirmed: 'Codex 已加入队列', accepted_confirmed: 'Codex 已接受',
    unknown: '送达结果待确认，不会自动重发', cancelled: '已停止派发', expired: '请求已过期，未派发',
  }
  return states[value.state]
}

/** Presentation only. Unconnected entry points cannot create dispatch requests. */
export function CodexDispatchComposer(props: CodexDispatchComposerProps) {
  // Destroy drafts and in-flight UI state immediately on account/team/task changes.
  return <ScopedComposer key={props.scopeKey} {...props}/>
}
function ScopedComposer({ availability: requestedAvailability, latest, submit, onConnect }: CodexDispatchComposerProps) {
  useArkmeLocale()
  const availability = requestedAvailability === 'ready' && !submit ? 'blocked' : requestedAvailability
  const connectable = !!onConnect && ['integration_pending', 'helper_unavailable', 'authorization_required'].includes(availability)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<{ id: string; text: string }>()
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [result, setResult] = useState<CodexDispatchComposerProps['latest']>()
  const alive = useRef(true), sending = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const send = async () => {
    if (sending.current || availability !== 'ready' || !submit || !text.trim()) return
    const request = pending ?? { id: crypto.randomUUID(), text }
    sending.current = true; setBusy(true); setPending(request)
    try {
      const receipt = await submit(request.id, request.text)
      if (!alive.current) return
      if (receipt.requestId !== request.id) throw new Error('Mismatched dispatch response')
      setResult(receipt); setText(''); setPending(undefined); setUncertain(false)
    } catch {
      // Retain the SAME ID for an explicit persistence retry; never turn HTTP failure into
      // a second native request or allow editing the old request under the retained ID.
      if (alive.current) setUncertain(true)
    } finally { sending.current = false; if (alive.current) setBusy(false) }
  }
  const displayed = !result ? latest : !latest ? result
    : latest.requestId === result.requestId ? latest.updatedAt >= result.updatedAt ? latest : result
      : latest.createdAt > result.createdAt ? latest : result
  return <div className="arkme-codex-dispatch-composer">
    <form onSubmit={event => { event.preventDefault(); if (connectable) onConnect?.(); else void send() }}>
      <textarea aria-label={tr('输入下一条需求')} placeholder={tr('输入下一条需求…')} rows={2}
        disabled={availability !== 'ready' && !connectable} readOnly={availability !== 'ready' || busy || uncertain} value={text}
        aria-haspopup={connectable ? 'dialog' : undefined}
        onClick={connectable ? onConnect : undefined}
        onKeyDown={event => { if (connectable && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onConnect?.() } }}
        onChange={event => { if (availability === 'ready') { setText(event.target.value); setResult(undefined) } }}/>
      <button type="submit" disabled={!connectable && (availability !== 'ready' || busy || !text.trim())}
        aria-haspopup={connectable ? 'dialog' : undefined}>
        {tr(busy ? '正在保存…' : uncertain ? '重试保存' : '加入队列')}
      </button>
    </form>
    <div className="arkme-codex-dispatch-status" role="status" aria-live="polite">
      {availability === 'ready' && <span>{tr('仅本机验证')}</span>}
      {availability !== 'ready' ? <><span>{tr(hints[availability])}</span>
        {connectable &&
          <button type="button" onClick={onConnect}>{tr('连接助手')}</button>}</>
        : <span>{tr(uncertain ? '保存结果待确认；重试会核对同一请求，不会重复派发'
          : displayed ? codexDispatchStatus(displayed) : '提交时会短暂切换来源电脑的 Codex 窗口')}</span>}
    </div>
  </div>
}
