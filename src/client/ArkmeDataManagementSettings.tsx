import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ArkmeDeletedRecord, ArkmeDeletedRecordPage, ArkmeExportPreflight } from '../data-management.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'

export function ArkmeDataManagementSettings() {
  useArkmeLocale()
  const { auth } = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  if (auth?.status !== 'authenticated' || auth.userId === undefined) return <p>{tr("登录后查看数据管理")}</p>
  const scope = `${auth.environment}:${auth.userId}`
  return <DataManagement key={scope} scope={scope} />
}
function DataManagement({ scope }: { scope: string }) {
  useArkmeLocale()
  const [page, setPage] = useState<'home' | 'deleted' | 'import' | 'export'>('home')
  const [revision, setRevision] = useState(0)
  const [deleted, setDeleted] = useState<ArkmeDeletedRecordPage>()
  const [preflight, setPreflight] = useState<ArkmeExportPreflight>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<ArkmeDeletedRecord>()
  const [recovering, setRecovering] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    setError(''); setNotice(''); setConfirm(undefined)
    if (page !== 'deleted' && page !== 'export') { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true); setDeleted(undefined); setPreflight(undefined)
    void (page === 'deleted'
      ? callArkme<ArkmeDeletedRecordPage>('data.deleted', { expectedAccountScope: scope }, controller.signal)
        .then(value => { if (controller.signal.aborted) return; if (value.accountScope !== scope) throw new Error('账号已切换'); setDeleted(value) })
      : callArkme<ArkmeExportPreflight>('data.export.preflight', { expectedAccountScope: scope }, controller.signal)
        .then(value => { if (controller.signal.aborted) return; if (value.accountScope !== scope) throw new Error('账号已切换'); setPreflight(value) }))
      .catch(() => { if (!controller.signal.aborted) setError(page === 'deleted' ? '最近删除暂时无法读取，请重试或在手机端查看。' : '导出信息暂时无法读取，请重试或在手机端查看。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, revision, scope])
  const recover = async () => {
    if (!confirm || recovering) return
    setRecovering(true); setError('')
    try {
      await callArkme('data.recover', { expectedAccountScope: scope, recordUid: confirm.recordUid, version: confirm.version })
      if (!mounted.current) return
      setDeleted(value => value ? { ...value, items: value.items.filter(item => item.recordUid !== confirm.recordUid) } : value)
      setNotice('已恢复'); setConfirm(undefined); arkmeUi.recordChanged(); arkmeUi.chatChanged()
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : '恢复失败，请刷新后重试')
    } finally { if (mounted.current) setRecovering(false) }
  }
  return <section className="arkme-data-settings" data-arkme-settings-page="data" aria-label={tr("数据管理")}>
    <header>{page !== 'home' && <button type="button" className="arkme-data-back" disabled={recovering} onClick={() => setPage('home')}>{tr("‹ 数据管理")}</button>}
      <h2>{({ home: '数据管理', deleted: '最近删除', import: '导入数据', export: '导出数据' })[page]}</h2></header>
    {page === 'home' ? <>
      <p className="arkme-data-hint">{tr("管理、迁入和保留属于你的记录。")}</p>
      <div className="arkme-data-entries">
        <button type="button" onClick={() => setPage('deleted')}><Trash size={20} aria-hidden /><span>{tr("最近删除")}</span><CaretRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => setPage('import')}><ArrowSquareOut size={20} aria-hidden /><span>{tr("导入数据")}</span><CaretRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => setPage('export')}><DownloadSimple size={20} aria-hidden /><span>{tr("导出数据")}</span><CaretRight size={15} aria-hidden /></button>
      </div>
    </> : page === 'import' ? <div className="arkme-data-panel">
      <h3>{tr("在网页中导入")}</h3><p>{tr("与 Flutter 桌面端使用同一个导入页面。请在网页中登录同一账号，再选择要导入的文件。")}</p>
      <a className="arkme-data-primary" href="https://jiwo.cc/import" target="_blank" rel="noopener noreferrer">{tr("打开导入网页 ↗")}</a>
      <small>{tr("不会自动上传文件，也不会通过链接传递你的登录凭证。")}</small>
    </div> : <>
      <button type="button" className="arkme-settings-link" disabled={loading || recovering} onClick={() => setRevision(value => value + 1)}>{loading ? tr("读取中…") : tr("刷新")}</button>
      {error && <p role="alert" className="arkme-data-error">{tr(error)}</p>}
      {notice && <p role="status">{notice}</p>}
      {page === 'deleted' && deleted && <>
        <p className="arkme-data-hint">{deleted.items.length ? `本次显示 ${deleted.items.length} 条${deleted.mayHaveMore ? '，更多记录请在手机端查看' : ''}。` : deleted.unverifiedCount ? tr('部分记录状态无法确认，已隐藏，请刷新或在手机端查看。') : deleted.mayHaveMore ? tr('本次读取范围内暂无可恢复记录，更多记录请在手机端查看。') : tr('暂无最近删除的记录。')}{deleted.items.length > 0 && !!deleted.unverifiedCount && tr('部分记录状态无法确认，已隐藏，请刷新或在手机端查看。')}{tr('浏览不会自动清除数据。')}</p>
        <ul className="arkme-data-deleted-list">{deleted.items.map(item => <li key={item.recordUid}>
          <details><summary>{item.title || item.text.slice(0, 80) || '无文字记录'}<small>{new Date(item.sendAtMillis).toLocaleString(arkmeIntlLocale())}</small></summary>
            <p>{item.text || '此记录无文字内容，附件请在恢复后查看。'}</p>
          </details>
          <button type="button" disabled={recovering || item.version <= 0} onClick={() => { setConfirm(item); setError('') }}>{tr("恢复")}</button>
        </li>)}</ul>
        {confirm && <div className="arkme-data-panel" role="group" aria-label={tr("确认恢复记录")}><p>{tr("恢复“")}{confirm.title || confirm.text.slice(0, 40) || '无文字记录'}”？</p>
          <button type="button" disabled={recovering} onClick={() => { void recover() }}>{recovering ? '正在恢复…' : '确认恢复'}</button>
          <button type="button" disabled={recovering} onClick={() => setConfirm(undefined)}>{tr("取消")}</button>
        </div>}
      </>}
      {page === 'export' && <div className="arkme-data-panel">
        <h3>{tr("完整备份")}</h3>
        {preflight && <><p>{preflight.recordCount} {tr("条快记 ·")} {preflight.voiceCount} {tr("个语音 ·")} {preflight.imageCount} {tr("张图片")}</p>
          {(preflight.message || !preflight.canExport) && <p>{preflight.message || '当前暂不满足导出条件，请在手机端查看。'}</p>}
          {preflight.latestAtMillis > 0 && <small>{tr("最近导出：")}{new Date(preflight.latestAtMillis).toLocaleString(arkmeIntlLocale())}</small>}</>}
        <p>{tr("当前插件尚未接入完整文件打包下载。请先在即我手机端或 Flutter 桌面端的「数据管理 → 导出」完成备份。")}</p>
        <small>{tr("这里只查询导出条件，不会创建导出任务或消耗导出次数。")}</small>
      </div>}
    </>}
  </section>
}
