import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeCallDetail,
  ArkmeCallHistoryItem,
  ArkmeCallHistoryPage,
  ArkmeCallMediaType,
  ArkmeCallRecentContact,
  ArkmeCallVideoPerspective,
  ArkmeContactSearchResult,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeSourceList,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeUserAvatar, loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'

interface CallTarget {
  key: string
  displayName: string
  relation: string
  avatarRef?: string | undefined
  peerUserId?: number | undefined
  contactRef?: string | undefined
  contactCanOpen?: boolean | undefined
  source?: ArkmeSourceItem
  officialAuthor?: boolean | undefined
  identityKey?: string | undefined
}

export interface ArkmeCallSurfaceProps {
  initialPickerOpen?: boolean
}

type TypePickerPlacement =
  | { kind: 'center' }
  | { kind: 'anchored'; left: number; top: number }

const CALL_SURFACE_AVATAR_PRELOAD_LIMIT = 40
const CALL_HISTORY_SETTLED_REFRESH_DELAY_MS = 2_400
const CALL_ASSET_ROOT = '/arkme-self/api/call'
const OFFICIAL_AUTHOR_DISPLAY_NAME = '即' + '我作者'
const OFFICIAL_AUTHOR_RECOMMENDATION_LABEL = OFFICIAL_AUTHOR_DISPLAY_NAME + ' · 推荐'
const CONTACT_SEARCH_PLACEHOLDER = '输入' + '即' + '我号或昵称'
const CONTACT_SEARCH_DEBOUNCE_MS = 280
const SAMPLE_VIDEO_PEER_URL = `${CALL_ASSET_ROOT}/call-demo-peer.png`
const SAMPLE_VIDEO_SELF_URL = `${CALL_ASSET_ROOT}/call-demo-self.png`

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
  { userId: 1, displayName: '阿森' },
  { userId: 2, displayName: '林小满' },
  { userId: 3, displayName: 'Tison' },
  { userId: 4, displayName: '妈妈' },
  { userId: 5, displayName: '颜格蕾' },
]

type SamplePerspective = 'primary' | 'secondary'

function sampleAvatarUrl(name: string): string | undefined {
  if (name === '林小满') return `${CALL_ASSET_ROOT}/avatar-lin-xiaoman.jpeg`
  if (name === '妈妈') return `${CALL_ASSET_ROOT}/avatar-mother.jpg`
  if (name === '你') return `${CALL_ASSET_ROOT}/avatar-self.png`
  return undefined
}

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
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'grid', gridTemplateColumns: '326px minmax(0, 1fr)', background: '#fff', color: '#171923',
  },
  browser: {
    minWidth: 0, minHeight: 0, padding: '30px 15px 17px', display: 'flex', flexDirection: 'column',
    borderRight: '1px solid #e7e7e9', background: '#fff', boxSizing: 'border-box',
  },
  heading: { padding: '0 1px 0 2px' },
  title: { margin: 0, fontSize: 22, lineHeight: '28px', fontWeight: 650, letterSpacing: '-0.02em' },
  subtitle: { margin: '8px 0 0', color: '#92969e', fontSize: 12, lineHeight: '18px', fontWeight: 500 },
  startWide: {
    width: '100%', height: 42, margin: '18px 0 24px', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 8, border: 0, borderRadius: 11, background: '#171923',
    color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 650,
  },
  sectionLabel: { margin: '0 0 11px 2px', color: '#777b84', fontSize: 12, lineHeight: '17px', fontWeight: 650 },
  contacts: { height: 56, margin: '0 0 13px', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 },
  contact: {
    minWidth: 0, height: 56, display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 4,
    padding: 0, border: 0, background: 'transparent', color: '#555963', cursor: 'pointer', font: 'inherit',
  },
  contactName: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, lineHeight: '14px' },
  search: {
    height: 42, flex: 'none', margin: '0 0 13px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 9,
    border: '1px solid #e1e2e6', borderRadius: 12, color: '#92969e', background: '#fff', boxSizing: 'border-box',
  },
  searchInput: { minWidth: 0, flex: 1, border: 0, outline: 0, padding: 0, background: 'transparent', color: '#20232c', font: 'inherit', fontSize: 13 },
  list: { minHeight: 0, flex: 1, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' },
  callRow: {
    width: '100%', minHeight: 64, display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) auto',
    alignItems: 'center', gap: 10, padding: '8px 8px', border: 0, borderRadius: 13,
    background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  callRowSelected: { background: '#f1f2f6' },
  callContent: { minWidth: 0, display: 'grid', gap: 4 },
  callNameLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  callName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  sampleBadge: { height: 17, padding: '0 5px', borderRadius: 5, background: '#eef0f5', color: '#8b9099', fontSize: 10, lineHeight: '17px' },
  callMeta: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, color: '#8f949d', fontSize: 11, lineHeight: '16px' },
  callTime: { alignSelf: 'start', paddingTop: 8, color: '#a0a3aa', fontSize: 11, whiteSpace: 'nowrap' },
  status: { padding: '18px 6px', color: '#8c9098', fontSize: 12, textAlign: 'center', lineHeight: '18px' },
  content: { minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff' },
  empty: {
    flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 32, boxSizing: 'border-box',
    textAlign: 'center', color: '#555963',
  },
  emptyInner: { transform: 'translateY(-10px)', display: 'grid', justifyItems: 'center', gap: 9 },
  emptyIcon: { color: '#606672' },
  emptyTitle: { margin: 0, color: '#333743', fontSize: 17, lineHeight: '24px', fontWeight: 650 },
  emptyCopy: { margin: 0, color: '#92969e', fontSize: 12, lineHeight: '18px' },
  startCenter: {
    height: 37, marginTop: 10, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8,
    border: 0, borderRadius: 10, background: '#171923', color: '#fff', cursor: 'pointer',
    font: 'inherit', fontSize: 12, fontWeight: 650,
  },
  detailHeader: {
    height: 68, flex: 'none', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid #ededef', boxSizing: 'border-box',
  },
  detailIdentity: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 },
  detailTitleBlock: { minWidth: 0, display: 'grid', gap: 3 },
  detailTitle: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 16, lineHeight: '22px', fontWeight: 650 },
  detailSub: { margin: 0, color: '#8f949d', fontSize: 12, lineHeight: '17px' },
  detailActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 36, height: 36, display: 'grid', placeItems: 'center', border: '1px solid #e1e2e6',
    borderRadius: 10, background: '#fff', color: '#3e424c', cursor: 'pointer',
  },
  iconButtonPrimary: { borderColor: '#171923', background: '#171923', color: '#fff' },
  detailBody: { minHeight: 0, flex: 1, overflowY: 'auto', padding: '24px 28px 36px', boxSizing: 'border-box' },
  card: { maxWidth: 720, margin: '0 auto 18px', padding: 16, borderRadius: 14, background: '#f7f8fa', boxSizing: 'border-box' },
  cardTitle: { margin: '0 0 9px', color: '#343840', fontSize: 13, lineHeight: '18px', fontWeight: 650 },
  cardText: { margin: 0, color: '#4f545d', fontSize: 13, lineHeight: '22px', whiteSpace: 'pre-wrap' },
  sampleMedia: { maxWidth: 720, margin: '0 auto 18px', display: 'grid', gap: 4 },
  sampleImageFrame: { position: 'relative', overflow: 'hidden', borderRadius: 14, border: '1px solid #dde1e8', background: '#11141a', aspectRatio: '16 / 9', boxShadow: '0 16px 34px rgba(23,25,35,.08)' },
  sampleImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  videoInset: { position: 'absolute', top: 12, right: 12, width: 95, height: 126, overflow: 'hidden', borderRadius: 12, border: '1px solid rgba(255,255,255,.78)', background: '#151923', boxShadow: '0 10px 22px rgba(0,0,0,.22)' },
  videoInsetImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  videoPreviewFallback: { width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#11161f' },
  videoPreviewFigure: { width: '40%', maxWidth: 156, aspectRatio: '1 / 1', borderRadius: 999, background: '#77869a', opacity: .72 },
  videoPill: { position: 'absolute', zIndex: 2, padding: '5px 8px', borderRadius: 7, background: 'rgba(22,24,30,.66)', color: '#fff', fontSize: 10, lineHeight: '14px', fontWeight: 650 },
  videoPillTop: { top: 12, left: 12 },
  videoPillBottomLeft: { left: 12, bottom: 12 },
  videoPillBottomRight: { right: 12, bottom: 12 },
  videoPlay: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 54, height: 54, display: 'grid', placeItems: 'center', borderRadius: 999, background: 'rgba(255,255,255,.72)', color: '#fff', boxShadow: '0 8px 22px rgba(0,0,0,.18)' },
  videoPlayButton: { border: 0, padding: 0, cursor: 'pointer' },
  realVideo: { width: '100%', height: '100%', display: 'block', objectFit: 'cover', background: '#11141a' },
  videoControls: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, minHeight: 48, padding: '12px 14px 13px',
    display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', alignItems: 'center', gap: 10,
    color: '#fff', background: 'linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,.08), rgba(0,0,0,0))',
    boxSizing: 'border-box',
  },
  videoControlButton: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 999, background: 'rgba(255,255,255,.88)', color: '#171923', cursor: 'pointer' },
  videoProgressTrack: { position: 'relative', height: 4, overflow: 'hidden', borderRadius: 999, background: 'rgba(255,255,255,.38)' },
  videoProgressFill: { position: 'absolute', inset: '0 auto 0 0', borderRadius: 999, background: '#fff' },
  videoTimeText: { color: 'rgba(255,255,255,.92)', fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  videoUnavailable: { minHeight: 220, display: 'grid', placeItems: 'center', color: '#8c929d', fontSize: 13, lineHeight: '20px', background: '#f5f7fb' },
  videoTitleRow: { width: '100%', maxWidth: 720, justifySelf: 'stretch', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxSizing: 'border-box' },
  videoTitleText: { minWidth: 0, flex: '1 1 auto', display: 'flex', alignItems: 'baseline', gap: 8 },
  videoTitle: { margin: 0, color: '#343840', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  videoCaption: { color: '#9a9ea6', fontSize: 11, lineHeight: '16px' },
  sampleSwitch: {
    height: 32, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 9,
    background: '#f4f5f8', color: '#3e424c', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600,
  },
  transcript: { maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 },
  transcriptHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'flex-start', gap: 8, paddingBottom: 10, borderBottom: '1px solid #e6e8ee' },
  transcriptTitle: { margin: 0, color: '#343840', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  transcriptCount: { color: '#9a9ea6', fontSize: 11, lineHeight: '16px' },
  transcriptEmpty: { margin: '10px 0 0', color: '#8f949d', fontSize: 13, lineHeight: '21px' },
  segment: { display: 'flex', gap: 9, alignItems: 'flex-start' },
  segmentMine: { justifyContent: 'flex-end' },
  segmentStack: { maxWidth: '76%', minWidth: 0, display: 'grid', gap: 5, justifyItems: 'start' },
  segmentStackMine: { justifyItems: 'end' },
  segmentBubble: { maxWidth: '76%', padding: '9px 11px', borderRadius: '5px 14px 14px 14px', background: '#f3f4f6', color: '#30343d' },
  segmentBubbleMine: { borderRadius: '14px 5px 14px 14px', background: '#eef1f8' },
  segmentBubbleInStack: { maxWidth: '100%' },
  segmentMeta: { display: 'block', color: '#8f949d', fontSize: 10, lineHeight: '14px' },
  segmentText: { margin: 0, fontSize: 13, lineHeight: '21px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  endEvent: { maxWidth: 360, margin: '6px auto 0', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, color: '#a4a8b0', fontSize: 10 },
  endLine: { height: 1, background: '#e6e7eb' },
  notice: { position: 'absolute', left: 24, right: 24, bottom: 18, color: '#777c86', fontSize: 12, textAlign: 'center' },
  layer: {
    position: 'absolute', inset: 0, zIndex: 9, display: 'grid', placeItems: 'center', padding: 24,
    background: 'rgba(246, 247, 249, .52)', backdropFilter: 'blur(2px)', boxSizing: 'border-box',
  },
  picker: {
    width: 360, maxWidth: 'calc(100vw - 48px)', height: 'min(620px, calc(100vh - 48px))',
    display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain',
    padding: 14, border: '1px solid #e1e2e6',
    borderRadius: 18, background: 'rgba(255,255,255,.98)', boxShadow: '0 22px 58px rgba(23,25,35,.18)',
    boxSizing: 'border-box',
  },
  pickerHeader: { height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pickerTitle: { margin: 0, color: '#242832', fontSize: 15, lineHeight: '21px', fontWeight: 650 },
  closeButton: {
    width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9,
    background: 'transparent', color: '#676c76', cursor: 'pointer',
  },
  pickerSearch: {
    height: 36, minHeight: 36, flex: 'none', margin: '0 0 13px', padding: '0 10px',
    display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 9,
    color: '#90949d', background: '#f2f3f5', boxSizing: 'border-box',
  },
  pickerInput: { minWidth: 0, flex: 1, border: 0, outline: 0, padding: 0, background: 'transparent', color: '#30333c', font: 'inherit', fontSize: 12 },
  recommendation: {
    minHeight: 58, marginBottom: 12, padding: '9px 10px', display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto',
    alignItems: 'center', gap: 9, borderRadius: 13, background: '#f7f8fb', boxSizing: 'border-box',
  },
  pickerText: { minWidth: 0, display: 'grid', gap: 3 },
  pickerName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#262a34', fontSize: 13, lineHeight: '18px', fontWeight: 650 },
  pickerSub: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8f949d', fontSize: 11, lineHeight: '15px' },
  pickerActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 6 },
  pickerRound: {
    width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid #e1e2e6',
    borderRadius: 10, background: '#fff', color: '#3b404a', cursor: 'pointer',
  },
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
  pickerEmpty: { padding: '24px 12px 20px', display: 'grid', justifyItems: 'center', gap: 7, color: '#818690', textAlign: 'center', fontSize: 12, lineHeight: '18px' },
  typePicker: {
    width: 320, maxWidth: 'calc(100vw - 48px)', padding: 13, border: '1px solid #e1e2e6',
    borderRadius: 18, background: 'rgba(255,255,255,.98)', boxShadow: '0 22px 58px rgba(23,25,35,.18)',
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
    borderRadius: 13, background: 'transparent', color: '#242832', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  typeOptionDisabled: { cursor: 'default', opacity: .58 },
  typeIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 11, background: '#f0f2f6', color: '#3c414c' },
  unavailable: { margin: '8px 3px 2px', color: '#8f949d', fontSize: 12, lineHeight: '18px' },
}

function withCallCssVars(style: CSSProperties, vars: Record<`--${string}`, string>): CSSProperties {
  return { ...style, ...vars } as CSSProperties
}

function mergeCallStyles(base: Record<string, CSSProperties>, overrides: Record<string, CSSProperties>): Record<string, CSSProperties> {
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { ...value, ...(overrides[key] ?? {}) }])) as Record<string, CSSProperties>
}

const lightCallStyles = styles
const darkCallStyles = mergeCallStyles(lightCallStyles, {
  root: withCallCssVars({
    background: arkmeTheme.base,
    color: arkmeTheme.text,
  }, {
    '--arkme-call-video-icon-filter': 'invert(1) brightness(1.8)',
    '--arkme-call-avatar-bg': arkmeTheme.layer2,
  }),
  browser: { borderRight: `1px solid ${arkmeTheme.borderSoft}`, background: arkmeTheme.base },
  subtitle: { color: arkmeTheme.tertiary },
  startWide: { background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  sectionLabel: { color: arkmeTheme.tertiary },
  contact: { color: arkmeTheme.secondary },
  search: { border: `1px solid ${arkmeTheme.border}`, color: arkmeTheme.tertiary, background: arkmeTheme.input },
  searchInput: { color: arkmeTheme.text },
  callRowSelected: { background: arkmeTheme.active },
  sampleBadge: { background: arkmeTheme.layer2, color: arkmeTheme.tertiary },
  callMeta: { color: arkmeTheme.tertiary },
  callTime: { color: arkmeTheme.tertiary },
  status: { color: arkmeTheme.tertiary },
  content: { background: arkmeTheme.base },
  empty: { color: arkmeTheme.secondary },
  emptyIcon: { color: arkmeTheme.tertiary },
  emptyTitle: { color: arkmeTheme.text },
  emptyCopy: { color: arkmeTheme.tertiary },
  startCenter: { background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  detailHeader: { borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  detailSub: { color: arkmeTheme.tertiary },
  iconButton: { border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.elevated, color: arkmeTheme.text },
  iconButtonPrimary: { borderColor: arkmeTheme.primaryAction, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  card: { background: arkmeTheme.layer1 },
  cardTitle: { color: arkmeTheme.text },
  cardText: { color: arkmeTheme.secondary },
  sampleImageFrame: { border: `1px solid ${arkmeTheme.border}`, boxShadow: 'none' },
  videoUnavailable: { color: arkmeTheme.tertiary, background: arkmeTheme.layer1 },
  videoTitle: { color: arkmeTheme.text },
  videoCaption: { color: arkmeTheme.tertiary },
  sampleSwitch: { background: arkmeTheme.elevated, color: arkmeTheme.text },
  transcriptHeader: { borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  transcriptTitle: { color: arkmeTheme.text },
  transcriptCount: { color: arkmeTheme.tertiary },
  transcriptEmpty: { color: arkmeTheme.tertiary },
  segmentBubble: { background: arkmeTheme.messageOther, color: arkmeTheme.text },
  segmentBubbleMine: { background: arkmeTheme.messageOwn },
  segmentMeta: { color: arkmeTheme.tertiary },
  endEvent: { color: arkmeTheme.tertiary },
  endLine: { background: arkmeTheme.borderSoft },
  notice: { color: arkmeTheme.tertiary },
  layer: { background: 'var(--dsw-alias-bg-mask-1, rgba(5, 8, 13, .58))' },
  picker: { border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.menu, boxShadow: arkmeTheme.shadow },
  pickerTitle: { color: arkmeTheme.text },
  closeButton: { color: arkmeTheme.secondary },
  pickerSearch: { border: 0, color: arkmeTheme.tertiary, background: arkmeTheme.input },
  pickerInput: { color: arkmeTheme.text },
  recommendation: { background: arkmeTheme.layer1 },
  pickerName: { color: arkmeTheme.text },
  pickerSub: { color: arkmeTheme.tertiary },
  pickerRound: { border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.elevated, color: arkmeTheme.text },
  pickerEmpty: { color: arkmeTheme.tertiary },
  typePicker: { border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.menu, boxShadow: arkmeTheme.shadow },
  typeOption: { color: arkmeTheme.text },
  typeIcon: { background: arkmeTheme.input, color: arkmeTheme.secondary },
  unavailable: { color: arkmeTheme.tertiary },
})

function readCallSurfaceDarkMode(): boolean {
  const doc = typeof document === 'undefined' ? undefined : document
  if (doc !== undefined) {
    if (doc.body?.hasAttribute('data-ds-dark-theme') === true) return true
    const themeTokens = [
      doc.body?.getAttribute('data-ds-dark-theme'),
      doc.documentElement.dataset.theme,
      doc.documentElement.dataset.colorScheme,
      doc.body?.dataset.theme,
      doc.body?.dataset.colorScheme,
      doc.documentElement.className,
      doc.body?.className,
    ].join(' ').toLowerCase()
    if (/\b(dark|theme-dark|dark-mode)\b/.test(themeTokens)) return true
    if (/\b(light|theme-light|light-mode)\b/.test(themeTokens)) return false
  }
  if (typeof matchMedia === 'function') return matchMedia('(prefers-color-scheme: dark)').matches
  return false
}

function useCallSurfaceDarkMode(): boolean {
  const [darkMode, setDarkMode] = useState(readCallSurfaceDarkMode)
  useEffect(() => {
    const update = () => { setDarkMode(readCallSurfaceDarkMode()) }
    const mediaQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
    mediaQuery?.addEventListener?.('change', update)
    mediaQuery?.addListener?.(update)
    const observer = typeof MutationObserver === 'undefined' || typeof document === 'undefined'
      ? undefined
      : new MutationObserver(update)
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'data-ds-dark-theme'] })
    if (observer !== undefined && typeof document !== 'undefined' && document.body !== null) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'data-ds-dark-theme'] })
    }
    update()
    return () => {
      mediaQuery?.removeEventListener?.('change', update)
      mediaQuery?.removeListener?.(update)
      observer?.disconnect()
    }
  }, [])
  return darkMode
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.trunc(seconds))
  const minutes = Math.floor(value / 60)
  const rest = value % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function shortTime(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return ''
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function clockTime(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return ''
  return new Date(millis).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function mediaLabel(type: ArkmeCallMediaType): string {
  if (type === 'video') return '视频通话'
  if (type === 'audio') return '语音通话'
  return '通话'
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
  return `${item.stableId}:${item.callRef}`
}

function cleanAvatarRef(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? undefined : normalized
}

function CallVideoIcon({ size = 16, style }: { size?: number; style?: CSSProperties }) {
  return <img
    src={`${CALL_ASSET_ROOT}/arkme-video-linear.svg`}
    alt=""
    width={size}
    height={size}
    aria-hidden="true"
    draggable={false}
    style={{ width: size, height: size, display: 'block', objectFit: 'contain', filter: 'var(--arkme-call-video-icon-filter, none)', ...style }}
    data-arkme-call-video-icon="compact"
  />
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
  await Promise.allSettled([...unique].map(ref => loadArkmeImageDataUrl(ref)))
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

function CallAvatar({ name, avatarRef, assetUrl, size = 40 }: { name: string; avatarRef?: string | undefined; assetUrl?: string | undefined; size?: number }) {
  if (assetUrl !== undefined) return <span style={{
    width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: 999, background: 'var(--arkme-call-avatar-bg, #f0f2f6)',
  }} aria-label={`${name}头像`}>
    <img src={assetUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
  </span>
  const normalizedRef = cleanAvatarRef(avatarRef)
  return <ArkmeUserAvatar
    {...(normalizedRef === undefined ? {} : { avatarRef: normalizedRef })}
    size={size}
    fallback={{ kind: 'phone_default', colorIndex: name.length, label: name.slice(0, 1) || '即' }}
    label={`${name}头像`}
  />
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
    : `${target.relation} · 需先拥有私聊会话`
  if (target.contactRef !== undefined) return target.relation
  if (target.source === undefined) return `${target.relation} · 可发起通话`
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

export function ArkmeCallSurface({ initialPickerOpen = false }: ArkmeCallSurfaceProps = {}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<ArkmeCallHistoryPage>()
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyError, setHistoryError] = useState('')
  const [selectedRef, setSelectedRef] = useState('')
  const [detail, setDetail] = useState<ArkmeCallDetail>()
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')
  const [sources, setSources] = useState<ArkmeSourceItem[]>([])
  const [notice, setNotice] = useState('')
  const [pickerOpen, setPickerOpen] = useState(initialPickerOpen)
  const [pickerQuery, setPickerQuery] = useState('')
  const [contactSearchResult, setContactSearchResult] = useState<ArkmeContactSearchResult>()
  const [contactSearchState, setContactSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [contactSearchError, setContactSearchError] = useState('')
  const [typeTarget, setTypeTarget] = useState<CallTarget>()
  const [typePickerPlacement, setTypePickerPlacement] = useState<TypePickerPlacement>({ kind: 'center' })
  const [unavailableTarget, setUnavailableTarget] = useState<CallTarget>()
  const [callingKey, setCallingKey] = useState('')
  const [officialAuthorProfile, setOfficialAuthorProfile] = useState<ArkmeOfficialAuthorProfile>()
  const [samplePerspective, setSamplePerspective] = useState<SamplePerspective>('primary')
  const [playingVideoKey, setPlayingVideoKey] = useState('')
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [failedVideoPreviewKeys, setFailedVideoPreviewKeys] = useState<readonly string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const historyGenerationRef = useRef(0)
  const historyAbortRef = useRef<AbortController>()
  const historyRefreshTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const detailGenerationRef = useRef(0)
  const darkMode = useCallSurfaceDarkMode()
  const styles = useMemo(() => darkMode ? darkCallStyles : lightCallStyles, [darkMode])

  const refreshHistory = useCallback((options: { silent?: boolean } = {}) => {
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    const generation = historyGenerationRef.current + 1
    historyGenerationRef.current = generation
    if (options.silent !== true) setHistoryState('loading')
    setHistoryError('')
    void callArkme<ArkmeCallHistoryPage>('calls.history.list', { limit: 30, includeRecentContacts: true }, controller.signal)
      .then(async value => {
        await preloadHistoryAvatars(value)
        if (controller.signal.aborted || historyGenerationRef.current !== generation) return
        setPage(value)
        setHistoryState('ready')
      })
      .catch(error => {
        if (controller.signal.aborted || historyGenerationRef.current !== generation || options.silent === true) return
        setHistoryError(readableError(error))
        setHistoryState('error')
      })
  }, [])

  useEffect(() => {
    refreshHistory()
    return () => {
      historyAbortRef.current?.abort()
      if (historyRefreshTimerRef.current !== undefined) clearTimeout(historyRefreshTimerRef.current)
    }
  }, [refreshHistory])

  useEffect(() => outgoingCallUi.subscribeSettled(() => {
    refreshHistory({ silent: true })
    if (historyRefreshTimerRef.current !== undefined) clearTimeout(historyRefreshTimerRef.current)
    historyRefreshTimerRef.current = setTimeout(() => {
      refreshHistory({ silent: true })
      historyRefreshTimerRef.current = undefined
    }, CALL_HISTORY_SETTLED_REFRESH_DELAY_MS)
  }), [refreshHistory])

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
        if (avatarRef !== undefined) await loadArkmeImageDataUrl(avatarRef).catch(() => undefined)
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
          if (avatarRef !== undefined) await loadArkmeImageDataUrl(avatarRef).catch(() => undefined)
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
  const sampleItems = historyState === 'ready' ? SAMPLE_CALLS : []
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
  const selectedItem = selectableItems.find(item => item.callRef === selectedRef)
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

  const selectItem = useCallback((item: ArkmeCallHistoryItem) => {
    const generation = detailGenerationRef.current + 1
    detailGenerationRef.current = generation
    setSelectedRef(item.callRef)
    setSamplePerspective('primary')
    setPlayingVideoKey('')
    setVideoPlaying(false)
    setVideoCurrentTime(0)
    setVideoDuration(0)
    setNotice('')
    setDetail(undefined)
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
    setDetailState('loading')
    setDetailError('')
    void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef: item.callRef }, controller.signal)
      .then(value => {
        if (detailGenerationRef.current !== generation) return
        setDetail(value)
        setDetailState('ready')
      })
      .catch(error => {
        if (detailGenerationRef.current !== generation) return
        setDetailError(readableError(error))
        setDetailState('error')
      })
  }, [])

  const openPicker = useCallback((initialQuery = '') => {
    setPickerQuery(initialQuery)
    setPickerOpen(true)
    setTypeTarget(undefined)
    setTypePickerPlacement({ kind: 'center' })
    setUnavailableTarget(undefined)
    setNotice('')
  }, [])

  const requestTargetCall = useCallback((target: CallTarget, mediaType: 'audio' | 'video') => {
    if (callingKey !== '') return
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
    setCallingKey(requestKey)
    void (async () => {
      let source = target.source
      if (source === undefined) {
        const opened = target.officialAuthor === true
          ? await callArkme<ArkmeOpenPrivateChatResult>('chat.official-author.private.open')
          : target.contactRef !== undefined
            ? await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open-from-contact', {
              contactRef: target.contactRef,
            })
          : await (async () => {
            const peerUserId = target.peerUserId
            if (peerUserId === undefined) throw new Error('还没有找到这个联系人对应的私聊会话')
            return await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
              peerUserId,
              displayName: target.displayName,
            })
          })()
        source = opened.source
        rememberSource(opened.source)
      }
      outgoingCallUi.request({ sourceRef: source.sourceRef, displayName: source.displayName || target.displayName, mediaType })
      setNotice('')
    })()
      .catch(error => {
        setNotice(readableError(error) || '发起通话失败，请稍后重试')
        setTypeTarget(target)
        setTypePickerPlacement({ kind: 'center' })
        setUnavailableTarget(targetCanResolve(target) ? undefined : target)
      })
      .finally(() => { setCallingKey('') })
  }, [callingKey, rememberSource])

  const openTargetTypePicker = useCallback((target: CallTarget, anchor?: HTMLElement, options: { keepPickerOpen?: boolean } = {}) => {
    if (options.keepPickerOpen !== true) setPickerOpen(false)
    setTypeTarget(target)
    setTypePickerPlacement(typePickerPlacementFromAnchor(anchor))
    setUnavailableTarget(targetCanResolve(target) ? undefined : target)
    setNotice('')
  }, [])

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
    const selected = item.callRef === selectedRef
    return <li key={callKey(item)}>
      <button
        type="button"
        aria-pressed={selected}
        style={{ ...styles.callRow, ...(selected ? styles.callRowSelected : {}) }}
        onClick={() => { selectItem(item) }}
      >
        <CallAvatar name={item.peerDisplayName} avatarRef={sample ? undefined : avatarRefForCall(item)} assetUrl={sample ? sampleAvatarUrl(item.peerDisplayName) : undefined} />
        <span style={styles.callContent}>
          <span style={styles.callNameLine}>
            <strong style={styles.callName}>{item.peerDisplayName}</strong>
            {sample && <em style={styles.sampleBadge}>示例</em>}
          </span>
          <span style={styles.callMeta}>
            {item.mediaType === 'video' ? <CallVideoIcon size={14} /> : <PhoneCall size={14} />}
            {mediaLabel(item.mediaType)} · {formatDuration(item.durationSeconds)}
          </span>
        </span>
        <time style={styles.callTime}>{sample ? item.resultLabel : shortTime(item.startedAtMillis)}</time>
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
  const setVideoRef = useCallback((key: string, element: HTMLVideoElement | null) => {
    if (element === null) {
      videoRefs.current.delete(key)
      return
    }
    videoRefs.current.set(key, element)
  }, [])
  const syncVideoElements = useCallback((time?: number) => {
    const videos = [...videoRefs.current.values()]
    if (videos.length === 0) return
    const targetTime = time ?? videos[0]?.currentTime ?? 0
    for (const video of videos) {
      if (Number.isFinite(targetTime) && Math.abs(video.currentTime - targetTime) > 0.35) {
        try { video.currentTime = targetTime } catch {}
      }
      if (videoPlaying) {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }
  }, [videoPlaying])
  useEffect(() => {
    syncVideoElements(videoCurrentTime)
  }, [playingVideoKey, samplePerspective, syncVideoElements, videoCurrentTime])
  const videoPerspectiveLabel = (perspective: ArkmeCallVideoPerspective | undefined, fallback: string): string => {
    const explicit = perspective?.label?.trim() ?? ''
    if (explicit !== '') {
      if (explicit.endsWith('视角')) return explicit
      if (perspective?.perspective === 'peer') return `${explicit}的视角`
      return explicit
    }
    if (perspective?.perspective === 'self') return '你的视角'
    if (perspective?.perspective === 'peer') return selectedItem?.peerDisplayName === undefined ? '对方视角' : `${selectedItem.peerDisplayName}的视角`
    if (perspective?.perspective === 'main') return '主视角'
    return fallback
  }
  const videoPerspectiveKey = (perspective: ArkmeCallVideoPerspective): string => {
    return `${perspective.perspective}:${perspective.videoUrl ?? ''}:${perspective.posterUrl ?? ''}`
  }
  const markVideoPreviewFailed = useCallback((key: string) => {
    setFailedVideoPreviewKeys(current => current.includes(key) ? current : [...current, key])
  }, [])
  const startVideoPlayback = (perspective: ArkmeCallVideoPerspective) => {
    setPlayingVideoKey(videoPerspectiveKey(perspective))
    setVideoPlaying(true)
  }
  const toggleVideoPlayback = () => {
    setVideoPlaying(value => !value)
  }
  const renderVideoPreviewFallback = (label: string, inset = false) => {
    return <span
      aria-label={`${label}缩略图暂不可用`}
      style={styles.videoPreviewFallback}
    >
      <span style={{ ...styles.videoPreviewFigure, width: inset ? '48%' : '32%' }} />
    </span>
  }
  const renderPerspectiveMedia = (
    perspective: ArkmeCallVideoPerspective,
    options: { inset?: boolean; alt: string; active?: boolean },
  ) => {
    const style = options.inset === true ? styles.videoInsetImage : styles.realVideo
    const key = videoPerspectiveKey(perspective)
    const previewFailed = failedVideoPreviewKeys.includes(key)
    const shouldRenderVideo = options.active === true && perspective.videoUrl !== undefined
    const shouldShowPoster = perspective.posterUrl !== undefined
      && !previewFailed
      && !shouldRenderVideo
    if (shouldShowPoster) return <img
      src={perspective.posterUrl}
      alt={options.alt}
      draggable={false}
      onError={() => { markVideoPreviewFailed(key) }}
      style={options.inset === true ? styles.videoInsetImage : styles.sampleImage}
    />
    if (!shouldRenderVideo && perspective.videoUrl !== undefined) return <video
      key={`${perspective.videoUrl}:${options.inset === true ? 'preview-inset' : 'preview-main'}`}
      src={perspective.videoUrl}
      muted
      preload="auto"
      playsInline
      aria-label={options.alt}
      style={style}
    />
    if (perspective.videoUrl !== undefined) return <video
      key={`${perspective.videoUrl}:${options.inset === true ? 'inset' : 'main'}`}
      ref={element => { setVideoRef(key, element) }}
      src={perspective.videoUrl}
      {...(perspective.posterUrl === undefined ? {} : { poster: perspective.posterUrl })}
      controls={false}
      muted={options.inset === true}
      autoPlay={options.active === true && videoPlaying}
      preload="metadata"
      playsInline
      onLoadedMetadata={event => {
        if (options.inset === true) return
        const duration = event.currentTarget.duration
        if (Number.isFinite(duration) && duration > 0) setVideoDuration(duration)
      }}
      onTimeUpdate={event => {
        if (options.inset === true) return
        const current = event.currentTarget.currentTime
        const duration = event.currentTarget.duration
        setVideoCurrentTime(Number.isFinite(current) ? current : 0)
        if (Number.isFinite(duration) && duration > 0) setVideoDuration(duration)
        syncVideoElements(current)
      }}
      onEnded={() => { setVideoPlaying(false) }}
      style={style}
    />
    if (perspective.posterUrl !== undefined) return <img
      src={perspective.posterUrl}
      alt={options.alt}
      draggable={false}
      onError={() => { markVideoPreviewFailed(key) }}
      style={options.inset === true ? styles.videoInsetImage : styles.sampleImage}
    />
    return renderVideoPreviewFallback(videoPerspectiveLabel(perspective, '视频'), options.inset === true)
  }
  const renderVideoRecord = () => {
    if (selectedItem === undefined || selectedItem.mediaType !== 'video') return null
    const titleCaption = selectedIsSample ? '功能示例 · 完整保留双方画面' : '完整保留双方画面'
    const videoRecord = detail?.videoRecord
    const realPerspectives = videoRecord?.perspectives?.filter(item => item.videoUrl !== undefined || item.posterUrl !== undefined) ?? []
    const realMain = samplePerspective === 'primary'
      ? realPerspectives[0]
      : realPerspectives[1] ?? realPerspectives[0]
    const realInset = samplePerspective === 'primary'
      ? realPerspectives[1]
      : realPerspectives[0]
    const canSwitchRealPerspective = realPerspectives.length > 1
    const sampleMain = samplePerspective === 'primary' ? SAMPLE_VIDEO_PEER_URL : SAMPLE_VIDEO_SELF_URL
    const sampleInset = samplePerspective === 'primary' ? SAMPLE_VIDEO_SELF_URL : SAMPLE_VIDEO_PEER_URL
    const sampleMainLabel = samplePerspective === 'primary' ? '你的视角' : selectedItem.peerDisplayName
    const sampleInsetLabel = samplePerspective === 'primary' ? selectedItem.peerDisplayName : '你的视角'
    const realPlaybackActive = realMain !== undefined && playingVideoKey === videoPerspectiveKey(realMain)
    const progress = videoDuration > 0 ? Math.min(1, Math.max(0, videoCurrentTime / videoDuration)) : 0
    const realMainPillBottom = realPlaybackActive ? 50 : 12
    const hasRenderableVideo = selectedIsSample || realPerspectives.length > 0 || videoRecord?.videoUrl !== undefined || videoRecord?.posterUrl !== undefined
    const accepted = detail?.acceptedAtMillis ?? selectedItem.acceptedAtMillis
    if (!selectedIsSample && detailState !== 'ready') return null
    if (!hasRenderableVideo && accepted <= 0) return null
    return <section style={styles.sampleMedia} aria-label="视频记录">
      <header style={styles.videoTitleRow} data-arkme-call-video-title-row="aligned">
        <span style={styles.videoTitleText}>
          <h3 style={styles.videoTitle}>视频记录</h3>
          <span style={styles.videoCaption}>{titleCaption}</span>
        </span>
        {(selectedIsSample || canSwitchRealPerspective) && <button
          type="button"
          style={styles.sampleSwitch}
          data-arkme-call-video-title-action="switch-perspective"
          onClick={() => {
            setPlayingVideoKey('')
            setVideoPlaying(false)
            setVideoCurrentTime(0)
            setSamplePerspective(value => value === 'primary' ? 'secondary' : 'primary')
          }}
        ><ArrowClockwise size={13} />切换视角</button>}
      </header>
      <div style={styles.sampleImageFrame}>
        {selectedIsSample ? <>
          <img
            src={sampleMain}
            alt={`${selectedItem.peerDisplayName}示例主画面`}
            draggable={false}
            style={styles.sampleImage}
          />
          <span style={{ ...styles.videoPill, ...styles.videoPillTop }}>示例画面</span>
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomLeft }}>{sampleMainLabel}</span>
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomRight }}>{formatDuration(selectedItem.durationSeconds)}</span>
          <span style={styles.videoInset}>
            <img
              src={sampleInset}
              alt={`${sampleInsetLabel}示例小窗`}
              draggable={false}
              style={styles.videoInsetImage}
            />
            <span style={{ ...styles.videoPill, right: 7, bottom: 7, padding: '4px 6px', fontSize: 9 }}>{sampleInsetLabel}</span>
          </span>
          <span style={styles.videoPlay} aria-hidden="true"><Play size={25} weight="fill" /></span>
        </> : realMain !== undefined ? <>
          {renderPerspectiveMedia(realMain, { alt: `${videoPerspectiveLabel(realMain, '主视角')}视频通话记录画面`, active: realPlaybackActive })}
          {realMain.videoUrl !== undefined && !realPlaybackActive && <button
            type="button"
            style={{ ...styles.videoPlay, ...styles.videoPlayButton }}
            aria-label="播放视频记录"
            onClick={() => { startVideoPlayback(realMain) }}
          ><Play size={25} weight="fill" /></button>}
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomLeft, bottom: realMainPillBottom }}>{videoPerspectiveLabel(realMain, '主视角')}</span>
          {!realPlaybackActive && <span style={{ ...styles.videoPill, ...styles.videoPillBottomRight }}>{formatDuration(selectedItem.durationSeconds)}</span>}
          {realInset !== undefined && <span style={styles.videoInset}>
            {renderPerspectiveMedia(realInset, { inset: true, alt: `${videoPerspectiveLabel(realInset, '对方视角')}视频通话记录小窗`, active: realPlaybackActive })}
            <span style={{ ...styles.videoPill, right: 7, bottom: 7, padding: '4px 6px', fontSize: 9 }}>{videoPerspectiveLabel(realInset, '对方视角')}</span>
          </span>}
          {realPlaybackActive && <div style={styles.videoControls} aria-label="视频播放控制" data-arkme-call-video-controls="overlay">
            <button type="button" style={styles.videoControlButton} aria-label={videoPlaying ? '暂停视频记录' : '继续播放视频记录'} onClick={toggleVideoPlayback}>
              {videoPlaying ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            </button>
            <div style={styles.videoProgressTrack} aria-hidden="true">
              <span style={{ ...styles.videoProgressFill, width: `${String(progress * 100)}%` }} />
            </div>
            <span style={styles.videoTimeText}>{formatDuration(videoCurrentTime)} / {formatDuration(videoDuration || selectedItem.durationSeconds)}</span>
          </div>}
        </> : videoRecord?.videoUrl !== undefined ? <video
          src={videoRecord.videoUrl}
          {...(videoRecord.posterUrl === undefined ? {} : { poster: videoRecord.posterUrl })}
          controls
          preload="metadata"
          playsInline
          style={styles.realVideo}
        /> : videoRecord?.posterUrl !== undefined ? <img
          src={videoRecord.posterUrl}
          alt={`${selectedItem.peerDisplayName}视频通话记录画面`}
          draggable={false}
          style={styles.sampleImage}
        /> : <div style={styles.videoUnavailable}>视频记录暂不可用</div>}
      </div>
    </section>
  }

  return <section style={styles.root} aria-label="通话" data-arkme-call-surface-theme={darkMode ? 'dark' : 'light'}>
    <aside style={styles.browser}>
      <header style={styles.heading}>
        <h1 style={styles.title}>通话</h1>
        <p style={styles.subtitle}>让每一次重要的声音与相见，都能被好好记住。</p>
      </header>
      <button type="button" style={styles.startWide} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => { openPicker() }}>
        <PhoneCall size={17} />发起通话
      </button>
      <p style={styles.sectionLabel}>最近联系人</p>
      <div style={styles.contacts} aria-label="最近联系人" data-arkme-call-recent-contacts="rail">
        {contacts.slice(0, 5).map(contact => <button
	          key={`${String(contact.userId)}:${contact.displayName}`}
	          type="button"
	          style={styles.contact}
	          aria-label={`选择${contact.displayName}通话方式`}
	          onClick={event => { openContact(contact, event) }}
	        >
          <CallAvatar name={contact.displayName} avatarRef={cleanAvatarRef(contact.avatarRef) ?? avatarRefForName(contact.displayName)} size={30} />
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
          placeholder="搜索通话记录"
          aria-label="搜索通话记录"
        />
      </label>
      <p style={styles.sectionLabel}>最近通话</p>
      {historyState === 'loading' ? <div style={styles.status}>正在读取通话记录...</div>
        : historyState === 'error' ? <div style={styles.status}>{historyError || '通话记录暂时不可用'}</div>
          : callRows.length === 0 ? <div style={styles.status}>{query.trim() === '' ? '还没有通话记录' : '没有符合条件的通话'}</div>
            : <ul style={styles.list}>{callRows.map(row => renderCallRow(row.item, row.sample))}</ul>}
    </aside>
    <main style={styles.content}>
      {selectedItem === undefined ? <div style={styles.empty}>
        <div style={styles.emptyInner}>
          <PhoneCall size={25} style={styles.emptyIcon} />
          <h2 style={styles.emptyTitle}>从一次问候开始</h2>
          <p style={styles.emptyCopy}>找一位想联系的人，聊过的声音和画面会留在这里。</p>
          <button type="button" style={styles.startCenter} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => { openPicker() }}>
            <Plus size={16} />发起通话
          </button>
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
            <button type="button" style={styles.iconButton} aria-label={`和${selectedItem.peerDisplayName}语音通话`} onClick={() => { startSelectedCall('audio') }}><PhoneCall size={19} /></button>
            <button type="button" style={styles.iconButton} aria-label={`和${selectedItem.peerDisplayName}视频通话`} onClick={() => { startSelectedCall('video') }}><CallVideoIcon size={19} /></button>
          </div>}
        </header>
        <div style={styles.detailBody}>
          <section style={styles.card}>
            <h3 style={styles.cardTitle}>AI 摘要</h3>
            <p style={styles.cardText}>
              {detailState === 'loading' ? '正在读取通话详情...'
                : detailState === 'error' ? detailError || '通话详情暂时不可用'
                  : detail?.summaryText ?? selectedItem.summaryPreview ?? '这次通话还没有摘要。'}
            </p>
          </section>
          {renderVideoRecord()}
          {detail?.transcriptSegments !== undefined && detail.transcriptSegments.length > 0 && <section style={styles.transcript}>
            <header style={styles.transcriptHeader} data-arkme-call-transcript-header="aligned">
              <h3 style={styles.transcriptTitle}>通话转写</h3>
              <span style={styles.transcriptCount}>{detail.transcriptSegments.length} 段对话</span>
            </header>
            {detail.transcriptSegments.map(segment => {
              const mine = segment.speakerUserId !== undefined && detail.participants.some(participant => participant.isCurrentUser && participant.userId === segment.speakerUserId)
              const speaker = detail.participants.find(participant => segment.speakerUserId !== undefined && participant.userId === segment.speakerUserId)
                ?? detail.participants.find(participant => participant.displayName.trim() === segment.speakerDisplayName.trim())
              const speakerAvatarRef = cleanAvatarRef(speaker?.avatarRef) ?? avatarRefForName(segment.speakerDisplayName)
              const segmentTime = clockTime(detail.startedAtMillis + segment.startMillis)
              return <article key={segment.segmentId} style={{ ...styles.segment, ...(mine ? styles.segmentMine : {}) }}>
                {!mine && <CallAvatar
                  name={segment.speakerDisplayName}
                  avatarRef={selectedIsSample ? undefined : speakerAvatarRef}
                  assetUrl={selectedIsSample ? sampleAvatarUrl(segment.speakerDisplayName) : undefined}
                  size={30}
                />}
                <span style={{ ...styles.segmentStack, ...(mine ? styles.segmentStackMine : {}) }}>
                  <small style={styles.segmentMeta}>{segment.speakerDisplayName}{segmentTime === '' ? '' : ` · ${segmentTime}`}</small>
                  <span style={{ ...styles.segmentBubble, ...styles.segmentBubbleInStack, ...(mine ? styles.segmentBubbleMine : {}) }}>
                    <p style={styles.segmentText}>{segment.text}</p>
                  </span>
                </span>
                {mine && <CallAvatar
                  name={segment.speakerDisplayName}
                  avatarRef={selectedIsSample ? undefined : speakerAvatarRef}
                  assetUrl={selectedIsSample ? sampleAvatarUrl(segment.speakerDisplayName) : undefined}
                  size={30}
                />}
              </article>
            })}
            <div style={styles.endEvent}>
              <i style={styles.endLine} />
              <span>{selectedItem.peerDisplayName}已挂断通话</span>
              <i style={styles.endLine} />
            </div>
          </section>}
          {detailState === 'ready' && detail !== undefined && detail.transcriptSegments.length === 0 && <section style={styles.transcript} aria-label="通话转写">
            <header style={styles.transcriptHeader} data-arkme-call-transcript-header="aligned">
              <h3 style={styles.transcriptTitle}>通话转写</h3>
              <span style={styles.transcriptCount}>0 段对话</span>
            </header>
            <p style={styles.transcriptEmpty}>暂无转写内容</p>
          </section>}
        </div>
      </>}
      {pickerOpen && <div
        style={styles.layer}
        role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setPickerOpen(false) }}
      >
        <section style={styles.picker} role="dialog" aria-modal="true" aria-label="选择通话联系人">
          <header style={styles.pickerHeader}>
            <h3 style={styles.pickerTitle}>发起通话</h3>
            <button type="button" style={styles.closeButton} aria-label="关闭联系人选择" onClick={() => { setPickerOpen(false) }}><X size={17} /></button>
          </header>
          <label style={styles.pickerSearch}>
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
              aria-label="搜索私聊联系人"
            />
          </label>
          {pickerQuery.trim() === '' && recommendedTarget !== undefined && <section style={styles.recommendation} aria-label="推荐联系人">
            <CallAvatar name={recommendedTarget.displayName} avatarRef={recommendedTarget.avatarRef} size={38} />
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>{recommendedTarget.displayName}</strong>
              <small style={styles.pickerSub}>{recommendedTarget.relation}</small>
            </span>
            <span style={styles.pickerActions}>
              <button type="button" style={styles.pickerRound} aria-label={`和${recommendedTarget.displayName}语音通话`} onClick={() => { requestTargetCall(recommendedTarget, 'audio') }}><PhoneCall size={17} /></button>
              <button type="button" style={styles.pickerRound} aria-label={`和${recommendedTarget.displayName}视频通话`} onClick={() => { requestTargetCall(recommendedTarget, 'video') }}><CallVideoIcon size={17} /></button>
            </span>
          </section>}
          <p style={styles.sectionLabel}>{pickerListTitle}</p>
          <div style={styles.pickerList} data-arkme-call-picker-list="true">
            {filteredPickerTargets.length > 0 ? filteredPickerTargets.map(target => {
              const unavailable = !targetCanResolve(target)
              return <div key={target.key} style={styles.pickerRowFrame}>
                <button
                  type="button"
                  style={{ ...styles.pickerRow, ...(unavailable ? styles.pickerRowDisabled : {}) }}
                  aria-label={unavailable ? `${target.displayName}暂不可直接呼叫` : `选择${target.displayName}通话方式`}
                  onClick={event => { openTargetTypePicker(target, event?.currentTarget, { keepPickerOpen: true }) }}
                >
                  <CallAvatar name={target.displayName} avatarRef={target.avatarRef} size={36} />
                  <span style={styles.pickerText}>
                    <strong style={styles.pickerName}>{target.displayName}</strong>
                    <small style={styles.pickerSub}>{targetSubtitle(target)}</small>
                  </span>
                </button>
                <span style={styles.pickerActions}>
                  <button type="button" style={styles.pickerRound} aria-label={`直接和${target.displayName}语音通话`} onClick={() => { requestTargetCall(target, 'audio') }}><PhoneCall size={16} /></button>
                  <button type="button" style={styles.pickerRound} aria-label={`直接和${target.displayName}视频通话`} onClick={() => { requestTargetCall(target, 'video') }}><CallVideoIcon size={16} /></button>
                </span>
              </div>
            }) : <div style={styles.pickerEmpty}>
              <PhoneCall size={22} />
              <strong>没有可呼叫联系人</strong>
              <span>{pickerQuery.trim() === ''
                ? '先在对话里建立私聊后，就可以从这里发起通话。'
                : contactSearchState === 'loading'
                  ? '正在搜索即我号...'
                  : contactSearchState === 'error'
                    ? contactSearchError || '搜索即我号失败，请稍后重试。'
                    : '没有匹配的私聊联系人。'}</span>
            </div>}
          </div>
        </section>
      </div>}
      {typeTarget !== undefined && <div
        style={typePickerLayerStyle}
        role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setTypeTarget(undefined) }}
      >
        <section style={typePickerStyle} role="dialog" aria-modal="true" aria-label={`选择和${typeTarget.displayName}的通话方式`} data-arkme-call-type-picker-placement={typePickerPlacement.kind}>
          <header style={styles.typeHeader}>
            <CallAvatar name={typeTarget.displayName} avatarRef={typeTarget.avatarRef} size={38} />
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>{typeTarget.displayName}</strong>
	              <small style={styles.pickerSub}>{targetSubtitle(typeTarget)}</small>
            </span>
            <button type="button" style={styles.closeButton} aria-label="关闭通话方式选择" onClick={() => { setTypeTarget(undefined) }}><X size={16} /></button>
          </header>
          <button
            type="button"
	            style={{ ...styles.typeOption, ...(!targetCanResolve(typeTarget) ? styles.typeOptionDisabled : {}) }}
	            aria-disabled={!targetCanResolve(typeTarget)}
            onClick={() => { requestTargetCall(typeTarget, 'audio') }}
          >
            <span style={styles.typeIcon}><PhoneCall size={18} /></span>
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>语音通话</strong>
              <small style={styles.pickerSub}>仅使用麦克风</small>
            </span>
          </button>
          <button
            type="button"
	            style={{ ...styles.typeOption, ...(!targetCanResolve(typeTarget) ? styles.typeOptionDisabled : {}) }}
	            aria-disabled={!targetCanResolve(typeTarget)}
            onClick={() => { requestTargetCall(typeTarget, 'video') }}
          >
            <span style={styles.typeIcon}><CallVideoIcon size={18} /></span>
            <span style={styles.pickerText}>
              <strong style={styles.pickerName}>视频通话</strong>
              <small style={styles.pickerSub}>使用摄像头和麦克风</small>
            </span>
          </button>
          {unavailableTarget !== undefined && <p role="status" style={styles.unavailable}>还没有找到这个联系人对应的私聊会话，暂时不能从通话页直接呼叫。请先从对话里打开该联系人，或搜索已有私聊联系人。</p>}
        </section>
      </div>}
      {notice !== '' && <div role="status" style={styles.notice}>{notice}</div>}
    </main>
  </section>
}
