import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { Link } from '@phosphor-icons/react/dist/icons/Link'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/icons/PaperPlaneTilt'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import type { ArkmeLongArticleDetail, ArkmeMessageSnapshotDetail, ArkmeTimelineItem } from '../types.js'
import type { ArkmeRecordDeletionResult } from '../record-deletion-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeConfirmDialog, ArkmeConfirmDialogPreview } from './ArkmeConfirmDialog.js'
import { ArkmeRecordEditHistory } from './ArkmeRecordEditHistory.js'
import { ArkmeMessageSnapshotDialog } from './ArkmeMessageSnapshotDialog.js'
import { useArkmeMessageActions } from './ArkmeMessageActions.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr } from './locale.js'
import { articleExportFileName, downloadArticleBlob, exportArticleImages, exportArticleMarkdown, type ArticleExportContent } from './long-article-export.js'

/** All modal state belongs to the currently viewed article, never the opening conversation. */
export function ArkmeLongArticleActions({ sourceRef, detail, snapshot, dismissRef, onBusyChange, onDeleted, beforeAction }: {
  sourceRef: string; detail?: ArkmeLongArticleDetail | undefined; snapshot?: ArkmeTimelineItem | undefined
  dismissRef: MutableRefObject<(() => boolean) | undefined>
  beforeAction?(): Promise<ArkmeLongArticleDetail | undefined>
  onBusyChange?(busy: boolean): void
  onDeleted(itemUid: string): void
}) {
  const [menu, setMenu] = useState<'main' | 'export'>()
  const [panel, setPanel] = useState<'history' | 'snapshot' | 'delete' | 'images'>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('')
  const [metadata, setMetadata] = useState<ArkmeMessageSnapshotDetail>(), [metadataLoading, setMetadataLoading] = useState(false)
  const [images, setImages] = useState<Blob[]>([]), [urls, setUrls] = useState<string[]>([])
  const request = useRef<AbortController>(), mounted = useRef(true), button = useRef<HTMLButtonElement>(null)
  const initialAuth = useRef(arkmeAuthStore.getSnapshot().auth)
  const [accountChanged, setAccountChanged] = useState(false)
  const article: ArticleExportContent = detail ?? snapshot ?? { title: '', textContent: '' }
  const item = detail?.actionItem ?? snapshot ?? (detail ? { ...detail, senderName: '', isMe: detail.editable, status: 1 } : undefined)
  const ref = snapshot ? undefined : item?.messageActionRef
  const actionItems = useMemo(() => ref && item ? [{ id: item.itemUid, copyText: item.textContent,
    actionRef: ref, conversationRef: sourceRef, copyLinkAvailable: true, forwardAvailable: true }] : [], [ref, item, sourceRef])
  const actions = useArkmeMessageActions({ scopeKey: `${sourceRef}:${item?.itemUid}`, sourceActions: true, items: actionItems })
  const assertAccount = () => {
    const auth = arkmeAuthStore.getSnapshot().auth, before = initialAuth.current
    if (before?.status === 'authenticated' && (auth?.status !== 'authenticated' || before.userId !== auth.userId || before.environment !== auth.environment)) throw new Error('账号已切换，请重新打开长文')
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort(); dismissRef.current = undefined }
  }, [])
  useEffect(() => arkmeAuthStore.subscribe(() => { try { assertAccount() } catch { request.current?.abort(); setAccountChanged(true); setMenu(undefined); setPanel(undefined); setImages([]) } }), [])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => {
    const next = images.map(blob => URL.createObjectURL(blob)); setUrls(next)
    return () => next.forEach(url => URL.revokeObjectURL(url))
  }, [images])
  dismissRef.current = () => {
    if (actions.dismissOverlay()) return true
    if (menu) { setMenu(undefined); return true }
    if (panel) { if (!busy) { setPanel(undefined); setError(''); request.current?.abort() }; return true }
    return busy
  }
  const prepare = async () => {
    assertAccount()
    const current = await beforeAction?.() ?? detail
    assertAccount()
    return current
  }
  const openMenu = async () => {
    if (menu) { setMenu(undefined); return }
    setBusy(true); setError('')
    try { await prepare(); if (mounted.current) setMenu('main') }
    catch (caught) { setError(caught instanceof Error ? caught.message : '请先完成发布') }
    finally { if (mounted.current) setBusy(false) }
  }
  const withCurrent = async (forward: boolean) => {
    setMenu(undefined); setBusy(true); setError('')
    try {
      const latest = await prepare(), currentItem = latest?.actionItem ?? item
      const items = currentItem?.messageActionRef ? [{ id: currentItem.itemUid, copyText: currentItem.textContent, actionRef: currentItem.messageActionRef, conversationRef: sourceRef, copyLinkAvailable: true, forwardAvailable: true }] : actionItems
      if (forward) await actions.openForward(items); else await actions.copyLink(items)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '请先完成发布') }
    finally { if (mounted.current) setBusy(false) }
  }
  const choose = (kind: 'history' | 'snapshot' | 'delete') => { setMenu(undefined); setError(''); setPanel(kind) }
  useEffect(() => {
    if (panel !== 'snapshot' || !ref) return
    const controller = new AbortController(); request.current = controller
    setMetadata(undefined); setMetadataLoading(true); setError('')
    void callArkme<ArkmeMessageSnapshotDetail>('source.message-snapshot.detail', { sourceRef, actionRef: ref,
      // Received articles may read only their chat snapshot, never the author's private metadata.
      ...(item?.isMe ? {} : { includeAttachments: true }),
    }, controller.signal).then(value => { assertAccount(); if (!controller.signal.aborted) setMetadata(value) })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '详情读取失败') })
      .finally(() => { if (!controller.signal.aborted) setMetadataLoading(false) })
    return () => controller.abort()
  }, [panel, ref, sourceRef])

  const exportArticle = async (kind: 'md' | 'image') => {
    if (busy || accountChanged) return
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 120_000)
    setMenu(undefined); setBusy(true); setError(''); setProgress('正在准备导出…'); setPanel('images'); setImages([])
    try {
      const article = await prepare() ?? detail ?? snapshot ?? { title: '', textContent: '' }
      if (kind === 'md') {
        const blob = await exportArticleMarkdown(article, controller.signal); assertAccount(); controller.signal.throwIfAborted()
        downloadArticleBlob(blob, `${articleExportFileName(article.title)}.md`); setPanel(undefined)
      } else {
        const result = await exportArticleImages(article, controller.signal, label => { if (mounted.current && !controller.signal.aborted) setProgress(label) })
        assertAccount(); controller.signal.throwIfAborted(); setImages(result)
      }
    } catch (caught) { if (mounted.current && !accountChanged) setError(controller.signal.aborted ? '导出已取消或超时，请重试' : caught instanceof Error ? caught.message : '导出失败，请重试') }
    finally { clearTimeout(timeout); if (mounted.current) { setBusy(false); setProgress('') } }
  }
  const remove = async () => {
    if (busy || !item?.recordDeletionRef || accountChanged) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const currentItem = (await prepare())?.actionItem ?? item
      if (!currentItem?.recordDeletionRef) throw new Error('请重新打开长文核对删除权限')
      const result = await callArkme<ArkmeRecordDeletionResult>('source.record-delete', { sourceRef, deletionRefs: [currentItem.recordDeletionRef] }, controller.signal)
      assertAccount()
      const deleted = result.items.find(value => value.recordUid === item.itemUid)
      if (deleted?.result !== 'deleted') throw new Error((deleted?.result === 'rejected' ? deleted.message : '') || '删除结果未确认，请关闭后重新打开长文核对，避免重复删除')
      if (mounted.current) { setPanel(undefined); onDeleted(item.itemUid) }
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : '删除失败，请重新打开长文核对') }
    finally { if (mounted.current) setBusy(false) }
  }
  const unavailable = accountChanged || busy || actions.busy !== undefined
  const ready = !!detail || !!snapshot
  const close = () => { if (!busy) { setPanel(undefined); setError(''); request.current?.abort() } }
  return <>
    <style>{'[role="menu"][aria-label="长文操作"] { z-index: 10280; min-width: 184px; background: var(--dsw-alias-bg-base, #fff); } [role="menu"][aria-label="长文操作"] [role="menuitem"] { min-height: 34px; font-size: 14px; }'}</style>
    <ArkmeActionMenu open={!!menu} label={tr('长文操作')} align="end" portal autoFocus onClose={() => setMenu(undefined)}
      anchor={<button ref={button} type="button" className="arkme-article-workspace-control" aria-label={tr('长文更多操作')}
        aria-haspopup="menu" aria-expanded={!!menu} disabled={!ready || unavailable} onClick={() => { void openMenu() }}><DotsThree size={24} weight="bold" /></button>}
      actions={menu === 'export' ? [
        { id: 'back', label: '‹ 返回', onSelect: () => setMenu('main') },
        { id: 'md', label: 'Markdown（.md）', onSelect: () => { void exportArticle('md') } },
        { id: 'image', label: '图片（手机阅读）', onSelect: () => { void exportArticle('image') } },
      ] : [
        { id: 'history', label: '编辑记录', icon: <ClockCounterClockwise size={18}/>, disabled: !ref, onSelect: () => choose('history') },
        { id: 'link', label: '复制链接', icon: <Link size={18}/>, disabled: !ref, onSelect: () => { setMenu(undefined); void withCurrent(false) } },
        { id: 'export', label: '导出 ›', icon: <DownloadSimple size={18}/>, onSelect: () => setMenu('export') },
        { id: 'forward', label: '转发', icon: <PaperPlaneTilt size={18}/>, disabled: !ref, onSelect: () => { setMenu(undefined); void withCurrent(true) } },
        { id: 'snapshot', label: '详情', icon: <Info size={18}/>, onSelect: () => choose('snapshot') },
        ...(item?.recordDeletionRef && !snapshot ? [{ id: 'delete-separator', type: 'separator' as const }, { id: 'delete', label: '删除长文', icon: <Trash size={18}/>, danger: true, onSelect: () => choose('delete') }] : []),
      ]} />
    {error && !panel && <span role="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</span>}
    {typeof document !== 'undefined' && !!document.body && createPortal(<div style={{ position: 'relative', zIndex: 10_250 }}>{actions.overlay}</div>, document.body)}
    {panel === 'snapshot' && item && <ArkmeMessageSnapshotDialog item={item} previewText={article.title} createdAtMillis={detail?.createdAtMillis ?? 0} {...(metadata ? { detail: metadata } : {})}
      metadataUnavailable={!ref || !item.isMe ? '仅展示当前可见信息；原作者的私人位置与设备信息不公开' : undefined}
      loading={metadataLoading} {...(error ? { loadError: error } : {})} onClose={close} />}
    {panel === 'delete' && <ArkmeConfirmDialog titleId="arkme-article-delete-title" title="删除这篇长文？" description="删除后可在数据管理中查看，保留 30 天。此操作会删除长文本身。"
      confirmLabel="确认删除" busyLabel="删除中…" confirmTone="danger" busy={busy} confirmDisabled={!!error} error={error} onClose={close} onConfirm={() => { void remove() }}>
      <ArkmeConfirmDialogPreview>{article.title || '无标题长文'}</ArkmeConfirmDialogPreview>
    </ArkmeConfirmDialog>}
    {(panel === 'history' || panel === 'images') && <ArkmeConfirmDialog layout="picker" titleId="arkme-article-panel-title" title={panel === 'history' ? '编辑记录' : '导出长文'} busy={false} onClose={close}>
      <header data-arkme-article-subdialog style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: theme.base, borderBottom: `1px solid ${theme.border}` }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{panel === 'history' ? tr('编辑记录') : tr('导出长文')}</h3>
        <button type="button" aria-label={tr('关闭长文操作弹窗')} disabled={busy} onClick={close} style={{ border: 0, background: 'transparent', color: theme.text, display: 'grid', placeItems: 'center', width: 30, height: 30 }}><X size={20}/></button>
      </header>
      {panel === 'history' && ref && <div style={{ padding: '28px 20px 8px' }}><ArkmeRecordEditHistory sourceRef={sourceRef} messageActionRef={ref} {...(item ? { author: item } : {})}/></div>}
      {panel === 'images' && <div style={{ padding: '0 16px 16px' }}>
        {progress && <p role="status" style={{ color: theme.secondary }}>{progress}<button type="button" style={{ marginLeft: 12 }} onClick={() => request.current?.abort()}>{tr('取消导出')}</button></p>}
        {error && <p role="alert" style={{ color: theme.danger }}>{error}</p>}
        {images.length > 0 && <p style={{ color: theme.secondary, fontSize: 13 }}>{images.length === 1 ? tr('图片已生成，可预览后保存。') : tr('已按手机阅读宽度分图，可逐张保存。')}</p>}
        {urls.map((url, index) => <div key={url} style={{ marginTop: 16 }}>
          <button type="button" style={{ margin: '10px 0', padding: '8px 14px' }} onClick={() => { try { assertAccount(); downloadArticleBlob(images[index]!, `${articleExportFileName(article.title)}${images.length > 1 ? `-${index + 1}` : ''}.png`) } catch (caught) { setError(String(caught)) } }}>{images.length === 1 ? tr('保存图片') : `保存第 ${index + 1} 张`}</button><img src={url} alt={`长文导出预览 ${index + 1}`} style={{ display: 'block', width: '100%', borderRadius: 6 }}/></div>)}
      </div>}
    </ArkmeConfirmDialog>}
  </>
}
