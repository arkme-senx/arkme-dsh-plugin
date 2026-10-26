import { attachmentPreparationHint } from './attachment-preparation.js'
import { ArkmeTimelineDetailDrawer } from './ArkmeNoteDetails.js'
import type { ArkmeArkoContextWindow, ArkmeArkoMessagePage } from '../arko-history-contract.js'
import { ArkmeSelectableMessageText, ArkmeMessageTextSelectionToolbar } from './ArkmeMessageTextSelection.js'
import { useMessageUnderlines } from './ArkmeMessageUnderlines.js'
import { arkoMessageMarkTarget, arkoMessageMarkTransport } from './arko-message-marks.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeMessageSelectionControl, messageSelectionStyles } from './message-selection-presentation.js'
import { RegionMarquee } from './selection/RegionMarquee.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeWideConversation } from './ArkmeWideConversation.js'
import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { ArkmeConversationDate } from './ArkmeConversationDate.js'
import { ArkmeMessageTimestamp } from './ArkmeMessageTimestamp.js'
import { ArkmeComposerSendButton, arkmeComposerSendButtonStyle } from './ArkmeComposerSendButton.js'
import { arkmeConversationMessageLayout, dayKey } from './conversation-message-presentation.js'
import { ArkmeArkoHistoryTools } from './ArkmeArkoHistoryTools.js'
import { ArkoMessageDeletionDialog } from './ArkoMessageDeletion.js'
import { arkoHistoryDate, readLatestArkoMessages } from './arko-history-browser.js'
import type {
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryItem,
  ArkmeArkoModelCatalog,
  ArkmeArkoProfile,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
  ArkmeContentBlock,
  ArkmeTimelineItem,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkoModelCache } from './arko-model-cache.js'
import { ArkoModelMenu } from './ArkoModelMenu.js'
import { ArkmeArkoAvatar } from './ArkmeArkoAvatar.js'
import {
  readArkoPendingTurn,
  removeArkoPendingTurn,
  writeArkoPendingTurn,
  type ArkmeArkoPendingTurn,
} from './arko-pending-turn-store.js'
import { arkoPresentationName, arkmeArkoProfileStore } from './arko-profile-store.js'
import { arkmeArkoConversationPreviewStore } from './arko-conversation-preview-store.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeAttachmentsPending, arkmeArkoComposerDraftKey, arkmeComposerDraftStore, serializeArkmeComposerDraft, type ArkmeComposerDraftSnapshot } from './composer-draft-store.js'
import { useConversationDraftPresence } from './conversation-draft-presence.js'
import {
  arkmeConversationComposerBorder, arkmeConversationComposerFocusStyle, arkmeConversationComposerLayout,
} from './conversation-composer-presentation.js'
import { ArkmeComposerInfoRow } from './ArkmeComposerInfoRow.js'
import { focusArkmeComposerFromClick, restoreArkmeComposerFocus } from './composer-focus.js'
import { ArkmeDocumentComposerInput, type ArkmeDocumentComposerHandle } from './ArkmeDocumentComposerInput.js'
import { ArkmeEmojiPicker } from './ArkmeEmojiPicker.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeComposerPlusIcon } from './ArkmeComposerToolIcon.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkoImageDraftStrip, ArkoMessageImages, useArkoImageDraft } from './ArkoImageAttachments.js'
import { arkoImageInputError, ARKO_IMAGE_MIME_TYPES } from '../arko-image-contract.js'
import { localFileBlock } from './file-send-tasks.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeEmojiPlainText, type ArkmeEmoji } from './arkme-emoji.js'
import {
  useArkmeMessageActions,
  type ArkmeMessageActionViewItem,
} from './ArkmeMessageActions.js'

type ArkoMessageRole = 'user' | 'assistant' | 'divider'
type ArkoMessageStatus = 'sending' | 'done' | 'error'
const arkoQuestionMaxLength = 60 * 1024

interface ArkoMessage {
  localMarkRef?: string
  id: string
  messageId?: number
  sessionId?: number
  role: ArkoMessageRole
  text: string
  contentBlocks?: ArkmeContentBlock[]
  reasoning?: string
  status: ArkoMessageStatus
  createdAtMillis?: number
  orderAtMillis?: number
  sourceType?: number
  createdRecordUids?: string[]
  assistantMsgId?: number
  runUid?: string
  runStatus?: string
  messageActionRef?: string
  messageActionConversationRef?: string
  copyLinkAvailable?: boolean
  forwardAvailable?: boolean
}

interface ArkoContinuationTarget {
  assistantMsgId: number
  runUid: string
}

interface ActiveArkoRun extends ArkoContinuationTarget {
  sessionId: number
}

const ACTIVE_RUN_STATUSES = new Set(['accepted', 'queued', 'running', 'stream_timeout', 'waiting_tool'])

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  active: arkmeTheme.accentSoft,
  accent: arkmeTheme.accent,
  danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  shell: { position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 22px 12px' },
  header: { ...arkmeConversationMessageLayout.header, minWidth: 0, background: arkmeTheme.base },
  headerAvatar: { width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center' },
  headerCopy: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  headerTitle: {
    minWidth: 0, margin: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.text, fontSize: 15, lineHeight: '21px', fontWeight: 600,
  },
  aiDisclaimer: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.secondary, fontSize: 11, lineHeight: '15px',
  },

  records: { width: '100%', listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 },
  row: { width: '100%', display: 'flex' },
  rowMe: { justifyContent: 'flex-end' },
  rowArko: { justifyContent: 'flex-start' },
  line: arkmeConversationMessageLayout.messageLine,
  lineMe: { flexDirection: 'row-reverse' },
  avatar: arkmeConversationMessageLayout.messageAvatar,
  messageBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 },
  messageBodyMe: { alignItems: 'flex-end' },
  sender: { color: colors.text, fontSize: 12, fontWeight: 600 },
  bubble: arkmeConversationMessageLayout.bubble,
  bubbleMe: arkmeConversationMessageLayout.bubbleMe,
  bubbleArko: arkmeConversationMessageLayout.bubbleOther,
  bubbleError: { background: arkmeTheme.dangerSoft, color: colors.danger },
  detailAuthor: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 },
  detailAuthorContent: { flex: 1, minWidth: 0 },
  detailName: { overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 },
  detailMeta: { color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  detailText: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.62 },
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px' },
  reasoning: {
    margin: '8px 0 0', paddingTop: 8, borderTop: `1px solid ${colors.border}`,
    color: colors.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: '20px',
  },
  thinking: {
    width: 'min(440px, 100%)', padding: 10, boxSizing: 'border-box', borderRadius: 12,
    background: arkmeTheme.input, border: `1px solid ${colors.border}`,
  },
  thinkingHeader: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 0,
    background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', textAlign: 'left',
  },
  thinkingTitle: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px' },
  thinkingDuration: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  thinkingDetail: {
    margin: '8px 0 0', color: colors.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontSize: 13, lineHeight: '18px',
  },
  empty: { width: 'min(720px,100%)', margin: '28px auto', color: colors.secondary, textAlign: 'center', fontSize: 13 },
  historySentinel: { width: '100%', height: 1 },
  historyLoading: { width: 'min(780px,100%)', margin: '0 auto 12px', color: colors.secondary, textAlign: 'center', fontSize: 12 },
  error: { width: 'min(780px,100%)', margin: '0 auto 12px', padding: '10px 12px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  notice: { width: 'min(780px,100%)', margin: '0 auto 12px', padding: '10px 12px', borderRadius: 8, background: colors.active, color: arkmeTheme.accent, fontSize: 13 },
  feedbackRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retryButton: {
    flex: 'none', height: 30, padding: '0 10px', border: `1px solid ${colors.border}`, borderRadius: 7,
    background: arkmeTheme.elevated, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12,
  },
  divider: { alignSelf: 'center', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(23,25,28,.34))',
  },
  dialog: {
    width: 'min(680px, 100%)', maxHeight: 'min(720px, calc(100vh - 32px))', overflowY: 'auto',
    padding: 20, boxSizing: 'border-box', borderRadius: 8,
    background: arkmeTheme.layer2, color: colors.text,
    boxShadow: '0 18px 48px rgba(23,25,28,.18)',
  },
  dialogTitle: { margin: 0, fontSize: 22, lineHeight: '29px', fontWeight: 700 },
  dialogContent: { margin: '6px 0 18px', color: colors.secondary, fontSize: 14, lineHeight: '20px' },
  dialogActions: { marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 },
  dialogButton: {
    minWidth: 76, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8,
    background: arkmeTheme.elevated, color: colors.text, font: 'inherit', cursor: 'pointer',
  },
  dialogPrimary: { border: 0, background: arkmeTheme.info, color: arkmeTheme.foreground },
  composer: { ...arkmeConversationComposerLayout.composer, boxSizing: 'border-box' },
  composerInner: {
    ...arkmeConversationComposerLayout.composerInner,
    cursor: 'text', background: 'var(--arkme-primary-composer-idle, #f6f6f6)', boxShadow: 'none', transition: 'background-color 140ms ease',
  },
  textarea: {
    ...arkmeConversationComposerLayout.textarea,
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
  },
  tools: arkmeConversationComposerLayout.tools,
  hint: { color: colors.secondary, fontSize: 12, lineHeight: '18px', flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  modelTrigger: {
    display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '60%',
    padding: '4px 0', border: 0, borderRadius: 6,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 13, cursor: 'pointer',
  },
  modelLabel: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stop: { background: colors.danger },
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

export function arkoRunActivityLabel(status: string | undefined): string | undefined {
  if (status === 'accepted' || status === 'queued') return '正在思考'
  if (status === 'running' || status === 'stream_timeout') return tr("正在处理")
  if (status === 'waiting_tool') return '等待客户端操作'
  if (status === 'waiting_user') return '等待你的补充'
  if (status === 'partial') return '已部分完成'
  if (status === 'completed') return tr("已完成")
  if (status === 'cancelled') return '已停止'
  if (status === 'expired') return '任务已过期'
  if (status === 'failed') return tr("处理失败")
  return undefined
}

export function shouldShowArkoThinking(status: ArkoMessageStatus, reasoning?: string): boolean {
  return status === 'sending' || (reasoning !== undefined && reasoning.trim() !== '')
}

export function arkoPreservedScrollTop(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return Math.max(0, previousScrollTop + (nextScrollHeight - previousScrollHeight))
}

function isActiveRunStatus(status: string | undefined): boolean {
  return status !== undefined && ACTIVE_RUN_STATUSES.has(status)
}

function isActivityPlaceholderText(value: string): boolean {
  return /^(正在)?(思考|处理)(中)?[.。…]*$/.test(value.trim())
}

function isActiveHistoryRun(item: ArkmeArkoHistoryItem): boolean {
  const placeholder = isActivityPlaceholderText(item.text)
  return item.role === 'assistant' && (isActiveRunStatus(item.runStatus)
    || (item.runStatus === undefined && item.status === 2 && (item.text.trim() === '' || placeholder)))
}

export function arkoHistoryHasTerminalRun(
  items: ArkmeArkoHistoryItem[],
  sessionId: number,
  assistantMsgId: number,
  runUid: string,
): boolean {
  const matchingItem = items.find(item => item.role === 'assistant'
    && item.sessionId === sessionId
    && item.messageId === assistantMsgId
    && (item.runUid === undefined || item.runUid === runUid))
  return matchingItem !== undefined && !isActiveHistoryRun(matchingItem)
}

function waitForNextPoll(signal: AbortSignal, delayMillis = 1_200): Promise<void> {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, delayMillis)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
}

function ArkoThinkingPanel({ reasoning, activity }: { reasoning?: string; activity?: string }) {
  useArkmeLocale()
  const [expanded, setExpanded] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const active = activity === '正在思考' || activity === '正在处理'
  useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1_000)
    return () => { clearInterval(timer) }
  }, [active])
  const detail = reasoning?.trim() || (activity === '正在处理' ? '正在处理...' : '正在思考...')
  return <div style={styles.thinking}>
    <button data-arkme-feedback="neutral"
      type="button"
      style={styles.thinkingHeader}
      aria-expanded={expanded}
      onClick={() => { setExpanded(value => !value) }}
    >
      <span style={styles.thinkingTitle}>{tr("思考过程")}</span>
      {active && elapsedSeconds > 0 && <span style={styles.thinkingDuration}>{String(elapsedSeconds)}s</span>}
      <span aria-hidden>{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <p style={styles.thinkingDetail}>{detail}</p>}
  </div>
}

function historyMessage(item: ArkmeArkoHistoryItem): ArkoMessage {
  const placeholder = isActivityPlaceholderText(item.text)
  const reasoningPlaceholder = isActivityPlaceholderText(item.reasoning)
  const active = isActiveHistoryRun(item)
  return {
    id: `history:${String(item.messageId)}`,
    messageId: item.messageId,
    sessionId: item.sessionId,
    ...(item.localMarkRef === undefined ? {} : { localMarkRef: item.localMarkRef }),
    role: item.role,
    text: active && placeholder ? '' : item.text,
    ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks }),
    status: active ? 'sending' : item.runStatus === 'failed' || item.status === 3 || item.status === 5 ? 'error' : 'done',
    createdAtMillis: item.createdAtMillis,
    createdRecordUids: item.createdRecordUids,
    ...(item.sourceType === undefined ? {} : { sourceType: item.sourceType }),
    ...(item.orderAtMillis === undefined ? {} : { orderAtMillis: item.orderAtMillis }),
    ...(item.reasoning.trim() === '' || (!active && reasoningPlaceholder) ? {} : { reasoning: item.reasoning }),
    ...(item.role !== 'assistant' ? {} : { assistantMsgId: item.messageId }),
    ...(item.runUid === undefined ? {} : { runUid: item.runUid }),
    ...(item.runStatus === undefined ? {} : { runStatus: item.runStatus }),
    ...(item.messageActionRef === undefined ? {} : {
      messageActionRef: item.messageActionRef,
      ...(item.messageActionConversationRef === undefined ? {} : { messageActionConversationRef: item.messageActionConversationRef }),
      copyLinkAvailable: item.messageActionCapabilities?.copyLink === true,
      forwardAvailable: item.messageActionCapabilities?.forward === true,
    }),
  }
}

export function latestActiveRun(
  items: ArkmeArkoHistoryItem[],
  sessionId: number,
): ActiveArkoRun | undefined {
  const item = items
    .filter(candidate => candidate.sessionId === sessionId
      && candidate.role === 'assistant'
      && candidate.runUid !== undefined
      && isActiveRunStatus(candidate.runStatus))
    .sort((left, right) => right.createdAtMillis - left.createdAtMillis || right.messageId - left.messageId)[0]
  if (item?.runUid === undefined) return undefined
  return { sessionId: item.sessionId, assistantMsgId: item.messageId, runUid: item.runUid }
}

export function mergeHistory(current: ArkoMessage[], items: ArkmeArkoHistoryItem[]): ArkoMessage[] {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of items) byId.set(`history:${String(item.messageId)}`, historyMessage(item))
  return [...byId.values()].sort((left, right) => {
    const leftAt = left.orderAtMillis ?? left.createdAtMillis ?? Number.MAX_SAFE_INTEGER
    const rightAt = right.orderAtMillis ?? right.createdAtMillis ?? Number.MAX_SAFE_INTEGER
    if (leftAt !== rightAt) return leftAt - rightAt
    const leftId = left.messageId ?? Number.MAX_SAFE_INTEGER
    const rightId = right.messageId ?? Number.MAX_SAFE_INTEGER
    return leftId - rightId
  })
}

function resultText(result: ArkmeArkoAskResult): string {
  if (result.text.trim() !== '') return result.text.trim()
  if (result.errorMessage?.trim()) return result.errorMessage.trim()
  if (isActiveRunStatus(result.run?.status ?? result.status)) return ''
  return '任务已处理。'
}

function latestContinuation(messages: ArkoMessage[], sessionId: number | undefined): ArkoContinuationTarget | undefined {
  if (sessionId === undefined) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.role === 'divider') return undefined
    if (message.sessionId !== sessionId) continue
    if (message.role === 'user') return undefined
    if (message.runStatus !== 'waiting_user' || message.runUid === undefined || message.assistantMsgId === undefined) {
      return undefined
    }
    return { runUid: message.runUid, assistantMsgId: message.assistantMsgId }
  }
  return undefined
}

function selectedModelName(catalog: ArkmeArkoModelCatalog | undefined): string {
  if (catalog?.selectionSource === 'unavailable') return '原模型已下线，请重新选择'
  return catalog?.options.find(option => option.routeKey === catalog.effectiveRouteKey)?.displayName ?? '模型目录暂不可用'
}

function isImageTurnDraft(draft: ArkmeComposerDraftSnapshot, turn: ArkmeArkoPendingTurn): boolean {
  const images = turn.images
  return images !== undefined && images.length > 0
    && serializeArkmeComposerDraft(draft).text.trim() === turn.text
    && draft.attachments.length === images.length
    && draft.attachments.every((attachment, index) => attachment.localFile?.fileRef === images[index]!.fileRef)
}

export function ArkmeArkoSurface() {
  useArkmeLocale()
  const shellRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const followTailRef = useRef(true)
  const historyViewRef = useRef(false)
  const historySentinelRef = useRef<HTMLDivElement>(null)
  const historyLoadInFlightRef = useRef(false)
  const composerInputBoundaryRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<ArkmeDocumentComposerHandle>(null)
  const [composerInputFocused, setComposerInputFocused] = useState(false)
  const pendingComposerFocusRef = useRef(false)
  const shortcutFocusOriginRef = useRef<HTMLElement | null>(null)
  const sendInFlightRef = useRef(false)
  const authSnapshot = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  )
  const profileSnapshot = useSyncExternalStore(
    arkmeArkoProfileStore.subscribe,
    arkmeArkoProfileStore.getSnapshot,
    arkmeArkoProfileStore.getSnapshot,
  )
  const profileUserId = authSnapshot.auth?.status === 'authenticated' ? authSnapshot.auth.userId : undefined
  const composerDraftKey = arkmeArkoComposerDraftKey(profileUserId)
  useConversationDraftPresence(composerDraftKey)
  useSyncExternalStore(
    arkmeComposerDraftStore.subscribe,
    arkmeComposerDraftStore.getRevision,
    arkmeComposerDraftStore.getRevision,
  )
  const draftSnapshot = arkmeComposerDraftStore.get(composerDraftKey)
  const draft = draftSnapshot.text
  const accountKey = authSnapshot.auth?.status === 'authenticated' && profileUserId !== undefined
    ? `${authSnapshot.auth.environment}:${String(profileUserId)}` : undefined
  const profile = profileSnapshot.userId === profileUserId ? profileSnapshot.profile : undefined
  const [userProfile, setUserProfile] = useState<ArkmeUserProfile | null>(null)
  const [session, setSession] = useState<ArkmeArkoSession>()
  useSyncExternalStore(arkoModelCache.subscribe, arkoModelCache.getRevision, arkoModelCache.getRevision)
  const catalog = arkoModelCache.get(accountKey)
  useEffect(() => {
    if (accountKey === undefined) return
    let active = true
    setModelError('')
    void arkoModelCache.load(accountKey, () => callArkme<ArkmeArkoModelCatalog>('arko.models')).catch(caught => {
      if (active && arkoModelCache.get(accountKey) === undefined) setModelError(errorMessage(caught))
    })
    return () => { active = false }
  }, [accountKey])
  const [messages, setMessages] = useState<ArkoMessage[]>([])
  const [historyWindow, setHistoryWindow] = useState<ArkmeArkoContextWindow>()
  const [windowLoading, setWindowLoading] = useState(false)
  const [windowError, setWindowError] = useState<{ direction: 'asc' | 'desc'; message: string }>()
  const windowController = useRef<AbortController>()
  const historyController = useRef<AbortController>()
  const cancelWindowRead = useCallback(() => {
    windowController.current?.abort()
    setWindowLoading(false)
    setWindowError(undefined)
  }, [])
  useEffect(() => () => { windowController.current?.abort(); historyController.current?.abort() }, [accountKey])
  historyViewRef.current = historyWindow !== undefined
  const visibleMessages = useMemo(() => historyWindow === undefined ? messages : mergeHistory([], historyWindow.items), [messages, historyWindow])
  const [locationTarget, setLocationTarget] = useState<number>()
  useLayoutEffect(() => {
    if (locationTarget === undefined) return
    const element = bodyRef.current?.querySelector<HTMLElement>(`[data-arko-selection-key="history:${locationTarget}"]`)
    element?.scrollIntoView?.({ block: 'center' })
  }, [locationTarget, historyWindow])
  useEffect(() => { setHistoryWindow(undefined); setWindowError(undefined); setWindowLoading(false); setLocationTarget(undefined); followTailRef.current = true }, [accountKey])
  const [historyCursor, setHistoryCursor] = useState<string>()
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const selectingModel = arkoModelCache.isSelecting(accountKey)
  const [cancelling, setCancelling] = useState(false)
  const [modelAnchor, setModelAnchor] = useState<HTMLButtonElement | null>(null)
  const modelDialogOpen = modelAnchor !== null
  const [modelError, setModelError] = useState('')
  const closeModelMenu = useCallback(() => setModelAnchor(null), [])
  const toggleModelMenu = (anchor: HTMLButtonElement) => {
    setModelError('')
    setModelAnchor(current => current === anchor ? null : anchor)
  }
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const imageDraft = useArkoImageDraft(profileUserId, composerDraftKey, setError)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const hasDraftContent = draft.trim() !== '' || draftSnapshot.attachments.length > 0
  useEffect(() => { setAddMenuOpen(false) }, [accountKey])
  const [notice, setNotice] = useState('')
  const [activeRun, setActiveRun] = useState<ActiveArkoRun>()
  const [pendingTurn, setPendingTurn] = useState<ArkmeArkoPendingTurn>()
  // The pending message owns the visible send. Keep the editor document mounted
  // and unchanged so failure recovery preserves its undo/redo history.
  const imageDraftSending = sending && pendingTurn?.userId === profileUserId
    && pendingTurn !== undefined && isImageTurnDraft(draftSnapshot, pendingTurn)
  const detailTriggerRef = useRef<HTMLElement | null>(null)
  const detailBodyRef = useRef<HTMLDivElement>(null)
  const detailScope = `${authSnapshot.auth?.environment ?? ''}:${String(profileUserId)}:${String(session?.sessionId)}`
  const [linkedRecord, setLinkedRecord] = useState<{ uid: string; value?: ArkmeTimelineItem; error?: string }>()
  const [linkedOriginal, setLinkedOriginal] = useState(false)
  const linkedController = useRef<AbortController>()
  useEffect(() => { setLinkedRecord(undefined); return () => linkedController.current?.abort() }, [accountKey])
  const openLinkedRecord = async (uid: string) => {
    cancelWindowRead()
    linkedController.current?.abort(); const controller = new AbortController(); linkedController.current = controller
    setLinkedRecord({ uid }); setLinkedOriginal(false); setDetailSelection(undefined)
    try {
      const value = await callArkme<ArkmeTimelineItem>('record.app.detail', { recordUid: uid }, controller.signal)
      if (!controller.signal.aborted) setLinkedRecord({ uid, value })
    } catch (caught) { if (!controller.signal.aborted) setLinkedRecord({ uid, error: errorMessage(caught) }) }
  }
  const closeLinkedRecord = () => { linkedController.current?.abort(); setLinkedRecord(undefined) }
  const [detailSelection, setDetailSelection] = useState<{ scope: string; id: string }>()
  const detailMessage = detailSelection?.scope === detailScope
    ? visibleMessages.find(message => message.id === detailSelection.id && message.role !== 'divider')
    : undefined
  const detailActivity = detailMessage?.status === 'sending'
    ? arkoRunActivityLabel(detailMessage.runStatus) ?? '等待回复'
    : detailMessage?.status === 'error'
      ? pendingTurn?.localAssistantMessageId === detailMessage.id ? '发送结果待确认' : '消息处理失败'
      : undefined
  useEffect(() => { setDetailSelection(undefined) }, [detailScope])
  const openMessageDetail = (id: string, trigger: HTMLElement) => {
    cancelWindowRead()
    followTailRef.current = false
    detailTriggerRef.current = trigger
    if (detailBodyRef.current !== null) detailBodyRef.current.scrollTop = 0
    trigger.focus({ preventScroll: true })
    setDetailSelection({ scope: detailScope, id })
  }
  const messageActionItems = useMemo<ArkmeMessageActionViewItem[]>(() => visibleMessages.flatMap(message => (
    message.role === 'divider' || ((!message.messageActionRef || !message.messageActionConversationRef) && !(message.role === 'user' && message.status === 'done' && (message.messageId ?? 0) > 0 && (message.sessionId ?? 0) > 0))
      ? []
      : [{
        id: message.id,
        actionRef: message.messageActionRef ?? '',
        conversationRef: message.messageActionConversationRef ?? `arko:${message.sessionId}`,
        ...(message.role === 'user' && message.status === 'done' && (message.messageId ?? 0) > 0 && (message.sessionId ?? 0) > 0 ? { worldOrigin: { kind: 'arko' as const, sourceRef: `arko:${message.sessionId}`, itemUid: message.id, sessionId: message.sessionId!, messageId: message.messageId! } } : {}),
        copyText: arkmeEmojiPlainText(message.text),
        copyLinkAvailable: message.copyLinkAvailable === true,
        forwardAvailable: message.forwardAvailable === true,
      }]
  )), [visibleMessages])
  const messageSelectionItems = useMemo(() => visibleMessages.filter(message => message.role !== 'divider').map(message => ({ id: message.id, copyText: arkmeEmojiPlainText(message.text) })), [visibleMessages])
  const messageSelectionScope = profileUserId === undefined ? 'anonymous' : `user:${String(profileUserId)}:session:${String(session?.sessionId ?? 0)}`
  const deletionScope = `${accountKey}:${messageSelectionScope}`
  const [deletionRequest, setDeletionRequest] = useState<{ scope: string; ids: readonly string[] }>()
  const deletionCandidates = useMemo(() => new Set(visibleMessages.filter(message => message.role !== 'divider'
    // User history can retain its initial queued status after the assistant completes.
    && message.status !== 'sending' && (message.role !== 'assistant' || !isActiveRunStatus(message.runStatus))
    && !(activeRun && message.sessionId === activeRun.sessionId && message.runUid === activeRun.runUid)
    && message.id !== pendingTurn?.localUserMessageId && message.id !== pendingTurn?.localAssistantMessageId
    && (message.messageId ?? 0) > 0 && (message.sessionId ?? 0) > 0).map(message => message.id)), [visibleMessages, pendingTurn, activeRun])
  useEffect(() => { setDeletionRequest(undefined) }, [deletionScope])
  const markSourceRef = accountKey === undefined ? undefined : `arko:${accountKey}`
  const messageMarks = useMessageUnderlines(`${accountKey}:arko`, markSourceRef, profileUserId, arkoMessageMarkTransport)
  const messageActions = useArkmeMessageActions({
    scopeKey: messageSelectionScope,
    selectionItems: messageSelectionItems,
    items: messageActionItems,
    deleteSelection: {
      disabledReason: items => items.length > 100 ? tr('每次最多删除 100 条消息')
        : items.some(item => !deletionCandidates.has(item.id)) ? tr('所选消息仍在生成或发送结果待确认，请完成后再删除') : undefined,
      onRequest: items => setDeletionRequest({ scope: deletionScope, ids: items.map(item => item.id) }),
    },
  })

  useEffect(() => {
    if (deletionRequest && (!messageActions.selecting || deletionRequest.ids.some(id => !messageActions.selectedIds.has(id) || !deletionCandidates.has(id)))) {
      setDeletionRequest(undefined)
    }
  }, [deletionRequest, messageActions.selecting, messageActions.selectedIds, deletionCandidates])

  useEffect(() => {
    if (messageActions.selecting) setDetailSelection(undefined)
  }, [messageActions.selecting])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (!historyViewRef.current && followTailRef.current && bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }, [])

  useEffect(() => {
    arkmeArkoProfileStore.activateUser(profileUserId)
    arkmeArkoConversationPreviewStore.activateUser(profileUserId)
  }, [profileUserId])

  useEffect(() => {
    if (profileUserId === undefined) return
    arkmeArkoConversationPreviewStore.setLatestFromSurface(profileUserId, messages
      .filter(message => message.role !== 'divider')
      .map(message => ({
        key: message.id,
        text: message.text.trim() || (message.contentBlocks?.length ? '[图片]' : ''),
        ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
        ...(message.createdAtMillis === undefined ? {} : { createdAtMillis: message.createdAtMillis }),
      })))
  }, [messages, profileUserId])

  useEffect(() => {
    if (profileUserId === undefined) {
      setPendingTurn(undefined)
      return
    }
    let active=true
    void readArkoPendingTurn(profileUserId).then(restored=>{
    if (!active) return
    setPendingTurn(restored)
    if (restored === undefined) return
    setMessages(current => {
      if (current.some(item => item.id === restored.localAssistantMessageId)) return current
      return [...current, {
        id: restored.localUserMessageId,
        sessionId: restored.sessionId,
        role: 'user',
        text: restored.text,
        ...(restored.images === undefined ? {} : { contentBlocks: restored.images.map(localFileBlock) }),
        status: 'done',
        createdAtMillis: restored.createdAtMillis,
      }, {
        id: restored.localAssistantMessageId,
        sessionId: restored.sessionId,
        role: 'assistant',
        text: '',
        status: 'error',
        createdAtMillis: restored.createdAtMillis + 1,
      }]
    })
    scrollToBottom()
    }).catch(caught=>{if(active)setError(errorMessage(caught))})
    return ()=>{active=false}
  }, [profileUserId, scrollToBottom])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setHistoryError('')
    void Promise.allSettled([
      callArkme<ArkmeArkoSession>('arko.session', undefined, controller.signal),
      callArkme<ArkmeArkoProfile>('arko.profile', undefined, controller.signal),
      readLatestArkoMessages(controller.signal),
      callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal).then(async snapshot => (
        snapshot.profile === null
          ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
          : snapshot
      )),
    ]).then(([sessionResult, profileResult, historyResult, userProfileResult]) => {
      if (controller.signal.aborted) return
      if (sessionResult.status === 'rejected') {
        setError(errorMessage(sessionResult.reason))
        return
      }
      setSession(sessionResult.value)
      if (profileResult.status === 'fulfilled' && profileUserId !== undefined) {
        arkmeArkoProfileStore.setProfile(profileUserId, profileResult.value)
      }
      if (userProfileResult.status === 'fulfilled') setUserProfile(userProfileResult.value.profile)
      if (historyResult.status === 'fulfilled') {
        setMessages(current => mergeHistory(current, historyResult.value.items))
        setHistoryCursor(historyResult.value.nextCursor)
        scrollToBottom()
        const restoredRun = latestActiveRun(historyResult.value.items, sessionResult.value.sessionId)
        if (restoredRun !== undefined) {
          setActiveRun(restoredRun)
          setSending(true)
        }
      } else {
        setHistoryError(tr("加载 Arko 对话记录失败：{v0}", { v0: errorMessage(historyResult.reason) }))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => { controller.abort() }
  }, [profileUserId, scrollToBottom])

  useEffect(() => {
    if (activeRun === undefined) return
    const controller = new AbortController()
    let consecutiveFailures = 0
    const finishRun = async (knownHistory?: ArkmeArkoMessagePage): Promise<void> => {
      const [historyResult, profileResult] = await Promise.allSettled([
        knownHistory === undefined
          ? readLatestArkoMessages(controller.signal)
          : Promise.resolve(knownHistory),
        callArkme<ArkmeArkoProfile>('arko.profile', undefined, controller.signal),
      ])
      if (controller.signal.aborted) return
      if (historyResult.status === 'fulfilled') {
        setMessages(current => mergeHistory(current, historyResult.value.items))
        setHistoryCursor(historyResult.value.nextCursor)
        setHistoryError('')
        scrollToBottom()
      } else {
        setHistoryError(tr("刷新 Arko 对话记录失败：{v0}", { v0: errorMessage(historyResult.reason) }))
      }
      if (profileResult.status === 'fulfilled' && profileUserId !== undefined) {
        arkmeArkoProfileStore.setProfile(profileUserId, profileResult.value)
      }
      setActiveRun(current => current?.runUid === activeRun.runUid ? undefined : current)
      setSending(false)
    }
    const poll = async (): Promise<void> => {
      await waitForNextPoll(controller.signal)
      while (!controller.signal.aborted) {
        try {
          const status = await callArkme<ArkmeArkoRunStatus>('arko.run.status', {
            sessionId: activeRun.sessionId,
            runUid: activeRun.runUid,
          }, controller.signal)
          if (controller.signal.aborted) return
          consecutiveFailures = 0
          if (status.status === 'waiting_tool') {
            setNotice('当前任务需要 DSH 尚未支持的客户端操作，可以停止任务后换一种方式重试')
          }
          setMessages(current => current.map(item => item.assistantMsgId === activeRun.assistantMsgId ? {
            ...item,
            runStatus: status.status,
            status: isActiveRunStatus(status.status) ? 'sending' : status.status === 'failed' ? 'error' : 'done',
          } : item))
          if (!isActiveRunStatus(status.status)) {
            await finishRun()
            return
          }
        } catch {
          if (controller.signal.aborted) return
          consecutiveFailures += 1
          try {
            const history = await readLatestArkoMessages(controller.signal)
            if (controller.signal.aborted) return
            if (arkoHistoryHasTerminalRun(
              history.items,
              activeRun.sessionId,
              activeRun.assistantMsgId,
              activeRun.runUid,
            )) {
              await finishRun(history)
              return
            }
          } catch {
            if (controller.signal.aborted) return
          }
        }
        const retryDelay = consecutiveFailures === 0
          ? 1_200
          : Math.min(10_000, 1_200 * (2 ** Math.min(consecutiveFailures - 1, 3)))
        await waitForNextPoll(controller.signal, retryDelay)
      }
    }
    void poll()
    return () => { controller.abort() }
  }, [activeRun, profileUserId, scrollToBottom])

  const loadEarlier = useCallback(async () => {
    if (historyCursor === undefined || historyLoadInFlightRef.current) return
    const body = bodyRef.current
    const previousScrollHeight = body?.scrollHeight ?? 0
    const previousScrollTop = body?.scrollTop ?? 0
    historyLoadInFlightRef.current = true
    setHistoryLoading(true)
    const controller = new AbortController(); historyController.current = controller
    try {
      const page = await callArkme<ArkmeArkoMessagePage>('arko.messages', { limit: 50, cursor: historyCursor }, controller.signal)
      if (controller.signal.aborted) return
      setMessages(current => mergeHistory(current, page.items))
      setHistoryCursor(page.nextCursor)
      setHistoryError('')
      requestAnimationFrame(() => {
        const target = bodyRef.current
        if (target === null || historyViewRef.current) return
        target.scrollTop = arkoPreservedScrollTop(
          previousScrollTop,
          previousScrollHeight,
          target.scrollHeight,
        )
      })
    } catch (caught) {
      if (controller.signal.aborted) return
      setHistoryError(tr("加载更早的 Arko 对话记录失败：{v0}", { v0: errorMessage(caught) }))
    } finally {
      historyLoadInFlightRef.current = false
      setHistoryLoading(false)
    }
  }, [historyCursor])

  useEffect(() => {
    const root = bodyRef.current
    const sentinel = historySentinelRef.current
    if (historyWindow !== undefined || loading || historyLoading || historyError !== '' || root === null || sentinel === null || historyCursor === undefined) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true || historyLoadInFlightRef.current) return
      void loadEarlier()
    }, { root, rootMargin: '120px 0px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [historyError, historyLoading, historyCursor, loadEarlier, loading, historyWindow])

  const pageWindow = async (direction: 'asc' | 'desc') => {
    const current = historyWindow
    const cursor = direction === 'desc' ? current?.beforeCursor : current?.afterCursor
    if (!current || !cursor || windowLoading) return
    windowController.current?.abort()
    const controller = new AbortController(); windowController.current = controller
    setWindowLoading(true); setWindowError(undefined)
    try {
      const page = await callArkme<ArkmeArkoMessagePage>('arko.messages', { cursor, direction, limit: 50 }, controller.signal)
      if (controller.signal.aborted) return
      const items = page.items.length ? page.items : current.items
      const next: ArkmeArkoContextWindow = { ...current, items, hasBefore: direction === 'desc' ? page.hasMore : page.items.length > 0 || current.hasBefore, hasAfter: direction === 'asc' ? page.hasMore : page.items.length > 0 || current.hasAfter }
      if (direction === 'desc') {
        if (page.nextCursor) next.beforeCursor = page.nextCursor; else delete next.beforeCursor
        if (page.afterCursor) next.afterCursor = page.afterCursor
      } else {
        if (page.nextCursor) next.afterCursor = page.nextCursor; else delete next.afterCursor
        if (page.beforeCursor) next.beforeCursor = page.beforeCursor
      }
      setHistoryWindow(next)
      setLocationTarget(undefined)
      if (bodyRef.current) bodyRef.current.scrollTop = 0
    } catch (caught) { if (!controller.signal.aborted) setWindowError({ direction, message: errorMessage(caught) }) }
    finally { if (!controller.signal.aborted) setWindowLoading(false) }
  }

  const retryHistory = useCallback(async () => {
    if (historyLoading) return
    setHistoryLoading(true)
    setHistoryError('')
    const controller = new AbortController(); historyController.current = controller
    try {
      const page = await readLatestArkoMessages(controller.signal)
      if (controller.signal.aborted) return
      setMessages(current => mergeHistory(current, page.items))
      setHistoryCursor(page.nextCursor)
      scrollToBottom()
      if (session !== undefined) {
        const restoredRun = latestActiveRun(page.items, session.sessionId)
        if (restoredRun !== undefined) {
          setActiveRun(restoredRun)
          setSending(true)
        }
      }
    } catch (caught) {
      setHistoryError(tr("加载 Arko 对话记录失败：{v0}", { v0: errorMessage(caught) }))
    } finally {
      setHistoryLoading(false)
    }
  }, [historyLoading, scrollToBottom, session])

  const submitTurn = useCallback(async (turn: ArkmeArkoPendingTurn) => {
    if (sending || activeRun !== undefined) return
    let handedOffToPolling = false
    setSending(true)
    setError('')
    setNotice('')
    const stillCurrent = () => {
      const auth = arkmeAuthStore.getSnapshot().auth
      return auth?.status === 'authenticated' && auth.userId === turn.userId
        && `${auth.environment}:${auth.userId}` === accountKey
    }
    setMessages(current => current.map(item => item.id === turn.localAssistantMessageId
      ? { ...item, text: '', status: 'sending', runStatus: 'accepted' }
      : item))
    try {
      const result = await callArkme<ArkmeArkoAskResult>('arko.ask', {
        text: turn.text,
        sessionId: turn.sessionId,
        clientTurnUid: turn.clientTurnUid,
        waitSeconds: 1,
        expectedUserId: turn.userId,
        ...(turn.images === undefined ? {} : { imageFileRefs: turn.images.map(file => file.fileRef) }),
        ...(turn.modelRouteKey === undefined ? {} : { modelRouteKey: turn.modelRouteKey }),
        ...(turn.replyToRunUid === undefined ? {} : { replyToRunUid: turn.replyToRunUid }),
        ...(turn.replyToAssistantMsgId === undefined ? {} : { replyToAssistantMsgId: turn.replyToAssistantMsgId }),
      })
      if (!stillCurrent()) return
      if (turn.images?.length) {
        const key = arkmeArkoComposerDraftKey(turn.userId)
        const current = arkmeComposerDraftStore.get(key)
        if (isImageTurnDraft(current, turn)) {
          arkmeComposerDraftStore.clear(key)
        }
      }
      setPendingTurn(current => current?.clientTurnUid === turn.clientTurnUid ? undefined : current)
      setSession(current => current === undefined ? current : { ...current, sessionId: result.sessionId })
      if (result.profile !== undefined && profileUserId !== undefined) {
        arkmeArkoProfileStore.setProfile(profileUserId, result.profile)
      }
      const runStatus = result.run?.status ?? result.status
      const runActive = isActiveRunStatus(runStatus)
      const hasVisibleReasoning = result.reasoning.trim() !== ''
        && (runActive || !isActivityPlaceholderText(result.reasoning))
      setMessages(current => mergeHistory(current.map(item => item.id === turn.localUserMessageId ? {
        ...item,
        id: `history:${String(result.userMsgId)}`,
        messageId: result.userMsgId,
        sessionId: result.sessionId,
      } : item.id === turn.localAssistantMessageId ? {
        id: `history:${String(result.assistantMsgId)}`,
        messageId: result.assistantMsgId,
        sessionId: result.sessionId,
        role: 'assistant',
        text: resultText(result),
        status: runActive ? 'sending' : result.errorMessage === undefined ? 'done' : 'error',
        assistantMsgId: result.assistantMsgId,
        ...(item.createdAtMillis === undefined ? {} : { createdAtMillis: item.createdAtMillis }),
        ...(hasVisibleReasoning ? { reasoning: result.reasoning } : {}),
        ...(result.runUid === undefined ? {} : { runUid: result.runUid }),
        runStatus,
      } : item), []))
      setDetailSelection(current => {
        if (current?.scope !== detailScope) return current
        if (current.id === turn.localUserMessageId) return { ...current, id: `history:${String(result.userMsgId)}` }
        if (current.id === turn.localAssistantMessageId) return { ...current, id: `history:${String(result.assistantMsgId)}` }
        return current
      })
      if (runActive && result.runUid !== undefined) {
        handedOffToPolling = true
        setActiveRun({
          sessionId: result.sessionId,
          assistantMsgId: result.assistantMsgId,
          runUid: result.runUid,
        })
      } else if (!runActive) {
        // Synchronous replies never enter finishRun. Acquire the same authoritative
        // history references without blocking the composer or moving the viewport.
        void callArkme<ArkmeArkoMessagePage>('arko.messages', { limit: 50 }).then(page => {
          if (!stillCurrent()) return
          const completed = new Map(page.items.filter(item => item.sessionId === result.sessionId
            && [result.userMsgId, result.assistantMsgId].includes(item.messageId))
            .map(item => [`history:${item.messageId}`, historyMessage(item)]))
          setMessages(current => current.map(item => completed.get(item.id) ?? item))
        }).catch(caught => {
          if (stillCurrent()) setHistoryError(tr("加载 Arko 对话记录失败：{v0}", { v0: errorMessage(caught) }))
        })
      }
    } catch (caught) {
      if (!stillCurrent()) return
      const message = errorMessage(caught)
      const retryable = !(caught instanceof ArkmeClientError) || caught.body.retryable
      if (retryable) {
        setPendingTurn(turn)
        await writeArkoPendingTurn(turn)
        setError(`Arko 发送结果暂未确认：${message}。请重试确认，系统会复用同一次请求，不会重复执行。`)
        setMessages(current => current.map(item => item.id === turn.localAssistantMessageId ? {
          ...item, role: 'assistant', text: '', status: 'error',
        } : item))
      } else {
        await removeArkoPendingTurn(turn.userId,turn.clientTurnUid)
        setPendingTurn(current => current?.clientTurnUid === turn.clientTurnUid ? undefined : current)
        setError(message)
        setMessages(current => turn.images?.length
          ? current.filter(item => item.id !== turn.localUserMessageId && item.id !== turn.localAssistantMessageId)
          : current.map(item => item.id === turn.localAssistantMessageId ? {
          ...item, role: 'assistant', text: message, status: 'error',
        } : item))
      }
    } finally {
      if (stillCurrent() && !handedOffToPolling) setSending(false)
    }
  }, [accountKey, activeRun, detailScope, profileUserId, sending])

  const interactionLocked = sending || pendingTurn !== undefined || activeRun !== undefined
  const sendDisabled = loading || interactionLocked || clearing || selectingModel || catalog?.selectionSource === 'unavailable'
    || imageDraft.preparing !== ''
    || session === undefined || profileUserId === undefined
  const inputDisabled = loading || interactionLocked || session === undefined || profileUserId === undefined

  const insertEmoji = useCallback((emoji: ArkmeEmoji): boolean => {
    if (inputDisabled || composerDraftKey === undefined) return false
    const result = textareaRef.current?.insertEmoji(emoji)
    if (result === 'length-limit') setError('内容长度已达上限，请删减后再添加表情')
    return result === 'inserted'
  }, [composerDraftKey, inputDisabled])

  const send = useCallback(async (presetText?: string, focusOrigin: HTMLElement | null = null) => {
    const currentDraft = arkmeComposerDraftStore.get(composerDraftKey)
    const text = (presetText ?? serializeArkmeComposerDraft(currentDraft).text).trim()
    const attachments = presetText === undefined ? currentDraft.attachments : []
    const images = attachments.flatMap(attachment => attachment.localFile ? [attachment.localFile] : [])
    if (arkmeAttachmentsPending(attachments) || (text === '' && attachments.length === 0) || sendInFlightRef.current || sendDisabled
      || session === undefined || profileUserId === undefined || composerDraftKey === undefined) return
    if (text.length > arkoQuestionMaxLength) {
      setError('内容长度超过上限，请删减后再发送')
      return
    }
    if (attachments.length !== images.length) { setError('图片草稿无效，请重新添加图片'); return }
    const imageError = latestContinuation(messages, session.sessionId) === undefined ? arkoImageInputError(catalog?.options.find(option => option.routeKey === catalog.effectiveRouteKey)?.imageInput, images) : undefined
    if (imageError !== undefined) { setError(imageError); return }

    sendInFlightRef.current = true
    cancelWindowRead()
    setHistoryWindow(undefined); setLocationTarget(undefined); historyViewRef.current = false; followTailRef.current = true
    try {
      const continuation = latestContinuation(messages, session.sessionId)
      const createdAtMillis = Date.now()
      const turn: ArkmeArkoPendingTurn = {
        userId: profileUserId,
        sessionId: session.sessionId,
        clientTurnUid: crypto.randomUUID(),
        text,
        ...(images.length ? { images } : {}),
        createdAtMillis,
        localUserMessageId: crypto.randomUUID(),
        localAssistantMessageId: crypto.randomUUID(),
        ...(continuation === undefined ? {
          ...(catalog === undefined ? {} : { modelRouteKey: catalog.effectiveRouteKey }),
        } : {
          replyToRunUid: continuation.runUid,
          replyToAssistantMsgId: continuation.assistantMsgId,
        }),
      }
      await writeArkoPendingTurn(turn)
      pendingComposerFocusRef.current = true
      shortcutFocusOriginRef.current = focusOrigin
      setPendingTurn(turn)
      if (presetText === undefined && images.length === 0) arkmeComposerDraftStore.clear(composerDraftKey)
      setMessages(current => [...current, {
        id: turn.localUserMessageId,
        sessionId: turn.sessionId,
        role: 'user',
        text,
        ...(images.length ? { contentBlocks: images.map(localFileBlock) } : {}),
        status: 'done',
        createdAtMillis,
      }, {
        id: turn.localAssistantMessageId,
        sessionId: turn.sessionId,
        role: 'assistant',
        text: '',
        status: 'sending',
        runStatus: 'accepted',
        createdAtMillis: createdAtMillis + 1,
      }])
      scrollToBottom()
      await submitTurn(turn)
    } finally {
      sendInFlightRef.current = false
    }
  }, [cancelWindowRead, catalog, composerDraftKey, messages, profileUserId, scrollToBottom, sendDisabled, session, submitTurn])

  const selectModel = useCallback(async (routeKey: string) => {
    if (selectingModel || accountKey === undefined) return false
    setModelError('')
    try {
      const next = await arkoModelCache.select(accountKey, () => callArkme<ArkmeArkoModelCatalog>('arko.model.activate', { routeKey }))
      setNotice(tr("已切换到 {v0}", { v0: selectedModelName(next) }))
      return true
    } catch (caught) {
      setModelError(errorMessage(caught))
      return false
    }
  }, [selectingModel, accountKey])

  const cancelActiveRun = useCallback(async () => {
    if (activeRun === undefined || cancelling) return
    setCancelling(true)
    setError('')
    try {
      await callArkme<ArkmeArkoCancelResult>('arko.cancel', {
        sessionId: activeRun.sessionId,
        assistantMsgId: activeRun.assistantMsgId,
        runUid: activeRun.runUid,
      })
      setNotice('已请求停止当前任务，正在确认最终状态')
    } catch (caught) {
      setError(tr("停止 Arko 任务失败：{v0}", { v0: errorMessage(caught) }))
    } finally {
      setCancelling(false)
    }
  }, [activeRun, cancelling])

  const clearContext = useCallback(async () => {
    if (sending || clearing || pendingTurn !== undefined) return
    setClearConfirmOpen(false)
    setClearing(true)
    setError('')
    setNotice('')
    try {
      const nextSession = await callArkme<ArkmeArkoSession>('arko.new-session')
      setSession(nextSession)
      setMessages(current => [...current, {
        id: crypto.randomUUID(), role: 'divider', text: '新的对话', status: 'done', createdAtMillis: Date.now(),
      }])
      scrollToBottom()
      setNotice('上下文已清除，历史记录仍然保留')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setClearing(false)
    }
  }, [clearing, pendingTurn, scrollToBottom, sending])

  const displayName = arkoPresentationName(profile)
  const composerPlaceholder = tr("问问 {v0}...", { v0: displayName })
  const selectedModel = catalog === undefined && modelError === '' ? tr('正在加载模型…') : selectedModelName(catalog)
  const canChooseModel = (catalog?.options.length ?? 0) > 0
  const continuation = useMemo(() => latestContinuation(messages, session?.sessionId), [messages, session?.sessionId])
  useEffect(() => {
    if (!pendingComposerFocusRef.current || loading || interactionLocked
      || session === undefined || profileUserId === undefined) return
    pendingComposerFocusRef.current = false
    const frame = requestAnimationFrame(() => {
      const activeElement = document.activeElement
      restoreArkmeComposerFocus(
        textareaRef.current,
        activeElement,
        document.body,
        activeElement !== null && (composerRef.current?.contains(activeElement) === true || activeElement === shortcutFocusOriginRef.current),
      )
      shortcutFocusOriginRef.current = null
    })
    return () => { cancelAnimationFrame(frame) }
  }, [interactionLocked, loading, profileUserId, session])
  const hint = loading
    ? '正在恢复会话'
    : clearing ? '正在清除上下文'
      : selectingModel ? '正在切换模型'
    : pendingTurn !== undefined && !sending
      ? '请先确认上一次发送结果'
      : sending
        ? pendingTurn?.images?.length ? '正在发送图片并等待回复' : '等待回复'
        : continuation === undefined ? '' : '继续当前任务'

  return <div ref={shellRef} style={styles.shell}>
    {messageMarks.layer}
    <ArkmeMessageTextSelectionToolbar key={accountKey ?? 'logged-out'} replySourceRef={markSourceRef} selfNote={{ sourceLabel: displayName || 'Arko', ...(accountKey ? { accountKey } : {}) }}
      markStorage="local" onUnderline={messageMarks.mark} getMarks={messageMarks.getMarks} onRemoveMark={messageMarks.remove} />
    <style>{`
      [data-arkme-arko-composer] .ProseMirror { min-height: 38px; }
      [data-arkme-arko-composer] [data-arkme-composer-editor-box] > span[aria-hidden] {
        top: 0; left: 0; right: 0;
      }
      [data-arko-located=true] .arkme-timed-bubble { outline: 2px solid ${arkmeTheme.accent}; outline-offset: 2px; }
    `}</style>
    <header data-arkme-window-drag-region="conversation" style={styles.header}>
      <span style={styles.headerAvatar}><ArkmeArkoAvatar size={34} /></span>
      <span data-arkme-window-drag-region="conversation" data-arkme-window-drag-copy="" style={styles.headerCopy}>
        <h2 style={styles.headerTitle}>{displayName}</h2>
        <span style={styles.aiDisclaimer}>{tr("Agent · 内容由 AI 生成，仅供参考")}</span>
      </span>
      <ArkmeArkoHistoryTools key={accountKey} accountScope={accountKey ?? ''} name={displayName} host={shellRef}
        detailOpen={detailMessage !== undefined || linkedRecord !== undefined}
        disabled={sendDisabled || messageActions.selecting} clearDisabled={messageActions.selecting || loading || interactionLocked || clearing || session === undefined}
        onClear={() => { cancelWindowRead(); setClearConfirmOpen(true) }} onCapabilities={trigger => { void send('你能帮我干什么', trigger) }}
        onOpenPanel={() => { cancelWindowRead(); closeLinkedRecord(); setDetailSelection(undefined); followTailRef.current = false }}
        getReadingDate={() => {
          const viewport = bodyRef.current, bounds = viewport?.getBoundingClientRect()
          const visible = bounds && Array.from(viewport!.querySelectorAll<HTMLElement>('[data-arko-at]')).find(node => node.getBoundingClientRect().bottom > bounds.top)
          return visible ? arkoHistoryDate(Number(visible.dataset.arkoOrderAt ?? visible.dataset.arkoAt)) || undefined : undefined
        }}
        onLocate={(window, item) => {
          cancelWindowRead()
          setDetailSelection(undefined); followTailRef.current = false
          setHistoryWindow(window); setLocationTarget(item.messageId)
        }} />
    </header>
    <ArkmeWideConversation enabled scopeKey={messageSelectionScope} viewportRef={bodyRef} turns controlsHidden={messageActions.selecting}>
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {historyWindow !== undefined && <div role="navigation" aria-label={tr('Arko 历史定位')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 22px', fontSize: 12, color: colors.secondary }}>
      <span>{tr('历史消息')} · {historyWindow.items.length}</span>
      <button type="button" style={styles.retryButton} disabled={windowLoading || !historyWindow.hasBefore} onClick={() => { void pageWindow('desc') }}>{tr('更早')}</button>
      <button type="button" style={styles.retryButton} disabled={windowLoading || !historyWindow.hasAfter} onClick={() => { void pageWindow('asc') }}>{tr('更晚')}</button>
      {windowLoading && <span role="status">{tr('正在读取…')}</span>}
      {windowError && <span role="alert">{windowError.message}<button type="button" style={styles.retryButton} disabled={windowLoading} onClick={() => { void pageWindow(windowError.direction) }}>{tr('重试历史读取')}</button></span>}
      {historyWindow.items.some(item => item.orderAtMillis && arkoHistoryDate(item.orderAtMillis) !== arkoHistoryDate(item.createdAtMillis)) && <span>{tr('日历按历史排序日期定位，消息保留原显示时间')}</span>}
      <button type="button" style={{ ...styles.retryButton, marginLeft: 'auto' }} onClick={() => { cancelWindowRead(); setHistoryWindow(undefined); setLocationTarget(undefined); historyViewRef.current = false; followTailRef.current = true; scrollToBottom() }}>{tr('返回最新消息')}</button>
    </div>}
    <div ref={bodyRef} data-arkme-width-viewport data-arko-message-viewport style={styles.body}
      onScroll={event => { const node = event.currentTarget; followTailRef.current = !historyViewRef.current && node.scrollHeight - node.clientHeight - node.scrollTop < 80 }}>
      {notice !== '' && <div style={styles.notice}>{notice}</div>}
      {error !== '' && <div style={styles.error}>{error}</div>}
      {historyWindow === undefined && historyError !== '' && <div style={{ ...styles.error, ...styles.feedbackRow }}>
        <span>{historyError}</span>
        <button data-arkme-feedback="neutral" type="button" style={styles.retryButton} disabled={historyLoading} onClick={() => {
          if (historyCursor === undefined) void retryHistory()
          else void loadEarlier()
        }}>
          {historyLoading ? tr("加载中...") : tr("重新加载")}
        </button>
      </div>}
      {pendingTurn !== undefined && !sending && activeRun === undefined && <div style={{ ...styles.notice, ...styles.feedbackRow }}>
        <span>{tr("上一次发送结果尚未确认，请先用原请求标识完成对账。")}</span>
        <button data-arkme-feedback="neutral" type="button" style={styles.retryButton} onClick={() => { void submitTurn(pendingTurn) }}>{tr("重试确认")}</button>
      </div>}
      {historyWindow === undefined && <div ref={historySentinelRef} style={styles.historySentinel} />}
      {historyWindow === undefined && historyLoading && <div style={styles.historyLoading} role="status">{tr("正在加载更早内容…")}</div>}
      {!loading && historyError === '' && visibleMessages.length === 0 && <div style={styles.empty}>{tr("暂无对话记录")}</div>}
      {visibleMessages.length > 0 && <ul style={styles.records} data-arkme-message-selection-scope data-arkme-message-selecting={messageActions.selecting}>
        {visibleMessages.map((item, index) => {
          const previous = visibleMessages[index - 1]
          const startsDay = item.role !== 'divider' && item.createdAtMillis !== undefined && arkoHistoryDate(item.createdAtMillis) !== '' && (previous?.createdAtMillis === undefined || dayKey(previous.createdAtMillis) !== dayKey(item.createdAtMillis))
          const activity = arkoRunActivityLabel(item.runStatus)
          const showThinking = item.role === 'assistant'
            && shouldShowArkoThinking(item.status, item.reasoning)
          const actionItem = messageActionItems.find(candidate => candidate.id === item.id)
          const selectedForAction = messageActions.selectedIds.has(item.id)
          return <Fragment key={item.id}>
          {startsDay && <li style={arkmeConversationMessageLayout.date}><ArkmeConversationDate at={item.createdAtMillis!} /></li>}
          {item.role === 'divider' ? <li data-arkme-width-anchor={item.id} data-arkme-width-role="divider" style={{ ...styles.row, justifyContent: 'center' }}>
            <span style={styles.divider}>{item.text}</span>
          </li> : <li
            data-arkme-width-anchor={item.id}
            data-arkme-width-role={item.role}
            data-arkme-width-preview={item.text.slice(0, 320)}
            data-arkme-width-avatar={item.role === 'user' ? userProfile?.avatarRef : undefined}
            data-arkme-width-sender={item.role === 'user' ? userProfile?.displayName || userProfile?.nickname || '我' : displayName}
            data-arkme-width-sender-kind={item.role === 'user' ? 'human' : 'arko'}
            data-arko-selection-key={item.id}
            data-arko-at={item.createdAtMillis} data-arko-order-at={item.orderAtMillis}
            data-arko-located={locationTarget !== undefined && locationTarget === item.messageId ? 'true' : undefined}
            style={{ ...styles.row, ...(item.role === 'user' ? styles.rowMe : styles.rowArko), ...(messageActions.selecting ? { ...messageSelectionStyles.rowSelectAvatarMode, marginBottom: 23 } : {}), ...(selectedForAction ? messageSelectionStyles.rowSelectedForAction : {}) }}
            onClick={event => {
              if (!messageActions.selecting) return
              if (event.target instanceof Element && event.target.closest('button,a,input,textarea,[role=link]')) return
              messageActions.toggle({ id: item.id, copyText: item.text })
            }}
          >
              {messageActions.selecting && <ArkmeMessageSelectionControl anchor="avatar"
                checked={selectedForAction}
                disabled={!messageActions.canSelectMany}
                onToggle={() => { messageActions.toggle({ id: item.id, copyText: item.text }) }}
              />}
            <div style={{ ...styles.line, ...(item.role === 'user' ? styles.lineMe : {}), ...(messageActions.selecting ? { minWidth: 0, marginBottom: 0 } : {}) }}>
              <span style={styles.avatar} aria-hidden>{item.role === 'user'
                ? <ArkmeUserAvatar
                  {...(userProfile?.avatarRef === undefined ? {} : { avatarRef: userProfile.avatarRef })}
                  size={34}
                />
                : <ArkmeArkoAvatar size={34} />}</span>
              <div style={{ ...styles.messageBody, ...(item.role === 'user' ? styles.messageBodyMe : {}) }}>
                {item.role === 'assistant' && <span style={styles.sender}>{displayName}</span>}
                {showThinking && <ArkoThinkingPanel
                  {...(item.reasoning === undefined ? {} : { reasoning: item.reasoning })}
                  {...(activity === undefined ? {} : { activity })}
                />}
                {(item.text.trim() !== '' || (item.contentBlocks?.length ?? 0) > 0 || item.status === 'error') && <div
                  className="arkme-timed-bubble"
                  role="button"
                  tabIndex={messageActions.selecting ? -1 : 0}
                  aria-description={item.role === 'user' ? '查看提问详情' : '查看回复详情'}
                  ref={detailMessage?.id === item.id ? node => {
                    if (node !== null) detailTriggerRef.current = node
                  } : undefined}
                  aria-haspopup="dialog"
                  onClick={event => {
                    if (messageActions.selecting || event.defaultPrevented) return
                    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return
                    if (event.target.closest('a,button,input,textarea,select,audio,video,[contenteditable],[role=link],[role=slider]')) return
                    if (window.getSelection()?.toString()) return
                    openMessageDetail(item.id, event.currentTarget)
                  }}
                  onKeyDown={event => {
                    if (messageActions.selecting || event.target !== event.currentTarget || event.repeat
                      || (event.key !== 'Enter' && event.key !== ' ')) return
                    event.preventDefault()
                    openMessageDetail(item.id, event.currentTarget)
                  }}
                  onContextMenu={event => { if (actionItem !== undefined) messageActions.openMenu(actionItem, event) }}
                  style={{
                  ...styles.bubble, cursor: messageActions.selecting ? undefined : 'pointer',
                  ...(item.role === 'user' ? styles.bubbleMe : styles.bubbleArko),
                  ...(item.status === 'error' ? styles.bubbleError : {}),
                }}>
                  <ArkoMessageImages {...(item.contentBlocks === undefined ? {} : { blocks: item.contentBlocks })} />
                  {item.text !== '' && <ArkmeSelectableMessageText text={item.text} target={messageActions.selecting ? undefined : arkoMessageMarkTarget(item, markSourceRef)} style={{ minWidth: 0, maxWidth: '100%' }}>
                    {item.role === 'assistant' ? <div data-arkme-message-text-flow="true"><ArkmeMarkdownBody text={item.text} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.62 }} /></div>
                      : <p data-arkme-plain-text style={styles.text}><ArkmeRichText text={item.text} linkLabelMode="raw" highlightMentions={false} /></p>}
                  </ArkmeSelectableMessageText>}
                  {item.createdAtMillis !== undefined && <ArkmeMessageTimestamp at={item.createdAtMillis} />}
                </div>}
              </div>
            </div>
          </li>}
        </Fragment>})}
      </ul>}
    </div>

    <RegionMarquee getStartArea={() => composerRef.current && composerInputBoundaryRef.current
      ? { element: composerRef.current, boundary: composerInputBoundaryRef.current } : undefined} viewportRef={bodyRef} scopeKey={messageSelectionScope}
      enabled={detailMessage === undefined && !loading && !clearing && !modelDialogOpen && !clearConfirmOpen && messageActions.canSelectMany}
      getItems={() => [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-arko-selection-key]') ?? [])].map(element => ({ key: element.dataset.arkoSelectionKey!, element }))}
      onCommit={messageActions.selectMany}
      style={{ border: `1px solid ${arkmeTheme.accent}`, background: `color-mix(in srgb, ${arkmeTheme.accent} 16%, transparent)` }}
    />
    </div>
    {!messageActions.selecting && detailMessage !== undefined && <ArkmeDetailShell
      returnFocusRef={detailTriggerRef}
      bodyRef={detailBodyRef}
      title={tr("消息详情")}
      label={tr("消息详情")}
      resizeLabel="调整消息详情宽度"
      onClose={() => { setDetailSelection(undefined) }}
      onPointerDownOutside={event => {
        const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement
        // Portalled selection tools and foreground overlays own their interaction.
        if (target?.closest('[data-arkme-text-selection-toolbar], [role="menu"], [aria-modal="true"], [data-arkme-image-preview-viewport]')) return
        setDetailSelection(undefined)
      }}
      style={{ top: 0 }}
      headerContent={<div style={styles.detailAuthor} data-arkme-detail-author>
        {detailMessage.role === 'user'
          ? <ArkmeUserAvatar {...(userProfile?.avatarRef === undefined ? {} : { avatarRef: userProfile.avatarRef })} size={40} label={tr("作者头像")} />
          : <ArkmeArkoAvatar size={40} />}
        <div style={styles.detailAuthorContent}>
          <div style={styles.detailName}>{detailMessage.role === 'user' ? tr("我") : displayName}</div>
          {detailMessage.createdAtMillis !== undefined && detailMessage.createdAtMillis > 0
            && Number.isFinite(detailMessage.createdAtMillis) && detailMessage.createdAtMillis < 8.64e15 && <div style={{ ...styles.detailMeta, marginTop: 4 }}>
              {new Date(detailMessage.createdAtMillis).toLocaleString(arkmeIntlLocale())}
            </div>}
        </div>
      </div>}
    >
      {detailMessage.sourceType !== undefined && <p style={styles.detailMeta}>{tr('来源')}：{detailMessage.sourceType === 1 ? tr('历史助手') : 'Agent'}</p>}
      {detailMessage.orderAtMillis !== undefined && detailMessage.orderAtMillis !== detailMessage.createdAtMillis && <p style={styles.detailMeta}>{tr('日历定位时间')}：{new Date(detailMessage.orderAtMillis).toLocaleString(arkmeIntlLocale())}</p>}
      <ArkoMessageImages {...(detailMessage.contentBlocks === undefined ? {} : { blocks: detailMessage.contentBlocks })} />
      <ArkmeSelectableMessageText text={detailMessage.text} target={arkoMessageMarkTarget(detailMessage, markSourceRef)}>
      {detailMessage.role === 'assistant' ? <ArkmeMarkdownBody text={detailMessage.text || (detailMessage.status === 'sending' ? '等待回复' : '暂无消息内容')} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.7 }} />
        : <p style={styles.detailText}><ArkmeRichText text={detailMessage.text} linkLabelMode="raw" highlightMentions={false} /></p>}
      </ArkmeSelectableMessageText>
      {!!detailMessage.createdRecordUids?.length && <section aria-label={tr('关联快记')}>
        <h4 style={styles.sender}>{tr('关联快记')}</h4>
        {detailMessage.createdRecordUids.map((uid, index) => <button type="button" key={uid} style={styles.retryButton} onClick={() => { void openLinkedRecord(uid) }}>{tr('查看关联快记')} {index + 1}</button>)}
      </section>}
      {detailMessage.role === 'assistant' && detailMessage.reasoning?.trim() && <section aria-label={tr("思考内容")}>
        <h4 style={styles.sender}>{tr("思考内容")}</h4>
        <p style={styles.text}>{detailMessage.reasoning}</p>
      </section>}
      {detailActivity !== undefined && <p role="status" style={styles.detailMeta}>
        {detailActivity}
      </p>}
    </ArkmeDetailShell>}

    {modelAnchor !== null && catalog !== undefined && <ArkoModelMenu
      anchor={modelAnchor} catalog={catalog} busy={selectingModel} error={modelError}
      onSelect={selectModel} onClose={closeModelMenu}
    />}

    {deletionRequest?.scope === deletionScope && <ArkoMessageDeletionDialog count={deletionRequest.ids.length} onClose={() => setDeletionRequest(undefined)} />}
    {clearConfirmOpen && <div style={styles.backdrop} onMouseDown={event => {
      if (event.target === event.currentTarget) setClearConfirmOpen(false)
    }}>
      <section style={{ ...styles.dialog, width: 'min(420px, 100%)' }} role="dialog" aria-modal="true" aria-labelledby="arkme-arko-clear-title">
        <h3 id="arkme-arko-clear-title" style={styles.dialogTitle}>{tr("清除上下文")}</h3>
        <p style={styles.dialogContent}>{tr("将创建新的 Agent 会话，已有聊天记录不会删除。")}</p>
        <div style={styles.dialogActions}>
          <button data-arkme-feedback="neutral" type="button" style={styles.dialogButton} onClick={() => { setClearConfirmOpen(false) }}>{tr("取消")}</button>
          <button data-arkme-feedback="primary" type="button" style={{ ...styles.dialogButton, ...styles.dialogPrimary }} onClick={() => { void clearContext() }}>{tr("确认")}</button>
        </div>
      </section>
    </div>}

    <div data-arkme-arko-composer-seat style={{ position: 'relative', flex: 'none', boxSizing: 'border-box', paddingRight: 'calc(var(--dsh-scrollbar-width, 8px) + 2px)' }}>
    {messageActions.selecting && <div style={{ position: 'absolute', inset: 0, zIndex: 35, display: 'grid', background: arkmeTheme.layer2 }}>{messageActions.selectionBar}</div>}
    <footer data-arkme-arko-composer data-arkme-width-composer ref={composerRef} aria-hidden={messageActions.selecting || undefined} {...(messageActions.selecting ? { inert: '' } : {})} style={{ ...styles.composer, ...(messageActions.selecting ? { visibility: 'hidden', pointerEvents: 'none' } : {}) }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = inputDisabled ? 'none' : 'copy' } }}
      onDrop={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!inputDisabled && !messageActions.selecting) imageDraft.add(Array.from(event.dataTransfer.files)) } }}
      onClick={event => { focusArkmeComposerFromClick(textareaRef.current, event) }}>
      {addMenuOpen && <ArkmeActionMenu label={tr('添加内容')} side="top" getAnchorRect={() => addButtonRef.current?.getBoundingClientRect() ?? null}
        onClose={() => setAddMenuOpen(false)} actions={[{ id: 'images', label: tr('添加图片'), onSelect: () => { setAddMenuOpen(false); imageInputRef.current?.click() } }]} />}
      <input ref={imageInputRef} aria-label={tr('添加 Arko 图片')} type="file" multiple hidden accept={ARKO_IMAGE_MIME_TYPES.join(',')}
        onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (!inputDisabled) imageDraft.add(files) }} />
      <div style={arkmeConversationComposerLayout.composerStack}>
      <ArkmeComposerInfoRow destination={displayName} focused={composerInputFocused} />
      <div ref={composerInputBoundaryRef} data-arkme-arko-input-card
        className="arkme-conversation-composer-inner" data-arkme-primary-composer="true"
        data-arkme-composer-focused={composerInputFocused ? 'true' : 'false'}
        style={{ ...styles.composerInner, ...arkmeConversationComposerFocusStyle(composerInputFocused),
          ...arkmeConversationComposerBorder(composerInputFocused ? colors.border : 'transparent', false, false) }}>
      {!imageDraftSending && draftSnapshot.attachments.length > 0 && <div style={{ padding: '8px 8px 0' }}><ArkoImageDraftStrip key={accountKey}
        attachments={draftSnapshot.attachments} draftKey={composerDraftKey} disabled={inputDisabled} /></div>}
      {imageDraftSending && <div aria-hidden style={{ ...styles.textarea, color: colors.secondary }}>{composerPlaceholder}</div>}
      <ArkmeDocumentComposerInput
        format="text"
        key={accountKey}
        ref={textareaRef}
        style={imageDraftSending ? { ...styles.textarea, display: 'none' } : styles.textarea!}
        value={draft}
        emojis={draftSnapshot.emojis}
        maxLength={arkoQuestionMaxLength}
        placeholder={composerPlaceholder}
        ariaLabel={tr("发送给 {v0}", { v0: displayName })}
        disabled={inputDisabled || messageActions.selecting}
        onFocus={() => { setComposerInputFocused(true) }}
        onBlur={() => { setComposerInputFocused(false) }}
        onRichTextChange={(text, emojis) => { arkmeComposerDraftStore.setRichText(composerDraftKey, text, emojis) }}
        onPaste={event => {
          const files = Array.from(event.clipboardData.files ?? [])
          if (files.length) { event.preventDefault(); if (!inputDisabled) imageDraft.add(files) }
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!sendDisabled && hasDraftContent
              && session !== undefined && profileUserId !== undefined) void send()
          }
        }}
      />
      <div style={styles.tools}>
        <ArkmeComposerToolButton ref={addButtonRef} aria-label={tr('添加内容')} aria-haspopup="menu" aria-expanded={addMenuOpen}
          disabled={inputDisabled || messageActions.selecting} onPointerDown={event => event.stopPropagation()} onClick={() => setAddMenuOpen(value => !value)}>
          <ArkmeComposerPlusIcon />
        </ArkmeComposerToolButton>
        <ArkmeEmojiPicker
          key={accountKey}
          mode="text"
          disabled={inputDisabled || messageActions.selecting}
          accountKey={accountKey}
          scopeKey={composerDraftKey}
          getCaretGeometry={() => textareaRef.current?.getCaretGeometry()}
          getEditorGeometry={() => textareaRef.current?.getEditorGeometry()}
          onBeforeToggle={() => { textareaRef.current?.captureSelection() }}
          onSelect={insertEmoji}
        />
        <span style={styles.hint} title={hint}>{hint}</span>
        <button data-arkme-feedback="neutral"
          type="button"
          aria-label={tr("选择模型")}
          aria-haspopup="menu"
          aria-expanded={modelDialogOpen}
          title={selectedModel}
          style={{ ...styles.modelTrigger, opacity: !canChooseModel || interactionLocked || clearing || selectingModel ? .55 : 1 }}
          disabled={!canChooseModel || interactionLocked || clearing || selectingModel}
          onClick={event => { toggleModelMenu(event.currentTarget) }}
        ><span style={styles.modelLabel}>{selectedModel}</span><CaretDownIcon size={12} style={{ flex: 'none' }} aria-hidden /></button>
        {activeRun === undefined ? <ArkmeComposerSendButton
          ariaLabel={tr("发送")}
          shortcutHint={attachmentPreparationHint(draftSnapshot.attachments) ?? "Enter"}
          disabled={sendDisabled || !hasDraftContent}
          onClick={() => { void send() }}
        /> : <button data-arkme-feedback="neutral"
          type="button"
          data-arkme-arko-send
          title={tr("停止当前任务")}
          aria-label={tr("停止当前 Arko 任务")}
          style={{ ...arkmeComposerSendButtonStyle, ...styles.stop, opacity: cancelling ? .45 : 1 }}
          disabled={cancelling}
          onClick={() => { void cancelActiveRun() }}
        ><span aria-hidden>■</span></button>}
      </div>
    </div></div></footer>
    </div>
    {linkedRecord !== undefined && (linkedRecord.value !== undefined
      ? <ArkmeTimelineDetailDrawer item={linkedRecord.value} canExtend={false} showOriginal={linkedOriginal} onToggleOriginal={() => setLinkedOriginal(value => !value)} onClose={closeLinkedRecord} />
      : <ArkmeDetailShell title={tr('快记详情')} label={tr('快记详情')} onClose={closeLinkedRecord}>
        <p role={linkedRecord.error ? 'alert' : 'status'}>{linkedRecord.error || tr('正在读取…')}</p>
        {linkedRecord.error && <button type="button" style={styles.retryButton} onClick={() => { void openLinkedRecord(linkedRecord.uid) }}>{tr('重试')}</button>}
      </ArkmeDetailShell>)}
    {messageActions.overlay}
    </ArkmeWideConversation>
  </div>
}
