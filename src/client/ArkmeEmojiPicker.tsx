import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  ArkmeFavoriteSticker, ArkmeFavoriteStickerList, ArkmeFavoriteStickerSaveInput, ArkmeSourceSendResult, ArkmeUploadedAsset,
} from '../types.js'
import { callArkme } from './api.js'
import {
  arkmeDefaultEmojis, arkmeEmojiById, nextArkmeRecentEmojiIds,
  type ArkmeEmoji,
} from './arkme-emoji.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeComposerEmojiIcon } from './ArkmeComposerToolIcon.js'

const recentStorageKey = 'arkme:chat-emoji:recent:v1'
export const arkmeDefaultEmojiGridColumns = 14

interface ArkmePendingFavoriteSticker {
  id: string
  file: File
  previewUrl: string
  status: 'uploading' | 'failed'
  error?: string
  uploadedAsset?: ArkmeUploadedAsset
}

interface ArkmeFavoriteStickerMenuState {
  x: number
  y: number
  stickerId: string
  kind: 'remote' | 'pending'
}

const styles: Record<string, CSSProperties> = {
  host: { position: 'relative', flex: 'none' },
  triggerIcon: { width: 20, height: 20, display: 'block', transform: 'translateY(1.5px)' },
  trigger: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 9,
    appearance: 'none', WebkitAppearance: 'none',
    background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)', cursor: 'pointer',
  },
  panel: {
    position: 'absolute', zIndex: 30, left: 0, bottom: 44, width: 'min(476px, calc(100vw - 48px))',
    maxHeight: 'min(368px, calc(100vh - 120px))', overflow: 'hidden', padding: 0,
    boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 12,
    background: 'var(--dsw-specific-input-major, #fff)', boxShadow: '0 12px 34px rgba(20, 24, 31, .16)',
  },
  section: { margin: 0 },
  sectionSpaced: { margin: '18px 0 0' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  title: { flex: 'none', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 12, lineHeight: '18px' },
  hint: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary, #9097a1)', fontSize: 11, lineHeight: '18px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 28px)', gap: 4 },
  defaultGrid: {
    gridTemplateColumns: `repeat(${arkmeDefaultEmojiGridColumns}, 28px)`,
    columnGap: 0, rowGap: 4, justifyContent: 'space-between',
  },
  emoji: {
    position: 'relative', width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6,
    background: 'transparent', cursor: 'pointer',
  },
  emojiImage: { width: 24, height: 24, display: 'block' },
  tooltip: {
    position: 'absolute', zIndex: 2, left: '50%', bottom: 32, transform: 'translateX(-50%)',
    padding: '4px 7px', borderRadius: 6, background: 'rgba(30, 30, 30, .92)', color: '#fff',
    boxShadow: '0 2px 8px rgba(0, 0, 0, .18)', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', pointerEvents: 'none',
  },
  tooltipArrow: {
    position: 'absolute', left: '50%', bottom: -4, width: 8, height: 8,
    transform: 'translateX(-50%) rotate(45deg)', background: 'rgba(30, 30, 30, .92)',
  },
  body: { maxHeight: 306, overflowY: 'auto', padding: '14px 16px 16px', boxSizing: 'border-box' },
  favoriteBody: { height: 278, overflowY: 'auto', padding: '16px 20px', boxSizing: 'border-box' },
  favoriteGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 82px)', gap: 8, alignContent: 'start' },
  stickerTile: {
    position: 'relative', width: 82, height: 82, padding: 0, overflow: 'hidden', border: 0, borderRadius: 12,
    background: 'var(--dsw-alias-fill-l2, #f5f6f7)', cursor: 'pointer',
  },
  stickerImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  stickerFallback: { width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#a7adb5', fontSize: 24 },
  addTile: {
    width: 82, height: 82, display: 'grid', placeItems: 'center', padding: 0, borderRadius: 12,
    border: '1px dashed var(--dsw-alias-border-l2, #d9dde2)', background: 'transparent', color: '#c6c9ce', cursor: 'pointer',
  },
  gifBadge: {
    position: 'absolute', right: 6, bottom: 6, padding: '2px 5px', borderRadius: 7,
    background: 'rgba(32,32,32,.72)', color: '#fff', fontSize: 10, lineHeight: '15px',
  },
  empty: { gridColumn: '1 / -1', padding: '82px 0', textAlign: 'center', color: '#9aa0a8', fontSize: 13 },
  toolbar: {
    height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', borderTop: '1px solid var(--dsw-alias-border-l1, #eceef0)',
  },
  tab: {
    width: 42, height: 40, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 10,
    background: 'transparent', color: '#a8adb4', cursor: 'pointer',
  },
  stateText: { padding: '92px 0', textAlign: 'center', color: '#8b929c', fontSize: 13 },
  retryButton: { marginTop: 8, padding: '4px 12px', border: 0, borderRadius: 7, background: 'transparent', color: '#596eab', cursor: 'pointer', fontSize: 13 },
  stickerOverlay: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 8, boxSizing: 'border-box', borderRadius: 12, background: 'rgba(20,22,27,.55)', color: '#fff',
    fontSize: 11, lineHeight: '16px', pointerEvents: 'none',
  },
  spinner: { width: 13, height: 13, border: '2px solid rgba(255,255,255,.45)', borderTopColor: '#fff', borderRadius: 999 },
  skeleton: { width: 82, height: 82, borderRadius: 12, background: 'var(--dsw-alias-fill-l2, #f1f2f4)' },
  contextMenu: {
    position: 'fixed', zIndex: 100, width: 132, padding: 5, boxSizing: 'border-box', border: '1px solid rgba(120,126,136,.14)',
    borderRadius: 10, background: 'rgba(255,255,255,.96)', boxShadow: '0 10px 30px rgba(20,24,31,.20)', backdropFilter: 'blur(16px)',
  },
  contextMenuItem: {
    width: '100%', height: 34, padding: '0 12px', border: 0, borderRadius: 6, background: 'transparent',
    color: '#30343a', cursor: 'pointer', textAlign: 'left', fontSize: 13,
  },
}

function loadRecentEmojiIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(recentStorageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && arkmeEmojiById[value] !== undefined).slice(0, 14)
  } catch {
    return []
  }
}

function saveRecentEmojiIds(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(recentStorageKey, JSON.stringify(ids)) } catch { /* private storage can be unavailable */ }
}

function SmileIcon() {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden data-arkme-composer-action-icon="emoji">
    <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="1" fill="currentColor" />
    <circle cx="15" cy="10" r="1" fill="currentColor" />
    <path d="M8.5 14c.9 1.25 2.05 1.88 3.5 1.88S14.6 15.25 15.5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}

function HeartIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
    <path d="M12 20.1S4 15.2 4 9.3C4 6.3 6.1 4.5 8.5 4.5c1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2 2.4 0 4.5 1.8 4.5 4.8 0 5.9-8 10.8-8 10.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
}

function RefreshIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
    <path d="M19 7v5h-5M5 17v-5h5M18.1 12a6.2 6.2 0 0 0-10.6-4.1L5 10m14 4-2.5 2.1A6.2 6.2 0 0 1 5.9 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function StickerFallbackIcon() {
  return <svg viewBox="0 0 24 24" width="27" height="27" fill="none" aria-hidden>
    <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="1.3" fill="currentColor" />
    <path d="m6.5 17 4.2-4 2.7 2.4 2.1-1.8 2 1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function favoriteStickerSaveInput(item: ArkmeFavoriteSticker): ArkmeFavoriteStickerSaveInput {
  return {
    fileAssetUid: item.fileAssetUid, fileName: item.fileName, mimeType: item.mimeType,
    size: item.size, fileKind: 1, isAnimated: item.isAnimated,
  }
}

function EmojiGrid({ emojis, layout = 'compact', onSelect }: {
  emojis: readonly ArkmeEmoji[]
  layout?: 'compact' | 'default'
  onSelect(emoji: ArkmeEmoji): void
}) {
  const [hoveredId, setHoveredId] = useState('')
  return <div
    data-arkme-emoji-grid={layout}
    style={{ ...styles.grid, ...(layout === 'default' ? styles.defaultGrid : {}) }}
  >
    {emojis.map(emoji => <button
      key={emoji.id}
      type="button"
      style={{ ...styles.emoji, ...(hoveredId === emoji.id ? { background: 'var(--dsw-alias-fill-hover, rgba(127,127,127,.10))' } : {}) }}
      aria-label={emoji.label}
      data-arkme-emoji-id={emoji.id}
      aria-describedby={hoveredId === emoji.id ? `arkme-emoji-tooltip-${emoji.id}` : undefined}
      onMouseDown={event => { event.preventDefault() }}
      onMouseEnter={() => { setHoveredId(emoji.id) }}
      onMouseLeave={() => { setHoveredId(current => current === emoji.id ? '' : current) }}
      onClick={() => { onSelect(emoji) }}
    ><img
      src={emoji.assetUrl}
      alt=""
      aria-hidden
      draggable={false}
      style={styles.emojiImage}
    />{hoveredId === emoji.id && <span id={`arkme-emoji-tooltip-${emoji.id}`} role="tooltip" style={styles.tooltip}>
      {emoji.label}<span aria-hidden style={styles.tooltipArrow} />
    </span>}</button>)}
  </div>
}

export function ArkmeEmojiPicker({ disabled, scopeKey, sourceRef, onBeforeToggle, onSelect, onUploadSticker, onStickerSent, onError }: {
  disabled: boolean
  scopeKey: string | undefined
  sourceRef?: string
  onBeforeToggle?: () => void
  onSelect(emoji: ArkmeEmoji): void
  onUploadSticker?: (file: File) => Promise<ArkmeUploadedAsset>
  onStickerSent?: (result: ArkmeSourceSendResult) => void | Promise<void>
  onError?: (message: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stickerInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'emoji' | 'favorite'>('emoji')
  const [stickers, setStickers] = useState<ArkmeFavoriteSticker[]>([])
  const [loadPhase, setLoadPhase] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [pendingStickers, setPendingStickers] = useState<ArkmePendingFavoriteSticker[]>([])
  const pendingStickersRef = useRef<ArkmePendingFavoriteSticker[]>([])
  const [busyStickerId, setBusyStickerId] = useState('')
  const [previewFailedIds, setPreviewFailedIds] = useState<Set<string>>(() => new Set())
  const [previewRevision, setPreviewRevision] = useState(0)
  const [contextMenu, setContextMenu] = useState<ArkmeFavoriteStickerMenuState>()
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentEmojiIds)
  const previousScopeKey = useRef(scopeKey)
  const recentEmojis = recentIds.map(id => arkmeEmojiById[id]).filter((emoji): emoji is ArkmeEmoji => emoji !== undefined)

  useEffect(() => {
    if (previousScopeKey.current !== scopeKey) setOpen(false)
    previousScopeKey.current = scopeKey
  }, [scopeKey])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && hostRef.current?.contains(event.target) !== true) setOpen(false)
      setContextMenu(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    pendingStickersRef.current = pendingStickers
  }, [pendingStickers])

  useEffect(() => () => {
    for (const item of pendingStickersRef.current) {
      if (item.previewUrl !== '') URL.revokeObjectURL(item.previewUrl)
    }
  }, [])

  const select = (emoji: ArkmeEmoji) => {
    const nextRecentIds = nextArkmeRecentEmojiIds(recentIds, emoji.id)
    setRecentIds(nextRecentIds)
    saveRecentEmojiIds(nextRecentIds)
    onSelect(emoji)
  }

  const loadStickers = async () => {
    setLoadPhase('loading')
    try {
      const result = await callArkme<ArkmeFavoriteStickerList>('favorite-stickers.list')
      setStickers(result.items)
      setPreviewFailedIds(new Set())
      setPreviewRevision(value => value + 1)
      setLoadPhase('success')
    } catch (caught) {
      setLoadPhase('error')
      onError?.(caught instanceof Error ? caught.message : '收藏表情加载失败')
    }
  }

  useEffect(() => {
    if (open && tab === 'favorite' && loadPhase === 'idle') void loadStickers()
  }, [open, tab, loadPhase])

  const saveStickerItems = async (items: readonly ArkmeFavoriteStickerSaveInput[]) => {
    const result = await callArkme<ArkmeFavoriteStickerList>('favorite-stickers.save', { items })
    setStickers(result.items)
    setLoadPhase('success')
  }

  const persistPendingSticker = async (pending: ArkmePendingFavoriteSticker) => {
    setBusyStickerId(pending.id)
    setPendingStickers(current => current.map(item => {
      if (item.id !== pending.id) return item
      const { error: _error, ...rest } = item
      return { ...rest, status: 'uploading' }
    }))
    try {
      const asset = pending.uploadedAsset ?? await onUploadSticker!(pending.file)
      setPendingStickers(current => current.map(item => item.id === pending.id ? { ...item, uploadedAsset: asset } : item))
      await saveStickerItems([{
        fileAssetUid: asset.fileAssetUid, fileName: asset.fileName, mimeType: asset.mimeType,
        size: asset.size, fileKind: 1, isAnimated: asset.mimeType.toLowerCase() === 'image/gif',
      }, ...stickers.map(favoriteStickerSaveInput).filter(item => item.fileAssetUid !== asset.fileAssetUid)])
      setPendingStickers(current => current.filter(item => item.id !== pending.id))
      if (pending.previewUrl !== '') URL.revokeObjectURL(pending.previewUrl)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '收藏表情添加失败'
      setPendingStickers(current => current.map(item => item.id === pending.id ? { ...item, status: 'failed', error: message } : item))
      onError?.(message)
    } finally { setBusyStickerId(current => current === pending.id ? '' : current) }
  }

  const addSticker = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || onUploadSticker === undefined) return
    if (!file.type.toLowerCase().startsWith('image/')) { onError?.('请选择图片或 GIF'); return }
    const pending: ArkmePendingFavoriteSticker = {
      id: `pending:${crypto.randomUUID()}`, file,
      previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
      status: 'uploading',
    }
    setPendingStickers(current => [pending, ...current])
    void persistPendingSticker(pending)
  }

  const sendSticker = async (sticker: ArkmeFavoriteSticker) => {
    if (sourceRef === undefined || busyStickerId !== '' || !sticker.isAvailable || previewFailedIds.has(sticker.fileAssetUid)) return
    setBusyStickerId(sticker.fileAssetUid)
    try {
      const result = await callArkme<ArkmeSourceSendResult>('favorite-stickers.send', {
        sourceRef, fileAssetUid: sticker.fileAssetUid, recordUid: crypto.randomUUID(), relationUid: crypto.randomUUID(),
      })
      setOpen(false)
      await onStickerSent?.(result)
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : '表情发送失败')
    } finally { setBusyStickerId('') }
  }

  const manageSticker = async (sticker: ArkmeFavoriteSticker, action: 'move-to-front' | 'delete') => {
    setContextMenu(undefined)
    setBusyStickerId(sticker.fileAssetUid)
    try {
      const result = await callArkme<ArkmeFavoriteStickerList>('favorite-stickers.manage', {
        fileAssetUid: sticker.fileAssetUid, action,
      })
      setStickers(result.items)
      setLoadPhase('success')
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : '收藏表情管理失败')
    } finally { setBusyStickerId('') }
  }

  const removePendingSticker = (pending: ArkmePendingFavoriteSticker) => {
    setContextMenu(undefined)
    setPendingStickers(current => current.filter(item => item.id !== pending.id))
    if (pending.previewUrl !== '') URL.revokeObjectURL(pending.previewUrl)
  }

  const retryPreview = (sticker: ArkmeFavoriteSticker, event?: ReactMouseEvent) => {
    event?.stopPropagation()
    setPreviewFailedIds(current => {
      const next = new Set(current)
      next.delete(sticker.fileAssetUid)
      return next
    })
    setPreviewRevision(value => value + 1)
    void loadStickers()
  }

  const showContextMenu = (event: ReactMouseEvent, stickerId: string, kind: 'remote' | 'pending') => {
    event.preventDefault()
    event.stopPropagation()
    const width = 132
    const menuItems = kind === 'pending' ? 2 : 3
    const height = menuItems * 34 + 10
    const viewportWidth = typeof window === 'undefined' ? 1_024 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
    const x = Math.max(8, Math.min(event.clientX - width / 2, viewportWidth - width - 8))
    const preferredY = event.clientY - height - 8
    const y = preferredY >= 8 ? preferredY : Math.min(event.clientY + 8, viewportHeight - height - 8)
    setContextMenu({ x, y, stickerId, kind })
  }

  return <div ref={hostRef} style={styles.host} data-arkme-emoji-picker>
    <ArkmeComposerToolButton
      disabled={disabled}
      aria-label="选择表情"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-arkme-composer-tool="emoji"
      onMouseDown={event => { onBeforeToggle?.(); event.preventDefault() }}
      onClick={() => { setOpen(value => !value) }}
    ><span style={styles.triggerIcon}><ArkmeComposerEmojiIcon /></span></ArkmeComposerToolButton>
    {open && <section role="dialog" aria-label="表情选择器" style={styles.panel} data-arkme-emoji-panel>
      {tab === 'emoji' ? <div style={styles.body}>{recentEmojis.length > 0 && <div style={styles.section}>
        <div style={styles.titleRow}><span style={styles.title}>最近使用</span></div>
        <EmojiGrid emojis={recentEmojis} onSelect={select} />
      </div>}
      <div style={recentEmojis.length > 0 ? styles.sectionSpaced : styles.section}>
        <div style={styles.titleRow}>
          <span style={styles.title}>默认表情</span>
          <span style={styles.hint}>创作者：牛mo王</span>
        </div>
        <EmojiGrid emojis={arkmeDefaultEmojis} layout="default" onSelect={select} />
      </div></div> : <div style={styles.favoriteBody}>
        {loadPhase === 'error' && stickers.length === 0 && pendingStickers.length === 0 ? <div style={styles.stateText} role="alert">
          <div>加载失败</div>
          <button type="button" style={styles.retryButton} onClick={() => { void loadStickers() }}>重试</button>
        </div> : <div style={styles.favoriteGrid} data-arkme-favorite-sticker-grid="true">
          <button
            type="button" style={styles.addTile} aria-label="添加收藏表情" title="添加收藏表情"
            disabled={busyStickerId !== '' || onUploadSticker === undefined}
            onClick={() => { stickerInputRef.current?.click() }}
          ><PlusIcon /></button>
          {loadPhase === 'loading' && stickers.length === 0 && pendingStickers.length === 0 && Array.from({ length: 5 }, (_, index) => <div key={`skeleton:${String(index)}`} style={styles.skeleton} data-arkme-favorite-sticker-skeleton="true" />)}
          {pendingStickers.map(pending => <button
            key={pending.id} type="button" style={styles.stickerTile}
            aria-label={pending.status === 'failed' ? `重试${pending.file.name}` : `正在上传${pending.file.name}`}
            title={pending.error ?? pending.file.name}
            onClick={() => { if (pending.status === 'failed') void persistPendingSticker(pending) }}
            onContextMenu={event => { showContextMenu(event, pending.id, 'pending') }}
          >{pending.previewUrl !== '' ? <img src={pending.previewUrl} alt="" draggable={false} style={styles.stickerImage} /> : <span style={styles.stickerFallback}><StickerFallbackIcon /></span>}
            <span style={styles.stickerOverlay}>{pending.status === 'uploading' ? <><span style={styles.spinner} />上传中</> : <><RefreshIcon />点击重试</>}</span>
            {pending.file.type.toLowerCase() === 'image/gif' && <span style={styles.gifBadge}>GIF</span>}
          </button>)}
          {stickers.map(sticker => {
            const previewFailed = previewFailedIds.has(sticker.fileAssetUid)
            const sendSupported = sourceRef !== undefined
            const available = sendSupported && sticker.isAvailable && !previewFailed
            return <button
              key={sticker.fileAssetUid} type="button" style={{ ...styles.stickerTile, opacity: sticker.isAvailable ? 1 : .62 }}
              aria-label={available ? `发送${sticker.fileName}` : previewFailed ? `重试${sticker.fileName}` : !sendSupported ? `${sticker.fileName}仅聊天可发送` : `${sticker.fileName}不可用`}
              aria-disabled={!available}
              title={available ? sticker.fileName : previewFailed ? '预览加载失败，点击重试' : !sendSupported ? '收藏表情仅支持私聊和群聊发送' : sticker.unavailableReason}
              onClick={event => { if (previewFailed) retryPreview(sticker, event); else if (available) void sendSticker(sticker) }}
              onContextMenu={event => { showContextMenu(event, sticker.fileAssetUid, 'remote') }}
            >{sticker.mediaRef !== undefined && !previewFailed ? <img
                key={`${sticker.mediaRef}:${String(previewRevision)}`}
                src={`/arkme-self/api/media?ref=${encodeURIComponent(sticker.mediaRef)}&retry=${String(previewRevision)}`}
                alt="" draggable={false} style={styles.stickerImage}
                onError={() => { setPreviewFailedIds(current => new Set(current).add(sticker.fileAssetUid)) }}
              /> : <span style={styles.stickerFallback}><StickerFallbackIcon /></span>}
              {busyStickerId === sticker.fileAssetUid && <span style={styles.stickerOverlay}><span style={styles.spinner} />处理中</span>}
              {busyStickerId !== sticker.fileAssetUid && previewFailed && <span style={styles.stickerOverlay}><RefreshIcon />点击重试</span>}
              {busyStickerId !== sticker.fileAssetUid && !sticker.isAvailable && !previewFailed && <span style={styles.stickerOverlay}>不可用</span>}
              {sticker.isAnimated && <span style={styles.gifBadge}>GIF</span>}
            </button>
          })}
          {loadPhase !== 'loading' && stickers.length === 0 && pendingStickers.length === 0 && <div style={styles.empty}>暂无收藏表情，点击 + 添加</div>}
        </div>}
        <input ref={stickerInputRef} type="file" accept="image/*,.gif" hidden onChange={addSticker} />
      </div>}
      <div style={styles.toolbar}>
        <button type="button" style={{ ...styles.tab, ...(tab === 'emoji' ? { background: '#f3f4f5', color: '#737a84' } : {}) }} aria-label="默认表情" title="默认表情" onClick={() => { setTab('emoji') }}><SmileIcon /></button>
        <button type="button" style={{ ...styles.tab, ...(tab === 'favorite' ? { background: '#f3f4f5', color: '#737a84' } : {}) }} aria-label="收藏表情" title="收藏表情" onClick={() => { setTab('favorite') }}><HeartIcon /></button>
      </div>
      {contextMenu !== undefined && <div
        role="menu" aria-label="收藏表情操作" data-arkme-favorite-sticker-context-menu="true"
        style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={event => { event.stopPropagation() }}
      >{contextMenu.kind === 'remote' ? (() => {
          const sticker = stickers.find(item => item.fileAssetUid === contextMenu.stickerId)
          if (sticker === undefined) return null
          return <>
            <button type="button" role="menuitem" style={styles.contextMenuItem} onClick={() => { void manageSticker(sticker, 'move-to-front') }}>移至最前</button>
            {previewFailedIds.has(sticker.fileAssetUid) && <button type="button" role="menuitem" style={styles.contextMenuItem} onClick={event => { setContextMenu(undefined); retryPreview(sticker, event) }}>重试</button>}
            <button type="button" role="menuitem" style={{ ...styles.contextMenuItem, color: '#d84a4a' }} onClick={() => { void manageSticker(sticker, 'delete') }}>删除</button>
          </>
        })() : (() => {
          const pending = pendingStickers.find(item => item.id === contextMenu.stickerId)
          if (pending === undefined) return null
          return <>
            {pending.status === 'failed' && <button type="button" role="menuitem" style={styles.contextMenuItem} onClick={() => { setContextMenu(undefined); void persistPendingSticker(pending) }}>重试</button>}
            <button type="button" role="menuitem" style={{ ...styles.contextMenuItem, color: '#d84a4a' }} onClick={() => { removePendingSticker(pending) }}>删除</button>
          </>
        })()}
      </div>}
    </section>}
  </div>
}
