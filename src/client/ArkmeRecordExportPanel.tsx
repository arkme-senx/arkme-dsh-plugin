import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { FileZip } from '@phosphor-icons/react/dist/icons/FileZip'
import exportCss from './record-export.css?inline'
import { useEffect, useId, useRef, useState } from 'react'
import type { ArkmeExportPreflight, ArkmeRecordExport } from '../data-management.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { legacyRecordExportAvailable, recordExportDateError, recordExportDatePreset, type RecordExportDatePreset, type RecordExportRangeKind } from './record-export-selection.js'

const RANGE_BACKEND_NOTICE = '后端接口开发中，开发完成后此功能完整可用。'

export function ArkmeRecordExportPanel({ scope, preflight, loading = false, onRefresh }: { scope: string; preflight: ArkmeExportPreflight | undefined; loading?: boolean; onRefresh?: () => void }) {
  useArkmeLocale()
  const [order, setOrder] = useState<1 | 2>(1)
  const [range, setRange] = useState<RecordExportRangeKind>('all')
  const [dates, setDates] = useState(() => recordExportDatePreset('month'))
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ArkmeRecordExport>()
  const controller = useRef<AbortController>()
  const id = useId()
  const available = legacyRecordExportAvailable(range, includeAttachments)
  const dateError = range === 'dates' ? recordExportDateError(dates) : ''
  const scopedPreflight = preflight?.accountScope === scope ? preflight : undefined
  const canRun = available && !!scopedPreflight?.canExport && scopedPreflight.recordCount > 0 && !loading
  const locked = busy || confirm || !!result
  useEffect(() => () => controller.current?.abort(), [scope])
  const run = async () => {
    // The legacy protocol cannot filter. Never silently turn a range request
    // into a quota-consuming full export, even after a stale confirmation.
    if (controller.current || !canRun) return
    const current = new AbortController(), sdk = createArkmeSdk()
    controller.current = current
    setConfirm(false); setBusy(true); setError(''); setCount(0); setResult(undefined)
    try {
      const value = await sdk.exportRecords({ expectedAccountScope: scope, orderKind: order, confirmed: true }, current.signal,
        progress => { if (!current.signal.aborted) setCount(progress.count) })
      if (!current.signal.aborted) setResult(value)
    } catch (caught) {
      if (!current.signal.aborted) setError(caught instanceof Error ? caught.message : tr('导出失败，请重试'))
    } finally {
      sdk.dispose()
      if (controller.current === current) { controller.current = undefined; if (!current.signal.aborted) setBusy(false) }
    }
  }
  const cancel = () => {
    controller.current?.abort(); controller.current = undefined
    setBusy(false); setError(tr('导出已取消，未完成的备份已清理。'))
  }
  return <div className="arkme-record-export" aria-busy={busy || loading}>
    <style>{exportCss}</style>
    <div className="arkme-export-intro">
      <p>{tr('将快记与附件保存到本地，随时查看。')}</p>
      {onRefresh && <button type="button" className="arkme-export-refresh" disabled={loading || busy} onClick={onRefresh} aria-label={tr('刷新导出信息')} title={tr('刷新导出信息')}><ArrowClockwise size={17} className={loading ? 'is-spinning' : ''} aria-hidden /></button>}
    </div>
    <div className="arkme-export-option arkme-export-range">
      <label htmlFor={`${id}-range`}>{tr('导出范围')}</label>
      <select id={`${id}-range`} value={range} disabled={locked} onChange={event => { setRange(event.target.value as RecordExportRangeKind); setError('') }}>
        <option value="all">{tr('全部')}</option><option value="dates">{tr('按日期')}</option><option value="incremental">{tr('增量')}</option>
      </select>
    </div>
    {range === 'dates' && <div className="arkme-export-dates" aria-label={tr('导出日期范围')}>
      <div className="arkme-export-date-inputs">
        <label>{tr('开始日期')}<input type="date" value={dates.start} disabled={locked} aria-invalid={!!dateError} aria-describedby={dateError ? `${id}-dates-error` : `${id}-dates-help`} onInput={event => { const start = event.currentTarget.value; setDates(value => ({ ...value, start })) }} onChange={event => setDates(value => ({ ...value, start: event.target.value }))} /></label>
        <span aria-hidden>—</span>
        <label>{tr('结束日期')}<input type="date" value={dates.end} disabled={locked} aria-invalid={!!dateError} aria-describedby={dateError ? `${id}-dates-error` : `${id}-dates-help`} onInput={event => { const end = event.currentTarget.value; setDates(value => ({ ...value, end })) }} onChange={event => setDates(value => ({ ...value, end: event.target.value }))} /></label>
      </div>
      <div className="arkme-export-presets" aria-label={tr('快捷日期')}>
        {([['week', '最近7天'], ['month', '本月'], ['last-month', '上月']] as const).map(([preset, label]) => <button type="button" key={preset} disabled={locked} onClick={() => setDates(recordExportDatePreset(preset as RecordExportDatePreset))}>{tr(label)}</button>)}
      </div>
      <p id={`${id}-dates-help`}>{tr('按记录显示日期筛选，包含结束日期全天。')}</p>
      {dateError && <p id={`${id}-dates-error`} className="arkme-export-error" role="alert">{tr(dateError)}</p>}
    </div>}
    {range === 'incremental' && <div className="arkme-export-incremental" aria-label={tr('增量导出说明')}>
      <strong>{tr('增量进度尚未接通')}</strong>
      <p>{tr('接通后自动选择上次成功保存后新增和修改的内容，包括补录的旧日期记录。')}</p>
      <p>{tr('首次需要建立完整备份；取消或保存失败不会推进进度。增量包需与此前备份一起保留。')}</p>
    </div>}
    {available ? <div className="arkme-export-summary" aria-label={tr('备份内容')}>
      {[{ label: '条快记', count: scopedPreflight?.recordCount }, { label: '张图片', count: scopedPreflight?.imageCount }, { label: '段语音', count: scopedPreflight?.voiceCount }].map(item => <div key={item.label}>
        <strong>{item.count === undefined ? '—' : item.count.toLocaleString(arkmeIntlLocale())}</strong><span>{tr(item.label)}</span>
      </div>)}
    </div> : <p className="arkme-export-pending-count">{tr('接通后将显示本次范围的记录和附件数量。')}</p>}
    <div className="arkme-export-options">
      <div className="arkme-export-option"><label htmlFor={`${id}-attachments`}>{tr('附件')}</label><label className="arkme-export-attachments"><input id={`${id}-attachments`} type="checkbox" checked={includeAttachments} disabled={locked} onChange={event => { setIncludeAttachments(event.target.checked); setError('') }} />{tr('包含图片、语音等附件')}</label></div>
      <div className="arkme-export-option"><span>{tr('备份格式')}</span><span className="arkme-export-format"><FileZip size={18} aria-hidden /> ZIP <span>· Markdown / {tr('附件')}</span></span></div>
      <div className="arkme-export-option"><span id="arkme-export-order-label">{tr('记录顺序')}</span>
        <div className="arkme-export-order" role="radiogroup" aria-labelledby="arkme-export-order-label">
          {([1, 2] as const).map(value => <label key={value} className={order === value ? 'is-selected' : ''}>
            <input type="radio" name={`${id}-order`} value={value} checked={order === value} disabled={locked} onChange={() => setOrder(value)} />
            <span>{tr(value === 1 ? '从新到旧' : '从旧到新')}</span>
          </label>)}
        </div>
      </div>
    </div>
    <p className="arkme-export-notice">{tr('不含隐私锁定内容。')}</p>
    {!available && <p id={`${id}-backend-notice`} className="arkme-export-notice" role="status">{tr(RANGE_BACKEND_NOTICE)} {tr('当前仍可选择全部内容并包含附件进行导出。')}</p>}
    {available && scopedPreflight && !scopedPreflight.canExport && <p className="arkme-export-notice" role="status">{scopedPreflight.message || tr('当前暂不满足导出条件，请稍后重试。')}</p>}
    {available && scopedPreflight?.recordCount === 0 && <p className="arkme-export-notice" role="status">{tr('暂无可导出的记录。')}</p>}
    {error && <p role="alert" className="arkme-export-error">{error}</p>}
    {busy ? <div className="arkme-export-progress" role="status" aria-live="polite">
      <div><span>{tr('正在生成备份')}</span><span>{tr('已读取 {v0} 条', { v0: count })}</span></div>
      <progress aria-label={tr('导出进度')} max={100} value={scopedPreflight?.recordCount ? Math.min(97, count / scopedPreflight.recordCount * 100) : undefined} />
      <div className="arkme-export-progress-footer"><small>{tr('请保持此页面打开')}</small><button type="button" onClick={cancel}>{tr('取消导出')}</button></div>
    </div> : result ? <div className="arkme-export-result" role="status">
      <div className="arkme-export-result-title"><CheckCircle size={20} weight="fill" aria-hidden /><strong>{tr('备份已就绪')}</strong><span>{tr('共 {v0} 条快记', { v0: result.count })}</span></div>
      <div className="arkme-export-file"><FileZip size={26} aria-hidden /><div><strong title={result.fileName}>{result.fileName}</strong><small>{tr('下载链接 1 小时内有效')}</small></div>
        <a className="arkme-export-primary" href={createArkmeSdk().localFileUrl(result.fileRef, true)} download={result.fileName}><DownloadSimple size={16} aria-hidden />{tr('下载备份')}</a>
      </div>
      {!result.quotaFinalized && <p className="arkme-export-notice" role="alert">{tr('备份可正常下载，但导出次数确认暂未完成，请勿重复创建备份。')}</p>}
    </div> : <div className="arkme-export-footer">
      <div><p>{available ? tr('确认导出后将使用导出额度') : tr('接通前不会创建导出任务或使用额度。')}</p>{available && scopedPreflight && scopedPreflight.latestAtMillis > 0 && <small>{tr('最近生成备份：')}{new Date(scopedPreflight.latestAtMillis).toLocaleDateString(arkmeIntlLocale())}</small>}</div>
      <button type="button" className="arkme-export-primary" disabled={!canRun || !!dateError} aria-describedby={!available ? `${id}-backend-notice` : undefined} onClick={() => { if (canRun) setConfirm(true) }}><DownloadSimple size={16} aria-hidden />{tr('导出备份')}</button>
    </div>}
    {confirm && <ArkmeConfirmDialog titleId="arkme-record-export-confirm" title={tr('确认导出完整备份？')}
      description={tr('将导出全部非隐私锁定快记及其附件，并使用导出额度。')}
      confirmLabel={tr('确认导出')} busyLabel={tr('正在导出…')} busy={false} error=""
      onClose={() => setConfirm(false)} onConfirm={() => { void run() }} />}
  </div>
}
