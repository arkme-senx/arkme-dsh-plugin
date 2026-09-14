import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeContentBlock, ArkmeSearchRecordItem, ArkmeSearchSceneKind, ArkmeSourceItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeUi } from './ui-controller.js'
import { RecordRow } from './ArkmeSearchSurface.js'
import { ArkmeMediaPreview, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from './arkme-layout.js'
import { useConversationSearch, useConversationSearchDetail } from './use-conversation-search.js'
import { useResizableNoteDetail } from './use-resizable-note-detail.js'

const scenes: Array<{ key: ArkmeSearchSceneKind; label: string }> = [
  { key: 'image_video', label: '图片/视频' }, { key: 'audio', label: '语音' },
  { key: 'link', label: '外部链接' }, { key: 'file', label: '文件' }, { key: 'long_article', label: '长文' },
]
const button: CSSProperties = { border: 0, borderRadius: 6, padding: '7px 9px', background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }
function searchMonth(millis: number): string {
  const date = new Date(millis)
  if (!Number.isFinite(date.valueOf())) return '更早'
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() ? '这个月' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
const status: CSSProperties = { padding: 24, textAlign: 'center', color: arkmeTheme.secondary, fontSize: 13 }

export function ArkmeConversationSearch({ source, host, accountKey }: { source: ArkmeSourceItem; host: RefObject<HTMLElement>; accountKey: string }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
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
    <button ref={trigger} type="button" aria-label="搜索聊天记录" title="搜索聊天记录" aria-expanded={open} style={button} onClick={() => setOpen(value => !value)}><MagnifyingGlass size={22} /></button>
    {open && host.current !== null && createPortal(<ArkmeConversationSearchPanel source={source} scene={preferences.scene} global={preferences.global}
      onScene={scene => setPreferences(value => ({ ...value, scene }))} onGlobal={global => setPreferences(value => ({ ...value, global }))} onClose={close} />, host.current)}
  </>
}

export function ArkmeConversationSearchPanel({ source, scene, global, onScene, onGlobal, onClose }: {
  source: ArkmeSourceItem; scene: ArkmeSearchSceneKind; global: boolean
  onScene(scene: ArkmeSearchSceneKind): void; onGlobal(global: boolean): void; onClose(): void
}) {
  const panel = useRef<HTMLElement>(null)
  const queryInput = useRef<HTMLInputElement>(null)
  const resize = useResizableNoteDetail(panel, 'arkme-conversation-search-width', '调整聊天搜索宽度')
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [selected, setSelected] = useState<ArkmeSearchRecordItem>()
  const [selectedAssetUid, setSelectedAssetUid] = useState<string>()
  const search = useConversationSearch(source.sourceRef, global, scene, query, composing)
  useEffect(() => { setSelected(undefined) }, [source.sourceRef, global, scene, query])
  useEffect(() => { if (selected === undefined) queryInput.current?.focus() }, [selected])
  const keyword = query.trim() !== ''
  const selectHit = (item: ArkmeSearchRecordItem, assetUid?: string) => {
    setSelectedAssetUid(assetUid)
    if (item.sourceKind !== 3 && item.targetSource !== undefined) {
      arkmeUi.showConversationTarget(item.targetSource, item.recordUid, item.sendAtMillis, item.recordOwnerUserId)
      onClose()
    } else setSelected(item)
  }
  return <aside ref={panel} aria-label="聊天记录搜索" style={{ position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 30,
    ...resize.style, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.border}` }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !(typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]')) && !(event.target instanceof Element && event.target.closest('[role="dialog"]'))) { event.stopPropagation(); selected === undefined ? onClose() : setSelected(undefined) } }}>
    {resize.handle}
    <header style={{ padding: '14px 14px 8px', flex: 'none' }}>
      <div style={row}>
        <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{global ? '全局搜索' : source.displayName}</strong>
        <button type="button" style={button} onClick={() => onGlobal(!global)}>{global ? '当前范围' : '全局'}</button>
        <button type="button" aria-label="关闭聊天搜索" style={button} onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ ...row, marginTop: 10, padding: '0 10px', borderRadius: 8, background: arkmeTheme.input }}>
        <MagnifyingGlass size={18} />
        <input ref={queryInput} autoFocus aria-label="搜索聊天关键词" placeholder="搜索" value={query}
          onChange={event => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)}
          onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value) }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); search.submit() } }}
          style={{ width: '100%', minWidth: 0, height: 36, border: 0, outline: 0, background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 14 }} />
        {query !== '' && <button type="button" aria-label="清空搜索" style={button} onClick={() => { setQuery(''); setComposing(false) }}><X size={16} /></button>}
      </div>
      {!keyword && <div role="tablist" aria-label="聊天记录分类" style={{ ...row, overflowX: 'auto', marginTop: 10 }}>
        {scenes.map(item => <button type="button" role="tab" aria-selected={scene === item.key} key={item.key}
          onClick={() => onScene(item.key)} style={{ ...button, flex: 'none', padding: '8px 6px', color: scene === item.key ? arkmeTheme.text : arkmeTheme.secondary,
            borderBottom: scene === item.key ? `2px solid ${arkmeTheme.text}` : '2px solid transparent', borderRadius: 0 }}>{item.label}</button>)}
      </div>}
    </header>
    {selected !== undefined && <SearchDetail item={selected} assetUid={selectedAssetUid} onBack={() => setSelected(undefined)} onLocate={() => {
      if (selected.targetSource !== undefined) { arkmeUi.showConversationTarget(selected.targetSource, selected.recordUid, selected.sendAtMillis, selected.recordOwnerUserId); onClose() }
    }} />}
    <div aria-label="聊天搜索结果" hidden={selected !== undefined} style={{ display: selected === undefined ? undefined : 'none', flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 16px' }}
      onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 160) search.loadMore() }}>
      {search.page?.queryGuard.state && !['complete', 'ok'].includes(search.page.queryGuard.state) && <p role="status" style={status}>搜索结果暂不完整，请缩小范围或调整关键词</p>}
      {search.page?.itemCount !== undefined && <p style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{search.page.itemCount} {keyword ? '条结果' : scene === 'image_video' ? '个媒体' : scene === 'file' ? '个文件' : '条结果'}</p>}
      <div style={!keyword && scene === 'image_video' ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 } : undefined}>
      {search.page?.items.map((item, index, items) => <Fragment key={`${item.sourceKind}:${item.sourceUid ?? ''}:${item.recordOwnerUserId ?? ''}:${item.recordUid}`}>
        {!keyword && (index === 0 || searchMonth(item.sendAtMillis) !== searchMonth(items[index - 1]!.sendAtMillis)) && <p style={{ gridColumn: '1 / -1', margin: '12px 0 8px', fontSize: 12, color: arkmeTheme.secondary }}>{searchMonth(item.sendAtMillis)}</p>}
        <div style={!keyword && scene === 'image_video' ? { display: 'contents' } : { marginBottom: 8 }}>
        {!keyword && scene === 'image_video' ? item.sourceKind === 3 ? item.media.length > 0 ? <ChatSearchMedia item={item} active={selected === undefined} onSelect={selectHit} /> : <button type="button" style={button} onClick={() => selectHit(item)}>查看媒体消息</button> : <div style={{ display: 'contents' }}>
          {item.media.map(asset => { const display = search.assets.get(asset.fileAssetUid); const url = display?.previewUrl ?? display?.downloadUrl
            const video = (display?.mimeType ?? asset.mimeType ?? '').startsWith('video/') || asset.fileKind === 3
            return <button key={asset.fileAssetUid} type="button" aria-label={`查看${video ? '视频' : '图片'} ${display?.fileName ?? asset.fileName ?? ''}`} style={{ ...button, padding: 0, overflow: 'hidden', aspectRatio: '1', background: arkmeTheme.subtle }} onClick={() => selectHit(item, asset.fileAssetUid)}>
              {url === undefined ? '媒体暂不可用' : video ? <video src={url} preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt={display?.fileName ?? asset.fileName ?? '图片'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </button>
          })}
          {item.media.length === 0 && <button type="button" style={button} onClick={() => selectHit(item)}>查看媒体消息</button>}
        </div> : <>
          <RecordRow item={item} onClick={() => selectHit(item)} />
          {!keyword && scene === 'file' && item.files.map(file => <button key={file.fileAssetUid} type="button" style={{ ...button, textAlign: 'left' }} onClick={() => selectHit(item)}>{file.fileName || search.assets.get(file.fileAssetUid)?.fileName || '查看文件'}</button>)}
          {!keyword && scene === 'link' && item.linkUrl !== undefined && <a href={item.linkUrl} target="_blank" rel="noreferrer" style={{ display: 'block', overflowWrap: 'anywhere', padding: 8, color: arkmeTheme.info, fontSize: 13 }}>{item.linkUrl}</a>}
        </>}
      </div></Fragment>)}
      </div>
      {search.loading && <div role="status" style={status}>加载中…</div>}
      {search.error !== '' && <div role="alert" style={status}>{search.error}<button type="button" style={button} onClick={search.retry}>重试</button></div>}
      {!search.loading && !search.error && search.page?.items.length === 0 && ['complete', 'ok'].includes(search.page.queryGuard.state) && <div style={status}>暂无搜索结果</div>}
      {!search.loading && !search.error && search.page?.hasMore && <button type="button" style={{ ...button, width: '100%' }} onClick={search.loadMore}>加载更多</button>}
    </div>
  </aside>
}

function ChatSearchMedia({ item, active, onSelect }: { item: ArkmeSearchRecordItem; active: boolean; onSelect(item: ArkmeSearchRecordItem, assetUid?: string): void }) {
  const element = useRef<HTMLDivElement>(null)
  const { detail, error } = useConversationSearchDetail(item, element, active)
  const blocks = detail?.contentBlocks?.filter(block => block.kind === 'image' || block.kind === 'video') ?? []
  return <div ref={element} style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
    {blocks.length === 0 ? <button type="button" style={{ ...button, minHeight: 96 }} onClick={() => onSelect(item)}>{error ? '媒体加载失败，点击重试' : detail ? '查看媒体消息' : '加载媒体…'}</button>
      : blocks.map(block => <button key={block.mediaRef} type="button" aria-label={`查看${block.kind === 'video' ? '视频' : '图片'} ${block.fileName ?? ''}`}
        style={{ ...button, padding: 0, overflow: 'hidden', aspectRatio: '1', background: arkmeTheme.subtle }} onClick={() => onSelect(item, block.fileAssetUid)}>
        {block.kind === 'video' ? <video src={`/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`} preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={`/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`} alt={block.fileName ?? '图片'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </button>)}
  </div>
}

function SearchDetail({ item, assetUid, onBack, onLocate }: { item: ArkmeSearchRecordItem; assetUid: string | undefined; onBack(): void; onLocate(): void }) {
  const { detail, error, retry } = useConversationSearchDetail(item)
  const [preview, setPreview] = useState<ArkmeContentBlock>()
  useEffect(() => {
    setPreview(assetUid === undefined ? undefined : detail?.contentBlocks?.find(block => block.fileAssetUid === assetUid && (block.kind === 'image' || block.kind === 'video')))
  }, [assetUid, detail])
  return <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 20px' }}>
    {preview !== undefined && <ArkmeMediaPreview blocks={(detail?.contentBlocks ?? []).filter(block => block.kind === 'image' || block.kind === 'video')} selected={preview} onSelect={setPreview} onClose={() => setPreview(undefined)} />}
    <div style={{ ...row, justifyContent: 'space-between' }}><button autoFocus type="button" style={button} onClick={onBack}>返回结果</button>
      <button type="button" style={button} disabled={item.targetSource === undefined || item.recordOwnerUserId === undefined || detail === undefined} onClick={onLocate}>定位到消息</button></div>
    {error !== '' ? <div role="alert" style={status}>{error}<button type="button" style={button} onClick={retry}>重试</button></div>
      : detail === undefined ? <div role="status" style={status}>加载详情…</div>
        : <><p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{detail.senderName} · {new Date(detail.sendAtMillis).toLocaleString('zh-CN')}</p>
          <ArkmeMessageContent item={detail} presentation="detail" collapseText={false} {...(item.targetSource === undefined ? {} : { sourceRef: item.targetSource.sourceRef })} /></>}
  </div>
}
