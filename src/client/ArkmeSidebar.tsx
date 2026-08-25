import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode, type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import type {
  ArkmeAuthSnapshot, ArkmeGroupAiPolishNotice, ArkmeGroupAiPolishSnapshot, ArkmeSourceReadResult,
  ArkmeRelatedRecordingItem, ArkmeRelatedRecordingMonthBucket, ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageState, ArkmeSourceItem, ArkmeSourceSendResult, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage,
  ArkmeInterwovenBootstrap, ArkmeInterwovenDetail, ArkmeInterwovenMention, ArkmePluginResponse,
  ArkmeUploadedAsset, ArkmeForwardRecordPreviewItem, ArkmeUserProfile, ArkmeUserProfileSnapshot,
  ArkmeConversationMemberItem, ArkmeConversationMemberList, ArkmeConversationMemberRecordMode,
  ArkmeOpenPrivateChatResult,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { ArkmeSourceAvatar, ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeGroupChatControls } from './ArkmeGroupChatControls.js'
import {
  ArkmeMemberActionMenu, ArkmeMemberProfileCard, ArkmeMemberRecordsPanel,
  arkmeMemberActionMenuRowCount, arkmeMemberConversationAction, positionArkmeMemberMenu,
  type ArkmeMemberMenuPosition,
} from './ArkmeChatMemberActions.js'
import { ArkmeLogin, type ArkmeLoginMode } from './ArkmeLogin.js'
import { ArkmeMuteIcon } from './ArkmeMuteIcon.js'
import { ArkmeArkoSurface } from './ArkmeArkoSurface.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'
import { ArkmeRecordingSurface } from './ArkmeRecordingSurface.js'
import { ArkmeCallSurface } from './ArkmeCallSurface.js'
import { ArkmeWorldSurface } from './ArkmeWorldSurface.js'
import { ArkmeAttachmentDraftTile, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMentionTextarea } from './ArkmeMentionTextarea.js'
import { ArkmeSearchSurface } from './ArkmeSearchSurface.js'
import { ArkmeContactAddSurface } from './ArkmeContactAddSurface.js'
import { ARKME_DEFAULT_SHARE_WEBSITE } from '../types.js'
import { ArkmeMarketplace } from './ArkmeMarketplace.js'
import {
  appendArkmeSourceBreadcrumbTrail, ArkmeSourceBreadcrumb, arkmeSourceBreadcrumb,
  truncateArkmeSourceBreadcrumbTrail,
} from './ArkmeSourceBreadcrumb.js'
import {
  ArkmeTopicDirectoryPopover, type ArkmeSelfSourcesResolution,
} from './ArkmeTopicDirectoryPopover.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeVoiceprintSurface } from './ArkmeVoiceprintSurface.js'
import { ArkmeNavigation, type ArkmeNavigationProps } from './ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation } from './chat-directory-store.js'
import {
  ArkmeConversationMemoryCache,
  arkmeConversationRestoredScrollTop,
  arkmeConversationTimelineContentEqual,
  arkmeShouldRefreshConversationTimeline,
  type ArkmeConversationTimelineSnapshot,
  type ArkmeConversationViewportSnapshot,
} from './conversation-memory-cache.js'
import {
  arkmeComposerCanSend,
  arkmeComposerDraftStore,
  arkmeSourceComposerDraftKey,
  releaseArkmeComposerDraft,
  type ArkmeComposerAttachment,
} from './composer-draft-store.js'
import {
  arkmeConversationComposerHeight, arkmeConversationComposerLayout,
} from './conversation-composer-presentation.js'
import { restoreArkmeComposerFocus } from './composer-focus.js'
import {
  ARKME_CONVERSATION_HEADER_HEIGHT, ArkmeInterwovenDetailAside, ArkmeInterwovenMentionCard,
  mergeConversationRows, resolveInterwovenGroupTarget,
  type ArkmeConversationRow, type ArkmeInterwovenDetailViewState,
} from './interwoven-moments.js'
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
  ownsWechatLogin?: boolean
}

export type ArkmeAuthView = 'login' | 'content'

const EMPTY_SELF_SOURCES: readonly ArkmeSourceItem[] = []
export function arkmeShouldDismissAnchoredMenu(
  target: Node | null,
  menu: Pick<Node, 'contains'> | null,
  trigger: Pick<Node, 'contains'> | null,
): boolean {
  return target !== null && menu?.contains(target) !== true && trigger?.contains(target) !== true
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
  headerActions: { position: 'relative', marginLeft: 'auto', flex: 'none' },
  moreButton: { width: 36, height: 32, border: 0, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 17, letterSpacing: 2 },
  popover: { position: 'absolute', zIndex: 40, top: 38, right: 0, width: 150, padding: 6, border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.panel, boxShadow: '0 12px 32px rgba(0,0,0,.12)' },
  menuItem: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, border: 0, borderRadius: 8, padding: '9px 10px', background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 13 },
  menuStatus: { padding: '9px 10px', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  body: { flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: '22px 22px 12px', background: arkmeTheme.base },
  utilityBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
  error: { padding: '10px 12px', borderRadius: 9, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  records: { width: '100%', minWidth: 0, listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 },
  timelineSkeleton: { display: 'flex', flexDirection: 'column', gap: 24, padding: '4px 0 20px' },
  timelineSkeletonRow: { display: 'flex', alignItems: 'flex-start', gap: 11 },
  timelineSkeletonRowMe: { flexDirection: 'row-reverse' },
  timelineSkeletonAvatar: { width: 38, height: 38, flex: 'none', borderRadius: '50%', background: arkmeTheme.subtle },
  timelineSkeletonBubble: { height: 54, borderRadius: 14, background: arkmeTheme.subtle },
  newMessages: {
    position: 'sticky', zIndex: 4, bottom: 6, display: 'block', margin: '8px auto 0', padding: '7px 13px',
    border: `1px solid ${colors.border}`, borderRadius: 999, background: colors.panel, color: colors.text,
    boxShadow: '0 5px 18px rgba(20,23,31,.12)', cursor: 'pointer', fontSize: 12,
  },
  date: { alignSelf: 'center', marginBottom: 18, color: arkmeTheme.caption, fontSize: 10 },
  row: { width: '100%', minWidth: 0, display: 'flex' },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageLine: { maxWidth: '100%', display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 23 },
  messageLineMe: { flexDirection: 'row-reverse' },
  forwardMessageLine: { width: '88%' },
  messageBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 },
  messageBodyMe: { alignItems: 'flex-end' },
  forwardMessageBody: { flex: 1 },
  messageAvatar: {
    width: 38, height: 38, flex: 'none', overflow: 'hidden', borderRadius: 999,
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
  bubble: { maxWidth: 600, minWidth: 0, padding: '10px 13px', overflow: 'hidden', overflowWrap: 'anywhere', wordBreak: 'break-word', borderRadius: '5px 16px 16px 16px', boxSizing: 'border-box', cursor: 'pointer', border: '1px solid rgba(29,32,40,.035)' },
  bubbleMe: { background: arkmeTheme.messageOwn, borderColor: 'rgba(83,97,145,.045)', borderRadius: '16px 5px 16px 16px', '--arkme-bubble-fade': arkmeTheme.messageOwn } as CSSProperties,
  bubbleOther: { background: arkmeTheme.messageOther, '--arkme-bubble-fade': arkmeTheme.messageOther } as CSSProperties,
  forwardBubble: { width: '100%', maxWidth: 400, minWidth: 0, padding: 0, borderRadius: 0, background: 'transparent' },
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: '20px' },
  meta: { color: arkmeTheme.caption, fontSize: 10 },
  polishMeta: { minHeight: 14, marginBottom: 2, color: colors.secondary, fontSize: 10, lineHeight: '14px', display: 'flex', gap: 8, alignItems: 'center' },
  retry: { border: 0, padding: 0, background: 'transparent', color: arkmeTheme.danger, cursor: 'pointer', fontSize: 11 },
  notice: { alignSelf: 'center', maxWidth: 520, padding: '8px 12px 0', color: colors.secondary, textAlign: 'center', fontSize: 13, lineHeight: '16px' },
  sentinel: { width: '100%', height: 1 },
  loading: { textAlign: 'center', color: colors.secondary, fontSize: 12, padding: 6 },
  composer: { ...arkmeConversationComposerLayout.composer, background: '#fff' },
  composerInner: {
    ...arkmeConversationComposerLayout.composerInner,
    border: `1px solid ${colors.border}`,
    background: arkmeTheme.input, boxShadow: arkmeTheme.shadow,
  },
  textarea: {
    ...arkmeConversationComposerLayout.textarea,
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: { ...arkmeConversationComposerLayout.tools },
  plus: { width: 34, height: 34, border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 22, lineHeight: '30px' },
  addMenu: { position: 'absolute', left: 0, bottom: 54, zIndex: 20, width: 210, padding: '6px 0', borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.panel, boxShadow: '0 12px 32px rgba(0,0,0,.15)' },
  addMenuItem: { width: '100%', border: 0, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 14, textAlign: 'left' },
  menuDivider: { height: 1, margin: '4px 0', background: colors.border },
  attachments: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px' },
  uploadStatus: { padding: '0 14px', color: colors.secondary, fontSize: 12 },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 9, background: '#171923',
    color: arkmeTheme.foreground, cursor: 'pointer', transform: 'translateY(-2px)', transition: 'background-color 100ms ease',
  },
  drawer: { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10, width: 'min(420px, 92%)', display: 'flex', flexDirection: 'column', background: colors.panel, borderLeft: `1px solid ${colors.border}`, boxShadow: '-12px 0 30px rgba(0,0,0,.12)' },
  forwardDrawer: { top: ARKME_CONVERSATION_HEADER_HEIGHT, width: 'min(420px, 92%)' },
  forwardDrawerDismiss: {
    position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, left: 0,
    zIndex: 9, background: 'transparent',
  },
  drawerHeader: { height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: `1px solid ${colors.border}`, boxSizing: 'border-box' },
  drawerTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  close: { marginLeft: 'auto', width: 32, height: 32, border: 0, borderRadius: 999, background: arkmeTheme.hover, cursor: 'pointer', color: colors.text },
  drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 },
  detailText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 16, lineHeight: '26px' },
  forwardDetailHeader: { minHeight: 76, flex: 'none', position: 'relative', display: 'grid', placeItems: 'center', padding: '12px 60px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}` },
  forwardDetailHeading: { minWidth: 0, textAlign: 'center' },
  forwardDetailTitle: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 18, lineHeight: '26px', fontWeight: 600 },
  forwardDetailRange: { marginTop: 1, color: '#9aa0a8', fontSize: 13, lineHeight: '18px' },
  forwardDetailClose: { position: 'absolute', right: 18, top: 20, width: 34, height: 34, border: 0, background: 'transparent', color: '#8d9299', cursor: 'pointer', fontSize: 30, lineHeight: '30px' },
  forwardDetailBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 28px 8px' },
  forwardDetailRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 0' },
  forwardDetailAvatar: { width: 42, height: 42, flex: 'none', overflow: 'hidden', borderRadius: 999, display: 'grid', placeItems: 'center' },
  forwardDetailContent: { minWidth: 0, flex: 1 },
  forwardDetailMeta: { display: 'flex', alignItems: 'baseline', gap: 12 },
  forwardDetailName: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  forwardDetailTime: { flex: 'none', color: '#a2a7ae', fontSize: 13, lineHeight: '20px' },
  forwardDetailRecordText: { margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: colors.text, fontSize: 16, lineHeight: '25px' },
  forwardDetailDivider: { height: 1, background: colors.border },
  forwardDetailFooter: { flex: 'none', padding: '12px 24px 18px', color: '#a2a7ae', textAlign: 'center', fontSize: 13, lineHeight: '18px' },
  toggle: { border: 0, borderRadius: 9, padding: '7px 10px', background: arkmeTheme.infoSoft, color: arkmeTheme.info, cursor: 'pointer', fontSize: 12 },
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

export function arkmeTimelineDetailSenderText(item: ArkmeTimelineItem): string {
  return item.agentSource === undefined ? item.senderName : `${item.senderName} · ${item.agentSource.label}`
}

export function ArkmeTimelineAgentSourceBadge({ item }: { item: ArkmeTimelineItem }) {
  if (item.agentSource === undefined) return null
  return <span style={styles.agentSource} data-arkme-agent-source={item.agentSource.kind}>
    <span style={styles.agentSourceIcon} aria-hidden><AgentAssistantIcon size={12} /></span>
    <span style={styles.agentSourceText}>{item.agentSource.label}</span>
  </span>
}

export function arkmeShouldBeginWechat(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
  ownsWechatLogin = true,
): boolean {
  return ownsWechatLogin
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

export function arkmeSourceDestinationLabel(source: ArkmeSourceItem | undefined): string {
  return source?.displayName ?? '发给自己'
}

export function arkmeSourceComposerPlaceholder(source: ArkmeSourceItem | undefined): string {
  return source === undefined || source.kind === 'send_to_self'
    ? '发送给自己…'
    : `发送到「${source.displayName}」…`
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
    map.set(item.itemUid, previous?.aiPolish !== undefined && item.aiPolish === undefined
      ? { ...item, aiPolish: previous.aiPolish }
      : item)
  }
  return [...map.values()].sort((a, b) => a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid))
}

interface ArkmeTimelineViewState {
  sourceRef: string
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
  const avatar = <ArkmeUserAvatar {...(props.avatarRef === undefined ? {} : { avatarRef: props.avatarRef })} size={38} label="消息头像" />
  if (member === undefined) return <span style={styles.messageAvatar} aria-hidden>{avatar}</span>
  return <button
    type="button"
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
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function forwardFullTimeLabel(value: number): string {
  const millis = normalizedEpochMillis(value)
  if (millis <= 0) return ''
  const date = new Date(millis)
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function ForwardRecordAvatar({ avatarRef }: { avatarRef?: string }) {
  return <span style={styles.forwardDetailAvatar} aria-hidden>
    <ArkmeUserAvatar {...(avatarRef === undefined ? {} : { avatarRef })} size={42} label="转发消息头像" />
  </span>
}

function ForwardRecordsDetail({ item, onClose }: { item: ArkmeTimelineItem; onClose: () => void }) {
  const forward = item.forwardRecords
  if (forward === undefined) return null
  const datedItems = forward.items.map(value => normalizedEpochMillis(value.sendAtMillis)).filter(value => value > 0)
  const earliest = datedItems.length > 0 ? Math.min(...datedItems) : forward.createdAtMillis
  const latest = datedItems.length > 0 ? Math.max(...datedItems) : forward.createdAtMillis
  const startDate = forwardDateLabel(earliest)
  const endDate = forwardDateLabel(latest)
  const range = startDate === endDate ? startDate : `${startDate} 至 ${endDate}`
  const rows: ArkmeForwardRecordPreviewItem[] = forward.items.length > 0
    ? forward.items
    : forward.summaryLines.map(line => {
      const separator = Math.max(line.indexOf('：'), line.indexOf(':'))
      return {
        senderName: separator > 0 ? line.slice(0, separator).trim() : item.senderName,
        sendAtMillis: 0,
        title: '',
        textContent: separator > 0 ? line.slice(separator + 1).trim() : line,
      }
    })
  return <aside style={{ ...styles.drawer, ...styles.forwardDrawer }} aria-label="转发快记详情">
    <header style={styles.forwardDetailHeader}>
      <div style={styles.forwardDetailHeading}>
        <h3 style={styles.forwardDetailTitle}>{forward.title}</h3>
        {range !== '' && <div style={styles.forwardDetailRange}>{range}</div>}
      </div>
      <button type="button" style={styles.forwardDetailClose} aria-label="关闭详情" onClick={onClose}>×</button>
    </header>
    <div style={styles.forwardDetailBody}>
      {(rows.length > 0 ? rows : [{ senderName: item.senderName, sendAtMillis: 0, title: '', textContent: '原快记暂不可查看' }]).map((value, index) => <Fragment key={`${String(index)}:${value.senderName}:${String(value.sendAtMillis)}`}>
        <div style={styles.forwardDetailRow}>
          <ForwardRecordAvatar {...(value.avatarRef === undefined ? {} : { avatarRef: value.avatarRef })} />
          <div style={styles.forwardDetailContent}>
            <div style={styles.forwardDetailMeta}>
              <span style={styles.forwardDetailName}>{value.senderName}</span>
              {forwardShortTimeLabel(value.sendAtMillis) !== '' && <span style={styles.forwardDetailTime}>{forwardShortTimeLabel(value.sendAtMillis)}</span>}
            </div>
            <p style={styles.forwardDetailRecordText}>{value.textContent || value.title || value.contentLabel || '非文本内容'}</p>
          </div>
        </div>
        {index < rows.length - 1 && <div style={styles.forwardDetailDivider} />}
      </Fragment>)}
    </div>
    <footer style={styles.forwardDetailFooter}>此转发生成时间：{forwardFullTimeLabel(forward.createdAtMillis)}</footer>
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
  ownsWechatLogin = true,
}: ArkmeSurfaceProps = {}) {
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
  const auth = authStoreSnapshot.auth ?? initialAuth
  const authenticatedUserId = auth?.status === 'authenticated' ? auth.userId : undefined
  const conversationBackdropVisible = ui.mode === 'source' || ui.mode === 'contact-add'
  const selectedSource = conversationBackdropVisible ? ui.selectedSource : undefined
  const [selfSourcesResolution, setSelfSourcesResolution] = useState<ArkmeAccountSelfSourcesResolution>()
  const [selfSourcesRetryRevision, setSelfSourcesRetryRevision] = useState(0)
  const [selfBreadcrumbTrail, setSelfBreadcrumbTrail] = useState<ArkmeSourceItem[]>([])
  const activeSelfSourcesResolution = selfSourcesResolution === undefined
    || selfSourcesResolution.userId !== authenticatedUserId
    ? undefined
    : selfSourcesResolution.resolution
  const aggregateSource = arkmeAggregateSourceForUser(authenticatedUserId, selfSourcesResolution)
  const selfSources = activeSelfSourcesResolution?.status === 'ready'
    ? activeSelfSourcesResolution.sources
    : EMPTY_SELF_SOURCES
  const selfSourcesRef = useRef(selfSources)
  selfSourcesRef.current = selfSources
  const breadcrumbUserIdRef = useRef(authenticatedUserId)
  useEffect(() => {
    const accountChanged = breadcrumbUserIdRef.current !== authenticatedUserId
    breadcrumbUserIdRef.current = authenticatedUserId
    setSelfBreadcrumbTrail(current => appendArkmeSourceBreadcrumbTrail(
      accountChanged ? [] : current, selectedSource, selfSources,
    ))
  }, [authenticatedUserId, selectedSource, selfSources])
  const source = conversationBackdropVisible ? selectedSource ?? aggregateSource : undefined
  const composerDraftKey = arkmeSourceComposerDraftKey(authenticatedUserId, source)
  useSyncExternalStore(
    arkmeComposerDraftStore.subscribe,
    arkmeComposerDraftStore.getRevision,
    arkmeComposerDraftStore.getRevision,
  )
  const composerDraft = arkmeComposerDraftStore.get(composerDraftKey)
  const draft = composerDraft.text
  const attachments = composerDraft.attachments
  const surfaceRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [timelineView, setTimelineView] = useState<ArkmeTimelineViewState>({
    sourceRef: '', items: [], aiPolishNotices: [], aiPolishSettings: undefined, nextCursor: undefined, hasMore: false,
  })
  const { sourceRef: timelineStateSourceRef, items, aiPolishNotices, aiPolishSettings, nextCursor, hasMore } = timelineView
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
  const setNextCursor = useCallback((action: SetStateAction<ArkmeTimelineCursor | undefined>) => {
    setTimelineView(current => {
      const next = resolveStateAction(action, current.nextCursor)
      return sameStateValue(current.nextCursor, next) ? current : { ...current, nextCursor: next }
    })
  }, [])
  const setHasMore = useCallback((action: SetStateAction<boolean>) => {
    setTimelineView(current => {
      const next = resolveStateAction(action, current.hasMore)
      return current.hasMore === next ? current : { ...current, hasMore: next }
    })
  }, [])
  const [selfProfile, setSelfProfile] = useState<ArkmeUserProfile>()
  const [drawer, setDrawer] = useState<'detail'>()
  const [detailItemUid, setDetailItemUid] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [interwovenMoments, setInterwovenMoments] = useState<ArkmeInterwovenMention[]>([])
  const [interwovenRefreshRevision, setInterwovenRefreshRevision] = useState(0)
  const [selectedMoment, setSelectedMoment] = useState<ArkmeInterwovenMention>()
  const [detailState, setDetailState] = useState<ArkmeInterwovenDetailViewState>()
  const [timelineLoadingSourceRef, setTimelineLoadingSourceRef] = useState('')
  const [timelineSkeletonSourceRef, setTimelineSkeletonSourceRef] = useState('')
  const [timelineRevealSourceRef, setTimelineRevealSourceRef] = useState('')
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [longArticleCreating, setLongArticleCreating] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ key: string; message: string }>()
  const [busy, setBusy] = useState(false)
  const canSend = arkmeComposerCanSend(draft, attachments.length, busy)
  const pendingComposerFocusDraftKeyRef = useRef<string>()
  const [compactNavigation, setCompactNavigation] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState(initialAuth?.status === 'binding-required' ? t('error.binding.required') : '')
  const [agreed, setAgreed] = useState(true)
  const [loginMode, setLoginMode] = useState<ArkmeLoginMode>(initialAuth?.status === 'binding-required' ? 'phone' : 'wechat')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [testLoginEnabled, setTestLoginEnabled] = useState(false)
  const [testUserId, setTestUserId] = useState('')
  const [qr, setQr] = useState('')
  const [conversationMembers, setConversationMembers] = useState<ArkmeConversationMemberItem[]>([])
  const [memberMenu, setMemberMenu] = useState<{
    member: ArkmeConversationMemberItem
    position: ArkmeMemberMenuPosition
  }>()
  const [memberProfile, setMemberProfile] = useState<ArkmeConversationMemberItem>()
  const [memberRecords, setMemberRecords] = useState<{
    member: ArkmeConversationMemberItem
    mode: ArkmeConversationMemberRecordMode
  }>()
  const [privateChatBusy, setPrivateChatBusy] = useState(false)

  useEffect(() => {
    setConversationMembers([])
    setMemberMenu(undefined)
    setMemberProfile(undefined)
    setMemberRecords(undefined)
    setPrivateChatBusy(false)
    if (auth?.status !== 'authenticated' || source === undefined || (source.kind !== 'group_chat' && source.kind !== 'private_chat')) return
    const controller = new AbortController()
    void callArkme<ArkmeConversationMemberList>('source.members', {
      sourceRef: source.sourceRef,
      activeOnly: true,
    }, controller.signal)
      .then(snapshot => { setConversationMembers(snapshot.items) })
      .catch(caught => {
        if (!controller.signal.aborted) setError(errorMessage(caught))
      })
    return () => { controller.abort() }
  }, [auth?.status, source?.kind, source?.sourceRef])

  useEffect(() => {
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
  }, [busy, composerDraftKey])

  useEffect(() => {
    let active = true
    setSelfProfile(undefined)
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
  }, [authenticatedUserId])

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

  const qrRequestStartedRef = useRef(false)
  const conversationCacheRef = useRef(new ArkmeConversationMemoryCache())
  const cacheAccountUserIdRef = useRef<number>()
  const timelineGenerationRef = useRef(0)
  const timelineRequestAbortRef = useRef<AbortController>()
  const pendingViewportRestoreRef = useRef<{
    sourceRef: string
    viewport: ArkmeConversationViewportSnapshot | undefined
  }>()
  const interwovenRequestRef = useRef<AbortController>()
  const interwovenGenerationRef = useRef(0)
  const detailRequestRef = useRef<AbortController>()
  const detailRequestMomentRef = useRef('')
  const lastReadAckRef = useRef('')
  const bindingNotifiedUserIdRef = useRef<number | undefined>()
  const ignoreStaleBindingAuthRef = useRef(false)
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
  const relatedMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!relatedMenuOpen || typeof document === 'undefined') return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (arkmeShouldDismissAnchoredMenu(target, relatedMenuRef.current, null)) setRelatedMenuOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setRelatedMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [relatedMenuOpen])

  useEffect(() => {
    if (timelineLoadingSourceRef === '') return
    const sourceRef = timelineLoadingSourceRef
    const timer = setTimeout(() => {
      setTimelineSkeletonSourceRef(current => timelineLoadingSourceRef === sourceRef ? sourceRef : current)
    }, 120)
    return () => { clearTimeout(timer) }
  }, [timelineLoadingSourceRef])

  useEffect(() => {
    if (timelineRevealSourceRef === '') return
    const timer = setTimeout(() => { setTimelineRevealSourceRef('') }, 160)
    return () => { clearTimeout(timer) }
  }, [timelineRevealSourceRef])

  useEffect(() => {
    const element = surfaceRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const update = () => { setCompactNavigation(element.getBoundingClientRect().width < 720) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { observer.disconnect() }
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
      setError(t('error.binding.required'))
      if (bindingNotifiedUserIdRef.current !== snapshot.userId) {
        bindingNotifiedUserIdRef.current = snapshot.userId
        arkmeUi.authChanged(false)
      }
      return
    }
    bindingNotifiedUserIdRef.current = undefined
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
  }, [authStoreSnapshot.config])
  useEffect(() => {
    if (authStoreSnapshot.error !== '' && authView === 'login') {
      setError(arkmeStoredLoginErrorMessage(authStoreSnapshot.error, t))
    }
  }, [authStoreSnapshot.error, authView, t])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${arkmeConversationComposerHeight(textarea.scrollHeight)}px`
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
    relatedEligibilityAbortRef.current = undefined
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
  }, [authenticated, source?.kind, source?.sourceRef, ui.authRevision])

  const ensureRelatedEligibility = useCallback(() => {
    if (!authenticated || source?.kind !== 'private_chat'
      || relatedEligibility === 'loading' || relatedEligibility === 'allowed' || relatedEligibility === 'denied') return
    const controller = new AbortController()
    relatedEligibilityAbortRef.current?.abort()
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
    }).finally(() => {
      if (relatedEligibilityAbortRef.current === controller) relatedEligibilityAbortRef.current = undefined
    })
  }, [authenticated, relatedEligibility, source])

  const toggleRelatedMenu = useCallback(() => {
    if (relatedPanelOpen) return
    const opening = !relatedMenuOpen
    setRelatedMenuOpen(opening)
    if (opening) ensureRelatedEligibility()
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

  const loadTimeline = useCallback(async (cursor?: ArkmeTimelineCursor, preserve = false) => {
    if (source === undefined) return
    const sourceRef = source.sourceRef
    const generation = timelineGenerationRef.current
    const hadCachedTimeline = conversationCacheRef.current.getTimeline(sourceRef) !== undefined
    const controller = new AbortController()
    timelineRequestAbortRef.current?.abort()
    timelineRequestAbortRef.current = controller
    let page: ArkmeTimelinePage
    try {
      page = await callArkme<ArkmeTimelinePage>('source.timeline', {
        sourceRef, limit: 40, ...(cursor === undefined ? {} : { cursor }),
      }, controller.signal)
    } catch (caught) {
      if (controller.signal.aborted) return
      throw caught
    } finally {
      if (timelineRequestAbortRef.current === controller) timelineRequestAbortRef.current = undefined
    }
    if (generation !== timelineGenerationRef.current) return
    const cached = conversationCacheRef.current.getTimeline(sourceRef)
    const nextAiPolishSettings = cursor === undefined ? page.aiPolishSettings : cached?.aiPolishSettings
    const snapshot: ArkmeConversationTimelineSnapshot = {
      items: cursor === undefined ? mergeItems([], page.items) : mergeItems(cached?.items ?? [], page.items),
      aiPolishNotices: cursor === undefined ? page.aiPolishNotices ?? [] : cached?.aiPolishNotices ?? [],
      hasMore: page.hasMore,
      fetchedAtMillis: Date.now(),
      refreshRevision: ui.chatRevision,
      latestSequence: Math.max(source.latestSequence ?? 0, ...page.items.map(item => item.sequence ?? 0)),
      ...(nextAiPolishSettings === undefined ? {} : { aiPolishSettings: nextAiPolishSettings }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
    const contentChanged = !arkmeConversationTimelineContentEqual(cached, snapshot)
    const releasedMoments = conversationCacheRef.current.storeTimeline(sourceRef, snapshot)
    const releasedMomentsChanged = releasedMoments !== undefined
      && JSON.stringify(releasedMoments) !== JSON.stringify(interwovenMoments)
    if (contentChanged || releasedMomentsChanged) {
      const body = bodyRef.current
      pendingViewportRestoreRef.current = {
        sourceRef,
        viewport: preserve || hadCachedTimeline
          ? body === null ? conversationCacheRef.current.getViewport(sourceRef) : arkmeConversationViewport(body)
          : undefined,
      }
      if (contentChanged) setTimelineView({
        sourceRef,
        items: snapshot.items,
        aiPolishNotices: snapshot.aiPolishNotices,
        aiPolishSettings: snapshot.aiPolishSettings,
        nextCursor: snapshot.nextCursor,
        hasMore: snapshot.hasMore,
      })
      if (releasedMomentsChanged && releasedMoments !== undefined) setInterwovenMoments(releasedMoments)
    }
    if (cursor === undefined) {
      setTimelineLoadingSourceRef(current => current === sourceRef ? '' : current)
      setTimelineSkeletonSourceRef(current => current === sourceRef ? '' : current)
      if (!hadCachedTimeline && snapshot.items.length > 0) setTimelineRevealSourceRef(sourceRef)
      await acknowledgeRead(snapshot.items)
    }
  }, [acknowledgeRead, interwovenMoments, source, ui.chatRevision])

  useEffect(() => {
    if (!authStoreSnapshot.checked) void refreshAuth()
  }, [authStoreSnapshot.checked, refreshAuth, ui.authRevision])
  useLayoutEffect(() => {
    timelineGenerationRef.current += 1
    timelineRequestAbortRef.current?.abort()
    timelineRequestAbortRef.current = undefined
    const accountUserId = auth?.status === 'authenticated' ? auth.userId : undefined
    const accountChanged = cacheAccountUserIdRef.current !== accountUserId
    if (!accountChanged && timelineStateSourceRef !== '' && bodyRef.current !== null) {
      conversationCacheRef.current.storeViewport(timelineStateSourceRef, arkmeConversationViewport(bodyRef.current))
    }
    if (accountChanged) {
      conversationCacheRef.current.clear()
      cacheAccountUserIdRef.current = accountUserId
    }
    const sourceRef = authenticated ? source?.sourceRef : undefined
    const cachedTimeline = sourceRef === undefined
      ? undefined
      : conversationCacheRef.current.getTimeline(sourceRef)
    if (sourceRef !== undefined && cachedTimeline !== undefined) {
      pendingViewportRestoreRef.current = {
        sourceRef,
        viewport: conversationCacheRef.current.getViewport(sourceRef),
      }
    } else {
      pendingViewportRestoreRef.current = undefined
    }
    setTimelineView({
      sourceRef: sourceRef ?? '',
      items: cachedTimeline?.items ?? [],
      aiPolishNotices: cachedTimeline?.aiPolishNotices ?? [],
      aiPolishSettings: cachedTimeline?.aiPolishSettings,
      nextCursor: cachedTimeline?.nextCursor,
      hasMore: cachedTimeline?.hasMore ?? false,
    })
    setTimelineLoadingSourceRef(sourceRef !== undefined && cachedTimeline === undefined ? sourceRef : '')
    setTimelineSkeletonSourceRef('')
    setTimelineRevealSourceRef('')
    setNewMessageCount(0)
    setDrawer(undefined); setDetailItemUid(''); setShowOriginal(false)
    if (authenticated) setError('')
    setLongArticleCreating(false); setAddMenuOpen(false)
    interwovenRequestRef.current?.abort()
    interwovenGenerationRef.current += 1
    detailRequestRef.current?.abort()
    detailRequestMomentRef.current = ''
    setInterwovenMoments(sourceRef === undefined
      ? []
      : conversationCacheRef.current.getInterwovenMoments(sourceRef) ?? [])
    setSelectedMoment(undefined)
    setDetailState(undefined)
  }, [authenticated, auth?.userId, source?.sourceRef])
  useEffect(() => {
    if (!authenticated || source === undefined) return
    const generation = timelineGenerationRef.current
    const cachedTimeline = conversationCacheRef.current.getTimeline(source.sourceRef)
    const hasCachedTimeline = cachedTimeline !== undefined
    if (!arkmeShouldRefreshConversationTimeline(cachedTimeline, {
      nowMillis: Date.now(),
      refreshRevision: ui.chatRevision,
      ...(source.latestSequence === undefined ? {} : { latestSequence: source.latestSequence }),
    })) {
      setTimelineLoadingSourceRef(current => current === source.sourceRef ? '' : current)
      setTimelineSkeletonSourceRef(current => current === source.sourceRef ? '' : current)
      void acknowledgeRead(cachedTimeline?.items ?? [])
      return
    }
    void loadTimeline().catch(caught => {
      arkmeChatDirectory.rejectOptimisticRead(source.sourceRef, source.sourceKey, source.latestSequence ?? 0)
      if (generation === timelineGenerationRef.current) {
        setTimelineLoadingSourceRef(current => current === source.sourceRef ? '' : current)
        setTimelineSkeletonSourceRef(current => current === source.sourceRef ? '' : current)
        if (!hasCachedTimeline) setError(errorMessage(caught))
      }
    })
  }, [acknowledgeRead, authenticated, loadTimeline, source, ui.chatRevision])
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
    if (conversationCacheRef.current.isInterwovenFresh(sourceRef, interwovenRefreshRevision)) return
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
      const previous = conversationCacheRef.current.getInterwovenMoments(sourceRef)
      const ready = conversationCacheRef.current.storeInterwovenMoments(sourceRef, moments, interwovenRefreshRevision)
      if (!ready || JSON.stringify(previous) === JSON.stringify(moments)) return
      const body = bodyRef.current
      pendingViewportRestoreRef.current = {
        sourceRef,
        viewport: body === null ? conversationCacheRef.current.getViewport(sourceRef) : arkmeConversationViewport(body),
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
  }, [authenticated, interwovenRefreshRevision, source?.kind, source?.sourceRef])
  const observedInterwovenInvalidationRef = useRef(interwovenInvalidation.revision)
  useEffect(() => {
    if (interwovenInvalidation.revision <= observedInterwovenInvalidationRef.current) return
    observedInterwovenInvalidationRef.current = interwovenInvalidation.revision
    if (!authenticated) return
    const timer = setTimeout(() => { setInterwovenRefreshRevision(value => value + 1) }, 250)
    return () => { clearTimeout(timer) }
  }, [authenticated, interwovenInvalidation.revision])
  useEffect(() => {
    if (!authenticated) return
    const refreshOnFocus = () => { setInterwovenRefreshRevision(value => value + 1) }
    window.addEventListener('focus', refreshOnFocus)
    return () => { window.removeEventListener('focus', refreshOnFocus) }
  }, [authenticated])
  useEffect(() => {
    if (!authenticated || source === undefined) return
    const deltaItems = chatDelta.itemsBySourceRef[source.sourceRef] ?? []
    if (deltaItems.length === 0) return
    const nextItems = mergeItems(items, deltaItems)
    if (JSON.stringify(nextItems) === JSON.stringify(items)) return
    const body = bodyRef.current
    const viewport = body === null ? undefined : arkmeConversationViewport(body)
    pendingViewportRestoreRef.current = { sourceRef: source.sourceRef, viewport }
    const existingIds = new Set(items.map(item => item.itemUid))
    const incomingCount = deltaItems.filter(item => !existingIds.has(item.itemUid)).length
    setItems(nextItems)
    if (viewport?.stickToBottom === false && incomingCount > 0) {
      setNewMessageCount(current => current + incomingCount)
    } else {
      setNewMessageCount(0)
    }
    void acknowledgeRead(deltaItems)
  }, [acknowledgeRead, authenticated, chatDelta, items, source])

  useEffect(() => {
    if (!authenticated || source?.kind !== 'group_chat') return
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
  }, [authenticated, source?.sourceRef])

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
    if (!ownsWechatLogin || loginMode !== 'wechat' || !agreed || auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.poll', { attemptId: auth.attemptId })
        if (stopped) return
        acceptAuthSnapshot(snapshot)
        if (snapshot.status === 'authenticated') { setQr(''); return }
      } catch (caught) { if (!stopped) setError(arkmeLoginErrorMessage(caught, t)) }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 800)
    return () => { stopped = true; clearTimeout(timer) }
  }, [agreed, auth?.attemptId, auth?.status, loginMode, ownsWechatLogin, t])

  const beginWechat = async () => {
    if (!agreed) { setError(t('error.agreement.required')); return }
    setBusy(true); setError('')
    try { const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.begin'); acceptAuthSnapshot(snapshot); setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent)) }
    catch (caught) { setError(arkmeLoginErrorMessage(caught, t)) } finally { setBusy(false) }
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
      setLoginMode(testLoginEnabled ? 'test' : 'wechat')
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
    if (!arkmeShouldBeginWechat(
      auth,
      authView,
      loginMode,
      agreed,
      qr,
      qrRequestStartedRef.current,
      ownsWechatLogin,
    )) return
    qrRequestStartedRef.current = true
    void beginWechat()
  }, [agreed, auth, authView, loginMode, ownsWechatLogin, qr])

  const changeLoginMode = (mode: ArkmeLoginMode) => {
    setLoginMode(mode)
    setError('')
    if (mode !== 'wechat') qrRequestStartedRef.current = false
  }

  const uploadFile = async (file: File, targetDraftKey: string): Promise<ArkmeUploadedAsset> => await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/arkme-self/api/upload')
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    request.setRequestHeader('X-Arkme-File-Name', encodeURIComponent(file.name))
    request.upload.onprogress = event => {
      if (event.lengthComputable) setUploadStatus({ key: targetDraftKey, message: `正在上传 ${file.name} ${String(Math.round(event.loaded / event.total * 100))}%` })
    }
    request.upload.onload = () => { setUploadStatus({ key: targetDraftKey, message: `正在保存 ${file.name}…` }) }
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
    setAddMenuOpen(false); setBusy(true); setError('')
    const uploaded: ArkmeComposerAttachment[] = []
    try {
      for (const file of Array.from(files)) {
        const previewUrl = file.type.toLowerCase().startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : undefined
        try {
          const asset = await uploadFile(file, targetDraftKey)
          uploaded.push({ asset, ...(previewUrl === undefined ? {} : { previewUrl }) })
        } catch (caught) {
          if (previewUrl !== undefined) URL.revokeObjectURL(previewUrl)
          throw caught
        }
      }
      const currentAuth = arkmeAuthStore.getSnapshot().auth
      if (currentAuth?.status === 'authenticated' && currentAuth.userId === targetUserId) {
        arkmeComposerDraftStore.appendAttachments(targetDraftKey, uploaded)
      } else {
        releaseArkmeComposerDraft({ text: '', attachments: uploaded, mentions: [] })
      }
    } catch (caught) {
      releaseArkmeComposerDraft({ text: '', attachments: uploaded, mentions: [] })
      setError(errorMessage(caught))
    }
    finally {
      setUploadStatus(current => current?.key === targetDraftKey ? undefined : current)
      pendingComposerFocusDraftKeyRef.current = targetDraftKey
      setBusy(false)
      if (fileInputRef.current !== null) fileInputRef.current.value = ''
    }
  }

  const send = async () => {
    if (source === undefined || composerDraftKey === undefined) return
    const targetSource = source
    const targetDraftKey = composerDraftKey
    const targetUserId = authenticatedUserId
    if (targetUserId === undefined) return
    const textContent = draft.trim()
    if (textContent === '' && attachments.length === 0) return
    const recordUid = crypto.randomUUID(); const relationUid = crypto.randomUUID(); const now = Date.now()
    const optimisticSenderName = selfProfile?.displayName.trim() || selfProfile?.nickname.trim() || '我'
    const optimisticAvatarRef = selfProfile?.avatarRef.trim()
    const optimistic: ArkmeTimelineItem = {
      itemUid: recordUid, senderName: optimisticSenderName, isMe: true, sendAtMillis: now,
      ...(optimisticAvatarRef === undefined || optimisticAvatarRef === '' ? {} : { avatarRef: optimisticAvatarRef }),
      title: '', textContent, status: 0,
      ...(targetSource.kind === 'group_chat' && aiPolishSettings?.enabled === true
        ? { aiPolish: { state: 'polishing' as const, originalText: textContent } }
        : {}),
      displayKind: 0,
    }
    const pendingDraft = arkmeComposerDraftStore.take(targetDraftKey)
    const pendingAttachments = [...pendingDraft.attachments]
    const pendingAssets = pendingAttachments.map(attachment => attachment.asset)
    pendingViewportRestoreRef.current = { sourceRef: targetSource.sourceRef, viewport: undefined }
    const pendingMentions = pendingDraft.mentions.map(mention => ({
      memberRef: mention.memberRef,
      startIndex: mention.startIndex,
      length: mention.length,
    }))
    setItems(current => mergeItems(current, [optimistic])); setBusy(true); setError('')
    try {
      const result = pendingAssets.length > 0
        ? await callArkme<ArkmeSourceSendResult>('source.send-rich', {
          sourceRef: targetSource.sourceRef, title: '', textContent, displayKind: 0,
          assets: pendingAssets, recordUid, relationUid,
          ...(pendingMentions.length === 0 ? {} : { humanMentions: pendingMentions }),
        })
        : await callArkme<ArkmeSourceSendResult>('source.send-text', {
          sourceRef: targetSource.sourceRef, textContent, recordUid, relationUid,
          ...(pendingMentions.length === 0 ? {} : { humanMentions: pendingMentions }),
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
      if (result.localState !== 'failed' && isArkmeChatDirectorySource(targetSource)
        && result.sequence !== undefined) {
        arkmeChatDirectory.recordSent(targetSource, {
          latestPreview: result.aiPolish?.state === 'polished' && result.aiPolish.polishedText !== undefined
            ? result.aiPolish.polishedText
            : textContent || '非文本内容',
          activeAtMillis: now,
          latestSequence: result.sequence,
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
        arkmeComposerDraftStore.restore(targetDraftKey, pendingDraft)
      } else {
        releaseArkmeComposerDraft(pendingDraft)
      }
      setError(errorMessage(caught))
    } finally {
      pendingComposerFocusDraftKeyRef.current = targetDraftKey
      setBusy(false)
    }
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
  const selfConversationMember = useMemo(
    () => conversationMembers.find(member => member.isSelf),
    [conversationMembers],
  )
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
    setMemberRecords({ member, mode })
  }, [])
  const insertMemberMention = useCallback((member: ArkmeConversationMemberItem) => {
    if (composerDraftKey === undefined || member.isSelf || source?.kind !== 'group_chat') return
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? start
    const cursor = arkmeComposerDraftStore.insertMention(
      composerDraftKey,
      member.memberRef,
      member.displayName,
      start,
      end,
    )
    setMemberMenu(undefined)
    if (cursor === undefined) return
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursor, cursor)
    })
  }, [composerDraftKey, draft.length, source?.kind])
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
    setSelfBreadcrumbTrail(current => appendArkmeSourceBreadcrumbTrail(current, nextSource, selfSourcesRef.current))
    activateSource(nextSource)
  }, [activateSource])
  const activateBreadcrumbSource = useCallback((trailIndex: number, nextSource: ArkmeTimelinePage['source']) => {
    setSelfBreadcrumbTrail(current => truncateArkmeSourceBreadcrumbTrail(current, trailIndex))
    activateSource(nextSource)
  }, [activateSource])
  const activateSendToSelf = useCallback(() => {
    setSelfBreadcrumbTrail([])
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
    setSelfBreadcrumbTrail([])
    arkmeUi.focusSendToSelf()
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
  useLayoutEffect(() => {
    const pending = pendingViewportRestoreRef.current
    const body = bodyRef.current
    if (pending === undefined || body === null || pending.sourceRef !== timelineStateSourceRef) return
    const anchorOffset = arkmeConversationAnchorOffset(body, pending.viewport?.anchorId)
    body.scrollTop = arkmeConversationRestoredScrollTop(pending.viewport, {
      currentScrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
      ...(anchorOffset === undefined ? {} : { anchorOffset }),
    })
    conversationCacheRef.current.storeViewport(pending.sourceRef, arkmeConversationViewport(body))
    pendingViewportRestoreRef.current = undefined
  }, [displayRows, timelineStateSourceRef])
  const handleConversationScroll = useCallback(() => {
    const body = bodyRef.current
    if (body === null || timelineStateSourceRef === '') return
    const viewport = arkmeConversationViewport(body)
    conversationCacheRef.current.storeViewport(timelineStateSourceRef, viewport)
    if (viewport.stickToBottom) setNewMessageCount(0)
  }, [timelineStateSourceRef])
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
  const selfBreadcrumbLabel = isArkmeSelfWorkspaceSource(selectedSource)
    ? arkmeSourceBreadcrumb(selfBreadcrumbTrail, selfSources).map(segment => segment.label).join(' / ')
    : undefined
  const surfaceTitle = ui.mode === 'recordings' ? '全天候录音'
    : ui.mode === 'calls' ? '通话'
    : ui.mode === 'world' ? '世界'
    : ui.mode === 'search' ? '搜索'
    : ui.mode === 'extensions' ? '市集'
    : ui.mode === 'voiceprint' ? '声纹管理'
    : ui.mode === 'arko' ? 'Arko'
    : conversationBackdropVisible ? selfBreadcrumbLabel ?? arkmeSourceDestinationLabel(selectedSource)
    : 'Arkme'
  const arkoContentVisible = authView === 'content' && ui.mode === 'arko'
  const utilityContentVisible = authView === 'content'
    && (ui.mode === 'recordings' || ui.mode === 'world' || ui.mode === 'search' || ui.mode === 'extensions'
      || ui.mode === 'voiceprint' || ui.mode === 'calls')

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
        {authView !== 'login' && !arkoContentVisible && !utilityContentVisible && <header className="arkme-conversation-header" style={styles.header}>
          {authenticated && conversationBackdropVisible && source?.kind === 'group_chat' && <span style={styles.headerAvatar}>
            <ArkmeSourceAvatar
              size={34}
              {...(source.avatarRef === undefined ? {} : { avatarRef: source.avatarRef })}
              {...(source.avatarRefs === undefined ? {} : { avatarRefs: source.avatarRefs })}
              {...(source.groupAvatar === undefined ? {} : { groupAvatar: source.groupAvatar })}
            />
          </span>}
          {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
            && auth?.userId !== undefined && <ArkmeTopicDirectoryPopover
              key={auth.userId}
              userId={auth.userId}
              selectedSource={selectedSource}
              onSelect={activateSelfSource}
              onSelectionInvalidated={invalidateTopicSelection}
              onSelfSourcesResolution={acceptSelfSourcesResolution}
              retryRevision={selfSourcesRetryRevision}
            />}
          <div style={styles.titleGroup}>
            {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
              ? <ArkmeSourceBreadcrumb
                trail={selfBreadcrumbTrail}
                sources={selfSources}
                onSelect={activateBreadcrumbSource}
                onSelectAggregate={activateSendToSelf}
              />
              : <div style={styles.titleBlock}>
                <span style={styles.titleLine}>
                  <h2 style={styles.title}>{surfaceTitle}</h2>
                  {source?.isMuted === true && <span style={styles.titleMuteIcon}><ArkmeMuteIcon size={16} /></span>}
                </span>
                {authenticated && conversationBackdropVisible && source?.kind === 'group_chat'
                  && aiPolishSettings?.enabled === true
                  && <span style={styles.headerSubtitle}>AI润色已开启</span>}
              </div>}
            {authenticated && conversationBackdropVisible && isArkmeSelfWorkspaceSource(selectedSource)
              && source?.isMuted === true && <span style={styles.titleMuteIcon}><ArkmeMuteIcon size={16} /></span>}
          </div>
          {authenticated && conversationBackdropVisible && source?.kind === 'private_chat' && <ArkmePrivateCallMenu
            sourceRef={source.sourceRef}
            displayName={source.displayName}
            assetBasePath={authStoreSnapshot.config?.callAssetBasePath ?? '/arkme-self/api/call'}
          />}
          {authenticated && conversationBackdropVisible && source?.kind === 'group_chat' && <ArkmeGroupChatControls
            source={source}
            overlayHostRef={panelRef}
            onSourceActivated={activateSource}
            onMemberOpen={openMemberProfile}
            onMemberContextMenu={openMemberMenu}
            onError={setError}
          />}
          {shouldShowPrivateChatActions(authenticated, source?.kind) && <div ref={relatedMenuRef} style={{
            ...styles.headerActions,
            width: 36,
            visibility: relatedPanelOpen ? 'hidden' : 'visible',
          }}>
            <button type="button" style={styles.moreButton} aria-label="更多私聊操作" aria-haspopup="menu" aria-expanded={relatedMenuOpen}
              onClick={toggleRelatedMenu}>•••</button>
            {relatedMenuOpen && <div style={styles.popover} role="menu" aria-busy={relatedEligibility === 'loading'}>
              {shouldShowRelatedRecordingsEntry(authenticated, source?.kind, relatedEligibility, relatedPanelOpen)
                ? <button type="button" role="menuitem" style={styles.menuItem} onClick={openRelatedPanel}>
                  <span aria-hidden>◉</span><span>相关录音</span>
                </button>
                : relatedEligibility === 'error'
                  ? <button type="button" role="menuitem" style={styles.menuItem} onClick={ensureRelatedEligibility}>重新检查相关录音</button>
                  : <div role="status" style={styles.menuStatus}>
                    {relatedEligibility === 'denied' ? '当前没有可用操作' : '正在检查相关录音…'}
                  </div>}
            </div>}
          </div>}
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
        /></div> : ui.mode === 'calls' ? <ArkmeCallSurface />
          : ui.mode === 'recordings' ? <ArkmeRecordingSurface />
          : ui.mode === 'world' ? <ArkmeWorldSurface
            {...(ui.worldTarget === undefined ? {} : { target: ui.worldTarget })}
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
            onShareExit={() => { arkmeUi.dismissExtensionShare() }}
            onPrivateChatOpened={activateSource}
          />
          : ui.mode === 'voiceprint' ? <ArkmeVoiceprintSurface />
          : ui.mode === 'arko' ? <ArkmeArkoSurface key={arkmeArkoSurfaceKey(auth)} />
          : source === undefined ? <div className="arkme-conversation-body" style={styles.body}>
            {activeSelfSourcesResolution?.status === 'error'
              ? <div role="alert" style={styles.loading}>
                <div style={styles.error}>{activeSelfSourcesResolution.message}</div>
                <button type="button" style={{ ...styles.retry, marginTop: 8, fontSize: 12 }}
                  onClick={() => { setSelfSourcesRetryRevision(value => value + 1) }}>重试</button>
              </div>
              : <div role="status" style={styles.loading}>正在加载发给自己的内容…</div>}
          </div> : <>
          <div className="arkme-conversation-body" ref={bodyRef} style={styles.body} onScroll={handleConversationScroll}>
            {error !== '' && <div style={styles.error}>{error}</div>}
            <div ref={sentinelRef} style={styles.sentinel} />
            {loadingOlder && <div style={styles.loading}>正在加载更早内容…</div>}
            {timelineSkeletonSourceRef === source.sourceRef && displayRows.length === 0 && <div
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
            {displayRows.length > 0 && <ul className={`arkme-conversation-records${timelineRevealSourceRef === source.sourceRef
              ? ' arkme-conversation-records-reveal'
              : ''}`} style={styles.records}>
              {displayRows.map((row, index) => {
                const previous = index === 0 ? undefined : displayRows[index - 1]
                const startsDay = previous === undefined
                  || dayKey(previous.occurredAtMillis) !== dayKey(row.occurredAtMillis)
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
                const avatarRef = arkmeTimelineAvatarRef(item, selfProfile)
                const messageMember = item.memberRef === undefined
                  ? (item.isMe ? selfConversationMember : undefined)
                  : conversationMemberByRef.get(item.memberRef)
                const polishStatus = aiPolishStatus(item)
                return <Fragment key={row.id}>
                  {startsDay && <li style={styles.date}>{dayLabel(item.sendAtMillis)}</li>}
                  <li data-arkme-conversation-row={row.id} style={{ ...styles.row, ...(item.isMe ? styles.rowMe : styles.rowOther) }}>
                    <div style={{
                      ...styles.messageLine,
                      ...(item.isMe ? styles.messageLineMe : {}),
                      ...(item.forwardRecords === undefined ? {} : styles.forwardMessageLine),
                    }}>
                      {showMessageAvatars && <MessageAvatar
                        {...(avatarRef === undefined ? {} : { avatarRef })}
                        {...(messageMember === undefined ? {} : { member: messageMember })}
                        profileEnabled={source?.kind === 'group_chat'}
                        onOpen={openMemberProfile}
                        onContextMenu={openMemberMenu}
                      />}
                      <div style={{
                        ...styles.messageBody,
                        ...(item.isMe ? styles.messageBodyMe : {}),
                        ...(item.forwardRecords === undefined ? {} : styles.forwardMessageBody),
                      }}>
                        <ArkmeTimelineMessageHeader item={item} {...(selfProfile === undefined ? {} : { profile: selfProfile })} />
                        <div
                          role="button"
                          tabIndex={0}
                          style={{
                            ...styles.bubble,
                            ...(item.isMe ? styles.bubbleMe : styles.bubbleOther),
                            ...(item.forwardRecords === undefined ? {} : styles.forwardBubble),
                          }}
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
                        />
                          <ArkmeTimelineAgentSourceBadge item={item} />
                        </div>
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
          <footer className="arkme-conversation-composer" style={styles.composer}><div ref={composerRef} className="arkme-conversation-composer-inner" style={styles.composerInner}>
            {addMenuOpen && <div ref={addMenuRef} style={styles.addMenu} role="menu">
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }}><span aria-hidden>📎</span>添加照片和文件</button>
              <div style={styles.menuDivider} />
              <button type="button" role="menuitem" style={styles.addMenuItem} onClick={() => { setLongArticleCreating(true); setAddMenuOpen(false) }}><span aria-hidden>✎</span>写长文</button>
            </div>}
            <input ref={fileInputRef} type="file" multiple hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" onChange={event => { void selectFiles(event.currentTarget.files) }} />
            {attachments.length > 0 && <div style={styles.attachments}>{attachments.map(attachment => <ArkmeAttachmentDraftTile
              key={attachment.asset.fileAssetUid}
              asset={attachment.asset}
              {...(attachment.previewUrl === undefined ? {} : { previewUrl: attachment.previewUrl })}
              onRemove={() => {
                arkmeComposerDraftStore.removeAttachment(composerDraftKey, attachment.asset.fileAssetUid)
              }}
            />)}</div>}
            {uploadStatus !== undefined && uploadStatus.key === composerDraftKey
              && <div style={styles.uploadStatus} role="status">{uploadStatus.message}</div>}
            <ArkmeMentionTextarea className="arkme-conversation-textarea" ref={textareaRef} rows={1} style={styles.textarea!} value={draft} mentions={composerDraft.mentions} maxLength={20000} placeholder={arkmeSourceComposerPlaceholder(selectedSource)} aria-label={arkmeSourceComposerPlaceholder(selectedSource)} disabled={busy}
              onChange={event => { arkmeComposerDraftStore.setText(composerDraftKey, event.target.value) }}
              onPaste={event => {
                const imageFiles = arkmeClipboardImageFiles(event.clipboardData)
                if (imageFiles.length === 0) return
                event.preventDefault()
                void selectFiles(imageFiles)
              }}
              onKeyDown={event => {
                if (!event.nativeEvent.isComposing && (event.key === 'Backspace' || event.key === 'Delete')) {
                  const caret = arkmeComposerDraftStore.deleteMentionAtSelection(
                    composerDraftKey,
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
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
            <div style={styles.tools}><button ref={addMenuTriggerRef} type="button" style={styles.plus} aria-label="添加内容" aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen(value => !value) }}>+</button><button
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
            </button></div>
          </div></footer>
        </>}
        {source !== undefined && memberMenu !== undefined && <ArkmeMemberActionMenu
          member={memberMenu.member}
          sourceKind={source.kind}
          position={memberMenu.position}
          onMention={() => { insertMemberMention(memberMenu.member) }}
          onRecords={mode => { openMemberRecords(memberMenu.member, mode) }}
          onClose={closeMemberMenu}
        />}
        {memberProfile !== undefined && <ArkmeMemberProfileCard
          member={memberProfile}
          busy={privateChatBusy}
          onClose={() => { if (!privateChatBusy) setMemberProfile(undefined) }}
          onSend={() => { openPrivateChatForMember(memberProfile) }}
        />}
        {source !== undefined && memberRecords !== undefined && <ArkmeMemberRecordsPanel
          sourceRef={source.sourceRef}
          member={memberRecords.member}
          mode={memberRecords.mode}
          onClose={() => { setMemberRecords(undefined) }}
        />}
        {drawer === 'detail' && detailItem?.forwardRecords !== undefined && <>
          <div
            style={styles.forwardDrawerDismiss}
            aria-hidden="true"
            onClick={() => { setDrawer(undefined) }}
          />
          <ForwardRecordsDetail
            item={detailItem}
            onClose={() => { setDrawer(undefined) }}
          />
        </>}
        {drawer === 'detail' && detailItem !== undefined && detailItem.forwardRecords === undefined && <aside style={styles.drawer} aria-label="快记详情">
          <header style={styles.drawerHeader}>
            <h3 style={styles.drawerTitle}>快记详情</h3>
            <button type="button" style={styles.close} aria-label="关闭详情" onClick={() => { setDrawer(undefined) }}>×</button>
          </header>
          <div style={styles.drawerBody}>
            <div style={{ color: colors.secondary, fontSize: 12, marginBottom: 16 }}>
              {arkmeTimelineDetailSenderText(detailItem)} · {new Date(detailItem.sendAtMillis).toLocaleString('zh-CN')}
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
                shareWebsite={authStoreSnapshot.config?.shareWebsite ?? ARKME_DEFAULT_SHARE_WEBSITE}
                onSourceActivated={activateSource}
              />
            </div>
          </section>
        </div>}
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
            pendingViewportRestoreRef.current = { sourceRef: source.sourceRef, viewport: undefined }
            setItems(current => mergeItems(current, [item]))
          }}
        />,
        document.body,
      )}
    </div>
  )
}
