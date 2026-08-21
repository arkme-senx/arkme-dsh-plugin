import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type {
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryItem,
  ArkmeArkoHistoryPage,
  ArkmeArkoModelCatalog,
  ArkmeArkoProfile,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeSourceAvatar } from './ArkmeAvatar.js'
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
import { arkmeArkoComposerDraftKey, arkmeComposerDraftStore } from './composer-draft-store.js'

type ArkoMessageRole = 'user' | 'assistant' | 'divider'
type ArkoMessageStatus = 'sending' | 'done' | 'error'

interface ArkoMessage {
  id: string
  messageId?: number
  sessionId?: number
  role: ArkoMessageRole
  text: string
  reasoning?: string
  status: ArkoMessageStatus
  meta?: string
  createdAtMillis?: number
  assistantMsgId?: number
  runUid?: string
  runStatus?: string
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
  shell: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 22px 12px' },
  header: {
    flex: 'none', height: 68, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px 12px 20px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
    background: arkmeTheme.base,
  },
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
  actions: { minWidth: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  actionButton: {
    minWidth: 0, height: 34, display: 'flex', alignItems: 'center', gap: 7,
    padding: '5px 9px', boxSizing: 'border-box', border: `1px solid ${colors.border}`,
    borderRadius: 8, background: arkmeTheme.elevated, color: colors.text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  actionIcon: {
    width: 22, height: 22, flex: 'none', display: 'grid', placeItems: 'center',
    borderRadius: 999, background: colors.active, color: arkmeTheme.accent, fontSize: 12, fontWeight: 800,
  },
  actionContent: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  actionTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, lineHeight: '18px', fontWeight: 600 },
  actionSub: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 11, lineHeight: '18px' },
  records: { width: '100%', listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 },
  row: { width: '100%', display: 'flex' },
  rowMe: { justifyContent: 'flex-end' },
  rowArko: { justifyContent: 'flex-start' },
  line: { maxWidth: '100%', display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 23 },
  lineMe: { flexDirection: 'row-reverse' },
  avatar: {
    width: 38, height: 38, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999,
    background: arkmeTheme.subtle, color: colors.secondary, fontSize: 12,
  },
  messageBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 },
  messageBodyMe: { alignItems: 'flex-end' },
  sender: { color: colors.text, fontSize: 12, fontWeight: 600 },
  bubble: { maxWidth: 600, minWidth: 0, padding: '10px 13px', border: '1px solid rgba(29,32,40,.035)', borderRadius: '5px 16px 16px 16px', boxSizing: 'border-box' },
  bubbleMe: { background: 'var(--dsw-specific-bubble, #eef1f8)', borderColor: 'rgba(83,97,145,.045)', borderRadius: '16px 5px 16px 16px' },
  bubbleArko: { background: arkmeTheme.subtle },
  bubbleError: { background: arkmeTheme.dangerSoft, color: colors.danger },
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
  meta: { color: arkmeTheme.tertiary, fontSize: 11 },
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
  modelList: { display: 'flex', flexDirection: 'column', gap: 8 },
  modelOption: {
    width: '100%', minHeight: 78, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: '12px 14px', boxSizing: 'border-box', border: `1px solid ${colors.border}`,
    borderRadius: 8, background: arkmeTheme.elevated, color: colors.text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  modelOptionSelected: { borderColor: colors.accent, background: arkmeTheme.accentSoft },
  modelName: { fontSize: 16, lineHeight: '22px', fontWeight: 650 },
  modelDescription: { marginTop: 3, color: colors.secondary, fontSize: 13, lineHeight: '19px' },
  recommended: { marginLeft: 8, color: arkmeTheme.accent, fontSize: 11, fontWeight: 600 },
  check: { width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, background: colors.accent, color: arkmeTheme.foreground, fontWeight: 800 },
  dialogActions: { marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 },
  dialogButton: {
    minWidth: 76, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8,
    background: arkmeTheme.elevated, color: colors.text, font: 'inherit', cursor: 'pointer',
  },
  dialogPrimary: { border: 0, background: arkmeTheme.info, color: arkmeTheme.foreground },
  composer: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 24px 15px 16px' },
  composerInner: {
    position: 'relative', width: 'min(780px,100%)', overflow: 'hidden', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10,
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,.1))', borderRadius: 18,
    background: arkmeTheme.input, boxShadow: arkmeTheme.shadow,
  },
  textarea: {
    width: '100%', minHeight: 28, maxHeight: 180, resize: 'none', overflowY: 'auto',
    boxSizing: 'border-box', border: 0, outline: 0, padding: '4px 12px 0 16px',
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 16, lineHeight: '24px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
  },
  tools: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0, padding: '2px 8px 6px 16px' },
  hint: { color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 999, background: colors.accent, color: arkmeTheme.foreground, cursor: 'pointer',
  },
  stop: { background: colors.danger },
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

export function arkoRunActivityLabel(status: string | undefined): string | undefined {
  if (status === 'accepted' || status === 'queued') return '正在思考'
  if (status === 'running' || status === 'stream_timeout') return '正在处理'
  if (status === 'waiting_tool') return '等待客户端操作'
  if (status === 'waiting_user') return '等待你的补充'
  if (status === 'partial') return '已部分完成'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已停止'
  if (status === 'expired') return '任务已过期'
  if (status === 'failed') return '处理失败'
  return undefined
}

export function shouldShowArkoThinking(status: ArkoMessageStatus, reasoning?: string): boolean {
  return status === 'sending' || (reasoning !== undefined && reasoning.trim() !== '')
}

export function arkoMessageActivityLabel(
  role: ArkoMessageRole,
  runStatus: string | undefined,
): string | undefined {
  return role === 'assistant' ? arkoRunActivityLabel(runStatus) : undefined
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
    <button
      type="button"
      style={styles.thinkingHeader}
      aria-expanded={expanded}
      onClick={() => { setExpanded(value => !value) }}
    >
      <span style={styles.thinkingTitle}>思考过程</span>
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
  const activity = arkoMessageActivityLabel(item.role, item.runStatus)
  return {
    id: `history:${String(item.messageId)}`,
    messageId: item.messageId,
    sessionId: item.sessionId,
    role: item.role,
    text: active && placeholder ? '' : item.text,
    status: active ? 'sending' : item.runStatus === 'failed' ? 'error' : 'done',
    createdAtMillis: item.createdAtMillis,
    ...(item.reasoning.trim() === '' || (!active && reasoningPlaceholder) ? {} : { reasoning: item.reasoning }),
    ...(item.role !== 'assistant' ? {} : { assistantMsgId: item.messageId }),
    ...(item.runUid === undefined ? {} : { runUid: item.runUid }),
    ...(item.runStatus === undefined ? {} : { runStatus: item.runStatus }),
    ...(activity === undefined ? {} : { meta: activity }),
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
    const leftAt = left.createdAtMillis ?? Number.MAX_SAFE_INTEGER
    const rightAt = right.createdAtMillis ?? Number.MAX_SAFE_INTEGER
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

function resultMeta(result: ArkmeArkoAskResult): string {
  if (result.status === 'waiting_user') return '等待你的补充'
  if (result.status === 'waiting_tool') return '当前 DSH 暂不支持此客户端操作，请停止任务后换一种方式'
  if (result.timedOut) return '处理中'
  if (result.createdRecordUids.length > 0) return `已产生 ${String(result.createdRecordUids.length)} 条记录`
  if (result.status === 'completed') return '已完成'
  return result.status
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
  return catalog?.options.find(option => option.routeKey === catalog.effectiveRouteKey)?.displayName ?? '模型目录暂不可用'
}

export function ArkmeArkoSurface() {
  const bodyRef = useRef<HTMLDivElement>(null)
  const historySentinelRef = useRef<HTMLDivElement>(null)
  const historyLoadInFlightRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
  useSyncExternalStore(
    arkmeComposerDraftStore.subscribe,
    arkmeComposerDraftStore.getRevision,
    arkmeComposerDraftStore.getRevision,
  )
  const draft = arkmeComposerDraftStore.get(composerDraftKey).text
  const profile = profileSnapshot.userId === profileUserId ? profileSnapshot.profile : undefined
  const [userProfile, setUserProfile] = useState<ArkmeUserProfile | null>(null)
  const [session, setSession] = useState<ArkmeArkoSession>()
  const [catalog, setCatalog] = useState<ArkmeArkoModelCatalog>()
  const [messages, setMessages] = useState<ArkoMessage[]>([])
  const [historyOffset, setHistoryOffset] = useState<number>()
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [selectingModel, setSelectingModel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeRun, setActiveRun] = useState<ActiveArkoRun>()
  const [pendingTurn, setPendingTurn] = useState<ArkmeArkoPendingTurn>()

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
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
        text: message.text,
        ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
        ...(message.createdAtMillis === undefined ? {} : { createdAtMillis: message.createdAtMillis }),
      })))
  }, [messages, profileUserId])

  useEffect(() => {
    if (profileUserId === undefined) {
      setPendingTurn(undefined)
      return
    }
    const restored = readArkoPendingTurn(profileUserId)
    setPendingTurn(restored)
    if (restored === undefined) return
    setMessages(current => {
      if (current.some(item => item.id === restored.localAssistantMessageId)) return current
      return [...current, {
        id: restored.localUserMessageId,
        sessionId: restored.sessionId,
        role: 'user',
        text: restored.text,
        status: 'done',
        createdAtMillis: restored.createdAtMillis,
      }, {
        id: restored.localAssistantMessageId,
        sessionId: restored.sessionId,
        role: 'assistant',
        text: '',
        status: 'error',
        meta: '发送结果待确认',
        createdAtMillis: restored.createdAtMillis + 1,
      }]
    })
    scrollToBottom()
  }, [profileUserId, scrollToBottom])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setHistoryError('')
    void Promise.allSettled([
      callArkme<ArkmeArkoSession>('arko.session', undefined, controller.signal),
      callArkme<ArkmeArkoProfile>('arko.profile', undefined, controller.signal),
      callArkme<ArkmeArkoModelCatalog>('arko.models', undefined, controller.signal),
      callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 50, offset: 0 }, controller.signal),
      callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal).then(async snapshot => (
        snapshot.profile === null
          ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
          : snapshot
      )),
    ]).then(([sessionResult, profileResult, modelResult, historyResult, userProfileResult]) => {
      if (controller.signal.aborted) return
      if (sessionResult.status === 'rejected') {
        setError(errorMessage(sessionResult.reason))
        return
      }
      setSession(sessionResult.value)
      if (profileResult.status === 'fulfilled' && profileUserId !== undefined) {
        arkmeArkoProfileStore.setProfile(profileUserId, profileResult.value)
      }
      if (modelResult.status === 'fulfilled') setCatalog(modelResult.value)
      if (userProfileResult.status === 'fulfilled') setUserProfile(userProfileResult.value.profile)
      if (historyResult.status === 'fulfilled') {
        setMessages(current => mergeHistory(current, historyResult.value.items))
        setHistoryOffset(historyResult.value.nextOffset)
        scrollToBottom()
        const restoredRun = latestActiveRun(historyResult.value.items, sessionResult.value.sessionId)
        if (restoredRun !== undefined) {
          setActiveRun(restoredRun)
          setSending(true)
        }
      } else {
        setHistoryError(`加载 Arko 对话记录失败：${errorMessage(historyResult.reason)}`)
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
    const finishRun = async (knownHistory?: ArkmeArkoHistoryPage): Promise<void> => {
      const [historyResult, profileResult] = await Promise.allSettled([
        knownHistory === undefined
          ? callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 50, offset: 0 }, controller.signal)
          : Promise.resolve(knownHistory),
        callArkme<ArkmeArkoProfile>('arko.profile', undefined, controller.signal),
      ])
      if (controller.signal.aborted) return
      if (historyResult.status === 'fulfilled') {
        setMessages(current => mergeHistory(current, historyResult.value.items))
        setHistoryOffset(historyResult.value.nextOffset)
        setHistoryError('')
        scrollToBottom()
      } else {
        setHistoryError(`刷新 Arko 对话记录失败：${errorMessage(historyResult.reason)}`)
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
          const activity = arkoRunActivityLabel(status.status)
          if (status.status === 'waiting_tool') {
            setNotice('当前任务需要 DSH 尚未支持的客户端操作，可以停止任务后换一种方式重试')
          }
          setMessages(current => current.map(item => item.assistantMsgId === activeRun.assistantMsgId ? {
            ...item,
            runStatus: status.status,
            status: isActiveRunStatus(status.status) ? 'sending' : status.status === 'failed' ? 'error' : 'done',
            ...(activity === undefined ? {} : { meta: activity }),
          } : item))
          if (!isActiveRunStatus(status.status)) {
            await finishRun()
            return
          }
        } catch {
          if (controller.signal.aborted) return
          consecutiveFailures += 1
          try {
            const history = await callArkme<ArkmeArkoHistoryPage>(
              'arko.history',
              { limit: 50, offset: 0 },
              controller.signal,
            )
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

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
  }, [draft])

  const loadEarlier = useCallback(async () => {
    if (historyOffset === undefined || historyLoadInFlightRef.current) return
    const body = bodyRef.current
    const previousScrollHeight = body?.scrollHeight ?? 0
    const previousScrollTop = body?.scrollTop ?? 0
    historyLoadInFlightRef.current = true
    setHistoryLoading(true)
    try {
      const page = await callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 50, offset: historyOffset })
      setMessages(current => mergeHistory(current, page.items))
      setHistoryOffset(page.nextOffset)
      setHistoryError('')
      requestAnimationFrame(() => {
        const target = bodyRef.current
        if (target === null) return
        target.scrollTop = arkoPreservedScrollTop(
          previousScrollTop,
          previousScrollHeight,
          target.scrollHeight,
        )
      })
    } catch (caught) {
      setHistoryError(`加载更早的 Arko 对话记录失败：${errorMessage(caught)}`)
    } finally {
      historyLoadInFlightRef.current = false
      setHistoryLoading(false)
    }
  }, [historyOffset])

  useEffect(() => {
    const root = bodyRef.current
    const sentinel = historySentinelRef.current
    if (loading || historyLoading || historyError !== '' || root === null || sentinel === null || historyOffset === undefined) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true || historyLoadInFlightRef.current) return
      void loadEarlier()
    }, { root, rootMargin: '120px 0px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [historyError, historyLoading, historyOffset, loadEarlier, loading])

  const retryHistory = useCallback(async () => {
    if (historyLoading) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const page = await callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 50, offset: 0 })
      setMessages(current => mergeHistory(current, page.items))
      setHistoryOffset(page.nextOffset)
      scrollToBottom()
      if (session !== undefined) {
        const restoredRun = latestActiveRun(page.items, session.sessionId)
        if (restoredRun !== undefined) {
          setActiveRun(restoredRun)
          setSending(true)
        }
      }
    } catch (caught) {
      setHistoryError(`加载 Arko 对话记录失败：${errorMessage(caught)}`)
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
    setMessages(current => current.map(item => item.id === turn.localAssistantMessageId
      ? { ...item, text: '', status: 'sending', meta: '正在确认发送状态', runStatus: 'accepted' }
      : item))
    try {
      const result = await callArkme<ArkmeArkoAskResult>('arko.ask', {
        text: turn.text,
        sessionId: turn.sessionId,
        clientTurnUid: turn.clientTurnUid,
        waitSeconds: 1,
        ...(turn.modelRouteKey === undefined ? {} : { modelRouteKey: turn.modelRouteKey }),
        ...(turn.replyToRunUid === undefined ? {} : { replyToRunUid: turn.replyToRunUid }),
        ...(turn.replyToAssistantMsgId === undefined ? {} : { replyToAssistantMsgId: turn.replyToAssistantMsgId }),
      })
      removeArkoPendingTurn(turn.userId)
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
        meta: resultMeta(result),
        assistantMsgId: result.assistantMsgId,
        ...(item.createdAtMillis === undefined ? {} : { createdAtMillis: item.createdAtMillis }),
        ...(hasVisibleReasoning ? { reasoning: result.reasoning } : {}),
        ...(result.runUid === undefined ? {} : { runUid: result.runUid }),
        runStatus,
      } : item), []))
      if (runActive && result.runUid !== undefined) {
        handedOffToPolling = true
        setActiveRun({
          sessionId: result.sessionId,
          assistantMsgId: result.assistantMsgId,
          runUid: result.runUid,
        })
      }
    } catch (caught) {
      const message = errorMessage(caught)
      const retryable = !(caught instanceof ArkmeClientError) || caught.body.retryable
      if (retryable) {
        setPendingTurn(turn)
        writeArkoPendingTurn(turn)
        setError(`Arko 发送结果暂未确认：${message}。请重试确认，系统会复用同一次请求，不会重复执行。`)
        setMessages(current => current.map(item => item.id === turn.localAssistantMessageId ? {
          ...item, role: 'assistant', text: '', status: 'error', meta: '发送结果待确认',
        } : item))
      } else {
        removeArkoPendingTurn(turn.userId)
        setPendingTurn(current => current?.clientTurnUid === turn.clientTurnUid ? undefined : current)
        setError(message)
        setMessages(current => current.map(item => item.id === turn.localAssistantMessageId ? {
          ...item, role: 'assistant', text: message, status: 'error', meta: '发送失败',
        } : item))
      }
    } finally {
      if (!handedOffToPolling) setSending(false)
    }
  }, [activeRun, profileUserId, sending])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || sending || activeRun !== undefined || pendingTurn !== undefined
      || session === undefined || profileUserId === undefined || composerDraftKey === undefined) return
    const continuation = latestContinuation(messages, session.sessionId)
    const createdAtMillis = Date.now()
    const turn: ArkmeArkoPendingTurn = {
      userId: profileUserId,
      sessionId: session.sessionId,
      clientTurnUid: crypto.randomUUID(),
      text,
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
    writeArkoPendingTurn(turn)
    setPendingTurn(turn)
    arkmeComposerDraftStore.clear(composerDraftKey)
    setMessages(current => [...current, {
      id: turn.localUserMessageId,
      sessionId: turn.sessionId,
      role: 'user',
      text,
      status: 'done',
      createdAtMillis,
    }, {
      id: turn.localAssistantMessageId,
      sessionId: turn.sessionId,
      role: 'assistant',
      text: '',
      status: 'sending',
      meta: '正在思考',
      runStatus: 'accepted',
      createdAtMillis: createdAtMillis + 1,
    }])
    scrollToBottom()
    await submitTurn(turn)
  }, [activeRun, catalog, composerDraftKey, draft, messages, pendingTurn, profileUserId, scrollToBottom, sending, session, submitTurn])

  const selectModel = useCallback(async (routeKey: string) => {
    if (selectingModel) return
    setSelectingModel(true)
    setError('')
    try {
      const next = await callArkme<ArkmeArkoModelCatalog>('arko.model.activate', { routeKey })
      setCatalog(next)
      setModelDialogOpen(false)
      setNotice(`已切换到 ${selectedModelName(next)}`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSelectingModel(false)
    }
  }, [selectingModel])

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
      setMessages(current => current.map(item => item.assistantMsgId === activeRun.assistantMsgId
        ? { ...item, meta: '正在停止' }
        : item))
    } catch (caught) {
      setError(`停止 Arko 任务失败：${errorMessage(caught)}`)
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
  const selectedModel = selectedModelName(catalog)
  const canChooseModel = (catalog?.options.length ?? 0) > 1
  const continuation = useMemo(() => latestContinuation(messages, session?.sessionId), [messages, session?.sessionId])
  const interactionLocked = sending || pendingTurn !== undefined || activeRun !== undefined
  const hint = loading
    ? '正在恢复会话'
    : pendingTurn !== undefined && !sending
      ? '请先确认上一次发送结果'
      : sending
        ? '等待回复'
        : continuation === undefined ? selectedModel : '继续当前任务'

  return <div style={styles.shell}>
    <header style={styles.header}>
      <span style={styles.headerAvatar}><ArkmeArkoAvatar size={34} /></span>
      <span style={styles.headerCopy}>
        <h2 style={styles.headerTitle}>{displayName}</h2>
        <span style={styles.aiDisclaimer}>Agent · 内容由 AI 生成，仅供参考</span>
      </span>
      <div style={styles.actions} role="toolbar" aria-label="Arko 操作">
        <button
          type="button"
          title="选择模型"
          style={{ ...styles.actionButton, opacity: !canChooseModel || interactionLocked || clearing ? .55 : 1 }}
          onClick={() => { setModelDialogOpen(true) }}
          disabled={!canChooseModel || interactionLocked || clearing}
        >
          <span style={styles.actionIcon} aria-hidden><RobotIcon size={14} weight="regular" /></span>
          <span style={styles.actionContent}>
            <span style={styles.actionTitle}>模型选择</span>
            <span style={styles.actionSub}>{selectedModel}</span>
          </span>
        </button>
        <button
          type="button"
          title="清除上下文"
          style={{ ...styles.actionButton, opacity: loading || interactionLocked || clearing ? .55 : 1 }}
          onClick={() => { setClearConfirmOpen(true) }}
          disabled={loading || interactionLocked || clearing || session === undefined}
        >
          <span style={styles.actionIcon} aria-hidden><ArrowsClockwiseIcon size={14} weight="regular" /></span>
          <span style={styles.actionContent}>
            <span style={styles.actionTitle}>{clearing ? '清除中...' : '清除上下文'}</span>
          </span>
        </button>
      </div>
    </header>
    <div ref={bodyRef} style={styles.body}>
      {notice !== '' && <div style={styles.notice}>{notice}</div>}
      {error !== '' && <div style={styles.error}>{error}</div>}
      {historyError !== '' && <div style={{ ...styles.error, ...styles.feedbackRow }}>
        <span>{historyError}</span>
        <button type="button" style={styles.retryButton} disabled={historyLoading} onClick={() => {
          if (historyOffset === undefined) void retryHistory()
          else void loadEarlier()
        }}>
          {historyLoading ? '加载中...' : '重新加载'}
        </button>
      </div>}
      {pendingTurn !== undefined && !sending && activeRun === undefined && <div style={{ ...styles.notice, ...styles.feedbackRow }}>
        <span>上一次发送结果尚未确认，请先用原请求标识完成对账。</span>
        <button type="button" style={styles.retryButton} onClick={() => { void submitTurn(pendingTurn) }}>重试确认</button>
      </div>}
      <div ref={historySentinelRef} style={styles.historySentinel} />
      {historyLoading && <div style={styles.historyLoading} role="status">正在加载更早内容…</div>}
      {!loading && historyError === '' && messages.length === 0 && <div style={styles.empty}>暂无对话记录</div>}
      {messages.length > 0 && <ul style={styles.records}>
        {messages.map(item => {
          const activity = arkoRunActivityLabel(item.runStatus)
          const showThinking = item.role === 'assistant'
            && shouldShowArkoThinking(item.status, item.reasoning)
          return <Fragment key={item.id}>
          {item.role === 'divider' ? <li style={{ ...styles.row, justifyContent: 'center' }}>
            <span style={styles.divider}>{item.text}</span>
          </li> : <li style={{ ...styles.row, ...(item.role === 'user' ? styles.rowMe : styles.rowArko) }}>
            <div style={{ ...styles.line, ...(item.role === 'user' ? styles.lineMe : {}) }}>
              <span style={styles.avatar} aria-hidden>{item.role === 'user'
                ? <ArkmeSourceAvatar
                  {...(userProfile?.avatarRef === undefined ? {} : { avatarRef: userProfile.avatarRef })}
                  size={38}
                />
                : <ArkmeArkoAvatar size={38} />}</span>
              <div style={{ ...styles.messageBody, ...(item.role === 'user' ? styles.messageBodyMe : {}) }}>
                {item.role === 'assistant' && <span style={styles.sender}>{displayName}</span>}
                {showThinking && <ArkoThinkingPanel
                  {...(item.reasoning === undefined ? {} : { reasoning: item.reasoning })}
                  {...(activity === undefined ? {} : { activity })}
                />}
                {(item.text.trim() !== '' || item.status === 'error') && <div style={{
                  ...styles.bubble,
                  ...(item.role === 'user' ? styles.bubbleMe : styles.bubbleArko),
                  ...(item.status === 'error' ? styles.bubbleError : {}),
                }}>
                  <p style={styles.text}>{item.text}</p>
                </div>}
                {item.meta !== undefined && <span style={styles.meta}>{item.meta}</span>}
              </div>
            </div>
          </li>}
        </Fragment>})}
      </ul>}
    </div>

    {modelDialogOpen && catalog !== undefined && <div style={styles.backdrop} onMouseDown={event => {
      if (event.target === event.currentTarget && !selectingModel) setModelDialogOpen(false)
    }}>
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-arko-model-title">
        <h3 id="arkme-arko-model-title" style={styles.dialogTitle}>选择模型</h3>
        <p style={styles.dialogContent}>仅影响之后发起的新任务，进行中的任务会继续使用原模型</p>
        <div style={styles.modelList}>
          {catalog.options.map(option => <button
            key={option.routeKey}
            type="button"
            style={{ ...styles.modelOption, ...(option.selected ? styles.modelOptionSelected : {}), opacity: selectingModel ? .6 : 1 }}
            disabled={selectingModel || option.selected}
            onClick={() => { void selectModel(option.routeKey) }}
          >
            <span>
              <span style={styles.modelName}>{option.displayName}</span>
              {option.recommended && <span style={styles.recommended}>推荐</span>}
              <span style={{ display: 'block', ...styles.modelDescription }}>{option.description}</span>
            </span>
            {option.selected && <span style={styles.check} aria-label="当前模型">✓</span>}
          </button>)}
        </div>
        <div style={styles.dialogActions}>
          <button type="button" style={styles.dialogButton} onClick={() => { setModelDialogOpen(false) }} disabled={selectingModel}>关闭</button>
        </div>
      </section>
    </div>}

    {clearConfirmOpen && <div style={styles.backdrop} onMouseDown={event => {
      if (event.target === event.currentTarget) setClearConfirmOpen(false)
    }}>
      <section style={{ ...styles.dialog, width: 'min(420px, 100%)' }} role="dialog" aria-modal="true" aria-labelledby="arkme-arko-clear-title">
        <h3 id="arkme-arko-clear-title" style={styles.dialogTitle}>清除上下文</h3>
        <p style={styles.dialogContent}>将创建新的 Agent 会话，已有聊天记录不会删除。</p>
        <div style={styles.dialogActions}>
          <button type="button" style={styles.dialogButton} onClick={() => { setClearConfirmOpen(false) }}>取消</button>
          <button type="button" style={{ ...styles.dialogButton, ...styles.dialogPrimary }} onClick={() => { void clearContext() }}>确认</button>
        </div>
      </section>
    </div>}

    <footer style={styles.composer}><div style={styles.composerInner}>
      <textarea
        ref={textareaRef}
        rows={1}
        style={styles.textarea}
        value={draft}
        maxLength={60 * 1024}
        placeholder={`问问 ${displayName}...`}
        aria-label={`发送给 ${displayName}`}
        disabled={loading || interactionLocked || session === undefined || profileUserId === undefined}
        onChange={event => { arkmeComposerDraftStore.setText(composerDraftKey, event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!loading && !interactionLocked && draft.trim() !== ''
              && session !== undefined && profileUserId !== undefined) void send()
          }
        }}
      />
      <div style={styles.tools}>
        <span style={styles.hint}>{hint}</span>
        {activeRun === undefined ? <button
          type="button"
          title="发送"
          style={{ ...styles.send, opacity: loading || interactionLocked || draft.trim() === ''
            || session === undefined || profileUserId === undefined ? .45 : 1 }}
          disabled={loading || interactionLocked || draft.trim() === ''
            || session === undefined || profileUserId === undefined}
          onClick={() => { void send() }}
        ><span aria-hidden>↑</span></button> : <button
          type="button"
          title="停止当前任务"
          aria-label="停止当前 Arko 任务"
          style={{ ...styles.send, ...styles.stop, opacity: cancelling ? .45 : 1 }}
          disabled={cancelling}
          onClick={() => { void cancelActiveRun() }}
        ><span aria-hidden>■</span></button>}
      </div>
    </div></footer>
  </div>
}
