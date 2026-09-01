import {
  Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode, type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { X } from '@phosphor-icons/react/dist/icons/X'
import qrcode from 'qrcode-generator'
import type {
  ArkmeAuthSnapshot, ArkmeGroupAiPolishNotice, ArkmeGroupAiPolishSnapshot, ArkmeSourceReadResult,
  ArkmeRelatedRecordingItem, ArkmeRelatedRecordingMonthBucket, ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageState, ArkmeSourceItem, ArkmeSourceSendResult, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage, ArkmeMessageSnapshotDetail, ArkmeRecordLocationCapture,
  ArkmeInterwovenBootstrap, ArkmeInterwovenDetail, ArkmeInterwovenMention, ArkmePluginResponse,
  ArkmeRelatedQuickNoteDetail, ArkmeRelatedQuickNoteItem, ArkmeRelatedQuickNoteList,
  ArkmeMessageCopyLinkExtendResult, ArkmeMessageCopyLinkExtensionItem, ArkmeMessageCopyLinkResolveResult, ArkmeMessageCopyLinkResult, ArkmeMessageCopyLinkSnapshotItem,
  ArkmeUploadedAsset, ArkmeSourceList, ArkmeUserProfile, ArkmeUserProfileSnapshot,
  ArkmeConversationMemberItem, ArkmeConversationMemberList, ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberJoinEvent, ArkmeConversationMemberJoinPerson, ArkmeOpenPrivateChatResult,
  ArkmeHumanMentionInput,
  ArkmeTopicHierarchyMoveResult,
  ArkmeTopicDissolveTask,
  ArkmeBotList, ArkmeGroupBotCandidate, ArkmeGroupBotCandidateList,
  ArkmeSharedRecordingPreview,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeContentBlock } from '../types.js'
import type { ArkmeFileSendTask } from '../file-transfer-contract.js'
import { bindSentFileTaskLocals, fileTaskTimelineItem, localFileBlock, useArkmeFileSendTasks } from './file-send-tasks.js'
import { isArkmeRequestAbort, retryArkmeRead } from './read-retry.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { ArkmeDirectorySourceAvatar, ArkmeUserAvatar } from './ArkmeAvatar.js'
import {
  ARKME_CONVERSATION_HEADER_ACTIONS_STYLE,
  ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE,
  ARKME_CONVERSATION_SETTINGS_MENU_SCRIM_STYLE,
  ARKME_CONVERSATION_SETTINGS_MENU_STATUS_STYLE,
  ARKME_CONVERSATION_SETTINGS_MENU_WIDTH,
  ARKME_CONVERSATION_SETTINGS_POPOVER_STYLE,
  ArkmeConversationHeaderIconButton,
  ArkmeConversationMoreIcon,
  ArkmeGroupChatControls,
} from './ArkmeGroupChatControls.js'
import {
  ArkmeMemberActionMenu, ArkmeMemberProfileCard, ArkmeMemberRecordsPanel,
  arkmeMemberActionMenuRowCount, arkmeMemberConversationAction, positionArkmeMemberMenu,
  type ArkmeMemberMenuPosition,
} from './ArkmeChatMemberActions.js'
import { ArkmeLogin, type ArkmeLoginMode } from './ArkmeLogin.js'
import { ArkmeMuteIcon } from './ArkmeMuteIcon.js'
import { ArkmeMessageReadReceiptLine } from './ArkmeMessageReadReceipt.js'
import { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'
import { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
import { ArkmeCallSurface } from './ArkmeCallSurface.js'
import { ArkmeWorldSurface } from './ArkmeWorldSurface.js'
import {
  ArkmeMediaPreview, ArkmeMessageContent, arkmeRelatedRecordingItemFromSharedRecording,
  arkmeRelatedRecordingItemFromSharedRecordingPreview,
} from './ArkmeRichContent.js'
import { ArkmeAttachmentStrip, ArkmeFilePreparingIndicator } from './ArkmeAttachmentStrip.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import { ArkmeEmojiPicker } from './ArkmeEmojiPicker.js'
import type { ArkmeEmoji } from './arkme-emoji.js'
import { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
import { ArkmeContactAddSurface } from './ArkmeContactAddSurface.js'
import { ArkmeBotConversationSurface } from './ArkmeBotConversationSurface.js'
import { ARKME_DEFAULT_SHARE_WEBSITE } from '../types.js'
import { ArkmeMarketplace } from './ArkmeMarketplace.js'
import {
  ArkmeSourceBreadcrumb,
} from './ArkmeSourceBreadcrumb.js'
import {
  ArkmeTopicDirectoryPopover, type ArkmeSelfSourcesResolution, type ArkmeTopicCreateOpener,
} from './ArkmeTopicDirectoryPopover.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeVoiceprintSurface } from './ArkmeVoiceprintSurface.js'
import { ArkmeNavigation, type ArkmeNavigationProps } from './ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeMessageReadReceipts } from './message-read-receipt-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
  type ArkmeChatDirectorySnapshot,
  type ArkmeChatTimelineSourceDeltaSnapshot,
  type ArkmeInterwovenInvalidationSnapshot,
} from './chat-directory-store.js'
import {
  ArkmeConversationMemoryCache,
  arkmeConversationRestoredScrollTop,
  arkmeConversationTimelineContentEqual,
  arkmeShouldRefreshChatTimeline,
  arkmeShouldRefreshRecordTimeline,
  type ArkmeConversationTimelineSnapshot,
  type ArkmeConversationViewportSnapshot,
} from './conversation-memory-cache.js'
import {
  arkmeComposerCanSend,
  arkmeComposerDraftStore,
  arkmeAttachmentId,
  arkmeSourceComposerDraftKey,
  releaseArkmeComposerDraft,
  serializeArkmeComposerDraft,
  type ArkmeComposerAttachment,
} from './composer-draft-store.js'
import { arkmeConversationComposerLayout } from './conversation-composer-presentation.js'
import { restoreArkmeComposerFocus } from './composer-focus.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import {
  arkmeComposerGroupMemberCount, arkmeComposerPlaceholderText,
  type ArkmeComposerPlaceholderTarget,
} from './composer-placeholder.js'
import {
  ARKME_CONVERSATION_HEADER_HEIGHT, ArkmeInterwovenDetailAside, ArkmeInterwovenMentionCard,
  mergeConversationRows, resolveInterwovenGroupTarget,
  type ArkmeConversationRow, type ArkmeInterwovenDetailViewState,
} from './interwoven-moments.js'
import {
  relatedDrawerBackTarget,
  type ArkmeRelatedDrawerView,
  type ArkmeRelatedQuickNoteDetailState,
  type ArkmeRelatedQuickNotesLoadState,
} from './ArkmeRelatedQuickNotes.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeWechatRequestStartedAfterAuthStatus } from './arkme-auth-flow.js'
import {
  isCurrentRelatedRecordingRequest, mergeRelatedRecordingItems, RelatedRecordingDetail,
  RelatedRecordingsPanel, shouldShowPrivateChatActions, shouldShowRelatedRecordingsEntry,
} from './related-recordings.js'
import { isArkmeChatDirectorySource, isArkmeSelfWorkspaceSource } from './source-list.js'
import { arkmeLoginErrorMessage, arkmeStoredLoginErrorMessage } from './arkme-login-errors.js'
import {
  defaultArkmeLoginTranslate, type ArkmeLoginTranslate,
} from './arkme-login-locales.js'

import { ArkmeTimelineDetailDrawer, ForwardRecordsDetail } from './ArkmeNoteDetails.js'
import { ArkmeMessageSnapshotDialog, arkmeCanOpenMessageSnapshot } from './ArkmeMessageSnapshotDialog.js'
import { ArkmeMessageReportDialog, arkmeCanReportTimelineMessage } from './ArkmeMessageReportDialog.js'
import { arkmeLocationCaptureEnabled, arkmeSourceSupportsLocationCapture, requestArkmeRecordLocation, setArkmeLocationCaptureEnabled, subscribeArkmeLocationCapturePreference } from './record-capture-location.js'
export { ArkmeTimelineDetailDrawer, arkmeTimelineDetailSenderText } from './ArkmeNoteDetails.js'

const ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY = 'arkme.composer.show-input-time'

function arkmeComposerShowsInputTime(): boolean {
  try { return window.localStorage.getItem(ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY) !== 'hidden' } catch { return true }
}

function setArkmeComposerShowsInputTime(value: boolean): void {
  try { window.localStorage.setItem(ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY, value ? 'shown' : 'hidden') } catch { /* storage is optional */ }
}

function arkmeBrowserName(): string {
  const navigatorWithUaData = navigator as Navigator & { userAgentData?: { brands?: ReadonlyArray<{ brand?: unknown }> } }
  const brands = navigatorWithUaData.userAgentData?.brands ?? []
  const brandText = brands.map(item => typeof item.brand === 'string' ? item.brand : '').join(' ')
  const userAgent = navigator.userAgent
  if (/Microsoft Edge|Edg\//iu.test(`${brandText} ${userAgent}`)) return 'Microsoft Edge'
  if (/Opera|OPR\//iu.test(`${brandText} ${userAgent}`)) return 'Opera'
  if (/Firefox|FxiOS\//iu.test(`${brandText} ${userAgent}`)) return 'Firefox'
  if (/Safari/iu.test(userAgent) && !/Chrome|Chromium|CriOS|Edg\//iu.test(userAgent)) return 'Safari'
  if (/Google Chrome|Chrome|Chromium|CriOS/iu.test(`${brandText} ${userAgent}`)) return 'Google Chrome'
  return '浏览器'
}

function arkmeNetworkName(): string {
  const connection = (navigator as Navigator & { connection?: { type?: unknown } }).connection
  const type = typeof connection?.type === 'string' ? connection.type.trim().toLowerCase() : ''
  if (type === 'wifi') return 'Wi‑Fi'
  if (type === 'ethernet') return '有线网络'
  if (type === 'cellular') return '移动网络'
  if (type === 'none') return '离线'
  return navigator.onLine ? '网络已连接' : '离线'
}

async function arkmeComposerCaptureContext(): Promise<{ clientName: string; networkName?: string; electric?: number; charge?: number }> {
  const networkName = arkmeNetworkName()
  const base = {
    clientName: `${arkmeBrowserName()}（DeepSeek Harness）`,
    ...(networkName === '' ? {} : { networkName }),
  }
  const batteryApi = navigator as Navigator & { getBattery?: () => Promise<{ level?: number; charging?: boolean }> }
  if (typeof batteryApi.getBattery !== 'function') return base
  const battery = await Promise.race([
    batteryApi.getBattery().catch(() => undefined),
    new Promise<undefined>(resolve => { window.setTimeout(() => resolve(undefined), 900) }),
  ])
  const level = typeof battery?.level === 'number' && Number.isFinite(battery.level)
    ? Math.round(Math.max(0, Math.min(1, battery.level)) * 100)
    : undefined
  return {
    ...base,
    ...(level === undefined ? {} : { electric: level }),
    ...(level === undefined ? {} : { charge: battery?.charging === true ? 1 : 2 }),
  }
}

function ArkmeComposerInputTimeIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
      <path d="M0 7.5C.85 4.43 3.66 2.18 7 2.18S13.15 4.43 14 7.5C13.15 10.57 10.34 12.83 7 12.83S.85 10.57 0 7.5Z" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7" cy="7.5" r="1.92" stroke="currentColor" strokeWidth="1.2" />
    </svg>
    : <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
      <path d="M1.11 4.95C1.69 5.72 2.53 6.38 3.57 6.84C4.61 7.31 5.79 7.55 7 7.55S9.39 7.31 10.42 6.84C11.46 6.38 12.31 5.72 12.89 4.95M3.21 6.77L1.03 9.53M10.76 6.77L13 9.79M8.55 7.55L9.17 11.03M5.83 7.55L5.21 11.03" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
}

const ArkmeComposerInputStats = memo(function ArkmeComposerInputStats({
  active,
  visible,
  textLength,
  startedAtMillis,
  showsInputTime,
  onToggle,
}: {
  active: boolean
  visible: boolean
  textLength: number
  startedAtMillis?: number
  showsInputTime: boolean
  onToggle(): void
}) {
  const [nowMillis, setNowMillis] = useState(() => Date.now())
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => { setForeground(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => {
    setNowMillis(Date.now())
    if (!active || !foreground || !visible || !showsInputTime || startedAtMillis === undefined) return
    const timer = globalThis.setInterval(() => { setNowMillis(Date.now()) }, 1_000)
    return () => { globalThis.clearInterval(timer) }
  }, [active, foreground, showsInputTime, startedAtMillis, visible])
  if (!active || !visible) return null
  const durationSeconds = startedAtMillis === undefined
    ? 0
    : Math.max(0, Math.floor((nowMillis - startedAtMillis) / 1_000))
  return <div style={styles.composerStats} aria-label={`已输入 ${String(textLength)} 字，编辑 ${String(durationSeconds)} 秒`}>
    <span>{String(textLength)}字</span>
    <button
      type="button"
      style={styles.composerTimeToggle}
      aria-label={showsInputTime ? '隐藏输入时长' : '显示输入时长'}
      title={showsInputTime ? '隐藏输入时长' : '显示输入时长'}
      onMouseDown={event => { event.preventDefault() }}
      onClick={onToggle}
    >
      <span>{showsInputTime ? `${String(durationSeconds)}秒` : '思考中…'}</span>
      <ArkmeComposerInputTimeIcon visible={showsInputTime} />
    </button>
  </div>
})

export interface ArkmeSurfaceProps {
  t?: ArkmeLoginTranslate
  floating?: boolean
  productNavigation?: boolean
  initialAuth?: ArkmeAuthSnapshot | undefined
  currentSessionId?: string | undefined
  renderSlot?: ArkmeNavigationProps['renderSlot']
  productChrome?: boolean
  directoryLead?: ReactNode
  onCreateTask?: () => void
  onActivateSurface?: () => void
  ownsQrLogin?: boolean
  /** Whether the visible surface owns foreground requests, timers and polling. */
  active?: boolean
}

export type ArkmeAuthView = 'login' | 'content'

const EMPTY_SELF_SOURCES: readonly ArkmeSourceItem[] = []
const EMPTY_CONVERSATION_MEMBERS: readonly ArkmeConversationMemberItem[] = []

interface ArkmeConversationMemberSnapshot {
  sourceRef: string
  items: readonly ArkmeConversationMemberItem[]
}
const EMPTY_CHAT_DIRECTORY_SNAPSHOT: ArkmeChatDirectorySnapshot = {
  revision: 0,
  sources: [],
  baselineReady: false,
  isRefreshing: false,
}
const EMPTY_CHAT_DELTA_SNAPSHOT: ArkmeChatTimelineSourceDeltaSnapshot = { revision: 0, items: [] }
const EMPTY_INTERWOVEN_INVALIDATION: ArkmeInterwovenInvalidationSnapshot = Object.freeze({ revision: 0 })
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined
export function arkmeShouldDismissAnchoredMenu(
  target: Node | null,
  menu: Pick<Node, 'contains'> | null,
  trigger: Pick<Node, 'contains'> | null,
): boolean {
  return target !== null && menu?.contains(target) !== true && trigger?.contains(target) !== true
}

export function arkmeShouldToggleMessageSelectFromRowClick(target: EventTarget | null): boolean {
  return !(typeof Element !== 'undefined' && target instanceof Element && target.closest('[data-arkme-select-check]') !== null)
}

function AgentAssistantIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="2 1.4 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-arkme-agent-source-icon="assistant"
    >
      <path d="M3.25 6.72C3.25 5.67 3.67 4.78 4.38 4.18L4.25 2.7C4.22 2.4 4.57 2.22 4.82 2.42L6.2 3.5C6.76 3.33 7.37 3.24 8 3.24C8.63 3.24 9.24 3.33 9.8 3.5L11.18 2.42C11.43 2.22 11.78 2.4 11.75 2.7L11.62 4.18C12.33 4.78 12.75 5.67 12.75 6.72V8.78C12.75 11.11 10.63 12.76 8 12.76C5.37 12.76 3.25 11.11 3.25 8.78V6.72Z" fill="#FFFDF4" stroke="#252525" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M4.38 4.18L4.25 2.7C4.22 2.4 4.57 2.22 4.82 2.42L6.2 3.5C6.55 3.4 6.93 3.32 7.32 3.28C7.26 4.12 7.28 4.79 7.16 5.42C7.04 6.1 6.84 6.65 6.68 7.18C6.5 7.78 6.13 8.19 5.57 8.35C4.75 8.58 3.9 8.23 3.26 7.67V6.72C3.26 5.67 3.67 4.78 4.38 4.18Z" fill="#252525" />
      <path d="M8.68 3.28C9.07 3.32 9.45 3.4 9.8 3.5L11.18 2.42C11.43 2.22 11.78 2.4 11.75 2.7L11.62 4.18C12.33 4.78 12.74 5.67 12.74 6.72V7.84C12.12 8.38 11.29 8.63 10.51 8.34C9.9 8.11 9.5 7.66 9.34 7.08C9.19 6.54 8.97 5.99 8.84 5.34C8.72 4.72 8.74 4.08 8.68 3.28Z" fill="#252525" />
      <ellipse cx="5.92" cy="6.76" rx="0.66" ry="0.72" fill="#FFFDF4" />
      <ellipse cx="10.08" cy="6.76" rx="0.66" ry="0.72" fill="#FFFDF4" />
      <ellipse cx="5.98" cy="6.7" rx="0.32" ry="0.43" fill="#252525" />
      <ellipse cx="10.14" cy="6.7" rx="0.32" ry="0.43" fill="#252525" />
      <circle cx="5.86" cy="6.46" r="0.14" fill="#FFFDF4" />
      <circle cx="10.02" cy="6.46" r="0.14" fill="#FFFDF4" />
      <path d="M7.58 8.24C7.8 8.09 8.2 8.09 8.42 8.24C8.54 8.32 8.51 8.49 8.38 8.56L8 8.75L7.62 8.56C7.49 8.49 7.46 8.32 7.58 8.24Z" fill="#EFA7A2" />
      <path d="M8 8.76V8.92M8 8.92C7.83 9.1 7.55 9.08 7.34 8.9M8 8.92C8.17 9.1 8.45 9.08 8.66 8.9" stroke="#252525" strokeWidth="0.44" strokeLinecap="round" />
    </svg>
  )
}

const colors = {
  panel: arkmeTheme.base,
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  danger: arkmeTheme.danger,
}

const MESSAGE_ACTION_REQUEST_TIMEOUT_MS = 12_000
const MESSAGE_FORWARD_REQUEST_TIMEOUT_MS = 30_000
const MESSAGE_ACTION_NOTICE_MS = 1_800
const FORWARD_TARGET_LIMIT = 80
const MAX_FORWARD_TARGET_SELECTION = 5

const ARKME_MESSAGE_AVATAR_SIZE = 34
const ARKME_MESSAGE_SELECT_HIT_SIZE = 32
const ARKME_MESSAGE_SELECT_GAP = 10
const ARKME_MESSAGE_SELECT_AVATAR_OFFSET = (ARKME_MESSAGE_AVATAR_SIZE - ARKME_MESSAGE_SELECT_HIT_SIZE) / 2
const ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE = ARKME_MESSAGE_SELECT_HIT_SIZE + ARKME_MESSAGE_SELECT_GAP

const styles: Record<string, CSSProperties> = {
  surface: {
    position: 'relative', overflow: 'hidden', width: '100%', height: '100%', minWidth: 0,
    display: 'flex', background: '#ffffff', color: colors.text,
  },
  compactSurface: { flexDirection: 'column' },
  floatingSurface: { background: '#ffffff' },
  directoryPane: {
    width: 300, minWidth: 300, height: '100%', minHeight: 0, flex: 'none', overflow: 'hidden',
    borderRight: `1px solid ${colors.border}`, background: '#ffffff', boxSizing: 'border-box',
  },
  compactDirectoryPane: {
    width: '100%', minWidth: 0, height: 'min(292px, 36vh)', flex: 'none',
    borderRight: 0, borderBottom: `1px solid ${colors.border}`,
  },
  panel: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' },
  contactBackdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, padding: 16, boxSizing: 'border-box',
    display: 'grid', placeItems: 'center',
    background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  contactDialog: {
    width: 'min(620px, 100%)', height: 'min(620px, calc(100% - 4px))', minHeight: 0,
    display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${colors.border}`,
    borderRadius: 14, background: arkmeTheme.base, boxShadow: '0 22px 64px rgba(20, 23, 31, .22)',
  },
  contactDialogHeader: {
    height: 58, minHeight: 58, padding: '0 16px 0 20px', boxSizing: 'border-box', display: 'flex',
    alignItems: 'center', borderBottom: `1px solid ${colors.border}`, background: arkmeTheme.base,
  },
  contactDialogTitle: { flex: 1, minWidth: 0, margin: 0, color: colors.text, fontSize: 18, lineHeight: '24px', fontWeight: 600 },
  contactDialogClose: {
    width: 32, height: 32, padding: 0, border: 0, borderRadius: 8, background: 'transparent',
    color: colors.secondary, cursor: 'pointer', fontSize: 25, lineHeight: 1,
  },
  contactDialogBody: { flex: 1, minHeight: 0, overflow: 'hidden' },
  header: {
    flex: 'none', height: 68, display: 'flex', alignItems: 'center', padding: '12px 16px 12px 20px',
    boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`, position: 'relative', gap: 2,
  },
  titleGroup: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' },
  headerAvatar: { flex: 'none', display: 'grid', placeItems: 'center', marginRight: 6 },
  titleBlock: { flex: '0 1 auto', minWidth: 0, maxWidth: '100%', padding: '2px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  titleLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  title: { flex: '0 1 auto', minWidth: 0, margin: 0, fontSize: 15, lineHeight: '21px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSubtitle: { color: colors.secondary, fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  titleMuteIcon: { width: 16, height: 16, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.secondary },
  messageActionMenu: {
    position: 'absolute', zIndex: 60, width: 178, padding: 6, border: `1px solid ${colors.border}`,
    borderRadius: 10, background: colors.panel, boxShadow: '0 14px 36px rgba(20,23,31,.16)',
  },
  messageActionMenuItem: {
    width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', gap: 10, border: 0, borderRadius: 8,
    padding: '8px 10px', background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 13, textAlign: 'left',
  },
  messageActionMenuIcon: { width: 18, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.secondary, fontSize: 13 },
  messageActionMenuText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  messageActionToast: {
    position: 'absolute', left: '50%', bottom: 132, zIndex: 95, transform: 'translateX(-50%)',
    maxWidth: 'calc(100% - 48px)', padding: '8px 12px', borderRadius: 6, background: 'rgba(25,27,35,.94)',
    color: '#fff', boxShadow: '0 8px 24px rgba(20,23,31,.18)', fontSize: 12, lineHeight: '18px',
    textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
  },
  forwardSuccessBannerWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 118, zIndex: 85, display: 'flex', justifyContent: 'center',
    padding: '0 16px', pointerEvents: 'none',
  },
  forwardSuccessBanner: {
    width: 'min(380px, 100%)', minHeight: 48, display: 'flex', alignItems: 'center', gap: 9,
    padding: '9px 12px', border: 0, borderRadius: 12, boxSizing: 'border-box',
    background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-3, #fff) 80%, transparent)',
    color: colors.text, boxShadow: '0 5px 14px rgba(20,23,31,.16)', backdropFilter: 'blur(40px)',
    cursor: 'pointer', pointerEvents: 'auto', textAlign: 'left',
  },
  forwardSuccessAvatarStack: { width: 30, height: 30, flex: 'none', position: 'relative' },
  forwardSuccessText: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '18px', fontWeight: 600 },
  forwardSuccessAction: { flex: 'none', fontSize: 13, lineHeight: '18px', fontWeight: 700 },
  body: { flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: '22px 22px 12px', background: arkmeTheme.base },
  bodySelectMode: { paddingBottom: 86 },
  utilityBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
  error: { padding: '10px 12px', borderRadius: 9, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  records: { width: '100%', minWidth: 0, listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 },
  timelineSkeleton: { display: 'flex', flexDirection: 'column', gap: 24, padding: '4px 0 20px' },
  timelineSkeletonRow: { display: 'flex', alignItems: 'flex-start', gap: 11 },
  timelineSkeletonRowMe: { flexDirection: 'row-reverse' },
  timelineSkeletonAvatar: { width: 34, height: 34, flex: 'none', borderRadius: '50%', background: arkmeTheme.subtle },
  timelineSkeletonBubble: { height: 54, borderRadius: 14, background: arkmeTheme.subtle },
  newMessages: {
    position: 'sticky', zIndex: 4, bottom: 6, display: 'block', margin: '8px auto 0', padding: '7px 13px',
    border: `1px solid ${colors.border}`, borderRadius: 999, background: colors.panel, color: colors.text,
    boxShadow: '0 5px 18px rgba(20,23,31,.12)', cursor: 'pointer', fontSize: 12,
  },
  date: { alignSelf: 'center', marginBottom: 18, color: arkmeTheme.caption, fontSize: 10 },
  row: { width: '100%', minWidth: 0, display: 'flex' },
  rowSearchTarget: { borderRadius: 14, outline: '2px solid rgba(10,132,255,.42)', outlineOffset: 5, background: 'rgba(10,132,255,.07)', transition: 'outline-color .3s ease, background-color .3s ease' },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  sharedRecordingRow: { justifyContent: 'center' },
  rowSelectAvatarMode: {
    display: 'grid', gridTemplateColumns: `${ARKME_MESSAGE_SELECT_HIT_SIZE}px minmax(0, 1fr)`, alignItems: 'start', columnGap: ARKME_MESSAGE_SELECT_GAP,
    marginBottom: 18, padding: '6px 0 6px 6px', boxSizing: 'border-box', cursor: 'pointer',
  },
  rowSelectCardCenterMode: {
    display: 'grid', gridTemplateColumns: `${ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE}px minmax(0, 1fr) ${ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE}px`,
    alignItems: 'center', marginBottom: 42, cursor: 'pointer',
  },
  rowSelectedForAction: { background: arkmeTheme.layer2 },
  selectCheck: {
    width: ARKME_MESSAGE_SELECT_HIT_SIZE, height: ARKME_MESSAGE_SELECT_HIT_SIZE, display: 'grid', placeItems: 'center', border: 0, padding: 0,
    borderRadius: 999, background: 'transparent', color: arkmeTheme.foreground, cursor: 'pointer',
  },
  selectCheckAvatar: { justifySelf: 'center', marginTop: ARKME_MESSAGE_SELECT_AVATAR_OFFSET },
  selectCheckCardCenter: { justifySelf: 'center' },
  selectCheckCircle: {
    width: 22, height: 22, display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    border: `1.5px solid ${arkmeTheme.tertiary}`, borderRadius: 999, background: 'transparent',
    color: arkmeTheme.foreground,
  },
  selectCheckActive: { borderColor: arkmeTheme.accent, background: arkmeTheme.accent },
  messageLine: { maxWidth: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18 },
  messageLineSelectAvatarMode: { minWidth: 0, marginBottom: 0 },
  messageLineMe: { flexDirection: 'row-reverse' },
  forwardMessageLine: { width: 'auto' },
  sharedRecordingMessageLine: { width: 'min(600px, 100%)', justifyContent: 'center', marginBottom: 42 },
  messageLineSelectCardCenterMode: { gridColumn: '2', minWidth: 0, justifySelf: 'center', marginBottom: 0 },
  messageBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 },
  messageBodyMe: { alignItems: 'flex-end' },
  forwardMessageBody: { flex: 1 },
  sharedRecordingMessageBody: { width: '100%', flex: 'none', alignItems: 'stretch' },
  messageAvatar: {
    width: ARKME_MESSAGE_AVATAR_SIZE, height: ARKME_MESSAGE_AVATAR_SIZE, flex: 'none', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'transparent', color: arkmeTheme.secondary, fontSize: 11, fontWeight: 600,
  },
  messageAvatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  sender: { color: colors.text, fontSize: 12, fontWeight: 600 },
  messageHeader: { display: 'flex', alignItems: 'center', gap: 7 },
  agentSource: {
    marginTop: 4, maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 2,
    color: colors.secondary, fontSize: 12, lineHeight: '14.4px', fontWeight: 400,
  },
  agentSourceIcon: { flex: 'none', width: 12, height: 12, display: 'grid', placeItems: 'center', overflow: 'hidden' },
  agentSourceText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selfTopicBadge: {
    maxWidth: 'min(600px, 100%)', minWidth: 0, height: 24, display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '0 6px', border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.panel, color: arkmeTheme.secondary,
    font: 'inherit', fontSize: 11, lineHeight: '14px', cursor: 'pointer',
  },
  selfTopicBadgeIcon: { width: 13, height: 13, flex: 'none' },
  selfTopicBadgeText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selfTopicBadgeChevron: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 15, lineHeight: 1 },
  bubble: { maxWidth: 'min(600px, 100%)', minWidth: 0, padding: '10px 13px', overflow: 'hidden', overflowWrap: 'anywhere', wordBreak: 'break-word', borderRadius: '5px 16px 16px 16px', boxSizing: 'border-box', cursor: 'pointer', border: '1px solid rgba(29,32,40,.035)' },
  bubbleMe: { background: arkmeTheme.messageOwn, borderColor: 'rgba(83,97,145,.045)', borderRadius: '16px 5px 16px 16px', '--arkme-bubble-fade': arkmeTheme.messageOwn } as CSSProperties,
  bubbleOther: { background: arkmeTheme.messageOther, '--arkme-bubble-fade': arkmeTheme.messageOther } as CSSProperties,
  forwardBubble: { width: 354, maxWidth: '100%', minWidth: 0, padding: '13px 15px' },
  sharedRecordingBubble: {
    width: '100%', maxWidth: '100%', minWidth: 0, padding: '18px 21px',
    borderRadius: 12, background: arkmeTheme.base, borderColor: arkmeTheme.border,
    boxShadow: 'none', '--arkme-bubble-fade': arkmeTheme.base,
  } as CSSProperties,
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: '20px' },
  meta: { color: arkmeTheme.tertiary, fontSize: 11 },
  polishMeta: { minHeight: 14, marginBottom: 2, color: colors.secondary, fontSize: 10, lineHeight: '14px', display: 'flex', gap: 8, alignItems: 'center' },
  retry: { border: 0, padding: 0, background: 'transparent', color: arkmeTheme.danger, cursor: 'pointer', fontSize: 11 },
  notice: { alignSelf: 'center', maxWidth: 520, padding: '8px 12px 0', color: colors.secondary, textAlign: 'center', fontSize: 13, lineHeight: '16px' },
  memberJoinNotice: { alignSelf: 'center', width: '100%', boxSizing: 'border-box', color: arkmeTheme.caption, textAlign: 'center' },
  memberJoinTime: {
    width: 'fit-content', margin: '0 auto', padding: '4px 6px', boxSizing: 'border-box',
    color: arkmeTheme.caption, fontSize: 12, lineHeight: '14.4px', textAlign: 'center',
  },
  memberJoinLine: {
    width: 'clamp(240px, calc(100% - 120px), 640px)', maxWidth: 'calc(100% - 24px)', margin: '0 auto',
    paddingTop: 8, overflow: 'hidden', color: arkmeTheme.caption, fontSize: 13, lineHeight: '15.6px',
    textAlign: 'center', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box',
  },
  memberJoinLink: { display: 'inline', padding: 0, border: 0, background: 'transparent', color: arkmeTheme.info, cursor: 'pointer', font: 'inherit', fontWeight: 500, lineHeight: 'inherit' },
  sentinel: { width: '100%', height: 1 },
  loading: { textAlign: 'center', color: colors.secondary, fontSize: 12, padding: 6 },
  composer: { ...arkmeConversationComposerLayout.composer, background: '#fff' },
  selectBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 35, minHeight: 72, display: 'flex',
    alignItems: 'center', justifyContent: 'center', gap: 'clamp(6px, 1.7vw, 18px)', padding: '7px clamp(8px, 3vw, 16px)', boxSizing: 'border-box',
    borderTop: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.layer2,
  },
  selectBarButton: {
    width: 'clamp(44px, 6vw, 54px)', minWidth: 0, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
    border: 0, padding: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', fontSize: 11,
  },
  selectBarButtonDisabled: { opacity: .38, cursor: 'default' },
  selectBarIconTile: {
    width: 'clamp(30px, 3.8vw, 34px)', height: 'clamp(30px, 3.8vw, 34px)', display: 'grid', placeItems: 'center', borderRadius: 7, background: arkmeTheme.elevated,
    color: arkmeTheme.text, boxShadow: 'none',
  },
  selectBarLabel: { lineHeight: '15px', whiteSpace: 'nowrap' },
  forwardTargetBackdrop: {
    position: 'absolute', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center',
    padding: 48, boxSizing: 'border-box', background: 'rgba(19,22,26,.30)',
  },
  forwardTargetDialog: {
    width: 'min(520px, 100%)', height: 'min(660px, 100%)', minHeight: 'min(520px, 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: `1px solid ${colors.border}`, borderRadius: 16, background: arkmeTheme.base,
    boxShadow: '0 22px 64px rgba(20,23,31,.24)',
  },
  forwardTargetHeader: {
    height: 54, flex: 'none', display: 'grid', gridTemplateColumns: '54px 1fr 54px', alignItems: 'center', padding: 0,
    boxSizing: 'border-box',
  },
  forwardTargetTitle: { minWidth: 0, margin: 0, textAlign: 'center', color: colors.text, fontSize: 16, lineHeight: '22px', fontWeight: 600 },
  forwardTargetClose: { width: 44, height: 44, border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', fontSize: 30, lineHeight: '30px' },
  forwardTargetSearchWrap: {
    position: 'relative', margin: '4px 18px 12px', height: 38, flex: 'none',
  },
  forwardTargetSearchIcon: {
    position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 17, height: 17,
    color: arkmeTheme.caption, pointerEvents: 'none',
  },
  forwardTargetSearch: {
    width: '100%', height: '100%', border: 0, borderRadius: 10,
    padding: '0 12px 0 40px', boxSizing: 'border-box', background: arkmeTheme.layer2, color: colors.text, outline: 'none',
    fontSize: 13,
  },
  forwardTargetList: { flex: 1, minHeight: 0, overflowY: 'auto', margin: 0, padding: '4px 18px 18px', listStyle: 'none' },
  forwardTargetRow: {
    width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: '20px 36px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, padding: '9px 8px',
    boxSizing: 'border-box', border: 0, borderRadius: 8, background: 'transparent', color: colors.text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  forwardTargetRowSelected: {},
  forwardTargetCheck: {
    width: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: 999, border: `1px solid ${arkmeTheme.tertiary}`,
    color: 'transparent', boxSizing: 'border-box', fontSize: 15, lineHeight: 1,
    opacity: .4,
  },
  forwardTargetCheckSelected: { borderColor: arkmeTheme.text, background: arkmeTheme.text, color: arkmeTheme.base, opacity: 1 },
  forwardTargetText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '22px', fontWeight: 500 },
  forwardTargetMeta: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  forwardTargetTime: { color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
  forwardTargetStatus: { padding: '16px 18px 28px', color: colors.secondary, textAlign: 'center', fontSize: 12, lineHeight: '18px' },
  forwardTargetFooter: {
    flex: 'none', padding: '10px 16px 14px', borderTop: `1px solid ${colors.border}`, boxSizing: 'border-box',
    background: arkmeTheme.base,
  },
  forwardTargetRecipients: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '0 2px', color: colors.text, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  forwardTargetAvatarStack: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' },
  forwardTargetFooterDivider: { height: 1, margin: '8px 2px 0', background: colors.border },
  forwardTargetPreview: {
    position: 'relative', minHeight: 34, display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) 28px', alignItems: 'center', gap: 8,
    padding: '0 2px 2px', marginTop: 6, boxSizing: 'border-box',
  },
  forwardTargetPreviewIcon: { width: 26, height: 32, color: colors.secondary, display: 'grid', placeItems: 'center' },
  forwardTargetPreviewText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetPreviewTitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.text, fontSize: 12, lineHeight: '16px', fontWeight: 400 },
  forwardTargetPreviewSubtitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px' },
  forwardTargetPreviewClose: {
    width: 28, height: 28, borderRadius: 14, border: 0, background: 'transparent',
    color: arkmeTheme.tertiary, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
  },
  forwardTargetComposer: {
    position: 'relative', minHeight: 54, marginTop: 6, boxSizing: 'border-box', borderRadius: 12, background: arkmeTheme.layer2,
  },
  forwardTargetCommentInput: {
    width: '100%', minWidth: 0, minHeight: 54, maxHeight: 102, resize: 'none', border: 0, outline: 'none',
    padding: '17px 66px 17px 16px', boxSizing: 'border-box', background: 'transparent', color: colors.text,
    fontSize: 14, lineHeight: '20px', fontFamily: 'inherit',
  },
  forwardTargetSend: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    width: 40, height: 40, border: 0, borderRadius: 999, display: 'grid', placeItems: 'center',
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', padding: 0,
  },
  forwardTargetSendDisabled: { opacity: .45, cursor: 'default' },
  forwardTargetSendError: { margin: '8px 2px 0', color: colors.danger, fontSize: 12, lineHeight: '16px' },
  copyLinkDetailPanel: {
    position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 10,
    width: 'min(440px, 100%)', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.borderSoft}`,
    boxShadow: '-12px 0 28px rgba(29,32,40,.055)',
  },
  copyLinkDetailHeader: {
    height: 58, flex: 'none', position: 'relative', display: 'grid', placeItems: 'center',
    padding: '0 92px 0 58px', boxSizing: 'border-box',
  },
  copyLinkDetailTitle: {
    margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.text, textAlign: 'center', fontSize: 16, lineHeight: '22px', fontWeight: 600,
  },
  copyLinkDetailSubtitle: {
    marginTop: 1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.tertiary, textAlign: 'center', fontSize: 11, lineHeight: '15px',
  },
  copyLinkDetailHeaderActions: {
    position: 'absolute', right: 10, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 2,
  },
  copyLinkDetailHeaderButton: {
    width: 40, height: 44, border: 0, padding: 0, borderRadius: 10, display: 'grid', placeItems: 'center',
    background: 'transparent', color: arkmeTheme.text, cursor: 'pointer',
  },
  copyLinkDetailCloseButton: { color: arkmeTheme.tertiary, fontSize: 28, lineHeight: 1 },
  copyLinkDetailBody: {
    flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '18px 30px 8px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column',
  },
  copyLinkDetailRecord: { display: 'grid', gridTemplateColumns: '46px minmax(0, 1fr)', alignItems: 'flex-start', gap: 14 },
  copyLinkDetailPlaceholderAvatar: {
    width: 46, height: 46, flex: 'none', borderRadius: 999, display: 'grid', placeItems: 'center',
    background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 15, fontWeight: 600, overflow: 'hidden',
  },
  copyLinkDetailAvatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  copyLinkDetailRecordMeta: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 2 },
  copyLinkDetailRecordSender: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', fontWeight: 600,
  },
  copyLinkDetailRecordTime: { color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  copyLinkDetailRecordContent: {
    gridColumn: '1 / 3', marginTop: 10, minWidth: 0, color: arkmeTheme.text, textAlign: 'left',
    fontSize: 17, lineHeight: '27px', wordBreak: 'break-word', overflowWrap: 'anywhere',
  },
  copyLinkDetailDivider: { flex: 'none', height: 1, background: arkmeTheme.borderSoft, margin: '8px 0 14px' },
  copyLinkDetailExtensionTitle: { margin: '0 0 14px', color: arkmeTheme.secondary, fontSize: 14, lineHeight: '20px' },
  copyLinkDetailExtensionList: { display: 'flex', flexDirection: 'column' },
  copyLinkDetailExtensionItem: {
    display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: 10, alignItems: 'flex-start',
    padding: '10px 0 14px', marginBottom: 12, borderBottom: `1px solid ${arkmeTheme.borderSoft}`,
  },
  copyLinkDetailExtensionHead: { minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  copyLinkDetailExtensionSender: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.text, fontSize: 12, lineHeight: '18px', fontWeight: 600,
  },
  copyLinkDetailExtensionTime: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  copyLinkDetailExtensionContent: {
    marginTop: 4, minWidth: 0, color: arkmeTheme.text, fontSize: 14, lineHeight: '22px',
    wordBreak: 'break-word', overflowWrap: 'anywhere',
  },
  copyLinkDetailMultiList: { display: 'flex', flexDirection: 'column', gap: 24 },
  copyLinkDetailMultiRow: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', alignItems: 'flex-start', gap: 10 },
  copyLinkDetailMultiContent: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 },
  copyLinkDetailFooter: {
    flex: 'none', boxSizing: 'border-box', background: arkmeTheme.base,
  },
  copyLinkDetailGeneratedAt: {
    minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '2px 16px', boxSizing: 'border-box', color: arkmeTheme.tertiary, textAlign: 'center', fontSize: 11, lineHeight: '16px',
  },
  copyLinkDetailFooterDivider: { height: 1, background: arkmeTheme.borderSoft },
  copyLinkDetailInputArea: { padding: '12px 16px 12px', boxSizing: 'border-box' },
  copyLinkDetailInputBar: { position: 'relative', minHeight: 54, borderRadius: 12, background: arkmeTheme.subtle, boxSizing: 'border-box' },
  copyLinkDetailInputIcon: {
    position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
    width: 18, height: 18, display: 'grid', placeItems: 'center', color: arkmeTheme.tertiary,
  },
  copyLinkDetailInput: {
    width: '100%', minHeight: 54, maxHeight: 112, minWidth: 0, border: 0, outline: 'none', resize: 'none',
    padding: '17px 66px 17px 46px', boxSizing: 'border-box', background: 'transparent', color: arkmeTheme.text,
    fontSize: 14, lineHeight: '20px', fontFamily: 'inherit',
  },
  copyLinkDetailInputSend: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    width: 40, height: 40, border: 0, borderRadius: 999, display: 'grid', placeItems: 'center',
    background: arkmeTheme.text, color: arkmeTheme.base, cursor: 'pointer', padding: 0,
  },
  copyLinkDetailInputSendDisabled: {
    background: arkmeTheme.layer2, color: arkmeTheme.caption, opacity: .72, cursor: 'default',
  },
  copyLinkDetailSendError: {
    margin: '8px 2px 0', color: colors.danger, fontSize: 12, lineHeight: '16px',
  },
  copyLinkDetailStatus: {
    flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 28,
    color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', textAlign: 'center',
  },
  copyLinkDetailError: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  copyLinkDetailRetry: { border: 0, padding: 0, background: 'transparent', color: arkmeTheme.info, cursor: 'pointer', font: 'inherit' },
  copyLinkDetailContentLabel: { margin: '6px 0 0', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  composerInner: {
    ...arkmeConversationComposerLayout.composerInner,
    border: `1px solid ${colors.border}`,
    background: arkmeTheme.input, boxShadow: arkmeTheme.shadow,
  },
  composerStack: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  composerHint: { alignSelf: 'flex-end', margin: '4px 4px 0 0', color: arkmeTheme.tertiary, fontSize: 10, lineHeight: '14px' },
  textarea: {
    ...arkmeConversationComposerLayout.textarea,
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: { ...arkmeConversationComposerLayout.tools },
  toolGroup: { display: 'flex', alignItems: 'center', gap: 2 },
  composerSendArea: { display: 'flex', alignItems: 'center', minWidth: 0 },
  composerStats: { display: 'flex', alignItems: 'center', gap: 10, marginRight: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap' },
  composerTimeToggle: { height: 18, display: 'flex', alignItems: 'center', gap: 4, border: 0, padding: 0, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', font: 'inherit' },
  plus: { width: 34, height: 34, border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 22, lineHeight: '30px' },
  addMenu: { position: 'absolute', left: 0, bottom: 54, zIndex: 20, width: 210, padding: '6px 0', borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.panel, boxShadow: '0 12px 32px rgba(0,0,0,.15)' },
  addMenuItem: { width: '100%', border: 0, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 14, textAlign: 'left' },
  menuDivider: { height: 1, margin: '4px 0', background: colors.border },
  attachments: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px' },
  uploadStatus: { padding: '0 14px', color: colors.secondary, fontSize: 12 },
  mentionSuggestions: {
    position: 'absolute', left: 12, right: 12, bottom: 'calc(100% + 8px)', zIndex: 22,
    maxHeight: 252, overflowY: 'auto', padding: 6, boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.panel,
    boxShadow: '0 12px 32px rgba(0,0,0,.15)',
  },
  mentionSuggestionRow: {
    width: '100%', minWidth: 0, height: 40, padding: '6px 8px', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8,
    background: 'transparent', color: colors.text, cursor: 'pointer', textAlign: 'left',
  },
  mentionSuggestionRowActive: { background: arkmeTheme.hover },
  mentionSuggestionAvatar: { width: 28, height: 28, flex: 'none', overflow: 'hidden', borderRadius: 999, display: 'grid', placeItems: 'center' },
  mentionSuggestionBotAvatar: {
    width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 999,
    background: arkmeTheme.subtle, color: colors.text,
    border: `1px solid ${colors.border}`, boxSizing: 'border-box',
  },
  mentionSuggestionText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  mentionSuggestionName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '17px', fontWeight: 500 },
  mentionSuggestionSecondary: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 11, lineHeight: '15px' },
  mentionSuggestionsEmpty: { padding: '8px 10px', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 9, background: '#171923',
    color: arkmeTheme.foreground, cursor: 'pointer', transform: 'translateY(-2px)', transition: 'background-color 100ms ease',
  },
  forwardDrawerDismiss: { position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, left: 0, zIndex: 9, background: 'transparent' },
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
    && (previous?.status !== 'authenticated' || previous.userId !== next.userId || previous.environment !== next.environment)
}

export function arkmeArkoSurfaceKey(auth: ArkmeAuthSnapshot | undefined): number | 'authenticated' | 'logged-out' {
  if (auth?.status !== 'authenticated') return 'logged-out'
  return auth.userId ?? 'authenticated'
}

export function ArkmeTimelineAgentSourceBadge({ item }: { item: ArkmeTimelineItem }) {
  if (item.agentSource === undefined) return null
  return <span style={styles.agentSource} data-arkme-agent-source={item.agentSource.kind}>
    <span style={styles.agentSourceIcon} aria-hidden><AgentAssistantIcon size={12} /></span>
    <span style={styles.agentSourceText}>{item.agentSource.label}</span>
  </span>
}

export function arkmeTimelineSelfTopicSource(
  item: ArkmeTimelineItem,
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem | undefined {
  const topic = item.selfTopic
  if (topic === undefined) return undefined
  const resolved = sources.find(source => source.kind === 'topic' && source.topicHierarchyKey === topic.topicHierarchyKey)
  if (resolved !== undefined) return resolved
  if (topic.sourceRef === undefined || topic.title === undefined) return undefined
  return {
    sourceRef: topic.sourceRef,
    kind: 'topic',
    displayName: topic.title,
    activeAtMillis: 0,
    unreadCount: 0,
  }
}

export function ArkmeTimelineSelfTopicBadge({
  topic,
  onSelect,
}: {
  topic: ArkmeSourceItem
  onSelect: (source: ArkmeSourceItem) => void
}) {
  return <button
    type="button"
    data-arkme-self-topic-badge={topic.displayName}
    aria-label={`查看主题「${topic.displayName}」`}
    style={styles.selfTopicBadge}
    onClick={event => {
      event.stopPropagation()
      onSelect(topic)
    }}
  ><svg aria-hidden viewBox="0 0 16 16" style={styles.selfTopicBadgeIcon}>
      <path d="M3.25 2.75h9.5v10.5h-9.5zM5.25 5.25h5.5M5.25 7.9h3.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg><span style={styles.selfTopicBadgeText}>{topic.displayName}</span><span aria-hidden style={styles.selfTopicBadgeChevron}>›</span>
  </button>
}

export function arkmeShouldBeginWechat(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
  ownsQrLogin = true,
): boolean {
  return ownsQrLogin
    && authView === 'login'
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

function relatedQuickNoteReferenceExpired(error: unknown): boolean {
  return error instanceof ArkmeClientError && error.body.code === 'related-quick-note-ref-expired'
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M'); qr.addData(content); qr.make(); return qr.createDataURL(6, 12)
}

export function arkmeClipboardFiles(clipboardData: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  return itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files)
}
export function arkmeClipboardImageFiles(clipboardData: Pick<DataTransfer, 'files' | 'items'>): File[] {
  return arkmeClipboardFiles(clipboardData).filter(file => file.type.toLowerCase().startsWith('image/'))
}

export function arkmeMessageCopyText(item: ArkmeTimelineItem): string {
  const title = item.title.trim()
  const text = item.textContent.trim()
  if (title !== '' && text !== '') return `${title}\n${text}`
  if (text !== '') return text
  if (title !== '') return title
  if (item.forwardRecords !== undefined) return item.forwardRecords.title
  if (item.sharedRecording !== undefined) return `${item.sharedRecording.title}\n${item.sharedRecording.summary}`.trim()
  if ((item.contentBlocks?.length ?? 0) > 0) return '非文本内容'
  return ''
}

export function arkmeTimelineMessageActionRef(item: ArkmeTimelineItem): string {
  return item.messageActionRef?.trim() ?? ''
}

const ARKME_MESSAGE_ACTION_MENU_LABELS = ['复制', '复制链接', '多选', '转发'] as const
const ARKME_MESSAGE_REPORT_ACTION_LABEL = '举报'
const ARKME_MESSAGE_ACTION_DETAIL_LABEL = '详情'
const ARKME_MESSAGE_SELECT_ACTION_LABELS = ['复制文本', '复制链接', '转发', '退出多选'] as const

export function arkmeMessageActionMenuLabels(): readonly string[] {
  return ARKME_MESSAGE_ACTION_MENU_LABELS
}

export function arkmeMessageActionMenuRowCount(item?: ArkmeTimelineItem, source?: ArkmeSourceItem): number {
  return ARKME_MESSAGE_ACTION_MENU_LABELS.length
    + (item !== undefined && arkmeCanReportTimelineMessage(source, item) ? 1 : 0)
    + (item !== undefined && arkmeCanOpenMessageSnapshot(item) ? 1 : 0)
}

export function arkmeMessageSelectActionLabels(): readonly string[] {
  return ARKME_MESSAGE_SELECT_ACTION_LABELS
}

export function arkmeCanCopySelectedMessageText(selectedCount: number, actionBusy: boolean): boolean {
  return selectedCount === 1 && !actionBusy
}

export function arkmeSelectedTimelineItems(
  items: readonly ArkmeTimelineItem[],
  selectedIds: ReadonlySet<string>,
): ArkmeTimelineItem[] {
  return items.filter(item => selectedIds.has(item.itemUid) && arkmeTimelineMessageActionRef(item) !== '')
}

export async function arkmeCopyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the old textarea path for embedded WebViews without clipboard grants.
    }
  }
  if (typeof document === 'undefined') throw new Error('复制失败，请稍后重试')
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  const selection = document.getSelection()
  const ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (selection !== null) {
    selection.removeAllRanges()
    for (const range of ranges) selection.addRange(range)
  }
  if (!copied) throw new Error('复制失败，请稍后重试')
}

export function arkmeForwardableTargetSources(
  rootSources: readonly ArkmeSourceItem[],
  sendToSelfSources: readonly ArkmeSourceItem[],
  aggregateSource?: ArkmeSourceItem,
): ArkmeSourceItem[] {
  const targets = new Map<string, ArkmeSourceItem>()
  const addChatTarget = (source: ArkmeSourceItem | undefined) => {
    if (source === undefined || targets.has(source.sourceRef)) return
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') return
    targets.set(source.sourceRef, source)
  }
  const addSendToSelfRoot = (source: ArkmeSourceItem | undefined) => {
    if (source === undefined || source.kind !== 'send_to_self' || targets.has(source.sourceRef)) return
    targets.set(source.sourceRef, source)
  }
  addSendToSelfRoot(aggregateSource)
  for (const source of sendToSelfSources) addSendToSelfRoot(source)
  for (const source of rootSources) addChatTarget(source)
  return [...targets.values()].slice(0, FORWARD_TARGET_LIMIT)
}

export function arkmeForwardTargetVisibleSources(
  targets: readonly ArkmeSourceItem[],
  keyword: string,
): ArkmeSourceItem[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (normalizedKeyword === '') return [...targets]
  return targets.filter(target => {
    const haystack = `${target.displayName} ${arkmeForwardTargetMeta(target)}`.toLowerCase()
    return haystack.includes(normalizedKeyword)
  })
}

function arkmeForwardTargetMeta(source: ArkmeSourceItem): string {
  switch (source.kind) {
    case 'private_chat': return '私聊'
    case 'group_chat': return '群聊'
    case 'send_to_self': return '默认分类'
    case 'default_category': return '默认分类'
    case 'topic': return '主题'
  }
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

export function arkmeConversationJoinEventsInLoadedWindow(
  events: readonly ArkmeConversationMemberJoinEvent[],
  items: readonly ArkmeTimelineItem[],
  hasMore: boolean,
): ArkmeConversationMemberJoinEvent[] {
  if (!hasMore) return [...events]
  if (items.length === 0) return []
  const oldestLoadedMillis = Math.min(...items.map(item => item.sendAtMillis).filter(value => value > 0))
  if (!Number.isFinite(oldestLoadedMillis)) return []
  return events.filter(event => event.occurredAtMillis >= oldestLoadedMillis)
}

export function arkmeMemberJoinDisplayName(person: ArkmeConversationMemberJoinPerson, maxCount: number): string {
  if (person.isSelf) return '你'
  const normalized = person.displayName.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  const characters = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(normalized)]
    .map(item => item.segment)
  if (characters.length <= maxCount) return normalized
  return `${characters.slice(0, maxCount).join('')}...`
}

export function arkmeMemberJoinTimeLabel(value: number, nowMillis = Date.now()): string {
  const date = new Date(value)
  const now = new Date(nowMillis)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayOffset = Math.round((start - target) / 86_400_000)
  const time = timeLabel(value)
  if (dayOffset === 0) return time
  if (dayOffset === 1) return `昨天 ${time}`
  if (dayOffset === 2) return `前天 ${time}`
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${time}`
}

export function arkmeVisibleMemberJoinInvitees(
  event: ArkmeConversationMemberJoinEvent,
): ArkmeConversationMemberJoinPerson[] {
  if (event.invitees.length <= 2) return [...event.invitees]
  const visible = event.invitees.slice(0, 2)
  if (visible.some(person => person.isSelf)) return visible
  const self = event.invitees.find(person => person.isSelf)
  if (self !== undefined) visible[visible.length - 1] = self
  return visible
}

export function arkmeSourceDestinationLabel(source: ArkmeSourceItem | undefined): string {
  return source?.displayName ?? '发给自己'
}

function arkmeComposerPlaceholderTargetForSource(
  source: ArkmeSourceItem | undefined,
  currentMemberCount: number,
): ArkmeComposerPlaceholderTarget {
  if (source === undefined || source.kind === 'send_to_self'
    || source.kind === 'default_category' || source.kind === 'topic') return { kind: 'record' }
  if (source.kind === 'private_chat') return { kind: 'private_chat', displayName: source.displayName }
  const memberCount = arkmeComposerGroupMemberCount(currentMemberCount, source.groupAvatar?.memberCount)
  return {
    kind: 'group_chat',
    displayName: source.displayName,
    ...(memberCount === undefined ? {} : { memberCount }),
  }
}

export interface ArkmeComposerMentionTrigger {
  startIndex: number
  endIndex: number
  query: string
}

export function arkmeComposerMentionTrigger(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): ArkmeComposerMentionTrigger | undefined {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)))
  const end = Math.max(0, Math.min(text.length, Math.trunc(selectionEnd)))
  if (start !== end) return undefined
  const prefix = text.slice(0, start)
  const atIndex = prefix.lastIndexOf('@')
  if (atIndex < 0) return undefined
  const previousChar = atIndex > 0 ? text.charAt(atIndex - 1) : ''
  if (previousChar !== '' && !/[\s([{（【,，。；;：:！!?？、]/u.test(previousChar)) return undefined
  const query = text.slice(atIndex + 1, start)
  if (/[\s@]/u.test(query)) return undefined
  return { startIndex: atIndex, endIndex: start, query }
}

export function arkmeMentionCandidateMatches(
  member: Pick<ArkmeConversationMemberItem, 'displayName'> & { memberName?: string; secondaryName?: string },
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return [member.displayName, member.memberName, member.secondaryName]
    .some(value => (value ?? '').toLowerCase().includes(normalizedQuery))
}

type ArkmeMentionCandidate =
  | { kind: 'all'; displayName: '所有人' }
  | { kind: 'bot'; displayName: string; botRef: string; secondaryName?: string; avatarRef?: string }
  | ({ kind: 'member'; mentionRef: string } & ArkmeConversationMemberItem)

export function arkmeMentionCandidatePrimaryText(
  member: { kind: 'all' | 'bot' | 'member'; displayName: string; memberName?: string; secondaryName?: string },
): string {
  const displayName = member.displayName.trim() || '成员'
  if (member.kind !== 'member') return displayName
  const secondaryName = (member.secondaryName ?? member.memberName ?? '').trim()
  if (secondaryName !== '' && secondaryName !== displayName) return `${displayName}（${secondaryName}）`
  return displayName
}

function arkmeAllMentionMatches(query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  return normalizedQuery === '' || '所有人'.toLowerCase().includes(normalizedQuery)
}

export function arkmeGroupMentionCandidates(
  query: string,
  bots: readonly ArkmeGroupBotCandidate[],
  members: readonly ArkmeConversationMemberItem[],
): ArkmeMentionCandidate[] {
  const candidates: ArkmeMentionCandidate[] = []
  if (arkmeAllMentionMatches(query)) {
    candidates.push({ kind: 'all', displayName: '所有人' })
  }
  candidates.push(...bots
    .filter(bot => bot.installed && arkmeMentionCandidateMatches({
      displayName: bot.name,
      secondaryName: bot.description,
    }, query))
    .map(bot => ({
      kind: 'bot' as const,
      botRef: bot.botRef,
      displayName: bot.name,
      ...(bot.description.trim() === '' ? {} : { secondaryName: bot.description.trim() }),
      ...(bot.avatarRef === undefined ? {} : { avatarRef: bot.avatarRef }),
    })))
  candidates.push(...members
    .filter((member): member is ArkmeConversationMemberItem & { mentionRef: string } =>
      !member.isSelf && member.mentionRef !== undefined && arkmeMentionCandidateMatches(member, query))
    .map(member => ({ ...member, kind: 'member' as const })))
  return candidates
}

export interface ArkmeAccountSelfSourcesResolution {
  userId: number
  resolution: ArkmeSelfSourcesResolution
}

export function arkmeAggregateSourceForUser(
  userId: number | undefined,
  state: ArkmeAccountSelfSourcesResolution | undefined,
): ArkmeSourceItem | undefined {
  if (userId === undefined || state?.userId !== userId || state.resolution.status !== 'ready') return undefined
  return state.resolution.aggregateSource
}

function mergeItems(current: ArkmeTimelineItem[], incoming: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const map = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) {
    const previous = map.get(item.itemUid)
    map.set(item.itemUid, {
      ...item,
      ...(previous?.aiPolish !== undefined && item.aiPolish === undefined ? { aiPolish: previous.aiPolish } : {}),
      ...(previous?.recordDurationMillis !== undefined && item.recordDurationMillis === undefined
        ? { recordDurationMillis: previous.recordDurationMillis } : {}),
      ...(previous?.editDurationMillis !== undefined && item.editDurationMillis === undefined
        ? { editDurationMillis: previous.editDurationMillis } : {}),
      ...(previous?.captureContext !== undefined && item.captureContext === undefined
        ? { captureContext: previous.captureContext } : {}),
    })
  }
  return [...map.values()].sort((a, b) => a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid))
}

function applySourceSendResult(
  current: ArkmeTimelineItem[],
  optimisticItemUid: string,
  result: ArkmeSourceSendResult,
): ArkmeTimelineItem[] {
  const returned = current.find(item => item.itemUid === result.itemUid)
  const optimistic = current.find(item => item.itemUid === optimisticItemUid)
  const candidate = returned ?? optimistic
  if (candidate === undefined) return current
  const { aiPolish: _optimisticAiPolish, ...candidateBase } = candidate
  const base = {
    ...candidateBase,
    ...(candidate.recordDurationMillis === undefined && optimistic?.recordDurationMillis !== undefined
      ? { recordDurationMillis: optimistic.recordDurationMillis } : {}),
    ...(candidate.editDurationMillis === undefined && optimistic?.editDurationMillis !== undefined
      ? { editDurationMillis: optimistic.editDurationMillis } : {}),
    ...(candidate.captureContext === undefined && optimistic?.captureContext !== undefined
      ? { captureContext: optimistic.captureContext } : {}),
  }
  const confirmed: ArkmeTimelineItem = {
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
  return mergeItems(
    current.filter(item => item.itemUid !== optimisticItemUid && item.itemUid !== result.itemUid),
    [confirmed],
  )
}

interface ArkmeTimelineViewState {
  sourceKey: string
  items: ArkmeTimelineItem[]
  aiPolishNotices: ArkmeGroupAiPolishNotice[]
  aiPolishSettings: ArkmeGroupAiPolishSnapshot | undefined
  nextCursor: ArkmeTimelineCursor | undefined
  hasMore: boolean
}

function resolveStateAction<Value>(action: SetStateAction<Value>, current: Value): Value {
  return typeof action === 'function' ? (action as (value: Value) => Value)(current) : action
}

function sameStateValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

export function arkmeRealtimeDeltaCoversTimelineGap(
  cached: ArkmeConversationTimelineSnapshot | undefined,
  deltaItems: readonly ArkmeTimelineItem[],
  latestSequence: number | undefined,
): boolean {
  if (cached === undefined || !Number.isSafeInteger(latestSequence) || (latestSequence ?? 0) <= 0) return false
  const cachedSequence = Math.max(
    cached.latestSequence ?? 0,
    ...cached.items.map(item => item.sequence ?? 0),
  )
  const targetSequence = latestSequence ?? 0
  if (targetSequence <= cachedSequence) return false
  if (targetSequence - cachedSequence > deltaItems.length) return false
  const sequences = new Set(deltaItems.flatMap(item => Number.isSafeInteger(item.sequence) && (item.sequence ?? 0) > 0
    ? [item.sequence!]
    : []))
  for (let sequence = cachedSequence + 1; sequence <= targetSequence; sequence += 1) {
    if (!sequences.has(sequence)) return false
  }
  return true
}

function arkmeConversationViewport(root: HTMLDivElement): ArkmeConversationViewportSnapshot {
  const stickToBottom = root.scrollHeight - root.scrollTop - root.clientHeight <= 80
  if (stickToBottom) return { scrollTop: root.scrollTop, stickToBottom: true }
  const rootRect = root.getBoundingClientRect()
  for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom <= rootRect.top || rowRect.top >= rootRect.bottom) continue
    const anchorId = row.dataset.arkmeConversationRow
    if (anchorId !== undefined) {
      return {
        scrollTop: root.scrollTop,
        stickToBottom: false,
        anchorId,
        anchorOffset: rowRect.top - rootRect.top,
      }
    }
  }
  return { scrollTop: root.scrollTop, stickToBottom: false }
}

function arkmeConversationAnchorOffset(root: HTMLDivElement, anchorId: string | undefined): number | undefined {
  if (anchorId === undefined) return undefined
  const rootTop = root.getBoundingClientRect().top
  for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
    if (row.dataset.arkmeConversationRow === anchorId) return row.getBoundingClientRect().top - rootTop
  }
  return undefined
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

export function arkmeTimelineSenderName(item: ArkmeTimelineItem, profile?: ArkmeUserProfile): string {
  if (!item.isMe || profile === undefined) return item.senderName
  return profile.displayName.trim() || profile.nickname.trim() || item.senderName
}

export function arkmeTimelineAvatarRef(item: ArkmeTimelineItem, profile?: ArkmeUserProfile): string | undefined {
  const itemAvatarRef = item.avatarRef?.trim()
  if (itemAvatarRef !== undefined && itemAvatarRef !== '') return itemAvatarRef
  if (!item.isMe) return undefined
  const profileAvatarRef = profile?.avatarRef.trim()
  return profileAvatarRef === '' ? undefined : profileAvatarRef
}

type ArkmeMessageSelectionAnchor = 'avatar' | 'card-center'

/** Selection placement follows the visible business object instead of assuming every row owns an avatar. */
function arkmeMessageSelectionAnchor(
  item: Pick<ArkmeTimelineItem, 'sharedRecording'>,
): ArkmeMessageSelectionAnchor {
  return item.sharedRecording === undefined ? 'avatar' : 'card-center'
}

/** Every conversation timeline shows avatars, including the aggregate and personal topic views. */
export function arkmeSourceShowsMessageAvatars(source: ArkmeSourceItem | undefined): boolean {
  if (source === undefined) return false
  return isArkmeSelfWorkspaceSource(source) || source.kind === 'private_chat' || source.kind === 'group_chat'
}

function MessageAvatar(props: {
  avatarRef?: string
  member?: ArkmeConversationMemberItem
  profileEnabled: boolean
  onOpen: (member: ArkmeConversationMemberItem) => void
  onContextMenu: (member: ArkmeConversationMemberItem, anchorRect: DOMRect) => void
}) {
  const member = props.member
  const avatar = <ArkmeUserAvatar {...(props.avatarRef === undefined ? {} : { avatarRef: props.avatarRef })} size={ARKME_MESSAGE_AVATAR_SIZE} label="消息头像" />
  if (member === undefined) return <span data-arkme-message-avatar="true" style={styles.messageAvatar} aria-hidden>{avatar}</span>
  return <button
    type="button"
    data-arkme-message-avatar="true"
    style={{ ...styles.messageAvatar, padding: 0, border: 0, cursor: props.profileEnabled ? 'pointer' : 'default' }}
    aria-label={props.profileEnabled
      ? member.isSelf ? '查看我的用户卡片' : `查看 ${member.displayName}`
      : `${member.displayName} 的消息头像`}
    onClick={event => {
      event.stopPropagation()
      if (props.profileEnabled) props.onOpen(member)
    }}
    onContextMenu={event => {
      event.preventDefault()
      event.stopPropagation()
      props.onContextMenu(member, event.currentTarget.getBoundingClientRect())
    }}
  >{avatar}</button>
}

function ArkmeMessageSelectionControl(props: {
  anchor: ArkmeMessageSelectionAnchor
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return <button
    type="button"
    role="checkbox"
    data-arkme-select-check="true"
    data-arkme-selection-anchor={props.anchor}
    aria-checked={props.checked}
    aria-label={props.checked ? '取消选择消息' : '选择消息'}
    disabled={props.disabled}
    style={{
      ...styles.selectCheck,
      ...(props.anchor === 'avatar' ? styles.selectCheckAvatar : styles.selectCheckCardCenter),
      opacity: props.disabled ? .35 : 1,
    }}
    onClick={event => { event.stopPropagation(); props.onToggle() }}
  ><span style={{
      ...styles.selectCheckCircle,
      ...(props.checked ? styles.selectCheckActive : {}),
    }}>
      {props.checked ? <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3.08 7.08L5.9 9.82L10.92 4.18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg> : null}
    </span></button>
}

export function ArkmeMemberJoinNotice(props: {
  rowId: string
  event: ArkmeConversationMemberJoinEvent
  membersByRef: ReadonlyMap<string, ArkmeConversationMemberItem>
  startsGroup?: boolean
  onOpenMember: (member: ArkmeConversationMemberItem) => void
}) {
  const visibleInvitees = arkmeVisibleMemberJoinInvitees(props.event)
  const inviteeMaxCount = visibleInvitees.length > 1 ? 10 : 14
  const renderPerson = (person: ArkmeConversationMemberJoinPerson, maxCount: number, key: string) => {
    const label = arkmeMemberJoinDisplayName(person, maxCount)
    const member = person.memberRef === undefined ? undefined : props.membersByRef.get(person.memberRef)
    return member === undefined
      ? <span key={key}>{label}</span>
      : <button key={key} type="button" style={styles.memberJoinLink}
        aria-label={`查看 ${label}`} onClick={() => { props.onOpenMember(member) }}>{label}</button>
  }
  return <li
    data-arkme-conversation-row={props.rowId}
    data-arkme-member-join-event={props.event.eventId}
    data-arkme-member-join-group-start={props.startsGroup === false ? 'false' : 'true'}
    style={{ ...styles.memberJoinNotice, marginTop: props.startsGroup === false ? 20 : 26 }}
  >
    <div style={styles.memberJoinTime}>{arkmeMemberJoinTimeLabel(props.event.occurredAtMillis)}</div>
    <div style={styles.memberJoinLine}>
      {renderPerson(props.event.inviter, 14, 'inviter')}
      <span>{` ${props.event.action === 'direct_add' ? '添加' : '邀请'} `}</span>
      {visibleInvitees.map((person, index) => <Fragment key={`${person.memberRef ?? person.displayName}:${index}`}>
        {index > 0 && <span>、</span>}
        {renderPerson(person, inviteeMaxCount, `invitee:${person.memberRef ?? person.displayName}:${index}`)}
      </Fragment>)}
      {props.event.invitees.length > 2 && <span>{`等${String(props.event.invitees.length)}人`}</span>}
      <span> 加入群聊</span>
    </div>
  </li>
}

export function ArkmeTimelineMessageHeader({
  item,
  profile,
}: {
  item: ArkmeTimelineItem
  profile?: ArkmeUserProfile
}) {
  const senderName = arkmeTimelineSenderName(item, profile)
  return <span style={styles.messageHeader}>
    {item.isMe && <span style={styles.meta}>{timeLabel(item.sendAtMillis)}</span>}
    <span style={styles.sender}>{senderName}</span>
    {!item.isMe && <span style={styles.meta}>{timeLabel(item.sendAtMillis)}</span>}
  </span>
}

function normalizedEpochMillis(value: number): number {
  return value > 0 && value < 100_000_000_000 ? value * 1000 : value
}

function forwardDateLabel(value: number): string {
  const millis = normalizedEpochMillis(value)
  if (millis <= 0) return ''
  const date = new Date(millis)
  return `${String(date.getFullYear())}年${String(date.getMonth() + 1)}月${String(date.getDate())}日`
}

function forwardShortTimeLabel(value: number): string {
  const millis = normalizedEpochMillis(value)
  if (millis <= 0) return ''
  const date = new Date(millis)
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function forwardFullTimeLabel(value: number): string {
  const millis = normalizedEpochMillis(value)
  if (millis <= 0) return ''
  const date = new Date(millis)
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function copyLinkDetailDateRange(items: readonly Pick<ArkmeMessageCopyLinkSnapshotItem, 'sendAtMillis'>[]): string {
  const timestamps = items.map(item => normalizedEpochMillis(item.sendAtMillis)).filter(value => value > 0)
  if (timestamps.length === 0) return ''
  const start = Math.min(...timestamps)
  const end = Math.max(...timestamps)
  const startText = forwardDateLabel(start)
  const endText = forwardDateLabel(end)
  return startText === endText ? startText : `${startText} 至 ${endText}`
}

function copyLinkShareUrl(shareWebsite: string, sid: string): string {
  return `${shareWebsite.replace(/\/+$/u, '')}/s/${sid.trim()}`
}

function copyLinkDetailExtensionTarget(detail: ArkmeMessageCopyLinkResolveResult | undefined): { itemIndex: number; parentRecordUid: string } | undefined {
  if (detail === undefined || detail.accessMode !== 'normal') return undefined
  const itemIndex = 0
  const parentRecordUid = detail.sourceAnchors?.[itemIndex]?.recordUid.trim() ?? ''
  if (detail.items[itemIndex] === undefined || parentRecordUid === '') return undefined
  return { itemIndex, parentRecordUid }
}

export function arkmeForwardTargetTimeLabel(value: number, now: number = Date.now()): string {
  const millis = normalizedEpochMillis(value)
  if (millis <= 0) return ''
  const date = new Date(millis)
  if (dayKey(millis) === dayKey(now)) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function arkmeDraftForwardRecordsTitleWithFallback(rawName: string, sourceCount: number, fallbackName: string): string {
  const name = rawName.trim() === '' ? fallbackName.trim() : rawName.trim()
  const titleName = name === '' ? '快记' : name
  if (sourceCount <= 1) return `${titleName}的快记`
  return `${titleName}的${String(sourceCount)}条快记`
}

function arkmeDraftForwardPrivateRecordsTitle(rawCurrentName: string, rawCounterpartName: string, sourceCount: number): string {
  const currentName = rawCurrentName.trim() === '' ? '我' : rawCurrentName.trim()
  const counterpartName = rawCounterpartName.trim() === '' ? '对方' : rawCounterpartName.trim()
  if (sourceCount <= 1) return `${currentName}和${counterpartName}的快记`
  return `${currentName}和${counterpartName}的${String(sourceCount)}条快记`
}

function arkmeForwardRecordPreviewLine(item: ArkmeTimelineItem): string {
  if (item.forwardRecords !== undefined) return '[转发快记]'
  if (item.sharedRecording !== undefined) return '[相关录音]'
  const text = item.textContent.trim().replace(/\s+/g, ' ')
  if (text !== '') return text
  const title = item.title.trim().replace(/\s+/g, ' ')
  if (title !== '') return title
  if ((item.contentBlocks?.length ?? 0) > 0) return '非文本内容'
  return '快记'
}

function arkmeForwardRecordOwnerLabel(item: ArkmeTimelineItem): string {
  const sender = item.senderName.trim()
  return sender === '' ? '原快记' : sender
}

export function arkmeForwardPreviewTitle(items: readonly ArkmeTimelineItem[], source?: ArkmeSourceItem): string {
  const sourceCount = items.length
  if (sourceCount <= 0) return '转发快记'
  if (source?.kind === 'private_chat') {
    return arkmeDraftForwardPrivateRecordsTitle('我', source.displayName, sourceCount)
  }
  if (source?.kind === 'group_chat') {
    return arkmeDraftForwardRecordsTitleWithFallback(source.displayName, sourceCount, '群聊')
  }
  return arkmeDraftForwardRecordsTitleWithFallback(arkmeForwardRecordOwnerLabel(items[0]!), sourceCount, '原快记')
}

export function arkmeForwardPreviewSubtitle(items: readonly ArkmeTimelineItem[]): string {
  const summaryLines = items
    .map(item => `${arkmeForwardRecordOwnerLabel(item)}：${arkmeForwardRecordPreviewLine(item)}`)
    .filter(line => line.trim() !== '')
    .slice(0, 2)
  return summaryLines[0] ?? ''
}

function ArkmeSelectActionIcon({ kind, size = 22 }: { kind: 'copy' | 'link' | 'select' | 'forward' | 'close'; size?: number }) {
  if (kind === 'copy') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M12.4998 0.916504C13.3618 0.916504 14.1884 1.25891 14.7979 1.86841C15.4074 2.4779 15.7498 3.30455 15.7498 4.1665V4.24984H15.8332C16.6772 4.24984 17.4882 4.57822 18.0944 5.1655C18.7007 5.75278 19.0547 6.55287 19.0815 7.3965L19.0832 7.49984V15.8332C19.0832 16.6772 18.7548 17.4882 18.1675 18.0944C17.5802 18.7007 16.7801 19.0547 15.9365 19.0815L15.8332 19.0832H7.49984C6.65578 19.0832 5.84483 18.7548 5.23858 18.1675C4.63233 17.5802 4.27834 16.7801 4.2515 15.9365L4.24984 15.8332V15.7498H4.1665C3.32245 15.7498 2.5115 15.4214 1.90525 14.8342C1.299 14.2469 0.945007 13.4468 0.918171 12.6032L0.916504 12.4998V4.1665C0.916504 3.30455 1.25891 2.4779 1.86841 1.86841C2.4779 1.25891 3.30455 0.916504 4.1665 0.916504H12.4998ZM15.7498 12.4998C15.7498 13.3618 15.4074 14.1884 14.7979 14.7979C14.1884 15.4074 13.3618 15.7498 12.4998 15.7498H5.74984V15.8332C5.74981 16.2822 5.92236 16.714 6.23181 17.0393C6.54125 17.3647 6.9639 17.5586 7.41234 17.5811L7.49984 17.5832H15.8332C16.2822 17.5832 16.714 17.4106 17.0393 17.1012C17.3647 16.7918 17.5586 16.3691 17.5811 15.9207L17.5832 15.8332V7.49984C17.5832 7.05084 17.4106 6.61901 17.1012 6.29367C16.7918 5.96833 16.3691 5.77437 15.9207 5.75192L15.8332 5.74984H15.7498V12.4998ZM12.4998 2.4165H4.1665C3.70237 2.4165 3.25726 2.60088 2.92907 2.92907C2.60088 3.25726 2.4165 3.70237 2.4165 4.1665V12.4998C2.4165 12.7297 2.46177 12.9572 2.54971 13.1695C2.63766 13.3819 2.76656 13.5748 2.92907 13.7373C3.09157 13.8998 3.28449 14.0287 3.49681 14.1166C3.70913 14.2046 3.93669 14.2498 4.1665 14.2498H12.4998C12.7297 14.2498 12.9572 14.2046 13.1695 14.1166C13.3819 14.0287 13.5748 13.8998 13.7373 13.7373C13.8998 13.5748 14.0287 13.3819 14.1166 13.1695C14.2046 12.9572 14.2498 12.7297 14.2498 12.4998V4.1665C14.2498 3.93669 14.2046 3.70913 14.1166 3.49681C14.0287 3.28449 13.8998 3.09157 13.7373 2.92907C13.5748 2.76656 13.3819 2.63766 13.1695 2.54971C12.9572 2.46177 12.7297 2.4165 12.4998 2.4165Z" fill="currentColor" />
  </svg>
  if (kind === 'link') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M13.06 10.9399C15.31 13.1899 15.31 16.8299 13.06 19.0699C10.81 21.3099 7.17003 21.3199 4.93003 19.0699C2.69003 16.8199 2.68003 13.1799 4.93003 10.9399" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.59 13.41C8.25002 11.07 8.25002 7.27001 10.59 4.92001C12.93 2.57001 16.73 2.58001 19.08 4.92001C21.43 7.26001 21.42 11.06 19.08 13.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'select') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M2.58997 5.26183C2.77832 5.45018 3.0236 5.54435 3.27108 5.54435C3.51855 5.54435 3.76603 5.45018 3.95437 5.26183L6.56929 2.64473C6.94598 2.26804 6.94598 1.6592 6.56929 1.28252C6.1926 0.905828 5.58377 0.905828 5.20708 1.28252L3.27108 3.21852L2.64473 2.59216C2.26804 2.21548 1.6592 2.21548 1.28252 2.59216C0.905828 2.96885 0.905828 3.57769 1.28252 3.95437L2.58997 5.26183ZM2.58997 11.9897C2.76956 12.1714 3.01484 12.2722 3.27108 12.2722C3.52731 12.2722 3.7726 12.1714 3.95218 11.9897L6.56929 9.37255C6.94598 8.99586 6.94598 8.38703 6.56929 8.01034C6.1926 7.63365 5.58377 7.63365 5.20708 8.01034L3.27108 9.94634L2.64473 9.31999C2.26804 8.9433 1.6592 8.9433 1.28252 9.31999C0.905828 9.69668 0.905828 10.3055 1.28252 10.6822L2.58997 11.9897ZM2.58997 18.7175C2.76956 18.8993 3.01484 19 3.27108 19C3.52731 19 3.7726 18.8993 3.95218 18.7175L6.56929 16.1004C6.94598 15.7237 6.94598 15.1149 6.56929 14.7382C6.1926 14.3615 5.58377 14.3615 5.20708 14.7382L3.27108 16.6742L2.64473 16.0478C2.26804 15.6711 1.6592 15.6711 1.28252 16.0478C0.905828 16.4245 0.905828 17.0333 1.28252 17.41L2.58997 18.7175ZM9.98566 18H18.0143C18.5587 18 19 17.5513 19 16.9977C19 16.4442 18.5587 15.9954 18.0143 15.9954H9.98566C9.44131 15.9954 9 16.4442 9 16.9977C9 17.5513 9.44131 18 9.98566 18ZM9.98566 4.00456H18.0143C18.5587 4.00456 19 3.55581 19 3.00228C19 2.44875 18.5587 2 18.0143 2H9.98566C9.44131 2 9 2.44875 9 3.00228C9 3.55581 9.44131 4.00456 9.98566 4.00456ZM9.98566 11.0023H18.0143C18.5587 11.0023 19 10.5535 19 10C19 9.44647 18.5587 8.99772 18.0143 8.99772H9.98566C9.44131 8.99772 9 9.44647 9 10C9 10.5535 9.44131 11.0023 9.98566 11.0023Z" fill="currentColor" />
  </svg>
  if (kind === 'forward') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M7.39993 6.31991L15.8899 3.48991C19.6999 2.21991 21.7699 4.29991 20.5099 8.10991L17.6799 16.5999C15.7799 22.3099 12.6599 22.3099 10.7599 16.5999L9.91993 14.0799L7.39993 13.2399C1.68993 11.3399 1.68993 8.22991 7.39993 6.31991Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.1101 13.6501L13.6901 10.0601" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <X size={size} weight="regular" aria-hidden />
}

function ArkmeMessageActionIcon({ kind }: { kind: 'copy' | 'link' | 'select' | 'forward' | 'report' }) {
  if (kind === 'report') return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M4.5 17.25V3.25M5 4H13.45C14.55 4 15.16 5.27 14.48 6.14L13.26 7.7C12.91 8.15 12.91 8.78 13.26 9.23L14.48 10.79C15.16 11.66 14.55 12.93 13.45 12.93H4.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <ArkmeSelectActionIcon kind={kind} size={kind === 'forward' ? 18 : 16} />
}

function ArkmeForwardLinearIcon({ size = 18 }: { size?: number }) {
  return <ArkmeSelectActionIcon kind="forward" size={size} />
}

function ArkmeForwardCloseBorderIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
    <path d="M6 6L10 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 6L6 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ArkmeForwardSubmitIcon() {
  return <ArkmeSelectActionIcon kind="forward" size={22} />
}

function ArkmeCopyLinkDetailInputIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5.25 2.25H11.2L15.75 6.8V17.75H5.25V2.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M11.25 2.5V6.75H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.75 11H13.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M7.75 14H11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}

function ArkmeSearchIcon() {
  return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M8.75 15.5C12.4779 15.5 15.5 12.4779 15.5 8.75C15.5 5.02208 12.4779 2 8.75 2C5.02208 2 2 5.02208 2 8.75C2 12.4779 5.02208 15.5 8.75 15.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13.75 13.75L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

type ArkmeCopyLinkDetailState =
  | { sid: string; status: 'loading' }
  | { sid: string; status: 'ready'; detail: ArkmeMessageCopyLinkResolveResult }
  | { sid: string; status: 'error'; message: string }

function copyLinkSnapshotSenderName(item: ArkmeMessageCopyLinkSnapshotItem): string {
  const sender = item.senderDisplayName.trim()
  if (sender !== '') return sender
  return item.sourceKind === 'agent_message' ? 'Agent' : '未知用户'
}

function CopyLinkRecordAvatar({ item, size = 46 }: { item: ArkmeMessageCopyLinkSnapshotItem; size?: number }) {
  const name = copyLinkSnapshotSenderName(item)
  const avatar = item.senderAvatarUrl?.trim() ?? ''
  const sizedStyle = { ...styles.copyLinkDetailPlaceholderAvatar, width: size, height: size }
  if (/^(https?:|data:|blob:)/iu.test(avatar)) {
    return <span style={sizedStyle} aria-hidden><img src={avatar} alt="" draggable={false} style={styles.copyLinkDetailAvatarImage} /></span>
  }
  if (avatar !== '') {
    return <ArkmeUserAvatar avatarRef={avatar} size={size} label="分享快记头像" />
  }
  return <span style={sizedStyle} aria-hidden>{[...name][0] ?? '?'}</span>
}

function copyLinkSnapshotTimelineItem(item: ArkmeMessageCopyLinkSnapshotItem, index: number): ArkmeTimelineItem {
  const avatar = item.senderAvatarUrl?.trim() ?? ''
  return {
    itemUid: `copy-link:${String(index)}:${String(item.sendAtMillis)}`,
    senderName: copyLinkSnapshotSenderName(item),
    isMe: false,
    sendAtMillis: item.sendAtMillis,
    title: item.title,
    textContent: item.textContent,
    status: 1,
    templateKind: item.templateKind,
    displayKind: item.displayKind,
    ...(avatar !== '' && !/^(https?:|data:|blob:)/iu.test(avatar) ? { avatarRef: avatar } : {}),
  }
}

function CopyLinkDetailDrawer({
  state,
  onClose,
  onRetry,
  onShare,
  draft,
  onDraftChange,
  onSendDraft,
  sendBusy,
  sendDisabled,
  sendError,
  shareWebsite,
}: {
  state: ArkmeCopyLinkDetailState
  onClose: () => void
  onRetry: () => void
  onShare: () => void
  draft: string
  onDraftChange: (value: string) => void
  onSendDraft: () => void
  sendBusy: boolean
  sendDisabled: boolean
  sendError: string
  shareWebsite: string
}) {
  const detail = state.status === 'ready' ? state.detail : undefined
  const title = detail?.displayTitle.trim() || '快记详情'
  const subtitle = detail === undefined ? '' : copyLinkDetailDateRange(detail.items)
  const generatedAt = detail === undefined ? '' : forwardFullTimeLabel(detail.generatedAtMillis)
  const shareDisabled = state.status !== 'ready'
  const renderSingleRecord = (item: ArkmeMessageCopyLinkSnapshotItem) => {
    const snapshot = copyLinkSnapshotTimelineItem(item, 0)
    return <div style={styles.copyLinkDetailRecord}>
      <CopyLinkRecordAvatar item={item} />
      <div style={styles.copyLinkDetailRecordMeta}>
        <span style={styles.copyLinkDetailRecordSender}>{copyLinkSnapshotSenderName(item)}</span>
        {forwardShortTimeLabel(item.sendAtMillis) !== '' && <span style={styles.copyLinkDetailRecordTime}>{forwardShortTimeLabel(item.sendAtMillis)}</span>}
      </div>
      <div style={styles.copyLinkDetailRecordContent}>
        <ArkmeMessageContent
          item={snapshot}
          presentation="detail"
          shareWebsite={shareWebsite}
        />
      </div>
    </div>
  }
  const renderMultiRecord = (item: ArkmeMessageCopyLinkSnapshotItem, index: number) => {
    const snapshot = copyLinkSnapshotTimelineItem(item, index)
    return <div key={`${String(index)}:${String(item.sendAtMillis)}:${copyLinkSnapshotSenderName(item)}`} style={styles.copyLinkDetailMultiRow}>
      <CopyLinkRecordAvatar item={item} size={36} />
      <div style={styles.copyLinkDetailMultiContent}>
        <span style={styles.copyLinkDetailRecordSender}>{copyLinkSnapshotSenderName(item)}</span>
        {forwardShortTimeLabel(item.sendAtMillis) !== '' && <span style={styles.copyLinkDetailRecordTime}>{forwardShortTimeLabel(item.sendAtMillis)}</span>}
        <ArkmeMessageContent
          item={snapshot}
          presentation="detail"
          shareWebsite={shareWebsite}
        />
        {item.mediaItems.length > 0 && <p style={styles.copyLinkDetailContentLabel}>
          {item.mediaItems.map(media => media.fileName.trim()).filter(value => value !== '').slice(0, 2).join('、')}
        </p>}
      </div>
    </div>
  }
  const renderExtensionItem = (item: ArkmeMessageCopyLinkExtensionItem) => {
    const snapshot = copyLinkSnapshotTimelineItem(item, 0)
    return <div key={item.recordUid} style={styles.copyLinkDetailExtensionItem}>
      <CopyLinkRecordAvatar item={item} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={styles.copyLinkDetailExtensionHead}>
          <span style={styles.copyLinkDetailExtensionSender}>{copyLinkSnapshotSenderName(item)}</span>
          {forwardShortTimeLabel(item.sendAtMillis) !== '' && <span style={styles.copyLinkDetailExtensionTime}>{forwardShortTimeLabel(item.sendAtMillis)}</span>}
        </div>
        <div style={styles.copyLinkDetailExtensionContent}>
          <ArkmeMessageContent
            item={snapshot}
            presentation="detail"
            shareWebsite={shareWebsite}
          />
        </div>
      </div>
    </div>
  }
  const extensionItems = detail?.recordContext?.extensions ?? []
  const extensionCount = Math.max(detail?.recordContext?.extensionCount ?? 0, extensionItems.length)
  const showExtensions = extensionCount > 0 || extensionItems.length > 0
  return <aside style={styles.copyLinkDetailPanel} aria-label="快记分享链接详情" data-arkme-copy-link-detail="true">
    <header style={styles.copyLinkDetailHeader}>
      <div style={{ minWidth: 0 }}>
        <h3 style={styles.copyLinkDetailTitle}>{title}</h3>
        {subtitle !== '' && <div style={styles.copyLinkDetailSubtitle}>{subtitle}</div>}
      </div>
      <div style={styles.copyLinkDetailHeaderActions}>
        <button
          type="button"
          style={{ ...styles.copyLinkDetailHeaderButton, opacity: shareDisabled ? .38 : 1, cursor: shareDisabled ? 'default' : 'pointer' }}
          disabled={shareDisabled}
          aria-label="分享快记链接"
          onClick={onShare}
        ><ArkmeForwardSubmitIcon /></button>
        <button
          type="button"
          style={{ ...styles.copyLinkDetailHeaderButton, ...styles.copyLinkDetailCloseButton }}
          aria-label="关闭详情"
          onClick={onClose}
        >×</button>
      </div>
    </header>
    {state.status === 'loading' && <div role="status" style={styles.copyLinkDetailStatus}>正在加载链接内容...</div>}
    {state.status === 'error' && <div role="alert" style={styles.copyLinkDetailStatus}>
      <div style={styles.copyLinkDetailError}>
        <span>{state.message}</span>
        <button type="button" style={styles.copyLinkDetailRetry} onClick={onRetry}>重试</button>
      </div>
    </div>}
    {detail !== undefined && <div style={styles.copyLinkDetailBody}>
      {detail.items.length === 1
        ? renderSingleRecord(detail.items[0]!)
        : <div style={styles.copyLinkDetailMultiList}>{detail.items.map(renderMultiRecord)}</div>}
      <div style={styles.copyLinkDetailDivider} aria-hidden />
      {showExtensions && <>
        <div style={styles.copyLinkDetailExtensionTitle}>共{extensionCount}条延展</div>
        {extensionItems.length > 0 && <div style={styles.copyLinkDetailExtensionList}>{extensionItems.map(renderExtensionItem)}</div>}
      </>}
    </div>}
    {detail !== undefined && <footer style={styles.copyLinkDetailFooter}>
      {generatedAt !== '' && <div style={styles.copyLinkDetailGeneratedAt}>此链接生成时间：{generatedAt}</div>}
      <div style={styles.copyLinkDetailFooterDivider} aria-hidden />
      <div style={styles.copyLinkDetailInputArea}>
        <div style={styles.copyLinkDetailInputBar}>
          <span style={styles.copyLinkDetailInputIcon}><ArkmeCopyLinkDetailInputIcon /></span>
          <textarea
            style={styles.copyLinkDetailInput}
            value={draft}
            placeholder="记录此刻想法..."
            aria-label="记录此刻想法"
            disabled={sendBusy}
            rows={1}
            maxLength={20000}
            onChange={event => { onDraftChange(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!sendDisabled) onSendDraft()
              }
            }}
          />
          <button
            type="button"
            style={{ ...styles.copyLinkDetailInputSend, ...(sendDisabled ? styles.copyLinkDetailInputSendDisabled : {}) }}
            disabled={sendDisabled}
            aria-label={sendBusy ? '发送中' : '发送延展'}
            onClick={onSendDraft}
          ><ArkmeForwardSubmitIcon /></button>
        </div>
        {sendError !== '' && <div role="alert" style={styles.copyLinkDetailSendError}>{sendError}</div>}
      </div>
    </footer>}
  </aside>
}

export function ArkmeSurface({
  t = defaultArkmeLoginTranslate,
  floating = false,
  initialAuth,
  currentSessionId,
  renderSlot,
  productChrome = true,
  productNavigation = productChrome,
  directoryLead,
  onCreateTask,
  onActivateSurface,
  ownsQrLogin = true,
  active = true,
}: ArkmeSurfaceProps = {}) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authStoreSnapshot = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  )
  const auth = authStoreSnapshot.auth ?? initialAuth
  const authenticatedUserId = auth?.status === 'authenticated' ? auth.userId : undefined
  const authenticatedAccountKey = auth?.status === 'authenticated'
    ? `${auth.environment}:${String(auth.userId)}`
    : undefined
  const botConversationVisible = ui.mode === 'bot' && ui.selectedBot !== undefined
  const conversationBackdropVisible = ui.mode === 'source' || ui.mode === 'contact-add' || botConversationVisible
  const selectedSource = conversationBackdropVisible ? ui.selectedSource : undefined
  const [selfSourcesResolution, setSelfSourcesResolution] = useState<ArkmeAccountSelfSourcesResolution>()
  const [selfSourcesRetryRevision, setSelfSourcesRetryRevision] = useState(0)
  const activeSelfSourcesResolution = selfSourcesResolution === undefined
    || selfSourcesResolution.userId !== authenticatedUserId
    ? undefined
    : selfSourcesResolution.resolution
  const aggregateSource = arkmeAggregateSourceForUser(authenticatedUserId, selfSourcesResolution)
  const selfSources = activeSelfSourcesResolution?.status === 'ready'
    ? activeSelfSourcesResolution.sources
    : EMPTY_SELF_SOURCES
  const selfSourcesLoading = activeSelfSourcesResolution?.status === 'loading'
    || activeSelfSourcesResolution?.status === 'ready' && activeSelfSourcesResolution.loading
  const selfSourcesError = activeSelfSourcesResolution?.status === 'error'
    ? activeSelfSourcesResolution.message
    : activeSelfSourcesResolution?.status === 'ready'
      ? activeSelfSourcesResolution.error
      : undefined
  const source = ui.mode === 'source' || ui.mode === 'contact-add' ? selectedSource ?? aggregateSource : undefined
  const conversationKey = source === undefined ? '' : arkmeSourceIdentityKey(source)
  const activeConversation = active && ui.calendarOpen !== true && source !== undefined
  const activeConversationRef = useRef(activeConversation)
  activeConversationRef.current = activeConversation
  const conversationOverlayKey = `${activeConversation ? 'active' : 'inactive'}:${conversationKey}`
  const conversationOverlayScopeRef = useRef({ key: conversationOverlayKey, generation: 0 })
  if (conversationOverlayScopeRef.current.key !== conversationOverlayKey) {
    conversationOverlayScopeRef.current = {
      key: conversationOverlayKey,
      generation: conversationOverlayScopeRef.current.generation + 1,
    }
  }
  const chatDelta = useSyncExternalStore(
    activeConversation ? arkmeChatTimelineDelta.subscribe : NOOP_SUBSCRIBE,
    () => activeConversation ? arkmeChatTimelineDelta.getSnapshotForSource(conversationKey) : EMPTY_CHAT_DELTA_SNAPSHOT,
    () => EMPTY_CHAT_DELTA_SNAPSHOT,
  )
  const interwovenInvalidation = useSyncExternalStore(
    activeConversation ? arkmeInterwovenInvalidation.subscribe : NOOP_SUBSCRIBE,
    () => activeConversation ? arkmeInterwovenInvalidation.getSnapshotForSource(conversationKey) : EMPTY_INTERWOVEN_INVALIDATION,
    () => EMPTY_INTERWOVEN_INVALIDATION,
  )
  const activeSourceKeyRef = useRef('')
  useEffect(() => {
    activeSourceKeyRef.current = conversationKey
  }, [conversationKey])
  const sourceIsChat = source?.kind === 'private_chat' || source?.kind === 'group_chat'
  const sourceProjectionRevision = useSyncExternalStore(
    activeConversation && !sourceIsChat ? arkmeUi.subscribe : NOOP_SUBSCRIBE,
    () => activeConversation && !sourceIsChat ? arkmeUi.getRecordRevision() : 0,
    () => 0,
  )
  const composerDraftKey = arkmeSourceComposerDraftKey(authenticatedUserId, source)
  const composerDraft = useSyncExternalStore(
    activeConversation ? arkmeComposerDraftStore.subscribe : NOOP_SUBSCRIBE,
    () => activeConversation ? arkmeComposerDraftStore.get(composerDraftKey) : arkmeComposerDraftStore.get(undefined),
    () => arkmeComposerDraftStore.get(undefined),
  )
  const draft = composerDraft.text
  const attachments = composerDraft.attachments
  const [composerInputFocused, setComposerInputFocused] = useState(false)
  const [composerShowsInputTime, setComposerShowsInputTime] = useState(arkmeComposerShowsInputTime)
  const [composerLocation, setComposerLocation] = useState<ArkmeRecordLocationCapture>()
  const locationCaptureEnabled = useSyncExternalStore(
    subscribeArkmeLocationCapturePreference,
    () => arkmeLocationCaptureEnabled(authenticatedUserId),
    () => false,
  )
  // Keyboard handlers inside the contenteditable can fire before React has replaced
  // their closures. Keep the start time in a ref as well, so an Enter-send always
  // measures the draft that is currently on screen.
  const composerInputStartedAtRef = useRef<{ draftKey: string; startedAt: number }>()
  const composerTextLength = Array.from(draft).length
  const composerStatsVisible = composerInputFocused || composerTextLength > 0
  if (composerDraftKey === undefined || composerTextLength === 0) composerInputStartedAtRef.current = undefined
  else if (composerInputStartedAtRef.current?.draftKey !== composerDraftKey) {
    composerInputStartedAtRef.current = { draftKey: composerDraftKey, startedAt: Date.now() }
  }
  const currentComposerInputStart = composerInputStartedAtRef.current
  const composerInputStartedAtMillis = currentComposerInputStart !== undefined
    && currentComposerInputStart.draftKey === composerDraftKey
    ? currentComposerInputStart.startedAt
    : undefined
  const surfaceRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<ArkmeRichComposerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const selfTopicCreateRef = useRef<ArkmeTopicCreateOpener | undefined>()
  const [activeTopicDissolve, setActiveTopicDissolveState] = useState<ArkmeTopicDissolveTask>()
  const activeTopicDissolveRef = useRef<ArkmeTopicDissolveTask>()
  const activeTopicDissolveAccountRef = useRef<string>()
  const publishActiveTopicDissolve = useCallback((next: ArkmeTopicDissolveTask | undefined) => {
    if (sameStateValue(activeTopicDissolveRef.current, next)) return
    activeTopicDissolveRef.current = next
    setActiveTopicDissolveState(next)
  }, [])
  const topicDissolveVisible = activeConversation && isArkmeSelfWorkspaceSource(source)
  useEffect(() => {
    if (activeTopicDissolveAccountRef.current !== authenticatedAccountKey) {
      activeTopicDissolveAccountRef.current = authenticatedAccountKey
      publishActiveTopicDissolve(undefined)
    }
    if (authenticatedUserId === undefined) {
      publishActiveTopicDissolve(undefined)
      return
    }
    if (!topicDissolveVisible) return
    let disposed = false
    let pending = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const browserDocument = typeof document === 'undefined' ? undefined : document
    const foreground = () => browserDocument?.visibilityState !== 'hidden'
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const refresh = async () => {
      if (disposed || pending || !foreground()) return
      pending = true
      const request = new AbortController()
      controller = request
      try {
        const task = await callArkme<ArkmeTopicDissolveTask | null>('topic.dissolve.active', undefined, request.signal)
        if (disposed || request.signal.aborted) return
        failures = 0
        const next = task ?? undefined
        publishActiveTopicDissolve(next)
        if (next !== undefined && next.stage !== 'completed' && next.stage !== 'failed') {
          timer = setTimeout(() => { timer = undefined; void refresh() }, 500)
        }
      } catch {
        // A transient progress lookup failure must not interrupt the conversation UI.
        if (!request.signal.aborted) {
          failures += 1
          if (failures <= 3) timer = setTimeout(() => { timer = undefined; void refresh() }, 500 * failures)
        }
      } finally {
        if (controller === request) controller = undefined
        pending = false
      }
    }
    const onVisibilityChange = () => {
      if (foreground()) void refresh()
      else { clearTimer(); controller?.abort() }
    }
    void refresh()
    browserDocument?.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      clearTimer()
      controller?.abort()
      browserDocument?.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [authenticatedAccountKey, authenticatedUserId, conversationKey, publishActiveTopicDissolve, topicDissolveVisible])
  const [timelineView, setTimelineView] = useState<ArkmeTimelineViewState>({
    sourceKey: '', items: [], aiPolishNotices: [], aiPolishSettings: undefined, nextCursor: undefined, hasMore: false,
  })
  const { sourceKey: timelineStateKey, items, aiPolishNotices, aiPolishSettings, nextCursor, hasMore } = timelineView
  const aiPolishSettingsRef = useRef(aiPolishSettings)
  const aiPolishNoticesRef = useRef(aiPolishNotices)
  aiPolishSettingsRef.current = aiPolishSettings
  aiPolishNoticesRef.current = aiPolishNotices
  const shareWebsite = authStoreSnapshot.config?.shareWebsite ?? ARKME_DEFAULT_SHARE_WEBSITE
  const setItems = useCallback((action: SetStateAction<ArkmeTimelineItem[]>) => {
    setTimelineView(current => {
      const next = resolveStateAction(action, current.items)
      return sameStateValue(current.items, next) ? current : { ...current, items: next }
    })
  }, [])
  const setAiPolishNotices = useCallback((action: SetStateAction<ArkmeGroupAiPolishNotice[]>) => {
    setTimelineView(current => {
      const next = resolveStateAction(action, current.aiPolishNotices)
      return sameStateValue(current.aiPolishNotices, next) ? current : { ...current, aiPolishNotices: next }
    })
  }, [])
  const setAiPolishSettings = useCallback((action: SetStateAction<ArkmeGroupAiPolishSnapshot | undefined>) => {
    setTimelineView(current => {
      const next = resolveStateAction(action, current.aiPolishSettings)
      return sameStateValue(current.aiPolishSettings, next) ? current : { ...current, aiPolishSettings: next }
    })
  }, [])
  const [selfProfile, setSelfProfile] = useState<ArkmeUserProfile>()
  const [drawer, setDrawer] = useState<'detail' | 'copyLink'>()
  const [groupMembersOpen, setGroupMembersOpen] = useState(false)
  const [detailItemUid, setDetailItemUid] = useState('')
  const [copyLinkDetail, setCopyLinkDetail] = useState<ArkmeCopyLinkDetailState>()
  const [copyLinkDetailDraft, setCopyLinkDetailDraft] = useState('')
  const [copyLinkDetailSending, setCopyLinkDetailSending] = useState(false)
  const [copyLinkDetailSendError, setCopyLinkDetailSendError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [interwovenMoments, setInterwovenMoments] = useState<ArkmeInterwovenMention[]>([])
  const [interwovenRefreshRevision, setInterwovenRefreshRevision] = useState(0)
  const [selectedMoment, setSelectedMoment] = useState<ArkmeInterwovenMention>()
  const [detailState, setDetailState] = useState<ArkmeInterwovenDetailViewState>()
  const [momentRelatedView, setMomentRelatedView] = useState<ArkmeRelatedDrawerView>('source-detail')
  const [momentRelatedState, setMomentRelatedState] = useState<ArkmeRelatedQuickNotesLoadState>({ kind: 'idle' })
  const [momentRelatedDetailState, setMomentRelatedDetailState] = useState<ArkmeRelatedQuickNoteDetailState>({ kind: 'idle' })
  const [timelineLoadingKey, setTimelineLoadingKey] = useState('')
  const [timelineSkeletonKey, setTimelineSkeletonKey] = useState('')
  const [timelineRevealKey, setTimelineRevealKey] = useState('')
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [longArticleCreating, setLongArticleCreating] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const preparationJobs = useRef(new Map<string, Promise<boolean>>())
  const stageControllers = useRef(new Set<AbortController>())
  const [preparingKeys, setPreparingKeys] = useState<Set<string>>(() => new Set())
  const [draftPreview, setDraftPreview] = useState<ArkmeContentBlock>()
  const fileTasks = useArkmeFileSendTasks(source?.sourceRef, authenticatedUserId, activeConversation)
  const notifiedFileTasks = useRef(new Set<string>())
  useEffect(() => { setDraftPreview(undefined) }, [authenticatedUserId])
  useEffect(() => () => { for (const controller of stageControllers.current) controller.abort() }, [authenticatedUserId])
  const [busy, setBusy] = useState(false)
  const preparingFiles = composerDraftKey !== undefined && preparingKeys.has(composerDraftKey)
  // Transport is per message.  It must never lock the next draft while a previous
  // message waits for the server, otherwise fast keyboard input is dropped.
  const canSend = arkmeComposerCanSend(draft, attachments.length + (composerDraftKey !== undefined && preparingKeys.has(composerDraftKey) ? 1 : 0), preparingFiles)
  const pendingComposerFocusDraftKeyRef = useRef<string>()
  const [compactNavigation, setCompactNavigation] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [highlightedTargetUid, setHighlightedTargetUid] = useState('')
  const conversationTargetPagingRef = useRef({ revision: 0, pages: 0 })
  const [error, setError] = useState(initialAuth?.status === 'binding-required' ? t('error.binding.required') : '')
  const [agreed, setAgreed] = useState(true)
  const [loginMode, setLoginMode] = useState<ArkmeLoginMode>(initialAuth?.status === 'binding-required' ? 'phone' : 'jiwo')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [testLoginEnabled, setTestLoginEnabled] = useState(false)
  const [jiwoScanLoginEnabled, setJiwoScanLoginEnabled] = useState(false)
  const [testUserId, setTestUserId] = useState('')
  const [qr, setQr] = useState('')
  const [conversationMemberSnapshot, setConversationMemberSnapshot] = useState<ArkmeConversationMemberSnapshot>({
    sourceRef: '', items: EMPTY_CONVERSATION_MEMBERS,
  })
  const conversationMembers = conversationMemberSnapshot.sourceRef === source?.sourceRef
    ? conversationMemberSnapshot.items
    : EMPTY_CONVERSATION_MEMBERS
  const [conversationJoinEvents, setConversationJoinEvents] = useState<ArkmeConversationMemberJoinEvent[]>([])
  const [conversationMembersRefreshRevision, setConversationMembersRefreshRevision] = useState(0)
  const [groupMentionBots, setGroupMentionBots] = useState<ArkmeGroupBotCandidateList>()
  const [privateMentionBots, setPrivateMentionBots] = useState<ArkmeBotList>()
  const [mentionTrigger, setMentionTrigger] = useState<ArkmeComposerMentionTrigger>()
  const [mentionCandidateIndex, setMentionCandidateIndex] = useState(0)
  const [memberMenu, setMemberMenu] = useState<{
    member: ArkmeConversationMemberItem
    position: ArkmeMemberMenuPosition
  }>()
  const [messageMenu, setMessageMenu] = useState<{
    itemUid: string
    left: number
    top: number
  }>()
  const [snapshot, setSnapshot] = useState<{ item: ArkmeTimelineItem; actionRef: string; detail?: ArkmeMessageSnapshotDetail; loading: boolean; loadError?: string }>()
  const [messageReportItem, setMessageReportItem] = useState<ArkmeTimelineItem>()
  const messageMenuRef = useRef<HTMLDivElement | null>(null)
  const [messageActionStatus, setMessageActionStatus] = useState('')
  const messageActionStatusTimerRef = useRef<number>()
  const forwardSuccessTimerRef = useRef<number>()
  const [messageActionBusy, setMessageActionBusy] = useState<'copy-link' | 'forward'>()
  const [selectMode, setSelectMode] = useState<{ sourceKey: string; selectedIds: Set<string> }>()
  const pendingSelectRevealItemUidRef = useRef('')
  const [forwardTargetPicker, setForwardTargetPicker] = useState<{
    sourceKey: string
    itemUids: string[]
    items: ArkmeTimelineItem[]
    loading: boolean
    targets: ArkmeSourceItem[]
    selectedSourceRefs: string[]
    keyword: string
    commentText: string
    error: string
    sendError: string
  }>()
  const needsChatDirectory = activeConversation && detailState?.kind === 'success'
  const chatDirectory = useSyncExternalStore(
    needsChatDirectory ? arkmeChatDirectory.subscribe : NOOP_SUBSCRIBE,
    () => needsChatDirectory ? arkmeChatDirectory.getSnapshot() : EMPTY_CHAT_DIRECTORY_SNAPSHOT,
    () => EMPTY_CHAT_DIRECTORY_SNAPSHOT,
  )
  const [forwardSuccessFeedback, setForwardSuccessFeedback] = useState<{
    message: string
    targets: ArkmeSourceItem[]
  }>()
  const [memberProfile, setMemberProfile] = useState<ArkmeConversationMemberItem>()
  const [memberRecords, setMemberRecords] = useState<{
    member: ArkmeConversationMemberItem
    mode: ArkmeConversationMemberRecordMode
  }>()
  const [privateChatBusy, setPrivateChatBusy] = useState(false)

  useEffect(() => {
    if (!activeConversation) return
    setConversationMemberSnapshot({
      sourceRef: source?.sourceRef ?? '',
      items: EMPTY_CONVERSATION_MEMBERS,
    })
    setConversationJoinEvents([])
    setMemberMenu(undefined)
    setMemberProfile(undefined)
    setMemberRecords(undefined)
    setPrivateChatBusy(false)
    setSnapshot(undefined)
    setMessageReportItem(undefined)
    if (authenticatedUserId === undefined || source === undefined || (source.kind !== 'group_chat' && source.kind !== 'private_chat')) return
    const controller = new AbortController()
    void callArkme<ArkmeConversationMemberList>('source.members', {
      sourceRef: source.sourceRef,
      activeOnly: true,
    }, controller.signal)
      .then(snapshot => {
        if (controller.signal.aborted) return
        setConversationMemberSnapshot({
          sourceRef: source.sourceRef,
          items: snapshot.items,
        })
        setConversationJoinEvents(source.kind === 'group_chat' ? snapshot.joinEvents ?? [] : [])
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError(errorMessage(caught))
      })
    return () => { controller.abort() }
  }, [activeConversation, authenticatedUserId, conversationKey, conversationMembersRefreshRevision, source?.kind, source?.sourceRef])

  useEffect(() => {
    if (!activeConversation) return
    setGroupMentionBots(undefined)
    setPrivateMentionBots(undefined)
    if (authenticatedUserId === undefined || source === undefined || mentionTrigger === undefined) return
    const controller = new AbortController()
    if (source.kind === 'group_chat') {
      void callArkme<ArkmeGroupBotCandidateList>('group.bots', { sourceRef: source.sourceRef }, controller.signal)
        .then(snapshot => {
          if (!controller.signal.aborted) setGroupMentionBots(snapshot)
        })
        .catch(caught => {
          if (!controller.signal.aborted) console.warn('dsh-arkme: mention bot refresh failed', errorMessage(caught))
        })
    } else if (source.kind === 'private_chat') {
      void callArkme<ArkmeBotList>('bots.list', undefined, controller.signal)
        .then(snapshot => {
          if (!controller.signal.aborted) setPrivateMentionBots(snapshot)
        })
        .catch(() => undefined)
    }
    return () => { controller.abort() }
  }, [activeConversation, authenticatedUserId, conversationKey, mentionTrigger?.startIndex, source?.kind, source?.sourceRef])

  useEffect(() => {
    if (!activeConversation || auth?.status !== 'authenticated' || typeof window === 'undefined') return
    const refreshOnFocus = () => { setConversationMembersRefreshRevision(value => value + 1) }
    window.addEventListener('focus', refreshOnFocus)
    return () => { window.removeEventListener('focus', refreshOnFocus) }
  }, [activeConversation, auth?.status])
  useEffect(() => () => {
    if (messageActionStatusTimerRef.current !== undefined) window.clearTimeout(messageActionStatusTimerRef.current)
    if (forwardSuccessTimerRef.current !== undefined) window.clearTimeout(forwardSuccessTimerRef.current)
  }, [])

  useEffect(() => {
    if (!active) return
    const pendingDraftKey = pendingComposerFocusDraftKeyRef.current
    if (pendingDraftKey === undefined || busy) return
    if (pendingDraftKey !== composerDraftKey) {
      pendingComposerFocusDraftKeyRef.current = undefined
      return
    }
    pendingComposerFocusDraftKeyRef.current = undefined
    const frame = requestAnimationFrame(() => {
      const activeElement = document.activeElement
      restoreArkmeComposerFocus(
        textareaRef.current,
        activeElement,
        document.body,
        activeElement !== null && composerRef.current?.contains(activeElement) === true,
      )
    })
    return () => { cancelAnimationFrame(frame) }
  }, [active, busy, composerDraftKey])

  useEffect(() => {
    let active = true
    setSelfProfile(undefined)
    if (!activeConversation && ui.mode !== 'world' && ui.mode !== 'extensions') return () => { active = false }
    if (authenticatedUserId === undefined) return () => { active = false }
    void callArkme<ArkmeUserProfileSnapshot>('user.profile')
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
        : snapshot)
      .then(snapshot => {
        if (active && snapshot.profile?.userId === authenticatedUserId) setSelfProfile(snapshot.profile)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [activeConversation, authenticatedUserId, ui.mode])

  useEffect(() => {
    if (ui.mode !== 'contact-add' || typeof document === 'undefined') return
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') arkmeUi.showConversations()
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => { document.removeEventListener('keydown', closeFromKeyboard) }
  }, [ui.mode])

  useEffect(() => {
    if (!addMenuOpen || typeof document === 'undefined') return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (arkmeShouldDismissAnchoredMenu(target, addMenuRef.current, addMenuTriggerRef.current)) setAddMenuOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [addMenuOpen])

  useEffect(() => {
    if (messageMenu === undefined || typeof document === 'undefined') return
    const closeMessageMenuFromOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (arkmeShouldDismissAnchoredMenu(target, messageMenuRef.current, null)) setMessageMenu(undefined)
    }
    const closeMessageMenuFromContext = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!arkmeShouldDismissAnchoredMenu(target, messageMenuRef.current, null)) return
      event.preventDefault()
      setMessageMenu(undefined)
    }
    const closeMessageMenuFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMessageMenu(undefined)
    }
    document.addEventListener('pointerdown', closeMessageMenuFromOutside, true)
    document.addEventListener('mousedown', closeMessageMenuFromOutside, true)
    document.addEventListener('contextmenu', closeMessageMenuFromContext, true)
    document.addEventListener('keydown', closeMessageMenuFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeMessageMenuFromOutside, true)
      document.removeEventListener('mousedown', closeMessageMenuFromOutside, true)
      document.removeEventListener('contextmenu', closeMessageMenuFromContext, true)
      document.removeEventListener('keydown', closeMessageMenuFromKeyboard)
    }
  }, [messageMenu])

  const qrRequestStartedRef = useRef(false)
  const qrFlowRevisionRef = useRef(0)
  const currentJiwoAttemptRef = useRef<string>()
  const pendingLoginModeSelectionRef = useRef<ArkmeLoginMode>()
  const conversationCacheRef = useRef(new ArkmeConversationMemoryCache())
  const cacheAccountKeyRef = useRef<string>()
  const timelineGenerationRef = useRef(0)
  const timelineRequestAbortRef = useRef<AbortController>()
  const timelineRequestKeyRef = useRef('')
  const pendingViewportRestoreRef = useRef<{
    sourceKey: string
    viewport: ArkmeConversationViewportSnapshot | undefined
  }>()
  const interwovenRequestRef = useRef<AbortController>()
  const interwovenGenerationRef = useRef(0)
  const detailRequestRef = useRef<AbortController>()
  const detailRequestMomentRef = useRef('')
  const momentRelatedRequestRef = useRef<AbortController>()
  const momentRelatedDetailRequestRef = useRef<AbortController>()
  const momentRelatedGenerationRef = useRef(0)
  const snapshotRequestRef = useRef<AbortController>()
  const copyLinkDetailRequestRef = useRef<AbortController>()
  const forwardTargetRequestRef = useRef<AbortController>()
  const copyLinkRefreshTimerRef = useRef<number>()
  const lastReadAckRef = useRef('')
  const bindingNotifiedUserIdRef = useRef<number | undefined>()
  const ignoreStaleBindingAuthRef = useRef(false)
  useEffect(() => {
    if (activeConversation) return
    timelineGenerationRef.current += 1
    timelineRequestAbortRef.current?.abort()
    timelineRequestAbortRef.current = undefined
    timelineRequestKeyRef.current = ''
    interwovenGenerationRef.current += 1
    interwovenRequestRef.current?.abort()
    interwovenRequestRef.current = undefined
    detailRequestRef.current?.abort()
    detailRequestRef.current = undefined
    momentRelatedGenerationRef.current += 1
    momentRelatedRequestRef.current?.abort()
    momentRelatedRequestRef.current = undefined
    momentRelatedDetailRequestRef.current?.abort()
    momentRelatedDetailRequestRef.current = undefined
    relatedGenerationRef.current += 1
    relatedEligibilityAbortRef.current?.abort()
    relatedEligibilityAbortRef.current = undefined
    relatedPageAbortRef.current?.abort()
    relatedPageAbortRef.current = undefined
    for (const controller of stageControllers.current) controller.abort()
    snapshotRequestRef.current?.abort()
    snapshotRequestRef.current = undefined
    copyLinkDetailRequestRef.current?.abort()
    copyLinkDetailRequestRef.current = undefined
    forwardTargetRequestRef.current?.abort()
    forwardTargetRequestRef.current = undefined
    if (copyLinkRefreshTimerRef.current !== undefined) {
      window.clearTimeout(copyLinkRefreshTimerRef.current)
      copyLinkRefreshTimerRef.current = undefined
    }
    if (messageActionStatusTimerRef.current !== undefined) {
      window.clearTimeout(messageActionStatusTimerRef.current)
      messageActionStatusTimerRef.current = undefined
    }
    if (forwardSuccessTimerRef.current !== undefined) {
      window.clearTimeout(forwardSuccessTimerRef.current)
      forwardSuccessTimerRef.current = undefined
    }
    setDraftPreview(undefined)
    setLongArticleCreating(false)
    setAddMenuOpen(false)
    setMentionTrigger(undefined)
    setRelatedMenuOpen(false)
    setRelatedPanelOpen(false)
    setRelatedDetail(undefined)
    setGroupMembersOpen(false)
    setDrawer(undefined)
    setDetailItemUid('')
    setCopyLinkDetail(undefined)
    setCopyLinkDetailDraft('')
    setCopyLinkDetailSending(false)
    setCopyLinkDetailSendError('')
    setShowOriginal(false)
    setSelectedMoment(undefined)
    setDetailState(undefined)
    setMomentRelatedView('source-detail')
    setMomentRelatedState({ kind: 'idle' })
    setMomentRelatedDetailState({ kind: 'idle' })
    setMemberMenu(undefined)
    setMessageMenu(undefined)
    setSnapshot(undefined)
    setMessageReportItem(undefined)
    setMemberProfile(undefined)
    setMemberRecords(undefined)
    setPrivateChatBusy(false)
    setSelectMode(undefined)
    setForwardTargetPicker(undefined)
    setForwardSuccessFeedback(undefined)
    setMessageActionStatus('')
    setMessageActionBusy(undefined)
  }, [activeConversation])
  const authenticated = auth?.status === 'authenticated'
  const authView = arkmeAuthView(auth)
  const phoneBindingRequired = arkmeLoginNeedsPhoneBinding(auth)
  const localeId = t('locale.id')
  const localeIdRef = useRef(localeId)

  useEffect(() => {
    if (localeIdRef.current === localeId) return
    localeIdRef.current = localeId
    if (authView === 'login') setError('')
  }, [authView, localeId])
  const [relatedEligibility, setRelatedEligibility] = useState<'idle' | 'loading' | 'allowed' | 'denied' | 'error'>('idle')
  const [relatedMenuOpen, setRelatedMenuOpen] = useState(false)
  const [relatedMenuPosition, setRelatedMenuPosition] = useState({ left: 12, top: 54 })
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
  const activeRelatedSourceKeyRef = useRef('')
  const relatedMenuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!relatedMenuOpen || typeof document === 'undefined') return
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setRelatedMenuOpen(false)
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [relatedMenuOpen])

  useEffect(() => {
    if (timelineLoadingKey === '') return
    const sourceKey = timelineLoadingKey
    const timer = setTimeout(() => {
      setTimelineSkeletonKey(current => timelineLoadingKey === sourceKey ? sourceKey : current)
    }, 120)
    return () => { clearTimeout(timer) }
  }, [timelineLoadingKey])

  useEffect(() => {
    if (timelineRevealKey === '') return
    const timer = setTimeout(() => { setTimelineRevealKey('') }, 160)
    return () => { clearTimeout(timer) }
  }, [timelineRevealKey])

  useEffect(() => {
    const element = surfaceRef.current
    if (!active || element === null || typeof ResizeObserver === 'undefined') return
    const update = () => { setCompactNavigation(element.getBoundingClientRect().width < 720) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [active])

  const acceptAuthSnapshot = useCallback((snapshot: ArkmeAuthSnapshot) => {
    const previous = arkmeAuthStore.getSnapshot().auth
    const accountChanged = arkmeAuthenticatedAccountChanged(previous, snapshot)
    arkmeAuthStore.setAuth(snapshot)
    if (snapshot.status === 'binding-required') {
      setLoginMode('phone')
      setAgreed(true)
      setQr('')
      setSmsCode('')
      setError(t('error.binding.required'))
      if (bindingNotifiedUserIdRef.current !== snapshot.userId) {
        bindingNotifiedUserIdRef.current = snapshot.userId
        arkmeUi.authChanged(false)
      }
      return
    }
    bindingNotifiedUserIdRef.current = undefined
    if (snapshot.status !== 'authenticated') {
      if (arkmeUi.getSnapshot().mode !== 'login') arkmeUi.authChanged(false)
      return
    }
    if (accountChanged || arkmeUi.getSnapshot().mode === 'login') {
      arkmeUi.authChanged(true, accountChanged)
    }
  }, [t])

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
    setJiwoScanLoginEnabled(authStoreSnapshot.config.jiwoScanLoginEnabled)
    if (!phoneBindingRequired && (auth?.status === 'logged-out' || auth?.status === 'expired')) {
      const selectedMode = pendingLoginModeSelectionRef.current
      pendingLoginModeSelectionRef.current = undefined
      setLoginMode(selectedMode ?? (authStoreSnapshot.config.jiwoScanLoginEnabled
        ? 'jiwo'
        : authStoreSnapshot.config.testLoginEnabled ? 'test' : 'wechat'))
    }
  }, [auth?.status, authStoreSnapshot.config, phoneBindingRequired])
  useEffect(() => {
    if (authStoreSnapshot.error !== '' && authView === 'login') {
      setError(arkmeStoredLoginErrorMessage(authStoreSnapshot.error, t))
    }
  }, [authStoreSnapshot.error, authView, t])

  const refreshAuth = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const snapshot = await arkmeAuthStore.refresh()
      const config = arkmeAuthStore.getSnapshot().config
      acceptAuthSnapshot(snapshot)
      if (config !== undefined) {
        setCaptchaId(config.captchaId)
        setTestLoginEnabled(config.testLoginEnabled)
        setJiwoScanLoginEnabled(config.jiwoScanLoginEnabled)
      }
      if (!['authenticated', 'binding-required'].includes(snapshot.status)) {
        setLoginMode(config?.jiwoScanLoginEnabled === true
          ? 'jiwo'
          : config?.testLoginEnabled === true ? 'test' : 'wechat')
      }
    } catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) }
    finally { setBusy(false) }
  }, [acceptAuthSnapshot, t])

  const loadRelatedPage = useCallback(async (
    month: string,
    cursor: string | undefined,
    append: boolean,
    generation: number,
  ) => {
    if (source === undefined || source.kind !== 'private_chat') return
    const sourceRef = source.sourceRef
    const sourceKey = conversationKey
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
        generation, relatedGenerationRef.current, sourceKey, activeRelatedSourceKeyRef.current,
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
        generation, relatedGenerationRef.current, sourceKey, activeRelatedSourceKeyRef.current,
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
  }, [conversationKey, source])

  const reloadRelated = useCallback((month: string) => {
    relatedGenerationRef.current += 1
    const generation = relatedGenerationRef.current
    setRelatedMonth(month)
    setRelatedDetail(undefined)
    void loadRelatedPage(month, undefined, false, generation)
  }, [loadRelatedPage])

  const selectRelatedMonth = useCallback((month: string) => {
    setRelatedMonth(month)
    setRelatedDetail(undefined)
  }, [])
  const loadRelatedRecordingDetail = useCallback(async (
    item: ArkmeRelatedRecordingItem,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedRecordingItem> => {
    const detailRef = item.sharedRecordingDetailRef?.trim() ?? ''
    if (detailRef === '') return item
    const loaded = arkmeRelatedRecordingItemFromSharedRecordingPreview(
      await callArkme<ArkmeSharedRecordingPreview>(
        'source.shared-recording-detail',
        { detailRef },
        signal,
      ),
      { itemUid: item.recordingRef, isMe: !item.isSharedByOther },
    )
    const next: ArkmeRelatedRecordingItem = {
      ...item,
      sharedRecordingDetailRef: detailRef,
      startAtMillis: loaded.startAtMillis > 0 ? loaded.startAtMillis : item.startAtMillis,
      endAtMillis: loaded.endAtMillis > 0 ? loaded.endAtMillis : item.endAtMillis,
      timeRangeText: loaded.timeRangeText.trim() === '' ? item.timeRangeText : loaded.timeRangeText,
      title: loaded.title.trim() === '' ? item.title : loaded.title,
      summary: loaded.summary.trim() === '' ? item.summary : loaded.summary,
      summaryStatus: loaded.summaryStatus,
      transcriptAvailable: loaded.transcriptAvailable,
      speakers: loaded.speakers.length > 0 ? loaded.speakers : item.speakers,
      participants: loaded.participants.length > 0 ? loaded.participants : item.participants,
      isSharedByOther: item.isSharedByOther,
    }
    if (loaded.transcript !== undefined) next.transcript = loaded.transcript
    return next
  }, [])

  function activateContextPanel(kind: 'note' | 'members' | 'records' | 'moment' | 'related') {
    if (kind !== 'note') setDrawer(undefined)
    setGroupMembersOpen(kind === 'members')
    if (kind !== 'records') setMemberRecords(undefined)
    if (kind !== 'moment') {
      detailRequestRef.current?.abort()
      detailRequestRef.current = undefined
      detailRequestMomentRef.current = ''
      momentRelatedGenerationRef.current += 1
      momentRelatedRequestRef.current?.abort()
      momentRelatedRequestRef.current = undefined
      momentRelatedDetailRequestRef.current?.abort()
      momentRelatedDetailRequestRef.current = undefined
      setSelectedMoment(undefined)
      setDetailState(undefined)
      setMomentRelatedView('source-detail')
      setMomentRelatedState({ kind: 'idle' })
      setMomentRelatedDetailState({ kind: 'idle' })
    }
    if (kind !== 'related') closeRelatedPanel()
  }

  function openNoteDetail(item: ArkmeTimelineItem) {
    activateContextPanel('note')
    setDetailItemUid(item.itemUid)
    setShowOriginal(false)
    setDrawer('detail')
  }

  const openRelatedPanel = useCallback(() => {
    if (relatedEligibility !== 'allowed') return
    setRelatedMenuOpen(false)
    activateContextPanel('related')
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
    void loadRelatedPage('', relatedNextCursor, true, relatedGenerationRef.current)
  }, [loadRelatedPage, relatedHasMore, relatedNextCursor])

  useEffect(() => {
    relatedEligibilityAbortRef.current?.abort()
    relatedEligibilityAbortRef.current = undefined
    relatedPageAbortRef.current?.abort()
    relatedGenerationRef.current += 1
    activeRelatedSourceKeyRef.current = conversationKey
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
  }, [authenticated, conversationKey, source?.kind, ui.authRevision])

  const ensureRelatedEligibility = useCallback(() => {
    if (!authenticated || source?.kind !== 'private_chat'
      || relatedEligibility === 'loading' || relatedEligibility === 'allowed' || relatedEligibility === 'denied') return
    const controller = new AbortController()
    relatedEligibilityAbortRef.current?.abort()
    relatedEligibilityAbortRef.current = controller
    const sourceRef = source.sourceRef
    const sourceKey = conversationKey
    setRelatedEligibility('loading')
    void callArkme<{ allowed: boolean }>(
      'related-recordings.eligibility', { sourceRef }, controller.signal,
    ).then(result => {
      if (!controller.signal.aborted && activeRelatedSourceKeyRef.current === sourceKey) {
        setRelatedEligibility(result.allowed ? 'allowed' : 'denied')
      }
    }).catch(() => {
      if (!controller.signal.aborted && activeRelatedSourceKeyRef.current === sourceKey) setRelatedEligibility('error')
    }).finally(() => {
      if (relatedEligibilityAbortRef.current === controller) relatedEligibilityAbortRef.current = undefined
    })
  }, [authenticated, conversationKey, relatedEligibility, source])

  const toggleRelatedMenu = useCallback(() => {
    if (relatedPanelOpen) return
    if (relatedMenuOpen) {
      setRelatedMenuOpen(false)
      return
    }
    const host = panelRef.current
    const button = relatedMenuButtonRef.current
    if (host !== null && button !== null) {
      const hostRect = host.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const menuWidth = ARKME_CONVERSATION_SETTINGS_MENU_WIDTH
      const menuHeight = 44
      setRelatedMenuPosition({
        left: Math.max(12, Math.min(hostRect.width - menuWidth - 12, buttonRect.right - hostRect.left - menuWidth)),
        top: Math.max(8, Math.min(hostRect.height - menuHeight - 12, buttonRect.bottom - hostRect.top + 8)),
      })
    }
    setRelatedMenuOpen(true)
    ensureRelatedEligibility()
  }, [ensureRelatedEligibility, relatedMenuOpen, relatedPanelOpen])

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

  const loadTimeline = useCallback(async (cursor?: ArkmeTimelineCursor, preserve = false, limit = 40) => {
    if (source === undefined) return
    const sourceRef = source.sourceRef
    const sourceKey = arkmeSourceIdentityKey(source)
    const generation = timelineGenerationRef.current
    const requestKey = `${sourceKey}:${cursor === undefined ? 'initial' : JSON.stringify(cursor)}`
    const activeController = timelineRequestAbortRef.current
    if (activeController !== undefined && !activeController.signal.aborted
      && timelineRequestKeyRef.current === requestKey) return
    const hadCachedTimeline = conversationCacheRef.current.getTimeline(sourceKey) !== undefined
    const controller = new AbortController()
    timelineRequestAbortRef.current?.abort()
    timelineRequestAbortRef.current = controller
    timelineRequestKeyRef.current = requestKey
    let page: ArkmeTimelinePage
    try {
      page = await retryArkmeRead(() => callArkme<ArkmeTimelinePage>('source.timeline', {
        sourceRef, limit, ...(cursor === undefined ? {} : { cursor }),
      }, controller.signal), { signal: controller.signal })
    } catch (caught) {
      if (isArkmeRequestAbort(caught, controller.signal)) return
      throw caught
    } finally {
      if (timelineRequestAbortRef.current === controller) {
        timelineRequestAbortRef.current = undefined
        timelineRequestKeyRef.current = ''
      }
    }
    if (generation !== timelineGenerationRef.current) return
    const cached = conversationCacheRef.current.getTimeline(sourceKey)
    const nextAiPolishSettings = cursor === undefined ? page.aiPolishSettings : cached?.aiPolishSettings
    const snapshot: ArkmeConversationTimelineSnapshot = {
      items: cursor === undefined ? mergeItems([], page.items) : mergeItems(cached?.items ?? [], page.items),
      aiPolishNotices: cursor === undefined ? page.aiPolishNotices ?? [] : cached?.aiPolishNotices ?? [],
      hasMore: page.hasMore,
      fetchedAtMillis: Date.now(),
      ...(sourceIsChat
        ? { latestSequence: Math.max(source.latestSequence ?? 0, ...page.items.map(item => item.sequence ?? 0)) }
        : { recordRevision: sourceProjectionRevision }),
      ...(nextAiPolishSettings === undefined ? {} : { aiPolishSettings: nextAiPolishSettings }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
    const contentChanged = !arkmeConversationTimelineContentEqual(cached, snapshot)
    const releasedMoments = conversationCacheRef.current.storeTimeline(sourceKey, snapshot)
    const releasedMomentsChanged = releasedMoments !== undefined
      && JSON.stringify(releasedMoments) !== JSON.stringify(interwovenMoments)
    if (contentChanged || releasedMomentsChanged) {
      const body = bodyRef.current
      pendingViewportRestoreRef.current = {
        sourceKey,
        viewport: preserve || hadCachedTimeline
          ? body === null ? conversationCacheRef.current.getViewport(sourceKey) : arkmeConversationViewport(body)
          : undefined,
      }
      if (contentChanged) setTimelineView({
        sourceKey,
        items: snapshot.items,
        aiPolishNotices: snapshot.aiPolishNotices,
        aiPolishSettings: snapshot.aiPolishSettings,
        nextCursor: snapshot.nextCursor,
        hasMore: snapshot.hasMore,
      })
      if (releasedMomentsChanged && releasedMoments !== undefined) setInterwovenMoments(releasedMoments)
    }
    if (cursor === undefined) {
      setTimelineLoadingKey(current => current === sourceKey ? '' : current)
      setTimelineSkeletonKey(current => current === sourceKey ? '' : current)
      if (!hadCachedTimeline && snapshot.items.length > 0) setTimelineRevealKey(sourceKey)
      await acknowledgeRead(snapshot.items)
    }
  }, [acknowledgeRead, interwovenMoments, source, sourceIsChat, sourceProjectionRevision])

  useEffect(() => {
    if (!activeConversation || source === undefined || authenticatedUserId === undefined) return
    let changed = false
    for (const task of fileTasks.tasks) {
      if (task.state !== 'sent' || notifiedFileTasks.current.has(task.taskRef)) continue
      notifiedFileTasks.current.add(task.taskRef); changed = true
    }
    if (changed) { arkmeUi.chatChanged(); void loadTimeline().catch(caught => setError(errorMessage(caught))) }
    // Recover the acceptance boundary after a page refresh without producing a second send.
    const current = arkmeComposerDraftStore.get(composerDraftKey)
    const refs = current.attachments.map(arkmeAttachmentId)
    if ((current.fileSendIdentity !== undefined || arkmeComposerDraftStore.isRestored(composerDraftKey)) && refs.length > 0 && fileTasks.tasks.some(task =>
      (current.fileSendIdentity === undefined || current.fileSendIdentity.recordUid === task.recordUid) &&
      task.content.textContent === serializeArkmeComposerDraft(current).text.trim() && JSON.stringify(task.fileRefs) === JSON.stringify(refs))) {
      arkmeComposerDraftStore.clear(composerDraftKey)
    }
  }, [activeConversation, fileTasks.tasks, source, authenticatedUserId, loadTimeline, composerDraftKey])

  useEffect(() => {
    const target = ui.conversationTarget
    if (!activeConversation || !authenticated || source === undefined || target === undefined
      || timelineStateKey !== conversationKey) return
    if (conversationTargetPagingRef.current.revision !== target.revision) {
      conversationTargetPagingRef.current = { revision: target.revision, pages: 0 }
      setHighlightedTargetUid('')
    }
    if (items.some(item => item.itemUid === target.itemUid)) {
      const body = bodyRef.current
      const row = body === null ? undefined : [...body.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')]
        .find(element => element.dataset.arkmeConversationRow === target.itemUid)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedTargetUid(target.itemUid)
      window.setTimeout(() => { setHighlightedTargetUid(current => current === target.itemUid ? '' : current) }, 2_400)
      arkmeUi.consumeConversationTarget(target.revision)
      return
    }
    if (loadingOlder) return
    if (!hasMore || nextCursor === undefined || conversationTargetPagingRef.current.pages >= 80) {
      setError('已打开对应会话，但暂未能在当前历史中定位该条消息')
      arkmeUi.consumeConversationTarget(target.revision)
      return
    }
    conversationTargetPagingRef.current.pages += 1
    setLoadingOlder(true)
    void loadTimeline(nextCursor, true, 100)
      .catch(caught => { setError(errorMessage(caught)); arkmeUi.consumeConversationTarget(target.revision) })
      .finally(() => { setLoadingOlder(false) })
  }, [activeConversation, authenticated, conversationKey, hasMore, items, loadTimeline, loadingOlder, nextCursor, source, timelineStateKey, ui.conversationTarget])

  useEffect(() => {
    if (!authStoreSnapshot.checked) void refreshAuth()
  }, [authStoreSnapshot.checked, refreshAuth, ui.authRevision])
  useLayoutEffect(() => {
    timelineGenerationRef.current += 1
    timelineRequestAbortRef.current?.abort()
    timelineRequestAbortRef.current = undefined
    timelineRequestKeyRef.current = ''
    const accountChanged = cacheAccountKeyRef.current !== authenticatedAccountKey
    if (!accountChanged && timelineStateKey !== '' && bodyRef.current !== null) {
      conversationCacheRef.current.storeViewport(timelineStateKey, arkmeConversationViewport(bodyRef.current))
    }
    if (accountChanged) {
      conversationCacheRef.current.clear()
      cacheAccountKeyRef.current = authenticatedAccountKey
    }
    const sourceKey = authenticated && conversationKey !== '' ? conversationKey : undefined
    const cachedTimeline = sourceKey === undefined
      ? undefined
      : conversationCacheRef.current.getTimeline(sourceKey)
    if (sourceKey !== undefined && cachedTimeline !== undefined) {
      pendingViewportRestoreRef.current = {
        sourceKey,
        viewport: conversationCacheRef.current.getViewport(sourceKey),
      }
    } else {
      pendingViewportRestoreRef.current = undefined
    }
    setTimelineView({
      sourceKey: sourceKey ?? '',
      items: cachedTimeline?.items ?? [],
      aiPolishNotices: cachedTimeline?.aiPolishNotices ?? [],
      aiPolishSettings: cachedTimeline?.aiPolishSettings,
      nextCursor: cachedTimeline?.nextCursor,
      hasMore: cachedTimeline?.hasMore ?? false,
    })
    setTimelineLoadingKey(sourceKey !== undefined && cachedTimeline === undefined ? sourceKey : '')
    setTimelineSkeletonKey('')
    setTimelineRevealKey('')
    setNewMessageCount(0)
    setDrawer(undefined); setGroupMembersOpen(false); setDetailItemUid(''); setShowOriginal(false)
    if (authenticated) setError('')
    setLongArticleCreating(false); setAddMenuOpen(false)
    interwovenRequestRef.current?.abort()
    interwovenGenerationRef.current += 1
    detailRequestRef.current?.abort()
    detailRequestMomentRef.current = ''
    momentRelatedGenerationRef.current += 1
    momentRelatedRequestRef.current?.abort()
    momentRelatedRequestRef.current = undefined
    momentRelatedDetailRequestRef.current?.abort()
    momentRelatedDetailRequestRef.current = undefined
    setInterwovenMoments(sourceKey === undefined
      ? []
      : conversationCacheRef.current.getInterwovenMoments(sourceKey) ?? [])
    setSelectedMoment(undefined)
    setDetailState(undefined)
    setMomentRelatedView('source-detail')
    setMomentRelatedState({ kind: 'idle' })
    setMomentRelatedDetailState({ kind: 'idle' })
  }, [authenticated, authenticatedAccountKey, conversationKey])
  useEffect(() => {
    if (!activeConversation || !authenticated || source === undefined) return
    const generation = timelineGenerationRef.current
    const cachedTimeline = conversationCacheRef.current.getTimeline(conversationKey)
    const hasCachedTimeline = cachedTimeline !== undefined
    const authoritativeLatestSequence = Math.max(source.latestSequence ?? 0, chatDelta.latestSequence ?? 0)
    const realtimeCoversLatest = sourceIsChat && arkmeRealtimeDeltaCoversTimelineGap(
      cachedTimeline,
      chatDelta.items,
      authoritativeLatestSequence,
    )
    const shouldRefresh = sourceIsChat
      ? !realtimeCoversLatest && arkmeShouldRefreshChatTimeline(cachedTimeline, Date.now(), authoritativeLatestSequence)
      : arkmeShouldRefreshRecordTimeline(cachedTimeline, Date.now(), sourceProjectionRevision)
    if (!shouldRefresh) {
      setTimelineLoadingKey(current => current === conversationKey ? '' : current)
      setTimelineSkeletonKey(current => current === conversationKey ? '' : current)
      void acknowledgeRead(cachedTimeline?.items ?? [])
      return
    }
    void loadTimeline().catch(caught => {
      arkmeChatDirectory.rejectOptimisticRead(source.sourceRef, source.sourceKey, source.latestSequence ?? 0)
      if (generation === timelineGenerationRef.current) {
        setTimelineLoadingKey(current => current === conversationKey ? '' : current)
        setTimelineSkeletonKey(current => current === conversationKey ? '' : current)
        if (!hasCachedTimeline) setError(errorMessage(caught))
      }
    })
  }, [acknowledgeRead, activeConversation, authenticated, chatDelta.items, conversationKey, loadTimeline, source, sourceIsChat, sourceProjectionRevision])
  useEffect(() => {
    if (!authenticated || source === undefined || timelineStateKey !== conversationKey) return
    if (conversationCacheRef.current.getTimeline(conversationKey) === undefined) return
    conversationCacheRef.current.storeTimeline(conversationKey, {
      items,
      aiPolishNotices,
      hasMore,
      ...(aiPolishSettings === undefined ? {} : { aiPolishSettings }),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    })
  }, [aiPolishNotices, aiPolishSettings, authenticated, conversationKey, hasMore, items, nextCursor, source, timelineStateKey])
  useEffect(() => {
    if (!activeConversation || !authenticated || source?.kind !== 'private_chat') return
    const sourceRef = source.sourceRef
    const sourceKey = conversationKey
    if (conversationCacheRef.current.isInterwovenFresh(sourceKey, interwovenRefreshRevision)) return
    const generation = ++interwovenGenerationRef.current
    const controller = new AbortController()
    interwovenRequestRef.current?.abort()
    interwovenRequestRef.current = controller
    let active = true
    void callArkme<ArkmeInterwovenBootstrap>('source.interwoven-moments', {
      sourceRef,
    }, controller.signal).then(result => {
      if (!active || generation !== interwovenGenerationRef.current) return
      const moments = result.state === 'disabled' || result.state === 'empty' ? [] : result.moments
      const previous = conversationCacheRef.current.getInterwovenMoments(sourceKey)
      const ready = conversationCacheRef.current.storeInterwovenMoments(sourceKey, moments, interwovenRefreshRevision)
      if (!ready || JSON.stringify(previous) === JSON.stringify(moments)) return
      const body = bodyRef.current
      pendingViewportRestoreRef.current = {
        sourceKey,
        viewport: body === null ? conversationCacheRef.current.getViewport(sourceKey) : arkmeConversationViewport(body),
      }
      setInterwovenMoments(moments)
    }).catch(() => undefined).finally(() => {
      if (!active || generation !== interwovenGenerationRef.current) return
      if (interwovenRequestRef.current === controller) interwovenRequestRef.current = undefined
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [activeConversation, authenticated, conversationKey, interwovenRefreshRevision, source?.kind])
  const appliedInterwovenInvalidationsRef = useRef(new Map<string, number>())
  useEffect(() => {
    const observationKey = `${authenticatedAccountKey ?? 'logged-out'}:${conversationKey}`
    const applied = appliedInterwovenInvalidationsRef.current.get(observationKey) ?? 0
    if (interwovenInvalidation.revision <= applied) return
    if (!activeConversation || !authenticated || typeof window === 'undefined') return
    const revision = interwovenInvalidation.revision
    const timer = setTimeout(() => {
      appliedInterwovenInvalidationsRef.current.delete(observationKey)
      appliedInterwovenInvalidationsRef.current.set(observationKey, revision)
      while (appliedInterwovenInvalidationsRef.current.size > 64) {
        const oldest = appliedInterwovenInvalidationsRef.current.keys().next().value as string | undefined
        if (oldest === undefined) break
        appliedInterwovenInvalidationsRef.current.delete(oldest)
      }
      setInterwovenRefreshRevision(value => value + 1)
    }, 250)
    return () => { clearTimeout(timer) }
  }, [activeConversation, authenticated, authenticatedAccountKey, conversationKey, interwovenInvalidation.revision])
  useEffect(() => {
    if (!activeConversation || !authenticated || typeof window === 'undefined') return
    const refreshOnFocus = () => { setInterwovenRefreshRevision(value => value + 1) }
    window.addEventListener('focus', refreshOnFocus)
    return () => { window.removeEventListener('focus', refreshOnFocus) }
  }, [activeConversation, authenticated])
  useEffect(() => {
    if (!activeConversation || !authenticated || source === undefined) return
    const deltaItems = chatDelta.items
    if (deltaItems.length === 0) return
    const nextItems = mergeItems(items, deltaItems)
    if (JSON.stringify(nextItems) === JSON.stringify(items)) return
    const body = bodyRef.current
    const viewport = body === null ? undefined : arkmeConversationViewport(body)
    pendingViewportRestoreRef.current = { sourceKey: conversationKey, viewport }
    const existingIds = new Set(items.map(item => item.itemUid))
    const incomingCount = deltaItems.filter(item => !existingIds.has(item.itemUid)).length
    setTimelineView(current => {
      if (current.sourceKey !== conversationKey) return current
      const mergedItems = mergeItems(current.items, deltaItems)
      return sameStateValue(current.items, mergedItems) ? current : { ...current, items: mergedItems }
    })
    if (viewport?.stickToBottom === false && incomingCount > 0) {
      setNewMessageCount(current => current + incomingCount)
    } else {
      setNewMessageCount(0)
    }
    void acknowledgeRead(deltaItems)
  }, [acknowledgeRead, activeConversation, authenticated, chatDelta, conversationKey, items, source])

  useEffect(() => {
    if (!activeConversation || !authenticated || source?.kind !== 'group_chat') return
    let cancelled = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const browserDocument = typeof document === 'undefined' ? undefined : document
    const foreground = () => browserDocument?.visibilityState !== 'hidden'
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const refreshPresentation = async () => {
      if (cancelled || pending || !foreground()) return
      pending = true
      const request = new AbortController()
      controller = request
      try {
        const [settingsResult, noticesResult] = await Promise.allSettled([
          callArkme<ArkmeGroupAiPolishSnapshot>('source.ai-polish.settings', {
            sourceRef: source.sourceRef,
          }, request.signal),
          callArkme<ArkmeGroupAiPolishNotice[]>('source.ai-polish.notices', {
            sourceRef: source.sourceRef,
          }, request.signal),
        ])
        if (!cancelled && !request.signal.aborted) {
          if (settingsResult.status === 'fulfilled'
            && !sameStateValue(aiPolishSettingsRef.current, settingsResult.value)) {
            const snapshot = settingsResult.value
            aiPolishSettingsRef.current = snapshot
            setAiPolishSettings(snapshot)
          }
          if (noticesResult.status === 'fulfilled'
            && !sameStateValue(aiPolishNoticesRef.current, noticesResult.value)) {
            const notices = noticesResult.value
            aiPolishNoticesRef.current = notices
            setAiPolishNotices(notices)
          }
        }
      } catch {
        // Keep the last owner snapshot on a transient presentation read failure.
      } finally {
        if (controller === request) controller = undefined
        pending = false
        if (!cancelled && foreground()) timer = setTimeout(() => { timer = undefined; void refreshPresentation() }, 3_000)
      }
    }
    const onVisibilityChange = () => {
      if (foreground()) void refreshPresentation()
      else { clearTimer(); controller?.abort() }
    }
    void refreshPresentation()
    browserDocument?.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      clearTimer()
      controller?.abort()
      browserDocument?.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeConversation, authenticated, conversationKey, source?.kind, source?.sourceRef])

  useEffect(() => {
    const root = bodyRef.current; const sentinel = sentinelRef.current
    if (!activeConversation || !authenticated || root === null || sentinel === null || !hasMore || nextCursor === undefined) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true || loadingOlder) return
      setLoadingOlder(true)
      void loadTimeline(nextCursor, true).catch(caught => { setError(errorMessage(caught)) }).finally(() => { setLoadingOlder(false) })
    }, { root, rootMargin: '120px 0px 0px' })
    observer.observe(sentinel); return () => { observer.disconnect() }
  }, [activeConversation, authenticated, hasMore, loadTimeline, loadingOlder, nextCursor])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  useEffect(() => {
    const ownsCurrentQrLogin = ownsQrLogin && ['jiwo', 'wechat'].includes(loginMode)
    if (!ownsCurrentQrLogin || !agreed || auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const operation = loginMode === 'jiwo' ? 'auth.app.poll' : 'auth.poll'
    const poll = async () => {
      try {
        const snapshot = await callArkme<ArkmeAuthSnapshot>(operation, { attemptId: auth.attemptId })
        if (stopped) return
        acceptAuthSnapshot(snapshot)
        if (snapshot.status === 'authenticated' || snapshot.status === 'expired') {
          if (loginMode === 'jiwo') currentJiwoAttemptRef.current = undefined
          setQr('')
          return
        }
      } catch (caught) { if (!stopped) setError(arkmeLoginErrorMessage(caught, t)) }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 1200)
    return () => { stopped = true; clearTimeout(timer) }
  }, [agreed, auth?.attemptId, auth?.status, loginMode, ownsQrLogin, t])

  const beginWechat = async () => {
    const flowRevision = ++qrFlowRevisionRef.current
    if (!agreed) { setError(t('error.agreement.required')); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.begin')
      if (flowRevision !== qrFlowRevisionRef.current) return
      acceptAuthSnapshot(snapshot)
      setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent))
    } catch (caught) {
      if (flowRevision === qrFlowRevisionRef.current) setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      if (flowRevision === qrFlowRevisionRef.current) setBusy(false)
    }
  }

  const beginJiwo = async () => {
    const flowRevision = ++qrFlowRevisionRef.current
    if (!agreed) { setError(t('error.agreement.required')); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.app.begin')
      if (flowRevision !== qrFlowRevisionRef.current) {
        if (snapshot.attemptId !== undefined) {
          void callArkme('auth.app.cancel', { attemptId: snapshot.attemptId }).catch(() => undefined)
        }
        return
      }
      currentJiwoAttemptRef.current = snapshot.attemptId
      acceptAuthSnapshot(snapshot)
      setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent))
    } catch (caught) {
      if (flowRevision === qrFlowRevisionRef.current) setError(arkmeLoginErrorMessage(caught, t))
    } finally {
      if (flowRevision === qrFlowRevisionRef.current) setBusy(false)
    }
  }

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError(t('error.phone.eleven')); return }
    setBusy(true); setError('')
    try { const captcha = await verifyPhoneCaptcha(captchaId, phone); await callArkme('auth.phone.send', { phone, captcha }); setSmsCountdown(60) }
    catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) } finally { setBusy(false) }
  }

  const verifyCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError(t('error.phone.invalid')); return }
    if (!/^\d{6}$/.test(smsCode)) { setError(t('error.code.invalid')); return }
    if (!agreed) { setError(t('error.agreement.required')); return }
    setBusy(true); setSubmitBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      acceptAuthSnapshot(snapshot)
    } catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) } finally { setSubmitBusy(false); setBusy(false) }
  }

  const testLogin = async () => {
    const userId = Number(testUserId)
    if (!Number.isSafeInteger(userId) || userId <= 0) { setError(t('error.test.invalid')); return }
    if (!agreed) { setError(t('error.agreement.required')); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.test.login', { userId })
      acceptAuthSnapshot(snapshot)
    } catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) } finally { setBusy(false) }
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
      setLoginMode(jiwoScanLoginEnabled ? 'jiwo' : testLoginEnabled ? 'test' : 'wechat')
      arkmeUi.authChanged(false)
    } catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) } finally { setBusy(false) }
  }

  useEffect(() => {
    qrRequestStartedRef.current = arkmeWechatRequestStartedAfterAuthStatus(
      qrRequestStartedRef.current,
      auth?.status,
    )
  }, [auth?.status])

  useEffect(() => {
    const shouldBegin = loginMode === 'jiwo'
      ? ownsQrLogin && jiwoScanLoginEnabled && authView === 'login' && auth !== undefined
        && ['logged-out', 'expired'].includes(auth.status) && agreed && qr === '' && !qrRequestStartedRef.current
      : arkmeShouldBeginWechat(auth, authView, loginMode, agreed, qr, qrRequestStartedRef.current, ownsQrLogin)
    if (!shouldBegin) return
    qrRequestStartedRef.current = true
    void (loginMode === 'jiwo' ? beginJiwo() : beginWechat())
  }, [agreed, auth, authView, jiwoScanLoginEnabled, loginMode, ownsQrLogin, qr])

  useEffect(() => () => {
    qrFlowRevisionRef.current += 1
    const attemptId = currentJiwoAttemptRef.current
    currentJiwoAttemptRef.current = undefined
    if (attemptId !== undefined) {
      void callArkme('auth.app.cancel', { attemptId }).catch(() => undefined)
    }
  }, [])

  const changeLoginMode = (mode: ArkmeLoginMode) => {
    qrFlowRevisionRef.current += 1
    const attemptId = currentJiwoAttemptRef.current
    currentJiwoAttemptRef.current = undefined
    if (attemptId !== undefined) {
      void callArkme('auth.app.cancel', { attemptId }).catch(() => undefined)
    }
    if (auth?.status === 'pending') {
      pendingLoginModeSelectionRef.current = mode
      arkmeAuthStore.setAuth({ status: 'logged-out', environment: auth.environment })
    }
    setLoginMode(mode)
    setQr('')
    setError('')
    qrRequestStartedRef.current = false
  }

  const uploadFavoriteSticker = async (file: File): Promise<ArkmeUploadedAsset> => await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/arkme-self/api/upload')
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    request.setRequestHeader('X-Arkme-File-Name', encodeURIComponent(file.name))
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
    const targetDraftKey = composerDraftKey
    const targetUserId = authenticatedUserId
    if (targetDraftKey === undefined || targetUserId === undefined) return
    const picked = Array.from(files)
    const controller = new AbortController(); stageControllers.current.add(controller)
    setAddMenuOpen(false); setError(''); setPreparingKeys(current => new Set([...current, targetDraftKey]))
    if (fileInputRef.current !== null) fileInputRef.current.value = ''
    const job = (preparationJobs.current.get(targetDraftKey) ?? Promise.resolve(true)).catch(() => false).then(async () => {
      const sdk = createArkmeSdk()
      const policy = await sdk.fileCapabilities()
      const errors: string[] = []
      let added = false
      for (const file of picked) {
        controller.signal.throwIfAborted()
        const limit = file.type.startsWith('image/') ? policy.maxImageBytes : policy.maxFileBytes
        if (arkmeComposerDraftStore.get(targetDraftKey).attachments.length >= policy.maxAttachments) { errors.push(`最多添加 ${policy.maxAttachments} 个附件：${file.name}`); continue }
        if (file.size === 0 || file.size > limit) { errors.push(`${file.name} 为空或超过 ${Math.floor(limit / 1024 / 1024)} MiB`); continue }
        try {
          const localFile = await sdk.stageFile(file, { signal: controller.signal })
          const currentAuth = arkmeAuthStore.getSnapshot().auth
          if (currentAuth?.status !== 'authenticated' || currentAuth.userId !== targetUserId) return false
          arkmeComposerDraftStore.appendAttachments(targetDraftKey, [{ localFile }], policy.maxAttachments)
          added = true
        } catch (caught) { if (controller.signal.aborted) throw caught; errors.push(`${file.name}：${errorMessage(caught)}`) }
      }
      if (errors.length > 0) setError(errors.join('；'))
      return added
    }).catch(caught => { if (!controller.signal.aborted) setError(errorMessage(caught)); return false }).finally(() => {
      stageControllers.current.delete(controller)
      if (preparationJobs.current.get(targetDraftKey) === job) {
        preparationJobs.current.delete(targetDraftKey)
        setPreparingKeys(current => { const next = new Set(current); next.delete(targetDraftKey); return next })
      }
      pendingComposerFocusDraftKeyRef.current = targetDraftKey
    })
    preparationJobs.current.set(targetDraftKey, job)
    await job
  }

  const send = async () => {
    if (source === undefined || composerDraftKey === undefined) return
    const targetSource = source
    const targetDraftKey = composerDraftKey
    const targetUserId = authenticatedUserId
    if (targetUserId === undefined) return
    const preparation = preparationJobs.current.get(targetDraftKey)
    const preparationSucceeded = preparation === undefined ? true : await preparation
    if (preparationSucceeded === false) return
    const currentAuth = arkmeAuthStore.getSnapshot().auth
    if (currentAuth?.status !== 'authenticated' || currentAuth.userId !== targetUserId) return
    const readyDraft = arkmeComposerDraftStore.get(targetDraftKey)
    const serializedDraft = serializeArkmeComposerDraft(readyDraft)
    const rawTextContent = serializedDraft.text
    const textContent = rawTextContent.trim()
    if (textContent === '' && readyDraft.attachments.length === 0) return
    const composerStartedAt = composerInputStartedAtRef.current
    const recordDurationMillis = composerStartedAt?.draftKey === targetDraftKey
      ? Math.max(0, Date.now() - composerStartedAt.startedAt)
      : 0
    const captureContextPromise = arkmeComposerCaptureContext()
    const selectedLocation = composerLocation
    const { recordUid, relationUid } = readyDraft.attachments.some(item => item.localFile !== undefined)
      ? arkmeComposerDraftStore.beginFileSend(targetDraftKey)
      : { recordUid: crypto.randomUUID(), relationUid: crypto.randomUUID() }
    // Take the draft before any network await.  The next keystroke now belongs to a
    // fresh draft and can be sent independently instead of being swallowed by a busy lock.
    const pendingDraft = arkmeComposerDraftStore.take(targetDraftKey)
    pendingComposerFocusDraftKeyRef.current = targetDraftKey
    const captureContext = await captureContextPromise
    const now = Date.now()
    const optimisticSenderName = selfProfile?.displayName.trim() || selfProfile?.nickname.trim() || '我'
    const optimisticAvatarRef = selfProfile?.avatarRef.trim()
    const optimistic: ArkmeTimelineItem = {
      itemUid: recordUid, senderName: optimisticSenderName, isMe: true, sendAtMillis: now,
      ...(optimisticAvatarRef === undefined || optimisticAvatarRef === '' ? {} : { avatarRef: optimisticAvatarRef }),
      title: '', textContent, status: 0,
      ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
      captureContext,
      ...(targetSource.kind === 'group_chat' && aiPolishSettings?.enabled === true
        ? { aiPolish: { state: 'polishing' as const, originalText: textContent } }
        : {}),
      displayKind: 0,
    }
    const pendingAttachments = [...pendingDraft.attachments]
    const pendingAssets = pendingAttachments.flatMap(attachment => attachment.asset === undefined ? [] : [attachment.asset])
    const pendingFileRefs = pendingAttachments.flatMap(attachment => attachment.localFile === undefined ? [] : [attachment.localFile.fileRef])
    pendingViewportRestoreRef.current = { sourceKey: arkmeSourceIdentityKey(targetSource), viewport: undefined }
    const pendingHumanMentions = serializedDraft.mentions.flatMap<ArkmeHumanMentionInput>(mention => {
      const base = { startIndex: mention.startIndex, length: mention.length }
      if (mention.all === true) return [{ ...base, all: true }]
      return mention.mentionRef === undefined ? [] : [{ ...base, mentionRef: mention.mentionRef }]
    })
    const pendingBotMentions = serializedDraft.mentions.flatMap<{ botRef: string; startIndex: number; length: number }>(mention => {
      if (mention.botRef === undefined) return []
      return [{ botRef: mention.botRef, startIndex: mention.startIndex, length: mention.length }]
    })
    if (pendingFileRefs.length === 0) setItems(current => mergeItems(current, [optimistic]))
    setError('')
    try {
      if (pendingFileRefs.length > 0) {
        if (pendingAssets.length > 0) throw new Error('旧版附件与本地附件不能混合发送，请重新添加旧版附件')
        const acceptedTask = await callArkme<ArkmeFileSendTask>('files.send', {
          sourceRef: targetSource.sourceRef, recordUid, relationUid, fileRefs: pendingFileRefs, title: '', textContent: rawTextContent, displayKind: 0,
          ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
          captureContext,
          ...(pendingHumanMentions.length === 0 ? {} : { humanMentions: pendingHumanMentions }),
          ...(pendingBotMentions.length === 0 ? {} : { botMentions: pendingBotMentions }),
        })
        releaseArkmeComposerDraft(pendingDraft)
        setComposerLocation(undefined)
        fileTasks.accept(acceptedTask)
        return
      }
      const result = pendingAssets.length > 0
        ? await callArkme<ArkmeSourceSendResult>('source.send-rich', {
          sourceRef: targetSource.sourceRef, title: '', textContent: rawTextContent, displayKind: 0,
          assets: pendingAssets, recordUid, relationUid,
          ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
          captureContext,
          ...(pendingHumanMentions.length === 0 ? {} : { humanMentions: pendingHumanMentions }),
          ...(pendingBotMentions.length === 0 ? {} : { botMentions: pendingBotMentions }),
        })
        : await callArkme<ArkmeSourceSendResult>('source.send-text', {
          sourceRef: targetSource.sourceRef, textContent: rawTextContent, recordUid, relationUid,
          ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
          captureContext,
          ...(pendingHumanMentions.length === 0 ? {} : { humanMentions: pendingHumanMentions }),
          ...(pendingBotMentions.length === 0 ? {} : { botMentions: pendingBotMentions }),
        })
      setItems(current => applySourceSendResult(current, recordUid, result))
      if (result.localState !== 'failed' && selectedLocation !== undefined) {
        setComposerLocation(undefined)
        void callArkme('source.message-location.set', {
          sourceRef: targetSource.sourceRef,
          itemUid: result.itemUid,
          location: selectedLocation,
        }).then(() => {
          setItems(current => current.map(item => item.itemUid === result.itemUid ? { ...item, locationCapture: selectedLocation } : item))
        }).catch(caught => {
          setError(`消息已发送，但位置快照未写入：${errorMessage(caught) || '请稍后重试'}`)
        })
      }
      if (result.localState !== 'failed' && isArkmeChatDirectorySource(targetSource)
        && result.sequence !== undefined) {
        const targetSourceKey = arkmeSourceIdentityKey(targetSource)
        const cachedTimeline = conversationCacheRef.current.getTimeline(targetSourceKey)
        if (cachedTimeline !== undefined) {
          conversationCacheRef.current.storeTimeline(targetSourceKey, {
            ...cachedTimeline,
            items: applySourceSendResult(mergeItems(cachedTimeline.items, [optimistic]), recordUid, result),
            latestSequence: Math.max(cachedTimeline.latestSequence ?? 0, result.sequence),
          })
        }
        arkmeMessageReadReceipts.provision({
          sourceRef: targetSource.sourceRef,
          sourceKey: targetSource.sourceKey ?? targetSource.sourceRef,
          conversationKind: targetSource.kind === 'private_chat' ? 'private_chat' : 'group_chat',
          itemUid: result.itemUid,
          sequence: result.sequence,
        })
      }
      releaseArkmeComposerDraft(pendingDraft)
      if (result.localState === 'failed') setError(result.error ?? '内容已保存在本地，远端同步失败')
      if (result.localState !== 'failed' && isArkmeSelfWorkspaceSource(targetSource)) arkmeUi.chatChanged()
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
      setItems(current => current.filter(item => item.itemUid !== recordUid))
      const currentAuth = arkmeAuthStore.getSnapshot().auth
      if (currentAuth?.status === 'authenticated' && currentAuth.userId === targetUserId) {
        // restore() preserves any newer text entered after this send started.
        if (pendingFileRefs.length === 0) arkmeComposerDraftStore.restore(targetDraftKey, pendingDraft)
        else releaseArkmeComposerDraft(pendingDraft)
      } else {
        releaseArkmeComposerDraft(pendingDraft)
      }
      setError(errorMessage(caught))
    }
  }

  const updateComposerText = (text: string) => {
    if (composerDraftKey !== undefined && text.length > 0) {
      const current = composerInputStartedAtRef.current
      if (current?.draftKey !== composerDraftKey) {
        const next = { draftKey: composerDraftKey, startedAt: Date.now() }
        composerInputStartedAtRef.current = next
      }
    } else {
      composerInputStartedAtRef.current = undefined
    }
    arkmeComposerDraftStore.setText(composerDraftKey, text)
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
  const detailSharedRecording = detailItem === undefined
    ? undefined
    : arkmeRelatedRecordingItemFromSharedRecording(detailItem)
  const activateSource = useCallback((nextSource: ArkmeTimelinePage['source']) => {
    // The directory owns the middle conversation list. Update it before selecting
    // the source so sources opened outside that list (for example, from World)
    // have an entry to select immediately instead of waiting for its cached refresh.
    // Personal categories and topics belong only to the send-to-self workspace;
    // selecting one must not promote it into the left conversation directory.
    if (isArkmeChatDirectorySource(nextSource)) arkmeChatDirectory.upsert(nextSource)
    arkmeUi.selectSource(nextSource)
    arkmeUi.chatChanged()
  }, [])
  const conversationMemberByRef = useMemo(
    () => new Map(conversationMembers.map(member => [member.memberRef, member])),
    [conversationMembers],
  )
  const composerMentionsEnabled = source?.kind === 'group_chat' || source?.kind === 'private_chat'
  const mentionCandidates = useMemo(
    (): ArkmeMentionCandidate[] => {
      if (!composerMentionsEnabled || mentionTrigger === undefined) return []
      if (source?.kind === 'group_chat') {
        return arkmeGroupMentionCandidates(
          mentionTrigger.query,
          groupMentionBots?.items ?? [],
          conversationMembers,
        )
      } else if (source?.kind === 'private_chat') {
        const candidates: ArkmeMentionCandidate[] = []
        candidates.push(...(privateMentionBots?.items ?? [])
          .filter(bot => bot.provider === 'openclaw' && arkmeMentionCandidateMatches({
            displayName: bot.name,
            secondaryName: bot.description,
          }, mentionTrigger.query))
          .slice(0, 8)
          .map(bot => ({
            kind: 'bot' as const,
            botRef: bot.botRef,
            displayName: bot.name,
            ...(bot.description.trim() === '' ? {} : { secondaryName: bot.description.trim() }),
          })))
        return candidates
      }
      return []
    },
    [composerMentionsEnabled, conversationMembers, groupMentionBots?.items, mentionTrigger, privateMentionBots?.items, source?.kind],
  )
  const selfConversationMember = useMemo(
    () => conversationMembers.find(member => member.isSelf),
    [conversationMembers],
  )
  useEffect(() => { setMentionCandidateIndex(0) }, [mentionTrigger?.startIndex, mentionTrigger?.endIndex, mentionTrigger?.query])
  useEffect(() => {
    setMentionTrigger(undefined)
    setMentionCandidateIndex(0)
  }, [conversationKey, source?.kind])
  const closeMemberMenu = useCallback(() => { setMemberMenu(undefined) }, [])
  const openMemberMenu = useCallback((member: ArkmeConversationMemberItem, anchorRect: DOMRect) => {
    const host = panelRef.current
    if (host === null || source === undefined) return
    setMemberProfile(undefined)
    setMemberRecords(undefined)
    setMemberMenu({
      member,
      position: positionArkmeMemberMenu(
        anchorRect,
        host.getBoundingClientRect(),
        arkmeMemberActionMenuRowCount(member, source.kind),
      ),
    })
  }, [source])
  const openMemberProfile = useCallback((member: ArkmeConversationMemberItem) => {
    if (source?.kind !== 'group_chat') return
    setMemberMenu(undefined)
    setMemberRecords(undefined)
    setMemberProfile(member)
  }, [source?.kind])
  const openMemberRecords = useCallback((member: ArkmeConversationMemberItem, mode: ArkmeConversationMemberRecordMode) => {
    setMemberMenu(undefined)
    setMemberProfile(undefined)
    activateContextPanel('records')
    setMemberRecords({ member, mode })
  }, [])
  const insertMemberMentionAt = useCallback((
    member: ArkmeConversationMemberItem,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => {
    if (composerDraftKey === undefined || member.isSelf || member.mentionRef === undefined || !composerMentionsEnabled) return
    const cursor = arkmeComposerDraftStore.insertMention(
      composerDraftKey,
      member.mentionRef,
      member.displayName,
      selectionStart,
      selectionEnd,
    )
    setMemberMenu(undefined)
    setMentionTrigger(undefined)
    if (cursor === undefined) return
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursor, cursor)
    })
  }, [composerDraftKey, composerMentionsEnabled])

  const insertEmoji = useCallback((emoji: ArkmeEmoji) => {
    if (composerDraftKey === undefined || busy) return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? start
    const caretIndex = arkmeComposerDraftStore.insertEmoji(composerDraftKey, emoji, start, end)
    if (caretIndex === undefined) return
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caretIndex, caretIndex)
    })
  }, [busy, composerDraftKey, draft])
  const insertMemberMention = useCallback((member: ArkmeConversationMemberItem) => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? start
    insertMemberMentionAt(member, start, end)
  }, [draft.length, insertMemberMentionAt])
  const insertMentionCandidate = useCallback((member: ArkmeMentionCandidate) => {
    if (mentionTrigger === undefined) return
    if (member.kind === 'all') {
      if (composerDraftKey === undefined || !composerMentionsEnabled) return
      const cursor = arkmeComposerDraftStore.insertAllMention(
        composerDraftKey,
        mentionTrigger.startIndex,
        mentionTrigger.endIndex,
      )
      setMentionTrigger(undefined)
      if (cursor === undefined) return
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(cursor, cursor)
      })
      return
    }
    if (member.kind === 'bot') {
      if (composerDraftKey === undefined || !composerMentionsEnabled) return
      const cursor = arkmeComposerDraftStore.insertBotMention(
        composerDraftKey,
        member.botRef,
        member.displayName,
        mentionTrigger.startIndex,
        mentionTrigger.endIndex,
      )
      setMentionTrigger(undefined)
      if (cursor === undefined) return
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(cursor, cursor)
      })
      return
    }
    insertMemberMentionAt(member, mentionTrigger.startIndex, mentionTrigger.endIndex)
  }, [composerDraftKey, composerMentionsEnabled, insertMemberMentionAt, mentionTrigger])
  const updateMentionTrigger = useCallback((text: string, selectionStart: number, selectionEnd: number) => {
    if (!composerMentionsEnabled) {
      setMentionTrigger(undefined)
      return
    }
    setMentionTrigger(arkmeComposerMentionTrigger(text, selectionStart, selectionEnd))
  }, [composerMentionsEnabled])
  const openPrivateChatForMember = useCallback((member: ArkmeConversationMemberItem) => {
    if (source === undefined || privateChatBusy) return
    setPrivateChatBusy(true)
    setError('')
    if (arkmeMemberConversationAction(member) === 'send_to_self') {
      if (aggregateSource === undefined) {
        setError('发给自己暂不可用，请稍后重试')
        setPrivateChatBusy(false)
        return
      }
      setMemberProfile(undefined)
      setMemberRecords(undefined)
      activateSource(aggregateSource)
      setPrivateChatBusy(false)
      return
    }
    void callArkme<ArkmeOpenPrivateChatResult>('chat.member.private.open', {
      sourceRef: source.sourceRef,
      memberRef: member.memberRef,
    })
      .then(result => {
        setMemberProfile(undefined)
        setMemberRecords(undefined)
        activateSource(result.source)
      })
      .catch(caught => { setError(errorMessage(caught)) })
      .finally(() => { setPrivateChatBusy(false) })
  }, [activateSource, aggregateSource, privateChatBusy, source])
  useEffect(() => {
    if (memberMenu === undefined) return
    const close = () => { setMemberMenu(undefined) }
    const body = bodyRef.current
    body?.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      body?.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [memberMenu])
  const activateSelfSource = useCallback((nextSource: ArkmeTimelinePage['source']) => {
    activateSource(nextSource)
  }, [activateSource])
  const activateSendToSelf = useCallback(() => {
    arkmeUi.focusSendToSelf()
    arkmeUi.chatChanged()
  }, [])
  const acceptSelfSourcesResolution = useCallback((
    userId: number,
    resolution: ArkmeSelfSourcesResolution,
  ) => {
    setSelfSourcesResolution({ userId, resolution })
  }, [])
  const invalidateTopicSelection = useCallback(() => {
    arkmeUi.focusSendToSelf()
  }, [])

  const loadMomentRelated = async (moment: ArkmeInterwovenMention) => {
    if (source === undefined || source.kind !== 'private_chat') return
    momentRelatedRequestRef.current?.abort()
    const controller = new AbortController()
    const generation = ++momentRelatedGenerationRef.current
    momentRelatedRequestRef.current = controller
    setMomentRelatedState({ kind: 'loading' })
    try {
      const list = await callArkme<ArkmeRelatedQuickNoteList>('source.related-quick-notes.from-moment', {
        sourceRef: source.sourceRef,
        momentRef: moment.momentRef,
      }, controller.signal)
      if (controller.signal.aborted || momentRelatedRequestRef.current !== controller
        || generation !== momentRelatedGenerationRef.current) return
      setMomentRelatedState(list.items.length === 0 ? { kind: 'empty' } : { kind: 'success', list })
    } catch (caught) {
      if (controller.signal.aborted || momentRelatedRequestRef.current !== controller
        || generation !== momentRelatedGenerationRef.current) return
      setMomentRelatedState({ kind: 'error', message: errorMessage(caught) })
    } finally {
      if (momentRelatedRequestRef.current === controller) momentRelatedRequestRef.current = undefined
    }
  }

  const loadMomentRelatedDetail = async (relatedItem: ArkmeRelatedQuickNoteItem) => {
    if (source === undefined || source.kind !== 'private_chat') return
    momentRelatedDetailRequestRef.current?.abort()
    const controller = new AbortController()
    momentRelatedDetailRequestRef.current = controller
    setMomentRelatedView('related-detail')
    setMomentRelatedDetailState({ kind: 'loading' })
    try {
      const detail = await callArkme<ArkmeRelatedQuickNoteDetail>('source.related-quick-note.detail', {
        sourceRef: source.sourceRef,
        relatedRef: relatedItem.relatedRef,
      }, controller.signal)
      if (controller.signal.aborted || momentRelatedDetailRequestRef.current !== controller) return
      setMomentRelatedDetailState({ kind: 'success', item: relatedItem, detail })
    } catch (caught) {
      if (controller.signal.aborted || momentRelatedDetailRequestRef.current !== controller) return
      if (relatedQuickNoteReferenceExpired(caught)) {
        setMomentRelatedDetailState({ kind: 'idle' })
        setMomentRelatedView('related-list')
        if (selectedMoment !== undefined) await loadMomentRelated(selectedMoment)
        return
      }
      setMomentRelatedDetailState({ kind: 'error', item: relatedItem, message: errorMessage(caught) })
    } finally {
      if (momentRelatedDetailRequestRef.current === controller) momentRelatedDetailRequestRef.current = undefined
    }
  }

  const loadMomentDetail = async (moment: ArkmeInterwovenMention, force = false) => {
    if (source === undefined || source.kind !== 'private_chat') return
    if (!force && detailRequestMomentRef.current === moment.momentId) return
    detailRequestRef.current?.abort()
    momentRelatedGenerationRef.current += 1
    momentRelatedRequestRef.current?.abort()
    momentRelatedRequestRef.current = undefined
    momentRelatedDetailRequestRef.current?.abort()
    momentRelatedDetailRequestRef.current = undefined
    const controller = new AbortController()
    detailRequestRef.current = controller
    detailRequestMomentRef.current = moment.momentId
    setSelectedMoment(moment)
    setDetailState({ kind: 'loading' })
    setMomentRelatedView('source-detail')
    setMomentRelatedState({ kind: 'idle' })
    setMomentRelatedDetailState({ kind: 'idle' })
    try {
      const detail = await callArkme<ArkmeInterwovenDetail>('source.interwoven-detail', {
        sourceRef: source.sourceRef,
        momentRef: moment.momentRef,
      }, controller.signal)
      if (detailRequestRef.current !== controller) return
      setDetailState({ kind: 'success', detail })
      void loadMomentRelated(moment)
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
    activateContextPanel('moment')
    void loadMomentDetail(moment)
  }

  const closeMomentDetail = () => {
    detailRequestRef.current?.abort()
    detailRequestRef.current = undefined
    detailRequestMomentRef.current = ''
    momentRelatedGenerationRef.current += 1
    momentRelatedRequestRef.current?.abort()
    momentRelatedRequestRef.current = undefined
    momentRelatedDetailRequestRef.current?.abort()
    momentRelatedDetailRequestRef.current = undefined
    setSelectedMoment(undefined)
    setDetailState(undefined)
    setMomentRelatedView('source-detail')
    setMomentRelatedState({ kind: 'idle' })
    setMomentRelatedDetailState({ kind: 'idle' })
  }

  const backMomentRelated = () => {
    if (momentRelatedView === 'related-detail') {
      momentRelatedDetailRequestRef.current?.abort()
      momentRelatedDetailRequestRef.current = undefined
    }
    setMomentRelatedView(relatedDrawerBackTarget(momentRelatedView))
  }

  const displayItems = useMemo(() => {
    const remoteIds = new Set(items.map(item => item.itemUid))
    const remoteItems = items.map(item => bindSentFileTaskLocals(item, fileTasks.tasks))
    return [...remoteItems, ...fileTasks.tasks.filter(task => !remoteIds.has(task.result?.itemUid ?? task.recordUid)).map(fileTaskTimelineItem)]
      .sort((a, b) => a.sendAtMillis - b.sendAtMillis)
  }, [items, fileTasks.tasks])
  const visibleConversationJoinEvents = useMemo(
    () => source?.kind === 'group_chat'
      ? arkmeConversationJoinEventsInLoadedWindow(conversationJoinEvents, displayItems, hasMore)
      : [],
    [conversationJoinEvents, displayItems, hasMore, source?.kind],
  )
  const displayRows = useMemo<Array<ArkmeConversationRow | {
    kind: 'notice'; id: string; occurredAtMillis: number; item: ArkmeGroupAiPolishNotice
  } | {
    kind: 'member-join'; id: string; occurredAtMillis: number; item: ArkmeConversationMemberJoinEvent
  }>>(
    () => [
      ...mergeConversationRows(displayItems, interwovenMoments),
      ...aiPolishNotices.map(notice => ({
        kind: 'notice' as const,
        id: `notice:${notice.noticeUid}`,
        occurredAtMillis: notice.createdAtMillis,
        item: notice,
      })),
      ...visibleConversationJoinEvents.map(event => ({
        kind: 'member-join' as const,
        id: `member-join:${event.eventId}`,
        occurredAtMillis: event.occurredAtMillis,
        item: event,
      })),
    ].sort((left, right) => left.occurredAtMillis - right.occurredAtMillis || left.id.localeCompare(right.id)),
    [aiPolishNotices, displayItems, interwovenMoments, visibleConversationJoinEvents],
  )
  const activeSelectMode = selectMode?.sourceKey === conversationKey ? selectMode : undefined
  const selectedMessageItems = useMemo(
    () => activeSelectMode === undefined ? [] : arkmeSelectedTimelineItems(displayItems, activeSelectMode.selectedIds),
    [activeSelectMode, displayItems],
  )
  const selectedMessageCount = activeSelectMode?.selectedIds.size ?? 0
  useLayoutEffect(() => {
    if (activeSelectMode === undefined) return
    const itemUid = pendingSelectRevealItemUidRef.current
    if (itemUid === '') return
    pendingSelectRevealItemUidRef.current = ''
    const body = bodyRef.current
    const row = body === null ? undefined : [...body.querySelectorAll<HTMLElement>('[data-arkme-message-item-uid]')]
      .find(element => element.dataset.arkmeMessageItemUid === itemUid)
    row?.scrollIntoView({ block: 'center' })
  }, [activeSelectMode, displayRows])
  const forwardVisibleTargets = useMemo(
    () => forwardTargetPicker === undefined
      ? []
      : arkmeForwardTargetVisibleSources(forwardTargetPicker.targets, forwardTargetPicker.keyword),
    [forwardTargetPicker],
  )
  const forwardSelectedTargets = useMemo(
    () => forwardTargetPicker === undefined
      ? []
      : forwardTargetPicker.selectedSourceRefs
        .map(sourceRef => forwardTargetPicker.targets.find(target => target.sourceRef === sourceRef))
        .filter((target): target is ArkmeSourceItem => target !== undefined),
    [forwardTargetPicker],
  )
  const forwardPickerMessageItems = forwardTargetPicker?.items ?? []
  const messageMenuItem = useMemo(
    () => messageMenu === undefined ? undefined : displayItems.find(item => item.itemUid === messageMenu.itemUid),
    [displayItems, messageMenu],
  )
  const showMessageActionStatus = useCallback((message: string, autoClear = true) => {
    if (messageActionStatusTimerRef.current !== undefined) {
      window.clearTimeout(messageActionStatusTimerRef.current)
      messageActionStatusTimerRef.current = undefined
    }
    setMessageActionStatus(message)
    if (message === '' || !autoClear) return
    messageActionStatusTimerRef.current = window.setTimeout(() => {
      setMessageActionStatus('')
      messageActionStatusTimerRef.current = undefined
    }, MESSAGE_ACTION_NOTICE_MS)
  }, [])
  const showForwardSuccessFeedback = useCallback((targets: readonly ArkmeSourceItem[], successCount: number, failureCount: number) => {
    if (forwardSuccessTimerRef.current !== undefined) {
      window.clearTimeout(forwardSuccessTimerRef.current)
      forwardSuccessTimerRef.current = undefined
    }
    const message = failureCount > 0
      ? `已转发到 ${String(successCount)} 个对象，${String(failureCount)} 个失败`
      : `已转发到 ${String(successCount)} 个对象`
    setForwardSuccessFeedback({ message, targets: [...targets] })
    forwardSuccessTimerRef.current = window.setTimeout(() => {
      setForwardSuccessFeedback(undefined)
      forwardSuccessTimerRef.current = undefined
    }, 4_000)
  }, [])
  const closeMessageMenu = useCallback(() => {
    setMessageMenu(undefined)
  }, [])
  const closeMessageSnapshot = useCallback(() => {
    snapshotRequestRef.current?.abort()
    snapshotRequestRef.current = undefined
    setSnapshot(undefined)
  }, [])
  const openMessageSnapshot = useCallback((item: ArkmeTimelineItem) => {
    if (!activeConversationRef.current) return
    closeMessageMenu()
    snapshotRequestRef.current?.abort()
    snapshotRequestRef.current = undefined
    const actionRef = arkmeTimelineMessageActionRef(item)
    setSnapshot({ item, actionRef, loading: true })
    if (source === undefined) {
      setSnapshot(current => current?.actionRef === actionRef
        ? { ...current, loading: false, loadError: '当前对话不可用，请刷新后重试' }
        : current)
      return
    }
    if (actionRef === '') {
      setSnapshot(current => current?.actionRef === actionRef
        ? { ...current, loading: false, loadError: '快记详情引用无效，请刷新后重试' }
        : current)
      return
    }
    const controller = new AbortController()
    snapshotRequestRef.current = controller
    void callArkme<ArkmeMessageSnapshotDetail>('source.message-snapshot.detail', {
      sourceRef: source.sourceRef,
      actionRef,
    }, controller.signal).then(detail => {
      if (controller.signal.aborted || snapshotRequestRef.current !== controller || !activeConversationRef.current) return
      setSnapshot(current => current?.actionRef === actionRef ? { ...current, detail, loading: false } : current)
    }).catch(caught => {
      if (controller.signal.aborted || snapshotRequestRef.current !== controller || !activeConversationRef.current) return
      setSnapshot(current => current?.actionRef === actionRef
        ? { ...current, loading: false, loadError: errorMessage(caught) || '请稍后重试' }
        : current)
    }).finally(() => {
      if (snapshotRequestRef.current === controller) snapshotRequestRef.current = undefined
    })
  }, [closeMessageMenu, source])
  const openMessageReport = useCallback((item: ArkmeTimelineItem) => {
    if (!activeConversationRef.current) return
    closeMessageMenu()
    if (!arkmeCanReportTimelineMessage(source, item)) return
    setMessageReportItem(item)
  }, [closeMessageMenu, source])
  const openMessageMenu = useCallback((item: ArkmeTimelineItem, event: Pick<MouseEvent, 'preventDefault' | 'stopPropagation' | 'clientX' | 'clientY'>) => {
    event.preventDefault()
    event.stopPropagation()
    const host = panelRef.current
    if (host === null || source === undefined) return
    const hostRect = host.getBoundingClientRect()
    const menuWidth = 178
    const menuHeight = 12 + arkmeMessageActionMenuRowCount(item, source) * 50
    setMemberMenu(undefined)
    setMessageMenu({
      itemUid: item.itemUid,
      left: Math.min(Math.max(8, event.clientX - hostRect.left), Math.max(8, hostRect.width - menuWidth - 8)),
      top: Math.min(Math.max(8, event.clientY - hostRect.top), Math.max(8, hostRect.height - menuHeight - 8)),
    })
  }, [source])
  const copyMessageText = useCallback(async (item: ArkmeTimelineItem) => {
    const text = arkmeMessageCopyText(item)
    closeMessageMenu()
    if (text === '') {
      showMessageActionStatus('暂无可复制文本')
      return
    }
    try {
      await arkmeCopyTextToClipboard(text)
      showMessageActionStatus('已复制')
    } catch (caught) {
      showMessageActionStatus(errorMessage(caught) || '复制失败，请稍后重试')
    }
  }, [closeMessageMenu, showMessageActionStatus])
  const copySelectedMessageText = useCallback(async () => {
    if (messageActionBusy !== undefined) return
    const item = selectedMessageItems[0]
    if (selectedMessageItems.length !== 1 || item === undefined) {
      showMessageActionStatus('请选择 1 条消息复制文本')
      return
    }
    const text = arkmeMessageCopyText(item)
    if (text === '') {
      showMessageActionStatus('暂无可复制文本')
      return
    }
    try {
      await arkmeCopyTextToClipboard(text)
      showMessageActionStatus('已复制')
    } catch (caught) {
      showMessageActionStatus(errorMessage(caught) || '复制失败，请稍后重试')
    }
  }, [messageActionBusy, selectedMessageItems, showMessageActionStatus])
  const copyMessageLink = useCallback(async (itemsToCopy: readonly ArkmeTimelineItem[]) => {
    if (source === undefined) return
    closeMessageMenu()
    if (messageActionBusy !== undefined) {
      showMessageActionStatus(messageActionBusy === 'copy-link' ? '正在生成链接' : '转发中', false)
      return
    }
    const sourceRef = source.sourceRef
    const sourceKey = conversationKey
    const actionRefs = itemsToCopy.map(arkmeTimelineMessageActionRef).filter(value => value !== '')
    if (actionRefs.length === 0) {
      showMessageActionStatus('当前消息暂不支持复制链接')
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
    }, MESSAGE_ACTION_REQUEST_TIMEOUT_MS)
    setMessageActionBusy('copy-link')
    showMessageActionStatus('正在生成链接', false)
    setError('')
    try {
      const result = await callArkme<ArkmeMessageCopyLinkResult>('source.message-copy-link', {
        sourceRef,
        actionRefs,
      }, controller.signal)
      if (activeSourceKeyRef.current !== sourceKey) return
      await arkmeCopyTextToClipboard(result.url)
      if (activeSourceKeyRef.current !== sourceKey) return
      showMessageActionStatus('复制链接成功')
    } catch (caught) {
      if (activeSourceKeyRef.current === sourceKey) {
        showMessageActionStatus(controller.signal.aborted ? '复制链接失败，请稍后重试' : errorMessage(caught) || '复制链接失败，请稍后重试')
      }
    } finally {
      window.clearTimeout(timeout)
      setMessageActionBusy(undefined)
    }
  }, [closeMessageMenu, conversationKey, messageActionBusy, showMessageActionStatus, source])
  const loadMessageCopyLinkDetail = useCallback((sid: string, options: { preserveReady?: boolean } = {}) => {
    if (!activeConversationRef.current) return
    const normalizedSid = sid.trim()
    if (!/^[0-9A-Za-z]{16}$/.test(normalizedSid)) {
      setCopyLinkDetail({ sid: normalizedSid, status: 'error', message: '链接暂不可用' })
      return
    }
    copyLinkDetailRequestRef.current?.abort()
    const controller = new AbortController()
    copyLinkDetailRequestRef.current = controller
    const timeout = window.setTimeout(() => {
      controller.abort()
    }, MESSAGE_ACTION_REQUEST_TIMEOUT_MS)
    if (options.preserveReady !== true) {
      setCopyLinkDetail({ sid: normalizedSid, status: 'loading' })
    } else {
      setCopyLinkDetail(current => current?.sid === normalizedSid && current.status === 'ready'
        ? current
        : { sid: normalizedSid, status: 'loading' })
    }
    void callArkme<ArkmeMessageCopyLinkResolveResult>('source.message-copy-link.resolve', { sid: normalizedSid }, controller.signal)
      .then(detail => {
        if (controller.signal.aborted || copyLinkDetailRequestRef.current !== controller || !activeConversationRef.current) return
        setCopyLinkDetail(current => current?.sid === normalizedSid
          ? { sid: normalizedSid, status: 'ready', detail }
          : current)
      })
      .catch(caught => {
        if (controller.signal.aborted || copyLinkDetailRequestRef.current !== controller || !activeConversationRef.current) return
        setCopyLinkDetail(current => current?.sid === normalizedSid
          ? options.preserveReady === true && current.status === 'ready'
            ? current
            : { sid: normalizedSid, status: 'error', message: controller.signal.aborted ? '链接暂不可用' : errorMessage(caught) || '链接暂不可用' }
          : current)
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (copyLinkDetailRequestRef.current === controller) copyLinkDetailRequestRef.current = undefined
      })
  }, [])
  const closeMessageCopyLinkDetail = useCallback(() => {
    copyLinkDetailRequestRef.current?.abort()
    copyLinkDetailRequestRef.current = undefined
    if (copyLinkRefreshTimerRef.current !== undefined) {
      window.clearTimeout(copyLinkRefreshTimerRef.current)
      copyLinkRefreshTimerRef.current = undefined
    }
    setDrawer(undefined)
    setCopyLinkDetail(undefined)
    setCopyLinkDetailDraft('')
    setCopyLinkDetailSendError('')
  }, [])
  const openMessageCopyLinkDetail = useCallback((sid: string) => {
    if (!activeConversationRef.current) return
    closeMessageMenu()
    setMemberMenu(undefined)
    setCopyLinkDetailDraft('')
    setCopyLinkDetailSendError('')
    setDrawer('copyLink')
    loadMessageCopyLinkDetail(sid)
  }, [closeMessageMenu, loadMessageCopyLinkDetail])
  const shareCurrentCopyLinkDetail = useCallback(async () => {
    if (copyLinkDetail?.status !== 'ready') return
    try {
      await arkmeCopyTextToClipboard(copyLinkShareUrl(shareWebsite, copyLinkDetail.sid))
      showMessageActionStatus('已复制链接')
    } catch (caught) {
      showMessageActionStatus(errorMessage(caught) || '分享失败，请重试')
    }
  }, [copyLinkDetail, shareWebsite, showMessageActionStatus])
  const sendCopyLinkDetailThought = useCallback(async () => {
    if (!activeConversationRef.current || copyLinkDetail?.status !== 'ready' || copyLinkDetailSending) return
    const overlayGeneration = conversationOverlayScopeRef.current.generation
    const target = copyLinkDetailExtensionTarget(copyLinkDetail.detail)
    if (target === undefined) {
      setCopyLinkDetailSendError('链接暂不可延展')
      return
    }
    const textContent = copyLinkDetailDraft.trim()
    if (textContent === '') return
    const recordUid = crypto.randomUUID()
    setCopyLinkDetailSending(true)
    setCopyLinkDetailSendError('')
    try {
      await callArkme<ArkmeMessageCopyLinkExtendResult>('source.message-copy-link.extend', {
        sid: copyLinkDetail.sid,
        itemIndex: target.itemIndex,
        textContent,
        recordUid,
      })
      if (!activeConversationRef.current || conversationOverlayScopeRef.current.generation !== overlayGeneration) return
      setCopyLinkDetailDraft('')
      arkmeUi.chatChanged()
      copyLinkRefreshTimerRef.current = window.setTimeout(() => {
        copyLinkRefreshTimerRef.current = undefined
        loadMessageCopyLinkDetail(copyLinkDetail.sid, { preserveReady: true })
      }, 550)
    } catch (caught) {
      if (activeConversationRef.current && conversationOverlayScopeRef.current.generation === overlayGeneration) {
        setCopyLinkDetailSendError(errorMessage(caught) || '发送失败，请重试')
      }
    } finally {
      if (activeConversationRef.current && conversationOverlayScopeRef.current.generation === overlayGeneration) {
        setCopyLinkDetailSending(false)
      }
    }
  }, [
    copyLinkDetail,
    copyLinkDetailDraft,
    copyLinkDetailSending,
    loadMessageCopyLinkDetail,
  ])
  const enterMessageSelectMode = useCallback((item: ArkmeTimelineItem) => {
    closeMessageMenu()
    if (source === undefined || arkmeTimelineMessageActionRef(item) === '') {
      showMessageActionStatus('当前消息暂不支持多选')
      return
    }
    pendingSelectRevealItemUidRef.current = item.itemUid
    setSelectMode({ sourceKey: conversationKey, selectedIds: new Set([item.itemUid]) })
  }, [closeMessageMenu, conversationKey, showMessageActionStatus, source])
  const toggleSelectedMessage = useCallback((item: ArkmeTimelineItem) => {
    if (source === undefined || arkmeTimelineMessageActionRef(item) === '') return
    setSelectMode(current => {
      if (current === undefined || current.sourceKey !== conversationKey) return { sourceKey: conversationKey, selectedIds: new Set([item.itemUid]) }
      const selectedIds = new Set(current.selectedIds)
      if (selectedIds.has(item.itemUid)) selectedIds.delete(item.itemUid)
      else if (selectedIds.size < 100) selectedIds.add(item.itemUid)
      return { sourceKey: current.sourceKey, selectedIds }
    })
  }, [conversationKey, source])
  const openForwardTargetPicker = useCallback((itemsToForward: readonly ArkmeTimelineItem[] = selectedMessageItems) => {
    if (!activeConversationRef.current) return
    closeMessageMenu()
    const forwardableItems = itemsToForward.filter(item => arkmeTimelineMessageActionRef(item) !== '')
    if (source === undefined || forwardableItems.length === 0) {
      showMessageActionStatus('请选择要转发的快记')
      return
    }
    if (forwardableItems.length > 100) {
      showMessageActionStatus('最多选择 100 条快记')
      return
    }
    const initialTargets = arkmeForwardableTargetSources(
      arkmeChatDirectory.getSnapshot().sources,
      selfSources,
      aggregateSource,
    )
    const sourceKey = conversationKey
    setForwardTargetPicker({
      sourceKey,
      itemUids: forwardableItems.map(item => item.itemUid),
      items: [...forwardableItems],
      loading: true,
      targets: initialTargets,
      selectedSourceRefs: [],
      keyword: '',
      commentText: '',
      error: '',
      sendError: '',
    })
    forwardTargetRequestRef.current?.abort()
    const controller = new AbortController()
    forwardTargetRequestRef.current = controller
    const overlayGeneration = conversationOverlayScopeRef.current.generation
    Promise.all([
      callArkme<ArkmeSourceList>('sources.list', { directory: 'root', limit: FORWARD_TARGET_LIMIT }, controller.signal),
      callArkme<ArkmeSourceList>('sources.list', { directory: 'send_to_self', limit: FORWARD_TARGET_LIMIT }, controller.signal)
        .catch(() => ({ directory: 'send_to_self' as const, items: [], hasMore: false })),
    ]).then(([root, sendToSelf]) => {
      if (controller.signal.aborted || forwardTargetRequestRef.current !== controller
        || !activeConversationRef.current || conversationOverlayScopeRef.current.generation !== overlayGeneration
        || activeSourceKeyRef.current !== sourceKey) return
      const targets = arkmeForwardableTargetSources(root.items, sendToSelf.items, aggregateSource)
      setForwardTargetPicker(current => current === undefined || current.sourceKey !== sourceKey
        ? current
        : {
          ...current,
          loading: false,
          targets,
          selectedSourceRefs: current.selectedSourceRefs.filter(sourceRef =>
            targets.some(target => target.sourceRef === sourceRef)),
          error: targets.length === 0 ? '暂无可转发对象' : '',
        })
    }).catch(caught => {
      if (controller.signal.aborted || forwardTargetRequestRef.current !== controller
        || !activeConversationRef.current || conversationOverlayScopeRef.current.generation !== overlayGeneration
        || activeSourceKeyRef.current !== sourceKey) return
      setForwardTargetPicker(current => current === undefined || current.sourceKey !== sourceKey
        ? current
        : { ...current, loading: false, error: errorMessage(caught) || '转发对象加载失败，请稍后重试' })
    }).finally(() => {
      if (forwardTargetRequestRef.current === controller) forwardTargetRequestRef.current = undefined
    })
  }, [aggregateSource, closeMessageMenu, conversationKey, selectedMessageItems, selfSources, showMessageActionStatus, source])
  const toggleForwardTarget = useCallback((target: ArkmeSourceItem) => {
    if (forwardTargetPicker === undefined || messageActionBusy === 'forward') return
    const selected = forwardTargetPicker.selectedSourceRefs.includes(target.sourceRef)
    if (!selected && forwardTargetPicker.selectedSourceRefs.length >= MAX_FORWARD_TARGET_SELECTION) {
      showMessageActionStatus(`最多选择 ${String(MAX_FORWARD_TARGET_SELECTION)} 个转发对象`)
      return
    }
    setForwardTargetPicker({
      ...forwardTargetPicker,
      selectedSourceRefs: selected
        ? forwardTargetPicker.selectedSourceRefs.filter(sourceRef => sourceRef !== target.sourceRef)
        : [...forwardTargetPicker.selectedSourceRefs, target.sourceRef],
    })
  }, [forwardTargetPicker, messageActionBusy, showMessageActionStatus])
  const forwardMessageItems = useCallback(async (
    itemsToForward: readonly ArkmeTimelineItem[],
    targetSources: readonly ArkmeSourceItem[],
    commentText = '',
  ) => {
    if (source === undefined || messageActionBusy !== undefined || itemsToForward.length === 0) return
    const sourceRef = source.sourceRef
    const sourceKey = conversationKey
    const actionRefs = itemsToForward.map(arkmeTimelineMessageActionRef).filter(value => value !== '')
    if (actionRefs.length === 0 || targetSources.length === 0) return
    const normalizedCommentText = commentText.trim()
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
    }, MESSAGE_FORWARD_REQUEST_TIMEOUT_MS)
    setMessageActionBusy('forward')
    showMessageActionStatus('转发中', false)
    setError('')
    setForwardTargetPicker(current => current === undefined ? current : { ...current, sendError: '' })
    try {
      const results = await Promise.allSettled(targetSources.map(async targetSource => ({
        targetSource,
        result: await callArkme<ArkmeSourceSendResult>('source.forward-messages', {
          sourceRef,
          targetSourceRef: targetSource.sourceRef,
          actionRefs,
          recordUid: crypto.randomUUID(),
          relationUid: crypto.randomUUID(),
          ...(normalizedCommentText === '' ? {} : { commentText: normalizedCommentText }),
        }, controller.signal),
      })))
      if (activeSourceKeyRef.current !== sourceKey) return
      let successCount = 0
      let failureCount = 0
      let warningText = ''
      let needsTimelineRefresh = false
      for (const outcome of results) {
        if (outcome.status === 'rejected') {
          failureCount += 1
          continue
        }
        successCount += 1
        const { targetSource, result } = outcome.value
        if ((result.warningText ?? '') !== '') warningText = result.warningText ?? ''
        if (arkmeSourceIdentityKey(targetSource) === sourceKey) needsTimelineRefresh = true
      }
      if (successCount === 0) {
        const firstFailureMessage = results
          .find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
          ?.reason
        const message = controller.signal.aborted ? '转发失败，请稍后重试' : errorMessage(firstFailureMessage) || '发送失败，请重试'
        setForwardTargetPicker(current => current === undefined ? current : { ...current, sendError: message })
        showMessageActionStatus(message)
        return
      }
      const successfulTargets = results
        .filter((outcome): outcome is PromiseFulfilledResult<{ targetSource: ArkmeSourceItem; result: ArkmeSourceSendResult }> => outcome.status === 'fulfilled')
        .map(outcome => outcome.value.targetSource)
      setSelectMode(undefined)
      setForwardTargetPicker(undefined)
      closeMessageMenu()
      showForwardSuccessFeedback(successfulTargets, successCount, failureCount)
      showMessageActionStatus(warningText)
      if (needsTimelineRefresh) await loadTimeline()
    } catch (caught) {
      if (activeSourceKeyRef.current === sourceKey) {
        const message = controller.signal.aborted ? '转发失败，请稍后重试' : errorMessage(caught) || '转发失败，请稍后重试'
        setForwardTargetPicker(current => current === undefined ? current : { ...current, sendError: message })
        showMessageActionStatus(message)
      }
    } finally {
      window.clearTimeout(timeout)
      setMessageActionBusy(undefined)
    }
  }, [closeMessageMenu, conversationKey, loadTimeline, messageActionBusy, showForwardSuccessFeedback, showMessageActionStatus, source])
  const confirmForwardTargets = useCallback(async () => {
    if (forwardTargetPicker === undefined) return
    if (forwardTargetPicker.items.length === 0) {
      setForwardTargetPicker({ ...forwardTargetPicker, sendError: '请选择要转发的快记' })
      showMessageActionStatus('请选择要转发的快记')
      return
    }
    const targets = forwardTargetPicker.selectedSourceRefs
      .map(sourceRef => forwardTargetPicker.targets.find(item => item.sourceRef === sourceRef))
      .filter((item): item is ArkmeSourceItem => item !== undefined)
    if (targets.length === 0) {
      setForwardTargetPicker({ ...forwardTargetPicker, sendError: '请选择转发对象' })
      showMessageActionStatus('请选择转发对象')
      return
    }
    await forwardMessageItems(forwardPickerMessageItems, targets, forwardTargetPicker.commentText)
  }, [forwardMessageItems, forwardPickerMessageItems, forwardTargetPicker, showMessageActionStatus])
  useLayoutEffect(() => {
    if (!active || timelineStateKey === '') return
    const cachedViewport = conversationCacheRef.current.getViewport(timelineStateKey)
    if (cachedViewport !== undefined) {
      pendingViewportRestoreRef.current = { sourceKey: timelineStateKey, viewport: cachedViewport }
    }
    return () => {
      const body = bodyRef.current
      if (body !== null) conversationCacheRef.current.storeViewport(timelineStateKey, arkmeConversationViewport(body))
    }
  }, [active, timelineStateKey])
  useLayoutEffect(() => {
    const pending = pendingViewportRestoreRef.current
    const body = bodyRef.current
    if (pending === undefined || body === null || pending.sourceKey !== timelineStateKey) return
    const anchorOffset = arkmeConversationAnchorOffset(body, pending.viewport?.anchorId)
    body.scrollTop = arkmeConversationRestoredScrollTop(pending.viewport, {
      currentScrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
      ...(anchorOffset === undefined ? {} : { anchorOffset }),
    })
    conversationCacheRef.current.storeViewport(pending.sourceKey, arkmeConversationViewport(body))
    pendingViewportRestoreRef.current = undefined
  }, [active, displayRows, timelineStateKey])
  const handleConversationScroll = useCallback(() => {
    const body = bodyRef.current
    if (body === null || timelineStateKey === '') return
    const viewport = arkmeConversationViewport(body)
    conversationCacheRef.current.storeViewport(timelineStateKey, viewport)
    if (viewport.stickToBottom) setNewMessageCount(0)
  }, [timelineStateKey])
  const scrollToLatest = useCallback(() => {
    const body = bodyRef.current
    if (body === null) return
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
    setNewMessageCount(0)
  }, [])
  const detailGroupTarget = useMemo(
    () => detailState?.kind === 'success'
      ? resolveInterwovenGroupTarget(chatDirectory.sources, detailState.detail.groupName)
      : undefined,
    [chatDirectory, detailState],
  )
  const showMessageAvatars = arkmeSourceShowsMessageAvatars(source)
  const surfaceTitle = ui.mode === 'recordings' ? '全天候录音'
    : ui.mode === 'calls' ? '通话'
    : ui.mode === 'world' ? '世界'
    : ui.mode === 'search' ? '搜索'
    : ui.mode === 'extensions' ? '市集'
    : ui.mode === 'voiceprint' ? '声纹管理'
    : ui.mode === 'arko' ? 'Arko'
    : conversationBackdropVisible ? arkmeSourceDestinationLabel(selectedSource)
    : 'Arkme'
  const arkoContentVisible = authView === 'content' && ui.mode === 'arko'
  const utilityContentVisible = authView === 'content'
    && (ui.mode === 'recordings' || ui.mode === 'world' || ui.mode === 'search' || ui.mode === 'extensions'
      || ui.mode === 'voiceprint' || ui.mode === 'calls')
  const conversationOverlayHost = panelRef.current
  const composerPlaceholder = arkmeComposerPlaceholderText(
    arkmeComposerPlaceholderTargetForSource(selectedSource, conversationMembers.length),
  )

  if (!active) return <div
    className="arkme-conversation-surface"
    ref={surfaceRef}
    data-arkme-owned="product-surface"
    data-arkme-surface-suspended="true"
    style={{
      ...styles.surface,
      ...(floating ? styles.floatingSurface : {}),
      ...(productChrome && compactNavigation ? styles.compactSurface : {}),
    }}
    aria-hidden
  />

  return (
    <div
      className="arkme-conversation-surface"
      ref={surfaceRef}
      data-arkme-owned="product-surface"
      style={{
        ...styles.surface,
        ...(floating ? styles.floatingSurface : {}),
        ...(productChrome && compactNavigation ? styles.compactSurface : {}),
      }}
    >
      {productChrome && productNavigation && authView === 'content' && <ArkmeProductNavigation
        compact={compactNavigation}
        currentSessionId={currentSessionId}
      />}
      {productChrome && authView === 'content' && (conversationBackdropVisible || ui.mode === 'arko') && <aside
        data-arkme-owned="directory-pane"
        style={{ ...styles.directoryPane, ...(compactNavigation ? styles.compactDirectoryPane : {}) }}
        aria-label="Arkme 对话目录"
      >
        <ArkmeNavigation
          currentSessionId={currentSessionId}
          embeddedProductShell
          {...(aggregateSource === undefined ? {} : { sendToSelfSource: aggregateSource })}
          {...(directoryLead === undefined ? {} : { directoryLead })}
          {...(onCreateTask === undefined ? {} : { onCreateTask })}
          {...(onActivateSurface === undefined ? {} : { onActivateSurface })}
          {...(renderSlot === undefined ? {} : { renderSlot })}
        />
      </aside>}
      <section className="arkme-conversation-panel" ref={panelRef} style={styles.panel} role="region" aria-label={surfaceTitle}>
        {authView !== 'login' && !arkoContentVisible && !utilityContentVisible && !botConversationVisible && <header className="arkme-conversation-header" style={styles.header}>
          {authenticated && conversationBackdropVisible && source?.kind === 'group_chat' && <span style={styles.headerAvatar}>
            <ArkmeDirectorySourceAvatar source={source} size={34} />
          </span>}
          {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
            && auth?.userId !== undefined && <ArkmeTopicDirectoryPopover
              key={`${String(auth.userId)}:${conversationOverlayKey}`}
              userId={auth.userId}
              selectedSource={selectedSource}
              trigger="none"
              onSelect={activateSelfSource}
              onSelectionInvalidated={invalidateTopicSelection}
              onSelfSourcesResolution={acceptSelfSourcesResolution}
              onCreateTopicReady={open => { selfTopicCreateRef.current = open }}
              retryRevision={selfSourcesRetryRevision}
            />}
          <div style={styles.titleGroup}>
            {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
              ? <ArkmeSourceBreadcrumb
                key={`source-breadcrumb:${conversationOverlayKey}`}
                selectedSource={selectedSource}
                sources={selfSources}
                loading={selfSourcesLoading}
                {...(selfSourcesError === undefined ? {} : { error: selfSourcesError })}
                onSelect={activateSelfSource}
                onSelectAggregate={activateSendToSelf}
                onCreateTopic={() => { selfTopicCreateRef.current?.() }}
                onCreateChildTopic={(parent, parentLevel) => { selfTopicCreateRef.current?.(parent, parentLevel) }}
                onRenameTopic={async (topic, title) => {
                  const result = await callArkme<{ sourceRef: string; displayName: string }>('topic.rename', {
                    sourceRef: topic.sourceRef,
                    title,
                  })
                  setSelfSourcesRetryRevision(value => value + 1)
                  return { ...topic, sourceRef: result.sourceRef, displayName: result.displayName }
                }}
                onDissolveTopic={async (topic, parent, children, onProgress) => {
                  const requestId = globalThis.crypto?.randomUUID?.() ?? `topic-dissolve-${String(Date.now())}`
                  let polling = true
                  const reportProgress = async () => {
                    if (!polling) return
                    const progress = await callArkme<ArkmeTopicDissolveTask | null>('topic.dissolve.status', { requestId })
                    if (progress !== null) {
                      onProgress(progress)
                      publishActiveTopicDissolve(progress)
                    }
                  }
                  const timer = globalThis.setInterval(() => { void reportProgress().catch(() => undefined) }, 250)
                  try {
                  await callArkme('topic.dissolve', {
                    sourceRef: topic.sourceRef,
                    ...(parent === undefined ? {} : { parentSourceRef: parent.sourceRef }),
                    childSourceRefs: children.map(child => child.sourceRef),
                    requestId,
                    expectedRecordCount: Math.max(0, topic.recordCount ?? 0),
                  })
                  await reportProgress()
                  setSelfSourcesRetryRevision(value => value + 1)
                  } finally {
                    polling = false
                    globalThis.clearInterval(timer)
                  }
                }}
                {...(activeTopicDissolve === undefined ? {} : { activeDissolve: activeTopicDissolve })}
                onRetry={() => { setSelfSourcesRetryRevision(value => value + 1) }}
                onMoveTopic={async (topic, currentParent, nextParent, insertBefore) => {
                  await callArkme<ArkmeTopicHierarchyMoveResult>('topic.hierarchy.move', {
                    sourceRef: topic.sourceRef,
                    ...(currentParent === undefined ? {} : { currentParentSourceRef: currentParent.sourceRef }),
                    ...(nextParent === undefined ? {} : { nextParentSourceRef: nextParent.sourceRef }),
                    ...(insertBefore === undefined ? {} : { insertBeforeSourceRef: insertBefore.sourceRef }),
                  })
                  setSelfSourcesRetryRevision(value => value + 1)
                }}
              />
              : <div style={styles.titleBlock}>
                <span style={styles.titleLine}>
                  <h2 style={styles.title}>{surfaceTitle}</h2>
                  {source?.isMuted === true && <span style={styles.titleMuteIcon}><ArkmeMuteIcon size={16} /></span>}
                </span>
                {authenticated && conversationBackdropVisible && source?.kind === 'group_chat'
                  && aiPolishSettings?.enabled === true
                  && <span style={styles.headerSubtitle}>AI润色已开启{aiPolishSettings.activeRuleName.trim() === '' ? '' : ` · ${aiPolishSettings.activeRuleName}`}</span>}
              </div>}
            {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
              && source?.isMuted === true && <span style={styles.titleMuteIcon}><ArkmeMuteIcon size={16} /></span>}
          </div>
          {authenticated && conversationBackdropVisible && source?.kind === 'private_chat' && <ArkmePrivateCallMenu
            key={`private-call:${conversationOverlayKey}`}
            sourceRef={source.sourceRef}
            displayName={source.displayName}
            assetBasePath={authStoreSnapshot.config?.callAssetBasePath ?? '/arkme-self/api/call'}
          />}
          {authenticated && conversationBackdropVisible && source?.kind === 'group_chat' && <ArkmeGroupChatControls
            key={`group-controls:${conversationOverlayKey}`}
            source={source}
            overlayHostRef={panelRef}
            aiPolishSettings={aiPolishSettings}
            onAiPolishSettingsChanged={setAiPolishSettings}
            onSourceActivated={activateSource}
            membersOpen={groupMembersOpen}
            onMembersOpenChange={open => { if (open) activateContextPanel('members'); else setGroupMembersOpen(false) }}
            onMemberOpen={openMemberProfile}
            onMemberContextMenu={openMemberMenu}
            onMembersChanged={() => { setConversationMembersRefreshRevision(value => value + 1) }}
            onError={setError}
          />}
          {shouldShowPrivateChatActions(authenticated, source?.kind) && <div style={{
            ...ARKME_CONVERSATION_HEADER_ACTIONS_STYLE,
            visibility: relatedPanelOpen ? 'hidden' : 'visible',
          }}>
            <ArkmeConversationHeaderIconButton
              label="更多私聊操作"
              buttonRef={relatedMenuButtonRef}
              hasPopup
              expanded={relatedMenuOpen}
              onClick={toggleRelatedMenu}
            ><ArkmeConversationMoreIcon /></ArkmeConversationHeaderIconButton>
          </div>}
          {activeConversation && shouldShowPrivateChatActions(authenticated, source?.kind) && relatedMenuOpen && conversationOverlayHost !== null && createPortal(
            <div style={ARKME_CONVERSATION_SETTINGS_MENU_SCRIM_STYLE} role="presentation" onMouseDown={event => {
              if (event.target === event.currentTarget) setRelatedMenuOpen(false)
            }}>
              <div
                style={{
                  ...ARKME_CONVERSATION_SETTINGS_POPOVER_STYLE,
                  left: relatedMenuPosition.left,
                  top: relatedMenuPosition.top,
                }}
                role="menu"
                aria-label="更多私聊操作"
                aria-busy={relatedEligibility === 'loading'}
                onMouseDown={event => { event.stopPropagation() }}
              >
                {shouldShowRelatedRecordingsEntry(authenticated, source?.kind, relatedEligibility, relatedPanelOpen)
                  ? <button
                    type="button"
                    role="menuitem"
                    style={ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE}
                    onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
                    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
                    onClick={openRelatedPanel}
                  ><Waveform size={20} aria-hidden /><span>相关录音</span></button>
                  : relatedEligibility === 'error'
                    ? <button
                      type="button"
                      role="menuitem"
                      style={ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE}
                      onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
                      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
                      onClick={ensureRelatedEligibility}
                    ><Waveform size={20} aria-hidden /><span>重新检查相关录音</span></button>
                    : <div role="status" style={ARKME_CONVERSATION_SETTINGS_MENU_STATUS_STYLE}>
                      {relatedEligibility === 'denied' ? '当前没有可用操作' : '正在检查相关录音…'}
                    </div>}
              </div>
            </div>,
            conversationOverlayHost,
          )}
        </header>}
        {authView === 'login' ? <div style={styles.loginBody}><ArkmeLogin
          t={t}
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
          jiwoScanLoginEnabled={jiwoScanLoginEnabled}
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
          onJiwoLogin={() => { void beginJiwo() }}
          onCancelBinding={() => { void cancelBinding() }}
        /></div> : ui.mode === 'calls' ? <ArkmeCallSurface />
          : ui.mode === 'recordings' ? <ArkmeRecordingSurface />
          : ui.mode === 'world' ? <ArkmeWorldSurface
            {...(ui.worldTarget === undefined ? {} : { target: ui.worldTarget })}
            {...(currentSessionId === undefined ? {} : { currentSessionId })}
            {...(auth?.status !== 'authenticated' ? {} : { currentUserId: auth.userId })}
            {...(selfProfile?.avatarRef.trim() ? { currentUserAvatarRef: selfProfile.avatarRef.trim() } : {})}
            onBackToWorld={() => { arkmeUi.showWorld() }}
            onSourceActivated={activateSource}
          />
          : ui.mode === 'search' ? <div style={styles.utilityBody}><ArkmeSearchSurface /></div>
          : ui.mode === 'extensions' ? <ArkmeMarketplace
            displayMode="page"
            {...(currentSessionId === undefined ? {} : { currentSessionId })}
            {...(auth?.status !== 'authenticated' ? {} : { currentUserId: auth.userId })}
            {...(selfProfile?.avatarRef.trim() ? { currentUserAvatarRef: selfProfile.avatarRef.trim() } : {})}
            {...(ui.extensionShareRef === undefined ? {} : { shareRef: ui.extensionShareRef })}
            {...(ui.extensionShareAction === undefined ? {} : { shareAction: ui.extensionShareAction })}
            {...(ui.extensionDetailId === undefined ? {} : { initialExtensionId: ui.extensionDetailId })}
            {...(ui.extensionAuthorFilter === undefined ? {} : { initialAuthorFilter: ui.extensionAuthorFilter })}
            onShareResolved={extensionId => { arkmeUi.showExtensionDetail(extensionId) }}
            onShareExit={() => { arkmeUi.dismissExtensionShare() }}
            onPrivateChatOpened={activateSource}
          />
          : ui.mode === 'voiceprint' ? <ArkmeVoiceprintSurface />
          : ui.mode === 'arko' ? <ArkmeArkoSurface key={arkmeArkoSurfaceKey(auth)} />
          : botConversationVisible && ui.selectedBot !== undefined ? <ArkmeBotConversationSurface
            key={ui.selectedBot.botRef} bot={ui.selectedBot} onConversationActivity={bot => { arkmeUi.openBotConversation(bot) }} onDeleted={() => { arkmeUi.showHarness() }}
          />
          : source === undefined ? <div className="arkme-conversation-body" style={styles.body}>
            {activeSelfSourcesResolution?.status === 'error'
              ? <div role="alert" style={styles.loading}>
                <div style={styles.error}>{activeSelfSourcesResolution.message}</div>
                <button type="button" style={{ ...styles.retry, marginTop: 8, fontSize: 12 }}
                  onClick={() => { setSelfSourcesRetryRevision(value => value + 1) }}>重试</button>
              </div>
              : <div role="status" style={styles.loading}>正在加载发给自己的内容…</div>}
          </div> : <>
          <div className="arkme-conversation-body" ref={bodyRef} style={{
            ...styles.body,
            ...(activeSelectMode === undefined ? {} : styles.bodySelectMode),
          }} onScroll={handleConversationScroll}>
            {error !== '' && <div style={styles.error}>{error}</div>}
            <div ref={sentinelRef} style={styles.sentinel} />
            {loadingOlder && <div style={styles.loading}>正在加载更早内容…</div>}
            {timelineSkeletonKey === conversationKey && displayRows.length === 0 && <div
              role="status"
              aria-label="正在加载会话内容"
              style={styles.timelineSkeleton}
            >{[58, 44, 66, 50, 61].map((width, index) => <div
              key={`${width}:${index}`}
              aria-hidden
              style={{ ...styles.timelineSkeletonRow, ...(index % 3 === 1 ? styles.timelineSkeletonRowMe : {}) }}
            >
              <span style={styles.timelineSkeletonAvatar} />
              <span style={{ ...styles.timelineSkeletonBubble, width: `${width}%` }} />
            </div>)}</div>}
            {displayRows.length > 0 && <ul className={`arkme-conversation-records${timelineRevealKey === conversationKey
              ? ' arkme-conversation-records-reveal'
              : ''}`} style={styles.records}>
              {displayRows.map((row, index) => {
                const previous = index === 0 ? undefined : displayRows[index - 1]
                const startsDay = previous === undefined
                  || dayKey(previous.occurredAtMillis) !== dayKey(row.occurredAtMillis)
                if (row.kind === 'member-join') return <ArkmeMemberJoinNotice
                  key={row.id}
                  rowId={row.id}
                  event={row.item}
                  membersByRef={conversationMemberByRef}
                  startsGroup={previous?.kind !== 'member-join'}
                  onOpenMember={openMemberProfile}
                />
                if (row.kind === 'notice') return <Fragment key={row.id}>
                  {startsDay && <li style={styles.date}>{dayLabel(row.occurredAtMillis)}</li>}
                  <li data-arkme-conversation-row={row.id} style={styles.notice}>{row.item.message}</li>
                </Fragment>
                if (row.kind === 'moment') {
                  return <Fragment key={row.id}>
                    {startsDay && <li style={styles.date}>{dayLabel(row.occurredAtMillis)}</li>}
                    <ArkmeInterwovenMentionCard moment={row.item} rowId={row.id} onOpen={openMomentDetail} />
                  </Fragment>
                }
                const item = row.item
                const selfTopicSource = source?.kind === 'send_to_self'
                  ? arkmeTimelineSelfTopicSource(item, selfSources)
                  : undefined
                const avatarRef = arkmeTimelineAvatarRef(item, selfProfile)
                const messageMember = item.memberRef === undefined
                  ? (item.isMe ? selfConversationMember : undefined)
                  : conversationMemberByRef.get(item.memberRef)
                const polishStatus = aiPolishStatus(item)
                const selectedForAction = activeSelectMode?.selectedIds.has(item.itemUid) === true
                const canUseMessageAction = arkmeTimelineMessageActionRef(item) !== ''
                const isForwardMessageCard = item.forwardRecords !== undefined
                const isSharedRecordingCard = item.sharedRecording !== undefined
                const isStructuredMessageCard = isForwardMessageCard || isSharedRecordingCard
                const selectionAnchor = arkmeMessageSelectionAnchor(item)
                return <Fragment key={row.id}>
                  {startsDay && <li style={styles.date}>{dayLabel(item.sendAtMillis)}</li>}
                  <li data-arkme-conversation-row={row.id} data-arkme-message-item-uid={item.itemUid} style={{
                    ...styles.row,
                    ...(activeSelectMode === undefined
                      ? isSharedRecordingCard
                        ? styles.sharedRecordingRow
                        : item.isMe ? styles.rowMe : styles.rowOther
                      : selectionAnchor === 'avatar'
                        ? styles.rowSelectAvatarMode
                        : styles.rowSelectCardCenterMode),
                    ...(selectedForAction ? styles.rowSelectedForAction : {}),
                    ...(highlightedTargetUid === item.itemUid ? styles.rowSearchTarget : {}),
                  }}
                    onClickCapture={event => {
                      if (activeSelectMode === undefined) return
                      if (!canUseMessageAction) return
                      if (!arkmeShouldToggleMessageSelectFromRowClick(event.target)) return
                      event.preventDefault()
                      event.stopPropagation()
                      toggleSelectedMessage(item)
                    }}
                  >
                    {activeSelectMode !== undefined && <ArkmeMessageSelectionControl
                      anchor={selectionAnchor}
                      checked={selectedForAction}
                      disabled={!canUseMessageAction}
                      onToggle={() => { toggleSelectedMessage(item) }}
                    />}
                    <div style={{
                      ...styles.messageLine,
                      ...(activeSelectMode !== undefined && selectionAnchor === 'avatar' ? styles.messageLineSelectAvatarMode : {}),
                      ...(item.isMe && !isSharedRecordingCard ? styles.messageLineMe : {}),
                      ...(isForwardMessageCard ? styles.forwardMessageLine : {}),
                      ...(isSharedRecordingCard ? styles.sharedRecordingMessageLine : {}),
                      ...(activeSelectMode !== undefined && selectionAnchor === 'card-center' ? styles.messageLineSelectCardCenterMode : {}),
                    }}>
                      {showMessageAvatars && !isSharedRecordingCard && <MessageAvatar
                        {...(avatarRef === undefined ? {} : { avatarRef })}
                        {...(messageMember === undefined ? {} : { member: messageMember })}
                        profileEnabled={source?.kind === 'group_chat'}
                        onOpen={openMemberProfile}
                        onContextMenu={openMemberMenu}
                      />}
                      <div style={{
                        ...styles.messageBody,
                        ...(item.isMe && !isSharedRecordingCard ? styles.messageBodyMe : {}),
                        ...(isForwardMessageCard ? styles.forwardMessageBody : {}),
                        ...(isSharedRecordingCard ? styles.sharedRecordingMessageBody : {}),
                      }}>
                        {!isSharedRecordingCard && <ArkmeTimelineMessageHeader item={item} {...(selfProfile === undefined ? {} : { profile: selfProfile })} />}
                        {(() => {
                          const messageBubble = <div
                            role="button"
                            tabIndex={0}
                            style={{
                              ...styles.bubble,
                              ...(isSharedRecordingCard ? styles.sharedRecordingBubble : item.isMe ? styles.bubbleMe : styles.bubbleOther),
                              ...(isForwardMessageCard ? styles.forwardBubble : {}),
                            }}
                            onClick={event => {
                              if (event.target instanceof Element && event.target.closest('button,a,audio,video,input,select,textarea,[role=link],[role=slider]')) return
                              if (window.getSelection()?.toString()) return
                              event.currentTarget.focus({ preventScroll: true })
                              openNoteDetail(item)
                            }}
                            onKeyDown={event => {
                              if (event.target !== event.currentTarget) return
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault(); openNoteDetail(item)
                            }}
                            onContextMenu={event => { openMessageMenu(item, event) }}
                            data-arkme-message-direction={item.isMe ? 'self' : 'other'}
                            aria-label={isSharedRecordingCard ? '打开录音详情' : '打开快记详情'}
                          >{polishStatus !== '' && <span style={styles.polishMeta}>
                            {item.aiPolish?.state === 'failed' ? <button
                              type="button" style={styles.retry} onClick={event => { event.stopPropagation(); void retryAiPolish(item) }}
                            >{polishStatus}</button> : polishStatus}
                          </span>}
                            <ArkmeMessageContent
                              key={`message-content:${conversationOverlayKey}`}
                              item={item}
                              sourceRef={source.sourceRef}
                              highlightMentions={source.kind === 'group_chat'}
                              shareWebsite={shareWebsite}
                              onMessageCopyLinkOpen={openMessageCopyLinkDetail}
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
                            />
                            {!isSharedRecordingCard && <ArkmeTimelineAgentSourceBadge item={item} />}
                            {fileTasks.tasks.filter(task => (task.result?.itemUid ?? task.recordUid) === item.itemUid && task.state !== 'sent').map(task => <div key={task.taskRef} role="status" style={{ fontSize: 12, marginTop: 6 }}>
                              {task.error ?? (task.state === 'sending' ? '正在发送…' : task.state === 'queued' ? '等待上传' : '正在上传')}
                              {task.state === 'failed' && <button type="button" onClick={event => { event.stopPropagation(); void callArkme('files.send.retry', { taskRef: task.taskRef }).then(fileTasks.refresh).catch(caught => setError(errorMessage(caught))) }}>重试</button>}
                              {task.state === 'uncertain' && <button type="button" onClick={event => { event.stopPropagation(); void callArkme<ArkmeFileSendTask>('files.send.reconcile', { taskRef: task.taskRef }).then(value => { fileTasks.refresh(); if (value.state === 'uncertain') setError('最近的会话记录还无法确认发送结果，请先核对原会话，不要重复发送') }).catch(caught => setError(errorMessage(caught))) }}>核对发送结果</button>}
                              {(task.state === 'failed' || task.state === 'uncertain') && <>{' '}<button type="button" aria-label="清除发送记录" onClick={event => {
                                event.stopPropagation()
                                if (task.state === 'uncertain' && !window.confirm('发送结果仍未确认。清除记录不会撤回可能已发送的消息，是否继续？')) return
                                void callArkme('files.send.discard', { taskRef: task.taskRef })
                                  .then(fileTasks.refresh)
                                  .catch(caught => setError(errorMessage(caught)))
                              }}>清除</button></>}
                            </div>)}
                          </div>
                          return isSharedRecordingCard
                            ? messageBubble
                            : <ArkmeMessageReadReceiptLine
                              key={`read-receipt:${conversationOverlayKey}`}
                              source={source}
                              item={item}
                              wide={isStructuredMessageCard}
                            >
                              {messageBubble}
                            </ArkmeMessageReadReceiptLine>
                        })()}
                        {selfTopicSource !== undefined && <ArkmeTimelineSelfTopicBadge topic={selfTopicSource} onSelect={activateSelfSource} />}
                      </div>
                    </div>
                  </li>
                </Fragment>
              })}
            </ul>}
            {newMessageCount > 0 && <button type="button" style={styles.newMessages} onClick={scrollToLatest}>
              {newMessageCount} 条新消息
            </button>}
          </div>
          {activeSelectMode !== undefined && <div style={styles.selectBar} role="toolbar" aria-label={`已选择 ${selectedMessageCount} 条消息`}>
            {(() => {
              const copyTextEnabled = arkmeCanCopySelectedMessageText(selectedMessageItems.length, messageActionBusy !== undefined)
              return <button
                type="button"
                style={{
                  ...styles.selectBarButton,
                  ...(!copyTextEnabled ? styles.selectBarButtonDisabled : {}),
                }}
                disabled={!copyTextEnabled}
                onClick={() => { void copySelectedMessageText() }}
              ><span style={styles.selectBarIconTile}><ArkmeSelectActionIcon kind="copy" /></span><span style={styles.selectBarLabel}>{ARKME_MESSAGE_SELECT_ACTION_LABELS[0]}</span></button>
            })()}
            <button
              type="button"
              style={{
                ...styles.selectBarButton,
                ...(selectedMessageItems.length === 0 || messageActionBusy !== undefined ? styles.selectBarButtonDisabled : {}),
              }}
              disabled={selectedMessageItems.length === 0 || messageActionBusy !== undefined}
              onClick={() => { void copyMessageLink(selectedMessageItems) }}
            ><span style={styles.selectBarIconTile}><ArkmeSelectActionIcon kind="link" /></span><span style={styles.selectBarLabel}>{ARKME_MESSAGE_SELECT_ACTION_LABELS[1]}</span></button>
            <button
              type="button"
              style={{
                ...styles.selectBarButton,
                ...(selectedMessageItems.length === 0 || messageActionBusy !== undefined ? styles.selectBarButtonDisabled : {}),
              }}
              disabled={selectedMessageItems.length === 0 || messageActionBusy !== undefined}
              onClick={() => { openForwardTargetPicker() }}
            ><span style={styles.selectBarIconTile}><ArkmeSelectActionIcon kind="forward" /></span><span style={styles.selectBarLabel}>{messageActionBusy === 'forward' ? '转发中' : ARKME_MESSAGE_SELECT_ACTION_LABELS[2]}</span></button>
            <button
              type="button"
              style={{
                ...styles.selectBarButton,
                ...(messageActionBusy !== undefined ? styles.selectBarButtonDisabled : {}),
              }}
              disabled={messageActionBusy !== undefined}
              aria-label={ARKME_MESSAGE_SELECT_ACTION_LABELS[3]}
              onClick={() => { setSelectMode(undefined) }}
            ><span style={styles.selectBarIconTile}><ArkmeSelectActionIcon kind="close" size={18} /></span><span style={styles.selectBarLabel}>{ARKME_MESSAGE_SELECT_ACTION_LABELS[3]}</span></button>
          </div>}
          {activeConversation && forwardSuccessFeedback !== undefined && <div style={styles.forwardSuccessBannerWrap}>
            <button
              type="button"
              style={styles.forwardSuccessBanner}
              aria-label={forwardSuccessFeedback.message}
              onClick={() => {
                if (forwardSuccessTimerRef.current !== undefined) {
                  window.clearTimeout(forwardSuccessTimerRef.current)
                  forwardSuccessTimerRef.current = undefined
                }
                const target = forwardSuccessFeedback.targets[0]
                setForwardSuccessFeedback(undefined)
                if (target !== undefined) activateSource(target)
              }}
            >
              <span
                style={{
                  ...styles.forwardSuccessAvatarStack,
                  width: Math.min(30 + Math.max(0, forwardSuccessFeedback.targets.length - 1) * 15, 75),
                }}
              >
                {forwardSuccessFeedback.targets.slice(0, 4).map((target, index) => <span
                  key={target.sourceRef}
                  style={{ position: 'absolute', left: index * 15, top: 0 }}
                >
                  <ArkmeDirectorySourceAvatar source={target} size={30} />
                </span>)}
              </span>
              <span style={styles.forwardSuccessText}>{forwardSuccessFeedback.message}</span>
              <span style={styles.forwardSuccessAction}>去看看</span>
            </button>
          </div>}
          {messageActionStatus !== '' && <div role="status" aria-live="polite" style={styles.messageActionToast}>{messageActionStatus}</div>}
          {activeSelectMode === undefined && <footer className="arkme-conversation-composer" style={styles.composer}
            onDragOver={event => { if (!preparingFiles && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
            onDrop={event => { if (!preparingFiles && event.dataTransfer.files.length > 0) { event.preventDefault(); void selectFiles(event.dataTransfer.files) } }}
          ><div style={styles.composerStack}><div ref={composerRef} className="arkme-conversation-composer-inner" style={styles.composerInner}>
            {addMenuOpen && <div ref={addMenuRef} style={styles.addMenu} role="menu">
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }}><span aria-hidden>📎</span>添加照片和文件</button>
              <div style={styles.menuDivider} />
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { setLongArticleCreating(true); setAddMenuOpen(false) }}><span aria-hidden>✎</span>写长文</button>
            </div>}
            <input ref={fileInputRef} type="file" multiple hidden onChange={event => { void selectFiles(event.currentTarget.files) }} />
            {attachments.length > 0 && <ArkmeAttachmentStrip attachments={attachments} disabled={preparingFiles}
              onMove={(from, to) => arkmeComposerDraftStore.moveAttachment(composerDraftKey, from, to)}
              onPreview={attachment => { if (attachment.localFile !== undefined) setDraftPreview(localFileBlock(attachment.localFile)) }}
              onRemove={attachment => {
                arkmeComposerDraftStore.removeAttachment(composerDraftKey, arkmeAttachmentId(attachment))
                if (attachment.localFile !== undefined) void callArkme('files.local.remove', { fileRef: attachment.localFile.fileRef }).catch(caught => setError(errorMessage(caught)))
              }}
            />}
            {activeConversation && draftPreview !== undefined && typeof document !== 'undefined' && createPortal(<ArkmeMediaPreview selected={draftPreview} blocks={attachments.flatMap(attachment => attachment.localFile === undefined ? [] : [localFileBlock(attachment.localFile)])} onSelect={setDraftPreview} onClose={() => setDraftPreview(undefined)} openLocalFile={false} />, document.body)}
            {mentionTrigger !== undefined && <div style={styles.mentionSuggestions} role="listbox" aria-label="选择要 @ 的对象">
              {mentionCandidates.length === 0
                ? <div style={styles.mentionSuggestionsEmpty}>暂无可 @ 的对象</div>
                : mentionCandidates.map((member, index) => {
                  const primary = arkmeMentionCandidatePrimaryText(member)
                  const secondary = member.kind === 'bot' ? (member.secondaryName ?? 'Bot').trim() : ''
                  return <button
                    key={member.kind === 'all'
                      ? 'all'
                      : member.kind === 'bot'
                        ? `bot:${member.botRef}`
                        : `member:${member.mentionRef}`}
                    type="button"
                    role="option"
                    aria-selected={index === mentionCandidateIndex}
                    style={{
                      ...styles.mentionSuggestionRow,
                      ...(index === mentionCandidateIndex ? styles.mentionSuggestionRowActive : {}),
                    }}
                    onMouseEnter={() => { setMentionCandidateIndex(index) }}
                    onMouseDown={event => {
                      event.preventDefault()
                      insertMentionCandidate(member)
                    }}
                  >
                    <span style={styles.mentionSuggestionAvatar} aria-hidden>
                      {member.kind === 'bot'
                        ? member.avatarRef === undefined
                          ? <span style={styles.mentionSuggestionBotAvatar}><RobotIcon size={14} weight="fill" /></span>
                          : <ArkmeUserAvatar avatarRef={member.avatarRef} size={28} label={member.displayName} />
                        : <ArkmeUserAvatar {...(member.kind === 'member' && member.avatarRef !== undefined ? { avatarRef: member.avatarRef } : {})} size={28} label={member.displayName} />}
                    </span>
                    <span style={styles.mentionSuggestionText}>
                      <span style={styles.mentionSuggestionName}>{primary}</span>
                      {secondary !== '' && secondary !== member.displayName
                        ? <span style={styles.mentionSuggestionSecondary}>{secondary}</span>
                        : null}
                    </span>
                  </button>
                })}
            </div>}
            <ArkmeRichComposerInput key={composerDraftKey} className="arkme-conversation-textarea" ref={textareaRef} style={styles.textarea!} value={draft} mentions={composerDraft.mentions} emojis={composerDraft.emojis} maxLength={20000} placeholder={composerPlaceholder} ariaLabel={composerPlaceholder} disabled={preparingFiles}
              onTextChange={updateComposerText}
              onFocus={() => { setComposerInputFocused(true) }}
              onBlur={() => { setComposerInputFocused(false) }}
              onSelectionChange={updateMentionTrigger}
              onPaste={event => {
                const files = arkmeClipboardFiles(event.clipboardData)
                if (files.length === 0) return
                event.preventDefault()
                void selectFiles(files)
              }}
              onKeyDown={event => {
                if (mentionTrigger !== undefined) {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setMentionTrigger(undefined)
                    return
                  }
                  if (event.key === 'ArrowDown' && mentionCandidates.length > 0) {
                    event.preventDefault()
                    setMentionCandidateIndex(index => (index + 1) % mentionCandidates.length)
                    return
                  }
                  if (event.key === 'ArrowUp' && mentionCandidates.length > 0) {
                    event.preventDefault()
                    setMentionCandidateIndex(index => (index + mentionCandidates.length - 1) % mentionCandidates.length)
                    return
                  }
                  if ((event.key === 'Enter' || event.key === 'Tab') && mentionCandidates.length > 0) {
                    event.preventDefault()
                    const selectedCandidate = mentionCandidates[Math.min(mentionCandidateIndex, mentionCandidates.length - 1)]
                    if (selectedCandidate !== undefined) insertMentionCandidate(selectedCandidate)
                    return
                  }
                }
                if (!event.nativeEvent.isComposing && (event.key === 'Backspace' || event.key === 'Delete')) {
                  const caret = arkmeComposerDraftStore.deleteMentionAtSelection(
                    composerDraftKey,
                    textareaRef.current?.selectionStart ?? draft.length,
                    textareaRef.current?.selectionEnd ?? draft.length,
                    event.key === 'Backspace' ? 'backward' : 'forward',
                  )
                  if (caret !== undefined) {
                    event.preventDefault()
                    requestAnimationFrame(() => {
                      textareaRef.current?.focus()
                      textareaRef.current?.setSelectionRange(caret, caret)
                    })
                    return
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (canSend) void send()
                }
              }} />
            <div style={styles.tools}><div style={styles.toolGroup}><button ref={addMenuTriggerRef} type="button" style={styles.plus} aria-label="添加内容" aria-haspopup="menu" aria-expanded={addMenuOpen} disabled={preparingFiles} onClick={() => { setAddMenuOpen(value => !value) }}>{preparingFiles ? <ArkmeFilePreparingIndicator /> : '+'}</button><ArkmeEmojiPicker
              key={`emoji-picker:${conversationOverlayKey}`}
              disabled={preparingFiles}
              scopeKey={composerDraftKey}
              {...(source?.kind === 'private_chat' || source?.kind === 'group_chat' ? { sourceRef: source.sourceRef } : {})}
              getCaretGeometry={() => textareaRef.current?.getCaretGeometry()}
              getEditorGeometry={() => textareaRef.current?.getEditorGeometry()}
              onSelect={insertEmoji}
              onUploadSticker={async file => {
                if (composerDraftKey === undefined) throw new Error('请先选择聊天')
                return await uploadFavoriteSticker(file)
              }}
              onStickerSent={async () => { await loadTimeline() }}
              onError={message => { setError(message) }}
            /></div><div style={styles.composerSendArea}>
              {arkmeSourceSupportsLocationCapture(source?.kind) && (composerInputFocused || composerTextLength > 0) && <button type="button" style={styles.composerTimeToggle} title={composerLocation === undefined ? '点击记录本条消息的位置' : '点击移除本条消息的位置'} aria-label={composerLocation === undefined ? '位置记录' : '已采集本条位置，点击移除'} onMouseDown={event => { event.preventDefault() }} onClick={() => {
                if (composerLocation !== undefined) { setComposerLocation(undefined); textareaRef.current?.focus(); return }
                void requestArkmeRecordLocation().then(location => {
                  setArkmeLocationCaptureEnabled(authenticatedUserId, true)
                  setComposerLocation(location)
                  setError('')
                  textareaRef.current?.focus()
                }).catch(caught => { setError(errorMessage(caught)) })
              }}>{composerLocation !== undefined ? '⌖ 已记录位置' : locationCaptureEnabled ? '⌖ 获取本条位置' : '⌖ 开启位置记录'}</button>}
              <ArkmeComposerInputStats
                active={activeConversation}
                visible={composerStatsVisible}
                textLength={composerTextLength}
                {...(composerInputStartedAtMillis === undefined ? {} : { startedAtMillis: composerInputStartedAtMillis })}
                showsInputTime={composerShowsInputTime}
                onToggle={() => {
                  const next = !composerShowsInputTime
                  setComposerShowsInputTime(next)
                  setArkmeComposerShowsInputTime(next)
                  textareaRef.current?.focus()
                }}
              />
              <button
              type="button"
              style={{ ...styles.send, opacity: canSend ? 1 : .4 }}
              disabled={!canSend}
              aria-label="发送消息"
              onMouseDown={event => { event.preventDefault() }}
              onMouseEnter={event => {
                if (!event.currentTarget.disabled) {
                  event.currentTarget.style.background = '#262936'
                }
              }}
              onMouseLeave={event => {
                event.currentTarget.style.background = '#171923'
              }}
              onClick={() => { void send() }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
              </svg>
              </button>
            </div></div></div>
            <div style={styles.composerHint}>Enter发送 / Shift+Enter换行</div>
          </div></footer>}
        </>}
        {activeConversation && forwardTargetPicker !== undefined && <div
          style={styles.forwardTargetBackdrop}
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget && messageActionBusy !== 'forward') setForwardTargetPicker(undefined) }}
        >
          <section
            style={styles.forwardTargetDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="arkme-forward-target-title"
          >
            <header style={styles.forwardTargetHeader}>
              <span aria-hidden />
              <h3 id="arkme-forward-target-title" style={styles.forwardTargetTitle}>转发给</h3>
              <button
                type="button"
                style={styles.forwardTargetClose}
                disabled={messageActionBusy === 'forward'}
                aria-label="关闭转发对象选择"
                onClick={() => { if (messageActionBusy !== 'forward') setForwardTargetPicker(undefined) }}
              >×</button>
            </header>
            <div style={styles.forwardTargetSearchWrap}>
              <span style={styles.forwardTargetSearchIcon}><ArkmeSearchIcon /></span>
              <input
                style={styles.forwardTargetSearch}
                value={forwardTargetPicker.keyword}
                placeholder="搜索"
                aria-label="搜索转发对象"
                disabled={messageActionBusy === 'forward'}
                onChange={event => {
                  const keyword = event.currentTarget.value
                  setForwardTargetPicker(current => current === undefined
                    ? current
                    : { ...current, keyword })
                }}
              />
            </div>
            {forwardTargetPicker.loading && forwardTargetPicker.targets.length === 0
              ? <div role="status" style={styles.forwardTargetStatus}>正在加载转发对象...</div>
              : forwardTargetPicker.error !== ''
                ? <div role="alert" style={styles.forwardTargetStatus}>{forwardTargetPicker.error}</div>
                : forwardVisibleTargets.length === 0
                  ? <div role="status" style={styles.forwardTargetStatus}>暂无可转发对象</div>
                  : <ul style={styles.forwardTargetList} aria-label="转发对象列表">
                    {forwardVisibleTargets.map(target => {
                      const selected = forwardTargetPicker.selectedSourceRefs.includes(target.sourceRef)
                      return <li key={target.sourceRef}>
                        <button
                          type="button"
                          style={{ ...styles.forwardTargetRow, ...(selected ? styles.forwardTargetRowSelected : {}) }}
                          aria-pressed={selected}
                          onClick={() => { toggleForwardTarget(target) }}
                        >
                          <span
                            style={{ ...styles.forwardTargetCheck, ...(selected ? styles.forwardTargetCheckSelected : {}) }}
                            aria-hidden
                          >✓</span>
                          <ArkmeDirectorySourceAvatar source={target} size={38} />
                          <span style={styles.forwardTargetText}>
                            <span style={styles.forwardTargetName}>{target.displayName}</span>
                            <span style={styles.forwardTargetMeta}>{target.latestPreview?.trim() || arkmeForwardTargetMeta(target)}</span>
                          </span>
                          <span style={styles.forwardTargetTime}>{arkmeForwardTargetTimeLabel(target.activeAtMillis)}</span>
                        </button>
                      </li>
                    })}
                  </ul>}
            {forwardSelectedTargets.length > 0 && <footer style={styles.forwardTargetFooter}>
              <div style={styles.forwardTargetRecipients}>
                <span>发送给：</span>
                <span style={styles.forwardTargetAvatarStack}>
                  {forwardSelectedTargets.slice(0, 6).map(target => <ArkmeDirectorySourceAvatar
                    key={target.sourceRef}
                    source={target}
                    size={26}
                  />)}
                </span>
              </div>
              <div style={styles.forwardTargetFooterDivider} />
              <div style={styles.forwardTargetPreview}>
                <span style={styles.forwardTargetPreviewIcon}><ArkmeForwardLinearIcon size={18} /></span>
                <span style={styles.forwardTargetPreviewText}>
                  <span style={styles.forwardTargetPreviewTitle}>{arkmeForwardPreviewTitle(forwardPickerMessageItems, source)}</span>
                  <span style={styles.forwardTargetPreviewSubtitle}>{arkmeForwardPreviewSubtitle(forwardPickerMessageItems)}</span>
                </span>
                <button
                  type="button"
                  style={styles.forwardTargetPreviewClose}
                  disabled={messageActionBusy === 'forward'}
                  aria-label="关闭转发对象选择"
                  onClick={() => { if (messageActionBusy !== 'forward') setForwardTargetPicker(undefined) }}
                ><ArkmeForwardCloseBorderIcon /></button>
              </div>
              {forwardTargetPicker.sendError !== '' && <div role="alert" style={styles.forwardTargetSendError}>{forwardTargetPicker.sendError}</div>}
              <div style={styles.forwardTargetComposer}>
                <textarea
                  style={styles.forwardTargetCommentInput}
                  value={forwardTargetPicker.commentText}
                  placeholder="说点什么..."
                  aria-label="转发附言"
                  disabled={messageActionBusy === 'forward'}
                  onChange={event => {
                    const commentText = event.currentTarget.value
                    setForwardTargetPicker(current => current === undefined
                      ? current
                      : { ...current, commentText })
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void confirmForwardTargets()
                    }
                  }}
                />
                <button
                  type="button"
                  style={{
                    ...styles.forwardTargetSend,
                    ...(messageActionBusy === 'forward' ? styles.forwardTargetSendDisabled : {}),
                  }}
                  disabled={messageActionBusy === 'forward'}
                  aria-label={messageActionBusy === 'forward' ? '转发中' : '发送转发'}
                  onClick={() => { void confirmForwardTargets() }}
                >
                  <ArkmeForwardSubmitIcon />
                </button>
              </div>
            </footer>}
          </section>
        </div>}
        {activeConversation && messageMenu !== undefined && messageMenuItem !== undefined && <div
          ref={messageMenuRef}
          style={{ ...styles.messageActionMenu, left: messageMenu.left, top: messageMenu.top }}
          role="menu"
          aria-label="消息操作"
        >
          <button
            type="button"
            role="menuitem"
            style={styles.messageActionMenuItem}
            onClick={() => { void copyMessageText(messageMenuItem) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden><ArkmeMessageActionIcon kind="copy" /></span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_ACTION_MENU_LABELS[0]}</span></button>
          <button
            type="button"
            role="menuitem"
            style={{ ...styles.messageActionMenuItem, opacity: arkmeTimelineMessageActionRef(messageMenuItem) === '' ? .45 : 1 }}
            disabled={arkmeTimelineMessageActionRef(messageMenuItem) === ''}
            onClick={() => { void copyMessageLink([messageMenuItem]) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden><ArkmeMessageActionIcon kind="link" /></span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_ACTION_MENU_LABELS[1]}</span></button>
          <button
            type="button"
            role="menuitem"
            style={{ ...styles.messageActionMenuItem, opacity: arkmeTimelineMessageActionRef(messageMenuItem) === '' ? .45 : 1 }}
            disabled={arkmeTimelineMessageActionRef(messageMenuItem) === ''}
            onClick={() => { enterMessageSelectMode(messageMenuItem) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden><ArkmeMessageActionIcon kind="select" /></span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_ACTION_MENU_LABELS[2]}</span></button>
          <button
            type="button"
            role="menuitem"
            style={{ ...styles.messageActionMenuItem, opacity: arkmeTimelineMessageActionRef(messageMenuItem) === '' ? .45 : 1 }}
            disabled={arkmeTimelineMessageActionRef(messageMenuItem) === ''}
            onClick={() => { openForwardTargetPicker([messageMenuItem]) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden><ArkmeMessageActionIcon kind="forward" /></span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_ACTION_MENU_LABELS[3]}</span></button>
          {arkmeCanReportTimelineMessage(source, messageMenuItem) && <button
            type="button"
            role="menuitem"
            style={styles.messageActionMenuItem}
            onClick={() => { openMessageReport(messageMenuItem) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden><ArkmeMessageActionIcon kind="report" /></span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_REPORT_ACTION_LABEL}</span></button>}
          {arkmeCanOpenMessageSnapshot(messageMenuItem) && <button
            type="button"
            role="menuitem"
            style={{ ...styles.messageActionMenuItem, borderTop: `1px solid ${colors.border}`, borderRadius: 0, marginTop: 4, paddingTop: 10 }}
            onClick={() => { openMessageSnapshot(messageMenuItem) }}
          ><span style={styles.messageActionMenuIcon} aria-hidden>ⓘ</span><span style={styles.messageActionMenuText}>{ARKME_MESSAGE_ACTION_DETAIL_LABEL}</span></button>}
        </div>}
        {activeConversation && messageReportItem !== undefined && <ArkmeMessageReportDialog
          item={messageReportItem}
          onClose={() => { setMessageReportItem(undefined) }}
          onSubmitted={() => {
            setMessageReportItem(undefined)
            showMessageActionStatus('举报已提交')
          }}
        />}
        {activeConversation && snapshot !== undefined && <ArkmeMessageSnapshotDialog item={snapshot.item} {...(snapshot.detail === undefined ? {} : { detail: snapshot.detail })} loading={snapshot.loading} {...(snapshot.loadError === undefined ? {} : { loadError: snapshot.loadError })} onClose={closeMessageSnapshot} />}
        {activeConversation && source !== undefined && memberMenu !== undefined && <ArkmeMemberActionMenu
          member={memberMenu.member}
          sourceKind={source.kind}
          position={memberMenu.position}
          onMention={() => { insertMemberMention(memberMenu.member) }}
          onRecords={mode => { openMemberRecords(memberMenu.member, mode) }}
          onClose={closeMemberMenu}
        />}
        {activeConversation && memberProfile !== undefined && <ArkmeMemberProfileCard
          member={memberProfile}
          showTopicNickname={source?.kind === 'group_chat'}
          busy={privateChatBusy}
          onClose={() => { if (!privateChatBusy) setMemberProfile(undefined) }}
          onSend={() => { openPrivateChatForMember(memberProfile) }}
        />}
        {activeConversation && source !== undefined && memberRecords !== undefined && <ArkmeMemberRecordsPanel
          sourceRef={source.sourceRef}
          member={memberRecords.member}
          mode={memberRecords.mode}
          onClose={() => { setMemberRecords(undefined) }}
        />}
        {activeConversation && drawer === 'detail' && detailItem !== undefined && <>
          <div
            style={styles.forwardDrawerDismiss}
            aria-hidden="true"
            onClick={() => { setDrawer(undefined) }}
          />
          {detailItem.forwardRecords !== undefined && <ForwardRecordsDetail
            key={detailItem.itemUid}
            item={detailItem}
            onClose={() => { setDrawer(undefined) }}
          />}
          {detailSharedRecording !== undefined && <RelatedRecordingDetail
            key={detailItem.itemUid}
            item={detailSharedRecording}
            showReadOnlyLabel={false}
            {...(detailSharedRecording.sharedRecordingDetailRef === undefined ? {} : {
              loadDetail: async (_item: ArkmeRelatedRecordingItem, signal?: AbortSignal) => arkmeRelatedRecordingItemFromSharedRecordingPreview(
                await callArkme<ArkmeSharedRecordingPreview>(
                  'source.shared-recording-detail',
                  { detailRef: detailSharedRecording.sharedRecordingDetailRef },
                  signal,
                ),
                detailItem,
              ),
            })}
            onClose={() => { setDrawer(undefined) }}
          />}
        </>}
        {activeConversation && drawer === 'detail' && detailItem !== undefined && detailItem.forwardRecords === undefined && detailSharedRecording === undefined && <ArkmeTimelineDetailDrawer
          key={detailItem.itemUid}
          item={detailItem}
          sourceRef={source?.sourceRef}
          showOriginal={showOriginal}
          onClose={() => { setDrawer(undefined) }}
          onToggleOriginal={() => { setShowOriginal(value => !value) }}
          shareWebsite={shareWebsite}
          onMessageCopyLinkOpen={openMessageCopyLinkDetail}
        />}
        {activeConversation && drawer === 'copyLink' && copyLinkDetail !== undefined && <>
          <div
            style={styles.forwardDrawerDismiss}
            aria-hidden="true"
            onClick={closeMessageCopyLinkDetail}
          />
          <CopyLinkDetailDrawer
            state={copyLinkDetail}
            onClose={closeMessageCopyLinkDetail}
            onRetry={() => { loadMessageCopyLinkDetail(copyLinkDetail.sid) }}
            onShare={() => { void shareCurrentCopyLinkDetail() }}
            draft={copyLinkDetailDraft}
            onDraftChange={value => {
              setCopyLinkDetailDraft(value)
              if (copyLinkDetailSendError !== '') setCopyLinkDetailSendError('')
            }}
            onSendDraft={() => { void sendCopyLinkDetailThought() }}
            sendBusy={copyLinkDetailSending}
            sendDisabled={copyLinkDetailSending || copyLinkDetailDraft.trim() === '' || copyLinkDetail.status !== 'ready' || copyLinkDetailExtensionTarget(copyLinkDetail.detail) === undefined}
            sendError={copyLinkDetailSendError}
            shareWebsite={shareWebsite}
          />
        </>}
        {authView === 'content' && ui.mode === 'contact-add' && <div
          style={styles.contactBackdrop}
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) arkmeUi.showConversations() }}
        >
          <section style={styles.contactDialog} role="dialog" aria-modal="true" aria-labelledby="arkme-contact-add-title">
            <header style={styles.contactDialogHeader}>
              <h2 id="arkme-contact-add-title" style={styles.contactDialogTitle}>添加联系人</h2>
              <button type="button" style={styles.contactDialogClose} aria-label="关闭添加联系人" onClick={() => { arkmeUi.showConversations() }}>×</button>
            </header>
            <div style={styles.contactDialogBody}>
              <ArkmeContactAddSurface
                compact
                shareWebsite={shareWebsite}
                onSourceActivated={activateSource}
              />
            </div>
          </section>
        </div>}
      </section>
      {activeConversation && relatedPanelOpen && source?.kind === 'private_chat' && <RelatedRecordingsPanel
        contactName={source.displayName}
        {...(source.avatarRef === undefined ? {} : { contactAvatarRef: source.avatarRef })}
        state={relatedState}
        stateMessage={relatedStateMessage}
        error={relatedError}
        items={relatedItems}
        hasMore={relatedHasMore}
        loadingMore={relatedLoadingMore}
        monthBuckets={relatedMonths}
        selectedMonth={relatedMonth}
        onClose={closeRelatedPanel}
        onRetry={() => { reloadRelated('') }}
        onLoadMore={loadMoreRelated}
        onMonthChange={selectRelatedMonth}
        onSelect={setRelatedDetail}
      />}
      {activeConversation && relatedDetail !== undefined && <RelatedRecordingDetail
        item={relatedDetail}
        loadDetail={loadRelatedRecordingDetail}
        onClose={() => { setRelatedDetail(undefined) }}
      />}
      {activeConversation && selectedMoment !== undefined && detailState !== undefined && <ArkmeInterwovenDetailAside
        state={detailState}
        relatedView={momentRelatedView}
        relatedState={momentRelatedState}
        relatedDetailState={momentRelatedDetailState}
        shareWebsite={shareWebsite}
        {...(source === undefined ? {} : { sourceRef: source.sourceRef })}
        onClose={closeMomentDetail}
        onRetry={() => { void loadMomentDetail(selectedMoment, true) }}
        onOpenRelated={() => { setMomentRelatedView('related-list') }}
        onSelectRelated={item => { void loadMomentRelatedDetail(item) }}
        onBackRelated={backMomentRelated}
        onRetryRelated={() => { void loadMomentRelated(selectedMoment) }}
        onRetryRelatedDetail={item => { void loadMomentRelatedDetail(item) }}
        {...(detailGroupTarget === undefined ? {} : { onOpenGroup: () => {
          closeMomentDetail()
          arkmeUi.selectSource(detailGroupTarget)
        } })}
      />}
      {activeConversation && longArticleCreating && source !== undefined && typeof document !== 'undefined' && createPortal(
        <ArkmeLongArticleDialog
          sourceRef={source.sourceRef}
          onClose={() => { setLongArticleCreating(false) }}
          onCreated={item => {
            pendingViewportRestoreRef.current = { sourceKey: conversationKey, viewport: undefined }
            setItems(current => mergeItems(current, [item]))
          }}
        />,
        document.body,
      )}
    </div>
  )
}
