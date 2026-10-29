import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { FileZip } from '@phosphor-icons/react/dist/icons/FileZip'
import exportCss from './record-export.css?inline'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeExportPreflight, ArkmeRecordExport } from '../data-management.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'

export function ArkmeRecordExportPanel({ scope, preflight, loading = false, onRefresh }: { scope: string; preflight: ArkmeExportPreflight | undefined; loading?: boolean; onRefresh?: () => void }) {
  useArkmeLocale()
  const [order, setOrder] = useState<1 | 2>(1)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ArkmeRecordExport>()
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [scope])
  const run = async () => {
    if (controller.current) return
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
    <div className="arkme-export-summary" aria-label={tr('备份内容')}>
      {[{ label: '条快记', count: preflight?.recordCount }, { label: '张图片', count: preflight?.imageCount }, { label: '段语音', count: preflight?.voiceCount }].map(item => <div key={item.label}>
        <strong>{item.count === undefined ? '—' : item.count.toLocaleString(arkmeIntlLocale())}</strong><span>{tr(item.label)}</span>
      </div>)}
    </div>
    <div className="arkme-export-options">
      <div className="arkme-export-option"><span>{tr('导出范围')}</span><span className="arkme-export-option-value">{tr('全部快记')}<small>{tr('不含隐私锁定内容')}</small></span></div>
      <div className="arkme-export-option"><span>{tr('备份格式')}</span><span className="arkme-export-format"><FileZip size={18} aria-hidden /> ZIP <span>· Markdown / {tr('附件')}</span></span></div>
      <div className="arkme-export-option"><span id="arkme-export-order-label">{tr('记录顺序')}</span>
        <div className="arkme-export-order" role="radiogroup" aria-labelledby="arkme-export-order-label">
          {([1, 2] as const).map(value => <label key={value} className={order === value ? 'is-selected' : ''}>
            <input type="radio" name="arkme-export-order" value={value} checked={order === value} disabled={busy || !!result} onChange={() => setOrder(value)} />
            <span>{tr(value === 1 ? '从新到旧' : '从旧到新')}</span>
          </label>)}
        </div>
      </div>
    </div>
    {preflight && !preflight.canExport && <p className="arkme-export-notice" role="status">{preflight.message || tr('当前暂不满足导出条件，请稍后重试。')}</p>}
    {error && <p role="alert" className="arkme-export-error">{error}</p>}
    {busy ? <div className="arkme-export-progress" role="status" aria-live="polite">
      <div><span>{tr('正在生成备份')}</span><span>{tr('已读取 {v0} 条', { v0: count })}</span></div>
      <progress aria-label={tr('导出进度')} max={100} value={preflight?.recordCount ? Math.min(97, count / preflight.recordCount * 100) : undefined} />
      <div className="arkme-export-progress-footer"><small>{tr('请保持此页面打开')}</small><button type="button" onClick={cancel}>{tr('取消导出')}</button></div>
    </div> : result ? <div className="arkme-export-result" role="status">
      <div className="arkme-export-result-title"><CheckCircle size={20} weight="fill" aria-hidden /><strong>{tr('备份已就绪')}</strong><span>{tr('共 {v0} 条快记', { v0: result.count })}</span></div>
      <div className="arkme-export-file"><FileZip size={26} aria-hidden /><div><strong title={result.fileName}>{result.fileName}</strong><small>{tr('下载链接 1 小时内有效')}</small></div>
        <a className="arkme-export-primary" href={createArkmeSdk().localFileUrl(result.fileRef, true)} download={result.fileName}><DownloadSimple size={16} aria-hidden />{tr('下载备份')}</a>
      </div>
      {!result.quotaFinalized && <p className="arkme-export-notice" role="alert">{tr('备份可正常下载，但导出次数确认暂未完成，请勿重复创建备份。')}</p>}
    </div> : <div className="arkme-export-footer">
      <div><p>{tr('确认导出后将使用导出额度')}</p>{preflight && preflight.latestAtMillis > 0 && <small>{tr('最近导出：')}{new Date(preflight.latestAtMillis).toLocaleDateString(arkmeIntlLocale())}</small>}</div>
      <button type="button" className="arkme-export-primary" disabled={!preflight?.canExport || loading} onClick={() => setConfirm(true)}><DownloadSimple size={16} aria-hidden />{tr('导出备份')}</button>
    </div>}
    {confirm && <ArkmeConfirmDialog titleId="arkme-record-export-confirm" title={tr('确认导出完整备份？')}
      description={tr('将导出全部非隐私锁定快记及其附件，并使用导出额度。')}
      confirmLabel={tr('确认导出')} busyLabel={tr('正在导出…')} busy={false} error=""
      onClose={() => setConfirm(false)} onConfirm={() => { void run() }} />}
  </div>
}
