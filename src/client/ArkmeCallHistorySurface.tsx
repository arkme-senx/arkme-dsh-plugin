import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { createDemoWavUrl } from './demo-audio.js'

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
    id: 'demo-video', peerName: '陈依涵', peerRelationship: '同事', initials: '依涵', avatarBackground: '#d7dde8',
    direction: 'outgoing', mediaType: 'video', startedLabel: '今天 10:18', durationSeconds: 18 * 60 + 32,
    summary: '确认了新版通话页的交付范围：保留语音和视频入口，视频支持回放，转写改为聊天气泡。',
    transcript: [
      { id: 'video-1', speaker: '我', speakerRole: 'self', atSeconds: 1, endSeconds: 3.4, text: '通话详情这里，我想让用户一眼就能分清语音和视频。' },
      { id: 'video-2', speaker: '陈依涵', speakerRole: 'peer', atSeconds: 3.6, endSeconds: 6.1, text: '可以，视频记录上直接放回放入口，点进去就能看完整画面。' },
      { id: 'video-3', speaker: '我', speakerRole: 'self', atSeconds: 6.3, endSeconds: 8.8, text: '转写不要做成报告列表，改成像我们聊天一样会更轻松。' },
      { id: 'video-4', speaker: '陈依涵', speakerRole: 'peer', atSeconds: 9, endSeconds: 11.7, text: '好，每个气泡还能点播对应的那一段，找内容会快很多。' },
    ],
  },
  {
    id: 'demo-wife', peerName: '林小满', peerRelationship: '家人', initials: '小满', avatarBackground: '#e8d5ca',
    direction: 'outgoing', mediaType: 'audio', startedLabel: '今天 14:26', durationSeconds: 22 * 60 + 14,
    summary: '确认了晚饭、接孩子和周末采购安排。我下班买菜，小满先去接孩子。',
    transcript: [
      { id: 'wife-1', speaker: '我', speakerRole: 'self', atSeconds: 1, endSeconds: 3.3, text: '我下班顺路去菜场，晚上做你想吃的清蒸鱼。' },
      { id: 'wife-2', speaker: '林小满', speakerRole: 'peer', atSeconds: 3.5, endSeconds: 6, text: '好呀，那我先去接孩子，回家把米饭蒸上。' },
      { id: 'wife-3', speaker: '我', speakerRole: 'self', atSeconds: 6.2, endSeconds: 8.7, text: '家里纸巾和牛奶也快没了，我一起买回来。' },
      { id: 'wife-4', speaker: '林小满', speakerRole: 'peer', atSeconds: 8.9, endSeconds: 11.7, text: '行，你路上慢点，我到家先收衣服，等你回来开饭。' },
    ],
  },
  {
    id: 'demo-mother', peerName: '妈妈', peerRelationship: '家人', initials: '妈妈', avatarBackground: '#d6e1d5',
    direction: 'incoming', mediaType: 'audio', startedLabel: '昨天 12:08', durationSeconds: 8 * 60 + 47,
    summary: '确认周六回家吃午饭。我带水果和排骨，妈妈提前准备午饭。',
    transcript: [
      { id: 'mother-1', speaker: '我', speakerRole: 'self', atSeconds: 1, endSeconds: 3.4, text: '妈，这周六我带孩子回去吃午饭，顺路捎点水果。' },
      { id: 'mother-2', speaker: '妈妈', speakerRole: 'peer', atSeconds: 3.6, endSeconds: 6.2, text: '好啊，妈早上去菜市场，再把你爱吃的鱼准备上。' },
      { id: 'mother-3', speaker: '我', speakerRole: 'self', atSeconds: 6.4, endSeconds: 8.9, text: '那我出门前给您打电话，家里缺什么我一起带。' },
      { id: 'mother-4', speaker: '妈妈', speakerRole: 'peer', atSeconds: 9.1, endSeconds: 11.7, text: '行，你们别太赶，到了就吃饭。' },
    ],
  },
  {
    id: 'demo-missed', peerName: '周鹏', peerRelationship: '同事', initials: '周鹏', avatarBackground: '#e2ddd3',
    direction: 'incoming', mediaType: 'video', startedLabel: '周二 18:42', durationSeconds: 0,
    summary: '未接通，暂无录像、录音和通话摘要。', missed: true, transcript: [],
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
  searchWrap: { position: 'relative' },
  searchIcon: { position: 'absolute', left: 10, top: 21, color: c.tertiary, pointerEvents: 'none' },
  search: { width: '100%', height: 34, marginTop: 12, boxSizing: 'border-box', padding: '0 12px 0 32px', border: `1px solid ${c.border}`, borderRadius: 10, outline: 0, background: arkmeTheme.input, color: c.text, font: 'inherit', fontSize: 12 },
  filters: { display: 'flex', gap: 6, marginTop: 9 },
  filter: { height: 26, padding: '0 10px', border: `1px solid ${c.border}`, borderRadius: 999, background: arkmeTheme.elevated, color: c.secondary, font: 'inherit', fontSize: 11, cursor: 'pointer' },
  filterActive: { borderColor: c.accent, background: c.active, color: c.text, fontWeight: 650 },
  list: { flex: 1, minHeight: 0, margin: 0, padding: '8px', overflowY: 'auto', listStyle: 'none' },
  item: { position: 'relative', display: 'grid', gridTemplateColumns: '42px minmax(0,1fr) 32px', alignItems: 'center', gap: 10, padding: '11px 10px', borderRadius: 12 },
  itemActive: { background: c.active, boxShadow: `inset 3px 0 ${c.accent}` },
  itemSelect: { position: 'absolute', inset: 0, width: '100%', border: 0, borderRadius: 12, background: 'transparent', cursor: 'pointer' },
  avatar: { width: 42, height: 42, zIndex: 1, display: 'grid', placeItems: 'center', borderRadius: 999, color: '#41464d', fontSize: 12, fontWeight: 650, pointerEvents: 'none' },
  itemBody: { minWidth: 0, zIndex: 1, pointerEvents: 'none' },
  itemTop: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  itemName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  itemTime: { flex: 'none', color: c.tertiary, fontSize: 10, lineHeight: '16px' },
  itemMeta: { marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', whiteSpace: 'nowrap', color: c.secondary, fontSize: 11, lineHeight: '17px' },
  direction: { color: c.accent, fontWeight: 700 }, missed: { color: c.danger },
  itemPlay: { width: 30, height: 30, zIndex: 2, display: 'grid', placeItems: 'center', padding: 0, border: `1px solid ${c.border}`, borderRadius: 999, background: arkmeTheme.elevated, color: c.text, cursor: 'pointer', fontSize: 12 },
  playSpacer: { width: 30, height: 30 },
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
  player: { marginTop: 20, padding: '17px 18px', border: `1px solid ${c.border}`, borderRadius: 16, background: c.layer },
  playerTop: { display: 'flex', alignItems: 'center', gap: 12 },
  mainPlay: { width: 42, height: 42, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: c.text, color: arkmeTheme.foreground, cursor: 'pointer', fontSize: 14 },
  playerCopy: { minWidth: 0, flex: 1 }, playerTitle: { margin: 0, fontSize: 14, lineHeight: '21px', fontWeight: 650 },
  playerSubtitle: { margin: '2px 0 0', color: c.secondary, fontSize: 11, lineHeight: '17px' },
  timer: { flex: 'none', color: c.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 11 },
  videoPlayer: { marginTop: 20, overflow: 'hidden', border: `1px solid ${c.border}`, borderRadius: 16, background: '#16191d', boxShadow: '0 12px 34px rgba(20,24,30,.12)' },
  videoStage: { position: 'relative', aspectRatio: '16 / 9', display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', background: '#1c2025' },
  videoPanel: { position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden' },
  videoAvatar: { width: 70, height: 70, display: 'grid', placeItems: 'center', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 650, boxShadow: '0 12px 32px rgba(0,0,0,.24)', transition: 'transform 220ms ease-out' },
  videoName: { position: 'absolute', left: 12, bottom: 10, padding: '3px 7px', borderRadius: 999, color: '#fff', background: 'rgba(0,0,0,.42)', fontSize: 10 },
  videoDim: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(7,10,14,.30)' },
  videoPlay: { width: 54, height: 54, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid rgba(255,255,255,.42)', borderRadius: 999, background: 'rgba(0,0,0,.56)', color: '#fff', fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(8px)' },
  videoControlDock: { position: 'absolute', zIndex: 3, top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 999, background: 'rgba(0,0,0,.54)', color: '#fff', backdropFilter: 'blur(8px)' },
  videoControlButton: { width: 30, height: 30, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' },
  videoHint: { flex: 'none', color: 'rgba(255,255,255,.68)', fontSize: 10 },
  section: { marginTop: 22 }, sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10 },
  sectionTitle: { margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 650 }, sectionHint: { margin: 0, color: c.tertiary, fontSize: 11, lineHeight: '17px' },
  summary: { margin: '9px 0 0', padding: '13px 15px', borderRadius: 13, background: arkmeTheme.layer2, fontSize: 13, lineHeight: 1.7 },
  conversation: { marginTop: 9 },
  conversationDate: { margin: '0 0 14px', color: c.tertiary, textAlign: 'center', fontSize: 10 },
  messageList: { margin: 0, padding: 0, listStyle: 'none' },
  messageRow: { display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10 }, messageRowSelf: { flexDirection: 'row-reverse' },
  messageAvatar: { width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, color: '#41464d', fontSize: 9, fontWeight: 650 },
  messageStack: { maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }, messageStackSelf: { alignItems: 'flex-end' },
  speakerName: { margin: '0 3px 4px', color: c.tertiary, fontSize: 10, lineHeight: '14px' },
  bubble: { maxWidth: '100%', padding: '9px 10px 7px', boxSizing: 'border-box', border: 0, borderRadius: '5px 15px 15px 15px', background: arkmeTheme.messageOther, color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  bubbleSelf: { borderRadius: '15px 5px 15px 15px', background: arkmeTheme.messageOwn }, bubblePlaying: { boxShadow: `0 0 0 2px ${arkmeTheme.infoSoft}`, background: arkmeTheme.accentSoft },
  bubbleText: { margin: 0, fontSize: 13, lineHeight: 1.5 }, bubbleMeta: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4, color: c.tertiary, fontVariantNumeric: 'tabular-nums', fontSize: 10 },
  bubblePlayingIcon: { color: c.accent, fontWeight: 700 },
  empty: { margin: '38px auto 0', padding: '42px 18px', border: `1px dashed ${c.border}`, borderRadius: 16, color: c.secondary, textAlign: 'center', fontSize: 13, lineHeight: 1.7 },
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

export function ArkmeCallHistoryRow({ item, selected, playing, onSelect, onTogglePlayback }: {
  item: ArkmeCallHistoryItem; selected: boolean; playing: boolean; onSelect(): void; onTogglePlayback(): void
}) {
  const direction = item.direction === 'incoming' ? '↙' : '↗'
  const mediaText = item.mediaType === 'video' ? '视频通话' : '语音通话'
  const detail = item.missed ? `未接通 · ${mediaText}` : `${mediaText} · ${formatDuration(item.durationSeconds)}`
  return <li><div role="treeitem" aria-selected={selected} style={{ ...styles.item, ...(selected ? styles.itemActive : {}) }}>
    <button type="button" style={styles.itemSelect} aria-label={`查看与${item.peerName}的${mediaText}记录`} onClick={onSelect} />
    <span style={{ ...styles.avatar, background: item.avatarBackground }} aria-hidden>{item.initials}</span>
    <span style={styles.itemBody}><span style={styles.itemTop}><span style={{ ...styles.itemName, ...(item.missed ? styles.missed : {}) }}>{item.peerName}</span><time style={styles.itemTime}>{item.startedLabel}</time></span>
      <span style={{ ...styles.itemMeta, ...(item.missed ? styles.missed : {}) }}><span style={{ ...styles.direction, ...(item.missed ? styles.missed : {}) }}>{direction}</span><CallTypeIcon mediaType={item.mediaType} />{detail}</span></span>
    {!item.missed ? <button type="button" style={styles.itemPlay} aria-label={`${playing ? '暂停' : '播放'}与${item.peerName}的${item.mediaType === 'video' ? '视频回放' : '通话录音'}`} onClick={onTogglePlayback}>{playing ? 'Ⅱ' : '▶'}</button> : <span style={styles.playSpacer} />}
  </div></li>
}

function DemoVideoReplay({ item, playing, currentTime, onToggle }: { item: ArkmeCallHistoryItem; playing: boolean; currentTime: number; onToggle(): void }) {
  const movement = playing ? Math.sin(currentTime * 1.4) * 2 : 0
  return <section style={styles.videoPlayer} aria-label="视频通话回放" data-arkme-video-replay="demo">
    <div style={styles.videoStage}>
      <div style={{ ...styles.videoPanel, background: 'linear-gradient(145deg,#5b697a,#263341)' }}><span style={{ ...styles.videoAvatar, background: '#7d8997', transform: `translate(${movement}px,${-movement}px) scale(${1 + currentTime / 420})` }}>我</span><span style={styles.videoName}>我</span></div>
      <div style={{ ...styles.videoPanel, background: 'linear-gradient(145deg,#c6b7b0,#725f5a)' }}><span style={{ ...styles.videoAvatar, background: item.avatarBackground, color: '#41464d', transform: `translate(${-movement}px,${movement}px) scale(${1 + currentTime / 480})` }}>{item.initials}</span><span style={styles.videoName}>{item.peerName}</span></div>
      {!playing && <div style={styles.videoDim}><button type="button" style={styles.videoPlay} aria-label="播放视频通话回放" onClick={onToggle}>▶</button></div>}
      {playing && <div style={styles.videoControlDock}><button type="button" style={styles.videoControlButton} aria-label="暂停视频回放" onClick={onToggle}>Ⅱ</button><time style={{ ...styles.timer, color: 'rgba(255,255,255,.8)' }}>{formatDuration(currentTime)} / {formatDuration(previewDurationSeconds)}</time><span style={styles.videoHint}>演示回放</span></div>}
    </div>
  </section>
}

function TranscriptBubble({ item, line, active, playing, onPlay }: { item: ArkmeCallHistoryItem; line: ArkmeCallTranscriptLine; active: boolean; playing: boolean; onPlay(): void }) {
  const self = line.speakerRole === 'self'
  return <li style={{ ...styles.messageRow, ...(self ? styles.messageRowSelf : {}) }} data-arkme-call-transcript-bubble={line.id}>
    <span style={{ ...styles.messageAvatar, background: self ? '#d9e2ea' : item.avatarBackground }} aria-hidden>{self ? '我' : item.initials}</span>
    <div style={{ ...styles.messageStack, ...(self ? styles.messageStackSelf : {}) }}><span style={styles.speakerName}>{line.speaker}</span>
      <button type="button" style={{ ...styles.bubble, ...(self ? styles.bubbleSelf : {}), ...(active ? styles.bubblePlaying : {}) }} aria-label={`播放${line.speaker}在${formatDuration(line.atSeconds)}的语音片段`} aria-pressed={active && playing} onClick={onPlay}>
        <p style={styles.bubbleText}>{line.text}</p><span style={styles.bubbleMeta}>{active && playing && <span style={styles.bubblePlayingIcon}>Ⅱ</span>}<span>{formatDuration(line.atSeconds)}–{formatDuration(line.endSeconds)}</span></span>
      </button>
    </div>
  </li>
}

function DetailSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section style={styles.section}><div style={styles.sectionHead}><h3 style={styles.sectionTitle}>{title}</h3><p style={styles.sectionHint}>{hint}</p></div>{children}</section>
}

export function ArkmeCallHistorySurface() {
  const rootRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [compact, setCompact] = useState(false)
  const [selectedId, setSelectedId] = useState(ARKME_CALL_DEMO_ITEMS[0]?.id ?? '')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState('')
  const [audioItemId, setAudioItemId] = useState('')
  const [activeLineId, setActiveLineId] = useState('')
  const [query, setQuery] = useState('')
  const [mediaFilter, setMediaFilter] = useState<'all' | ArkmeCallMediaType>('all')
  const requestedPlaybackRef = useRef(false)
  const filteredItems = useMemo(() => filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, query, mediaFilter), [mediaFilter, query])
  const selected = useMemo(() => resolveSelectedCall(filteredItems, selectedId), [filteredItems, selectedId])

  useEffect(() => {
    const nextId = selected?.id ?? ''
    if (nextId !== selectedId) setSelectedId(nextId)
  }, [selected, selectedId])

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
    if (item.id !== selected?.id) { requestedPlaybackRef.current = true; setSelectedId(item.id); return }
    const audio = audioRef.current
    if (audio === null) return
    if (audio.paused) void audio.play().catch(() => { setPlaying(false) }); else audio.pause()
  }

  const seek = (seconds: number) => {
    if (selected === undefined) return
    const audio = audioRef.current
    if (audio === null) return
    audio.currentTime = Math.max(0, Math.min(previewDurationSeconds, seconds)); setCurrentTime(audio.currentTime)
    const activeLine = selected.transcript.find(line => audio.currentTime >= line.atSeconds && audio.currentTime <= line.endSeconds)
    setActiveLineId(activeLine?.id ?? '')
  }

  const playTranscriptLine = (line: ArkmeCallTranscriptLine) => {
    seek(line.atSeconds); setActiveLineId(line.id)
    void audioRef.current?.play().catch(() => { setPlaying(false) })
  }

  return <div ref={rootRef} style={styles.root} data-arkme-call-history="prototype"><div style={{ ...styles.layout, gridTemplateColumns: compact ? '288px minmax(0,1fr)' : '340px minmax(0,1fr)' }}>
    <aside style={styles.listPane} aria-label="通话记录列表"><header style={styles.listHeader}>
      <div style={styles.listTitleLine}><h2 style={styles.listTitle}>通话</h2><span style={styles.demoChip}>第一版演示</span></div><p style={styles.listSubtitle}>语音、视频和转写集中在一起</p>
      <div style={styles.searchWrap}><span style={styles.searchIcon} aria-hidden>⌕</span><input style={styles.search} value={query} aria-label="搜索联系人" placeholder="搜索联系人" onChange={event => { setQuery(event.target.value) }} /></div>
      <div style={styles.filters} aria-label="通话类型筛选">{([['all', '全部'], ['audio', '语音'], ['video', '视频']] as const).map(([value, label]) => <button key={value} type="button" style={{ ...styles.filter, ...(mediaFilter === value ? styles.filterActive : {}) }} aria-pressed={mediaFilter === value} onClick={() => { setMediaFilter(value) }}>{label}</button>)}</div>
    </header><ul style={styles.list} role="tree">{filteredItems.length > 0 ? filteredItems.map(item => <ArkmeCallHistoryRow key={item.id} item={item} selected={item.id === selected?.id} playing={item.id === selected?.id && playing} onSelect={() => { setSelectedId(item.id) }} onTogglePlayback={() => { requestPlayback(item) }} />) : <li style={styles.empty}>没有找到相关通话</li>}</ul></aside>

    <section style={styles.detail} aria-label="通话详情"><div style={styles.detailScroll}><div style={styles.detailInner}>
      {selected === undefined ? <div style={styles.empty}><strong>没有找到相关通话</strong><br />换一个联系人名称，或切换上方的通话类型。</div> : (() => {
        const mediaText = selected.mediaType === 'video' ? '视频通话' : '语音通话'
        return <>
      <audio ref={audioRef} src={audioUrl} preload="metadata" onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false); setCurrentTime(0); setActiveLineId('') }} onTimeUpdate={event => {
        const nextTime = event.currentTarget.currentTime; setCurrentTime(nextTime)
        const activeLine = selected.transcript.find(line => nextTime >= line.atSeconds && nextTime <= line.endSeconds); setActiveLineId(activeLine?.id ?? '')
      }} />
      <header style={styles.identity}><span style={{ ...styles.heroAvatar, background: selected.avatarBackground }} aria-hidden>{selected.initials}</span><div style={styles.identityText}><h2 style={styles.detailTitle}>与{selected.peerName}的{mediaText}</h2><p style={styles.detailMeta}>{selected.peerRelationship} · {selected.startedLabel}</p></div></header>
      <div style={styles.overview} aria-label="通话概览"><span style={styles.overviewCell}><CallTypeIcon mediaType={selected.mediaType} />{mediaText}</span><span style={{ ...styles.overviewCell, ...styles.overviewDivider }}>◷ {selected.startedLabel}</span><span style={{ ...styles.overviewCell, ...styles.overviewDivider }}>◴ {selected.missed ? '未接通' : formatDuration(selected.durationSeconds)}</span></div>

      {selected.missed ? <div style={styles.empty}><strong>这次{mediaText}没有接通</strong><br />接通并完成录制后，可以在这里回放、查看摘要和转写。</div> : <>
        {selected.mediaType === 'video' ? <DemoVideoReplay item={selected} playing={playing} currentTime={currentTime} onToggle={() => { requestPlayback(selected) }} /> : <section style={styles.player} aria-label="通话录音播放器"><div style={styles.playerTop}>
          <button type="button" style={styles.mainPlay} aria-label={playing ? '暂停通话录音' : '播放通话录音'} onClick={() => { requestPlayback(selected) }}>{playing ? 'Ⅱ' : '▶'}</button><div style={styles.playerCopy}><h3 style={styles.playerTitle}>通话录音</h3><p style={styles.playerSubtitle}>12 秒交互演示 · 完整通话 {formatDuration(selected.durationSeconds)} · 正式版播放原录音</p></div><time style={styles.timer}>{formatDuration(currentTime)} / {formatDuration(previewDurationSeconds)}</time>
        </div></section>}
        <DetailSection title="AI 摘要" hint="通话结束后自动整理"><p style={styles.summary}>{selected.summary}</p></DetailSection>
        <DetailSection title="通话转写" hint="点击气泡，播放并定位到这一段"><div style={styles.conversation} aria-label="聊天式通话转写" data-arkme-transcript-surface="plain"><p style={styles.conversationDate}>{selected.startedLabel} · 由通话语音自动转写</p><ol style={styles.messageList}>{selected.transcript.map(line => <TranscriptBubble key={line.id} item={selected} line={line} active={line.id === activeLineId} playing={playing} onPlay={() => { playTranscriptLine(line) }} />)}</ol></div></DetailSection>
      </>}
      </>
      })()}
    </div></div></section>
  </div></div>
}
