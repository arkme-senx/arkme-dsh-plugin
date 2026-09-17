import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeCallDetailContent } from './ArkmeCallDetailContent.js'
import { CallAvatar, cleanAvatarRef, formatDuration, sampleAvatarUrl } from './call-detail-presentation.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Link } from '@phosphor-icons/react/dist/icons/Link'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { ArkmeCallInviteDialog } from './ArkmeCallInviteDialog.js'
import { useResizableCallBrowser } from './use-resizable-call-browser.js'
import type {
  ArkmeCallDetail,
  ArkmeCallHistoryItem,
  ArkmeCallHistoryPage,
  ArkmeCallMediaType,
  ArkmeCallRecentContact,
  ArkmeContactSearchResult,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeSourceList,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { arkmeTheme } from './arkme-theme.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { useCallTour } from './ArkmeCallTour.js'
import { callHistoryIdentity, refreshCallHistory } from './call-history-refresh.js'

interface CallTarget {
  key: string
  displayName: string
  relation: string
  sample?: boolean | undefined
  avatarRef?: string | undefined
  peerUserId?: number | undefined
  contactRef?: string | undefined
  contactCanOpen?: boolean | undefined
  source?: ArkmeSourceItem
  officialAuthor?: boolean | undefined
  identityKey?: string | undefined
}

export interface ArkmeCallSurfaceProps {
  active?: boolean
  initialPickerOpen?: boolean
  presentation?: 'page' | 'dialog'
  onClose?: () => void
}

type TypePickerPlacement =
  | { kind: 'center' }
  | { kind: 'anchored'; left: number; top: number }

const CALL_SURFACE_AVATAR_PRELOAD_LIMIT = 40
const CALL_HISTORY_SETTLED_REFRESH_DELAY_MS = 2_400
const OFFICIAL_AUTHOR_DISPLAY_NAME = '即' + '我作者'
const OFFICIAL_AUTHOR_RECOMMENDATION_LABEL = OFFICIAL_AUTHOR_DISPLAY_NAME + ' · 推荐'
const CONTACT_SEARCH_PLACEHOLDER = '输入' + '即' + '我号或昵称'
const CONTACT_SEARCH_DEBOUNCE_MS = 280

function sampleCallMillis(daysAgo: number, hour: number, minute: number): number {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

const SAMPLE_VIDEO_STARTED_AT = sampleCallMillis(0, 14, 26)
const SAMPLE_AUDIO_STARTED_AT = sampleCallMillis(1, 16, 27)

const SAMPLE_CALLS: readonly ArkmeCallHistoryItem[] = [
  {
    callRef: 'sample-video',
    stableId: 'sample-video',
    peerDisplayName: '林小满',
    mediaType: 'video',
    startedAtMillis: SAMPLE_VIDEO_STARTED_AT,
    acceptedAtMillis: SAMPLE_VIDEO_STARTED_AT,
    endedAtMillis: SAMPLE_VIDEO_STARTED_AT + 22 * 60 * 1000 + 14 * 1000,
    durationSeconds: 22 * 60 + 14,
    callResult: 'sample',
    resultLabel: '14:26',
    summaryStatus: 'done',
    summaryPreview: '确认了发布会演示顺序；制造业案例数据在彩排前补齐。',
    canOpenDetail: false,
    canRedial: false,
  },
  {
    callRef: 'sample-audio',
    stableId: 'sample-audio',
    peerDisplayName: '妈妈',
    mediaType: 'audio',
    startedAtMillis: SAMPLE_AUDIO_STARTED_AT,
    acceptedAtMillis: SAMPLE_AUDIO_STARTED_AT,
    endedAtMillis: SAMPLE_AUDIO_STARTED_AT + 8 * 60 * 1000 + 47 * 1000,
    durationSeconds: 8 * 60 + 47,
    callResult: 'sample',
    resultLabel: '昨天 16:27',
    summaryStatus: 'done',
    summaryPreview: '确认了周末见面的时间和需要准备的物品。',
    canOpenDetail: false,
    canRedial: false,
  },
]

const SAMPLE_CONTACTS: readonly ArkmeCallRecentContact[] = [
  { userId: 2, displayName: '林小满' },
  { userId: 4, displayName: '妈妈' },
]

function sampleDetailForCall(callRef: string): ArkmeCallDetail | undefined {
  if (callRef === 'sample-video') return {
    callRef: 'sample-video',
    title: '林小满',
    mediaType: 'video',
    startedAtMillis: SAMPLE_VIDEO_STARTED_AT,
    acceptedAtMillis: SAMPLE_VIDEO_STARTED_AT,
    endedAtMillis: SAMPLE_VIDEO_STARTED_AT + 22 * 60 * 1000 + 14 * 1000,
    durationSeconds: 22 * 60 + 14,
    callResult: 'sample',
    resultLabel: '功能示例',
    summaryStatus: 'done',
    summaryText: '确认了发布会演示顺序；制造业案例数据在彩排前补齐。',
    transcriptPending: false,
    transcriptFailed: false,
    videoRecord: { available: true, source: 'sample' },
    participants: [
      { userId: 101, displayName: '林小满' },
      { userId: 0, displayName: '你', isCurrentUser: true },
    ],
    transcriptSegments: [
      {
        segmentId: 'sample-video-1',
        audioUrl: '/arkme-self/api/call/call-demo-utterance-v1.m4a',
        speakerDisplayName: '林小满',
        speakerUserId: 101,
        text: '主画面已经比较稳了，我建议把 Arkme 找到结论的过程放到最前面。',
        startMillis: 3 * 60 * 1000,
        endMillis: 3 * 60 * 1000 + 8 * 1000,
      },
      {
        segmentId: 'sample-video-2',
        speakerDisplayName: '你',
        speakerUserId: 0,
        text: '可以，先让大家看到信息怎么被连接，再直接创建后续任务。',
        startMillis: 5 * 60 * 1000,
        endMillis: 5 * 60 * 1000 + 7 * 1000,
      },
      {
        segmentId: 'sample-video-3',
        speakerDisplayName: '林小满',
        speakerUserId: 101,
        text: '制造业案例的数据我今晚补齐，彩排前再一起过一遍。',
        startMillis: 10 * 60 * 1000,
        endMillis: 10 * 60 * 1000 + 6 * 1000,
      },
    ],
  }
  if (callRef === 'sample-audio') return {
    callRef: 'sample-audio',
    title: '妈妈',
    mediaType: 'audio',
    startedAtMillis: SAMPLE_AUDIO_STARTED_AT,
    acceptedAtMillis: SAMPLE_AUDIO_STARTED_AT,
    endedAtMillis: SAMPLE_AUDIO_STARTED_AT + 8 * 60 * 1000 + 47 * 1000,
    durationSeconds: 8 * 60 + 47,
    callResult: 'sample',
    resultLabel: '功能示例',
    summaryStatus: 'done',
    summaryText: '确认了周末见面的时间和需要准备的物品。',
    transcriptPending: false,
    transcriptFailed: false,
    participants: [
      { userId: 102, displayName: '妈妈' },
      { userId: 0, displayName: '你', isCurrentUser: true },
    ],
    transcriptSegments: [
      {
        segmentId: 'sample-audio-1',
        speakerDisplayName: '妈妈',
        speakerUserId: 102,
        text: '周六上午十点过来就好，路上不用太赶。',
        startMillis: 60 * 1000,
        endMillis: 67 * 1000,
      },
      {
        segmentId: 'sample-audio-2',
        speakerDisplayName: '你',
        speakerUserId: 0,
        text: '好，我把上次借的书也一起带过去。',
        startMillis: 3 * 60 * 1000,
        endMillis: 3 * 60 * 1000 + 6 * 1000,
      },
    ],
  }
  return undefined
}

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0, position: 'relative',
    display: 'grid', background: arkmeTheme.base, color: arkmeTheme.text,
  },
  browser: {
    minWidth: 0, minHeight: 0, padding: '30px 15px 17px', display: 'flex', flexDirection: 'column',
    background: arkmeTheme.base, boxSizing: 'border-box',
  },
  heading: { padding: '0 1px 0 2px' },
  title: { margin: 0, fontSize: 22, lineHeight: '28px', fontWeight: 650, letterSpacing: '-0.02em' },
  subtitle: { margin: '8px 0 0', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px', fontWeight: 500 },
  startWide: {
    width: '100%', height: 42, margin: '18px 0 24px', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 8, border: 0, borderRadius: 11, background: arkmeTheme.primaryAction,
    color: arkmeTheme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 650,
  },
  sectionLabel: { margin: '0 0 11px 2px', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '17px', fontWeight: 650 },
  contacts: { height: 56, margin: '0 0 13px', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 },
  contact: {
    minWidth: 0, width: '100%', maxWidth: 64, height: 56, justifySelf: 'center', boxSizing: 'border-box',
    display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 4,
    padding: '4px 6px', border: 0, borderRadius: 12, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit',
  },
  contactName: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, lineHeight: '14px' },
  search: {
    height: 42, flex: 'none', margin: '0 0 13px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 9,
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, color: arkmeTheme.tertiary, background: arkmeTheme.input, boxSizing: 'border-box',
  },
  searchInput: { minWidth: 0, flex: 1, border: 0, outline: 0, padding: 0, background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 13 },
  list: { minHeight: 0, flex: 1, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' },
  callRow: {
    width: '100%', minHeight: 64, display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) auto',
    alignItems: 'center', columnGap: 10, rowGap: 4, padding: '8px 8px', border: 0, borderRadius: 13,
    background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  callRowSelected: { background: arkmeTheme.active },
  callNameLine: { gridColumn: 2, gridRow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  callName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  sampleBadge: { height: 17, padding: '0 5px', borderRadius: 5, background: arkmeTheme.layer2, color: arkmeTheme.tertiary, fontSize: 10, lineHeight: '17px' },
  callMeta: { gridColumn: '2 / -1', gridRow: 2, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '16px' },
  callTime: { gridColumn: 3, gridRow: 1, color: arkmeTheme.tertiary, fontSize: 11, whiteSpace: 'nowrap' },
  callSummary: {
    gridColumn: '2 / -1', minWidth: 0, padding: '6px 8px', marginTop: 4, borderRadius: 8,
    background: `color-mix(in srgb, ${arkmeTheme.text} 4%, transparent)`,
    border: `1px solid ${arkmeTheme.borderSoft}`, color: arkmeTheme.secondary, fontSize: 12, lineHeight: '17px',
  },
  callSummaryText: { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden', overflowWrap: 'anywhere', whiteSpace: 'pre-line' },
  status: { padding: '18px 6px', color: arkmeTheme.tertiary, fontSize: 12, textAlign: 'center', lineHeight: '18px' },
  content: { minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: arkmeTheme.base },
  empty: {
    flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 32, boxSizing: 'border-box',
    textAlign: 'center', color: arkmeTheme.secondary,
  },
  emptyInner: { transform: 'translateY(-10px)', display: 'grid', justifyItems: 'center', gap: 9 },
  emptyIcon: { color: arkmeTheme.tertiary },
  emptyTitle: { margin: 0, color: arkmeTheme.text, fontSize: 17, lineHeight: '24px', fontWeight: 650 },
  emptyCopy: { margin: 0, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  startCenter: {
    height: 37, marginTop: 10, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8,
    border: 0, borderRadius: 10, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer',
    font: 'inherit', fontSize: 12, fontWeight: 650,
  },
  detailHeader: {
    minHeight: 68, flex: 'none', padding: '12px 22px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between',
    borderBottom: `1px solid ${arkmeTheme.borderSoft}`, boxSizing: 'border-box',
  },
  detailIdentity: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 },
  detailTitleBlock: { minWidth: 0, display: 'grid', gap: 3 },
  detailTitle: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 16, lineHeight: '22px', fontWeight: 650 },
  detailSub: { margin: 0, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '17px' },
  detailActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 },
  privateChatButton: {
    height: 36, padding: '0 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.elevated,
    color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12, whiteSpace: 'nowrap',
  },
  iconButton: {
    width: 36, height: 36, display: 'grid', placeItems: 'center', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 10, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer',
  },
  iconButtonPrimary: { borderColor: arkmeTheme.primaryAction, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  notice: { position: 'absolute', left: 24, right: 24, bottom: 18, color: arkmeTheme.tertiary, fontSize: 12, textAlign: 'center' },
  layer: {
    position: 'absolute', inset: 0, zIndex: 9, display: 'grid', placeItems: 'center', padding: 24,
    background: 'var(--dsw-alias-bg-mask-1, rgba(5, 8, 13, .58))', backdropFilter: 'blur(2px)', boxSizing: 'border-box',
  },
  picker: {
    width: 360, maxWidth: 'calc(100vw - 48px)', height: 'min(620px, calc(100vh - 48px))',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    padding: 16, border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 18, background: `color-mix(in srgb, ${arkmeTheme.base} 97%, ${arkmeTheme.text})`, boxShadow: arkmeTheme.shadow,
    boxSizing: 'border-box',
  },
  pickerHeader: { height: 34, flex: 'none', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pickerTitle: { margin: 0, color: arkmeTheme.text, fontSize: 15, lineHeight: '21px', fontWeight: 650 },
  closeButton: {
    width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9,
    background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer',
  },
  pickerSearch: {
    height: 40, minHeight: 40, flex: 'none', margin: '0 0 12px', padding: '0 12px',
    display: 'flex', alignItems: 'center', gap: 8,
    border: `1px solid var(--arkme-call-search-border, ${arkmeTheme.border})`, borderRadius: 10,
    color: arkmeTheme.secondary, background: arkmeTheme.base, boxSizing: 'border-box', cursor: 'text',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
  },
  pickerInput: { minWidth: 0, flex: 1, height: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 13 },
  pickerInvite: {
    flex: 'none', gridTemplateColumns: '28px minmax(0, 1fr) 16px', marginBottom: 12, padding: '12px 10px',
    background: `color-mix(in srgb, ${arkmeTheme.accent} 8%, ${arkmeTheme.base})`,
  },
  pickerContacts: { minHeight: 0, flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin' },
  recommendation: {
    minHeight: 58, marginBottom: 12, padding: '9px 10px', display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto',
    alignItems: 'center', gap: 9, borderRadius: 13, background: 'transparent', boxSizing: 'border-box',
  },
  pickerText: { minWidth: 0, display: 'grid', gap: 3 },
  pickerNameLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  pickerName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.text, fontSize: 13, lineHeight: '18px', fontWeight: 650 },
  pickerSub: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '15px' },
  pickerActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 6 },
  pickerRound: {
    width: 32, height: 32, display: 'grid', placeItems: 'center', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 10, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer',
  },
  pickerRoundDisabled: { cursor: 'default', opacity: .45 },
  pickerList: { minHeight: 0, overflowY: 'visible', display: 'grid', gap: 3 },
  pickerRowFrame: {
    minHeight: 56, width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center', gap: 6, borderRadius: 12, background: 'transparent',
  },
  pickerRow: {
    minHeight: 56, width: '100%', padding: '8px 8px', display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)',
    alignItems: 'center', gap: 9, border: 0, borderRadius: 12, background: 'transparent',
    color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  pickerRowDisabled: { cursor: 'default', opacity: .58 },
  pickerEmpty: { padding: '24px 12px 20px', display: 'grid', justifyItems: 'center', gap: 7, color: arkmeTheme.tertiary, textAlign: 'center', fontSize: 12, lineHeight: '18px' },
  typePicker: {
    width: 320, maxWidth: 'calc(100vw - 48px)', padding: 13, border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 18, background: arkmeTheme.menu, boxShadow: arkmeTheme.shadow,
    boxSizing: 'border-box',
  },
  typeLayer: {
    position: 'fixed', inset: 0, zIndex: 10020, padding: 12, boxSizing: 'border-box',
    background: 'transparent',
  },
  typeHeader: { minHeight: 50, display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) 30px', alignItems: 'center', gap: 9 },
  typeOption: {
    width: '100%', minHeight: 54, marginTop: 6, padding: '8px 10px', display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'center', gap: 10, border: 0,
    borderRadius: 13, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  typeOptionDisabled: { cursor: 'default', opacity: .58 },
  typeIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 11, background: arkmeTheme.input, color: arkmeTheme.secondary },
  unavailable: { margin: '8px 3px 2px', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
}

function shortTime(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return ''
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return tr("今天 {v0}", { v0: date.toLocaleTimeString(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }) })
  }
  return date.toLocaleDateString(arkmeIntlLocale(), { month: '2-digit', day: '2-digit' })
}

function mediaLabel(type: ArkmeCallMediaType): string {
  if (type === 'video') return tr("视频通话")
  if (type === 'audio') return tr("语音通话")
  return tr("通话")
}

function readableError(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function sourceMatchesCall(source: ArkmeSourceItem, call: Pick<ArkmeCallHistoryItem, 'peerDisplayName' | 'peerUserId'>): boolean {
  if (call.peerUserId !== undefined) return source.peerUserId === call.peerUserId
  return source.kind === 'private_chat' && source.displayName.trim() !== ''
    && source.displayName.trim() === call.peerDisplayName.trim()
}

function callKey(item: ArkmeCallHistoryItem): string {
  return callHistoryIdentity(item)
}

function CallVideoIcon({ size = 16, style }: { size?: number; style?: CSSProperties }) {
  return <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
    fill="none"
    style={{ width: size, height: size, display: 'block', color: 'currentColor', ...style }}
    data-arkme-call-video-icon="compact"
  >
    <path
      d="M12.53 20.42H6.21C3.05 20.42 2 18.32 2 16.21V7.79C2 4.63 3.05 3.58 6.21 3.58H12.53C15.69 3.58 16.74 4.63 16.74 7.79V16.21C16.74 19.37 15.68 20.42 12.53 20.42Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19.52 17.1L16.74 15.15V8.84L19.52 6.89C20.88 5.94 22 6.52 22 8.19V15.81C22 17.48 20.88 18.06 19.52 17.1Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.5 11C12.33 11 13 10.33 13 9.5C13 8.67 12.33 8 11.5 8C10.67 8 10 8.67 10 9.5C10 10.33 10.67 11 11.5 11Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
}

function detailSubtitle(item: ArkmeCallHistoryItem): string {
  if (item.callRef === 'sample-video') return '呼入 · 视频通话 · 今天 14:26 · 22:14'
  if (item.callRef === 'sample-audio') return '呼出 · 语音通话 · 昨天 16:27 · 08:47'
  return `${mediaLabel(item.mediaType)} · ${formatDuration(item.durationSeconds)}`
}

async function preloadCallSurfaceAvatars(refs: readonly (string | undefined)[]): Promise<void> {
  const unique = new Set<string>()
  for (const ref of refs) {
    const normalized = cleanAvatarRef(ref)
    if (normalized !== undefined) unique.add(normalized)
    if (unique.size >= CALL_SURFACE_AVATAR_PRELOAD_LIMIT) break
  }
  await Promise.allSettled([...unique].map(async ref => await arkmeAvatarImages.load(ref)))
}

async function preloadHistoryAvatars(page: ArkmeCallHistoryPage): Promise<void> {
  await preloadCallSurfaceAvatars([
    ...(page.recentContacts ?? []).map(contact => contact.avatarRef),
    ...page.items.map(item => item.peerAvatarRef),
  ])
}

async function preloadSourceAvatars(sources: readonly ArkmeSourceItem[]): Promise<void> {
  await preloadCallSurfaceAvatars(sources.map(source => source.avatarRef))
}

function targetForSource(source: ArkmeSourceItem): CallTarget {
  const peerUserId = Number.isSafeInteger(source.peerUserId) && source.peerUserId !== undefined && source.peerUserId > 0
    ? source.peerUserId
    : undefined
  return {
    key: source.sourceRef,
    displayName: source.displayName,
    relation: '私聊联系人',
    ...(cleanAvatarRef(source.avatarRef) === undefined ? {} : { avatarRef: cleanAvatarRef(source.avatarRef) }),
    ...(peerUserId === undefined ? {} : { peerUserId, identityKey: userIdentityKey(peerUserId) }),
    source,
  }
}

function targetForContact(contact: ArkmeCallRecentContact, options: { relation?: string; usingSampleContacts: boolean }): CallTarget {
  const name = contact.displayName.trim()
  const peerUserId = !options.usingSampleContacts && Number.isSafeInteger(contact.userId) && contact.userId > 0
    ? contact.userId
    : undefined
  return {
    key: `recent:${String(contact.userId ?? name)}:${name}`,
    displayName: name,
    relation: options.relation ?? '最近联系人',
    ...(options.usingSampleContacts ? { sample: true } : {}),
    ...(cleanAvatarRef(contact.avatarRef) === undefined ? {} : { avatarRef: cleanAvatarRef(contact.avatarRef) }),
    ...(peerUserId === undefined ? {} : { peerUserId, identityKey: userIdentityKey(peerUserId) }),
  }
}

function officialAuthorTarget(profile?: ArkmeOfficialAuthorProfile): CallTarget {
  const displayName = profile?.displayName.trim() || OFFICIAL_AUTHOR_DISPLAY_NAME
  const avatarRef = cleanAvatarRef(profile?.avatarRef)
  const peerUserId = profile?.userId
  return {
    key: 'official-author',
    displayName,
    relation: OFFICIAL_AUTHOR_RECOMMENDATION_LABEL,
    ...(avatarRef === undefined ? {} : { avatarRef }),
    ...(peerUserId === undefined ? {} : { peerUserId, identityKey: userIdentityKey(peerUserId) }),
    officialAuthor: true,
  }
}

function shouldSearchContactIdentifier(value: string): boolean {
  const trimmed = value.trim().replace(/^@/, '')
  if (trimmed.length < 2 || trimmed.length > 64) return false
  const compactPhone = trimmed.replace(/[\s()-]/g, '').replace(/^\+86/, '')
  return /^\d+$/.test(compactPhone)
    ? compactPhone.length >= 5
    : /^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(trimmed)
}

function targetForContactSearch(result: ArkmeContactSearchResult): CallTarget {
  const arkmeId = result.arkmeId?.trim() ?? ''
  const canOpen = result.registered && !result.isSelf
  const relation = result.isSelf
    ? '这是你自己'
    : !result.registered
      ? '即我号未注册'
      : canOpen
        ? '即我号 · 可发起通话'
        : '该账号当前无法直接呼叫'
  return {
    key: `contact-search:${result.contactRef}`,
    displayName: result.displayName.trim() || arkmeId || 'Arkme 用户',
    relation,
    ...(cleanAvatarRef(result.avatarRef) === undefined ? {} : { avatarRef: cleanAvatarRef(result.avatarRef) }),
    ...(canOpen ? { contactRef: result.contactRef, contactCanOpen: true } : { contactCanOpen: false }),
    ...(arkmeId === '' ? {} : { identityKey: `arkme-id:${arkmeId.toLowerCase()}` }),
  }
}

function userIdentityKey(userId: number | undefined): string | undefined {
  return Number.isSafeInteger(userId) && userId !== undefined && userId > 0 ? `user:${String(userId)}` : undefined
}

function targetIdentityKey(target: CallTarget): string {
  return target.identityKey
    ?? userIdentityKey(target.peerUserId)
    ?? (target.source?.sourceKey === undefined ? undefined : `source-key:${target.source.sourceKey}`)
    ?? (target.source?.sourceRef === undefined ? undefined : `source-ref:${target.source.sourceRef}`)
    ?? `name:${target.displayName.trim().toLowerCase()}`
}

function targetCanResolve(target: CallTarget): boolean {
  return target.officialAuthor === true
    || target.source !== undefined
    || (target.contactRef !== undefined && target.contactCanOpen === true)
    || (target.peerUserId !== undefined && Number.isSafeInteger(target.peerUserId) && target.peerUserId > 0)
}

function targetSubtitle(target: CallTarget): string {
  if (!targetCanResolve(target)) return target.contactRef !== undefined || target.contactCanOpen === false
    ? target.relation
    : tr("{v0} · 需先拥有私聊会话", { v0: target.relation })
  if (target.contactRef !== undefined) return target.relation
  if (target.source === undefined) return tr("{v0} · 可发起通话", { v0: target.relation })
  return target.relation
}

function clampCallPopover(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function typePickerPlacementFromAnchor(anchor: HTMLElement | undefined): TypePickerPlacement {
  if (anchor === undefined || typeof window === 'undefined') return { kind: 'center' }
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(320, window.innerWidth - 24)
  return {
    kind: 'anchored',
    left: clampCallPopover(rect.left - 10, 12, Math.max(12, window.innerWidth - width - 12)),
    top: clampCallPopover(rect.top - 14, 12, Math.max(12, window.innerHeight - 214)),
  }
}

export function ArkmeCallSurface({ active = true, initialPickerOpen = false, presentation = 'page', onClose }: ArkmeCallSurfaceProps = {}) {
  useArkmeLocale()
  const surfaceRef = useRef<HTMLElement>(null)
  const browserResize = useResizableCallBrowser(surfaceRef)
  const tourPickerOwned = useRef(false)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<ArkmeCallHistoryPage>()
  const pageRef = useRef(page)
  pageRef.current = page
  const [historyRefreshRevision, setHistoryRefreshRevision] = useState(0)
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyError, setHistoryError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const paginationAbortRef = useRef<AbortController>()
  const listRef = useRef<HTMLUListElement>(null)
  const listAnchorRef = useRef<{ key: string; top: number }>()
  const [selectedRef, setSelectedRef] = useState('')
  const privateChatAbortRef = useRef<AbortController>()
  const [openingPrivateChat, setOpeningPrivateChat] = useState(false)
  useEffect(() => {
    setOpeningPrivateChat(false)
    return () => { privateChatAbortRef.current?.abort(); privateChatAbortRef.current = undefined }
  }, [selectedRef, auth.auth?.environment, auth.auth?.userId])
  const [detail, setDetail] = useState<ArkmeCallDetail>()
  const detailRef = useRef(detail)
  detailRef.current = detail
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')
  const [sources, setSources] = useState<ArkmeSourceItem[]>([])
  const [notice, setNotice] = useState('')
  const [pickerOpen, setPickerOpen] = useState(initialPickerOpen)
  const [inviteOpen, setInviteOpen] = useState(false)
  useEffect(() => { setInviteOpen(false) }, [auth.auth?.environment, auth.auth?.userId])
  const [pickerQuery, setPickerQuery] = useState('')
  const [contactSearchResult, setContactSearchResult] = useState<ArkmeContactSearchResult>()
  const [contactSearchState, setContactSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [contactSearchError, setContactSearchError] = useState('')
  const [typeTarget, setTypeTarget] = useState<CallTarget>()
  const [typePickerPlacement, setTypePickerPlacement] = useState<TypePickerPlacement>({ kind: 'center' })
  const [unavailableTarget, setUnavailableTarget] = useState<CallTarget>()
  const [callingKey, setCallingKey] = useState('')
  const callAbortRef = useRef<AbortController>()
  useEffect(() => {
    setCallingKey('')
    return () => { callAbortRef.current?.abort(); callAbortRef.current = undefined }
  }, [auth.auth?.environment, auth.auth?.userId, auth.auth?.status])
  const dialogAccount = `${auth.auth?.environment ?? ''}:${auth.auth?.userId ?? ''}:${auth.auth?.status ?? ''}`
  const initialDialogAccount = useRef(dialogAccount)
  const closeDialogRef = useRef(onClose)
  closeDialogRef.current = onClose
  useEffect(() => {
    if (presentation !== 'dialog') return
    if (initialDialogAccount.current !== dialogAccount || (!pickerOpen && !inviteOpen && !typeTarget && callingKey === '')) {
      closeDialogRef.current?.()
    }
  }, [presentation, dialogAccount, pickerOpen, inviteOpen, typeTarget, callingKey])

  // The same picker can sit above a conversation without allowing keyboard events
  // or focus to escape to its composer. The invitation dialog owns its own portal.
  useEffect(() => {
    if (presentation !== 'dialog' || typeof document === 'undefined') return
    if (inviteOpen) {
      const closeInvitation = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopImmediatePropagation()
        setInviteOpen(false)
      }
      document.addEventListener('keydown', closeInvitation, true)
      return () => document.removeEventListener('keydown', closeInvitation, true)
    }
    const dialogs = surfaceRef.current?.querySelectorAll<HTMLElement>('[role="dialog"]')
    const dialog = dialogs?.[dialogs.length - 1]
    if (!dialog) return
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')]
    const focusFirst = () => (dialog.querySelector<HTMLElement>('input') ?? focusable()[0] ?? dialog).focus({ preventScroll: true })
    focusFirst()
    const keepFocus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusFirst() }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (typeTarget) setTypeTarget(undefined)
        else { callAbortRef.current?.abort(); closeDialogRef.current?.() }
      } else if (event.key === 'Tab') {
        const items = focusable()
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('focusin', keepFocus)
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('focusin', keepFocus); document.removeEventListener('keydown', keyboard, true) }
  }, [presentation, pickerOpen, inviteOpen, typeTarget, callingKey])
  const [officialAuthorProfile, setOfficialAuthorProfile] = useState<ArkmeOfficialAuthorProfile>()
  const searchRef = useRef<HTMLInputElement>(null)
  const historyGenerationRef = useRef(0)
  const historyRefreshingRef = useRef(false)
  const historyAbortRef = useRef<AbortController>()
  const historyRefreshTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const detailGenerationRef = useRef(0)
  const detailAbortRef = useRef<AbortController>()
  useLayoutEffect(() => {
    const anchor = listAnchorRef.current
    listAnchorRef.current = undefined
    const list = listRef.current
    if (!anchor || !list) return
    const row = [...list.querySelectorAll<HTMLElement>('[data-arkme-call-row]')]
      .find(element => element.dataset.arkmeCallRow === anchor.key)
    if (row) list.scrollTop += row.getBoundingClientRect().top - anchor.top
  }, [page])
  const refreshHistory = useCallback((options: { silent?: boolean } = {}) => {
    historyRefreshingRef.current = true
    historyAbortRef.current?.abort()
    paginationAbortRef.current?.abort()
    paginationAbortRef.current = undefined
    setLoadingMore(false)
    setLoadMoreError('')
    const controller = new AbortController()
    historyAbortRef.current = controller
    const generation = historyGenerationRef.current + 1
    historyGenerationRef.current = generation
    if (options.silent !== true) setHistoryState('loading')
    setHistoryError('')
    void refreshCallHistory(pageRef.current, cursor => callArkme<ArkmeCallHistoryPage>('calls.history.list', {
      limit: 30, ...(cursor ? { cursor } : {}), includeRecentContacts: !cursor,
    }, controller.signal), controller.signal)
      .then(async value => {
        await preloadHistoryAvatars(value)
        if (controller.signal.aborted || historyGenerationRef.current !== generation) return
        historyRefreshingRef.current = false
        const list = listRef.current
        if (list && list.scrollTop > 0) {
          const top = list.getBoundingClientRect().top
          const row = [...list.querySelectorAll<HTMLElement>('[data-arkme-call-row]')]
            .find(element => element.getBoundingClientRect().bottom > top)
          if (row?.dataset.arkmeCallRow) listAnchorRef.current = { key: row.dataset.arkmeCallRow, top: row.getBoundingClientRect().top }
        }
        setPage(value)
        setHistoryState('ready')
        setHistoryRefreshRevision(value => value + 1)
      })
      .catch(error => {
        if (controller.signal.aborted || historyGenerationRef.current !== generation || options.silent === true) return
        setHistoryError(readableError(error))
        setHistoryState('error')
      })
      .finally(() => {
        if (historyGenerationRef.current === generation) historyRefreshingRef.current = false
      })
  }, [])

  const loadMoreHistory = useCallback(async () => {
    if (!active || historyState !== 'ready' || historyRefreshingRef.current || historyAbortRef.current?.signal.aborted
      || paginationAbortRef.current || !page?.hasMore || !page.nextCursor) return
    const controller = new AbortController()
    paginationAbortRef.current = controller
    const generation = historyGenerationRef.current
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const value = await callArkme<ArkmeCallHistoryPage>('calls.history.list', {
        limit: 30, cursor: page.nextCursor, includeRecentContacts: false,
      }, controller.signal)
      if (value.hasMore && (!value.nextCursor?.trim() || value.nextCursor === page.nextCursor)) {
        throw new Error('通话记录分页游标无效，请重试')
      }
      await preloadHistoryAvatars(value)
      if (controller.signal.aborted || historyGenerationRef.current !== generation) return
      setPage(previous => previous === undefined ? value : {
        ...previous,
        items: Array.from(new Map([...previous.items, ...value.items]
          .map(item => [item.stableId || item.callRef, item])).values()),
        hasMore: value.hasMore,
        nextCursor: value.nextCursor ?? '',
      })
    } catch (error) {
      if (!controller.signal.aborted && historyGenerationRef.current === generation) {
        setLoadMoreError(readableError(error))
      }
    } finally {
      if (paginationAbortRef.current === controller) {
        paginationAbortRef.current = undefined
        setLoadingMore(false)
      }
    }
  }, [active, page, historyState])

  useEffect(() => {
    if (!active) return
    refreshHistory({ silent: pageRef.current !== undefined })
  }, [active, refreshHistory])

  // Fill a short/filtered list only after activation has started its head refresh.
  useEffect(() => {
    const list = listRef.current
    if (active && list && !loadingMore && !loadMoreError
      && list.scrollHeight <= list.clientHeight) void loadMoreHistory()
  }, [active, loadMoreHistory, loadingMore, loadMoreError, query])

  useEffect(() => {
    return () => {
      historyAbortRef.current?.abort()
      paginationAbortRef.current?.abort()
      detailAbortRef.current?.abort()
      if (historyRefreshTimerRef.current !== undefined) clearTimeout(historyRefreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const unsubscribe = outgoingCallUi.subscribeSettled(() => {
      refreshHistory({ silent: true })
      if (historyRefreshTimerRef.current !== undefined) clearTimeout(historyRefreshTimerRef.current)
      historyRefreshTimerRef.current = setTimeout(() => {
        refreshHistory({ silent: true })
        historyRefreshTimerRef.current = undefined
      }, CALL_HISTORY_SETTLED_REFRESH_DELAY_MS)
    })
    return () => {
      unsubscribe()
      if (historyRefreshTimerRef.current !== undefined) clearTimeout(historyRefreshTimerRef.current)
    }
  }, [active, refreshHistory])

  useEffect(() => {
    if (active) return
    // Stop catch-up/pagination work when leaving an already loaded page. The
    // initial read may finish so a quick first return can still use its result.
    if (pageRef.current) {
      historyAbortRef.current?.abort()
      paginationAbortRef.current?.abort()
      detailAbortRef.current?.abort()
    }
    setPickerOpen(false)
    setInviteOpen(false)
    setTypeTarget(undefined)
    setUnavailableTarget(undefined)
    setNotice('')
    callAbortRef.current?.abort()
    callAbortRef.current = undefined
    setCallingKey('')
    privateChatAbortRef.current?.abort()
    privateChatAbortRef.current = undefined
    setOpeningPrivateChat(false)
  }, [active])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeSourceList>('sources.list', { directory: 'root', limit: 100 }, controller.signal)
      .then(async value => {
        const privateChats = value.items.filter(item => item.kind === 'private_chat')
        await preloadSourceAvatars(privateChats)
        if (active) setSources(privateChats)
      })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [])

  useEffect(() => {
    if (!pickerOpen || officialAuthorProfile !== undefined) return
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeOfficialAuthorProfile>('chat.official-author.profile', {}, controller.signal)
      .then(async value => {
        const avatarRef = cleanAvatarRef(value.avatarRef)
        if (avatarRef !== undefined) await arkmeAvatarImages.load(avatarRef).catch(() => undefined)
        if (!active || controller.signal.aborted) return
        setOfficialAuthorProfile({
          userId: value.userId,
          displayName: value.displayName.trim() || OFFICIAL_AUTHOR_DISPLAY_NAME,
          ...(avatarRef === undefined ? {} : { avatarRef }),
        })
      })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [officialAuthorProfile, pickerOpen])

  useEffect(() => {
    const value = pickerQuery.trim()
    if (!pickerOpen || !shouldSearchContactIdentifier(value)) {
      setContactSearchResult(undefined)
      setContactSearchState('idle')
      setContactSearchError('')
      return
    }
    let active = true
    const controller = new AbortController()
    setContactSearchResult(undefined)
    setContactSearchState('loading')
    setContactSearchError('')
    const timer = setTimeout(() => {
      void callArkme<ArkmeContactSearchResult>('contacts.search', { identifier: value }, controller.signal)
        .then(async result => {
          const avatarRef = cleanAvatarRef(result.avatarRef)
          if (avatarRef !== undefined) await arkmeAvatarImages.load(avatarRef).catch(() => undefined)
          if (!active || controller.signal.aborted) return
          setContactSearchResult(result)
          setContactSearchState('ready')
        })
        .catch(error => {
          if (!active || controller.signal.aborted) return
          setContactSearchResult(undefined)
          setContactSearchError(readableError(error))
          setContactSearchState('error')
        })
    }, CONTACT_SEARCH_DEBOUNCE_MS)
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [pickerOpen, pickerQuery])

  const realItems = page?.items ?? []
  const sampleItems = historyState === 'ready' && page?.hasMore === false ? SAMPLE_CALLS : []
  const selectableItems = historyState === 'ready' ? [...realItems, ...sampleItems] : realItems
  const recentContacts = page?.recentContacts ?? []
  const usingSampleContacts = historyState === 'ready' && recentContacts.length === 0
  const contacts: readonly ArkmeCallRecentContact[] = historyState === 'loading'
    ? []
    : recentContacts.length > 0 ? recentContacts : SAMPLE_CONTACTS
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (normalized === '') return realItems
    return realItems.filter(item => `${item.peerDisplayName} ${item.resultLabel} ${mediaLabel(item.mediaType)} ${item.summaryPreview ?? ''}`.toLowerCase().includes(normalized))
  }, [realItems, query])
  const filteredSampleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (normalized === '') return sampleItems
    return sampleItems.filter(item => `${item.peerDisplayName} ${item.resultLabel} ${mediaLabel(item.mediaType)} ${item.summaryPreview ?? ''}`.toLowerCase().includes(normalized))
  }, [sampleItems, query])
  const callRows = useMemo(() => {
    return [
      ...filteredItems.map(item => ({ item, sample: false })),
      ...filteredSampleItems.map(item => ({ item, sample: true })),
    ]
  }, [filteredItems, filteredSampleItems])
  const selectedItem = selectableItems.find(item => callHistoryIdentity(item) === selectedRef)
  const selectedSource = selectedItem === undefined ? undefined : sources.find(source => sourceMatchesCall(source, selectedItem))
  const contactByName = useMemo(() => {
    const values = new Map<string, ArkmeCallRecentContact>()
    for (const contact of contacts) {
      const key = contact.displayName.trim().toLowerCase()
      if (key !== '' && !values.has(key)) values.set(key, contact)
    }
    return values
  }, [contacts])
  const avatarRefForName = useCallback((displayName: string): string | undefined => {
    const key = displayName.trim().toLowerCase()
    if (key === '') return undefined
    const source = sources.find(item => item.kind === 'private_chat' && item.displayName.trim().toLowerCase() === key)
    return cleanAvatarRef(source?.avatarRef) ?? cleanAvatarRef(contactByName.get(key)?.avatarRef)
  }, [contactByName, sources])
  const avatarRefForCall = useCallback((item: ArkmeCallHistoryItem): string | undefined => {
    return cleanAvatarRef(item.peerAvatarRef) ?? avatarRefForName(item.peerDisplayName)
  }, [avatarRefForName])
  const sourceTargets = useMemo(() => sources.map(targetForSource), [sources])
  const recommendedTarget = useMemo(() => officialAuthorTarget(officialAuthorProfile), [officialAuthorProfile])
  const pickerTargets = useMemo(() => {
    const seen = new Set<string>([targetIdentityKey(recommendedTarget)])
    const merged: CallTarget[] = []
    for (const target of sourceTargets) {
      const identity = targetIdentityKey(target)
      if (seen.has(identity)) continue
      seen.add(identity)
      merged.push(target)
    }
    for (const contact of contacts) {
      const name = contact.displayName.trim()
      if (name === '') continue
      const target = targetForContact(contact, { usingSampleContacts })
      const identity = targetIdentityKey(target)
      if (seen.has(identity)) continue
      seen.add(identity)
      merged.push(target)
    }
    return merged
  }, [contacts, recommendedTarget, sourceTargets, usingSampleContacts])
  const contactSearchTarget = useMemo(() => {
    return contactSearchResult === undefined ? undefined : targetForContactSearch(contactSearchResult)
  }, [contactSearchResult])
  const filteredPickerTargets = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase()
    const localTargets = normalized === ''
      ? pickerTargets
      : pickerTargets.filter(target => `${target.displayName} ${target.relation}`.toLowerCase().includes(normalized))
    if (contactSearchTarget === undefined) return localTargets
    const remoteIdentity = targetIdentityKey(contactSearchTarget)
    return [
      contactSearchTarget,
      ...localTargets.filter(target => target.key !== contactSearchTarget.key && targetIdentityKey(target) !== remoteIdentity),
    ]
  }, [contactSearchTarget, pickerQuery, pickerTargets])
  const pickerListTitle = pickerQuery.trim() === '' ? '最近联系人' : '搜索结果'
  const rememberSource = useCallback((source: ArkmeSourceItem) => {
    setSources(current => {
      const index = current.findIndex(item => item.sourceRef === source.sourceRef)
      if (index < 0) return [source, ...current]
      const next = [...current]
      next[index] = source
      return next
    })
  }, [])

  const selectItem = useCallback((item: ArkmeCallHistoryItem, silent = false) => {
    const retainDetail = silent && detailRef.current !== undefined
    const generation = detailGenerationRef.current + 1
    detailGenerationRef.current = generation
    detailAbortRef.current?.abort()
    setSelectedRef(callHistoryIdentity(item))
    setNotice('')
    if (!retainDetail) setDetail(undefined)
    const sampleDetail = sampleDetailForCall(item.callRef)
    if (sampleDetail !== undefined) {
      setDetail(sampleDetail)
      setDetailState('ready')
      setDetailError('')
      return
    }
    if (item.canOpenDetail !== true) {
      setDetailState('idle')
      return
    }
    const controller = new AbortController()
    detailAbortRef.current = controller
    if (!retainDetail) setDetailState('loading')
    setDetailError('')
    void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef: item.callRef }, controller.signal)
      .then(value => {
        if (controller.signal.aborted || detailGenerationRef.current !== generation) return
        setDetail(value)
        setDetailState('ready')
      })
      .catch(error => {
        if (controller.signal.aborted || detailGenerationRef.current !== generation || retainDetail) return
        setDetailError(readableError(error))
        setDetailState('error')
      })
  }, [])

  // Refreshed callRefs are newly sealed handles, not record identities. Keep the
  // selection/DOM keyed by stableId while refreshing only the selected detail.
  const selectedItemRef = useRef(selectedItem)
  selectedItemRef.current = selectedItem
  useEffect(() => {
    const item = selectedItemRef.current
    if (active && item && !historyRefreshingRef.current) selectItem(item, true)
  }, [active, historyRefreshRevision, selectItem])

  const openPicker = useCallback((initialQuery = '') => {
    setPickerQuery(initialQuery)
    setPickerOpen(true)
    setTypeTarget(undefined)
    setTypePickerPlacement({ kind: 'center' })
    setUnavailableTarget(undefined)
    setNotice('')
  }, [])

  const prepareTourStep = useCallback((step: number) => {
    tourPickerOwned.current = step === 1
    setPickerOpen(step === 1)
    setPickerQuery('')
    setTypeTarget(undefined)
    setUnavailableTarget(undefined)
    setNotice('')
    if (step >= 2) setQuery('')
    if (step >= 3) selectItem(SAMPLE_CALLS[0]!)
  }, [selectItem])
  const closeTourPicker = useCallback(() => {
    if (tourPickerOwned.current) { tourPickerOwned.current = false; setPickerOpen(false) }
  }, [])
  const tour = useCallTour({ root: surfaceRef, auth: auth.auth, active: active && presentation === 'page' && ui.mode === 'calls',
    ready: historyState === 'ready', blocked: auth.busy || ui.webLoginDialogOpen === true,
    explicitEntry: initialPickerOpen, notificationRevision: ui.notificationActivationRevision ?? 0,
    onStep: prepareTourStep, onExit: closeTourPicker })
  const finishTour = tour.finish
  const handleOpenPicker = () => {
    if (tour.current === 0) tour.change(1)
    else { finishTour(false); openPicker() }
  }
  const closePicker = () => { finishTour(); setPickerOpen(false) }

  const requestTargetCall = useCallback((target: CallTarget, mediaType: 'audio' | 'video') => {
    if (callingKey !== '' || callAbortRef.current) return
    finishTour(false)
    if (!targetCanResolve(target)) {
      setPickerOpen(false)
      setTypeTarget(target)
      setTypePickerPlacement({ kind: 'center' })
      setUnavailableTarget(target)
      return
    }
    setPickerOpen(false)
    setTypeTarget(undefined)
    setUnavailableTarget(undefined)
    setNotice(target.source === undefined ? '正在打开私聊会话...' : '')
    const requestKey = `${target.key}:${mediaType}`
    const controller = new AbortController()
    callAbortRef.current = controller
    setCallingKey(requestKey)
    void (async () => {
      let source = target.source
      if (source === undefined) {
        const opened = target.officialAuthor === true
          ? await callArkme<ArkmeOpenPrivateChatResult>('chat.official-author.private.open', undefined, controller.signal)
          : target.contactRef !== undefined
            ? await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open-from-contact', {
              contactRef: target.contactRef,
            }, controller.signal)
          : await (async () => {
            const peerUserId = target.peerUserId
            if (peerUserId === undefined) throw new Error('还没有找到这个联系人对应的私聊会话')
            return await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
              peerUserId,
              displayName: target.displayName,
            }, controller.signal)
          })()
        source = opened.source
        if (controller.signal.aborted) return
        rememberSource(opened.source)
      }
      if (controller.signal.aborted) return
      outgoingCallUi.request({ sourceRef: source.sourceRef, displayName: source.displayName || target.displayName, mediaType })
      setNotice('')
    })()
      .catch(error => {
        if (controller.signal.aborted) return
        setNotice(readableError(error) || '发起通话失败，请稍后重试')
        setTypeTarget(target)
        setTypePickerPlacement({ kind: 'center' })
        setUnavailableTarget(targetCanResolve(target) ? undefined : target)
      })
      .finally(() => {
        if (callAbortRef.current === controller) callAbortRef.current = undefined
        if (!controller.signal.aborted) setCallingKey('')
      })
  }, [callingKey, rememberSource, finishTour])

  const openTargetTypePicker = useCallback((target: CallTarget, anchor?: HTMLElement, options: { keepPickerOpen?: boolean } = {}) => {
    finishTour(false)
    if (options.keepPickerOpen !== true) setPickerOpen(false)
    setTypeTarget(target)
    setTypePickerPlacement(typePickerPlacementFromAnchor(anchor))
    setUnavailableTarget(targetCanResolve(target) ? undefined : target)
    setNotice('')
  }, [finishTour])

  const startSelectedCall = useCallback((mediaType: 'audio' | 'video') => {
    const item = selectedItem
    const source = selectedSource
    if (item === undefined) {
      openPicker()
      return
    }
    requestTargetCall({
      key: source?.sourceRef ?? `call:${item.stableId}`,
      displayName: item.peerDisplayName,
      relation: source === undefined ? '通话联系人' : '私聊联系人',
      ...(avatarRefForCall(item) === undefined ? {} : { avatarRef: avatarRefForCall(item) }),
      ...(item.peerUserId === undefined ? {} : { peerUserId: item.peerUserId }),
      ...(source === undefined ? {} : { source }),
    }, mediaType)
  }, [avatarRefForCall, openPicker, requestTargetCall, selectedItem, selectedSource])

  const openSelectedPrivateChat = async () => {
    const item = selectedItem
    if (!item?.peerUserId || privateChatAbortRef.current) return
    const controller = new AbortController()
    privateChatAbortRef.current = controller
    setOpeningPrivateChat(true)
    setNotice('')
    try {
      // A display-name match is insufficient: different users can share a nickname.
      const existing = sources.find(source => source.kind === 'private_chat' && source.peerUserId === item.peerUserId)
      const source = existing ?? (await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
        peerUserId: item.peerUserId, displayName: item.peerDisplayName,
      }, controller.signal)).source
      if (controller.signal.aborted) return
      rememberSource(source)
      arkmeUi.selectSource(source)
    } catch (error) {
      if (!controller.signal.aborted) setNotice(readableError(error) || '打开私聊失败，请稍后重试')
    } finally {
      if (privateChatAbortRef.current === controller) {
        privateChatAbortRef.current = undefined
        setOpeningPrivateChat(false)
      }
    }
  }

  const openContact = (contact: ArkmeCallRecentContact, event?: MouseEvent<HTMLElement>) => {
    openTargetTypePicker(targetFromRecentContact(contact), event?.currentTarget)
  }

  const targetFromRecentContact = (contact: ArkmeCallRecentContact): CallTarget => {
    const hasRealPeerUserId = !usingSampleContacts && Number.isSafeInteger(contact.userId) && contact.userId > 0
    const matchedSource = hasRealPeerUserId
      ? sources.find(source => source.kind === 'private_chat' && source.peerUserId === contact.userId)
      : sources.find(source => source.kind === 'private_chat' && source.displayName.trim() === contact.displayName.trim())
    const avatarRef = cleanAvatarRef(matchedSource?.avatarRef) ?? cleanAvatarRef(contact.avatarRef)
    return {
      key: matchedSource?.sourceRef ?? `recent:${String(contact.userId ?? contact.displayName)}:${contact.displayName}`,
      displayName: contact.displayName,
      relation: matchedSource === undefined ? '最近联系人' : '私聊联系人',
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(hasRealPeerUserId ? { peerUserId: contact.userId, identityKey: userIdentityKey(contact.userId) } : {}),
      ...(matchedSource === undefined ? {} : { source: matchedSource }),
    }
  }

  const renderCallRow = (item: ArkmeCallHistoryItem, sample: boolean) => {
    const selected = callHistoryIdentity(item) === selectedRef
    const summary = item.summaryStatus === 'pending' ? '摘要生成中…'
      : item.summaryStatus === 'failed' ? '摘要生成失败，点击查看详情'
      : item.summaryStatus === 'done' && item.summaryPreview?.trim() ? tr("AI 摘要：{v0}", { v0: item.summaryPreview.trim() }) : ''
    return <li key={callKey(item)} data-arkme-call-row={callHistoryIdentity(item)}>
      <button data-arkme-feedback="neutral"
        type="button"
        aria-pressed={selected}
        data-arkme-hover="button"
        style={{ ...styles.callRow, ...(selected ? styles.callRowSelected : {}) }}
        onClick={() => {
          if (tour.current === 2 && item.callRef === 'sample-video') tour.change(3)
          else { finishTour(false); selectItem(item) }
        }}
      >
        <span style={{ gridColumn: 1, gridRow: '1 / 3' }}>
          <CallAvatar name={item.peerDisplayName} avatarRef={sample ? undefined : avatarRefForCall(item)} assetUrl={sample ? sampleAvatarUrl(item.peerDisplayName) : undefined} />
        </span>
        <span style={styles.callNameLine}>
          <strong style={styles.callName}>{item.peerDisplayName}</strong>
          {sample && <em style={styles.sampleBadge}>{tr("示例")}</em>}
        </span>
        <span style={styles.callMeta}>
          {item.mediaType === 'video' ? <CallVideoIcon size={14} /> : <PhoneCall size={14} />}
          {mediaLabel(item.mediaType)} · {formatDuration(item.durationSeconds)}
        </span>
        <time style={styles.callTime}>{sample ? item.resultLabel : shortTime(item.startedAtMillis)}</time>
        {summary && <span style={styles.callSummary} data-arkme-call-summary="true">
          <span style={{ ...styles.callSummaryText, ...(item.summaryStatus === 'done' ? {} : { WebkitLineClamp: 1 }) }}>{summary}</span>
        </span>}
      </button>
    </li>
  }
  const typePickerLayerStyle: CSSProperties = typePickerPlacement.kind === 'anchored'
    ? styles.typeLayer!
    : styles.layer!
  const typePickerStyle: CSSProperties = typePickerPlacement.kind === 'anchored'
    ? { ...styles.typePicker!, position: 'absolute' as const, left: typePickerPlacement.left, top: typePickerPlacement.top }
    : styles.typePicker!

  const selectedIsSample = selectedItem?.callRef.startsWith('sample-') === true
  const selectedSampleAvatarUrl = selectedItem === undefined || !selectedIsSample ? undefined : sampleAvatarUrl(selectedItem.peerDisplayName)

  const content = <section ref={surfaceRef}
    style={presentation === 'dialog' ? { position: 'fixed', inset: 0, zIndex: 10300, color: arkmeTheme.text } : { ...styles.root, gridTemplateColumns: `${browserResize.width}px 3px minmax(0, 1fr)` }}
    aria-label={presentation === 'dialog' ? tr("发起通话") : tr("通话")}
    data-arkme-call-surface={presentation === 'page' ? 'true' : undefined}
    data-arkme-call-launcher={presentation === 'dialog' ? 'true' : undefined}
    data-arkme-notification-blocking-overlay={presentation === 'dialog' ? 'true' : undefined}>
    {presentation === 'page' && <>
    <aside style={styles.browser}>
      <header style={styles.heading}>
        <h1 style={styles.title}>{tr("通话")}</h1>
        <p style={styles.subtitle}>{tr("让每一次重要的声音与相见，都能被好好记住。")}</p>
      </header>
      <button data-arkme-feedback="neutral" type="button" data-arkme-call-tour-target="start" style={styles.startWide} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={handleOpenPicker}>
        <PhoneCall size={17} />{tr("发起通话")}</button>
      <p style={styles.sectionLabel}>{tr("最近联系人")}</p>
      <div style={styles.contacts} aria-label={tr("最近联系人")} data-arkme-call-recent-contacts="rail">
        {contacts.slice(0, 5).map(contact => <button data-arkme-feedback="neutral"
          key={`${String(contact.userId)}:${contact.displayName}`}
          type="button"
          className="arkme-call-recent-contact"
          data-arkme-hover="none"
          style={usingSampleContacts ? { ...styles.contact, cursor: 'default' } : styles.contact}
          aria-label={usingSampleContacts ? `${contact.displayName}示例联系人` : tr("选择{v0}通话方式", { v0: contact.displayName })}
          aria-disabled={usingSampleContacts || undefined}
          onClick={usingSampleContacts ? undefined : event => { openContact(contact, event) }}
        >
          <CallAvatar name={contact.displayName} avatarRef={cleanAvatarRef(contact.avatarRef) ?? avatarRefForName(contact.displayName)} assetUrl={usingSampleContacts ? sampleAvatarUrl(contact.displayName) : undefined} size={30} />
          <span style={styles.contactName}>{contact.displayName}</span>
        </button>)}
      </div>
      <label style={styles.search}>
        <MagnifyingGlass size={17} />
        <input
          ref={searchRef}
          style={styles.searchInput}
          value={query}
          onChange={event => { setQuery(event.currentTarget.value) }}
          placeholder={tr("搜索通话记录")}
          aria-label={tr("搜索通话记录")}
        />
      </label>
      <section data-arkme-call-tour-target="recent" aria-label={tr("最近通话")} style={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={styles.sectionLabel}>{tr("最近通话")}</p>
        {historyState === 'loading' ? <div style={styles.status}>{tr("正在读取通话记录...")}</div>
          : historyState === 'error' ? <div style={styles.status}>{historyError || '通话记录暂时不可用'}</div>
            : <ul ref={listRef} aria-label={tr("通话记录列表")} style={styles.list} onScroll={event => {
              const list = event.currentTarget
              if (!loadMoreError && list.scrollHeight - list.scrollTop - list.clientHeight <= 200) {
                void loadMoreHistory()
              }
            }}>
              {callRows.map(row => renderCallRow(row.item, row.sample))}
              {callRows.length === 0 && <li style={styles.status}>{query.trim() === '' ? '还没有通话记录' : '没有符合条件的通话'}</li>}
              {loadingMore && <li role="status" style={styles.status}>
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }}>
                  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="35 16">
                    <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                </svg>{tr("加载更多…")}</li>}
              {!loadingMore && loadMoreError && <li style={styles.status}>
                <button data-arkme-feedback="neutral" type="button" onClick={() => { void loadMoreHistory() }} style={{ color: 'inherit', background: 'none', border: 0, cursor: 'pointer' }}>{tr("加载失败，点击重试")}</button>
              </li>}
              {!loadingMore && !loadMoreError && page?.hasMore === false && realItems.length > 0 && <li style={styles.status}>{tr("没有更多了")}</li>}
            </ul>}
      </section>
    </aside>
    {browserResize.handle}
    <main style={styles.content}>
      {selectedItem === undefined ? <div style={styles.empty}>
        <div style={styles.emptyInner}>
          <PhoneCall size={25} style={styles.emptyIcon} />
          <h2 style={styles.emptyTitle}>{tr("从一次问候开始")}</h2>
          <p style={styles.emptyCopy}>{tr("找一位想联系的人，聊过的声音和画面会留在这里。")}</p>
          <button data-arkme-feedback="neutral" type="button" style={styles.startCenter} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={handleOpenPicker}>
            <Plus size={16} />{tr("发起通话")}</button>
        </div>
      </div> : <>
        <header style={styles.detailHeader}>
          <div style={styles.detailIdentity}>
            <CallAvatar name={selectedItem.peerDisplayName} avatarRef={selectedIsSample ? undefined : avatarRefForCall(selectedItem)} assetUrl={selectedSampleAvatarUrl} size={45} />
            <span style={styles.detailTitleBlock}>
              <h2 style={styles.detailTitle}>{selectedItem.peerDisplayName}</h2>
              <p style={styles.detailSub}>{detailSubtitle(selectedItem)}</p>
            </span>
          </div>
          {!selectedIsSample && <div style={styles.detailActions}>
            <button data-arkme-feedback="neutral" type="button" style={{ ...styles.privateChatButton, ...(!selectedItem.peerUserId || openingPrivateChat ? { opacity: 0.5, cursor: 'default' } : {}) }}
              disabled={!selectedItem.peerUserId || openingPrivateChat} aria-busy={openingPrivateChat}
              title={selectedItem.peerUserId ? '打开与这位联系人的私聊' : '暂无法识别通话对象'}
              onClick={() => { void openSelectedPrivateChat() }}><ChatCircle size={17} />{openingPrivateChat ? tr("正在打开…") : '发起私聊'}</button>
            <button data-arkme-feedback="neutral" type="button" style={styles.iconButton} aria-label={tr("和{v0}语音通话", { v0: selectedItem.peerDisplayName })} onClick={() => { startSelectedCall('audio') }}><PhoneCall size={19} /></button>
            <button data-arkme-feedback="neutral" type="button" style={styles.iconButton} aria-label={tr("和{v0}视频通话", { v0: selectedItem.peerDisplayName })} onClick={() => { startSelectedCall('video') }}><CallVideoIcon size={19} /></button>
          </div>}
        </header>
        <ArkmeCallDetailContent key={callHistoryIdentity(selectedItem)} active={active} selectedItem={selectedItem} detail={detail} detailState={detailState} detailError={detailError} avatarRefForName={avatarRefForName} tourSample={tour.current !== undefined && tour.current >= 3} />
      </>}
      {notice !== '' && <div role="status" style={styles.notice}>{notice}</div>}
    </main>
    </>}
      {presentation === 'dialog' && callingKey !== '' && <div style={styles.layer}>
        <section role="dialog" aria-modal="true" aria-label={tr("正在准备通话")} style={styles.typePicker}>
          <p role="status">{tr("正在准备通话…")}</p>
          <button type="button" data-arkme-feedback="neutral" style={styles.typeOption} onClick={() => {
            callAbortRef.current?.abort(); closeDialogRef.current?.()
          }}>{tr("取消")}</button>
        </section>
      </div>}
      {pickerOpen && <div
        style={styles.layer}
        role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) closePicker() }}
      >
        <section style={styles.picker} role="dialog" aria-modal={tour.current === 1 ? undefined : true} aria-label={tr("选择通话联系人")} data-arkme-call-tour-dialog={tour.current === 1 ? 'true' : undefined}>
          <header style={styles.pickerHeader}>
            <h3 style={styles.pickerTitle}>{tr("发起通话")}</h3>
            <button data-arkme-feedback="neutral" type="button" style={styles.closeButton} aria-label={tr("关闭联系人选择")} onClick={closePicker}><X size={17} /></button>
          </header>
          <label className="arkme-call-picker-search" style={styles.pickerSearch}>
            <MagnifyingGlass size={16} />
            <input
              autoFocus
              autoComplete="off"
              name="arkme-call-contact-search"
              spellCheck={false}
              style={styles.pickerInput}
              value={pickerQuery}
              onChange={event => { setPickerQuery(event.currentTarget.value) }}
              placeholder={CONTACT_SEARCH_PLACEHOLDER}
              aria-label={tr("搜索私聊联系人")}
            />
          </label>
          <button data-arkme-feedback="neutral" type="button" className="arkme-call-picker-invite" style={{ ...styles.pickerRow, ...styles.pickerInvite }}
            onClick={() => { closePicker(); setInviteOpen(true) }}>
            <Link size={20} />
            <span style={styles.pickerText}><strong style={styles.pickerName}>{tr("邀请他人向我发起通话")}</strong><small style={styles.pickerSub}>{tr("分享链接，让对方联系我")}</small></span>
            <CaretRight size={15} />
          </button>
          <div style={styles.pickerContacts} data-arkme-call-picker-contacts="true">
            {pickerQuery.trim() === '' && recommendedTarget !== undefined && <section style={styles.recommendation} aria-label={tr("推荐联系人")}>
              <CallAvatar name={recommendedTarget.displayName} avatarRef={recommendedTarget.avatarRef} size={38} />
              <span style={styles.pickerText}>
                <strong style={styles.pickerName}>{recommendedTarget.displayName}</strong>
                <small style={styles.pickerSub}>{recommendedTarget.relation}</small>
              </span>
              <span style={styles.pickerActions} data-arkme-call-tour-target="types">
                <button data-arkme-feedback="neutral" type="button" style={styles.pickerRound} aria-label={tr("和{v0}语音通话", { v0: recommendedTarget.displayName })} onClick={() => { requestTargetCall(recommendedTarget, 'audio') }}><PhoneCall size={17} /></button>
                <button data-arkme-feedback="neutral" type="button" style={styles.pickerRound} aria-label={tr("和{v0}视频通话", { v0: recommendedTarget.displayName })} onClick={() => { requestTargetCall(recommendedTarget, 'video') }}><CallVideoIcon size={17} /></button>
              </span>
            </section>}
            <p style={styles.sectionLabel}>{pickerListTitle}</p>
            <div style={styles.pickerList} data-arkme-call-picker-list="true">
              {filteredPickerTargets.length > 0 ? filteredPickerTargets.map(target => {
                const unavailable = !targetCanResolve(target)
                const sample = target.sample === true
                return <div key={target.key} style={styles.pickerRowFrame}>
                  <button data-arkme-feedback="neutral"
                    type="button"
                    style={{ ...styles.pickerRow, ...(unavailable && !sample ? styles.pickerRowDisabled : {}) }}
                    aria-label={sample ? `${target.displayName}示例联系人，暂不可发起通话` : unavailable ? tr("{v0}暂不可直接呼叫", { v0: target.displayName }) : tr("选择{v0}通话方式", { v0: target.displayName })}
                    aria-disabled={sample || undefined}
                    disabled={sample}
                    onClick={sample ? undefined : event => { openTargetTypePicker(target, event?.currentTarget, { keepPickerOpen: true }) }}
                  >
                    <CallAvatar name={target.displayName} avatarRef={target.avatarRef} assetUrl={sample ? sampleAvatarUrl(target.displayName) : undefined} size={36} />
                    <span style={styles.pickerText}>
                      <span style={styles.pickerNameLine}>
                        <strong style={styles.pickerName}>{target.displayName}</strong>
                        {sample && <em style={styles.sampleBadge}>{tr("示例")}</em>}
                      </span>
                      <small style={styles.pickerSub}>{targetSubtitle(target)}</small>
                    </span>
                  </button>
                  <span style={styles.pickerActions}>
                    <button data-arkme-feedback="neutral" type="button" style={{ ...styles.pickerRound, ...(sample ? styles.pickerRoundDisabled : {}) }} aria-label={sample ? `${target.displayName}示例联系人，语音通话不可用` : tr("直接和{v0}语音通话", { v0: target.displayName })} aria-disabled={sample || undefined} disabled={sample} onClick={sample ? undefined : () => { requestTargetCall(target, 'audio') }}><PhoneCall size={16} /></button>
                    <button data-arkme-feedback="neutral" type="button" style={{ ...styles.pickerRound, ...(sample ? styles.pickerRoundDisabled : {}) }} aria-label={sample ? `${target.displayName}示例联系人，视频通话不可用` : tr("直接和{v0}视频通话", { v0: target.displayName })} aria-disabled={sample || undefined} disabled={sample} onClick={sample ? undefined : () => { requestTargetCall(target, 'video') }}><CallVideoIcon size={16} /></button>
                  </span>
                </div>
              }) : <div style={styles.pickerEmpty}>
                <PhoneCall size={22} />
                <strong>{tr("没有可呼叫联系人")}</strong>
                <span>{pickerQuery.trim() === ''
                  ? '先在对话里建立私聊后，就可以从这里发起通话。'
                  : contactSearchState === 'loading'
                    ? '正在搜索即我号...'
                    : contactSearchState === 'error'
                      ? contactSearchError || '搜索即我号失败，请稍后重试。'
                      : '没有匹配的私聊联系人。'}</span>
              </div>}
            </div>
          </div>
        </section>
      </div>}
      {inviteOpen && <ArkmeCallInviteDialog onClose={() => { setInviteOpen(false) }} onBack={() => { setInviteOpen(false); setPickerOpen(true) }} />}
      {typeTarget !== undefined && <div
        style={typePickerLayerStyle}
        role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setTypeTarget(undefined) }}
      >
        <section style={typePickerStyle} role="dialog" aria-modal="true" aria-label={tr("选择和{v0}的通话方式", { v0: typeTarget.displayName })} data-arkme-call-type-picker-placement={typePickerPlacement.kind}>
          <header style={styles.typeHeader}>
            <CallAvatar name={typeTarget.displayName} avatarRef={typeTarget.avatarRef} size={38} />
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>{typeTarget.displayName}</strong>
	              <small style={styles.pickerSub}>{targetSubtitle(typeTarget)}</small>
            </span>
            <button data-arkme-feedback="neutral" type="button" style={styles.closeButton} aria-label={tr("关闭通话方式选择")} onClick={() => { setTypeTarget(undefined) }}><X size={16} /></button>
          </header>
          <button data-arkme-feedback="neutral"
            type="button"
	            style={{ ...styles.typeOption, ...(!targetCanResolve(typeTarget) ? styles.typeOptionDisabled : {}) }}
	            aria-disabled={!targetCanResolve(typeTarget)}
            onClick={() => { requestTargetCall(typeTarget, 'audio') }}
          >
            <span style={styles.typeIcon}><PhoneCall size={18} /></span>
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>{tr("语音通话")}</strong>
              <small style={styles.pickerSub}>{tr("仅使用麦克风")}</small>
            </span>
          </button>
          <button data-arkme-feedback="neutral"
            type="button"
	            style={{ ...styles.typeOption, ...(!targetCanResolve(typeTarget) ? styles.typeOptionDisabled : {}) }}
	            aria-disabled={!targetCanResolve(typeTarget)}
            onClick={() => { requestTargetCall(typeTarget, 'video') }}
          >
            <span style={styles.typeIcon}><CallVideoIcon size={18} /></span>
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>{tr("视频通话")}</strong>
              <small style={styles.pickerSub}>{tr("使用摄像头和麦克风")}</small>
            </span>
          </button>
          {unavailableTarget !== undefined && <p role="status" style={styles.unavailable}>{tr("还没有找到这个联系人对应的私聊会话，暂时不能从通话页直接呼叫。请先从对话里打开该联系人，或搜索已有私聊联系人。")}</p>}
          {presentation === 'dialog' && notice !== '' && <p role="alert" style={styles.unavailable}>{notice}</p>}
        </section>
      </div>}
    {tour.panel}
  </section>
  return presentation === 'dialog' && typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
