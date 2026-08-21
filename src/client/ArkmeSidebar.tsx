import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import type {
  ArkmeAuthSnapshot, ArkmeGroupAiPolishNotice, ArkmeGroupAiPolishSnapshot, ArkmeSourceReadResult,
  ArkmeRelatedRecordingItem, ArkmeRelatedRecordingMonthBucket, ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageState, ArkmeSourceSendResult, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage,
  ArkmeInterwovenBootstrap, ArkmeInterwovenDetail, ArkmeInterwovenMention, ArkmePluginResponse,
  ArkmeUploadedAsset,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { ArkmeGroupChatControls } from './ArkmeGroupChatControls.js'
import { ArkmeLogin, type ArkmeLoginMode } from './ArkmeLogin.js'
import { ArkmeMuteIcon } from './ArkmeMuteIcon.js'
import { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'
import { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
import { ArkmeAttachmentDraftTile, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { ArkmeConversationMemoryCache } from './conversation-memory-cache.js'
import {
  ARKME_CONVERSATION_HEADER_HEIGHT, ArkmeInterwovenDetailAside, ArkmeInterwovenMentionCard,
  mergeConversationRows, resolveInterwovenGroupTarget,
  type ArkmeConversationRow, type ArkmeInterwovenDetailViewState,
} from './interwoven-moments.js'
import { arkmeUi } from './ui-controller.js'
import {
  isCurrentRelatedRecordingRequest, mergeRelatedRecordingItems, RelatedRecordingDetail,
  RelatedRecordingsPanel, shouldShowRelatedRecordingsEntry,
} from './related-recordings.js'

export interface ArkmeSurfaceProps {
  floating?: boolean
  initialAuth?: ArkmeAuthSnapshot | undefined
}

export type ArkmeAuthView = 'login' | 'content'

interface ArkmeComposerAttachment {
  asset: ArkmeUploadedAsset
  previewUrl?: string
}

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  danger: '#c2413b',
}

const styles: Record<string, CSSProperties> = {
  surface: {
    position: 'relative', overflow: 'hidden', width: '100%', height: '100%', minWidth: 0,
    display: 'flex', background: colors.panel, color: colors.text,
  },
  floatingSurface: { background: 'transparent' },
  panel: { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' },
  header: {
    flex: 'none', height: ARKME_CONVERSATION_HEADER_HEIGHT, display: 'flex', alignItems: 'center', padding: '12px 64px 12px 20px',
    boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`, position: 'relative', gap: 2,
  },
  titleGroup: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 },
  titleBlock: { flex: 1, minWidth: 0, padding: '2px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  title: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSubtitle: { color: colors.secondary, fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  titleMuteIcon: { flex: 'none', display: 'inline-flex', color: colors.secondary },
  headerActions: { position: 'relative', marginLeft: 'auto', flex: 'none' },
  moreButton: { width: 36, height: 32, border: 0, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 17, letterSpacing: 2 },
  popover: { position: 'absolute', zIndex: 40, top: 38, right: 0, width: 150, padding: 6, border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.panel, boxShadow: '0 12px 32px rgba(0,0,0,.12)' },
  menuItem: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, border: 0, borderRadius: 8, padding: '9px 10px', background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 13 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 32px 24px' },
  error: { padding: '10px 12px', borderRadius: 9, background: 'rgba(194,65,59,.1)', color: colors.danger, fontSize: 13 },
  records: { width: 'min(780px,100%)', listStyle: 'none', margin: '0 auto', padding: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  date: { alignSelf: 'center', padding: '4px 9px', borderRadius: 999, color: '#9097a1', fontSize: 12, background: '#f6f7f9' },
  row: { width: '100%', display: 'flex' },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageLine: { maxWidth: '88%', display: 'flex', alignItems: 'flex-start', gap: 9 },
  messageLineMe: { flexDirection: 'row-reverse' },
  messageBody: { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 },
  messageBodyMe: { alignItems: 'flex-end' },
  messageAvatar: {
    width: 32, height: 32, flex: 'none', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'transparent', color: '#737982', fontSize: 11, fontWeight: 600,
  },
  messageAvatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  sender: { color: colors.secondary, fontSize: 11 },
  bubble: { maxWidth: 560, padding: '10px 16px', borderRadius: 22, boxSizing: 'border-box', cursor: 'pointer' },
  bubbleMe: { background: 'var(--dsw-specific-bubble, #eef3ff)', '--arkme-bubble-fade': 'var(--dsw-specific-bubble, #eef3ff)' } as CSSProperties,
  bubbleOther: { background: 'var(--dsw-alias-bg-subtle, #f0f2f5)', '--arkme-bubble-fade': 'var(--dsw-alias-bg-subtle, #f0f2f5)' } as CSSProperties,
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 16, lineHeight: '24px' },
  meta: { color: '#adb2b8', fontSize: 11 },
  polishMeta: { minHeight: 14, marginBottom: 2, color: colors.secondary, fontSize: 10, lineHeight: '14px', display: 'flex', gap: 8, alignItems: 'center' },
  retry: { border: 0, padding: 0, background: 'transparent', color: '#c2413b', cursor: 'pointer', fontSize: 11 },
  notice: { alignSelf: 'center', maxWidth: 520, padding: '8px 12px 0', color: colors.secondary, textAlign: 'center', fontSize: 13, lineHeight: '16px' },
  sentinel: { width: '100%', height: 1 },
  loading: { textAlign: 'center', color: colors.secondary, fontSize: 12, padding: 6 },
  composer: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 24px 15px 16px' },
  composerInner: {
    position: 'relative', width: 'min(780px,100%)', overflow: 'visible', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10,
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,.1))', borderRadius: 22,
    background: 'var(--dsw-specific-input-major, #fff)', boxShadow: 'var(--dsw-shadow-lv2, 0 4px 16px rgba(0,0,0,.08))',
  },
  textarea: {
    width: '100%', minHeight: 28, maxHeight: 336, resize: 'none', overflowY: 'auto',
    boxSizing: 'border-box', border: 0, outline: 0, padding: '4px 12px 0 16px',
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 16, lineHeight: '24px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
    caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0,
    padding: '2px 8px 6px',
  },
  plus: { width: 32, height: 32, border: 0, borderRadius: 999, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 24, lineHeight: '30px' },
  addMenu: { position: 'absolute', left: 0, bottom: 54, zIndex: 20, width: 210, padding: '6px 0', borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.panel, boxShadow: '0 12px 32px rgba(0,0,0,.15)' },
  addMenuItem: { width: '100%', border: 0, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 14, textAlign: 'left' },
  menuDivider: { height: 1, margin: '4px 0', background: colors.border },
  attachments: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px' },
  uploadStatus: { padding: '0 14px', color: colors.secondary, fontSize: 12 },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 999, background: 'var(--dsw-alias-button-info-fill, #3964fe)',
    color: '#fff', cursor: 'pointer', transform: 'translateY(-2px)', transition: 'background-color 100ms ease',
  },
  drawer: { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10, width: 'min(420px, 92%)', display: 'flex', flexDirection: 'column', background: colors.panel, borderLeft: `1px solid ${colors.border}`, boxShadow: '-12px 0 30px rgba(0,0,0,.12)' },
  drawerHeader: { height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: `1px solid ${colors.border}`, boxSizing: 'border-box' },
  drawerTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  close: { marginLeft: 'auto', width: 32, height: 32, border: 0, borderRadius: 999, background: '#f1f3f6', cursor: 'pointer', color: colors.text },
  drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 },
  detailText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 16, lineHeight: '26px' },
  toggle: { border: 0, borderRadius: 9, padding: '7px 10px', background: '#f1efff', color: '#694fd0', cursor: 'pointer', fontSize: 12 },
  loginBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
}

export function arkmeAuthView(auth: ArkmeAuthSnapshot | undefined): ArkmeAuthView {
  return auth?.status === 'authenticated' ? 'content' : 'login'
}

export function arkmeLoginNeedsPhoneBinding(auth: ArkmeAuthSnapshot | undefined): boolean {
  return auth?.status === 'binding-required'
}

export function arkmeAuthenticatedAccountChanged(
  previous: ArkmeAuthSnapshot | undefined,
  next: ArkmeAuthSnapshot,
): boolean {
  return next.status === 'authenticated'
    && (previous?.status !== 'authenticated' || previous.userId !== next.userId)
}

export function arkmeArkoSurfaceKey(auth: ArkmeAuthSnapshot | undefined): number | 'authenticated' | 'logged-out' {
  if (auth?.status !== 'authenticated') return 'logged-out'
  return auth.userId ?? 'authenticated'
}

export function arkmeShouldBeginWechat(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
): boolean {
  return authView === 'login'
    && auth !== undefined
    && ['logged-out', 'expired'].includes(auth.status)
    && loginMode === 'wechat'
    && agreed
    && qr === ''
    && !qrRequestStarted
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M'); qr.addData(content); qr.make(); return qr.createDataURL(6, 12)
}

export function arkmeClipboardImageFiles(clipboardData: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  const files = itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files)
  return files.filter(file => file.type.toLowerCase().startsWith('image/'))
}
function dayKey(value: number): string {
  const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function mergeItems(current: ArkmeTimelineItem[], incoming: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const map = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) {
    const previous = map.get(item.itemUid)
    map.set(item.itemUid, previous?.aiPolish !== undefined && item.aiPolish === undefined
      ? { ...item, aiPolish: previous.aiPolish }
      : item)
  }
  return [...map.values()].sort((a, b) => a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid))
}

export function aiPolishStatus(item: ArkmeTimelineItem): string {
  switch (item.aiPolish?.state) {
    case 'polishing': return 'AI润色中...'
    case 'polished': return '✨已润色'
    case 'kept_original': return '保持原文'
    case 'failed': return '润色失败 · 重试'
    default: return ''
  }
}

function MessageAvatar({ item }: { item: ArkmeTimelineItem }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (item.avatarRef === undefined) return () => { active = false }
    void loadArkmeImageDataUrl(item.avatarRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [item.avatarRef])
  return <span style={styles.messageAvatar} aria-hidden>
    {src === '' ? <ArkmeMark size={32} /> : <img src={src} alt="" draggable={false} style={styles.messageAvatarImage} />}
  </span>
}

export function ArkmeSurface({ floating = false, initialAuth }: ArkmeSurfaceProps = {}) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authStoreSnapshot = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  )
  const chatDelta = useSyncExternalStore(
    arkmeChatTimelineDelta.subscribe,
    arkmeChatTimelineDelta.getSnapshot,
    arkmeChatTimelineDelta.getSnapshot,
  )
  const chatDirectory = useSyncExternalStore(
    arkmeChatDirectory.subscribe,
    arkmeChatDirectory.getSnapshot,
    arkmeChatDirectory.getSnapshot,
  )
  const interwovenInvalidation = useSyncExternalStore(
    arkmeInterwovenInvalidation.subscribe,
    arkmeInterwovenInvalidation.getSnapshot,
    arkmeInterwovenInvalidation.getSnapshot,
  )
  const source = ui.mode === 'source' ? ui.selectedSource : undefined
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const auth = authStoreSnapshot.auth ?? initialAuth
  const [items, setItems] = useState<ArkmeTimelineItem[]>([])
  const [timelineStateSourceRef, setTimelineStateSourceRef] = useState('')
  const [aiPolishNotices, setAiPolishNotices] = useState<ArkmeGroupAiPolishNotice[]>([])
  const [aiPolishSettings, setAiPolishSettings] = useState<ArkmeGroupAiPolishSnapshot>()
  const [drawer, setDrawer] = useState<'detail'>()
  const [detailItemUid, setDetailItemUid] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [interwovenMoments, setInterwovenMoments] = useState<ArkmeInterwovenMention[]>([])
  const [interwovenRefreshRevision, setInterwovenRefreshRevision] = useState(0)
  const [selectedMoment, setSelectedMoment] = useState<ArkmeInterwovenMention>()
  const [detailState, setDetailState] = useState<ArkmeInterwovenDetailViewState>()
  const [nextCursor, setNextCursor] = useState<ArkmeTimelineCursor>()
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [longArticleCreating, setLongArticleCreating] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<ArkmeComposerAttachment[]>([])
  const [uploadStatus, setUploadStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState(initialAuth?.status === 'binding-required' ? '请先绑定手机号，再继续使用 Arkme' : '')
  const [agreed, setAgreed] = useState(true)
  const [loginMode, setLoginMode] = useState<ArkmeLoginMode>(initialAuth?.status === 'binding-required' ? 'phone' : 'wechat')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [testLoginEnabled, setTestLoginEnabled] = useState(false)
  const [testUserId, setTestUserId] = useState('')
  const [qr, setQr] = useState('')
  const qrRequestStartedRef = useRef(false)
  const conversationCacheRef = useRef(new ArkmeConversationMemoryCache())
  const cacheAccountUserIdRef = useRef<number>()
  const timelineGenerationRef = useRef(0)
  const interwovenRequestRef = useRef<AbortController>()
  const interwovenGenerationRef = useRef(0)
  const detailRequestRef = useRef<AbortController>()
  const detailRequestMomentRef = useRef('')
  const lastReadAckRef = useRef('')
  const bindingNotifiedUserIdRef = useRef<number | undefined>()
  const attachmentPreviewUrlsRef = useRef(new Set<string>())
  const ignoreStaleBindingAuthRef = useRef(false)
  const authenticated = auth?.status === 'authenticated'
  const authView = arkmeAuthView(auth)
  const phoneBindingRequired = arkmeLoginNeedsPhoneBinding(auth)
  const [relatedEligibility, setRelatedEligibility] = useState<'idle' | 'loading' | 'allowed' | 'denied' | 'error'>('idle')
  const [relatedMenuOpen, setRelatedMenuOpen] = useState(false)
  const [relatedPanelOpen, setRelatedPanelOpen] = useState(false)
  const [relatedState, setRelatedState] = useState<'loading' | ArkmeRelatedRecordingPageState>('loading')
  const [relatedStateMessage, setRelatedStateMessage] = useState('')
  const [relatedError, setRelatedError] = useState('')
  const [relatedItems, setRelatedItems] = useState<ArkmeRelatedRecordingItem[]>([])
  const [relatedMonths, setRelatedMonths] = useState<ArkmeRelatedRecordingMonthBucket[]>([])
  const [relatedMonth, setRelatedMonth] = useState('')
  const [relatedHasMore, setRelatedHasMore] = useState(false)
  const [relatedNextCursor, setRelatedNextCursor] = useState<string>()
  const [relatedLoadingMore, setRelatedLoadingMore] = useState(false)
  const [relatedDetail, setRelatedDetail] = useState<ArkmeRelatedRecordingItem>()
  const relatedEligibilityAbortRef = useRef<AbortController>()
  const relatedPageAbortRef = useRef<AbortController>()
  const relatedGenerationRef = useRef(0)
  const relatedLoadingMoreRef = useRef(false)
  const activeRelatedSourceRef = useRef('')

  const releaseAttachmentPreview = useCallback((attachment: ArkmeComposerAttachment) => {
    if (attachment.previewUrl === undefined) return
    URL.revokeObjectURL(attachment.previewUrl)
    attachmentPreviewUrlsRef.current.delete(attachment.previewUrl)
  }, [])

  const releaseAttachmentPreviews = useCallback((values: ArkmeComposerAttachment[]) => {
    for (const attachment of values) releaseAttachmentPreview(attachment)
  }, [releaseAttachmentPreview])

  useEffect(() => () => {
    for (const previewUrl of attachmentPreviewUrlsRef.current) URL.revokeObjectURL(previewUrl)
    attachmentPreviewUrlsRef.current.clear()
  }, [])

  const acceptAuthSnapshot = useCallback((snapshot: ArkmeAuthSnapshot) => {
    const previous = arkmeAuthStore.getSnapshot().auth
    const accountChanged = arkmeAuthenticatedAccountChanged(previous, snapshot)
    arkmeAuthStore.setAuth(snapshot)
    if (snapshot.status === 'binding-required') {
      setLoginMode('phone')
      setAgreed(true)
      setQr('')
      setSmsCode('')
      setError('请先绑定手机号，再继续使用 Arkme')
      if (bindingNotifiedUserIdRef.current !== snapshot.userId) {
        bindingNotifiedUserIdRef.current = snapshot.userId
        arkmeUi.authChanged(false)
      }
      return
    }
    bindingNotifiedUserIdRef.current = undefined
    if (accountChanged) arkmeUi.authChanged(true)
  }, [])

  useEffect(() => {
    if (initialAuth === undefined) return
    if (ignoreStaleBindingAuthRef.current && initialAuth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && initialAuth.status === 'logged-out') return
    acceptAuthSnapshot(initialAuth)
  }, [acceptAuthSnapshot, auth?.status, initialAuth])
  useEffect(() => {
    if (authStoreSnapshot.auth === undefined) return
    if (ignoreStaleBindingAuthRef.current && authStoreSnapshot.auth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && authStoreSnapshot.auth.status === 'logged-out') return
    acceptAuthSnapshot(authStoreSnapshot.auth)
  }, [acceptAuthSnapshot, auth?.status, authStoreSnapshot.auth])
  useEffect(() => {
    if (authStoreSnapshot.config === undefined) return
    setCaptchaId(authStoreSnapshot.config.captchaId)
    setTestLoginEnabled(authStoreSnapshot.config.testLoginEnabled)
  }, [authStoreSnapshot.config])
  useEffect(() => {
    if (authStoreSnapshot.error !== '' && authView === 'login') setError(authStoreSnapshot.error)
  }, [authStoreSnapshot.error, authView])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 336)}px`
  }, [draft])

  const refreshAuth = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const snapshot = await arkmeAuthStore.refresh()
      const config = arkmeAuthStore.getSnapshot().config
      acceptAuthSnapshot(snapshot)
      if (config !== undefined) {
        setCaptchaId(config.captchaId)
        setTestLoginEnabled(config.testLoginEnabled)
      }
      if (!['authenticated', 'binding-required'].includes(snapshot.status) && config?.testLoginEnabled === true) setLoginMode('test')
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }, [acceptAuthSnapshot])

  const loadRelatedPage = useCallback(async (
    month: string,
    cursor: string | undefined,
    append: boolean,
    generation: number,
  ) => {
    if (source === undefined || source.kind !== 'private_chat') return
    const sourceRef = source.sourceRef
    if (append && relatedLoadingMoreRef.current) return
    const controller = new AbortController()
    relatedPageAbortRef.current?.abort()
    relatedPageAbortRef.current = controller
    if (append) {
      relatedLoadingMoreRef.current = true
      setRelatedLoadingMore(true)
    } else {
      setRelatedState('loading')
      setRelatedStateMessage('')
      setRelatedError('')
      setRelatedItems([])
      setRelatedHasMore(false)
      setRelatedNextCursor(undefined)
    }
    try {
      const page = await callArkme<ArkmeRelatedRecordingPage>('related-recordings.page', {
        sourceRef,
        limit: 10,
        ...(cursor === undefined ? {} : { cursor }),
        ...(month === '' ? {} : { monthKey: month }),
        timezoneOffsetMillis: -new Date().getTimezoneOffset() * 60_000,
        includeTimeIndex: !append && month === '',
      }, controller.signal)
      if (!isCurrentRelatedRecordingRequest(
        generation, relatedGenerationRef.current, sourceRef, activeRelatedSourceRef.current,
      )) return
      setRelatedItems(current => append ? mergeRelatedRecordingItems(current, page.items) : page.items)
      setRelatedState(page.state)
      setRelatedStateMessage(page.stateMessage)
      setRelatedError(page.state === 'error' ? page.stateMessage || '相关录音暂时无法读取' : '')
      setRelatedHasMore(page.hasMore)
      setRelatedNextCursor(page.nextCursor)
      if (!append && month === '') setRelatedMonths(page.timeIndexComplete ? page.monthBuckets ?? [] : [])
    } catch (caught) {
      if (controller.signal.aborted || !isCurrentRelatedRecordingRequest(
        generation, relatedGenerationRef.current, sourceRef, activeRelatedSourceRef.current,
      )) return
      setRelatedState('error')
      setRelatedError(errorMessage(caught))
    } finally {
      if (append) {
        relatedLoadingMoreRef.current = false
        if (generation === relatedGenerationRef.current) setRelatedLoadingMore(false)
      }
      if (relatedPageAbortRef.current === controller) relatedPageAbortRef.current = undefined
    }
  }, [source])

  const reloadRelated = useCallback((month: string) => {
    relatedGenerationRef.current += 1
    const generation = relatedGenerationRef.current
    setRelatedMonth(month)
    setRelatedDetail(undefined)
    void loadRelatedPage(month, undefined, false, generation)
  }, [loadRelatedPage])

  const openRelatedPanel = useCallback(() => {
    if (relatedEligibility !== 'allowed') return
    setRelatedMenuOpen(false)
    setRelatedPanelOpen(true)
    reloadRelated('')
  }, [relatedEligibility, reloadRelated])

  const closeRelatedPanel = useCallback(() => {
    relatedGenerationRef.current += 1
    relatedPageAbortRef.current?.abort()
    relatedPageAbortRef.current = undefined
    relatedLoadingMoreRef.current = false
    setRelatedPanelOpen(false)
    setRelatedDetail(undefined)
    setRelatedLoadingMore(false)
  }, [])

  const loadMoreRelated = useCallback(() => {
    if (relatedLoadingMoreRef.current || !relatedHasMore || relatedNextCursor === undefined) return
    void loadRelatedPage(relatedMonth, relatedNextCursor, true, relatedGenerationRef.current)
  }, [loadRelatedPage, relatedHasMore, relatedMonth, relatedNextCursor])

  useEffect(() => {
    relatedEligibilityAbortRef.current?.abort()
    relatedPageAbortRef.current?.abort()
    relatedGenerationRef.current += 1
    activeRelatedSourceRef.current = source?.sourceRef ?? ''
    relatedLoadingMoreRef.current = false
    setRelatedEligibility('idle')
    setRelatedMenuOpen(false)
    setRelatedPanelOpen(false)
    setRelatedDetail(undefined)
    setRelatedItems([])
    setRelatedMonths([])
    setRelatedMonth('')
    setRelatedHasMore(false)
    setRelatedNextCursor(undefined)
    setRelatedLoadingMore(false)
    setRelatedError('')
    if (!authenticated || source?.kind !== 'private_chat') return
    const controller = new AbortController()
    relatedEligibilityAbortRef.current = controller
    const sourceRef = source.sourceRef
    setRelatedEligibility('loading')
    void callArkme<{ allowed: boolean }>(
      'related-recordings.eligibility', { sourceRef }, controller.signal,
    ).then(result => {
      if (!controller.signal.aborted && activeRelatedSourceRef.current === sourceRef) {
        setRelatedEligibility(result.allowed ? 'allowed' : 'denied')
      }
    }).catch(() => {
      if (!controller.signal.aborted && activeRelatedSourceRef.current === sourceRef) setRelatedEligibility('error')
    })
    return () => { controller.abort() }
  }, [authenticated, source?.kind, source?.sourceRef, ui.authRevision])

  const acknowledgeRead = useCallback(async (nextItems: ArkmeTimelineItem[]) => {
    if (source === undefined || nextItems.length === 0
      || (source.kind !== 'private_chat' && source.kind !== 'group_chat')) return
    const visibleLatest = nextItems.reduce((latest, item) => Math.max(latest, item.sequence ?? 0), 0)
    const readSequence = Math.max(source.latestSequence ?? 0, visibleLatest)
    const readAckKey = `${source.sourceRef}:${String(readSequence)}`
    if (readSequence <= 0 || lastReadAckRef.current === readAckKey) return
    const hasReadIntent = source.unreadCount > 0
      || arkmeChatDirectory.hasOptimisticRead(source.sourceRef, source.sourceKey, source.latestSequence ?? readSequence)
    if (!hasReadIntent) return
    lastReadAckRef.current = readAckKey
    await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve() }) })
    try {
      const result = await callArkme<ArkmeSourceReadResult>('source.mark-read', {
        sourceRef: source.sourceRef,
        readSequence,
      })
      arkmeChatDirectory.updateReadAck(source.sourceRef, source.sourceKey, result.effectiveReadSequence, result.unreadCount)
    } catch {
      if (lastReadAckRef.current === readAckKey) lastReadAckRef.current = ''
      arkmeChatDirectory.rejectOptimisticRead(source.sourceRef, source.sourceKey, readSequence)
      void arkmeChatDirectory.refreshRoot({ force: true }).catch(() => undefined)
    }
  }, [source])

  const loadTimeline = useCallback(async (cursor?: ArkmeTimelineCursor, preserve = false) => {
    if (source === undefined) return
    const sourceRef = source.sourceRef
    const generation = timelineGenerationRef.current
    const body = bodyRef.current
    const oldHeight = body?.scrollHeight ?? 0
    const oldTop = body?.scrollTop ?? 0
    const page = await callArkme<ArkmeTimelinePage>('source.timeline', {
      sourceRef, limit: 40, ...(cursor === undefined ? {} : { cursor }),
    })
    if (generation !== timelineGenerationRef.current) return
    const cached = conversationCacheRef.current.getTimeline(sourceRef)
    const nextAiPolishSettings = cursor === undefined ? page.aiPolishSettings : cached?.aiPolishSettings
    const snapshot = {
      items: cursor === undefined ? mergeItems([], page.items) : mergeItems(cached?.items ?? [], page.items),
      aiPolishNotices: cursor === undefined ? page.aiPolishNotices ?? [] : cached?.aiPolishNotices ?? [],
      hasMore: page.hasMore,
      ...(nextAiPolishSettings === undefined ? {} : { aiPolishSettings: nextAiPolishSettings }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
    const releasedMoments = conversationCacheRef.current.storeTimeline(sourceRef, snapshot)
    setTimelineStateSourceRef(sourceRef)
    setItems(snapshot.items)
    setAiPolishSettings(snapshot.aiPolishSettings)
    setAiPolishNotices(snapshot.aiPolishNotices)
    setHasMore(snapshot.hasMore); setNextCursor(snapshot.nextCursor)
    if (releasedMoments !== undefined) setInterwovenMoments(releasedMoments)
    requestAnimationFrame(() => {
      const target = bodyRef.current
      if (target === null) return
      target.scrollTop = preserve ? oldTop + (target.scrollHeight - oldHeight) : target.scrollHeight
    })
    if (cursor === undefined) await acknowledgeRead(page.items)
  }, [acknowledgeRead, source])

  useEffect(() => {
    if (!authStoreSnapshot.checked) void refreshAuth()
  }, [authStoreSnapshot.checked, refreshAuth, ui.authRevision])
  useLayoutEffect(() => {
    timelineGenerationRef.current += 1
    const accountUserId = auth?.status === 'authenticated' ? auth.userId : undefined
    if (cacheAccountUserIdRef.current !== accountUserId) {
      conversationCacheRef.current.clear()
      cacheAccountUserIdRef.current = accountUserId
    }
    const sourceRef = authenticated ? source?.sourceRef : undefined
    const cachedTimeline = sourceRef === undefined
      ? undefined
      : conversationCacheRef.current.getTimeline(sourceRef)
    setTimelineStateSourceRef(sourceRef ?? '')
    setItems(cachedTimeline?.items ?? [])
    setAiPolishNotices(cachedTimeline?.aiPolishNotices ?? [])
    setAiPolishSettings(cachedTimeline?.aiPolishSettings)
    setNextCursor(cachedTimeline?.nextCursor)
    setHasMore(cachedTimeline?.hasMore ?? false)
    setDrawer(undefined); setDetailItemUid(''); setShowOriginal(false)
    if (authenticated) setError('')
    setAttachments(current => { releaseAttachmentPreviews(current); return [] }); setLongArticleCreating(false); setAddMenuOpen(false)
    interwovenRequestRef.current?.abort()
    interwovenGenerationRef.current += 1
    detailRequestRef.current?.abort()
    detailRequestMomentRef.current = ''
    setInterwovenMoments(sourceRef === undefined
      ? []
      : conversationCacheRef.current.getInterwovenMoments(sourceRef) ?? [])
    setSelectedMoment(undefined)
    setDetailState(undefined)
  }, [authenticated, auth?.userId, releaseAttachmentPreviews, source?.sourceRef])
  useEffect(() => {
    if (!authenticated || source === undefined) return
    const generation = timelineGenerationRef.current
    const hasCachedTimeline = conversationCacheRef.current.getTimeline(source.sourceRef) !== undefined
    void loadTimeline().catch(caught => {
      arkmeChatDirectory.rejectOptimisticRead(source.sourceRef, source.sourceKey, source.latestSequence ?? 0)
      if (generation === timelineGenerationRef.current && !hasCachedTimeline) setError(errorMessage(caught))
    })
  }, [authenticated, source?.sourceRef, ui.chatRevision])
  useEffect(() => {
    if (!authenticated || source === undefined || timelineStateSourceRef !== source.sourceRef) return
    if (conversationCacheRef.current.getTimeline(source.sourceRef) === undefined) return
    conversationCacheRef.current.storeTimeline(source.sourceRef, {
      items,
      aiPolishNotices,
      hasMore,
      ...(aiPolishSettings === undefined ? {} : { aiPolishSettings }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    })
  }, [aiPolishNotices, aiPolishSettings, authenticated, hasMore, items, nextCursor, source?.sourceRef, timelineStateSourceRef])
  useEffect(() => {
    if (!authenticated || source?.kind !== 'private_chat') return
    const sourceRef = source.sourceRef
    const generation = ++interwovenGenerationRef.current
    const controller = new AbortController()
    const body = bodyRef.current
    const stickToBottom = body === null || body.scrollHeight - body.scrollTop - body.clientHeight <= 80
    interwovenRequestRef.current?.abort()
    interwovenRequestRef.current = controller
    let active = true
    void callArkme<ArkmeInterwovenBootstrap>('source.interwoven-moments', {
      sourceRef,
    }, controller.signal).then(result => {
      if (!active || generation !== interwovenGenerationRef.current) return
      const moments = result.state === 'disabled' || result.state === 'empty' ? [] : result.moments
      const ready = conversationCacheRef.current.storeInterwovenMoments(sourceRef, moments)
      if (!ready) return
      setInterwovenMoments(moments)
      if (stickToBottom) requestAnimationFrame(() => {
        if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
      })
    }).catch(() => undefined).finally(() => {
      if (!active || generation !== interwovenGenerationRef.current) return
      if (interwovenRequestRef.current === controller) interwovenRequestRef.current = undefined
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [authenticated, interwovenRefreshRevision, source?.kind, source?.sourceRef])
  const observedInterwovenInvalidationRef = useRef(interwovenInvalidation.revision)
  useEffect(() => {
    if (interwovenInvalidation.revision <= observedInterwovenInvalidationRef.current) return
    observedInterwovenInvalidationRef.current = interwovenInvalidation.revision
    if (!authenticated || source?.kind !== 'private_chat') return
    const timer = setTimeout(() => { setInterwovenRefreshRevision(value => value + 1) }, 250)
    return () => { clearTimeout(timer) }
  }, [authenticated, interwovenInvalidation.revision, source?.kind, source?.sourceRef])
  useEffect(() => {
    if (!authenticated || source?.kind !== 'private_chat') return
    const refreshOnFocus = () => { setInterwovenRefreshRevision(value => value + 1) }
    window.addEventListener('focus', refreshOnFocus)
    return () => { window.removeEventListener('focus', refreshOnFocus) }
  }, [authenticated, source?.kind, source?.sourceRef])
  useEffect(() => {
    if (!authenticated || source === undefined) return
    const deltaItems = chatDelta.itemsBySourceRef[source.sourceRef] ?? []
    if (deltaItems.length === 0) return
    setItems(current => mergeItems(current, deltaItems))
    void acknowledgeRead(deltaItems)
    requestAnimationFrame(() => {
      if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }, [acknowledgeRead, authenticated, chatDelta, source?.sourceRef])

  useEffect(() => {
    if (!authenticated || !ui.surfaceOpen || source?.kind !== 'group_chat') return
    let cancelled = false
    const refreshPresentation = () => {
      void callArkme<ArkmeGroupAiPolishSnapshot>('source.ai-polish.settings', {
        sourceRef: source.sourceRef,
      }).then(snapshot => { if (!cancelled) setAiPolishSettings(snapshot) }).catch(() => undefined)
      void callArkme<ArkmeGroupAiPolishNotice[]>('source.ai-polish.notices', {
        sourceRef: source.sourceRef,
      }).then(notices => { if (!cancelled) setAiPolishNotices(notices) }).catch(() => undefined)
    }
    const timer = setInterval(refreshPresentation, 3_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [authenticated, source?.sourceRef, ui.surfaceOpen])

  useEffect(() => {
    const root = bodyRef.current; const sentinel = sentinelRef.current
    if (!authenticated || root === null || sentinel === null || !hasMore || nextCursor === undefined) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true || loadingOlder) return
      setLoadingOlder(true)
      void loadTimeline(nextCursor, true).catch(caught => { setError(errorMessage(caught)) }).finally(() => { setLoadingOlder(false) })
    }, { root, rootMargin: '120px 0px 0px' })
    observer.observe(sentinel); return () => { observer.disconnect() }
  }, [authenticated, hasMore, loadTimeline, loadingOlder, nextCursor])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  useEffect(() => {
    if (loginMode !== 'wechat' || !agreed || auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.poll', { attemptId: auth.attemptId })
        if (stopped) return
        acceptAuthSnapshot(snapshot)
        if (snapshot.status === 'authenticated') { setQr(''); return }
      } catch (caught) { if (!stopped) setError(errorMessage(caught)) }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 800)
    return () => { stopped = true; clearTimeout(timer) }
  }, [agreed, auth?.attemptId, auth?.status, loginMode])

  const beginWechat = async () => {
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setError('')
    try { const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.begin'); acceptAuthSnapshot(snapshot); setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent)) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError('请输入正确的 11 位手机号'); return }
    setBusy(true); setError('')
    try { const captcha = await verifyPhoneCaptcha(captchaId, phone); await callArkme('auth.phone.send', { phone, captcha }); setSmsCountdown(60) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const verifyCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError('请输入正确的手机号'); return }
    if (!/^\d{6}$/.test(smsCode)) { setError('请输入验证码'); return }
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setSubmitBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      acceptAuthSnapshot(snapshot)
    } catch (caught) { setError(errorMessage(caught)) } finally { setSubmitBusy(false); setBusy(false) }
  }

  const testLogin = async () => {
    const userId = Number(testUserId)
    if (!Number.isSafeInteger(userId) || userId <= 0) { setError('请输入有效的测试账号 user_id'); return }
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.test.login', { userId })
      acceptAuthSnapshot(snapshot)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const cancelBinding = async () => {
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      ignoreStaleBindingAuthRef.current = true
      arkmeAuthStore.setAuth(snapshot)
      setPhone('')
      setSmsCode('')
      setQr('')
      setSubmitBusy(false)
      qrRequestStartedRef.current = false
      setLoginMode(testLoginEnabled ? 'test' : 'wechat')
      arkmeUi.authChanged(false)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!arkmeShouldBeginWechat(auth, authView, loginMode, agreed, qr, qrRequestStartedRef.current)) return
    qrRequestStartedRef.current = true
    void beginWechat()
  }, [agreed, auth, authView, loginMode, qr])

  const changeLoginMode = (mode: ArkmeLoginMode) => {
    setLoginMode(mode)
    setError('')
    if (mode !== 'wechat') qrRequestStartedRef.current = false
  }

  const uploadFile = async (file: File): Promise<ArkmeUploadedAsset> => await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/arkme-self/api/upload')
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    request.setRequestHeader('X-Arkme-File-Name', encodeURIComponent(file.name))
    request.upload.onprogress = event => {
      if (event.lengthComputable) setUploadStatus(`正在上传 ${file.name} ${String(Math.round(event.loaded / event.total * 100))}%`)
    }
    request.upload.onload = () => { setUploadStatus(`正在保存 ${file.name}…`) }
    request.onerror = () => { reject(new Error('文件上传网络错误')) }
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText) as ArkmePluginResponse<ArkmeUploadedAsset>
        if (!payload.ok) { reject(new ArkmeClientError(payload.error)); return }
        resolve(payload.value)
      } catch (caught) { reject(caught) }
    }
    request.send(file)
  })

  const selectFiles = async (files: FileList | readonly File[] | null) => {
    if (files === null || files.length === 0) return
    setAddMenuOpen(false); setBusy(true); setError('')
    const uploaded: ArkmeComposerAttachment[] = []
    try {
      for (const file of Array.from(files)) {
        const previewUrl = file.type.toLowerCase().startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : undefined
        if (previewUrl !== undefined) attachmentPreviewUrlsRef.current.add(previewUrl)
        try {
          const asset = await uploadFile(file)
          uploaded.push({ asset, ...(previewUrl === undefined ? {} : { previewUrl }) })
        } catch (caught) {
          if (previewUrl !== undefined) {
            URL.revokeObjectURL(previewUrl)
            attachmentPreviewUrlsRef.current.delete(previewUrl)
          }
          throw caught
        }
      }
      setAttachments(current => {
        const retained = [...current, ...uploaded].slice(0, 20)
        const retainedIds = new Set(retained.map(item => item.asset.fileAssetUid))
        releaseAttachmentPreviews(uploaded.filter(item => !retainedIds.has(item.asset.fileAssetUid)))
        return retained
      })
    } catch (caught) {
      releaseAttachmentPreviews(uploaded)
      setError(errorMessage(caught))
    }
    finally {
      setUploadStatus(''); setBusy(false)
      if (fileInputRef.current !== null) fileInputRef.current.value = ''
    }
  }

  const send = async () => {
    if (source === undefined) return
    const textContent = draft.trim()
    if (textContent === '' && attachments.length === 0) return
    const recordUid = crypto.randomUUID(); const relationUid = crypto.randomUUID(); const now = Date.now()
    const optimistic: ArkmeTimelineItem = {
      itemUid: recordUid, senderName: '我', isMe: true, sendAtMillis: now,
      title: '', textContent, status: 0,
      ...(source.kind === 'group_chat' && aiPolishSettings?.enabled === true
        ? { aiPolish: { state: 'polishing' as const, originalText: textContent } }
        : {}),
      displayKind: 0,
    }
    const pendingAttachments = attachments
    const pendingAssets = pendingAttachments.map(attachment => attachment.asset)
    setItems(current => mergeItems(current, [optimistic])); setDraft(''); setAttachments([]); setBusy(true); setError('')
    requestAnimationFrame(() => { if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight })
    try {
      const result = pendingAssets.length > 0
        ? await callArkme<ArkmeSourceSendResult>('source.send-rich', {
          sourceRef: source.sourceRef, title: '', textContent, displayKind: 0,
          assets: pendingAssets, recordUid, relationUid,
        })
        : await callArkme<ArkmeSourceSendResult>('source.send-text', {
          sourceRef: source.sourceRef, textContent, recordUid, relationUid,
        })
      setItems(current => current.map(item => {
        if (item.itemUid !== recordUid) return item
        const { aiPolish: _optimisticAiPolish, ...base } = item
        return {
          ...base,
          itemUid: result.itemUid,
          status: result.status,
          ...(result.sequence === undefined ? {} : { sequence: result.sequence }),
          ...(result.aiPolish === undefined ? {} : {
            aiPolish: result.aiPolish,
            ...(result.aiPolish.state === 'polished' && result.aiPolish.polishedText !== undefined
              ? { textContent: result.aiPolish.polishedText }
              : {}),
          }),
        }
      }))
      releaseAttachmentPreviews(pendingAttachments)
      if (result.localState === 'failed') setError(result.error ?? '内容已保存在本地，远端同步失败')
      if (result.aiPolish?.state === 'kept_original') {
        setTimeout(() => {
          setItems(current => current.map(item => {
            if (item.itemUid !== result.itemUid || item.aiPolish?.state !== 'kept_original') return item
            const { aiPolish: _keptOriginal, ...plainItem } = item
            return plainItem
          }))
        }, 1_500)
      }
      if (pendingAssets.length > 0) await loadTimeline()
    } catch (caught) {
      setItems(current => current.filter(item => item.itemUid !== recordUid)); setDraft(textContent)
      setAttachments(pendingAttachments); setError(errorMessage(caught))
    } finally { setBusy(false) }
  }

  const retryAiPolish = async (item: ArkmeTimelineItem) => {
    const retryRef = item.aiPolish?.retryRef
    if (retryRef === undefined) return
    setItems(current => current.map(value => value.itemUid === item.itemUid
      ? { ...value, aiPolish: { ...value.aiPolish, state: 'polishing' } }
      : value))
    try {
      const result = await callArkme<ArkmeSourceSendResult>('source.ai-polish.retry', { retryRef })
      setItems(current => current.map(value => {
        if (value.itemUid !== item.itemUid || result.aiPolish === undefined) return value
        return {
          ...value,
          ...(result.aiPolish.state === 'polished' && result.aiPolish.polishedText !== undefined
            ? { textContent: result.aiPolish.polishedText }
            : {}),
          aiPolish: result.aiPolish,
        }
      }))
    } catch (caught) {
      setItems(current => current.map(value => value.itemUid === item.itemUid && item.aiPolish !== undefined
        ? { ...value, aiPolish: item.aiPolish }
        : value))
      setError(errorMessage(caught))
    }
  }

  const detailItem = items.find(item => item.itemUid === detailItemUid)
  const activateSource = useCallback((nextSource: ArkmeTimelinePage['source']) => {
    arkmeUi.selectSource(nextSource)
    arkmeUi.chatChanged()
  }, [])

  const loadMomentDetail = async (moment: ArkmeInterwovenMention, force = false) => {
    if (source === undefined || source.kind !== 'private_chat') return
    if (!force && detailRequestMomentRef.current === moment.momentId) return
    detailRequestRef.current?.abort()
    const controller = new AbortController()
    detailRequestRef.current = controller
    detailRequestMomentRef.current = moment.momentId
    setSelectedMoment(moment)
    setDetailState({ kind: 'loading' })
    try {
      const detail = await callArkme<ArkmeInterwovenDetail>('source.interwoven-detail', {
        sourceRef: source.sourceRef,
        momentRef: moment.momentRef,
      }, controller.signal)
      if (detailRequestRef.current !== controller) return
      setDetailState({ kind: 'success', detail })
    } catch (caught) {
      if (detailRequestRef.current !== controller) return
      setDetailState({ kind: 'error', message: errorMessage(caught) })
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = undefined
        detailRequestMomentRef.current = ''
      }
    }
  }

  const openMomentDetail = (moment: ArkmeInterwovenMention) => {
    if (selectedMoment?.momentId === moment.momentId
      && detailState !== undefined && detailState.kind !== 'error') return
    void loadMomentDetail(moment)
  }

  const closeMomentDetail = () => {
    detailRequestRef.current?.abort()
    detailRequestRef.current = undefined
    detailRequestMomentRef.current = ''
    setSelectedMoment(undefined)
    setDetailState(undefined)
  }

  const displayItems = useMemo(() => [...items].sort((a, b) => a.sendAtMillis - b.sendAtMillis), [items])
  const displayRows = useMemo<Array<ArkmeConversationRow | {
    kind: 'notice'; id: string; occurredAtMillis: number; item: ArkmeGroupAiPolishNotice
  }>>(
    () => [
      ...mergeConversationRows(displayItems, interwovenMoments),
      ...aiPolishNotices.map(notice => ({
        kind: 'notice' as const,
        id: `notice:${notice.noticeUid}`,
        occurredAtMillis: notice.createdAtMillis,
        item: notice,
      })),
    ].sort((left, right) => left.occurredAtMillis - right.occurredAtMillis || left.id.localeCompare(right.id)),
    [aiPolishNotices, displayItems, interwovenMoments],
  )
  const detailGroupTarget = useMemo(
    () => detailState?.kind === 'success'
      ? resolveInterwovenGroupTarget(chatDirectory.sources, detailState.detail.groupName)
      : undefined,
    [chatDirectory, detailState],
  )
  const showMessageAvatars = source?.kind === 'private_chat' || source?.kind === 'group_chat'
  const surfaceTitle = ui.mode === 'recordings' ? '全天候录音' : ui.mode === 'search' ? '搜索' : ui.mode === 'arko' ? 'Arko' : source?.displayName ?? 'Arkme'
  const arkoContentVisible = authView === 'content' && ui.mode === 'arko'

  return (
    <div style={{ ...styles.surface, ...(floating ? styles.floatingSurface : {}) }}>
      <section ref={panelRef} style={styles.panel} role="region" aria-label={surfaceTitle}>
        {!arkoContentVisible && <header style={styles.header}>
          <div style={styles.titleGroup}>
            <div style={styles.titleBlock}>
              <h2 style={styles.title}>{surfaceTitle}</h2>
              {authenticated && ui.mode === 'source' && source?.kind === 'group_chat'
                && aiPolishSettings?.enabled === true
                && <span style={styles.headerSubtitle}>AI润色已开启</span>}
            </div>
            {source?.isMuted === true && <span style={styles.titleMuteIcon}><ArkmeMuteIcon /></span>}
          </div>
          {authenticated && ui.mode === 'source' && source?.kind === 'private_chat' && <ArkmePrivateCallMenu
            sourceRef={source.sourceRef}
            displayName={source.displayName}
            assetBasePath={authStoreSnapshot.config?.callAssetBasePath ?? '/arkme-self/api/call'}
          />}
          {authenticated && ui.mode === 'source' && source?.kind === 'group_chat' && <ArkmeGroupChatControls
            source={source}
            overlayHostRef={panelRef}
            onSourceActivated={activateSource}
            onError={setError}
          />}
          {shouldShowRelatedRecordingsEntry(authenticated, source?.kind, relatedEligibility, relatedPanelOpen) && <div style={styles.headerActions}>
            <button type="button" style={styles.moreButton} aria-label="更多私聊操作" aria-expanded={relatedMenuOpen}
              onClick={() => { setRelatedMenuOpen(value => !value) }}>•••</button>
            {relatedMenuOpen && <div style={styles.popover} role="menu">
              <button type="button" role="menuitem" style={styles.menuItem} onClick={openRelatedPanel}>
                <span aria-hidden>◉</span><span>相关录音</span>
              </button>
            </div>}
          </div>}
        </header>}
        {authView === 'login' ? <div style={styles.loginBody}><ArkmeLogin
          mode={loginMode}
          phoneBindingRequired={phoneBindingRequired}
          agreed={agreed}
          busy={busy}
          submitBusy={submitBusy}
          error={error}
          phone={phone}
          smsCode={smsCode}
          smsCountdown={smsCountdown}
          testLoginEnabled={testLoginEnabled}
          testUserId={testUserId}
          qrDataUrl={qr}
          onModeChange={changeLoginMode}
          onAgreementChange={setAgreed}
          onPhoneChange={setPhone}
          onSmsCodeChange={setSmsCode}
          onTestUserIdChange={setTestUserId}
          onSendCode={() => { void sendCode() }}
          onVerifyCode={() => { void verifyCode() }}
          onTestLogin={() => { void testLogin() }}
          onWechatLogin={() => { void beginWechat() }}
          onCancelBinding={() => { void cancelBinding() }}
        /></div> : ui.mode === 'recordings' ? <ArkmeRecordingSurface />
          : ui.mode === 'search' ? <div style={styles.body}><ArkmeSearchSurface /></div>
          : ui.mode === 'arko' ? <ArkmeArkoSurface key={arkmeArkoSurfaceKey(auth)} />
          : source === undefined ? <div style={styles.body} /> : <>
          <div ref={bodyRef} style={styles.body}>
            {error !== '' && <div style={styles.error}>{error}</div>}
            <div ref={sentinelRef} style={styles.sentinel} />
            {loadingOlder && <div style={styles.loading}>正在加载更早内容…</div>}
            {displayRows.length > 0 && <ul style={styles.records}>
              {displayRows.map((row, index) => {
                const previous = index === 0 ? undefined : displayRows[index - 1]
                const startsDay = previous === undefined
                  || dayKey(previous.occurredAtMillis) !== dayKey(row.occurredAtMillis)
                if (row.kind === 'notice') return <Fragment key={row.id}>
                  {startsDay && <li style={styles.date}>{dayLabel(row.occurredAtMillis)}</li>}
                  <li style={styles.notice}>{row.item.message}</li>
                </Fragment>
                if (row.kind === 'moment') {
                  return <Fragment key={row.id}>
                    {startsDay && <li style={styles.date}>{dayLabel(row.occurredAtMillis)}</li>}
                    <ArkmeInterwovenMentionCard moment={row.item} onOpen={openMomentDetail} />
                  </Fragment>
                }
                const item = row.item
                const polishStatus = aiPolishStatus(item)
                return <Fragment key={row.id}>
                  {startsDay && <li style={styles.date}>{dayLabel(item.sendAtMillis)}</li>}
                  <li style={{ ...styles.row, ...(item.isMe ? styles.rowMe : styles.rowOther) }}>
                    <div style={{ ...styles.messageLine, ...(item.isMe ? styles.messageLineMe : {}) }}>
                      {showMessageAvatars && <MessageAvatar item={item} />}
                      <div style={{ ...styles.messageBody, ...(item.isMe ? styles.messageBodyMe : {}) }}>
                        {!item.isMe && <span style={styles.sender}>{item.senderName}</span>}
                        <div
                          role="button"
                          tabIndex={0}
                          style={{ ...styles.bubble, ...(item.isMe ? styles.bubbleMe : styles.bubbleOther) }}
                          onClick={event => {
                            if (event.target instanceof Element && event.target.closest('button,a,audio,video')) return
                            setDetailItemUid(item.itemUid); setShowOriginal(false); setDrawer('detail')
                          }}
                          onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault(); setDetailItemUid(item.itemUid); setShowOriginal(false); setDrawer('detail')
                          }}
                          aria-label="打开快记详情"
                        >{polishStatus !== '' && <span style={styles.polishMeta}>
                          {item.aiPolish?.state === 'failed' ? <button
                            type="button" style={styles.retry} onClick={event => { event.stopPropagation(); void retryAiPolish(item) }}
                          >{polishStatus}</button> : polishStatus}
                        </span>}
                          <ArkmeMessageContent
                          item={item}
                          sourceRef={source.sourceRef}
                          onLongArticleUpdated={detail => {
                            setItems(current => current.map(candidate => candidate.itemUid === detail.itemUid
                              ? {
                                ...candidate,
                                title: detail.title,
                                textContent: detail.textContent,
                                sendAtMillis: detail.sendAtMillis,
                                updateAtMillis: detail.updateAtMillis,
                                templateKind: 1,
                                displayKind: 1,
                                version: detail.version,
                                recordDurationMillis: detail.recordDurationMillis,
                                editDurationMillis: detail.editDurationMillis,
                              }
                              : candidate))
                          }}
                        /></div>
                        <span style={styles.meta}>{timeLabel(item.sendAtMillis)}</span>
                      </div>
                    </div>
                  </li>
                </Fragment>
              })}
            </ul>}
          </div>
          <footer style={styles.composer}><div style={styles.composerInner}>
            {addMenuOpen && <div style={styles.addMenu} role="menu">
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { fileInputRef.current?.click() }}><span aria-hidden>📎</span>添加照片和文件</button>
              <div style={styles.menuDivider} />
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { setLongArticleCreating(true); setAddMenuOpen(false) }}><span aria-hidden>✎</span>写长文</button>
            </div>}
            <input ref={fileInputRef} type="file" multiple hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" onChange={event => { void selectFiles(event.currentTarget.files) }} />
            {attachments.length > 0 && <div style={styles.attachments}>{attachments.map(attachment => <ArkmeAttachmentDraftTile
              key={attachment.asset.fileAssetUid}
              asset={attachment.asset}
              {...(attachment.previewUrl === undefined ? {} : { previewUrl: attachment.previewUrl })}
              onRemove={() => {
                releaseAttachmentPreview(attachment)
                setAttachments(current => current.filter(item => item.asset.fileAssetUid !== attachment.asset.fileAssetUid))
              }}
            />)}</div>}
            {uploadStatus !== '' && <div style={styles.uploadStatus} role="status">{uploadStatus}</div>}
            <textarea ref={textareaRef} rows={1} style={styles.textarea} value={draft} maxLength={20000} placeholder={`发送到${source.displayName}…`} aria-label={`发送到${source.displayName}`} disabled={busy}
              onChange={event => { setDraft(event.target.value) }}
              onPaste={event => {
                const imageFiles = arkmeClipboardImageFiles(event.clipboardData)
                if (imageFiles.length === 0) return
                event.preventDefault()
                void selectFiles(imageFiles)
              }}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && draft.trim() !== '') void send() } }} />
            <div style={styles.tools}><button type="button" style={styles.plus} aria-label="添加内容" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen(value => !value) }}>+</button><button
              type="button"
              style={{ ...styles.send, opacity: busy || (draft.trim() === '' && attachments.length === 0) ? .4 : 1 }}
              disabled={busy || (draft.trim() === '' && attachments.length === 0)}
              aria-label="发送消息"
              onMouseDown={event => { event.preventDefault() }}
              onMouseEnter={event => {
                if (!event.currentTarget.disabled) {
                  event.currentTarget.style.background = 'var(--dsw-alias-button-info-hover, #2f57df)'
                }
              }}
              onMouseLeave={event => {
                event.currentTarget.style.background = 'var(--dsw-alias-button-info-fill, #3964fe)'
              }}
              onClick={() => { void send() }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
              </svg>
            </button></div>
          </div></footer>
        </>}
        {drawer === 'detail' && detailItem !== undefined && <aside style={styles.drawer} aria-label="快记详情">
          <header style={styles.drawerHeader}>
            <h3 style={styles.drawerTitle}>快记详情</h3>
            <button type="button" style={styles.close} aria-label="关闭详情" onClick={() => { setDrawer(undefined) }}>×</button>
          </header>
          <div style={styles.drawerBody}>
            <div style={{ color: colors.secondary, fontSize: 12, marginBottom: 16 }}>
              {detailItem.senderName} · {new Date(detailItem.sendAtMillis).toLocaleString('zh-CN')}
            </div>
            {detailItem.aiPolish?.state === 'polished'
              && detailItem.aiPolish.originalText !== undefined
              && detailItem.aiPolish.polishedText !== undefined
              && <button type="button" style={styles.toggle} onClick={() => { setShowOriginal(value => !value) }}>
                {showOriginal ? '👁️显示润色' : '👁️显示原文'}
              </button>}
            <p style={styles.detailText}>{showOriginal && detailItem.aiPolish?.originalText !== undefined
              ? detailItem.aiPolish.originalText
              : detailItem.aiPolish?.state === 'polished' && detailItem.aiPolish.polishedText !== undefined
                ? detailItem.aiPolish.polishedText
                : detailItem.textContent || detailItem.title || '非文本内容'}</p>
          </div>
        </aside>}
      </section>
      {relatedPanelOpen && source?.kind === 'private_chat' && <RelatedRecordingsPanel
        contactName={source.displayName}
        state={relatedState}
        stateMessage={relatedStateMessage}
        error={relatedError}
        items={relatedItems}
        hasMore={relatedHasMore}
        loadingMore={relatedLoadingMore}
        monthBuckets={relatedMonths}
        selectedMonth={relatedMonth}
        onClose={closeRelatedPanel}
        onRetry={() => { reloadRelated(relatedMonth) }}
        onLoadMore={loadMoreRelated}
        onMonthChange={reloadRelated}
        onSelect={setRelatedDetail}
      />}
      {relatedDetail !== undefined && <RelatedRecordingDetail
        item={relatedDetail}
        onClose={() => { setRelatedDetail(undefined) }}
      />}
      {selectedMoment !== undefined && detailState !== undefined && <ArkmeInterwovenDetailAside
        state={detailState}
        onClose={closeMomentDetail}
        onRetry={() => { void loadMomentDetail(selectedMoment, true) }}
        {...(detailGroupTarget === undefined ? {} : { onOpenGroup: () => {
          closeMomentDetail()
          arkmeUi.selectSource(detailGroupTarget)
        } })}
      />}
      {longArticleCreating && source !== undefined && typeof document !== 'undefined' && createPortal(
        <ArkmeLongArticleDialog
          sourceRef={source.sourceRef}
          onClose={() => { setLongArticleCreating(false) }}
          onCreated={item => {
            setItems(current => mergeItems(current, [item]))
            requestAnimationFrame(() => { if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight })
          }}
        />,
        document.body,
      )}
    </div>
  )
}
