import { useEffect, useId, useRef, useState } from 'react'
import type { ArkmeArrangementItem, ArkmeArrangementRestoreInput, ArkmeArrangementRestoreResult, ArkmeDeletedArrangementItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeIntlLocale, tr } from './locale.js'

export function ArkmeArrangementRestore({ item, disabled, onRestored, onRefresh }: {
  item: ArkmeDeletedArrangementItem; disabled: boolean; onRestored(item: ArkmeArrangementItem): void; onRefresh(): void
}) {
  const [confirm, setConfirm] = useState<ArkmeArrangementRestoreInput>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [message, setMessage] = useState('')
  const titleId = useId()
  const pending = useRef(false)
  const request = useRef<AbortController>()
  useEffect(() => () => { request.current?.abort(); request.current = undefined }, [])
  async function restore() {
    if (!confirm || pending.current) return
    pending.current = true; setBusy(true); setMessage('')
    const controller = new AbortController(); request.current = controller
    // A deadline only stops waiting; an uncertain write is reconciled by receipt.
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const result = await callArkme<ArkmeArrangementRestoreResult>(unknown ? 'arrangements.restore.result' : 'arrangements.restore', { ...confirm }, controller.signal)
      if (request.current !== controller) return
      if (result.state === 'completed' && result.item?.arrangementRef === item.arrangementRef) {
        setConfirm(undefined); onRestored(result.item)
        window.dispatchEvent(new Event('arkme-arrangement-occurrences-changed'))
      } else if (result.state === 'conflict' || result.state === 'superseded') {
        setConfirm(undefined); setOpen(false); setUnknown(false); setMessage(tr('安排状态已变化，请刷新查看')); onRefresh()
      } else {
        setUnknown(true); setMessage(tr('恢复结果尚未确认，请查询结果；不要重复恢复。'))
      }
    } catch {
      if (request.current === controller) { setUnknown(true); setMessage(tr('恢复结果尚未确认，请查询结果；不要重复恢复。')) }
    } finally {
      clearTimeout(timer)
      if (request.current === controller) { pending.current = false; setBusy(false) }
    }
  }
  const capability = item.restore
  const status = capability ? ({ identified: '已识别', following: '跟进中', completed: '已完成' })[capability.targetStatus] : ''
  const due = item.dueAtMillis ? new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(item.dueAtMillis) : tr('未设置')
  return <>
    <button type="button" disabled={disabled || busy || !capability} onClick={() => {
      if (!capability) return
      setConfirm(previous => previous ?? { arrangementRef: item.arrangementRef, requestId: crypto.randomUUID(), expectedVersion: capability.expectedVersion })
      setMessage(''); setOpen(true)
    }}>{tr(unknown ? '查询恢复结果' : '恢复安排')}</button>
    {!disabled && !capability && <p role="status">{tr('当前服务暂不支持恢复，请稍后重试。')}</p>}
    {message && !open && <p role="status">{message}</p>}
    {open && confirm && <ArkmeConfirmDialog titleId={titleId} title={tr('恢复安排')} busy={busy}
      description={<>{tr('恢复后状态：{status}', { status: tr(status) })}<br />{tr('安排时间保持不变：{time}', { time: due })}<br />{tr('提醒默认关闭，不会补发过期提醒。')}
        {capability?.historicalFallback && <><br />{tr('历史记录未保存删除前状态，将恢复为跟进中。')}</>}</>}
      confirmLabel={tr(unknown ? '查询恢复结果' : '确认恢复')} busyLabel={tr(unknown ? '正在查询…' : '正在恢复…')} confirmTone="primary"
      {...(message ? { error: message } : {})}
      onClose={() => { setOpen(false); if (!unknown) setConfirm(undefined) }}
      onConfirm={() => { void restore() }} />}
  </>
}
