import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import { Fragment, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeSearchRecordItem, ArkmeSearchSceneKind, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeConversationHeaderIconButton } from './ArkmeGroupChatControls.js'
import { arkmeUi } from './ui-controller.js'
import { SearchFileRow, SearchLinkRows, SearchMediaTile } from './ArkmeSearchCategories.js'
import { RecordRow } from './ArkmeSearchSurface.js'
import { arkmeContentMediaUrl, ArkmeMediaPreview, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from './arkme-layout.js'
import { conversationSearchAttachments } from './conversation-search-port.js'
import { AttachmentPreviewSurface, attachmentPreviewBridge, showAttachmentPreview, closeAttachmentPreview } from './attachment-preview-window.js'
import { useConversationSearch, useConversationSearchDetail } from './use-conversation-search.js'
import { useResizableNoteDetail } from './use-resizable-note-detail.js'
import { useSelectedMessageSearch } from './message-selection-search.js'

const scenes: Array<{ key: ArkmeSearchSceneKind; label: string }> = [
  { key: 'image_video', label: '图片/视频' }, { key: 'audio', get label() { return tr("语音") } },
  { key: 'link', get label() { return tr("外部链接") } }, { key: 'file', get label() { return tr("文件") } }, { key: 'long_article', get label() { return tr("长文") } },
]
const button: CSSProperties = { border: 0, borderRadius: 6, padding: '7px 9px', background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }
function searchMonth(millis: number): string {
  const date = new Date(millis)
  if (!Number.isFinite(date.valueOf())) return '更早'
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() ? '这个月' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
function mediaFailureKey(item: ArkmeSearchRecordItem, assetUid: string): string {
  return JSON.stringify([item.sourceKind, item.sourceUid, item.recordOwnerUserId, item.recordUid, assetUid])
}
// Each explicit result click replaces the selection, even if the open window
// has navigated elsewhere since the same result was first opened.
let previewSelection = 0
const status: CSSProperties = { padding: 24, textAlign: 'center', color: arkmeTheme.secondary, fontSize: 13 }

export function ArkmeConversationSearch({ source, host, accountKey, hideTrigger = false, open: controlledOpen, onOpenChange, label }: {
  source: ArkmeSourceItem; host: RefObject<HTMLElement>; accountKey: string; hideTrigger?: boolean
  open?: boolean; onOpenChange?: (open: boolean) => void; label?: string
}) {
  useArkmeLocale()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback((value: boolean) => { setInternalOpen(value); onOpenChange?.(value) }, [onOpenChange])
  const [selectionQuery, setSelectionQuery] = useState<{ text: string }>()
  useSelectedMessageSearch(source.sourceRef, text => {
    setPreferences(value => ({ ...value, global: false }))
    setSelectionQuery({ text }); setOpen(true)
  })
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const closeForWords = () => setOpen(false)
    window.addEventListener('arkme:conversation-analysis-open', closeForWords)
    return () => window.removeEventListener('arkme:conversation-analysis-open', closeForWords)
  }, [setOpen])
  const preferenceKey = source.sourceKey === undefined ? undefined : `arkme:chat-search:${accountKey}:${source.sourceKey}`
  const [preferences, setPreferences] = useState<{ scene: ArkmeSearchSceneKind; global: boolean }>(() => {
    try {
      const value = JSON.parse(preferenceKey === undefined ? 'null' : sessionStorage.getItem(preferenceKey) ?? 'null')
      if (value && scenes.some(scene => scene.key === value.scene) && typeof value.global === 'boolean') return { scene: value.scene, global: value.global }
    } catch { /* optional view preference */ }
    return { scene: 'image_video', global: false }
  })
  useEffect(() => {
    try { if (preferenceKey !== undefined) sessionStorage.setItem(preferenceKey, JSON.stringify(preferences)) } catch { /* optional view preference */ }
  }, [preferenceKey, preferences])
  const close = () => { setOpen(false); trigger.current?.focus() }
  return <>
    {!hideTrigger && <ArkmeConversationHeaderIconButton buttonRef={trigger} label={label ?? tr("搜索聊天记录")} expanded={open} onClick={() => { setSelectionQuery(undefined); setOpen(!open) }}><MagnifyingGlass size={22} /></ArkmeConversationHeaderIconButton>}
    {open && host.current !== null && createPortal(<ArkmeConversationSearchPanel source={source} scene={preferences.scene} global={preferences.global}
      selectionQuery={selectionQuery}
      onScene={scene => setPreferences(value => ({ ...value, scene }))} onGlobal={global => setPreferences(value => ({ ...value, global }))} onClose={close} />, host.current)}
  </>
}

export function ArkmeConversationSearchPanel({ source, scene, global, onScene, onGlobal, onClose, selectionQuery }: {
  source: ArkmeSourceItem; scene: ArkmeSearchSceneKind; global: boolean
  onScene(scene: ArkmeSearchSceneKind): void; onGlobal(global: boolean): void; onClose(): void
  selectionQuery?: { text: string } | undefined
}) {
  useArkmeLocale()
  const panel = useRef<HTMLElement>(null)
  const queryInput = useRef<HTMLInputElement>(null)
  const resize = useResizableNoteDetail(panel, 'arkme-conversation-search-width', '调整聊天搜索宽度')
  const [query, setQuery] = useState(selectionQuery?.text ?? '')
  useEffect(() => { if (selectionQuery) { setQuery(selectionQuery.text); queryInput.current?.focus() } }, [selectionQuery])
  const [composing, setComposing] = useState(false)
  const [selected, setSelected] = useState<ArkmeSearchRecordItem>()
  const [selectedAssetUid, setSelectedAssetUid] = useState<string>()
  const [selectedDetail, setSelectedDetail] = useState<ArkmeTimelineItem>()
  const [mediaFailures, setMediaFailures] = useState(new Map<string, string>())
  const search = useConversationSearch(source.sourceRef, global, scene, query, composing)
  useEffect(() => { setSelected(undefined); setSelectedDetail(undefined); setMediaFailures(new Map()) }, [source.sourceRef, global, scene, query])
  useEffect(() => { if (selected === undefined) queryInput.current?.focus() }, [selected])
  const showingMessage = selected !== undefined && selectedAssetUid === undefined
  const keyword = query.trim() !== ''
  const selectHit = (item: ArkmeSearchRecordItem, assetUid?: string, detail?: ArkmeTimelineItem) => {
    if (assetUid && detail && scene === 'image_video' && attachmentPreviewBridge()?.version === 1) {
      const block = conversationSearchAttachments(detail).find(value => value.fileAssetUid === assetUid && value.mediaRef)
      if (block) {
        // Share the message-list window owner; this result snapshot survives closing
        // search or switching chats without keeping the search panel mounted.
        const identity = `search:${mediaFailureKey(item, assetUid)}:${++previewSelection}`
        try {
          showAttachmentPreview(identity, doc => { doc.title = block.fileName || tr('文件预览'); return <SearchMediaWindow key={identity} entries={attachments} item={item} assetUid={assetUid} detail={detail} /> })
        } catch (error) {
          setMediaFailures(previous => new Map(previous).set(mediaFailureKey(item, assetUid), error instanceof Error ? error.message : tr('媒体暂不可访问，点击重试')))
        }
        return
      }
    }
    setSelectedAssetUid(assetUid)
    setSelectedDetail(detail)
    if (item.sourceKind !== 3 && item.targetSource !== undefined) {
      arkmeUi.showConversationTarget(item.targetSource, item.recordUid, item.sendAtMillis, item.recordOwnerUserId)
      onClose()
    } else setSelected(item)
  }
  const attachments = !keyword && (scene === 'file' || scene === 'image_video')
    ? (search.page?.items ?? []).filter(item => item.sourceKind === 3).flatMap(item =>
      [...new Map((scene === 'file' ? item.files : item.media).map(asset => [asset.fileAssetUid, asset])).values()].map(asset => ({ item, uid: asset.fileAssetUid }))) : []
  const attachmentIndex = attachments.findIndex(entry => entry.item === selected && entry.uid === selectedAssetUid)
  const navigation = attachmentIndex < 0 ? undefined : {
    ...(attachmentIndex === 0 ? {} : { previous: () => { const entry = attachments[attachmentIndex - 1]!; selectHit(entry.item, entry.uid, entry.item === selected ? selectedDetail : undefined) } }),
    ...(attachmentIndex === attachments.length - 1 ? {} : { next: () => { const entry = attachments[attachmentIndex + 1]!; selectHit(entry.item, entry.uid, entry.item === selected ? selectedDetail : undefined) } }),
  }
  return <aside ref={panel} aria-label={tr("聊天记录搜索")} style={{ position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 30,
    ...resize.style, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.border}` }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !(typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]')) && !(event.target instanceof Element && event.target.closest('[role="dialog"]'))) { event.stopPropagation(); selected === undefined ? onClose() : setSelected(undefined) } }}>
    {resize.handle}
    <style>{`.arkme-search-tab[aria-selected=true]::after { content: ''; position: absolute; bottom: 0; left: calc(50% - 5px); width: 10px; height: 2px; border-radius: 2px; background: currentColor; } .arkme-search-file-row:hover { background: ${arkmeTheme.hover} !important; }`}</style>
    <ArkmeRightPanelHeader title={global ? tr("全局搜索") : source.displayName} onClose={onClose} closeLabel={tr("关闭聊天搜索")}
      actions={<button data-arkme-feedback="neutral" type="button" style={{ ...button, height: 30, marginTop: -3, padding: '0 9px' }} onClick={() => onGlobal(!global)}>{global ? tr("当前范围") : tr("全局")}</button>} />
    <div style={{ padding: '0 14px 8px', flex: 'none' }}>
      <div style={{ ...row, marginTop: 10, padding: '0 10px', borderRadius: 8, background: arkmeTheme.input }}>
        <MagnifyingGlass size={18} />
        <input ref={queryInput} autoFocus aria-label={tr("搜索聊天关键词")} placeholder={tr("搜索")} value={query}
          onChange={event => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)}
          onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value) }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); search.submit() } }}
          style={{ width: '100%', minWidth: 0, height: 36, border: 0, outline: 0, background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 14 }} />
        {query !== '' && <button data-arkme-feedback="neutral" type="button" aria-label={tr("清空搜索")} style={button} onClick={() => { setQuery(''); setComposing(false) }}><X size={16} /></button>}
      </div>
      {!keyword && <div role="tablist" aria-label={tr("聊天记录分类")} style={{ ...row, gap: 0, overflowX: 'auto', marginTop: 10 }}>
        {scenes.map(item => <button data-arkme-feedback="neutral" type="button" role="tab" className="arkme-search-tab" aria-selected={scene === item.key} key={item.key}
          onClick={() => onScene(item.key)} style={{ ...button, position: 'relative', flex: 'none', padding: '8px 0', marginRight: 30, fontSize: 14, fontWeight: scene === item.key ? 600 : 400, color: scene === item.key ? arkmeTheme.text : arkmeTheme.secondary,
            borderRadius: 0 }}>{item.label}</button>)}
      </div>}
    </div>
    {selected !== undefined && <SearchDetail key={`${selected.sourceKind}:${selected.sourceUid ?? ''}:${selected.recordOwnerUserId}:${selected.recordUid}`} item={selected} assetUid={selectedAssetUid} initialDetail={selectedDetail} onSelectAsset={setSelectedAssetUid} navigation={navigation}
      onUnavailable={!keyword && scene === 'image_video' && selectedAssetUid !== undefined ? message => {
        setMediaFailures(previous => new Map(previous).set(mediaFailureKey(selected, selectedAssetUid), message))
        setSelected(undefined); setSelectedDetail(undefined)
      } : undefined} onBack={() => setSelected(undefined)} onLocate={() => {
      if (selected.targetSource !== undefined) { arkmeUi.showConversationTarget(selected.targetSource, selected.recordUid, selected.sendAtMillis, selected.recordOwnerUserId); onClose() }
    }} />}
    <div aria-label={tr("聊天搜索结果")} hidden={showingMessage} style={{ display: showingMessage ? 'none' : undefined, flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 16px' }}
      onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 160) search.loadMore() }}>
      {search.page?.queryGuard.state && !['complete', 'ok'].includes(search.page.queryGuard.state) && <p role="status" style={status}>{tr("搜索结果暂不完整，请缩小范围或调整关键词")}</p>}
      {search.page?.itemCount !== undefined && <p style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{search.page.itemCount} {keyword ? '条结果' : scene === 'image_video' ? '个媒体' : scene === 'file' ? tr("个文件") : '条结果'}</p>}
      <div style={!keyword && scene === 'image_video' ? { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 1 } : undefined}>
      {search.page?.items.map((item, index, items) => <Fragment key={`${item.sourceKind}:${item.sourceUid ?? ''}:${item.recordOwnerUserId ?? ''}:${item.recordUid}`}>
        {!keyword && scene !== 'link' && (index === 0 || searchMonth(item.sendAtMillis) !== searchMonth(items[index - 1]!.sendAtMillis)) && <p style={{ gridColumn: '1 / -1', margin: '12px 0 8px', fontSize: 12, color: arkmeTheme.secondary }}>{searchMonth(item.sendAtMillis)}</p>}
        <div style={!keyword && scene === 'image_video' ? { display: 'contents' } : { marginBottom: scene === 'file' || scene === 'link' ? 0 : 8 }}>
        {!keyword && scene === 'image_video' ? item.sourceKind === 3 ? item.media.length > 0 ? <ChatSearchMedia item={item} active={selected === undefined} onSelect={selectHit} failures={mediaFailures} onRetry={uid => {
            setMediaFailures(previous => { const next = new Map(previous); next.delete(mediaFailureKey(item, uid)); return next })
          }} /> : <button data-arkme-feedback="neutral" type="button" style={button} onClick={() => selectHit(item)}>{tr("查看媒体消息")}</button> : <div style={{ display: 'contents' }}>
          {item.media.map(asset => { const display = search.assets.get(asset.fileAssetUid); const url = display?.previewUrl ?? display?.downloadUrl
            const video = (display?.mimeType ?? asset.mimeType ?? '').startsWith('video/') || asset.fileKind === 3
            return <SearchMediaTile key={asset.fileAssetUid} url={url} unavailable={url === undefined} name={display?.fileName ?? asset.fileName ?? ''} video={video} durationSec={asset.durationMillis === undefined ? undefined : asset.durationMillis / 1000} onOpen={() => selectHit(item, asset.fileAssetUid)} />
          })}
          {item.media.length === 0 && <button data-arkme-feedback="neutral" type="button" style={button} onClick={() => selectHit(item)}>{tr("查看媒体消息")}</button>}
        </div> : !keyword && scene === 'file' ? <>
          {[...new Map(item.files.map(file => [file.fileAssetUid, file])).values()].map(file => <SearchFileRow key={file.fileAssetUid} file={file} item={item} onOpen={() => selectHit(item, file.fileAssetUid)} />)}
          {item.files.length === 0 && <button data-arkme-feedback="neutral" type="button" style={button} onClick={() => selectHit(item)}>{tr("查看文件消息")}</button>}
        </> : !keyword && scene === 'link' ? <SearchLinkRows item={item} onLocate={() => {
          if (item.targetSource !== undefined && (item.sourceKind !== 3 || item.recordOwnerUserId !== undefined)) {
            arkmeUi.showConversationTarget(item.targetSource, item.recordUid, item.sendAtMillis, item.recordOwnerUserId); onClose()
          } else selectHit(item)
        }} /> : <RecordRow item={item} onClick={() => selectHit(item)} />}
      </div></Fragment>)}
      </div>
      {search.loading && <div role="status" style={status}>{tr("加载中…")}</div>}
      {search.error !== '' && <div role="alert" style={status}>{search.error}<button data-arkme-feedback="neutral" type="button" style={button} onClick={search.retry}>{tr("重试")}</button></div>}
      {!search.loading && !search.error && search.page?.items.length === 0 && ['complete', 'ok'].includes(search.page.queryGuard.state) && <div style={status}>{tr("暂无搜索结果")}</div>}
      {!search.loading && !search.error && search.page?.hasMore && <button data-arkme-feedback="neutral" type="button" style={{ ...button, width: '100%' }} onClick={search.loadMore}>{tr("加载更多")}</button>}
    </div>
  </aside>
}

function ChatSearchMedia({ item, active, onSelect, failures, onRetry }: { item: ArkmeSearchRecordItem; active: boolean; onSelect(item: ArkmeSearchRecordItem, assetUid?: string, detail?: ArkmeTimelineItem): void; failures: ReadonlyMap<string, string>; onRetry(uid: string): void }) {
  useArkmeLocale()
  const element = useRef<HTMLDivElement>(null)
  const { detail, error, retry } = useConversationSearchDetail(item, element, active)
  const loading = detail === undefined && error === ''
  const blocks = detail === undefined ? [] : conversationSearchAttachments(detail).filter(block => block.kind === 'image' || block.kind === 'video')
  const assets = [...new Map(item.media.map(asset => [asset.fileAssetUid, asset])).values()]
  return <div ref={element} style={{ display: 'contents' }}>
    {assets.map(asset => {
      const block = blocks.find(value => value.fileAssetUid === asset.fileAssetUid && value.mediaRef)
      const failed = failures.has(mediaFailureKey(item, asset.fileAssetUid))
      const reload = () => { if (!loading) { onRetry(asset.fileAssetUid); retry() } }
      return <SearchMediaTile key={asset.fileAssetUid} name={block?.fileName ?? asset.fileName ?? ''}
        url={block === undefined || failed ? undefined : arkmeContentMediaUrl(block)}
        video={block !== undefined ? block.kind === 'video' : asset.fileKind === 3 || (asset.mimeType ?? '').startsWith('video/')}
        durationSec={block?.durationSec ?? (asset.durationMillis === undefined ? undefined : asset.durationMillis / 1000)}
        unavailable={failed || error !== '' || detail !== undefined && block === undefined} onRetry={reload} loading={loading}
        onOpen={() => { if (block && detail && !failed) onSelect(item, asset.fileAssetUid, detail); else reload() }} />
    })}
  </div>
}

function SearchMediaWindow({ entries, item, assetUid, detail }: { entries: Array<{ item: ArkmeSearchRecordItem; uid: string }>; item: ArkmeSearchRecordItem; assetUid: string; detail: ArkmeTimelineItem }) {
  const [selected, setSelected] = useState({ item, uid: assetUid })
  const [initialDetail, setInitialDetail] = useState<ArkmeTimelineItem | undefined>(detail)
  const index = entries.findIndex(entry => entry.item === selected.item && entry.uid === selected.uid)
  const navigation = {
    ...(index <= 0 ? {} : { previous: () => setSelected(entries[index - 1]!) }),
    ...(index < 0 || index === entries.length - 1 ? {} : { next: () => setSelected(entries[index + 1]!) }),
  }
  return <div onKeyDownCapture={event => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAttachmentPreview(); return }
    const target = event.target as HTMLElement
    if (event.altKey || event.ctrlKey || event.metaKey || target.closest?.('input,textarea,select,video,audio,[contenteditable="true"],[role="slider"]')) return
    const move = event.key === 'ArrowLeft' ? navigation.previous : event.key === 'ArrowRight' ? navigation.next : undefined
    if (move) { event.preventDefault(); event.stopPropagation(); move() }
  }}>
    <SearchDetail key={mediaFailureKey(selected.item, '')} item={selected.item} assetUid={selected.uid} initialDetail={selected.item === item ? initialDetail : undefined} onRetryDetail={() => setInitialDetail(undefined)} standalone navigation={navigation}
      onSelectAsset={uid => setSelected(previous => ({ ...previous, uid }))} onBack={closeAttachmentPreview} onLocate={() => {}} />
  </div>
}

function SearchDetail({ item, assetUid, initialDetail, onRetryDetail, onUnavailable, onSelectAsset, onBack, onLocate, navigation, standalone = false }: { navigation?: import('./ArkmeFileViewer.js').ArkmePreviewNavigation | undefined; item: ArkmeSearchRecordItem; assetUid: string | undefined; initialDetail?: ArkmeTimelineItem | undefined; onRetryDetail?: () => void; onUnavailable?: ((message: string) => void) | undefined; onSelectAsset(uid: string): void; onBack(): void; onLocate(): void; standalone?: boolean }) {
  useArkmeLocale()
  const previewDocument = useContext(AttachmentPreviewSurface)
  const loaded = useConversationSearchDetail(item, undefined, initialDetail === undefined)
  const detail = initialDetail ?? loaded.detail
  const { error } = loaded
  const retry = () => { onRetryDetail?.(); loaded.retry() }
  const blocks = detail === undefined ? [] : conversationSearchAttachments(detail)
  const preview = assetUid === undefined ? undefined : blocks.find(block => block.fileAssetUid === assetUid && block.mediaRef && (block.kind === 'image' || block.kind === 'video' || block.kind === 'file'))
  useEffect(() => { if (previewDocument && preview) previewDocument.title = preview.fileName || tr('文件预览') }, [previewDocument, preview])
  useEffect(() => {
    if (assetUid !== undefined && onUnavailable && (error || detail !== undefined && !preview)) onUnavailable(error || tr("媒体暂不可访问，点击重试"))
  }, [assetUid, onUnavailable, error, detail, preview])
  if (assetUid !== undefined) {
    if (preview !== undefined) return <ArkmeMediaPreview key={assetUid} blocks={blocks.filter(block => preview.kind === 'file' ? block.kind === 'file' : block.kind === 'image' || block.kind === 'video')} selected={preview} navigation={navigation} openLocalFile={!standalone} onSelect={block => { if (block.fileAssetUid !== undefined) onSelectAsset(block.fileAssetUid) }} onClose={onBack} />
    if (onUnavailable) return null
    if (standalone) return <div style={status}>
      {error || detail !== undefined ? <div role="alert">{error || tr('媒体暂不可访问，点击重试')}<button type="button" style={button} onClick={retry}>{tr('重试')}</button></div> : <div role="status">{tr('加载详情…')}</div>}
      <button type="button" style={button} aria-label={tr('上一个媒体')} disabled={!navigation?.previous} onClick={navigation?.previous}>{tr('上一个媒体')}</button>
      <button type="button" style={button} aria-label={tr('下一个媒体')} disabled={!navigation?.next} onClick={navigation?.next}>{tr('下一个媒体')}</button>
      <button type="button" style={button} onClick={onBack}>{tr('关闭')}</button>
    </div>
    return <div style={status}>
      {error !== '' ? <div role="alert">{error}<button data-arkme-feedback="neutral" type="button" style={button} onClick={retry}>{tr("重试")}</button></div>
        : detail === undefined ? <div role="status">{tr("加载详情…")}</div>
          : <p role="alert">{tr("该附件已不存在或暂不可访问，请返回结果重新选择")}</p>}
      <button data-arkme-feedback="neutral" autoFocus type="button" style={button} onClick={onBack}>{tr("返回结果")}</button>
    </div>
  }
  return <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 20px' }}>
    <div style={{ ...row, justifyContent: 'space-between' }}><button data-arkme-feedback="neutral" autoFocus type="button" style={button} onClick={onBack}>{tr("返回结果")}</button>
      <button data-arkme-feedback="neutral" type="button" style={button} disabled={item.targetSource === undefined || item.recordOwnerUserId === undefined || detail === undefined} onClick={onLocate}>{tr("定位到消息")}</button></div>
    {error !== '' ? <div role="alert" style={status}>{error}<button data-arkme-feedback="neutral" type="button" style={button} onClick={retry}>{tr("重试")}</button></div>
      : detail === undefined ? <div role="status" style={status}>{tr("加载详情…")}</div>
        : <><p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{detail.senderName} · {new Date(detail.sendAtMillis).toLocaleString(arkmeIntlLocale())}</p>
          <ArkmeMessageContent item={detail} presentation="detail" collapseText={false} sessionAttachmentPreview sourceIdentityKey={mediaFailureKey(item, '')} {...(item.targetSource === undefined ? {} : { sourceRef: item.targetSource.sourceRef })} /></>}
  </div>
}
