import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ChatCircleDots } from '@phosphor-icons/react/dist/icons/ChatCircleDots'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeImagePayload,
  ArkmeUploadedAsset,
  ArkmeWorldPublishResult,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldInteractionPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
} from '../types.js'
import { ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES, ARKME_WORLD_PUBLISH_MAX_IMAGES } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeEmojiPlainText } from './arkme-emoji.js'
import type { ArkmeWorldTarget } from './ui-controller.js'
import { resolveWorldVoiceprintExpectationCopy } from './world-voiceprint-expectation-copy.js'

type WorldScope = 'all' | 'mine'

const worldSdk = createArkmeSdk()

export type ArkmeWorldViewState = {
  status: 'loading' | 'error' | 'empty' | 'success'
  items: ArkmeWorldFeedItem[]
  message?: string
  refreshing?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  nextOffset?: number
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #20232c)',
  secondary: 'var(--dsw-alias-label-secondary, #858992)',
  border: 'var(--dsw-alias-border-l2, #ececef)',
  subtle: 'var(--dsw-alias-bg-subtle, #f5f5f6)',
  accent: '#59678e',
  danger: '#b9423b',
}

const styles: Record<string, CSSProperties> = {
  root: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', color: colors.text },
  header: { width: 'min(980px, 100%)', minHeight: 90, margin: '0 auto', padding: '34px 48px 0', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 },
  heading: { margin: 0, fontSize: 26, lineHeight: '34px', fontWeight: 650, letterSpacing: '-.035em' },
  subtitle: { margin: '2px 0 0', color: colors.secondary, fontSize: 11 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  targetHeading: { display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 },
  targetTitle: { minWidth: 0, display: 'grid', gap: 1 },
  backButton: { width: 34, height: 34, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  button: { minHeight: 36, padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 10, background: '#fff', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  iconButton: { width: 32, height: 32, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: '#737984', cursor: 'pointer' },
  primaryButton: { minHeight: 34, padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: '#191b25', background: '#191b25', color: '#fff' },
  worldToolbar: { width: 'min(980px, 100%)', minHeight: 38, margin: '0 auto 4px', padding: '0 48px', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch' },
  tabs: { minWidth: 0, height: 38, padding: 0, display: 'flex', alignItems: 'stretch', gap: 23 },
  tab: { position: 'relative', padding: 0, border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: '#7b8089', cursor: 'pointer', font: 'inherit', fontSize: 12 },
  tabActive: { borderBottom: '2px solid #20232d', color: colors.text, fontWeight: 600 },
  worldLayout: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', position: 'relative', background: '#fff' },
  body: { flex: 1, minWidth: 0, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', overscrollBehavior: 'contain', background: '#fff' },
  notice: { width: 'min(884px, calc(100% - 96px))', margin: '22px auto 0', padding: '13px 15px', boxSizing: 'border-box', border: 0, borderRadius: 12, background: '#f6f6f7', color: colors.secondary, fontSize: 12 },
  error: { borderColor: 'rgba(185,66,59,.25)', background: 'rgba(185,66,59,.06)', color: colors.danger },
  errorRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  feed: { width: 'min(884px, calc(100% - 96px))', maxWidth: '100%', minWidth: 0, margin: '10px auto 48px', boxSizing: 'border-box', display: 'grid', gap: 16 },
  card: { minWidth: 0, maxWidth: '100%', padding: '22px 20px 18px', boxSizing: 'border-box', border: '1px dashed #d7dbe3', borderRadius: 14, background: '#fff' },
  cardHeader: { minWidth: 0, maxWidth: '100%', display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: '#e8eaf1', color: '#59616e', fontSize: 13, fontWeight: 600 },
  avatarImage: { width: '100%', height: '100%', objectFit: 'cover' },
  authorMeta: { minWidth: 0, display: 'grid', alignItems: 'center' },
  authorRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 },
  author: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 },
  voiceprintButton: { width: 20, height: 20, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer', lineHeight: 0 },
  voiceprintPlayable: { color: '#979da6' },
  voiceprintActive: { background: '#f0f1f3', color: '#565c66' },
  voiceprintInvite: { color: '#9aa1ad' },
  time: { whiteSpace: 'nowrap', color: '#989ba3', fontSize: 10 },
  headline: { minWidth: 0, maxWidth: '100%', margin: '12px 0 0', overflowWrap: 'anywhere', fontSize: 15, lineHeight: 1.5, fontWeight: 600 },
  text: { minWidth: 0, maxWidth: '100%', margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#3b3f48', fontSize: 13, lineHeight: 1.62 },
  imageGrid: { width: '100%', maxWidth: 620, minWidth: 0, marginTop: 12, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 },
  image: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 11, background: '#f1f1f3' },
  imageButton: { minWidth: 0, padding: 0, border: 0, borderRadius: 11, overflow: 'hidden', background: '#f1f1f3', cursor: 'pointer' },
  cardFooter: { minHeight: 24, marginTop: 9, paddingTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 },
  linkButton: { padding: '5px 7px', border: 0, borderRadius: 7, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  commentButton: { padding: '3px 0', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', color: '#7e848e', cursor: 'pointer', font: 'inherit', fontSize: 11 },
  commentButtonActive: { color: colors.accent, fontWeight: 600 },
  commentPreview: { position: 'relative', marginTop: 6, padding: '8px 12px', overflow: 'hidden', borderRadius: 10, background: colors.subtle },
  commentPreviewHitTarget: { position: 'absolute', inset: 0, width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  compactCommentRow: { display: 'block', minWidth: 0, overflow: 'hidden', color: '#555a63', fontSize: 11, lineHeight: 1.72, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  compactCommentReply: { paddingLeft: 14 },
  compactCommentAuthor: { color: colors.accent, fontWeight: 650 },
  feedLoadMore: { minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.secondary },
  feedLoadMoreStatus: { width: 30, height: 30, display: 'grid', placeItems: 'center' },
  feedLoadMoreSpinner: { width: 22, height: 22, display: 'block' },
  feedLoadMoreRetry: { minHeight: 30, padding: '0 12px', border: 0, borderRadius: 8, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(19,21,27,.38)' },
  modal: { width: 'min(540px, 100%)', maxHeight: 'min(720px, 88vh)', overflowY: 'auto', padding: 22, boxSizing: 'border-box', borderRadius: 18, background: '#fff', boxShadow: '0 18px 60px rgba(20,22,30,.22)' },
  modalTitle: { margin: 0, fontSize: 19 },
  modalText: { margin: '7px 0 16px', color: colors.secondary, fontSize: 12, lineHeight: 1.6 },
  textarea: { width: '100%', minHeight: 130, resize: 'vertical', padding: 12, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.text, font: 'inherit', fontSize: 13, lineHeight: 1.6, outline: 0 },
  fieldLabel: { display: 'grid', gap: 7, marginTop: 12, color: colors.secondary, fontSize: 12 },
  fileInput: { maxWidth: '100%', color: colors.secondary, fontSize: 12 },
  modalActions: { marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  modalError: { color: colors.danger, fontSize: 12 },
  inviteModal: { width: 'min(420px, 100%)', padding: 0, overflow: 'hidden', borderRadius: 20 },
  inviteContent: { padding: '28px 24px 26px', textAlign: 'center' },
  inviteTitle: { margin: 0, color: colors.text, fontSize: 17, lineHeight: 1.35, fontWeight: 700 },
  inviteAction: { margin: '14px 0 0', color: colors.secondary, fontSize: 15, lineHeight: 1.45 },
  inviteRelationship: { margin: '16px 0 0', color: 'color-mix(in srgb, var(--dsw-alias-label-primary, #17191c) 78%, transparent)', fontSize: 14, lineHeight: 1.35, fontWeight: 500 },
  inviteStatus: { minHeight: 18, margin: '12px 0 0', color: colors.danger, fontSize: 12, lineHeight: 1.5 },
  inviteActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${colors.border}` },
  inviteActionButton: { minHeight: 52, padding: '15px 12px', border: 0, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 16 },
  inviteConfirmButton: { borderLeft: `1px solid ${colors.border}`, color: colors.accent },
  interactionPanel: { width: 'calc(100% - 4px)', minWidth: 0, margin: '6px 2px 16px', padding: '0 12px 12px', boxSizing: 'border-box', display: 'grid', borderRadius: 12, background: colors.subtle },
  interactionPanelSticky: { position: 'sticky', top: 0, zIndex: 3, padding: '4px 0 10px', borderBottom: `1px solid ${colors.border}`, background: 'color-mix(in srgb, var(--dsw-alias-bg-subtle, #f5f5f6) 96%, white)' },
  interactionPanelHeader: { minHeight: 36, padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  interactionPanelTitle: { fontSize: 14, fontWeight: 600 },
  interactionPanelClose: { minHeight: 32, padding: '0 2px 0 10px', border: 0, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  interactionPanelBody: { minWidth: 0, padding: '4px 2px 10px' },
  interactionEmpty: { minHeight: 96, display: 'grid', placeItems: 'center', color: '#969ba5', fontSize: 12 },
  interactionList: { display: 'grid', margin: 0 },
  interactionThread: { padding: '12px 0' },
  interactionRoot: { display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', alignItems: 'start', gap: 8 },
  interactionReplyList: { display: 'grid', margin: '7px 0 0 36px', paddingLeft: 9, borderLeft: `2px solid ${colors.border}` },
  interactionReply: { display: 'grid', gridTemplateColumns: '22px minmax(0,1fr)', alignItems: 'start', gap: 7, padding: '7px 0' },
  interactionAvatar: { width: 28, height: 28, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: '#e8eaf1', color: '#59616e', fontSize: 10, fontWeight: 650 },
  interactionReplyAvatar: { width: 22, height: 22, fontSize: 8 },
  interactionBody: { minWidth: 0 },
  interactionMeta: { minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, color: colors.secondary, fontSize: 10 },
  interactionAuthorLine: { minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  interactionAuthor: { color: colors.text, fontSize: 12, fontWeight: 650 },
  interactionReplyAuthor: { fontSize: 11 },
  interactionReplyTarget: { color: colors.secondary, fontSize: 11 },
  interactionContentRow: { minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 10 },
  interactionText: { minWidth: 0, margin: '3px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#4d535d', fontSize: 12, lineHeight: 1.55 },
  interactionReplyText: { fontSize: 11, lineHeight: 1.5 },
  interactionAction: { alignSelf: 'end', padding: '2px 0 1px 8px', border: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 10, whiteSpace: 'nowrap' },
  interactionComposer: { padding: '2px 2px 0', background: 'transparent' },
  interactionComposerRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 9 },
  interactionInput: { width: '100%', height: 40, minHeight: 40, maxHeight: 96, resize: 'none', overflowY: 'auto', padding: '9px 11px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, background: '#fff', font: 'inherit', fontSize: 12, lineHeight: 1.65, outline: 0 },
  interactionSend: { minWidth: 54, height: 40, padding: '0 13px', border: 0, borderRadius: 10, background: '#191b25', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 11 },
  previewBackdrop: { position: 'fixed', inset: 0, zIndex: 1300, display: 'grid', placeItems: 'center', padding: '20px 10px', boxSizing: 'border-box', background: 'rgba(0,0,0,.78)' },
  previewModal: { position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
  previewStage: { position: 'absolute', top: 30, right: 0, bottom: 20, left: 0, minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 12 },
  previewViewport: { position: 'absolute', inset: 0, minWidth: 0, minHeight: 0, overflow: 'hidden', overscrollBehavior: 'contain' },
  previewMedia: { position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
  previewImage: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' },
  previewClose: { position: 'absolute', top: 0, right: 8, zIndex: 2, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'rgba(255,255,255,.14)', color: '#fff', cursor: 'pointer' },
  previewNav: { position: 'absolute', top: '50%', zIndex: 2, width: 40, height: 40, marginTop: -20, padding: 0, border: 0, borderRadius: '50%', background: 'rgba(255,255,255,.14)', color: '#fff', cursor: 'pointer', fontSize: 24, lineHeight: 1 },
  replyTarget: { marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.accent, fontSize: 12 },
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ArkmeClientError) {
    if (error.body.code === 'world-voiceprint-invite-rate-limited' || /\bHTTP\s*429\b/.test(error.body.message)) {
      return '提醒发送太频繁了，稍后再试。'
    }
    return error.body.message
  }
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

function dateTimeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function worldVoiceprintContent(item: Pick<ArkmeWorldFeedItem, 'headline' | 'textContent'>): string {
  return item.textContent.trim() !== '' ? item.textContent : item.headline
}

export function pendingWorldVoiceprintRecordRefs(
  items: readonly Pick<ArkmeWorldFeedItem, 'recordRef'>[],
  resolvedRefs: ReadonlySet<string>,
): string[] {
  const pending: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const recordRef = item.recordRef.trim()
    if (recordRef === '' || resolvedRefs.has(recordRef) || seen.has(recordRef)) continue
    seen.add(recordRef)
    pending.push(recordRef)
  }
  return pending
}

export function mergeWorldVoiceprintPlayableRefs(
  current: ReadonlySet<string>,
  availability: ArkmeWorldVoiceprintAvailability,
): Set<string> {
  const next = new Set(current)
  for (const item of availability.items) {
    if (item.playable) next.add(item.recordRef)
    else next.delete(item.recordRef)
  }
  return next
}

export function voiceprintInvitePromptTitle(item: Pick<ArkmeWorldFeedItem, 'headline' | 'textContent'>, variantIndex = 0): string {
  return resolveWorldVoiceprintExpectationCopy(worldVoiceprintContent(item), variantIndex).prompt
}

function uuid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function withTimeout<T>(promise: Promise<T>, millis: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)) }, millis)
  })
  try { return await Promise.race([promise, timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

function WorldImage({ imageRef, alt, avatar = false, preview = false }: { imageRef: string; alt: string; avatar?: boolean; preview?: boolean }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setSource('')
    setFailed(false)
    void callArkme<ArkmeImagePayload>('world.image.read', { imageRef }, controller.signal)
      .then(image => { setSource(`data:${image.mediaType};base64,${image.dataBase64}`) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort() }
  }, [imageRef])
  const imageStyle = avatar ? styles.avatarImage : preview ? styles.previewImage : styles.image
  if (preview && source === '') return <span style={imageStyle} aria-hidden data-world-image-preview-loading={failed ? 'failed' : 'true'} />
  if (failed) return <span style={imageStyle} aria-label={`${alt}加载失败`} />
  return <img src={source || undefined} alt={preview ? '' : alt} loading={avatar || preview ? 'eager' : 'lazy'} draggable={preview ? false : undefined} style={imageStyle} />
}

export function WorldImagePreviewMedia({ imageRef, alt, zoomed = false }: { imageRef: string; alt: string; zoomed?: boolean }) {
  return <div role="img" aria-label={alt} style={{ ...styles.previewMedia, ...(zoomed ? { width: '200%', height: '200%' } : {}) }}>
    <WorldImage key={imageRef} imageRef={imageRef} alt={alt} preview />
  </div>
}

const worldImagePreviewSingleClickDelayMillis = 280

export interface WorldImagePreviewDragOrigin {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

export function worldImagePreviewDragPosition(origin: WorldImagePreviewDragOrigin, clientX: number, clientY: number): { left: number; top: number } {
  return {
    left: origin.scrollLeft + origin.clientX - clientX,
    top: origin.scrollTop + origin.clientY - clientY,
  }
}

export function WorldImagePreviewDialog({ item, previewIndex, onClose, onSelect }: {
  item: ArkmeWorldFeedItem
  previewIndex: number
  onClose(): void
  onSelect(index: number): void
}) {
  const imageRef = item.imageRefs[previewIndex]
  const viewportRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragOriginRef = useRef<WorldImagePreviewDragOrigin | undefined>(undefined)
  const dragMovedRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const [zoomed, setZoomed] = useState(false)
  const [dragging, setDragging] = useState(false)

  const cancelScheduledClose = () => {
    if (closeTimerRef.current === undefined) return
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }

  useEffect(() => {
    cancelScheduledClose()
    setZoomed(false)
    setDragging(false)
    dragOriginRef.current = undefined
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    const viewport = viewportRef.current
    if (viewport !== null) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
    return cancelScheduledClose
  }, [previewIndex])

  if (imageRef === undefined) return null
  const multiple = item.imageRefs.length > 1

  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      cancelScheduledClose()
      return
    }
    if (event.detail > 1) {
      cancelScheduledClose()
      return
    }
    cancelScheduledClose()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = undefined
      onClose()
    }, worldImagePreviewSingleClickDelayMillis)
  }

  const handlePreviewDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    cancelScheduledClose()
    const viewport = viewportRef.current
    if (viewport === null) return
    if (zoomed) {
      setZoomed(false)
      setDragging(false)
      dragOriginRef.current = undefined
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = 0
        viewport.scrollTop = 0
      })
      return
    }
    const bounds = viewport.getBoundingClientRect()
    const localX = event.clientX - bounds.left
    const localY = event.clientY - bounds.top
    const horizontalRatio = localX / Math.max(1, viewport.clientWidth)
    const verticalRatio = localY / Math.max(1, viewport.clientHeight)
    setZoomed(true)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = horizontalRatio * viewport.scrollWidth - localX
      viewport.scrollTop = verticalRatio * viewport.scrollHeight - localY
    })
  }

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomed || event.button !== 0 || !event.isPrimary) return
    const viewport = viewportRef.current
    if (viewport === null) return
    cancelScheduledClose()
    dragOriginRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    viewport.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const movePreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    const viewport = viewportRef.current
    if (origin === undefined || origin.pointerId !== event.pointerId || viewport === null) return
    if (Math.abs(event.clientX - origin.clientX) > 2 || Math.abs(event.clientY - origin.clientY) > 2) dragMovedRef.current = true
    const position = worldImagePreviewDragPosition(origin, event.clientX, event.clientY)
    viewport.scrollLeft = position.left
    viewport.scrollTop = position.top
    event.preventDefault()
  }

  const endPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    if (origin === undefined || origin.pointerId !== event.pointerId) return
    dragOriginRef.current = undefined
    suppressNextClickRef.current = dragMovedRef.current
    dragMovedRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const selectImage = (index: number) => {
    cancelScheduledClose()
    setZoomed(false)
    setDragging(false)
    dragOriginRef.current = undefined
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    const viewport = viewportRef.current
    if (viewport !== null) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
    onSelect(index)
  }

  return <div role="dialog" aria-modal="true" aria-label="世界图片预览" style={styles.previewBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={styles.previewModal}>
      <button type="button" style={styles.previewClose} aria-label="关闭图片预览" title="关闭" onClick={onClose}>
        <X size={16} weight="bold" aria-hidden />
      </button>
      <div style={styles.previewStage}>
        <div
          ref={viewportRef}
          style={{ ...styles.previewViewport, overflow: zoomed ? 'auto' : 'hidden', cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'default', touchAction: zoomed ? 'none' : 'auto' }}
          data-world-image-preview-zoomed={String(zoomed)}
          onClick={handlePreviewClick}
          onDoubleClick={handlePreviewDoubleClick}
          onPointerDown={beginPreviewDrag}
          onPointerMove={movePreviewDrag}
          onPointerUp={endPreviewDrag}
          onPointerCancel={endPreviewDrag}
        >
          <WorldImagePreviewMedia imageRef={imageRef} alt={`${item.authorName}发布的图片 ${String(previewIndex + 1)}`} zoomed={zoomed} />
        </div>
        {multiple && <>
          <button type="button" style={{ ...styles.previewNav, left: 10, opacity: previewIndex === 0 ? 0.3 : 1 }} aria-label="上一张图片" disabled={previewIndex === 0} onClick={() => { selectImage(Math.max(0, previewIndex - 1)) }}>‹</button>
          <button type="button" style={{ ...styles.previewNav, right: 10, opacity: previewIndex === item.imageRefs.length - 1 ? 0.3 : 1 }} aria-label="下一张图片" disabled={previewIndex === item.imageRefs.length - 1} onClick={() => { selectImage(Math.min(item.imageRefs.length - 1, previewIndex + 1)) }}>›</button>
        </>}
      </div>
    </section>
  </div>
}

function interactionRegionId(recordRef: string): string {
  return `world-comments-${encodeURIComponent(recordRef)}`
}

export interface WorldInteractionReplyPresentation {
  item: ArkmeWorldInteractionItem
  replyToName: string
}

export interface WorldInteractionThread {
  root: ArkmeWorldInteractionItem
  replies: WorldInteractionReplyPresentation[]
}

/** Keep replies visually under the top-level comment while retaining their direct addressee. */
export function worldInteractionThreads(rootRef: string, items: readonly ArkmeWorldInteractionItem[]): WorldInteractionThread[] {
  const byRef = new Map(items.map(item => [item.interactionRef, item]))
  const sourceIndex = new Map(items.map((item, index) => [item.interactionRef, index]))
  const threads = new Map<string, WorldInteractionThread>()

  for (const item of items) {
    let root = item
    let cursor = item
    const visited = new Set<string>()
    while (cursor.parentRef !== rootRef) {
      if (visited.has(cursor.interactionRef)) {
        root = item
        break
      }
      visited.add(cursor.interactionRef)
      const parent = byRef.get(cursor.parentRef)
      if (parent === undefined) break
      root = parent
      cursor = parent
    }
    let thread = threads.get(root.interactionRef)
    if (thread === undefined) {
      thread = { root, replies: [] }
      threads.set(root.interactionRef, thread)
    }
    if (item.interactionRef !== root.interactionRef) {
      thread.replies.push({
        item,
        replyToName: byRef.get(item.parentRef)?.authorName ?? root.authorName,
      })
    }
  }

  return [...threads.values()].sort((left, right) =>
    (sourceIndex.get(left.root.interactionRef) ?? Number.MAX_SAFE_INTEGER)
      - (sourceIndex.get(right.root.interactionRef) ?? Number.MAX_SAFE_INTEGER))
}

function InteractionAvatar({ item, reply, compact }: { item: ArkmeWorldInteractionItem; reply: boolean; compact: boolean }) {
  const size = compact ? (reply ? 20 : 24) : (reply ? 22 : 28)
  return <span style={{
    ...styles.interactionAvatar,
    ...(reply ? styles.interactionReplyAvatar : {}),
    width: size,
    height: size,
    fontSize: reply ? (compact ? 8 : 9) : (compact ? 9 : 11),
  }}>
    {item.avatarRef === undefined
      ? item.avatarFallback?.label ?? item.authorName.slice(0, 1)
      : <WorldImage imageRef={item.avatarRef} alt={`${item.authorName}的头像`} avatar />}
  </span>
}

function InteractionRow({ item, replyToName, compact, replyTargetRef, onReply }: {
  item: ArkmeWorldInteractionItem
  replyToName?: string
  compact: boolean
  replyTargetRef?: string
  onReply?(item: ArkmeWorldInteractionItem): void
}) {
  const reply = replyToName !== undefined
  const active = replyTargetRef === item.interactionRef
  if (compact) {
    return <span data-world-comment-level={reply ? 'reply' : 'root'} style={{ ...styles.compactCommentRow, ...(reply ? styles.compactCommentReply : {}) }}>
      <strong style={styles.compactCommentAuthor}>{item.authorName}</strong>
      {replyToName !== undefined && <><span> 回复 </span><strong style={styles.compactCommentAuthor}>{replyToName}</strong></>}
      <span>{`：${arkmeEmojiPlainText(item.textContent)}`}</span>
    </span>
  }
  return <div data-world-comment-level={reply ? 'reply' : 'root'} style={{
    ...(reply ? styles.interactionReply : styles.interactionRoot),
  }}>
    <InteractionAvatar item={item} reply={reply} compact={compact} />
    <div style={styles.interactionBody}>
      <header style={styles.interactionMeta}>
        <span style={styles.interactionAuthorLine}>
          <strong style={{ ...styles.interactionAuthor, ...(reply ? styles.interactionReplyAuthor : {}) }}>{item.authorName}</strong>
          {replyToName !== undefined && <span style={styles.interactionReplyTarget}>{`回复 ${replyToName}`}</span>}
        </span>
        <time>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>
      </header>
      <div style={styles.interactionContentRow}>
        <p style={{ ...styles.interactionText, ...(reply ? styles.interactionReplyText : {}) }}>{arkmeEmojiPlainText(item.textContent)}</p>
        {onReply !== undefined && <button type="button" style={styles.interactionAction} aria-label={`回复${item.authorName}的评论`} onClick={() => { onReply(item) }}>{active ? '取消回复' : '回复'}</button>}
      </div>
    </div>
  </div>
}

export function WorldInteractionThreadList({ rootRef, items, maxVisibleItems, compact = false, replyTargetRef, onReply }: {
  rootRef: string
  items: readonly ArkmeWorldInteractionItem[]
  maxVisibleItems?: number
  compact?: boolean
  replyTargetRef?: string
  onReply?(item: ArkmeWorldInteractionItem): void
}) {
  const limit = maxVisibleItems === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(maxVisibleItems))
  let remaining = limit
  const visible: WorldInteractionThread[] = []
  for (const thread of worldInteractionThreads(rootRef, items)) {
    if (remaining <= 0) break
    const replies = thread.replies.slice(0, Math.max(0, remaining - 1))
    visible.push({ root: thread.root, replies })
    remaining -= 1 + replies.length
  }
  return <div style={styles.interactionList} data-world-comment-preview={compact || undefined}>
    {visible.map(thread => <section key={thread.root.interactionRef} style={{ ...styles.interactionThread, ...(compact ? { padding: 0, borderBottom: 0 } : {}) }}>
      <InteractionRow item={thread.root} compact={compact} {...(replyTargetRef === undefined ? {} : { replyTargetRef })} {...(onReply === undefined ? {} : { onReply })} />
      {thread.replies.length > 0 && <div style={{ ...styles.interactionReplyList, ...(compact ? { margin: 0, paddingLeft: 0, borderLeft: 0 } : {}) }}>
        {thread.replies.map(reply => <InteractionRow key={reply.item.interactionRef} item={reply.item} replyToName={reply.replyToName} compact={compact} {...(replyTargetRef === undefined ? {} : { replyTargetRef })} {...(onReply === undefined ? {} : { onReply })} />)}
      </div>}
    </section>)}
  </div>
}

export function worldInteractionCountLabel(count: number, hasMore = false): string {
  const normalized = Math.max(0, Math.trunc(count))
  if (normalized === 0) return '评论'
  return `评论 ${String(normalized)}${hasMore ? '+' : ''}`
}

export function WorldInteractionPreviewContent({ item, items, onOpen }: { item: ArkmeWorldFeedItem; items: readonly ArkmeWorldInteractionItem[]; onOpen(): void }) {
  return <section style={styles.commentPreview} aria-label={`${item.authorName}的精选评论`}>
    <WorldInteractionThreadList rootRef={item.recordRef} items={items} maxVisibleItems={3} compact />
    <button type="button" style={styles.commentPreviewHitTarget} aria-label={`打开${item.authorName}的评论面板，共 ${String(item.extendCount)} 条评论`} title="打开全部评论" onClick={onOpen} />
  </section>
}

function WorldInteractionPreview({ item, onOpen, onCountResolved }: { item: ArkmeWorldFeedItem; onOpen(): void; onCountResolved(count: number, hasMore: boolean): void }) {
  const [items, setItems] = useState<ArkmeWorldInteractionItem[]>([])
  useEffect(() => {
    if (item.extendCount <= 0) {
      setItems([])
      return
    }
    const controller = new AbortController()
    void callArkme<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: item.recordRef, limit: 50, offset: 0 }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        setItems(page.items)
        onCountResolved(page.items.length, page.hasMore)
      })
      .catch(() => { if (!controller.signal.aborted) setItems([]) })
    return () => { controller.abort() }
  }, [item.extendCount, item.recordRef, onCountResolved])
  if (items.length === 0) return null
  return <WorldInteractionPreviewContent item={item} items={items} onOpen={onOpen} />
}

function WorldCard({ item, playable, voiceprintActive, interactionsOpen, onOpenInteractions, onInteractionCreated, onToggleVoiceprint, onInviteVoiceprint }: {
  item: ArkmeWorldFeedItem
  playable: boolean
  voiceprintActive: boolean
  interactionsOpen: boolean
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onInteractionCreated(recordRef: string): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint(item: ArkmeWorldFeedItem): void
}) {
  const [previewIndex, setPreviewIndex] = useState<number>()
  const [interactionCount, setInteractionCount] = useState<{ count: number; hasMore: boolean }>()
  const resolveInteractionCount = useCallback((count: number, hasMore: boolean) => {
    setInteractionCount({ count, hasMore })
  }, [])
  const interactionsId = interactionRegionId(item.recordRef)
  const interactionLabel = interactionCount === undefined
    ? `${String(Math.max(0, item.extendCount))} 条评论`
    : `${String(interactionCount.count)}${interactionCount.hasMore ? '+' : ''} 条评论`
  useEffect(() => {
    if (previewIndex === undefined) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewIndex(undefined) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [previewIndex])
  return <article style={styles.card} data-world-record-ref={item.recordRef}>
    <header style={styles.cardHeader}>
      <span style={styles.avatar}>{item.avatarRef === undefined
        ? item.avatarFallback?.label ?? item.authorName.slice(0, 1)
        : <WorldImage imageRef={item.avatarRef} alt={`${item.authorName}的头像`} avatar />}</span>
      <span style={styles.authorMeta}>
        <span style={styles.authorRow}>
          <strong style={styles.author}>{item.authorName}</strong>
          {playable
            ? <button type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintPlayable, ...(voiceprintActive ? styles.voiceprintActive : {}) }} title={voiceprintActive ? '停止播放声纹' : '播放声纹'} aria-label={voiceprintActive ? `停止播放${item.authorName}的声纹` : `播放${item.authorName}的声纹`} onClick={() => { onToggleVoiceprint(item.recordRef) }}>
              <SpeakerHigh size={16} weight="light" />
            </button>
            : <button type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintInvite }} title="邀请开启声纹" aria-label={`邀请${item.authorName}开启声纹`} onClick={() => { onInviteVoiceprint(item) }}>
              <Plus size={13} weight="bold" />
            </button>}
        </span>
      </span>
      <time style={styles.time}>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>
    </header>
    {item.headline !== '' && <h2 style={styles.headline}>{arkmeEmojiPlainText(item.headline)}</h2>}
    {item.textContent.trim() !== '' && <p style={styles.text}>{arkmeEmojiPlainText(item.textContent)}</p>}
    {item.imageRefs.length > 0 && <div style={styles.imageGrid}>{item.imageRefs.slice(0, 3).map((imageRef, index) =>
      <button key={imageRef} type="button" style={styles.imageButton} aria-label={`预览${item.authorName}发布的图片 ${String(index + 1)}`} onClick={() => { setPreviewIndex(index) }}>
        <WorldImage imageRef={imageRef} alt={`${item.authorName}发布的图片 ${String(index + 1)}`} />
      </button>)}</div>}
    <footer style={styles.cardFooter}>
      <button type="button" style={{ ...styles.commentButton, ...(interactionsOpen ? styles.commentButtonActive : {}) }} aria-expanded={interactionsOpen} aria-controls={interactionsId} onClick={() => { onOpenInteractions(item) }}>
        <ChatCircleDots size={16} weight="light" aria-hidden />{interactionLabel}
      </button>
    </footer>
    {!interactionsOpen && item.extendCount > 0 && <WorldInteractionPreview item={item} onOpen={() => { onOpenInteractions(item) }} onCountResolved={resolveInteractionCount} />}
    {interactionsOpen && <InteractionPanel item={item} onClose={() => { onOpenInteractions(item) }} onInteractionCreated={onInteractionCreated} onCountResolved={resolveInteractionCount} />}
    {previewIndex !== undefined && <WorldImagePreviewDialog item={item} previewIndex={previewIndex} onClose={() => { setPreviewIndex(undefined) }} onSelect={setPreviewIndex} />}
  </article>
}

export function VoiceprintInviteDialog({ item, variantIndex, socialContext, sending, message, onClose, onConfirm }: {
  item: ArkmeWorldFeedItem
  variantIndex: number
  socialContext?: ArkmeWorldVoiceprintSocialContext
  sending: boolean
  message?: string
  onClose(): void
  onConfirm(item: ArkmeWorldFeedItem): void
}) {
  const author = item.authorName.trim() === '' ? 'TA' : `「${item.authorName.trim()}」`
  const relations = socialContext?.relations ?? []
  const relationship = relations.length === 0 ? undefined : relations[Math.max(0, variantIndex) % relations.length]
  return <div role="dialog" aria-modal="true" aria-label="邀请开启声纹" style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={{ ...styles.modal, ...styles.inviteModal }}>
      <div style={styles.inviteContent}>
        <h2 style={styles.inviteTitle}>{voiceprintInvitePromptTitle(item, variantIndex)}</h2>
        {relationship !== undefined && <p style={styles.inviteRelationship}>{relationship.displayLine}</p>}
        <p style={{ ...styles.inviteAction, ...(relationship === undefined ? {} : { marginTop: 7 }) }}>提醒{author}录入声纹后就能听见这条文字</p>
        {message !== undefined && <p role="status" style={styles.inviteStatus}>{message}</p>}
      </div>
      <div style={styles.inviteActions}>
        <button type="button" style={styles.inviteActionButton} disabled={sending} onClick={onClose}>再想想</button>
        <button type="button" style={{ ...styles.inviteActionButton, ...styles.inviteConfirmButton }} disabled={sending} onClick={() => { onConfirm(item) }}>{sending ? '发送中…' : '让TA知道'}</button>
      </div>
    </section>
  </div>
}

function WorldLoadMoreSpinner() {
  return <svg viewBox="0 0 24 24" fill="none" style={styles.feedLoadMoreSpinner} aria-hidden data-world-load-more-spinner="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".2" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
    </path>
  </svg>
}

export function WorldInfiniteScrollTrigger({ scrollRootRef, loading, error, onLoadMore }: {
  scrollRootRef: { readonly current: HTMLElement | null }
  loading: boolean
  error: boolean
  onLoadMore(): void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loading)
  const requestedForVisitRef = useRef(false)
  const onLoadMoreRef = useRef(onLoadMore)
  loadingRef.current = loading
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting)
      if (!visible) {
        requestedForVisitRef.current = false
        return
      }
      if (loadingRef.current || requestedForVisitRef.current) return
      requestedForVisitRef.current = true
      onLoadMoreRef.current()
    }, { root: scrollRootRef.current, rootMargin: '0px 0px 180px 0px', threshold: 0.01 })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [scrollRootRef])

  const retry = () => {
    if (loadingRef.current) return
    requestedForVisitRef.current = true
    onLoadMoreRef.current()
  }

  return <div ref={sentinelRef} style={styles.feedLoadMore} data-world-load-more-sentinel="true" aria-hidden={!loading && !error}>
    {loading && <span role="status" aria-label="正在加载更多世界动态" style={styles.feedLoadMoreStatus}><WorldLoadMoreSpinner /></span>}
    {!loading && error && <button type="button" style={styles.feedLoadMoreRetry} onClick={retry}>重试</button>}
  </div>
}

export function ArkmeWorldContent({ state, scope, target, voiceprintPlayableRefs, voiceprintRecordRef, interactionRecordRef, actionMessage, onRefresh, onBackToWorld, onSelectScope, onOpenComposer, onOpenInteractions, onInteractionCreated, onToggleVoiceprint, onInviteVoiceprint, onLoadMore }: {
  state: ArkmeWorldViewState
  scope: WorldScope
  target?: ArkmeWorldTarget
  voiceprintPlayableRefs: ReadonlySet<string>
  voiceprintRecordRef: string | undefined
  interactionRecordRef?: string
  actionMessage?: string
  onRefresh(): void
  onBackToWorld?(): void
  onSelectScope(scope: WorldScope): void
  onOpenComposer(): void
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onInteractionCreated?(recordRef: string): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint?(item: ArkmeWorldFeedItem): void
  onLoadMore?(): void
}) {
  const interactionItem = interactionRecordRef === undefined
    ? undefined
    : state.items.find(item => item.recordRef === interactionRecordRef)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  return <>
    <header style={styles.header}>
      {target === undefined
        ? <div><h1 style={styles.heading}>世界</h1><p style={styles.subtitle}>看看大家此刻正在记录什么</p></div>
        : <div style={styles.targetHeading}>
          <button type="button" style={styles.backButton} aria-label="返回世界" onClick={onBackToWorld}><ArrowLeft size={18} weight="bold" /></button>
          <ArkmeUserAvatar
            {...(target.avatarRef === undefined ? {} : { avatarRef: target.avatarRef })}
            {...(target.avatarFallback === undefined ? {} : { fallback: target.avatarFallback })}
            size={40}
            label={`${target.displayName}的头像`}
          />
          <div style={styles.targetTitle}><h1 style={styles.heading}>{target.displayName}的世界</h1><p style={styles.subtitle}>TA 公开分享的内容</p></div>
        </div>}
      <div style={styles.headerActions}>
        <button type="button" style={styles.iconButton} disabled={state.refreshing} title={state.refreshing ? '刷新中' : '刷新'} aria-label={state.refreshing ? '刷新中' : '刷新'} onClick={onRefresh}>
          <ArrowClockwise size={18} weight="light" />
        </button>
        {target === undefined && <button type="button" style={{ ...styles.button, ...styles.primaryButton }} aria-label="发世界" onClick={onOpenComposer}><Plus size={14} weight="regular" aria-hidden />发布</button>}
      </div>
    </header>
    {target === undefined && <div style={styles.worldToolbar}>
      <nav style={styles.tabs} aria-label="世界范围">
        <button type="button" style={{ ...styles.tab, ...(scope === 'all' ? styles.tabActive : {}) }} aria-current={scope === 'all' ? 'page' : undefined} onClick={() => { onSelectScope('all') }}>世界</button>
        <button type="button" style={{ ...styles.tab, ...(scope === 'mine' ? styles.tabActive : {}) }} aria-current={scope === 'mine' ? 'page' : undefined} onClick={() => { onSelectScope('mine') }}>我的世界</button>
      </nav>
    </div>}
    <div style={styles.worldLayout} data-world-layout={interactionItem === undefined ? 'feed' : 'comments-open'}>
      <div ref={scrollRootRef} style={styles.body} data-world-feed-pane="true" data-world-scroll-container="true">
        {actionMessage !== undefined && <div role="status" style={{ ...styles.notice, ...(actionMessage.startsWith('已') ? {} : styles.error) }}>{actionMessage}</div>}
        {state.status === 'loading' && <div role="status" style={styles.notice}>{target === undefined ? '正在加载世界…' : `正在加载 ${target.displayName} 的世界…`}</div>}
        {state.status === 'error' && <div role="alert" style={{ ...styles.notice, ...styles.error, ...styles.errorRow }}><span>{state.message}</span><button type="button" style={styles.button} onClick={onRefresh}>重试</button></div>}
        {state.status === 'empty' && <div style={styles.notice}>{target === undefined ? '这里还没有世界动态。你可以先发一条，或者稍后再刷新。' : 'TA 的世界暂无公开内容。'}</div>}
        {state.status === 'success' && <div style={styles.feed}>
          {state.message !== undefined && <div role="status" style={{ ...styles.notice, ...styles.error, width: '100%', margin: 0 }}>{state.message}</div>}
          {state.items.map(item => <WorldCard
            key={item.recordRef}
            item={item}
            playable={voiceprintPlayableRefs.has(item.recordRef)}
            voiceprintActive={voiceprintRecordRef === item.recordRef}
            interactionsOpen={interactionRecordRef === item.recordRef}
            onOpenInteractions={onOpenInteractions}
            onInteractionCreated={onInteractionCreated ?? (() => {})}
            onToggleVoiceprint={onToggleVoiceprint}
            onInviteVoiceprint={onInviteVoiceprint ?? (() => {})}
          />)}
          {state.hasMore && onLoadMore !== undefined && <WorldInfiniteScrollTrigger
            key={`${String(state.nextOffset ?? 'more')}:${String(state.items.length)}`}
            scrollRootRef={scrollRootRef}
            loading={state.loadingMore === true}
            error={state.message !== undefined}
            onLoadMore={onLoadMore}
          />}
        </div>}
      </div>
    </div>
  </>
}

function PublishDialog({ onClose, onPublished }: { onClose(): void; onPublished(result: ArkmeWorldPublishResult): void }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const sendingRef = useRef(false)
  const mutationIdRef = useRef(uuid())
  const uploadedAssetsRef = useRef<{ mutationId: string; assets: ArkmeUploadedAsset[] }>()
  const resetMutationId = () => {
    mutationIdRef.current = uuid()
    uploadedAssetsRef.current = undefined
  }
  const submit = async () => {
    if (sendingRef.current) return
    const textContent = text.trim()
    if (textContent === '') { setMessage(files.length > 0 ? '图片动态也需要写一点文字' : '请输入要发到世界的内容'); return }
    if (files.some(file => !file.type.startsWith('image/'))) { setMessage('只能上传图片'); return }
    if (files.some(file => file.size > ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES)) { setMessage('单张图片不能超过 20MB'); return }
    const controller = new AbortController()
    sendingRef.current = true
    setSending(true)
    setMessage(files.length > 0 ? '正在上传图片…' : '正在发布…')
    try {
      const cachedUploads = uploadedAssetsRef.current
      let assets: ArkmeUploadedAsset[] = []
      if (files.length > 0) {
        if (cachedUploads?.mutationId === mutationIdRef.current) assets = cachedUploads.assets
        else {
          assets = await withTimeout(Promise.all(files.map(async file => await worldSdk.upload(file, {
            fileName: file.name || 'world-image', signal: controller.signal,
          }))), 60_000, '图片上传等待太久，请检查网络后重试', () => { controller.abort() })
          uploadedAssetsRef.current = { mutationId: mutationIdRef.current, assets }
        }
      }
      setMessage('正在发布…')
      const result = await withTimeout<ArkmeWorldPublishResult>(files.length > 0
        ? worldSdk.publishWorldFileAssets({
            clientMutationId: mutationIdRef.current,
            textContent,
            fileAssets: assets.map(asset => ({
              fileAssetUid: asset.fileAssetUid,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              size: asset.size,
              fileKind: 1,
            })),
          }, controller.signal)
        : worldSdk.publishWorldText({
            clientMutationId: mutationIdRef.current,
            textContent,
          }, controller.signal),
      90_000, '发布等待太久，请刷新世界后确认是否已发布', () => { controller.abort() })
      if (!result.worldPublished) {
        throw new Error(result.error ?? (result.recordSaved ? '内容已保存，但发到世界失败，请重试' : '发布失败，请稍后重试'))
      }
      resetMutationId()
      onPublished(result)
      onClose()
    } catch (error) { setMessage(messageOf(error, '发布失败，请稍后重试')) }
    finally { controller.abort(); sendingRef.current = false; setSending(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="发世界" style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={styles.modal}>
      <h2 style={styles.modalTitle}>发世界</h2>
      <p style={styles.modalText}>发布后会作为公开动态展示。发布失败时原因会保留在这里，草稿不会被清空。</p>
      <textarea style={styles.textarea} value={text} disabled={sending} maxLength={2000} autoFocus placeholder="分享此刻的想法…" onChange={event => { setText(event.currentTarget.value); resetMutationId(); setMessage('') }} />
      <label style={styles.fieldLabel}>图片（最多 9 张）<input style={styles.fileInput} type="file" accept="image/*" multiple disabled={sending} onChange={event => { setFiles(Array.from(event.currentTarget.files ?? []).slice(0, ARKME_WORLD_PUBLISH_MAX_IMAGES)); resetMutationId(); setMessage('') }} /></label>
      <div style={styles.modalActions}>
        <span role="status" style={message.includes('正在') ? styles.subtitle : styles.modalError}>{message}</span>
        <span style={styles.headerActions}><button type="button" style={styles.button} disabled={sending} onClick={onClose}>取消</button><button type="button" style={{ ...styles.button, ...styles.primaryButton }} disabled={sending} onClick={() => { void submit() }}>{sending ? '发布中…' : '发布'}</button></span>
      </div>
    </section>
  </div>
}

function InteractionPanel({ item, onClose, onInteractionCreated, onCountResolved }: { item: ArkmeWorldFeedItem; onClose(): void; onInteractionCreated(recordRef: string): void; onCountResolved(count: number, hasMore: boolean): void }) {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; items: ArkmeWorldInteractionItem[]; message?: string; hasMore: boolean; nextOffset?: number; loadingMore?: boolean }>({ status: 'loading', items: [], hasMore: false })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [replyTarget, setReplyTarget] = useState<ArkmeWorldInteractionItem>()
  const loadController = useRef<AbortController>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendDisabled = sending || draft.trim() === ''
  const load = useCallback(() => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setState({ status: 'loading', items: [], hasMore: false })
    void callArkme<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: item.recordRef, limit: 50, offset: 0 }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', items: page.items, hasMore: page.hasMore, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) })
        onCountResolved(page.items.length, page.hasMore)
      })
      .catch(error => { if (!controller.signal.aborted) setState({ status: 'error', items: [], hasMore: false, message: messageOf(error, '评论暂时无法加载') }) })
  }, [item.recordRef, onCountResolved])
  useEffect(() => {
    load()
    textareaRef.current?.focus()
    return () => { loadController.current?.abort() }
  }, [load])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])
  const loadMore = async () => {
    if (state.loadingMore || state.nextOffset === undefined) return
    setState(current => {
      const { message: _message, ...rest } = current
      return { ...rest, loadingMore: true }
    })
    try {
      const page = await callArkme<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: item.recordRef, limit: 50, offset: state.nextOffset })
      setState(current => ({ ...current, status: 'ready', items: [...current.items, ...page.items], hasMore: page.hasMore, loadingMore: false, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) }))
      onCountResolved(state.items.length + page.items.length, page.hasMore)
    } catch (error) { setState(current => ({ ...current, loadingMore: false, message: messageOf(error, '更多互动加载失败，请重试') })) }
  }
  const send = async () => {
    const textContent = draft.trim()
    if (textContent === '' || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const result = await callArkme<ArkmeWorldInteractionCreateResult>('world.interactions.create-text', { targetRef: replyTarget?.interactionRef ?? item.recordRef, textContent, clientMutationId: uuid() })
      setState(current => {
        const { message: _message, ...rest } = current
        return { ...rest, status: 'ready', items: [...current.items, result.interaction] }
      })
      setDraft('')
      if (textareaRef.current !== null) textareaRef.current.style.height = '40px'
      setReplyTarget(undefined)
      onCountResolved(state.items.length + 1, state.hasMore)
      onInteractionCreated(item.recordRef)
    } catch (error) { setState(current => ({ ...current, message: messageOf(error, '评论发送失败，请重试') })) }
    finally { sendingRef.current = false; setSending(false) }
  }
  return <section id={interactionRegionId(item.recordRef)} aria-label={`${item.authorName}的评论区`} style={styles.interactionPanel} data-world-comment-panel="inline">
    <div style={styles.interactionPanelSticky} data-world-comment-toolbar="sticky">
      <header style={styles.interactionPanelHeader}>
        <strong style={styles.interactionPanelTitle}>{worldInteractionCountLabel(state.items.length, state.hasMore)}</strong>
        <button type="button" style={styles.interactionPanelClose} aria-label="收起评论" onClick={onClose}>收起</button>
      </header>
      <div style={styles.interactionComposer}>
        {replyTarget !== undefined && <div style={styles.replyTarget}><span>回复 {replyTarget.authorName}</span><button type="button" style={styles.linkButton} onClick={() => { setReplyTarget(undefined); textareaRef.current?.focus() }}>取消回复</button></div>}
        <div style={styles.interactionComposerRow}>
          <textarea ref={textareaRef} rows={1} style={styles.interactionInput} value={draft} disabled={sending} maxLength={20_000} placeholder={replyTarget === undefined ? '写一条评论…' : `回复 ${replyTarget.authorName}…`} onChange={event => {
            setDraft(event.currentTarget.value)
            event.currentTarget.style.height = '40px'
            event.currentTarget.style.height = `${String(Math.min(96, event.currentTarget.scrollHeight))}px`
          }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send() } }} />
          <button type="button" style={{ ...styles.interactionSend, ...(sendDisabled ? { opacity: 0.38, cursor: 'default' } : {}) }} title="Ctrl / ⌘ + Enter 发送" disabled={sendDisabled} onClick={() => { void send() }}>{sending ? '发送中…' : '发送'}</button>
        </div>
      </div>
    </div>
    <div style={styles.interactionPanelBody}>
      {state.status === 'loading' && <p role="status" style={styles.subtitle}>评论加载中…</p>}
      {state.message !== undefined && <div role="alert" style={{ ...styles.notice, ...styles.error, width: '100%', margin: '12px 0 0' }}>{state.message}{state.status === 'error' && <button type="button" style={{ ...styles.button, marginLeft: 12 }} onClick={load}>重试</button>}</div>}
      <WorldInteractionThreadList
        rootRef={item.recordRef}
        items={state.items}
        {...(replyTarget === undefined ? {} : { replyTargetRef: replyTarget.interactionRef })}
        onReply={interaction => {
          setReplyTarget(current => current?.interactionRef === interaction.interactionRef ? undefined : interaction)
          textareaRef.current?.focus()
        }}
      />
      {state.hasMore && <div style={styles.loadMore}><button type="button" style={styles.button} disabled={state.loadingMore} onClick={() => { void loadMore() }}>{state.loadingMore ? '加载中…' : '加载更多评论'}</button></div>}
      {state.status === 'ready' && state.items.length === 0 && <div style={styles.interactionEmpty}>还没有评论</div>}
    </div>
  </section>
}

const loadingState = (): ArkmeWorldViewState => ({ status: 'loading', items: [] })

/** First-party World page owned by the same product surface as recordings. */
export function ArkmeWorldSurface({ target, onBackToWorld }: { target?: ArkmeWorldTarget; onBackToWorld?(): void } = {}) {
  const [scope, setScope] = useState<WorldScope>('all')
  const [views, setViews] = useState<Record<WorldScope, ArkmeWorldViewState>>({ all: loadingState(), mine: loadingState() })
  const [loaded, setLoaded] = useState<Record<WorldScope, boolean>>({ all: false, mine: false })
  const [composerOpen, setComposerOpen] = useState(false)
  const [interactionRecordRef, setInteractionRecordRef] = useState<string>()
  const [inviteItem, setInviteItem] = useState<ArkmeWorldFeedItem>()
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string>()
  const [inviteSocialContext, setInviteSocialContext] = useState<ArkmeWorldVoiceprintSocialContext>()
  const invitePresentationIndexesRef = useRef(new Map<string, number>())
  const inviteLoadTokenRef = useRef(0)
  const [playableRefs, setPlayableRefs] = useState<Set<string>>(() => new Set())
  const resolvedVoiceprintRefsRef = useRef(new Set<string>())
  const [voiceprintAvailabilityRevision, setVoiceprintAvailabilityRevision] = useState(0)
  const [voiceprintRecordRef, setVoiceprintRecordRef] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [targetView, setTargetView] = useState<ArkmeWorldViewState>(() => loadingState())
  const loadController = useRef<AbortController>()
  const audioRef = useRef<HTMLAudioElement>()
  const voiceprintTokenRef = useRef(0)
  const state = target === undefined ? views[scope] : targetView

  const load = useCallback((target: WorldScope, offset = 0, preserveItems = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setViews(current => ({
      ...current,
      [target]: offset === 0
        ? preserveItems && current[target].items.length > 0
          ? { ...current[target], refreshing: true, message: undefined }
          : loadingState()
        : { ...current[target], loadingMore: true, message: undefined },
    }))
    const operation = target === 'mine' ? 'world.mine' : 'world.feed'
    void callArkme<ArkmeWorldFeedPage>(operation, { limit: 20, offset }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const items = offset === 0 ? page.items : [...current[target].items, ...page.items]
        return { ...current, [target]: { status: items.length === 0 ? 'empty' : 'success', items, hasMore: page.hasMore, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) } }
      })
    }).catch(error => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const previous = current[target]
        const message = messageOf(error, target === 'mine' ? '我的世界暂时无法加载' : '世界暂时无法加载')
        return {
          ...current,
          [target]: previous.items.length > 0
            ? { ...previous, status: 'success', refreshing: false, loadingMore: false, message }
            : { status: 'error', items: [], message },
        }
      })
    })
  }, [])

  const loadUser = useCallback((profile: ArkmeWorldTarget, offset = 0, preserveItems = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setTargetView(current => {
      const { message: _message, ...rest } = current
      return offset === 0
        ? preserveItems && current.items.length > 0
          ? { ...rest, refreshing: true }
          : loadingState()
        : { ...rest, loadingMore: true }
    })
    void callArkme<ArkmeWorldFeedPage>('world.user', { userId: profile.userId, limit: 20, offset }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        setTargetView(current => {
          const items = offset === 0 ? page.items : [...current.items, ...page.items]
          return { status: items.length === 0 ? 'empty' : 'success', items, hasMore: page.hasMore, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) }
        })
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setTargetView(current => {
          const message = messageOf(error, `${profile.displayName}的世界暂时无法加载`)
          return current.items.length > 0
            ? { ...current, status: 'success', refreshing: false, loadingMore: false, message }
            : { status: 'error', items: [], message }
        })
      })
  }, [])

  useEffect(() => { if (target === undefined && !loaded[scope]) load(scope) }, [load, loaded, scope, target])
  useEffect(() => {
    if (target === undefined) return
    setInteractionRecordRef(undefined)
    setActionMessage(undefined)
    loadUser(target)
  }, [loadUser, target?.userId])
  useEffect(() => () => { loadController.current?.abort(); voiceprintTokenRef.current += 1; inviteLoadTokenRef.current += 1; audioRef.current?.pause() }, [])
  useEffect(() => {
    if (state.status !== 'success' || state.items.length === 0) return
    const pendingRefs = pendingWorldVoiceprintRecordRefs(state.items, resolvedVoiceprintRefsRef.current)
    if (pendingRefs.length === 0) return
    const controller = new AbortController()
    void (async () => {
      for (let offset = 0; offset < pendingRefs.length; offset += 20) {
        const result = await callArkme<ArkmeWorldVoiceprintAvailability>(
          'world.voiceprint.availability',
          { recordRefs: pendingRefs.slice(offset, offset + 20) },
          controller.signal,
        )
        if (controller.signal.aborted) return
        for (const item of result.items) resolvedVoiceprintRefsRef.current.add(item.recordRef)
        setPlayableRefs(current => mergeWorldVoiceprintPlayableRefs(current, result))
      }
    })().catch(() => {})
    return () => { controller.abort() }
  }, [state.items, state.status, voiceprintAvailabilityRevision])

  const refresh = () => {
    setActionMessage(undefined)
    for (const item of state.items) resolvedVoiceprintRefsRef.current.delete(item.recordRef)
    setVoiceprintAvailabilityRevision(current => current + 1)
    if (target === undefined) load(scope, 0, true)
    else loadUser(target, 0, true)
  }
  const selectScope = (next: WorldScope) => { setActionMessage(undefined); setInteractionRecordRef(undefined); setScope(next) }
  const toggleInteractions = (item: ArkmeWorldFeedItem) => {
    setInteractionRecordRef(current => current === item.recordRef ? undefined : item.recordRef)
  }
  const recordInteractionCreated = (recordRef: string) => {
    const update = (view: ArkmeWorldViewState): ArkmeWorldViewState => ({
      ...view,
      items: view.items.map(item => item.recordRef === recordRef ? { ...item, extendCount: item.extendCount + 1 } : item),
    })
    setViews(current => ({ all: update(current.all), mine: update(current.mine) }))
    setTargetView(update)
  }
  const toggleVoiceprint = async (recordRef: string) => {
    if (voiceprintRecordRef === recordRef) { voiceprintTokenRef.current += 1; audioRef.current?.pause(); audioRef.current = undefined; setVoiceprintRecordRef(undefined); return }
    const token = voiceprintTokenRef.current + 1
    voiceprintTokenRef.current = token
    audioRef.current?.pause()
    setActionMessage(undefined)
    setVoiceprintRecordRef(recordRef)
    const playChunk = async (chunkIndex: number): Promise<void> => {
      const chunk = await callArkme<ArkmeWorldVoiceprintPlaybackChunk>('world.voiceprint.playback.generate', { recordRef, chunkIndex })
      if (voiceprintTokenRef.current !== token) return
      if (typeof Audio === 'undefined') throw new Error('当前环境无法播放声音')
      const audio = new Audio(`/arkme-self/api/media?ref=${encodeURIComponent(chunk.mediaRef)}`)
      audioRef.current = audio
      audio.onended = () => {
        if (voiceprintTokenRef.current !== token) return
        if (chunk.chunkIndex + 1 < chunk.chunkCount) void playChunk(chunk.chunkIndex + 1).catch(fail)
        else { setVoiceprintRecordRef(undefined); audioRef.current = undefined }
      }
      audio.onerror = () => { fail(new Error('声纹音频播放失败，请重试')) }
      await audio.play()
    }
    const fail = (error: unknown) => {
      if (voiceprintTokenRef.current !== token) return
      voiceprintTokenRef.current += 1
      setActionMessage(messageOf(error, '声纹生成失败，请重试'))
      setVoiceprintRecordRef(undefined)
      audioRef.current = undefined
    }
    await playChunk(0).catch(fail)
  }
  const openVoiceprintInvite = async (item: ArkmeWorldFeedItem) => {
    const token = inviteLoadTokenRef.current + 1
    inviteLoadTokenRef.current = token
    setActionMessage(undefined)
    setInviteMessage(undefined)
    setInviteSocialContext(undefined)
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, 6_000)
    let socialContext: ArkmeWorldVoiceprintSocialContext = { relations: [] }
    try {
      socialContext = await callArkme<ArkmeWorldVoiceprintSocialContext>(
        'world.voiceprint.social-context', { recordRef: item.recordRef, forceRefresh: true }, controller.signal,
      )
    } catch { /* Relationship context is optional; the reminder still opens without invented evidence. */ }
    finally { clearTimeout(timeout) }
    if (inviteLoadTokenRef.current !== token) return
    setInviteSocialContext(socialContext)
    setInviteItem(item)
  }
  const closeVoiceprintInvite = () => {
    if (inviteSending || inviteItem === undefined) return
    const currentIndex = invitePresentationIndexesRef.current.get(inviteItem.recordRef) ?? 0
    invitePresentationIndexesRef.current.set(inviteItem.recordRef, currentIndex + 1)
    setInviteItem(undefined)
    setInviteSocialContext(undefined)
  }
  const inviteVoiceprint = async (item: ArkmeWorldFeedItem) => {
    if (inviteSending) return
    setInviteSending(true)
    setInviteMessage(undefined)
    try {
      const result = await callArkme<ArkmeWorldVoiceprintInviteResult>('world.voiceprint.invite', { recordRef: item.recordRef })
      setInviteItem(undefined)
      setActionMessage(`已提醒 ${result.peerDisplayName || item.authorName} 开启声纹`)
    } catch (error) { setInviteMessage(messageOf(error, '声纹邀请发送失败，请稍后重试')) }
    finally { setInviteSending(false) }
  }

  return <main style={styles.root} data-arkme-owned="world-surface" aria-label="世界">
    <ArkmeWorldContent state={state} scope={scope} {...(target === undefined ? {} : { target })} voiceprintPlayableRefs={playableRefs} voiceprintRecordRef={voiceprintRecordRef}
      {...(interactionRecordRef === undefined ? {} : { interactionRecordRef })}
      {...(actionMessage === undefined ? {} : { actionMessage })}
      onRefresh={refresh} {...(onBackToWorld === undefined ? {} : { onBackToWorld })} onSelectScope={selectScope} onOpenComposer={() => { setComposerOpen(true) }}
      onOpenInteractions={toggleInteractions} onInteractionCreated={recordInteractionCreated} onToggleVoiceprint={recordRef => { void toggleVoiceprint(recordRef) }}
      onInviteVoiceprint={item => { void openVoiceprintInvite(item) }} onLoadMore={() => {
        if (state.nextOffset === undefined) return
        if (target === undefined) load(scope, state.nextOffset)
        else loadUser(target, state.nextOffset)
      }} />
    {composerOpen && <PublishDialog onClose={() => { setComposerOpen(false) }} onPublished={result => {
      setLoaded(current => ({ ...current, all: false, mine: false }))
      setActionMessage(result.visibility === 'pending_review' ? '已提交审核，可稍后在“我的世界”查看' : '已发布到世界')
      setScope('mine')
    }} />}
    {inviteItem !== undefined && <VoiceprintInviteDialog item={inviteItem} variantIndex={invitePresentationIndexesRef.current.get(inviteItem.recordRef) ?? 0} {...(inviteSocialContext === undefined ? {} : { socialContext: inviteSocialContext })} sending={inviteSending} {...(inviteMessage === undefined ? {} : { message: inviteMessage })} onClose={closeVoiceprintInvite} onConfirm={item => { void inviteVoiceprint(item) }} />}
  </main>
}
