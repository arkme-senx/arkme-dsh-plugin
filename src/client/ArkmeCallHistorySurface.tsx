import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { callArkme } from './api.js'
import { createDemoWavUrl } from './demo-audio.js'
import { arkmePersonalTestEditionLabel, readArkmePersonalTestEdition } from './personal-test-edition.js'
import { loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'

export type ArkmeCallMediaType = 'audio' | 'video'

export interface ArkmeCallTranscriptLine {
  id: string
  speaker: string
  speakerRole: 'self' | 'peer'
  atSeconds: number
  endSeconds: number
  text: string
}

export interface ArkmeCallHistoryItem {
  id: string
  peerName: string
  peerRelationship: string
  initials: string
  avatarBackground: string
  avatarUrl: string
  direction: 'incoming' | 'outgoing'
  mediaType: ArkmeCallMediaType
  startedLabel: string
  durationSeconds: number
  summary: string
  missed?: boolean
  transcript: ArkmeCallTranscriptLine[]
}

export const ARKME_CALL_DEMO_ITEMS: ArkmeCallHistoryItem[] = [
  {
    id: 'demo-wife', peerName: '林小满', peerRelationship: '家人', initials: '小满', avatarBackground: '#e8d5ca', avatarUrl: 'avatar-lin-xiaoman.jpeg',
    direction: 'outgoing', mediaType: 'video', startedLabel: '今天 14:26', durationSeconds: 22 * 60 + 14,
    summary: '确认了晚饭、接孩子和周末采购安排。我下班买菜，小满先去接孩子。',
    transcript: [
      { id: 'wife-1', speaker: '我', speakerRole: 'self', atSeconds: 1, endSeconds: 3.3, text: '我下班顺路去菜场，晚上做你想吃的清蒸鱼。' },
      { id: 'wife-2', speaker: '林小满', speakerRole: 'peer', atSeconds: 3.5, endSeconds: 6, text: '好呀，那我先去接孩子，回家把米饭蒸上。' },
      { id: 'wife-3', speaker: '我', speakerRole: 'self', atSeconds: 6.2, endSeconds: 8.7, text: '家里纸巾和牛奶也快没了，我一起买回来。' },
      { id: 'wife-4', speaker: '林小满', speakerRole: 'peer', atSeconds: 8.9, endSeconds: 11.7, text: '行，你路上慢点，我到家先收衣服，等你回来开饭。' },
    ],
  },
  {
    id: 'demo-mother', peerName: '妈妈', peerRelationship: '家人', initials: '妈妈', avatarBackground: '#dfe1ec', avatarUrl: 'avatar-mother.jpg',
    direction: 'incoming', mediaType: 'audio', startedLabel: '昨天 16:27', durationSeconds: 8 * 60 + 47,
    summary: '和母亲确认了周末回家吃饭和备菜安排，决定由我带水果回家，母亲提前准备午饭。',
    transcript: [
      { id: 'mother-1', speaker: '我', speakerRole: 'self', atSeconds: 12, endSeconds: 14.4, text: '妈，这周六我带孩子回去吃午饭，顺路给您捎点水果和排骨。' },
      { id: 'mother-2', speaker: '妈妈', speakerRole: 'peer', atSeconds: 59, endSeconds: 61.6, text: '好啊，妈早上去菜市场买点青菜，再把你爱吃的红烧鱼先准备上。' },
      { id: 'mother-3', speaker: '我', speakerRole: 'self', atSeconds: 111, endSeconds: 113.5, text: '那我出门前给您打电话，要是家里米和油不够，我一起买回去。' },
      { id: 'mother-4', speaker: '妈妈', speakerRole: 'peer', atSeconds: 169, endSeconds: 171.7, text: '行，你们别太赶，到了就吃饭，妈把汤先炖上。' },
    ],
  },
]

export function filterCallHistoryItems(items: ArkmeCallHistoryItem[], query: string, mediaFilter: 'all' | ArkmeCallMediaType): ArkmeCallHistoryItem[] {
  const normalizedQuery = query.trim().toLowerCase()
  return items.filter(item => (mediaFilter === 'all' || item.mediaType === mediaFilter)
    && (normalizedQuery === '' || `${item.peerName}${item.peerRelationship}`.toLowerCase().includes(normalizedQuery)))
}

export function resolveSelectedCall(items: ArkmeCallHistoryItem[], selectedId: string): ArkmeCallHistoryItem | undefined {
  return items.find(item => item.id === selectedId) ?? items[0]
}

export interface ArkmeCallContact {
  sourceRef: string
  displayName: string
  avatarRef?: string
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return <svg data-arkme-media-icon="play" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8.5 6.7v10.6c0 .82.91 1.31 1.59.87l8.22-5.3a1.03 1.03 0 0 0 0-1.74l-8.22-5.3a1.03 1.03 0 0 0-1.59.87Z" fill="currentColor" />
  </svg>
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return <svg data-arkme-media-icon="pause" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="6.75" y="5.5" width="4" height="13" rx="1.25" fill="currentColor" />
    <rect x="13.25" y="5.5" width="4" height="13" rx="1.25" fill="currentColor" />
  </svg>
}

function PlaybackIcon({ playing, size = 16 }: { playing: boolean; size?: number }) {
  return playing ? <PauseIcon size={size} /> : <PlayIcon size={size} />
}

const CallAssetBasePathContext = createContext('/arkme-self/api/call')

function useCallAssetUrl(name: string): string {
  return `${useContext(CallAssetBasePathContext).replace(/\/$/, '')}/${name}`
}

function DemoPersonAvatar({ item, style }: { item: ArkmeCallHistoryItem; style: CSSProperties | undefined }) {
  return <img src={useCallAssetUrl(item.avatarUrl)} alt="" style={{ display: 'block', overflow: 'hidden', borderRadius: 999, objectFit: 'cover', background: item.avatarBackground, ...style }} aria-hidden="true" data-arkme-demo-avatar={item.id} />
}

function RealContactAvatar({ contact }: { contact: ArkmeCallContact }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (contact.avatarRef === undefined || contact.avatarRef === '') return () => { active = false }
    void loadArkmeImageDataUrl(contact.avatarRef).then(value => { if (active) setSrc(value) }).catch(() => undefined)
    return () => { active = false }
  }, [contact.avatarRef])
  return <span style={styles.contactAvatar} aria-hidden>{src === ''
    ? <ArkmeMark size={30} />
    : <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', borderRadius: 999, objectFit: 'cover' }} />}</span>
}

const previewDurationSeconds = 12
const c = {
  text: arkmeTheme.text, secondary: arkmeTheme.secondary, tertiary: arkmeTheme.tertiary,
  border: arkmeTheme.border, borderSoft: arkmeTheme.borderSoft, panel: arkmeTheme.base,
  layer: arkmeTheme.layer1, active: arkmeTheme.accentSoft, accent: arkmeTheme.accent,
  info: arkmeTheme.info, danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  root: { flex: 1, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden', color: c.text, background: c.panel },
  layout: { height: '100%', minHeight: 0, display: 'grid', overflow: 'hidden' },
  listPane: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${c.border}`, background: arkmeTheme.sidebar },
  listHeader: { flex: 'none', padding: '18px 16px 12px', borderBottom: `1px solid ${c.borderSoft}` },
  listTitleLine: { display: 'flex', alignItems: 'center', gap: 8 },
  listTitle: { margin: 0, flex: 1, fontSize: 19, lineHeight: '26px', fontWeight: 650, letterSpacing: '-.02em' },
  demoChip: { padding: '2px 7px', borderRadius: 999, color: c.secondary, background: arkmeTheme.layer2, fontSize: 10, lineHeight: '17px' },
  listSubtitle: { margin: '5px 0 0', color: c.secondary, fontSize: 12, lineHeight: '18px' },
  contactSection: { marginTop: 12, padding: '10px 0 0', borderTop: `1px solid ${c.borderSoft}` },
  contactHeading: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  contactTitle: { margin: 0, fontSize: 12, lineHeight: '18px', fontWeight: 650 },
  contactHint: { color: c.tertiary, fontSize: 10, lineHeight: '16px' },
  contactRow: { display: 'flex', gap: 9, marginTop: 8 },
  contactButton: { width: 54, minWidth: 54, padding: 0, border: 0, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', textAlign: 'center' },
  contactAvatar: { width: 38, height: 38, margin: '0 auto 4px', display: 'grid', placeItems: 'center', border: `1px solid ${c.borderSoft}`, borderRadius: 999, background: arkmeTheme.layer2, color: c.text, fontSize: 10, fontWeight: 650 },
  contactAdd: { fontSize: 22, fontWeight: 300 },
  contactName: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9, lineHeight: '14px' },
  searchWrap: { position: 'relative' },
  searchIcon: { position: 'absolute', left: 10, top: 21, color: c.tertiary, pointerEvents: 'none' },
  search: { width: '100%', height: 34, marginTop: 12, boxSizing: 'border-box', padding: '0 12px 0 32px', border: `1px solid ${c.border}`, borderRadius: 10, outline: 0, background: arkmeTheme.input, color: c.text, font: 'inherit', fontSize: 12 },
  filters: { display: 'flex', gap: 6, marginTop: 9 },
  filter: { height: 26, padding: '0 10px', border: `1px solid ${c.border}`, borderRadius: 999, background: arkmeTheme.elevated, color: c.secondary, font: 'inherit', fontSize: 11, cursor: 'pointer' },
  filterActive: { borderColor: c.accent, background: c.active, color: c.text, fontWeight: 650 },
  list: { flex: 1, minHeight: 0, margin: 0, padding: '0 12px', overflowY: 'auto', listStyle: 'none' },
  item: { position: 'relative', display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 40px', alignItems: 'center', gap: 11, minHeight: 70, padding: '12px 4px', borderBottom: `1px solid ${c.borderSoft}` },
  itemActive: { background: arkmeTheme.layer2 },
  itemSelect: { position: 'absolute', inset: 0, width: '100%', border: 0, background: 'transparent', cursor: 'pointer' },
  avatar: { width: 42, height: 42, zIndex: 1, display: 'grid', placeItems: 'center', borderRadius: 999, color: '#41464d', fontSize: 12, fontWeight: 650, pointerEvents: 'none' },
  itemBody: { minWidth: 0, zIndex: 1, pointerEvents: 'none' },
  itemTop: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  itemName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  itemTime: { flex: 'none', color: c.tertiary, fontSize: 10, lineHeight: '16px' },
  itemMeta: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', whiteSpace: 'nowrap', color: c.tertiary, fontSize: 11, lineHeight: '17px' },
  direction: { color: c.tertiary, fontWeight: 700 }, missed: { color: c.danger },
  itemPlay: { width: 38, height: 38, zIndex: 2, display: 'grid', placeItems: 'center', padding: 0, border: `1px solid ${c.borderSoft}`, borderRadius: 999, background: '#fff', color: '#17191c', cursor: 'pointer' },
  playSpacer: { width: 38, height: 38 },
  detail: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: c.panel },
  detailScroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px clamp(18px,3.8vw,52px) 40px', boxSizing: 'border-box' },
  detailInner: { width: 'min(760px,100%)', margin: '0 auto' },
  identity: { display: 'flex', alignItems: 'center', gap: 14 },
  heroAvatar: { width: 54, height: 54, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, color: '#41464d', fontSize: 13, fontWeight: 700 },
  identityText: { minWidth: 0, flex: 1 },
  detailTitle: { margin: 0, fontSize: 21, lineHeight: '29px', fontWeight: 650, letterSpacing: '-.025em' },
  detailMeta: { margin: '3px 0 0', color: c.secondary, fontSize: 12, lineHeight: '18px' },
  overview: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginTop: 18, borderTop: `1px solid ${c.borderSoft}`, borderBottom: `1px solid ${c.borderSoft}`, background: arkmeTheme.layer1 },
  overviewCell: { minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 8px', color: c.secondary, fontSize: 11 },
  overviewDivider: { borderLeft: `1px solid ${c.borderSoft}` },
  videoDetailTitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  videoDetailTitle: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 700 },
  videoDetailClose: { width: 34, height: 34, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', color: c.tertiary, cursor: 'pointer', fontSize: 30, lineHeight: 1 },
  videoDetailMeta: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', marginTop: 22, color: c.text, fontSize: 12 },
  videoDetailMetaCenter: { justifySelf: 'center' }, videoDetailMetaEnd: { justifySelf: 'end' },
  player: { marginTop: 20, padding: '17px 18px', border: `1px solid ${c.border}`, borderRadius: 16, background: c.layer },
  playerTop: { display: 'flex', alignItems: 'center', gap: 12 },
  mainPlay: { width: 42, height: 42, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: c.text, color: arkmeTheme.foreground, cursor: 'pointer', fontSize: 14 },
  playerCopy: { minWidth: 0, flex: 1 }, playerTitle: { margin: 0, fontSize: 14, lineHeight: '21px', fontWeight: 650 },
  playerSubtitle: { margin: '2px 0 0', color: c.secondary, fontSize: 11, lineHeight: '17px' },
  timer: { flex: 'none', color: c.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 11 },
  videoPlayer: { marginTop: 28, padding: '0 8px 10px', background: c.panel },
  videoReplayPair: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(36px,12vw,150px)' },
  videoReplayPerson: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  videoReplayPersonSelf: { flexDirection: 'row-reverse' },
  videoReplayCard: { position: 'relative', width: 96, height: 158, overflow: 'hidden', borderRadius: 14, background: 'linear-gradient(180deg,#f3f3f3,#c9c9c9)', boxShadow: '0 0 0 6px rgba(35,39,44,.04)' },
  videoReplayCardSelf: { background: 'linear-gradient(180deg,#edf2ef,#bdcbc3)', boxShadow: `0 0 0 6px ${arkmeTheme.messageOwn}` },
  videoReplayAvatar: { width: 38, height: 38, flex: 'none', border: `1px solid ${c.borderSoft}` },
  videoReplayButton: { position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, display: 'grid', placeItems: 'center', padding: 0, transform: 'translate(-50%,-50%)', border: '1px solid rgba(255,255,255,.68)', borderRadius: 999, background: 'rgba(255,255,255,.24)', color: '#fff', cursor: 'pointer' },
  videoStage: { position: 'relative', aspectRatio: '16 / 9', display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', background: '#1c2025' },
  videoPanel: { position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden' },
  videoAvatar: { width: 70, height: 70, display: 'grid', placeItems: 'center', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 650, boxShadow: '0 12px 32px rgba(0,0,0,.24)', transition: 'transform 220ms ease-out' },
  videoName: { position: 'absolute', left: 12, bottom: 10, padding: '3px 7px', borderRadius: 999, color: '#fff', background: 'rgba(0,0,0,.42)', fontSize: 10 },
  videoDim: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(7,10,14,.30)' },
  videoPlay: { width: 54, height: 54, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid rgba(255,255,255,.42)', borderRadius: 999, background: 'rgba(0,0,0,.56)', color: '#fff', fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(8px)' },
  videoControlDock: { position: 'absolute', zIndex: 3, top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 999, background: 'rgba(0,0,0,.54)', color: '#fff', backdropFilter: 'blur(8px)' },
  videoLayoutDock: { position: 'absolute', zIndex: 4, top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 10, background: 'rgba(0,0,0,.54)', backdropFilter: 'blur(8px)' },
  videoLayoutButton: { minHeight: 26, padding: '0 7px', border: 0, borderRadius: 7, background: 'transparent', color: 'rgba(255,255,255,.72)', cursor: 'pointer', font: 'inherit', fontSize: 9 },
  videoLayoutButtonActive: { background: 'rgba(255,255,255,.18)', color: '#fff', fontWeight: 650 },
  videoControlButton: { width: 30, height: 30, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' },
  videoHint: { flex: 'none', color: 'rgba(255,255,255,.68)', fontSize: 10 },
  section: { marginTop: 22 }, sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10 },
  sectionTitle: { margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 650 }, sectionHint: { margin: 0, color: c.tertiary, fontSize: 11, lineHeight: '17px' },
  participantsSheet: { position: 'sticky', bottom: -40, margin: '38px -8px -40px', padding: '0 22px 34px', borderRadius: '24px 24px 0 0', background: arkmeTheme.layer1, boxShadow: '0 -12px 34px rgba(20,24,30,.08)' },
  participantsSheetCollapsed: { paddingBottom: 46 },
  participantsToggle: { width: '100%', minHeight: 52, display: 'grid', placeItems: 'center', gap: 7, padding: '10px 0 7px', border: 0, background: 'transparent', color: c.text, cursor: 'pointer', font: 'inherit' },
  participantsHandle: { width: 44, height: 4, borderRadius: 999, background: c.border },
  participantsToggleLabel: { color: c.secondary, fontSize: 11, lineHeight: '16px' },
  participantList: { display: 'flex', gap: 10, padding: '6px 0 4px' },
  participantChip: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '5px 12px 5px 5px', border: `1px solid ${c.borderSoft}`, borderRadius: 999, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  participantChipAvatar: { width: 30, height: 30, borderRadius: 999, objectFit: 'cover' },
  participantCardBackdrop: { position: 'fixed', zIndex: 10040, inset: 0, display: 'grid', placeItems: 'end center', background: 'rgba(18,20,23,.42)' },
  participantCard: { width: 'min(560px,calc(100vw - 32px))', padding: '16px 28px 28px', boxSizing: 'border-box', borderRadius: '24px 24px 0 0', background: arkmeTheme.layer1, textAlign: 'center', boxShadow: '0 -20px 60px rgba(0,0,0,.18)' },
  participantCardHandle: { width: 44, height: 4, margin: '0 auto 22px', borderRadius: 999, background: c.border },
  participantCardAvatar: { width: 76, height: 76, margin: '0 auto', borderRadius: 999, objectFit: 'cover' },
  participantCardName: { margin: '12px 0 0', fontSize: 19, lineHeight: '27px', fontWeight: 680 },
  participantCardRole: { margin: '3px 0 20px', color: c.tertiary, fontSize: 12 },
  participantProfileButton: { width: '100%', minHeight: 44, border: `1px solid ${c.border}`, borderRadius: 12, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 650 },
  summary: { margin: '9px 0 0', padding: '13px 15px', borderRadius: 13, background: arkmeTheme.layer2, fontSize: 13, lineHeight: 1.7 },
  conversation: { marginTop: 9 },
  conversationDate: { margin: '0 0 14px', color: c.tertiary, textAlign: 'center', fontSize: 10 },
  messageList: { margin: 0, padding: 0, listStyle: 'none' },
  hangup: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '20px 0 4px', color: c.tertiary, fontSize: 12 },
  hangupLine: { width: 84, height: 1, background: c.borderSoft },
  messageRow: { display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10 }, messageRowSelf: { flexDirection: 'row-reverse' },
  messageAvatar: { width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, color: '#41464d', fontSize: 9, fontWeight: 650 },
  messageStack: { maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }, messageStackSelf: { alignItems: 'flex-end' },
  speakerName: { margin: '0 3px 4px', color: c.tertiary, fontSize: 10, lineHeight: '14px' },
  bubble: { maxWidth: '100%', padding: '9px 10px 7px', boxSizing: 'border-box', border: 0, borderRadius: '5px 15px 15px 15px', background: arkmeTheme.messageOther, color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  bubbleSelf: { borderRadius: '15px 5px 15px 15px', background: arkmeTheme.messageOwn }, bubblePlaying: { boxShadow: `0 0 0 2px ${arkmeTheme.infoSoft}`, background: arkmeTheme.accentSoft },
  bubbleText: { fontSize: 13, lineHeight: 1.55 }, bubbleMeta: { display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, color: c.tertiary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 10 },
  bubblePlayingIcon: { color: c.accent, fontWeight: 700 },
  empty: { margin: '38px auto 0', padding: '42px 18px', border: `1px dashed ${c.border}`, borderRadius: 16, color: c.secondary, textAlign: 'center', fontSize: 13, lineHeight: 1.7 },
  contactDialogBackdrop: { position: 'fixed', zIndex: 10030, inset: 0, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(18,20,23,.42)' },
  contactDialog: { width: 'min(430px,calc(100vw - 40px))', overflow: 'hidden', borderRadius: 18, background: arkmeTheme.layer1, boxShadow: '0 24px 70px rgba(0,0,0,.24)' },
  contactDialogHeader: { padding: '20px 20px 14px' },
  contactDialogTitle: { margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 680 },
  contactDialogCopy: { margin: '4px 0 0', color: c.secondary, fontSize: 12, lineHeight: '18px' },
  contactOption: { width: '100%', minHeight: 68, display: 'grid', gridTemplateColumns: '38px minmax(0,1fr)', alignItems: 'center', gap: 12, padding: '10px 20px', boxSizing: 'border-box', border: 0, borderTop: `1px solid ${c.borderSoft}`, background: 'transparent', color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  contactOptionIcon: { width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 999, background: arkmeTheme.layer2, fontSize: 18 },
  contactOptionTitle: { display: 'block', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  contactOptionCopy: { display: 'block', marginTop: 2, color: c.secondary, fontSize: 11, lineHeight: '17px' },
  contactDialogClose: { width: '100%', minHeight: 48, border: 0, borderTop: `1px solid ${c.borderSoft}`, background: arkmeTheme.layer2, color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  addContactPage: { minHeight: 560, display: 'flex', flexDirection: 'column', padding: '16px 20px 22px', boxSizing: 'border-box', background: arkmeTheme.layer2 },
  addContactTop: { position: 'relative', display: 'grid', gridTemplateColumns: '36px 1fr 36px', alignItems: 'center', minHeight: 38 },
  addContactBack: { width: 36, height: 36, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', color: c.text, cursor: 'pointer' },
  addContactTitle: { margin: 0, textAlign: 'center', fontSize: 19, lineHeight: '27px', fontWeight: 680 },
  addContactSearch: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px', height: 54, marginTop: 24, overflow: 'hidden', border: `1px solid ${c.borderSoft}`, borderRadius: 14, background: arkmeTheme.elevated },
  addContactInput: { minWidth: 0, padding: '0 16px', border: 0, outline: 0, background: 'transparent', color: c.text, font: 'inherit', fontSize: 14 },
  addContactSearchButton: { display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  addContactScan: { minHeight: 58, display: 'grid', gridTemplateColumns: '30px minmax(0,1fr) 20px', alignItems: 'center', gap: 12, marginTop: 14, padding: '0 16px', border: `1px solid ${c.borderSoft}`, borderRadius: 14, background: arkmeTheme.elevated, color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 14 },
  addContactFooter: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', alignItems: 'end', gap: 20, marginTop: 'auto', paddingTop: 24, borderTop: `1px solid ${c.borderSoft}` },
  addContactOwner: { minWidth: 0 },
  addContactOwnerName: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 650 },
  addContactOwnerId: { margin: '7px 0 0', color: c.secondary, fontSize: 13, lineHeight: '20px' },
  addContactQr: { width: 92, height: 92, borderRadius: 12, background: '#fff' },
  addContactStatus: { minHeight: 18, margin: '10px 0 0', color: c.secondary, fontSize: 11 },
  shareCard: { padding: '20px', borderTop: `1px solid ${c.borderSoft}` },
  shareCardIntro: { margin: 0, color: c.secondary, fontSize: 12, lineHeight: '18px' },
  shareIdentity: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px', alignItems: 'end', gap: 20, marginTop: 18, padding: 18, border: `1px solid ${c.borderSoft}`, borderRadius: 16, background: arkmeTheme.layer2 },
  shareName: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 680 },
  shareId: { margin: '8px 0 0', color: c.secondary, fontSize: 13, lineHeight: '20px' },
  shareQr: { width: 132, height: 132, display: 'block', borderRadius: 12, background: '#fff' },
  shareActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 },
  shareAction: { minHeight: 40, border: `1px solid ${c.border}`, borderRadius: 10, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  shareStatus: { minHeight: 18, margin: '8px 0 0', color: c.secondary, textAlign: 'center', fontSize: 11, lineHeight: '18px' },
  resultList: { margin: '10px 0 0', padding: 0, listStyle: 'none' },
  resultButton: { width: '100%', minHeight: 54, display: 'grid', gridTemplateColumns: '38px minmax(0,1fr) 22px', alignItems: 'center', gap: 10, padding: '8px 12px', border: 0, borderBottom: `1px solid ${c.borderSoft}`, background: 'transparent', color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  callSheetBackdrop: { position: 'fixed', zIndex: 10050, inset: 0, display: 'grid', placeItems: 'end center', background: 'rgba(18,20,23,.42)' },
  callSheet: { width: 'min(520px,calc(100vw - 28px))', padding: '12px 20px 18px', boxSizing: 'border-box', borderRadius: '24px 24px 0 0', background: arkmeTheme.layer1, boxShadow: '0 -20px 60px rgba(0,0,0,.18)' },
  callSheetHandle: { width: 44, height: 4, margin: '0 auto 16px', borderRadius: 999, background: c.border },
  callSheetTitle: { margin: '0 0 4px', textAlign: 'center', fontSize: 17, lineHeight: '25px', fontWeight: 680 },
  callSheetHint: { margin: '0 0 14px', color: c.secondary, textAlign: 'center', fontSize: 11, lineHeight: '17px' },
  callSheetChoice: { width: '100%', minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 0, borderTop: `1px solid ${c.borderSoft}`, background: 'transparent', color: '#17191c', cursor: 'pointer', font: 'inherit', fontSize: 15 },
  inviteBody: { padding: '18px 20px 16px', borderTop: `1px solid ${c.borderSoft}` },
  inviteChoices: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  inviteChoice: { minHeight: 82, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, border: `1px solid ${c.border}`, borderRadius: 14, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', font: 'inherit', fontSize: 14 },
  inviteChoiceActive: { borderColor: c.text, boxShadow: `inset 0 0 0 1px ${c.text}` },
  inviteChoiceIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 999, background: arkmeTheme.layer2, color: c.text },
  inviteHint: { margin: '12px 0 0', color: c.tertiary, textAlign: 'center', fontSize: 11, lineHeight: '17px' },
  inviteLink: { marginTop: 14, padding: 12, borderRadius: 12, background: arkmeTheme.layer2, color: c.secondary, wordBreak: 'break-all', fontSize: 11, lineHeight: '18px' },
  profilePanel: { marginTop: 18, padding: 16, border: `1px solid ${c.borderSoft}`, borderRadius: 16, background: arkmeTheme.layer2, textAlign: 'left' },
  profileFact: { margin: '7px 0 0', color: c.secondary, fontSize: 12, lineHeight: '18px' },
  videoLayoutBar: { display: 'flex', justifyContent: 'flex-end', marginBottom: 14 },
  videoLayoutTrigger: { minHeight: 32, padding: '0 11px', border: `1px solid ${c.border}`, borderRadius: 10, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  videoLayoutMenu: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7, marginBottom: 14, padding: 8, border: `1px solid ${c.borderSoft}`, borderRadius: 12, background: arkmeTheme.layer2 },
  videoLayoutOption: { minHeight: 34, border: 0, borderRadius: 8, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 10 },
  videoLayoutOptionActive: { background: arkmeTheme.elevated, color: c.text, fontWeight: 650 },
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function CallTypeIcon({ mediaType, size = 15 }: { mediaType: ArkmeCallMediaType; size?: number }) {
  return mediaType === 'video' ? <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3.5" y="6" width="12.5" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><path d="m16 10 4.5-2.6v9.2L16 14" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg> : <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M7.8 3.8c.7-.34 1.55-.07 1.91.62l2 3.78c.32.6.16 1.34-.38 1.77l-1.5 1.18c-.3.23-.37.64-.18.97 1 1.68 2.15 2.83 3.83 3.83.32.19.74.12.97-.18l1.18-1.5c.42-.54 1.17-.7 1.77-.38l3.78 2c.69.36.96 1.21.62 1.91l-.82 1.62a3.15 3.15 0 0 1-3.4 1.68C10.3 19.64 4.36 13.7 2.9 6.42a3.15 3.15 0 0 1 1.68-3.4l1.62-.82Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
}

export function ArkmeCallHistoryRow({ item, selected, playing: _playing, onSelect, onTogglePlayback }: {
  item: ArkmeCallHistoryItem; selected: boolean; playing: boolean; onSelect(): void; onTogglePlayback(): void
}) {
  const direction = item.direction === 'incoming' ? '↙' : '↗'
  const mediaText = item.mediaType === 'video' ? '视频通话' : '语音通话'
  const detail = item.missed ? `未接通 · ${mediaText}` : `${mediaText} · ${formatDuration(item.durationSeconds)}`
  return <li><div role="treeitem" aria-selected={selected} style={{ ...styles.item, ...(selected ? styles.itemActive : {}) }}>
    <button type="button" style={styles.itemSelect} aria-label={`查看与${item.peerName}的${mediaText}记录`} onClick={onSelect} />
    <DemoPersonAvatar item={item} style={styles.avatar} />
    <span style={styles.itemBody}><span style={styles.itemTop}><span style={{ ...styles.itemName, ...(item.missed ? styles.missed : {}) }}>{item.peerName}</span></span>
      <span style={{ ...styles.itemMeta, ...(item.missed ? styles.missed : {}) }}><span style={{ ...styles.direction, ...(item.missed ? styles.missed : {}) }}>{direction}</span><CallTypeIcon mediaType={item.mediaType} />{detail}<span aria-hidden>·</span><time style={styles.itemTime}>{item.startedLabel}</time></span></span>
    {!item.missed ? <button type="button" style={styles.itemPlay} data-arkme-call-action={item.mediaType} aria-label={`向${item.peerName}发起${item.mediaType === 'video' ? '视频' : '语音'}通话`} onClick={onTogglePlayback}><CallTypeIcon mediaType={item.mediaType} size={18} /></button> : <span style={styles.playSpacer} />}
  </div></li>
}

function DemoVideoReplay({ item, playing, currentTime, onToggle }: { item: ArkmeCallHistoryItem; playing: boolean; currentTime: number; onToggle(): void }) {
  void currentTime
  const [layout, setLayout] = useState<'peer' | 'self' | 'vertical' | 'horizontal'>('horizontal')
  const [menuOpen, setMenuOpen] = useState(false)
  const showPeer = layout !== 'self'
  const showSelf = layout !== 'peer'
  return <section style={styles.videoPlayer} aria-label="视频通话回放" data-arkme-video-replay="demo">
    <div style={styles.videoLayoutBar}><button type="button" style={styles.videoLayoutTrigger} aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}>▦ 画面排版</button></div>
    {menuOpen && <div style={styles.videoLayoutMenu} aria-label="视频回放画面排版">{([['peer', '对方视角'], ['self', '我的视角'], ['vertical', '上下排版'], ['horizontal', '左右排版']] as const).map(([value, label]) => <button key={value} type="button" style={{ ...styles.videoLayoutOption, ...(layout === value ? styles.videoLayoutOptionActive : {}) }} aria-pressed={layout === value} onClick={() => { setLayout(value); setMenuOpen(false) }}>{label}</button>)}</div>}
    <div style={{ ...styles.videoReplayPair, ...(layout === 'vertical' ? { gridTemplateColumns: '1fr', gap: 24 } : {}), ...((layout === 'peer' || layout === 'self') ? { gridTemplateColumns: '1fr', justifyItems: 'center' } : {}) }} data-arkme-video-perspectives={layout}>
      {showPeer && <div style={styles.videoReplayPerson}><DemoPersonAvatar item={item} style={styles.videoReplayAvatar} /><div style={styles.videoReplayCard}><button type="button" style={styles.videoReplayButton} aria-label={`${playing ? '暂停' : '播放'}${item.peerName}视角视频`} onClick={onToggle}><PlaybackIcon playing={playing} size={18} /></button></div></div>}
      {showSelf && <div style={{ ...styles.videoReplayPerson, ...styles.videoReplayPersonSelf }}><span style={{ ...styles.videoReplayAvatar, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 999, background: arkmeTheme.layer2, fontWeight: 700 }} aria-hidden>我</span><div style={{ ...styles.videoReplayCard, ...styles.videoReplayCardSelf }}><button type="button" style={styles.videoReplayButton} aria-label={`${playing ? '暂停' : '播放'}我的视角视频`} onClick={onToggle}><PlaybackIcon playing={playing} size={18} /></button></div></div>}
    </div>
  </section>
}

function CallTimeIcon({ size = 15 }: { size?: number }) {
  return <svg data-arkme-call-meta-icon="time" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7.5v4.8l3.2 1.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function CallDurationIcon({ size = 15 }: { size?: number }) {
  return <svg data-arkme-call-meta-icon="duration" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="13" r="7.8" stroke="currentColor" strokeWidth="1.6" /><path d="M9.5 3.5h5M12 5.2V8m5.7-1.7 1.4 1.4M12 13V9.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function transcriptToPreviewSeconds(item: ArkmeCallHistoryItem, transcriptSeconds: number): number {
  const transcriptEnd = Math.max(previewDurationSeconds, ...item.transcript.map(line => line.endSeconds))
  return Math.max(0, Math.min(previewDurationSeconds, transcriptSeconds / transcriptEnd * previewDurationSeconds))
}

function previewToTranscriptSeconds(item: ArkmeCallHistoryItem, previewSeconds: number): number {
  const transcriptEnd = Math.max(previewDurationSeconds, ...item.transcript.map(line => line.endSeconds))
  return Math.max(0, previewSeconds / previewDurationSeconds * transcriptEnd)
}

export function formatCallTranscriptClock(startedLabel: string, offsetSeconds: number): string {
  const match = startedLabel.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/)
  if (match === null) return formatDuration(offsetSeconds)
  const hour = Number(match[1] ?? 0)
  const minute = Number(match[2] ?? 0)
  const totalSeconds = (hour * 3600 + minute * 60 + Math.max(0, Math.floor(offsetSeconds))) % 86_400
  return `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function profileShareUrl(arkmeId: string): string {
  return `https://jiwo.cc/${encodeURIComponent(arkmeId)}?scene=profile_share`
}

export function callInviteUrl(arkmeId: string, mediaType: ArkmeCallMediaType): string {
  return `https://jiwo.cc/call/invite?from=${encodeURIComponent(arkmeId)}&media=${mediaType}`
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) return navigator.clipboard.writeText(value)
  return Promise.reject(new Error('clipboard unavailable'))
}

function CallTypeSheet({ name, onSelect, onClose }: { name: string; onSelect(mediaType: ArkmeCallMediaType): void; onClose(): void }) {
  return <div style={styles.callSheetBackdrop} role="presentation" onClick={onClose}><section role="dialog" aria-modal="true" aria-label={`与${name}通话`} style={styles.callSheet} onClick={event => { event.stopPropagation() }}><div style={styles.callSheetHandle} aria-hidden /><h3 style={styles.callSheetTitle}>与{name}通话</h3><p style={styles.callSheetHint}>选择通话方式</p><button type="button" style={styles.callSheetChoice} onClick={() => { onSelect('audio') }}><CallTypeIcon mediaType="audio" size={19} />语音通话</button><button type="button" style={styles.callSheetChoice} onClick={() => { onSelect('video') }}><CallTypeIcon mediaType="video" size={19} />视频通话</button><button type="button" style={styles.contactDialogClose} onClick={onClose}>取消</button></section></div>
}

export function profileQrDataUrl(arkmeId: string): string {
  const code = qrcode(0, 'M')
  code.addData(profileShareUrl(arkmeId))
  code.make()
  return code.createDataURL(5, 8)
}

function AddContactDialog({ onClose, profile, contacts, onCallContact }: { onClose(): void; profile: ArkmeUserProfile | null | undefined; contacts: ArkmeCallContact[]; onCallContact(contact: ArkmeCallContact): void }) {
  const [view, setView] = useState<'menu' | 'add' | 'share' | 'invite'>('menu')
  const [shareStatus, setShareStatus] = useState('')
  const [inviteMediaType, setInviteMediaType] = useState<ArkmeCallMediaType | null>(null)
  const assetBasePath = useContext(CallAssetBasePathContext).replace(/\/$/, '')
  const options = [
    ['user-add-linear.svg', '添加联系人', '搜索手机号或即我号，添加后可直接发起通话'],
    ['profile-circle-linear.svg', '分享我的主页', '让对方先认识我，并在 Arkme 中联系我'],
    ['call-add-linear.svg', '邀请他人向我发起通话', '生成通话邀请链接，对方可向我发起通话'],
  ] as const
  return <div style={styles.contactDialogBackdrop} role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="联系人与通话入口" style={styles.contactDialog} onClick={event => { event.stopPropagation() }}>
      {view === 'menu' && <><header style={styles.contactDialogHeader}><h3 style={styles.contactDialogTitle}>联系人与通话入口</h3><p style={styles.contactDialogCopy}>先找到联系人，再发起语音或视频通话；也可以邀请对方主动联系你。</p></header>{options.map(([icon, title, copy]) => <button key={title} type="button" style={styles.contactOption} onClick={() => { if (title === '添加联系人') setView('add'); else if (title === '分享我的主页') setView('share'); else setView('invite') }}><span style={styles.contactOptionIcon} aria-hidden><img src={`${assetBasePath}/${icon}`} alt="" width="22" height="22" /></span><span><strong style={styles.contactOptionTitle}>{title}</strong><span style={styles.contactOptionCopy}>{copy}</span></span></button>)}<button type="button" style={styles.contactDialogClose} onClick={onClose}>取消</button></>}
      {view === 'add' && <ArkmeAddContactPage profile={profile} contacts={contacts} assetBasePath={assetBasePath} onSelectContact={onCallContact} onBack={() => { setView('menu'); setShareStatus('') }} />}
      {view === 'share' && <><div style={styles.shareCard} data-arkme-profile-share-card="true"><p style={styles.shareCardIntro}>让对方扫描二维码或打开主页链接，在 Arkme 中认识并联系你。</p>{profile?.arkmeId.trim() ? <><div style={styles.shareIdentity}><div><h4 style={styles.shareName}>{profile.displayName}</h4><p style={styles.shareId}>即我号：{profile.arkmeId}</p></div><img src={profileQrDataUrl(profile.arkmeId)} alt="我的 Arkme 主页二维码" style={styles.shareQr} /></div><div style={styles.shareActions}><button type="button" style={styles.shareAction} onClick={() => { void copyText(profileShareUrl(profile.arkmeId)).then(() => { setShareStatus('主页链接已复制') }).catch(() => { setShareStatus('复制失败，请稍后重试') }) }}>复制主页链接</button><button type="button" style={styles.shareAction} onClick={() => { const url = profileShareUrl(profile.arkmeId); if (navigator.share !== undefined) void navigator.share({ title: `${profile.displayName}的 Arkme 主页`, url }).catch(() => undefined); else void copyText(url).then(() => { setShareStatus('当前浏览器不支持系统分享，主页链接已复制') }).catch(() => { setShareStatus('分享失败，请稍后重试') }) }}>分享</button></div><p role="status" style={styles.shareStatus}>{shareStatus}</p></> : <div style={styles.empty}>{profile === undefined ? '正在读取当前账号资料…' : '暂时无法生成主页分享卡片'}</div>}</div><button type="button" style={styles.contactDialogClose} onClick={() => { setView('menu'); setShareStatus('') }}>返回</button></>}
      {view === 'invite' && <><header style={styles.contactDialogHeader}><h3 style={styles.contactDialogTitle}>邀请他人向我发起通话</h3><p style={styles.contactDialogCopy}>选择通话类型，生成可分享的邀请链接。</p></header><div style={styles.inviteBody}><div style={styles.inviteChoices}><button type="button" aria-pressed={inviteMediaType === 'audio'} style={{ ...styles.inviteChoice, ...(inviteMediaType === 'audio' ? styles.inviteChoiceActive : {}) }} onClick={() => { setInviteMediaType('audio'); setShareStatus('') }}><span style={styles.inviteChoiceIcon}><CallTypeIcon mediaType="audio" size={19} /></span><span>语音通话</span></button><button type="button" aria-pressed={inviteMediaType === 'video'} style={{ ...styles.inviteChoice, ...(inviteMediaType === 'video' ? styles.inviteChoiceActive : {}) }} onClick={() => { setInviteMediaType('video'); setShareStatus('') }}><span style={styles.inviteChoiceIcon}><CallTypeIcon mediaType="video" size={19} /></span><span>视频通话</span></button></div>{inviteMediaType !== null && profile?.arkmeId.trim() ? (() => { const url = callInviteUrl(profile.arkmeId, inviteMediaType); return <><div style={styles.inviteLink}>{url}</div><div style={styles.shareActions}><button type="button" style={styles.shareAction} onClick={() => { void copyText(url).then(() => { setShareStatus('邀请链接已复制') }).catch(() => { setShareStatus('复制失败，请手动复制链接') }) }}>复制链接</button><button type="button" style={styles.shareAction} onClick={() => { if (navigator.share !== undefined) void navigator.share({ title: `${profile.displayName}邀请你发起${inviteMediaType === 'video' ? '视频' : '语音'}通话`, url }).catch(() => undefined); else void copyText(url).then(() => { setShareStatus('浏览器不支持系统分享，邀请链接已复制') }).catch(() => { setShareStatus('分享失败，请手动复制链接') }) }}>分享邀请</button></div></> })() : <p style={styles.inviteHint}>{profile === null ? '暂时无法读取当前账号资料' : '选择后将显示复制与分享操作'}</p>}{shareStatus !== '' && <p role="status" style={styles.shareStatus}>{shareStatus}</p>}</div><button type="button" style={styles.contactDialogClose} onClick={() => { setView('menu'); setInviteMediaType(null); setShareStatus('') }}>返回</button></>}
    </section>
  </div>
}

export function ArkmeAddContactPage({ profile, contacts = [], assetBasePath = '/arkme-self/api/call', onBack, onSelectContact }: { profile: ArkmeUserProfile | null | undefined; contacts?: ArkmeCallContact[]; assetBasePath?: string; onBack(): void; onSelectContact?(contact: ArkmeCallContact): void }) {
  const [searchValue, setSearchValue] = useState('')
  const [status, setStatus] = useState('')
  const arkmeId = profile?.arkmeId.trim() ?? ''
  const normalizedSearch = searchValue.trim().toLowerCase()
  const results = normalizedSearch === '' ? [] : contacts.filter(contact => `${contact.displayName} ${contact.sourceRef}`.toLowerCase().includes(normalizedSearch))
  return <section style={styles.addContactPage} aria-label="添加联系人页面" data-arkme-add-contact-page="true">
    <header style={styles.addContactTop}><button type="button" style={styles.addContactBack} aria-label="返回联系人与通话入口" onClick={onBack}><img src={`${assetBasePath}/arrow_left.svg`} alt="" width="20" height="20" /></button><h3 style={styles.addContactTitle}>添加联系人</h3><span /></header>
    <form style={styles.addContactSearch} onSubmit={event => { event.preventDefault(); setStatus(searchValue.trim() === '' ? '请输入手机号或即我号' : `正在搜索“${searchValue.trim()}”`) }}><input style={styles.addContactInput} value={searchValue} aria-label="输入手机号或即我号" placeholder="输入手机号或即我号" onChange={event => { setSearchValue(event.target.value); setStatus('') }} /><button type="submit" style={styles.addContactSearchButton} aria-label="搜索联系人"><img src={`${assetBasePath}/image_search.svg`} alt="" width="23" height="23" /></button></form>
    <button type="button" style={styles.addContactScan} onClick={() => { setStatus('网页版扫码入口正在接入；可先输入即我号搜索') }}><img src={`${assetBasePath}/icon-scan-add-contact.svg`} alt="" width="24" height="24" /><span>扫一扫二维码添加好友</span><span aria-hidden style={{ color: c.tertiary, fontSize: 22 }}>›</span></button><p role="status" style={styles.addContactStatus}>{status}</p>
    {normalizedSearch !== '' && <ul style={styles.resultList} aria-label="联系人搜索结果">{results.length > 0 ? results.map(contact => <li key={contact.sourceRef}><button type="button" style={styles.resultButton} onClick={() => { onSelectContact?.(contact) }}><RealContactAvatar contact={contact} /><span><strong style={styles.contactOptionTitle}>{contact.displayName}</strong><span style={styles.contactOptionCopy}>已在联系人中 · 点击选择通话方式</span></span><span aria-hidden>›</span></button></li>) : <li style={styles.empty}>没有在当前联系人中找到“{searchValue.trim()}”</li>}</ul>}
    <footer style={styles.addContactFooter}>{profile === undefined ? <p style={styles.addContactOwnerId}>正在读取当前账号资料…</p> : profile === null || arkmeId === '' ? <p style={styles.addContactOwnerId}>暂时无法读取当前账号资料</p> : <><div style={styles.addContactOwner}><p style={styles.addContactOwnerName}>{profile.displayName}</p><p style={styles.addContactOwnerId}>即我号：{arkmeId}</p></div><img src={profileQrDataUrl(arkmeId)} alt="我的 Arkme 二维码" style={styles.addContactQr} /></>}</footer>
  </section>
}

function TranscriptBubble({ item, line, active, playing, onPlay }: { item: ArkmeCallHistoryItem; line: ArkmeCallTranscriptLine; active: boolean; playing: boolean; onPlay(): void }) {
  const self = line.speakerRole === 'self'
  const spokenAt = formatCallTranscriptClock(item.startedLabel, line.atSeconds)
  const selfAvatarUrl = useCallAssetUrl('avatar-self.png')
  return <li style={{ ...styles.messageRow, ...(self ? styles.messageRowSelf : {}) }} data-arkme-call-transcript-bubble={line.id}>
    {self ? <img src={selfAvatarUrl} alt="" style={{ ...styles.messageAvatar, display: 'block', objectFit: 'cover' }} aria-hidden="true" /> : <DemoPersonAvatar item={item} style={styles.messageAvatar} />}
    <div style={{ ...styles.messageStack, ...(self ? styles.messageStackSelf : {}) }}><span style={styles.speakerName}>{line.speaker}</span>
      <button type="button" style={{ ...styles.bubble, ...(self ? styles.bubbleSelf : {}), ...(active ? styles.bubblePlaying : {}) }} aria-label={`播放${line.speaker}在${spokenAt}说的话`} aria-pressed={active && playing} onClick={onPlay}>
        <span style={styles.bubbleText}>{line.text}</span><span style={styles.bubbleMeta}>{active && playing && <span style={styles.bubblePlayingIcon}><PauseIcon size={10} /></span>}<time>{spokenAt}</time></span>
      </button>
    </div>
  </li>
}

function DetailSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section style={styles.section}><div style={styles.sectionHead}><h3 style={styles.sectionTitle}>{title}</h3><p style={styles.sectionHint}>{hint}</p></div>{children}</section>
}

function ParticipantCard({ item, participant, onClose }: { item: ArkmeCallHistoryItem; participant: 'self' | 'peer'; onClose(): void }) {
  const self = participant === 'self'
  const [profileOpen, setProfileOpen] = useState(false)
  const selfAvatarUrl = useCallAssetUrl('avatar-self.png')
  return <div style={styles.participantCardBackdrop} role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={`${self ? '我' : item.peerName}的通话参与人卡片`} style={styles.participantCard} onClick={event => { event.stopPropagation() }}>
      <div style={styles.participantCardHandle} aria-hidden />
      {self ? <img src={selfAvatarUrl} alt="" style={styles.participantCardAvatar} aria-hidden="true" /> : <DemoPersonAvatar item={item} style={styles.participantCardAvatar} />}
      <h3 style={styles.participantCardName}>{self ? '我' : item.peerName}</h3><p style={styles.participantCardRole}>{profileOpen ? '个人主页' : '通话参与人'}</p>
      {profileOpen && <div style={styles.profilePanel}><strong>{self ? '我的 Arkme 主页' : `${item.peerName}的 Arkme 主页`}</strong><p style={styles.profileFact}>{self ? '这里展示你的公开资料、世界动态和联系入口。' : `${item.peerRelationship} · 来自本次${item.mediaType === 'video' ? '视频' : '语音'}通话的参与人。`}</p><p style={styles.profileFact}>当前为个人测试版，正式接入账号资料后会打开完整主页。</p></div>}
      <button type="button" style={{ ...styles.participantProfileButton, marginTop: profileOpen ? 14 : 0 }} onClick={() => { setProfileOpen(value => !value) }}>{profileOpen ? '返回参与人卡片' : '查看个人主页'}</button>
    </section>
  </div>
}

export function ArkmeCallHistorySurface({ assetBasePath = '/arkme-self/api/call', contacts = [] }: { assetBasePath?: string; contacts?: ArkmeCallContact[] } = {}) {
  const selfAvatarUrl = `${assetBasePath.replace(/\/$/, '')}/avatar-self.png`
  const rootRef = useRef<HTMLDivElement>(null)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [personalTestEdition] = useState(readArkmePersonalTestEdition)
  const [compact, setCompact] = useState(false)
  const [selectedId, setSelectedId] = useState('demo-mother')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState('')
  const [audioItemId, setAudioItemId] = useState('')
  const [activeLineId, setActiveLineId] = useState('')
  const [query, setQuery] = useState('')
  const [mediaFilter, setMediaFilter] = useState<'all' | ArkmeCallMediaType>('all')
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [callTarget, setCallTarget] = useState<ArkmeCallContact | null>(null)
  const [callFeedback, setCallFeedback] = useState('')
  const [detailDismissed, setDetailDismissed] = useState(false)
  const [participantsExpanded, setParticipantsExpanded] = useState(false)
  const [selectedParticipant, setSelectedParticipant] = useState<'self' | 'peer' | null>(null)
  const [shareProfile, setShareProfile] = useState<ArkmeUserProfile | null>()
  const requestedPlaybackRef = useRef(false)
  const filteredItems = useMemo(() => filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, query, mediaFilter), [mediaFilter, query])
  const selected = useMemo(() => resolveSelectedCall(filteredItems, selectedId), [filteredItems, selectedId])

  useEffect(() => {
    const nextId = selected?.id ?? ''
    if (nextId !== selectedId) setSelectedId(nextId)
  }, [selected, selectedId])

  useEffect(() => {
    if (detailScrollRef.current !== null) detailScrollRef.current.scrollTop = 0
    setParticipantsExpanded(false)
    setSelectedParticipant(null)
  }, [selected?.id])

  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal).then(snapshot => {
      setShareProfile(snapshot.profile)
    }).catch(() => { setShareProfile(null) })
    return () => { controller.abort() }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (root === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { setCompact((entries[0]?.contentRect.width ?? 960) < 820) })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    if (selected === undefined) {
      setAudioUrl(''); setAudioItemId(''); setCurrentTime(0); setPlaying(false); setActiveLineId('')
      return
    }
    const url = createDemoWavUrl(previewDurationSeconds)
    setAudioUrl(url); setAudioItemId(selected.id); setCurrentTime(0); setPlaying(false); setActiveLineId('')
    return () => { URL.revokeObjectURL(url) }
  }, [selected])

  useEffect(() => {
    if (!requestedPlaybackRef.current || audioUrl === '' || audioItemId !== selected?.id || selected?.missed === true) return
    requestedPlaybackRef.current = false
    void audioRef.current?.play().catch(() => { setPlaying(false) })
  }, [audioItemId, audioUrl, selected])

  const requestPlayback = (item: ArkmeCallHistoryItem) => {
    if (item.missed) return
    if (item.id !== selected?.id) { requestedPlaybackRef.current = true; setDetailDismissed(false); setSelectedId(item.id); return }
    const audio = audioRef.current
    if (audio === null) return
    if (audio.paused) void audio.play().catch(() => { setPlaying(false) }); else audio.pause()
  }

  const seek = (seconds: number) => {
    if (selected === undefined) return
    const audio = audioRef.current
    if (audio === null) return
    audio.currentTime = transcriptToPreviewSeconds(selected, seconds); setCurrentTime(audio.currentTime)
    const transcriptTime = previewToTranscriptSeconds(selected, audio.currentTime)
    const activeLine = selected.transcript.find(line => transcriptTime >= line.atSeconds && transcriptTime <= line.endSeconds)
    setActiveLineId(activeLine?.id ?? '')
  }

  const playTranscriptLine = (line: ArkmeCallTranscriptLine) => {
    seek(line.atSeconds); setActiveLineId(line.id)
    void audioRef.current?.play().catch(() => { setPlaying(false) })
  }

  return <CallAssetBasePathContext.Provider value={assetBasePath}><div ref={rootRef} style={styles.root} data-arkme-call-history="prototype"><div style={{ ...styles.layout, gridTemplateColumns: compact ? '288px minmax(0,1fr)' : '326px minmax(0,1fr)' }}>
    <aside style={styles.listPane} aria-label="通话记录列表"><header style={styles.listHeader}>
      <div style={styles.listTitleLine}><h2 style={styles.listTitle}>通话</h2><span style={styles.demoChip}>{personalTestEdition === undefined ? '第一版演示' : arkmePersonalTestEditionLabel(personalTestEdition)}</span></div><p style={styles.listSubtitle}>找联系人，发起语音或视频通话；通话结束后可回放、看摘要和逐句转写。</p>
      <section style={styles.contactSection} aria-label="联系人快捷入口"><div style={styles.contactHeading}><h3 style={styles.contactTitle}>联系人</h3><span style={styles.contactHint}>选择联系人即可通话</span></div><div style={styles.contactRow}>
        <button type="button" style={styles.contactButton} aria-label="打开联系人与通话入口" onClick={() => { setContactDialogOpen(true) }}><span style={{ ...styles.contactAvatar, ...styles.contactAdd }}>＋</span><span style={styles.contactName}>添加</span></button>
        {contacts.slice(0, 3).map(contact => <button key={contact.sourceRef} type="button" style={styles.contactButton} aria-label={`选择联系人${contact.displayName}发起通话`} onClick={() => { setCallFeedback(''); setCallTarget(contact) }}><RealContactAvatar contact={contact} /><span style={styles.contactName}>{contact.displayName}</span></button>)}
      </div></section>
      <div style={styles.searchWrap}><span style={styles.searchIcon} aria-hidden>⌕</span><input style={styles.search} value={query} aria-label="搜索联系人" placeholder="搜索联系人" onChange={event => { setQuery(event.target.value) }} /></div>
      <div style={styles.filters} aria-label="通话类型筛选">{([['all', '全部'], ['audio', '语音'], ['video', '视频']] as const).map(([value, label]) => <button key={value} type="button" style={{ ...styles.filter, ...(mediaFilter === value ? styles.filterActive : {}) }} aria-pressed={mediaFilter === value} onClick={() => { setMediaFilter(value) }}>{label}</button>)}</div>
      {callFeedback !== '' && <p role="status" style={styles.addContactStatus}>{callFeedback}</p>}
    </header><ul style={styles.list} role="tree">{filteredItems.length > 0 ? filteredItems.map(item => <ArkmeCallHistoryRow key={item.id} item={item} selected={item.id === selected?.id && !detailDismissed} playing={item.id === selected?.id && playing} onSelect={() => { setDetailDismissed(false); setSelectedId(item.id) }} onTogglePlayback={() => { const realContact = contacts.find(contact => contact.displayName === item.peerName); setCallFeedback(''); setCallTarget(realContact ?? { sourceRef: '', displayName: item.peerName }) }} />) : <li style={styles.empty}>没有找到相关通话</li>}</ul></aside>

    <section style={styles.detail} aria-label="通话详情"><div ref={detailScrollRef} style={styles.detailScroll}><div style={styles.detailInner}>
      {selected === undefined || detailDismissed ? <div style={styles.empty}><strong>选择一条通话记录</strong><br />从左侧选择联系人，查看通话详情、回放和转写。</div> : (() => {
        const mediaText = selected.mediaType === 'video' ? '视频通话' : '语音通话'
        return <>
      <audio ref={audioRef} src={audioUrl} preload="metadata" onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false); setCurrentTime(0); setActiveLineId('') }} onTimeUpdate={event => {
        const nextTime = event.currentTarget.currentTime; setCurrentTime(nextTime)
        const transcriptTime = previewToTranscriptSeconds(selected, nextTime)
        const activeLine = selected.transcript.find(line => transcriptTime >= line.atSeconds && transcriptTime <= line.endSeconds); setActiveLineId(activeLine?.id ?? '')
      }} />
      {selected.mediaType === 'video' ? <><div style={styles.videoDetailTitleRow}><h2 style={styles.videoDetailTitle}>通话详情</h2><button type="button" style={styles.videoDetailClose} aria-label="关闭通话详情" onClick={() => { setDetailDismissed(true) }}>×</button></div><div style={styles.videoDetailMeta} aria-label="通话概览"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CallTypeIcon mediaType="video" />视频通话</span><time style={{ ...styles.videoDetailMetaCenter, display: 'flex', alignItems: 'center', gap: 6 }}><CallTimeIcon />{selected.startedLabel}</time><span style={{ ...styles.videoDetailMetaEnd, display: 'flex', alignItems: 'center', gap: 6 }}><CallDurationIcon />{selected.missed ? '未接通' : formatDuration(selected.durationSeconds)}</span></div></> : <><header style={styles.identity}><DemoPersonAvatar item={selected} style={styles.heroAvatar} /><div style={styles.identityText}><h2 style={styles.detailTitle}>与{selected.peerName}的{mediaText}</h2><p style={styles.detailMeta}>{selected.peerRelationship} · {selected.startedLabel}</p></div></header><div style={styles.overview} aria-label="通话概览"><span style={styles.overviewCell}><CallTypeIcon mediaType={selected.mediaType} />{mediaText}</span><span style={{ ...styles.overviewCell, ...styles.overviewDivider }}><CallTimeIcon />{selected.startedLabel}</span><span style={{ ...styles.overviewCell, ...styles.overviewDivider }}><CallDurationIcon />{selected.missed ? '未接通' : formatDuration(selected.durationSeconds)}</span></div></>}

      {selected.missed ? <div style={styles.empty}><strong>这次{mediaText}没有接通</strong><br />接通并完成录制后，可以在这里回放、查看摘要和转写。</div> : <>
        {selected.mediaType === 'video' ? <DemoVideoReplay item={selected} playing={playing} currentTime={currentTime} onToggle={() => { requestPlayback(selected) }} /> : <section style={styles.player} aria-label="通话录音播放器"><div style={styles.playerTop}>
          <button type="button" style={styles.mainPlay} aria-label={playing ? '暂停通话录音' : '播放通话录音'} onClick={() => { requestPlayback(selected) }}><PlaybackIcon playing={playing} size={18} /></button><div style={styles.playerCopy}><h3 style={styles.playerTitle}>通话录音</h3><p style={styles.playerSubtitle}>12 秒交互演示 · 完整通话 {formatDuration(selected.durationSeconds)} · 正式版播放原录音</p></div><time style={styles.timer}>{formatDuration(currentTime)} / {formatDuration(previewDurationSeconds)}</time>
        </div></section>}
        <DetailSection title="AI 摘要" hint="通话结束后自动整理"><p style={styles.summary}>{selected.summary}</p></DetailSection>
        <DetailSection title="通话转写" hint="点击气泡，播放并定位到这一段"><div style={styles.conversation} aria-label="聊天式通话转写" data-arkme-transcript-surface="plain"><p style={styles.conversationDate}>{selected.startedLabel} · 由通话语音自动转写</p><ol style={styles.messageList}>{selected.transcript.map(line => <TranscriptBubble key={line.id} item={selected} line={line} active={line.id === activeLineId} playing={playing} onPlay={() => { playTranscriptLine(line) }} />)}</ol><div style={styles.hangup}><span style={styles.hangupLine} aria-hidden /><span aria-hidden>☎</span><span>{selected.peerName}已挂断通话</span><span style={styles.hangupLine} aria-hidden /></div></div></DetailSection>
        <section style={{ ...styles.participantsSheet, ...(!participantsExpanded ? styles.participantsSheetCollapsed : {}) }} aria-label="通话参与人" data-arkme-call-participants="bottom-sheet" data-expanded={participantsExpanded ? 'true' : 'false'}>
          <button type="button" style={styles.participantsToggle} aria-expanded={participantsExpanded} {...(participantsExpanded ? { 'aria-controls': 'arkme-call-participants-content' } : {})} onClick={() => { setParticipantsExpanded(value => !value) }}><span style={styles.participantsHandle} aria-hidden /><span style={styles.participantsToggleLabel}>{participantsExpanded ? '收起通话参与人' : '查看通话参与人'}</span></button>
          {participantsExpanded && <div id="arkme-call-participants-content" style={styles.participantList}>
            <button type="button" style={styles.participantChip} onClick={() => { setSelectedParticipant('peer') }}><DemoPersonAvatar item={selected} style={styles.participantChipAvatar} /><span>{selected.peerName}</span></button>
            <button type="button" style={styles.participantChip} onClick={() => { setSelectedParticipant('self') }}><img src={selfAvatarUrl} alt="" style={styles.participantChipAvatar} aria-hidden="true" /><span>我</span></button>
          </div>}
        </section>
      </>}
      </>
      })()}
    </div></div></section>
  </div>{contactDialogOpen && <AddContactDialog profile={shareProfile} contacts={contacts} onCallContact={contact => { setContactDialogOpen(false); setCallTarget(contact) }} onClose={() => { setContactDialogOpen(false) }} />}{callTarget !== null && <CallTypeSheet name={callTarget.displayName} onClose={() => { setCallTarget(null) }} onSelect={mediaType => { if (callTarget.sourceRef.trim() === '') { setCallFeedback(`${callTarget.displayName}是演示联系人，请从上方真实联系人发起通话`); setCallTarget(null); return } outgoingCallUi.request({ sourceRef: callTarget.sourceRef, displayName: callTarget.displayName, mediaType }); setCallFeedback(`正在向${callTarget.displayName}发起${mediaType === 'video' ? '视频' : '语音'}通话`); setCallTarget(null) }} />}{selected !== undefined && selectedParticipant !== null && <ParticipantCard item={selected} participant={selectedParticipant} onClose={() => { setSelectedParticipant(null) }} />}</div></CallAssetBasePathContext.Provider>
}
