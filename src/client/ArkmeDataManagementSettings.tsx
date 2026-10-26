import { ArkmeArchiveManagementPanel } from './ArkmeArchive.js'
import { readDeletedItems, deletedItemRecovery, type DeletedItem, type DeletedItemsPage } from './data-deleted-items.js'
import { arkoLifecycleSync } from './arko-lifecycle-sync.js'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import type { ArkmeExportPreflight } from '../data-management.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { copyText } from './clipboard-text.js'

const OPEN_PLATFORM_DOCS_URL = 'https://openapi.jotmo.cc/docs'
const OPEN_PLATFORM_AGENT_GUIDE_URL = 'https://openapi.jotmo.cc/docs/mcp/agent'

function OpenPlatformEntry() {
  useArkmeLocale()
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const copyGuide = async () => {
    if (copyState === 'copying') return
    setCopyState('copying')
    try {
      await copyText(OPEN_PLATFORM_AGENT_GUIDE_URL)
      if (mounted.current) setCopyState('copied')
    } catch {
      if (mounted.current) setCopyState('error')
    }
  }
  return <section className="arkme-data-open-platform" aria-label={tr('开放平台')}>
    <p className="arkme-data-open-platform-label">{tr('开放平台')}</p>
    <h3>{tr('让其他 AI 使用你的即我数据')}</h3>
    <p className="arkme-data-hint">{tr('将记录、录音转写、对话和安排接入其他 AI 助手或自己的应用。')}</p>
    <div className="arkme-data-open-platform-actions">
      <a href={OPEN_PLATFORM_DOCS_URL} target="_blank" rel="noopener noreferrer">
        {tr('前往开放平台')}<ArrowSquareOut size={16} aria-hidden />
      </a>
      <button type="button" disabled={copyState === 'copying'} onClick={() => { void copyGuide() }}>
        <Copy size={16} aria-hidden /><span aria-live="polite">{copyState === 'copied' ? tr('已复制') : tr('复制 Agent 接入指南')}</span>
      </button>
    </div>
    {copyState === 'error' && <p className="arkme-data-error" role="alert">
      {tr('复制失败，请打开指南后复制链接。')}{' '}
      <a href={OPEN_PLATFORM_AGENT_GUIDE_URL} target="_blank" rel="noopener noreferrer">{tr('查看接入指南')}</a>
    </p>}
  </section>
}

export function ArkmeDataManagementSettings({ close }: { close?: () => void } = {}) {
  useArkmeLocale()
  const { auth } = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  if (auth?.status !== 'authenticated' || auth.userId === undefined) return <p>{tr("登录后查看数据管理")}</p>
  const scope = `${auth.environment}:${auth.userId}`
  return <DataManagement key={scope} scope={scope} close={close} />
}
function DataManagement({ scope, close }: { scope: string; close?: (() => void) | undefined }) {
  useArkmeLocale()
  const [page, setPage] = useState<'home' | 'archived' | 'deleted' | 'import' | 'export'>('home')
  const [revision, setRevision] = useState(0)
  const [deleted, setDeleted] = useState<DeletedItemsPage>()
  const [preflight, setPreflight] = useState<ArkmeExportPreflight>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<DeletedItem>()
  const confirmation = useRef<HTMLDivElement>(null)
  const [recovering, setRecovering] = useState(false)
  const mounted = useRef(true)
  const recoveryController = useRef<AbortController>()
  const recovery = useRef<{ key: string; run: ReturnType<typeof deletedItemRecovery> }>()
  const lifecycleGeneration = useSyncExternalStore(arkoLifecycleSync.subscribe, arkoLifecycleSync.snapshot, arkoLifecycleSync.snapshot)
  const deletedGeneration = page === 'deleted' ? lifecycleGeneration : 0
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recoveryController.current?.abort() } }, [])
  useEffect(() => { setError(''); setNotice(''); setConfirm(undefined) }, [page, revision])
  // Focus also brings the existing confirmation into view below a long list.
  useLayoutEffect(() => { if (confirm) confirmation.current?.focus() }, [confirm?.key])
  useEffect(() => {
    if (page !== 'deleted' && page !== 'export') { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true); setDeleted(undefined); setPreflight(undefined)
    void (page === 'deleted'
      ? readDeletedItems(scope, controller.signal)
        .then(value => {
          if (controller.signal.aborted) return
          if (value.accountScope !== scope) throw new Error('账号已切换')
          setDeleted(value)
          setConfirm(current => current && value.items.some(item => item.key === current.key && item.version === current.version) ? current : undefined)
        })
      : callArkme<ArkmeExportPreflight>('data.export.preflight', { expectedAccountScope: scope }, controller.signal)
        .then(value => { if (controller.signal.aborted) return; if (value.accountScope !== scope) throw new Error('账号已切换'); setPreflight(value) }))
      .catch(() => { if (!controller.signal.aborted) setError(page === 'deleted' ? '最近删除暂时无法读取，请重试或在手机端查看。' : '导出信息暂时无法读取，请重试或在手机端查看。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, revision, scope, deletedGeneration])
  useEffect(() => {
    const deadlines = deleted?.items.flatMap(item => item.recoverableUntilMillis ? [item.recoverableUntilMillis] : []) ?? []
    if (!deadlines.length) return
    const timer = setTimeout(() => {
      setDeleted(current => current ? { ...current, items: current.items.filter(item => !item.recoverableUntilMillis || item.recoverableUntilMillis > Date.now()) } : current)
      setConfirm(current => current?.recoverableUntilMillis && current.recoverableUntilMillis <= Date.now() ? undefined : current)
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now())))
    return () => clearTimeout(timer)
  }, [deleted])
  const recover = async () => {
    if (!confirm || recoveryController.current) return
    const controller = new AbortController(); recoveryController.current = controller
    if (recovery.current?.key !== confirm.key) recovery.current = { key: confirm.key, run: deletedItemRecovery(scope, confirm) }
    setRecovering(true); setError('')
    try {
      await recovery.current.run(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setDeleted(value => value ? { ...value, items: value.items.filter(item => item.key !== confirm.key) } : value)
      setNotice('已恢复'); setConfirm(undefined); recovery.current = undefined
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : '恢复失败，请刷新后重试')
    } finally { if (mounted.current) { recoveryController.current = undefined; setRecovering(false) } }
  }
  return <section className="arkme-data-settings" data-arkme-settings-page="data" aria-label={tr("数据管理")}>
    <header>{page !== 'home' && <button type="button" className="arkme-data-back" disabled={recovering} onClick={() => setPage('home')}>{tr("‹ 数据管理")}</button>}
      <h2>{({ home: '数据管理', archived: '已归档主题', deleted: '最近删除', import: '导入数据', export: '导出数据' })[page]}</h2></header>
    {page === 'home' ? <>
      <p className="arkme-data-hint">{tr("管理、迁入和保留属于你的记录。")}</p>
      <OpenPlatformEntry />
      <div className="arkme-data-entries">
        <button type="button" onClick={() => setPage('archived')}><Archive size={20} aria-hidden /><span>{tr("已归档主题")}</span><CaretRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => setPage('deleted')}><Trash size={20} aria-hidden /><span>{tr("最近删除")}</span><CaretRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => setPage('import')}><ArrowSquareOut size={20} aria-hidden /><span>{tr("导入数据")}</span><CaretRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => setPage('export')}><DownloadSimple size={20} aria-hidden /><span>{tr("导出数据")}</span><CaretRight size={15} aria-hidden /></button>
      </div>
    </> : page === 'archived' ? <ArkmeArchiveManagementPanel close={close} /> : page === 'import' ? <div className="arkme-data-panel">
      <h3>{tr("在网页中导入")}</h3><p>{tr("与 Flutter 桌面端使用同一个导入页面。请在网页中登录同一账号，再选择要导入的文件。")}</p>
      <a className="arkme-data-primary" href="https://jiwo.cc/import" target="_blank" rel="noopener noreferrer">{tr("打开导入网页 ↗")}</a>
      <small>{tr("不会自动上传文件，也不会通过链接传递你的登录凭证。")}</small>
    </div> : <>
      <button type="button" className="arkme-settings-link" disabled={loading || recovering} onClick={() => setRevision(value => value + 1)}>{loading ? tr("读取中…") : tr("刷新")}</button>
      {error && <p role="alert" className="arkme-data-error">{tr(error)}</p>}
      {notice && <p role="status">{notice}</p>}
      {page === 'deleted' && deleted && <>
        <p className="arkme-data-hint">{deleted.items.length ? `本次显示 ${deleted.items.length} 条${deleted.mayHaveMore ? '，更多记录请在手机端查看' : ''}。` : deleted.unverifiedCount ? tr('部分记录状态无法确认，已隐藏，请刷新或在手机端查看。') : deleted.mayHaveMore ? tr('本次读取范围内暂无可恢复记录，更多记录请在手机端查看。') : tr('暂无最近删除的记录。')}{deleted.items.length > 0 && !!deleted.unverifiedCount && tr('部分记录状态无法确认，已隐藏，请刷新或在手机端查看。')}{tr('浏览不会自动清除数据。')}</p>
        <ul className="arkme-data-deleted-list">{deleted.items.map(item => <li key={item.key}>
          <details><summary>{item.title || item.text.slice(0, 80) || '无文字记录'}<small>{new Date(item.sendAtMillis).toLocaleString(arkmeIntlLocale())}</small></summary>
            <p>{item.text || '此记录无文字内容，附件请在恢复后查看。'}</p>
          </details>
          <button type="button" disabled={recovering || item.version <= 0} onClick={() => { setConfirm(item); recovery.current = undefined; setError(''); if (confirm?.key === item.key) confirmation.current?.focus() }}>{tr("恢复")}</button>
        </li>)}</ul>
        {confirm && <div ref={confirmation} tabIndex={-1} className="arkme-data-panel" role="group" aria-label={tr("确认恢复记录")}><p>{tr("恢复“")}{confirm.title || confirm.text.slice(0, 40) || '无文字记录'}”？</p>
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
