import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type {
  ArkmeRecordingCalendarDay,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingDay,
  ArkmeRecordingDoubaoBackfillResult,
  ArkmeRecordingSection,
  ArkmeRecordingTimelineEvent,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'
import { createDemoWavUrl } from './demo-audio.js'

type RecordingTab = 'transcript' | 'summary' | 'timeline'
const recordingDemoDurationSeconds = 18

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  subtle: arkmeTheme.subtle,
  accent: arkmeTheme.info,
  success: arkmeTheme.text,
  danger: arkmeTheme.danger,
  warning: arkmeTheme.warning,
}
const speakerPalette = [
  '#ec7fa9', '#799eff', '#80a1ba', '#b4debd', '#f5d2d2',
  '#ffde63', '#e69db8', '#b7b1f2', '#91c4c3', '#4cc9fe',
  '#ffbd73', '#e178c5', '#beadfa', '#ffa1cf', '#e6ba95',
]

function speakerColorAt(index: number): string {
  if (index < 0) return '#a4a4a4'
  if (index < speakerPalette.length) return speakerPalette[index] ?? '#a4a4a4'
  const cycleStart = Math.max(0, speakerPalette.length - 7)
  const cycleLength = speakerPalette.length - cycleStart
  return cycleLength > 0
    ? speakerPalette[cycleStart + ((index - cycleStart + 1) % cycleLength)] ?? '#a4a4a4'
    : '#a4a4a4'
}
const styles: Record<string, CSSProperties> = {
  root: { flex: 1, width: '100%', height: 'auto', minWidth: 0, minHeight: 0, overflow: 'hidden', color: colors.text, background: arkmeTheme.base },
  layout: { height: '100%', minHeight: 0, display: 'grid', alignItems: 'stretch', gap: 16, padding: 18, boxSizing: 'border-box', overflow: 'hidden' },
  leftColumn: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain' },
  calendar: { minWidth: 0, padding: 0, border: `1px solid ${colors.border}`, borderRadius: 14, background: arkmeTheme.layer2, overflow: 'hidden' },
  monthHeader: { minHeight: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 18px' },
  monthNavigation: { display: 'flex', alignItems: 'center', gap: 5 },
  monthTitle: { display: 'flex', alignItems: 'center', gap: 12, margin: '0 4px', fontSize: 15, fontWeight: 650 },
  monthUnit: { display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' },
  monthSelect: { minHeight: 30, padding: '0 4px', border: 0, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 650 },
  iconButton: { width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 20 },
  week: { display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 0, padding: '0 8px', borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`, background: arkmeTheme.layer2 },
  weekDay: { color: colors.secondary, textAlign: 'center', fontSize: 11, lineHeight: '42px' },
  days: { display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 6, padding: 8, background: arkmeTheme.layer2 },
  day: { position: 'relative', display: 'grid', gridTemplateRows: '24px 12px', alignContent: 'center', justifyItems: 'center', minWidth: 0, height: 76, padding: '12px 2px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 7, background: arkmeTheme.layer2, color: 'inherit', cursor: 'pointer', font: 'inherit' },
  dayPast: { background: arkmeTheme.elevated },
  dayDate: { gridRow: 1, lineHeight: '24px' },
  daySelected: { boxShadow: `inset 0 0 0 2px ${colors.secondary}` },
  dayToday: { background: arkmeTheme.layer2 },
  duration: { gridRow: 2, display: 'block', minWidth: 28, padding: '1px 5px', boxSizing: 'border-box', borderRadius: 999, whiteSpace: 'nowrap', background: arkmeTheme.dangerSoft, color: colors.danger, textAlign: 'center', fontSize: 9, lineHeight: '14px' },
  durationLong: { background: arkmeTheme.subtle, color: colors.secondary },
  todayLabel: { gridRow: 2, color: colors.text, fontSize: 9, lineHeight: '14px' },
  unreviewedDot: { position: 'absolute', top: 8, right: 8, width: 5, height: 5, borderRadius: 999, background: colors.accent },
  content: { position: 'relative', minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', border: 0, borderRadius: 0, overflow: 'hidden', background: 'transparent' },
  contentHeader: { flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 18px 0' },
  dateControls: { display: 'flex', alignItems: 'center', gap: 8 },
  dateTitle: { margin: 0, fontSize: 17, fontWeight: 680 },
  total: { color: colors.secondary, fontSize: 12 },
  todayButton: { minHeight: 38, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0 14px', background: arkmeTheme.elevated, color: 'inherit', cursor: 'pointer' },
  tabs: { flex: 'none', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 10, padding: '4px 10px 2px 8px', boxSizing: 'border-box', borderBottom: 0 },
  tabList: { display: 'flex', alignItems: 'center', gap: 28, paddingBottom: 0 },
  tab: { position: 'relative', minWidth: 0, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(0,0,0,0)', borderRadius: 10, padding: '0 4px', background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '16px', letterSpacing: '.28px' },
  tabActive: { borderColor: 'rgba(0,0,0,0)', background: 'transparent', color: colors.text, fontWeight: 500 },
  tabActiveIndicator: { position: 'absolute', left: '50%', bottom: -2, width: 10, height: 2, borderRadius: 22, background: colors.text, transform: 'translateX(-50%)', pointerEvents: 'none' },
  tabActions: { alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 20, paddingBottom: 0 },
  toolbarIconButton: { width: 24, height: 24, display: 'grid', placeItems: 'center', boxSizing: 'border-box', padding: 2, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  toolbarNotice: { position: 'absolute', zIndex: 5, right: 16, top: 220, maxWidth: 360, padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: 9, background: arkmeTheme.elevated, color: colors.text, boxShadow: '0 8px 24px rgba(0,0,0,.12)', fontSize: 12 },
  tabPanel: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: `1px solid ${colors.border}`, borderRight: `1px solid ${colors.border}`, borderLeft: `1px solid ${colors.border}`, borderRadius: '10px 10px 0 0', overflow: 'hidden', background: arkmeTheme.layer1 },
  pane: { flex: 1, minHeight: 0, padding: 0, boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain' },
  status: { padding: '42px 16px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { padding: '12px 14px', borderRadius: 10, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  transcriptSearchRow: { position: 'sticky', zIndex: 3, top: 0, minHeight: 58, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 14px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`, background: arkmeTheme.layer1 },
  transcriptSearchControls: { minWidth: 0, flex: '1 1 auto', display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 8 },
  transcriptSearch: { position: 'relative', width: 266, minWidth: 190, maxWidth: 266, height: 36, flex: '1 1 220px', display: 'flex', alignItems: 'center' },
  transcriptSearchIcon: { position: 'absolute', zIndex: 1, left: 12, width: 16, height: 16, color: colors.secondary, pointerEvents: 'none' },
  transcriptSearchInput: { width: '100%', height: 36, padding: '0 76px 0 38px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 9, outline: 0, appearance: 'none', WebkitAppearance: 'none', background: arkmeTheme.layer1, color: colors.text, font: 'inherit', fontSize: 13 },
  transcriptSearchInputActive: { borderColor: colors.success, boxShadow: `0 0 0 1px ${colors.success}` },
  transcriptSearchCount: { position: 'absolute', zIndex: 1, right: 34, color: colors.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 11, lineHeight: '24px', pointerEvents: 'none' },
  transcriptSearchClear: { position: 'absolute', right: 6, width: 24, height: 24, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 17, lineHeight: 1 },
  transcriptSearchNavigation: { minHeight: 30, flex: 'none', padding: '0 10px', border: `1px solid ${colors.border}`, borderRadius: 8, background: arkmeTheme.layer1, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  transcriptSearchNavigationDisabled: { opacity: .45, cursor: 'default' },
  transcriptSearchActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 18 },
  transcriptSearchMatch: { padding: '0 1px', borderRadius: 2, background: arkmeTheme.layer2, color: colors.text, fontWeight: 700 },
  transcriptSearchMatchCurrent: { background: arkmeTheme.warningSoft, color: colors.text },
  player: { flex: 'none', margin: '14px 16px 0', padding: '14px 16px', border: `1px solid ${colors.border}`, borderRadius: 12, background: arkmeTheme.layer3 },
  playerTop: { display: 'flex', alignItems: 'center', gap: 12 },
  playerButton: { width: 38, height: 38, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: colors.text, color: arkmeTheme.foreground, cursor: 'pointer' },
  playerCopy: { minWidth: 0, flex: 1 },
  playerTitle: { margin: 0, fontSize: 13, lineHeight: '20px', fontWeight: 680 },
  playerHint: { margin: '2px 0 0', color: colors.secondary, fontSize: 10, lineHeight: '16px' },
  playerClock: { flex: 'none', color: colors.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 11 },
  playerRange: { width: '100%', height: 18, margin: 0, accentColor: colors.accent, cursor: 'pointer' },
  overview: { position: 'relative', zIndex: 4, flex: 'none', margin: '16px 0 0', padding: '14px 16px 12px', border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'visible', background: arkmeTheme.layer3 },
  overviewNavigation: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'start', gap: 16 },
  dayTrackColumn: { minWidth: 0 },
  zoomControls: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 18 },
  zoomButton: { width: 18, height: 18, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', color: colors.text, cursor: 'pointer' },
  zoomHint: { color: colors.secondary, whiteSpace: 'nowrap', fontSize: 10, lineHeight: '18px' },
  dayTrack: { position: 'relative', height: 10, overflow: 'visible', borderRadius: 999, background: arkmeTheme.subtle },
  daySegment: { position: 'absolute', top: 0, bottom: 0, minWidth: 2, borderRadius: 2 },
  dayViewport: { position: 'absolute', zIndex: 2, top: -3, height: 16, minWidth: 4, boxSizing: 'border-box', border: `1px solid ${colors.accent}`, borderRadius: 4, background: arkmeTheme.layer3, pointerEvents: 'none' },
  dayViewportGrip: { position: 'absolute', top: 2, left: '50%', width: 5, height: 10, border: `1px solid ${colors.accent}`, borderRadius: 2, background: arkmeTheme.layer1, transform: 'translateX(-50%)' },
  dayNavigationInput: { position: 'absolute', zIndex: 3, inset: '-8px 0', width: '100%', height: 26, margin: 0, opacity: .001, cursor: 'ew-resize' },
  dayTrackLabels: { display: 'flex', justifyContent: 'space-between', marginTop: 6, color: colors.secondary, fontSize: 9 },
  focusTrackShell: { position: 'relative' },
  focusTrack: { position: 'relative', height: 22, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 999, background: arkmeTheme.subtle, cursor: 'grab', touchAction: 'none', userSelect: 'none' },
  focusSegment: { position: 'absolute', top: 0, bottom: 0, minWidth: 3, borderRight: `1px solid ${arkmeTheme.layer3}` },
  focusPlayhead: { position: 'absolute', zIndex: 4, top: -27, width: 78, height: 50, padding: 0, border: 0, background: 'transparent', color: colors.accent, cursor: 'pointer', transform: 'translateX(-50%)' },
  focusPlayheadBubble: { position: 'absolute', top: 0, left: '50%', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 24, padding: '2px 4px 2px 8px', boxSizing: 'border-box', borderRadius: 999, background: arkmeTheme.layer2, color: colors.secondary, boxShadow: '0 2px 8px rgba(0,0,0,.08)', fontVariantNumeric: 'tabular-nums', fontSize: 10, whiteSpace: 'nowrap', transform: 'translateX(-50%)' },
  focusPlayheadToggle: { width: 18, height: 18, display: 'grid', placeItems: 'center', borderRadius: 999, background: arkmeTheme.layer1, color: colors.secondary, fontSize: 8, lineHeight: 1 },
  focusPlayheadLine: { position: 'absolute', top: 24, bottom: 0, left: '50%', width: 2, borderRadius: 2, background: colors.accent, transform: 'translateX(-50%)' },
  focusPlayheadDot: { position: 'absolute', top: 28, left: '50%', width: 10, height: 10, boxSizing: 'border-box', border: `2px solid ${colors.accent}`, borderRadius: 999, background: arkmeTheme.layer1, transform: 'translateX(-50%)' },
  focusLabels: { display: 'flex', justifyContent: 'space-between', marginTop: 4, padding: '0 2px', color: colors.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 9 },
  overviewExpandToggle: { position: 'absolute', left: '50%', bottom: 1, width: 36, height: 20, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 2, background: 'transparent', color: colors.secondary, cursor: 'pointer', transform: 'translateX(-50%)' },
  speakerLegend: { position: 'relative', display: 'flex', alignItems: 'center', gap: 18, marginTop: 10, minHeight: 36, padding: '7px 10px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'visible', background: arkmeTheme.layer3 },
  legendItem: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, color: colors.secondary, whiteSpace: 'nowrap', fontSize: 10 },
  legendDot: { width: 14, height: 14, flex: 'none', borderRadius: 999 },
  legendToggle: { marginLeft: 'auto', minWidth: 48, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, padding: 0, border: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit' },
  legendMore: { minWidth: 28, padding: '2px 6px', boxSizing: 'border-box', borderRadius: 999, background: arkmeTheme.layer2, color: colors.secondary, textAlign: 'center', fontSize: 10 },
  legendDistribution: { position: 'absolute', zIndex: 8, top: 'calc(100% + 4px)', left: -1, right: -1, padding: '8px 0', border: `1px solid ${colors.border}`, borderRadius: 12, background: arkmeTheme.layer1, boxShadow: '0 10px 28px rgba(0,0,0,.08)' },
  legendDistributionRow: { minHeight: 52, display: 'grid', gridTemplateColumns: '96px minmax(72px,1fr) auto', alignItems: 'center', gap: 12, padding: '0 14px', boxSizing: 'border-box', borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  legendDistributionTrack: { position: 'relative', height: 7, minWidth: 0, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 999, background: arkmeTheme.base },
  legendDistributionSegment: { position: 'absolute', top: 0, bottom: 0, minWidth: 2 },
  legendDistributionStats: { minWidth: 138, color: colors.secondary, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 10 },
  transcriptGroup: { marginTop: 18 },
  transcriptGroupFirst: { marginTop: 0 },
  transcriptGroupTitle: { position: 'sticky', top: -18, zIndex: 1, margin: '0 0 7px', padding: '7px 0 5px', background: arkmeTheme.layer1, color: colors.secondary, fontSize: 11, lineHeight: '16px', fontWeight: 600 },
  transcriptList: { display: 'flex', flexDirection: 'column', gap: 5, margin: 0, padding: 0, listStyle: 'none' },
  transcript: { position: 'relative', width: '100%', minHeight: 38, display: 'block', padding: '8px 10px', boxSizing: 'border-box', border: 0, borderRadius: 10, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  transcriptActive: { background: arkmeTheme.layer2, boxShadow: `inset 3px 0 ${colors.accent}` },
  time: { color: colors.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 12, lineHeight: '22px' },
  transcriptSpeaker: { position: 'absolute', zIndex: 1, top: 8, left: 10, maxWidth: 118, overflow: 'hidden', pointerEvents: 'none' },
  transcriptMeta: { position: 'absolute', right: 10, bottom: 8, display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 5, color: colors.secondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 11, lineHeight: '22px', pointerEvents: 'none' },
  transcriptMetaReserve: { display: 'inline-flex', alignItems: 'baseline', gap: 5, marginLeft: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 11, lineHeight: '22px', visibility: 'hidden' },
  speaker: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 650, lineHeight: '22px' },
  speakerDot: { flex: 'none', width: 16, height: 16, borderRadius: 999 },
  transcriptText: { minHeight: 22, margin: 0, paddingLeft: 20, textIndent: 118, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px' },
  background: { display: 'inline-block', marginLeft: 6, padding: '0 5px', borderRadius: 999, background: arkmeTheme.subtle, color: colors.secondary, fontSize: 9, lineHeight: '17px', verticalAlign: 1 },
  versionBar: { minHeight: 58, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '8px 16px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}` },
  versionSummary: { color: colors.text, whiteSpace: 'nowrap', fontSize: 12 },
  versionControls: { display: 'contents' },
  select: { width: '100%', minWidth: 0, border: `1px solid ${colors.border}`, borderRadius: 9, padding: '9px 11px', background: arkmeTheme.elevated, color: 'inherit' },
  regenerate: { minHeight: 38, padding: '0 16px', border: 0, borderRadius: 9, background: colors.success, color: arkmeTheme.foreground, font: 'inherit', fontSize: 12, fontWeight: 650 },
  banner: { margin: '16px 18px 0', padding: '9px 11px', borderRadius: 8, background: arkmeTheme.warningSoft, color: colors.warning, fontSize: 12 },
  markdown: { fontSize: 14, lineHeight: 1.75, wordBreak: 'break-word' },
  markdownHeading: { margin: '18px 0 8px', fontWeight: 700 },
  markdownLine: { margin: '4px 0', whiteSpace: 'pre-wrap' },
  eventList: { position: 'relative', display: 'flex', flexDirection: 'column', padding: '14px 18px 28px' },
  event: { position: 'relative', width: '100%', padding: '16px 12px 20px 30px', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  eventRail: { position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: arkmeTheme.layer2 },
  eventDot: { position: 'absolute', zIndex: 1, left: 3, top: 21, width: 12, height: 12, border: `3px solid ${arkmeTheme.layer1}`, borderRadius: 999, background: colors.accent },
  eventHeadingRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 8 },
  eventHeader: { minWidth: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 7 },
  eventTime: { flex: 'none', color: colors.text, fontVariantNumeric: 'tabular-nums', fontSize: 15, fontWeight: 700 },
  eventTitle: { margin: 0, fontSize: 15, fontWeight: 700 },
  eventLocation: { flex: 'none', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', padding: '4px 10px', borderRadius: 999, background: colors.subtle, color: colors.secondary, whiteSpace: 'nowrap', fontSize: 12, lineHeight: '18px' },
  eventText: { margin: '5px 0 0', whiteSpace: 'pre-wrap', color: colors.secondary, fontSize: 14, lineHeight: 1.65 },
  eventParticipants: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 12 },
  eventParticipant: { display: 'inline-flex', alignItems: 'center', gap: 7, color: colors.secondary, whiteSpace: 'nowrap', fontSize: 14, lineHeight: '28px' },
  eventParticipantDot: { width: 28, height: 28, flex: 'none', borderRadius: 999 },
  eventParticipantMore: { color: colors.secondary, cursor: 'help', fontSize: 13, lineHeight: '28px' },
  timelineDialogBackdrop: { position: 'fixed', zIndex: 10020, inset: 0, display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', background: 'rgba(18,20,23,.52)' },
  timelineDialog: { position: 'relative', width: 'min(900px,calc(100vw - 56px))', maxHeight: 'min(780px,calc(100vh - 56px))', overflowY: 'auto', padding: '28px 30px 36px', boxSizing: 'border-box', borderRadius: 16, background: arkmeTheme.layer1, color: colors.text, boxShadow: '0 24px 80px rgba(0,0,0,.24)' },
  timelineDialogClose: { position: 'absolute', top: 18, right: 18, width: 34, height: 34, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 30, fontWeight: 300, lineHeight: 1 },
  timelineDialogTitle: { margin: '0 48px 8px 0', fontSize: 24, lineHeight: 1.35, fontWeight: 750 },
  timelineDialogLocation: { margin: 0, color: colors.secondary, fontSize: 14, lineHeight: 1.7 },
  timelineDialogSection: { marginTop: 24 },
  timelineDialogSectionTitle: { margin: '0 0 10px', fontSize: 17, lineHeight: '24px', fontWeight: 700 },
  timelineDialogSummary: { margin: '0 0 0 28px', whiteSpace: 'pre-wrap', color: colors.secondary, fontSize: 14, lineHeight: 1.75 },
  timelineDialogParticipants: { display: 'flex', flexWrap: 'wrap', gap: '16px 36px', marginLeft: 28 },
  timelineDialogParticipant: { minWidth: 130, display: 'inline-flex', alignItems: 'center', gap: 10, color: colors.secondary, fontSize: 14 },
  timelineDialogQuoteList: { display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 0 28px', padding: 0, listStyle: 'none' },
  timelineDialogQuote: { display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 8, alignItems: 'start', color: colors.secondary, fontSize: 14, lineHeight: 1.7 },
  timelineDialogQuoteDot: { width: 16, height: 16, marginTop: 4, borderRadius: 999 },
  timelineDialogQuoteSpeaker: { color: colors.text, fontWeight: 650 },
  compareBackdrop: { position: 'fixed', zIndex: 10040, inset: 0, display: 'grid', background: arkmeTheme.layer1 },
  compareDialog: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: arkmeTheme.layer1, color: colors.text },
  compareHeader: { height: 58, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${colors.border}` },
  compareTitle: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 700 },
  compareClose: { width: 36, height: 36, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 32, fontWeight: 300, lineHeight: 1 },
  compareColumns: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' },
  compareColumn: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' },
  compareColumnRight: { borderLeft: `1px solid ${colors.border}` },
  compareColumnTitle: { height: 48, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 24px', borderBottom: `1px solid ${colors.border}`, fontSize: 16, fontWeight: 650 },
  compareColumnState: { color: colors.secondary, fontSize: 12, fontWeight: 400 },
  compareList: { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px 24px 28px' },
  compareRow: { display: 'grid', gridTemplateColumns: '14px 94px minmax(0,1fr) auto', alignItems: 'start', gap: '0 10px', padding: '8px 0', color: colors.secondary, fontSize: 14, lineHeight: 1.6 },
  compareSpeakerDot: { width: 14, height: 14, marginTop: 4, borderRadius: 999 },
  compareSpeaker: { overflow: 'hidden', textOverflow: 'ellipsis', color: colors.text, whiteSpace: 'nowrap', fontWeight: 500 },
  compareText: { minWidth: 0, whiteSpace: 'pre-wrap' },
  compareTime: { paddingLeft: 8, color: colors.secondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 12 },
  compareEmpty: { flex: 1, display: 'grid', placeItems: 'center', padding: 32, color: colors.secondary, textAlign: 'center', fontSize: 14, lineHeight: 1.7 },
  emptyCard: { maxWidth: 620, margin: '18px auto', padding: '32px 24px', border: `1px dashed ${colors.border}`, borderRadius: 16, textAlign: 'center' },
  emptyTitle: { margin: 0, fontSize: 17, lineHeight: '25px' },
  emptyText: { margin: '7px 0 0', color: colors.secondary, fontSize: 12, lineHeight: 1.7 },
  actionRow: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 9, marginTop: 20 },
  actionButton: { minHeight: 38, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 10, background: arkmeTheme.elevated, color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12 },
  actionPrimary: { borderColor: colors.accent, background: arkmeTheme.layer2 },
  notice: { margin: '14px 0 0', color: colors.secondary, fontSize: 11, lineHeight: 1.65 },
  localAudio: { width: '100%', height: 36, marginTop: 12 },
  captureArea: { flex: 'none', marginTop: 12 },
  captureToolbar: { display: 'flex', flexWrap: 'nowrap', gap: 10 },
  captureButton: { minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', border: `1px solid ${colors.border}`, borderRadius: 9, background: arkmeTheme.elevated, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500, lineHeight: '16px', whiteSpace: 'nowrap' },
  capturePrimary: { borderColor: colors.text, background: colors.text, color: arkmeTheme.foreground },
  captureNotice: { margin: '8px 2px 0', color: colors.secondary, fontSize: 11, lineHeight: 1.55 },
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function monthStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function dateKey(value: number | Date): string {
  const date = typeof value === 'number' ? new Date(value) : value
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function calendarCells(month: Date): Array<Date | undefined> {
  const first = monthStart(month)
  const leading = (first.getDay() + 6) % 7
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return [
    ...Array.from<undefined>({ length: leading }),
    ...Array.from({ length: count }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1)),
  ]
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function calendarDuration(milliseconds: number): string {
  if (milliseconds <= 0) return ''
  const roundedHours = Math.max(0.1, Math.round(milliseconds / 360_000) / 10)
  return `${roundedHours.toFixed(1)}h`
}

export function RecordingCalendarCell({ date, meta, selected, isToday, isPast = false, disabled = false, onClick }: {
  date: Date
  meta: ArkmeRecordingCalendarDay | undefined
  selected: boolean
  isToday: boolean
  isPast?: boolean
  disabled?: boolean
  onClick(): void
}) {
  const hasDuration = meta !== undefined && meta.durationMillis > 0
  return <button type="button" disabled={disabled} data-arkme-calendar-day-state={isToday ? 'today' : isPast ? 'past' : 'future'} style={{ ...styles.day, ...(isPast ? styles.dayPast : {}), ...(isToday ? styles.dayToday : {}), ...(selected ? styles.daySelected : {}), opacity: disabled ? .5 : 1, cursor: disabled ? 'default' : 'pointer' }} aria-pressed={selected} onClick={onClick}>
    {meta !== undefined && meta.unreviewedCount > 0 && <span style={{ ...styles.unreviewedDot, background: colors.success }} aria-label={`${String(meta.unreviewedCount)}条待查看录音`} />}
    <span style={styles.dayDate}>{date.getDate()}</span>
    {hasDuration && <span style={{ ...styles.duration, ...(meta.durationMillis > 3_600_000 ? styles.durationLong : {}) }}>{calendarDuration(meta.durationMillis)}</span>}
    {!hasDuration && isToday && <span style={styles.todayLabel}>今日</span>}
  </button>
}

export function RecordingSpeakerLabel({ label, colorIndex, isBackground, children }: {
  label: string
  colorIndex: number
  isBackground: boolean
  children?: ReactNode
}) {
  return <span style={styles.speaker}>
    <span aria-hidden="true" style={{ ...styles.speakerDot, background: speakerColorAt(colorIndex) }} />
    <span>{children ?? label}</span>
    {isBackground && <span style={styles.background}>背景音</span>}
  </span>
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

function versionLabel(version: ArkmeRecordingVersion): string {
  const time = version.generatedAtMillis > 0
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(version.generatedAtMillis))
    : '时间未知'
  return `${time}${version.modelDisplayName === '' ? '' : ` · ${version.modelDisplayName}`}`
}

function clockDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function compactTimeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

const recordingZoomLevelsMillis = [
  86_400_000,
  43_200_000,
  21_600_000,
  10_800_000,
  7_200_000,
  3_600_000,
  1_800_000,
  1_500_000,
  900_000,
  600_000,
  300_000,
  180_000,
  60_000,
  30_000,
  15_000,
  10_000,
  5_000,
] as const

function clampRecordingViewStart(value: number, span: number, dayStartMillis: number): number {
  return Math.max(dayStartMillis, Math.min(dayStartMillis + 86_400_000 - span, value))
}

function initialRecordingViewport(items: ArkmeRecordingTranscriptItem[], dayStartMillis: number): { start: number; span: number } {
  if (items.length === 0) return { start: dayStartMillis, span: 86_400_000 }
  const span = 1_500_000
  const firstStart = Math.max(dayStartMillis, Math.min(dayStartMillis + 86_400_000, Math.min(...items.map(item => item.startAtMillis))))
  return { start: clampRecordingViewStart(firstStart - 120_000, span, dayStartMillis), span }
}

function ZoomGlyph({ direction }: { direction: 'in' | 'out' }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M2.669 7.334a4.667 4.667 0 1 1 9.334 0 4.667 4.667 0 0 1-9.334 0Zm4.667-6a6 6 0 1 0 3.745 10.688l2.45 2.45a.667.667 0 0 0 .943-.943l-2.45-2.45A6 6 0 0 0 7.336 1.334Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d={direction === 'in'
      ? 'M6.672 9.336a.667.667 0 0 0 1.333 0V8.002h1.334a.667.667 0 0 0 0-1.333H8.005V5.336a.667.667 0 0 0-1.333 0v1.333H5.339a.667.667 0 0 0 0 1.333h1.333v1.334Z'
      : 'M4.672 7.334c0-.368.298-.666.667-.666h4a.667.667 0 1 1 0 1.333h-4a.667.667 0 0 1-.667-.667Z'} fill="currentColor" />
  </svg>
}

function ToolbarGlyph({ kind }: { kind: 'expand' | 'collapse' | 'export' | 'edit' | 'select' | 'compare' }) {
  if (kind === 'select') return <svg data-arkme-recording-toolbar-icon="select" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M2.59 5.262a.963.963 0 0 0 1.364 0L6.57 2.645a.963.963 0 1 0-1.362-1.362L3.27 3.219l-.626-.627a.963.963 0 1 0-1.362 1.362L2.59 5.262Zm0 6.728a.963.963 0 0 0 1.362 0L6.57 9.373a.963.963 0 0 0-1.362-1.362L3.27 9.946l-.626-.626a.963.963 0 1 0-1.362 1.362L2.59 11.99Zm0 6.727a.963.963 0 0 0 1.362 0L6.57 16.1a.963.963 0 0 0-1.362-1.362L3.27 16.674l-.626-.626a.963.963 0 1 0-1.362 1.362l1.308 1.307ZM9.986 18h8.028a1.002 1.002 0 0 0 0-2.005H9.986a1.002 1.002 0 0 0 0 2.005Zm0-13.995h8.028a1.002 1.002 0 0 0 0-2.005H9.986a1.002 1.002 0 0 0 0 2.005Zm0 6.997h8.028a1.002 1.002 0 0 0 0-2.004H9.986a1.002 1.002 0 0 0 0 2.004Z" fill="currentColor" />
  </svg>
  if (kind === 'compare') return <svg data-arkme-recording-toolbar-icon="compare" aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none">
    <rect x="1.5" y="2.5" width="5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <rect x="9.5" y="2.5" width="5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.2 5.5h1.6M3.2 8h1.6M11.2 5.5h1.6M11.2 8h1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
  if (kind === 'export') return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none">
    <path d="M13.7 7.418c3 .258 4.225 1.8 4.225 5.175v.108c0 3.725-1.492 5.217-5.217 5.217H7.283c-3.725 0-5.217-1.492-5.217-5.217v-.108c0-3.35 1.209-4.892 4.159-5.167M10 12.499V3.016M12.79 4.876 10 2.084 7.207 4.876" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'edit') return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none">
    <path d="M2 18h16M11.9 2.707a1 1 0 0 1 1.414 0l2.828 2.829a1 1 0 0 1 0 1.414l-7.188 7.188a1 1 0 0 1-.636.29l-3.046.218a1 1 0 0 1-1.069-1.069l.218-3.046a1 1 0 0 1 .29-.636L11.9 2.707Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
  const collapse = kind === 'collapse'
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 14.667h4c3.333 0 4.666-1.334 4.666-4.667V6c0-3.333-1.333-4.667-4.666-4.667H6C2.667 1.333 1.333 2.667 1.333 6v4c0 3.333 1.334 4.667 4.667 4.667Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    {collapse
      ? <><path d="M7 9 4 12M12 4 9 7M9 4.333V7h2.667M7 11.667V9H4.333" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></>
      : <><path d="m12 4-8 8M12 6.667V4H9.333M4 9.333V12h2.667" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></>}
  </svg>
}

function LegendChevronGlyph({ expanded }: { expanded: boolean }) {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d={expanded ? 'm3.25 8.25 3.75-3.5 3.75 3.5' : 'm3.25 5.75 3.75 3.5 3.75-3.5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function RecordingTimelineExpandGlyph() {
  return <svg aria-hidden="true" width="24" height="5" viewBox="0 0 24 5" fill="none">
    <path d="M1 1L12 4L23 1.135" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function RecordingTabGlyph({ kind }: { kind: 'timeline' | 'summary' | 'transcript' }) {
  if (kind === 'timeline') return <svg data-arkme-recording-tab-icon="timeline" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M10 18.25C8.91659 18.25 7.8438 18.0366 6.84286 17.622C5.84193 17.2074 4.93245 16.5997 4.16637 15.8336C3.40029 15.0675 2.79259 14.1581 2.37799 13.1571C1.96339 12.1562 1.75 11.0834 1.75 10C1.75 8.91659 1.96339 7.8438 2.37799 6.84286C2.7926 5.84192 3.40029 4.93245 4.16637 4.16637C4.93245 3.40028 5.84193 2.79259 6.84286 2.37799C7.8438 1.96339 8.9166 1.75 10 1.75C11.0834 1.75 12.1562 1.96339 13.1571 2.37799C14.1581 2.7926 15.0675 3.40029 15.8336 4.16637C16.5997 4.93245 17.2074 5.84193 17.622 6.84286C18.0366 7.8438 18.25 8.9166 18.25 10C18.25 11.0834 18.0366 12.1562 17.622 13.1571C17.2074 14.1581 16.5997 15.0675 15.8336 15.8336C15.0675 16.5997 14.1581 17.2074 13.1571 17.622C12.1562 18.0366 11.0834 18.25 10 18.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 7V10.125L8 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'summary') return <svg data-arkme-recording-tab-icon="summary" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M6.0026 14.6666H10.0026C13.3359 14.6666 14.6693 13.3333 14.6693 9.99992V5.99992C14.6693 2.66659 13.3359 1.33325 10.0026 1.33325H6.0026C2.66927 1.33325 1.33594 2.66659 1.33594 5.99992V9.99992C1.33594 13.3333 2.66927 14.6666 6.0026 14.6666Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.3333 12.3334C11.0667 12.3334 11.6667 11.7334 11.6667 11.0001V5.00008C11.6667 4.26675 11.0667 3.66675 10.3333 3.66675C9.6 3.66675 9 4.26675 9 5.00008V11.0001C9 11.7334 9.59333 12.3334 10.3333 12.3334Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.66927 12.3333C6.4026 12.3333 7.0026 11.7333 7.0026 10.9999V8.66659C7.0026 7.93325 6.4026 7.33325 5.66927 7.33325C4.93594 7.33325 4.33594 7.93325 4.33594 8.66659V10.9999C4.33594 11.7333 4.92927 12.3333 5.66927 12.3333Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <svg data-arkme-recording-tab-icon="transcript" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M5.33594 8.13354H10.0026" stroke="currentColor" strokeWidth="1.3" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.33594 10.8H8.25594" stroke="currentColor" strokeWidth="1.3" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.66927 3.99992H9.33594C10.6693 3.99992 10.6693 3.33325 10.6693 2.66659C10.6693 1.33325 10.0026 1.33325 9.33594 1.33325H6.66927C6.0026 1.33325 5.33594 1.33325 5.33594 2.66659C5.33594 3.99992 6.0026 3.99992 6.66927 3.99992Z" stroke="currentColor" strokeWidth="1.3" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.6667 2.67969C12.8867 2.79969 14 3.61969 14 6.66635V10.6664C14 13.333 13.3333 14.6664 10 14.6664H6C2.66667 14.6664 2 13.333 2 10.6664V6.66635C2 3.62635 3.11333 2.79969 5.33333 2.67969" stroke="currentColor" strokeWidth="1.3" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function RecordingSearchGlyph() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="m14 14-2.9-2.9M7.333 12.667a5.333 5.333 0 1 0 0-10.667 5.333 5.333 0 0 0 0 10.667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

type RecordingTranscriptSearchField = 'time' | 'speaker' | 'text'

export interface RecordingTranscriptSearchMatch {
  matchId: string
  itemId: string
  field: RecordingTranscriptSearchField
  start: number
  end: number
}

function recordingTextSearchRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const keyword = query.trim().toLocaleLowerCase('zh-CN')
  if (keyword === '') return []
  const source = text.toLocaleLowerCase('zh-CN')
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = 0
  while (cursor <= source.length - keyword.length) {
    const start = source.indexOf(keyword, cursor)
    if (start < 0) break
    ranges.push({ start, end: start + keyword.length })
    cursor = start + Math.max(1, keyword.length)
  }
  return ranges
}

function recordingTranscriptSearchMatchId(itemId: string, field: RecordingTranscriptSearchField, start: number): string {
  return `${itemId}:${field}:${String(start)}`
}

export function recordingTranscriptSearchMatches(items: ArkmeRecordingTranscriptItem[], query: string): RecordingTranscriptSearchMatch[] {
  const matches: RecordingTranscriptSearchMatch[] = []
  for (const item of items) {
    const fields: Array<{ field: RecordingTranscriptSearchField; value: string }> = [
      { field: 'time', value: timeLabel(item.startAtMillis) },
      { field: 'speaker', value: item.speakerLabel },
      { field: 'text', value: item.text },
    ]
    for (const field of fields) {
      for (const range of recordingTextSearchRanges(field.value, query)) matches.push({
        matchId: recordingTranscriptSearchMatchId(item.itemId, field.field, range.start),
        itemId: item.itemId,
        field: field.field,
        start: range.start,
        end: range.end,
      })
    }
  }
  return matches
}

export function RecordingTranscriptHighlightedText({ text, query, itemId, field, currentMatchId }: {
  text: string
  query: string
  itemId: string
  field: RecordingTranscriptSearchField
  currentMatchId: string
}) {
  const ranges = recordingTextSearchRanges(text, query)
  if (ranges.length === 0) return <>{text}</>
  const content: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) content.push(text.slice(cursor, range.start))
    const matchId = recordingTranscriptSearchMatchId(itemId, field, range.start)
    const current = matchId === currentMatchId
    content.push(<mark
      key={matchId}
      data-arkme-recording-search-match={matchId}
      data-arkme-recording-search-current={current ? 'true' : undefined}
      style={{ ...styles.transcriptSearchMatch, ...(current ? styles.transcriptSearchMatchCurrent : {}) }}
    >{text.slice(range.start, range.end)}</mark>)
    cursor = range.end
  }
  if (cursor < text.length) content.push(text.slice(cursor))
  return <>{content}</>
}

export function RecordingTranscriptSearch({ value, matchCount, activeMatchIndex, onChange, onPrevious, onNext, onCompare, onEdit }: {
  value: string
  matchCount: number
  activeMatchIndex: number
  onChange(value: string): void
  onPrevious(): void
  onNext(): void
  onCompare(): void
  onEdit(): void
}) {
  const searching = value.trim() !== ''
  const displayedMatchIndex = matchCount === 0 ? 0 : Math.min(Math.max(0, activeMatchIndex), matchCount - 1)
  const resultLabel = matchCount === 0 ? '0/0' : `${String(displayedMatchIndex + 1)}/${String(matchCount)}`
  return <div style={styles.transcriptSearchRow} data-arkme-recording-transcript-search="today">
    <div style={styles.transcriptSearchControls}>
      <label style={styles.transcriptSearch}>
        <span style={styles.transcriptSearchIcon}><RecordingSearchGlyph /></span>
        <input
          type="text"
          role="searchbox"
          maxLength={64}
          value={value}
          aria-label="搜索当天转写"
          placeholder="搜索当天转写"
          style={{ ...styles.transcriptSearchInput, ...(searching ? styles.transcriptSearchInputActive : {}) }}
          onChange={event => { onChange(event.target.value) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || !searching) return
            event.preventDefault()
            if (event.shiftKey) onPrevious(); else onNext()
          }}
        />
        {searching && <span style={styles.transcriptSearchCount} role="status" aria-label={`搜索结果 ${resultLabel}`}>{resultLabel}</span>}
        {value !== '' && <button type="button" style={styles.transcriptSearchClear} aria-label="清空转写搜索" onClick={() => { onChange('') }}>×</button>}
      </label>
      {searching && <>
        <button type="button" style={{ ...styles.transcriptSearchNavigation, ...(matchCount === 0 ? styles.transcriptSearchNavigationDisabled : {}) }} disabled={matchCount === 0} onClick={onPrevious}>上一个</button>
        <button type="button" style={{ ...styles.transcriptSearchNavigation, ...(matchCount === 0 ? styles.transcriptSearchNavigationDisabled : {}) }} disabled={matchCount === 0} onClick={onNext}>下一个</button>
      </>}
    </div>
    <div style={styles.transcriptSearchActions} aria-label="转写专属操作">
      <button type="button" style={styles.toolbarIconButton} aria-label="转写对比" title="转写对比" onClick={onCompare}><ToolbarGlyph kind="compare" /></button>
      <button type="button" style={styles.toolbarIconButton} aria-label="编辑转写" title="编辑转写" onClick={onEdit}><ToolbarGlyph kind="edit" /></button>
    </div>
  </div>
}

export function RecordingTabActions({ activeTab, timelineExpanded, onSelectMode, onToggleTimeline, onExport }: {
  activeTab: RecordingTab
  timelineExpanded: boolean
  onSelectMode(): void
  onToggleTimeline(): void
  onExport(): void
}) {
  return <div style={styles.tabActions} aria-label="录音操作">
    {activeTab === 'transcript' && <button type="button" style={styles.toolbarIconButton} aria-label="转写多选模式" title="多选" onClick={onSelectMode}><ToolbarGlyph kind="select" /></button>}
    <button type="button" style={styles.toolbarIconButton} aria-label={timelineExpanded ? '收起时间轴' : '展开时间轴'} title={timelineExpanded ? '收起' : '展开'} onClick={onToggleTimeline}><ToolbarGlyph kind={timelineExpanded ? 'collapse' : 'expand'} /></button>
    <button type="button" style={styles.toolbarIconButton} aria-label="导出录音分析" title="导出" onClick={onExport}><ToolbarGlyph kind="export" /></button>
  </div>
}

function CaptureGlyph({ kind }: { kind: 'bind' | 'import' | 'record' }) {
  if (kind === 'bind') return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 9.333A1.333 1.333 0 1 0 8 6.667a1.333 1.333 0 0 0 0 2.666ZM13.336 12a6.65 6.65 0 0 0 1.333-4 6.65 6.65 0 0 0-1.333-4M2.67 4a6.65 6.65 0 0 0-1.334 4A6.65 6.65 0 0 0 2.67 12M11.195 10.4a3.98 3.98 0 0 0 .8-2.4c0-.9-.3-1.733-.8-2.4M4.8 5.6A3.98 3.98 0 0 0 4 8c0 .9.3 1.733.8 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'import') return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M10.955 5.933c2.4.207 3.38 1.44 3.38 4.14v.087c0 2.98-1.193 4.173-4.173 4.173h-4.34c-2.98 0-4.174-1.193-4.174-4.173v-.087c0-2.68.967-3.913 3.327-4.133M8 1.333V9.92M10.232 8.433 8 10.667 5.766 8.433" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8.003 10.333a2.667 2.667 0 0 0 2.666-2.666V4a2.667 2.667 0 0 0-5.333 0v3.667a2.667 2.667 0 0 0 2.667 2.666ZM2.898 6.433v1.134a5.1 5.1 0 0 0 10.2 0V6.433M7.07 4.287a2.67 2.67 0 0 1 1.854 0M7.469 5.7c.353-.093.72-.093 1.073 0M8 12.667v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function downloadTextFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
}

function recordingExportDate(value: Date): string {
  return `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function recordingTranscriptExport(items: ArkmeRecordingTranscriptItem[]): string {
  return items.map(item => {
    const durationSeconds = Math.max(0, Math.round((item.endAtMillis - item.startAtMillis) / 1_000))
    return `${item.speakerLabel}  [${timeLabel(item.startAtMillis)} ${String(durationSeconds)}秒]：\n${item.text}`
  }).join('\n\n')
}

function recordingTimelineExport(version: ArkmeRecordingVersion): string {
  if (version.content.trim() !== '') return version.content
  return version.timelineEvents.map(event => {
    const details = [event.description, event.todo === '' ? '' : `待办：${event.todo}`].filter(Boolean).join('\n')
    return `## ${event.timeRange || event.startAt} · ${event.title}${details === '' ? '' : `\n\n${details}`}`
  }).join('\n\n')
}

export interface RecordingSpeakerDistribution {
  key: string
  label: string
  colorIndex: number
  itemCount: number
  durationMillis: number
  percentage: number
  items: ArkmeRecordingTranscriptItem[]
}

export function recordingSpeakerDistributions(items: ArkmeRecordingTranscriptItem[]): RecordingSpeakerDistribution[] {
  const groups = new Map<string, RecordingSpeakerDistribution>()
  for (const item of items) {
    const key = `${String(item.speakerColorIndex)}:${item.speakerLabel}`
    const durationMillis = Math.max(0, item.endAtMillis - item.startAtMillis)
    const current = groups.get(key)
    if (current === undefined) {
      groups.set(key, {
        key,
        label: item.speakerLabel,
        colorIndex: item.speakerColorIndex,
        itemCount: 1,
        durationMillis,
        percentage: 0,
        items: [item],
      })
    } else {
      current.itemCount += 1
      current.durationMillis += durationMillis
      current.items.push(item)
    }
  }
  const totalDurationMillis = [...groups.values()].reduce((total, group) => total + group.durationMillis, 0)
  return [...groups.values()].map(group => ({
    ...group,
    percentage: totalDurationMillis <= 0 ? 0 : group.durationMillis / totalDurationMillis * 100,
  })).sort((left, right) => right.durationMillis - left.durationMillis)
}

export function recordingDistributionDurationLabel(durationMillis: number): string {
  const seconds = Math.max(0, Math.round(durationMillis / 1_000))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes <= 0) return `${String(remainingSeconds)}s`
  return `${String(minutes)}m${remainingSeconds === 0 ? '' : `${String(remainingSeconds)}s`}`
}

export function recordingTranscriptDurationLabel(item: Pick<ArkmeRecordingTranscriptItem, 'startAtMillis' | 'endAtMillis'>): string {
  return `${String(Math.max(0, Math.round((item.endAtMillis - item.startAtMillis) / 1_000)))}秒`
}

export function RecordingTranscriptRow({ item, query = '', currentMatchId = '', playbackActive = false, selected = false, playing = false, onPlay }: {
  item: ArkmeRecordingTranscriptItem
  query?: string
  currentMatchId?: string
  playbackActive?: boolean
  selected?: boolean
  playing?: boolean
  onPlay(): void
}) {
  const itemTime = timeLabel(item.startAtMillis)
  const duration = recordingTranscriptDurationLabel(item)
  return <button
    type="button"
    data-arkme-recording-transcript-item={item.itemId}
    style={{ ...styles.transcript, ...(playbackActive ? styles.transcriptActive : {}) }}
    data-arkme-recording-active={playbackActive ? 'true' : undefined}
    aria-label={`播放并定位${itemTime}的录音`}
    aria-pressed={selected && playing}
    onClick={onPlay}
  >
    <span data-arkme-recording-transcript-speaker={item.itemId} style={styles.transcriptSpeaker}>
      <RecordingSpeakerLabel label={item.speakerLabel} colorIndex={item.speakerColorIndex} isBackground={item.isBackground}>
        <RecordingTranscriptHighlightedText text={item.speakerLabel} query={query} itemId={item.itemId} field="speaker" currentMatchId={currentMatchId} />
      </RecordingSpeakerLabel>
    </span>
    <p data-arkme-recording-transcript-text={item.itemId} style={styles.transcriptText}>
      <span data-arkme-recording-transcript-text-flow={item.itemId}>
        <RecordingTranscriptHighlightedText text={item.text} query={query} itemId={item.itemId} field="text" currentMatchId={currentMatchId} />
      </span>
      <span data-arkme-recording-transcript-meta-reserve={item.itemId} style={styles.transcriptMetaReserve} aria-hidden="true"><time>{itemTime}</time><span>{duration}</span></span>
    </p>
    <span data-arkme-recording-transcript-meta={item.itemId} style={styles.transcriptMeta}><time><RecordingTranscriptHighlightedText text={itemTime} query={query} itemId={item.itemId} field="time" currentMatchId={currentMatchId} /></time><span>{duration}</span></span>
  </button>
}

export function RecordingSignalOverview({ items, dayStartMillis, positionSeconds, playing, canPlay, expanded = true, onToggle, onSeek, onExpand }: {
  items: ArkmeRecordingTranscriptItem[]
  dayStartMillis: number
  positionSeconds: number
  playing: boolean
  canPlay: boolean
  expanded?: boolean
  onToggle(): void
  onSeek(seconds: number): void
  onExpand?(): void
}) {
  const dayEndMillis = dayStartMillis + 86_400_000
  const focusStart = items.length > 0 ? Math.min(...items.map(item => item.startAtMillis)) : dayStartMillis
  const rawFocusEnd = items.length > 0 ? Math.max(...items.map(item => Math.max(item.startAtMillis, item.endAtMillis))) : dayStartMillis + 30 * 60_000
  const focusEnd = Math.max(focusStart + 60_000, rawFocusEnd)
  const focusSpan = focusEnd - focusStart
  const initialViewport = initialRecordingViewport(items, dayStartMillis)
  const [viewStartMillis, setViewStartMillis] = useState(initialViewport.start)
  const [visibleSpanMillis, setVisibleSpanMillis] = useState(initialViewport.span)
  const [draggingFocus, setDraggingFocus] = useState(false)
  const [speakerLegendExpanded, setSpeakerLegendExpanded] = useState(false)
  const focusTrackRef = useRef<HTMLDivElement>(null)
  const focusDragRef = useRef<{ pointerId: number; startX: number; startView: number; moved: boolean }>()
  const speakerDistributions = recordingSpeakerDistributions(items)
  const viewEndMillis = viewStartMillis + visibleSpanMillis
  const focusLabels = Array.from({ length: 6 }, (_, index) => compactTimeLabel(viewStartMillis + visibleSpanMillis * index / 5))
  const viewportLeft = clampPercent((viewStartMillis - dayStartMillis) / (dayEndMillis - dayStartMillis) * 100)
  const viewportWidth = Math.max(.4, clampPercent(visibleSpanMillis / (dayEndMillis - dayStartMillis) * 100))
  const playbackMillis = focusStart + Math.max(0, Math.min(1, positionSeconds / recordingDemoDurationSeconds)) * focusSpan
  const playbackLeft = (playbackMillis - viewStartMillis) / visibleSpanMillis * 100
  const playbackVisible = canPlay && playbackLeft >= 0 && playbackLeft <= 100

  useEffect(() => {
    const viewport = initialRecordingViewport(items, dayStartMillis)
    setViewStartMillis(viewport.start)
    setVisibleSpanMillis(viewport.span)
  }, [dayStartMillis, items])

  useEffect(() => {
    if (!playing || playbackMillis >= viewStartMillis && playbackMillis <= viewEndMillis) return
    setViewStartMillis(clampRecordingViewStart(playbackMillis - visibleSpanMillis / 2, visibleSpanMillis, dayStartMillis))
  }, [dayStartMillis, playbackMillis, playing, viewEndMillis, viewStartMillis, visibleSpanMillis])

  useEffect(() => {
    if (!expanded) setSpeakerLegendExpanded(false)
  }, [expanded])

  const setViewport = (nextSpan: number, anchorRatio = .5, anchorMillis = viewStartMillis + visibleSpanMillis * anchorRatio) => {
    const span = Math.max(5_000, Math.min(86_400_000, nextSpan))
    setVisibleSpanMillis(span)
    setViewStartMillis(clampRecordingViewStart(anchorMillis - span * anchorRatio, span, dayStartMillis))
  }

  const zoomByButton = (zoomIn: boolean) => {
    let next = visibleSpanMillis
    if (zoomIn) {
      for (const level of recordingZoomLevelsMillis) {
        if (level < visibleSpanMillis - 1) { next = level; break }
      }
    } else {
      for (let index = recordingZoomLevelsMillis.length - 1; index >= 0; index -= 1) {
        const level = recordingZoomLevelsMillis[index]
        if (level !== undefined && level > visibleSpanMillis + 1) { next = level; break }
      }
    }
    setViewport(next)
  }

  const seekAtClientX = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect()
    if (bounds.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    const targetMillis = viewStartMillis + ratio * visibleSpanMillis
    onSeek(Math.max(0, Math.min(recordingDemoDurationSeconds, (targetMillis - focusStart) / focusSpan * recordingDemoDurationSeconds)))
  }

  const handleFocusPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPlay || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    focusDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startView: viewStartMillis, moved: false }
    setDraggingFocus(true)
  }

  const handleFocusPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = focusDragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    const width = event.currentTarget.getBoundingClientRect().width
    if (width <= 0) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) >= 3) drag.moved = true
    setViewStartMillis(clampRecordingViewStart(drag.startView - delta / width * visibleSpanMillis, visibleSpanMillis, dayStartMillis))
  }

  const handleFocusPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = focusDragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    if (!drag.moved) seekAtClientX(event.clientX, event.currentTarget)
    focusDragRef.current = undefined
    setDraggingFocus(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleOverviewWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!canPlay) return
    event.preventDefault()
    const bounds = focusTrackRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()
    const anchorRatio = bounds.width <= 0 ? .5 : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const anchorMillis = viewStartMillis + visibleSpanMillis * anchorRatio
    setViewport(visibleSpanMillis * Math.exp(event.deltaY * .001), anchorRatio, anchorMillis)
  }

  const handleFocusKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canPlay) return
    const amount = visibleSpanMillis * .1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setViewStartMillis(value => clampRecordingViewStart(value + (event.key === 'ArrowLeft' ? -amount : amount), visibleSpanMillis, dayStartMillis))
    } else if (event.key === 'Home') {
      event.preventDefault(); setViewStartMillis(dayStartMillis)
    } else if (event.key === 'End') {
      event.preventDefault(); setViewStartMillis(dayEndMillis - visibleSpanMillis)
    }
  }

  return <section style={{ ...styles.overview, padding: expanded ? '14px 16px 12px' : '12px 16px 25px' }} aria-label="全天录音分布" data-arkme-recording-overview="client-parity" data-arkme-recording-wheel-scope="overview" data-arkme-recording-expanded={expanded ? 'true' : 'false'} data-arkme-recording-visible-millis={Math.round(visibleSpanMillis)} onWheel={handleOverviewWheel}>
    {expanded && <div style={styles.overviewNavigation}>
      <div style={styles.dayTrackColumn}>
        <div style={styles.dayTrack} aria-label="24小时录音概览">{items.map(item => {
          const left = clampPercent((item.startAtMillis - dayStartMillis) / (dayEndMillis - dayStartMillis) * 100)
          const width = Math.max(.3, clampPercent((Math.max(item.startAtMillis, item.endAtMillis) - item.startAtMillis) / (dayEndMillis - dayStartMillis) * 100))
          return <span key={`day:${item.itemId}`} style={{ ...styles.daySegment, left: `${String(left)}%`, width: `${String(width)}%`, background: colors.accent }} />
        })}
          <span style={{ ...styles.dayViewport, left: `${String(viewportLeft)}%`, width: `${String(viewportWidth)}%` }} aria-hidden><span style={styles.dayViewportGrip} /></span>
          <input type="range" min={0} max={Math.max(0, 86_400_000 - visibleSpanMillis)} step={1_000} value={Math.round(viewStartMillis - dayStartMillis)} disabled={!canPlay} style={styles.dayNavigationInput} aria-label="拖动全天缩略导航" onChange={event => { setViewStartMillis(clampRecordingViewStart(dayStartMillis + Number(event.target.value), visibleSpanMillis, dayStartMillis)) }} />
        </div>
        <div style={styles.dayTrackLabels} aria-hidden><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>
      <div style={styles.zoomControls}>
        <button type="button" style={{ ...styles.zoomButton, opacity: canPlay && visibleSpanMillis < 86_400_000 ? 1 : .3 }} disabled={!canPlay || visibleSpanMillis >= 86_400_000} aria-label="缩小时间轴" title="缩小" onClick={() => { zoomByButton(false) }}><ZoomGlyph direction="out" /></button>
        <button type="button" style={{ ...styles.zoomButton, opacity: canPlay && visibleSpanMillis > 5_000 ? 1 : .3 }} disabled={!canPlay || visibleSpanMillis <= 5_000} aria-label="放大时间轴" title="放大" onClick={() => { zoomByButton(true) }}><ZoomGlyph direction="in" /></button>
        <span style={styles.zoomHint}>滚轮缩放</span>
      </div>
    </div>}
    <div style={{ ...styles.focusTrackShell, marginTop: expanded ? 15 : 28 }}>
      <div
        ref={focusTrackRef}
        style={{ ...styles.focusTrack, cursor: draggingFocus ? 'grabbing' : 'grab' }}
        role="slider"
        tabIndex={canPlay ? 0 : -1}
        aria-disabled={!canPlay}
        aria-label="当前录音片段分布，拖动浏览，点击定位"
        aria-valuemin={0}
        aria-valuemax={86_400}
        aria-valuenow={Math.round((viewStartMillis - dayStartMillis) / 1_000)}
        aria-valuetext={`${compactTimeLabel(viewStartMillis)}–${compactTimeLabel(viewEndMillis)}`}
        onPointerDown={handleFocusPointerDown}
        onPointerMove={handleFocusPointerMove}
        onPointerUp={handleFocusPointerEnd}
        onPointerCancel={handleFocusPointerEnd}
        onKeyDown={handleFocusKeyDown}
      >{items.map(item => {
        const segmentStart = Math.max(viewStartMillis, item.startAtMillis)
        const segmentEnd = Math.min(viewEndMillis, Math.max(item.startAtMillis, item.endAtMillis))
        if (segmentEnd <= segmentStart) return null
        const left = clampPercent((segmentStart - viewStartMillis) / visibleSpanMillis * 100)
        const width = Math.max(.6, clampPercent((segmentEnd - segmentStart) / visibleSpanMillis * 100))
        return <span key={`focus:${item.itemId}`} style={{ ...styles.focusSegment, left: `${String(left)}%`, width: `${String(width)}%`, background: speakerColorAt(item.speakerColorIndex) }} />
      })}</div>
      {playbackVisible && <button type="button" data-arkme-recording-playhead="interactive" style={{ ...styles.focusPlayhead, left: `${String(playbackLeft)}%` }} aria-label={playing ? '暂停当前录音' : '播放当前录音'} title={`${playing ? '暂停' : '播放'} · ${timeLabel(playbackMillis)}`} onPointerDown={event => { event.stopPropagation() }} onClick={event => { event.stopPropagation(); onToggle() }}>
        <span style={styles.focusPlayheadBubble}>{timeLabel(playbackMillis)}<span style={styles.focusPlayheadToggle} aria-hidden>{playing ? 'Ⅱ' : '▶'}</span></span>
        <span style={styles.focusPlayheadLine} /><span style={styles.focusPlayheadDot} />
      </button>}
    </div>
    <div style={styles.focusLabels} aria-hidden>{focusLabels.map((label, index) => <span key={`${label}:${String(index)}`}>{label}</span>)}</div>
    {!expanded && onExpand !== undefined && <button
      type="button"
      data-arkme-recording-overview-expand="client"
      style={styles.overviewExpandToggle}
      aria-label="展开完整时间轴"
      title="展开"
      onClick={onExpand}
    ><RecordingTimelineExpandGlyph /></button>}
    {expanded && <div style={styles.speakerLegend} aria-label="说话人图例">
      {speakerDistributions.slice(0, 4).map(speaker => <span key={speaker.key} style={styles.legendItem}><span style={{ ...styles.legendDot, background: speakerColorAt(speaker.colorIndex) }} />{speaker.label}</span>)}
      {speakerDistributions.length > 4 && <button
        type="button"
        style={styles.legendToggle}
        aria-label={speakerLegendExpanded ? '收起完整说话人分布' : '展开完整说话人分布'}
        aria-expanded={speakerLegendExpanded}
        onClick={() => { setSpeakerLegendExpanded(value => !value) }}
      ><span style={styles.legendMore}>+{speakerDistributions.length - 4}</span><LegendChevronGlyph expanded={speakerLegendExpanded} /></button>}
      {speakerDistributions.length === 0 && <span style={styles.legendItem}>当天暂无可展示的说话人</span>}
      {speakerLegendExpanded && <div style={styles.legendDistribution} aria-label="完整说话人分布" data-arkme-recording-speaker-distribution="expanded">
        {speakerDistributions.map((speaker, index) => <div key={`distribution:${speaker.key}`} style={{ ...styles.legendDistributionRow, ...(index === speakerDistributions.length - 1 ? { borderBottom: 0 } : {}) }}>
          <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: speakerColorAt(speaker.colorIndex) }} />{speaker.label}</span>
          <span style={styles.legendDistributionTrack} aria-label={`${speaker.label}在当前时间范围内的录音分布`}>{speaker.items.map(item => {
            const segmentStart = Math.max(viewStartMillis, item.startAtMillis)
            const segmentEnd = Math.min(viewEndMillis, Math.max(item.startAtMillis, item.endAtMillis))
            if (segmentEnd <= segmentStart) return null
            const left = clampPercent((segmentStart - viewStartMillis) / visibleSpanMillis * 100)
            const width = Math.max(.6, clampPercent((segmentEnd - segmentStart) / visibleSpanMillis * 100))
            return <span key={`distribution:${speaker.key}:${item.itemId}`} style={{ ...styles.legendDistributionSegment, left: `${String(left)}%`, width: `${String(width)}%`, background: speakerColorAt(speaker.colorIndex) }} />
          })}</span>
          <span style={styles.legendDistributionStats}>{speaker.percentage.toFixed(1)}%　·　{speaker.itemCount}条　·　{recordingDistributionDurationLabel(speaker.durationMillis)}</span>
        </div>)}
      </div>}
    </div>}
  </section>
}

function transcriptDemoPosition(index: number, count: number): number {
  if (count <= 1) return 1
  return .8 + index / (count - 1) * (recordingDemoDurationSeconds - 1.6)
}

function transcriptIndexAtDemoPosition(position: number, count: number): number {
  if (count <= 1) return 0
  const ratio = Math.max(0, Math.min(1, (position - .8) / (recordingDemoDurationSeconds - 1.6)))
  return Math.round(ratio * (count - 1))
}

export function groupRecordingTranscriptByHour(items: ArkmeRecordingTranscriptItem[]): Array<{ label: string; items: ArkmeRecordingTranscriptItem[] }> {
  const groups: Array<{ label: string; items: ArkmeRecordingTranscriptItem[] }> = []
  for (const item of items) {
    const hour = new Date(item.startAtMillis).getHours()
    const label = `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`
    const current = groups.at(-1)
    if (current?.label === label) current.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function eventStartMillis(dateStamp: number, event: ArkmeRecordingTimelineEvent): number | undefined {
  const match = /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)/.exec(event.startAt || event.timeRange)
  if (match === null) return undefined
  const date = new Date(dateStamp)
  date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return date.getTime()
}

function eventEndMillis(dateStamp: number, event: ArkmeRecordingTimelineEvent): number | undefined {
  const source = event.endAt || event.timeRange.split(/[-–—~～至]/).at(-1) || ''
  const match = /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)/.exec(source)
  if (match === null) return undefined
  const date = new Date(dateStamp)
  date.setHours(Number(match[1]), Number(match[2]), 59, 999)
  return date.getTime()
}

export interface RecordingTimelineSpeaker {
  label: string
  colorIndex: number
}

export function recordingTimelineEventSpeakers(event: ArkmeRecordingTimelineEvent, items: ArkmeRecordingTranscriptItem[], dateStamp: number): RecordingTimelineSpeaker[] {
  const start = eventStartMillis(dateStamp, event)
  const end = eventEndMillis(dateStamp, event)
  const withinEvent = start === undefined || end === undefined
    ? []
    : items.filter(item => item.startAtMillis <= end && Math.max(item.startAtMillis, item.endAtMillis) >= start)
  const speakers = new Map<string, RecordingTimelineSpeaker>()
  for (const item of withinEvent) {
    if (!speakers.has(item.speakerLabel)) speakers.set(item.speakerLabel, { label: item.speakerLabel, colorIndex: item.speakerColorIndex })
  }
  if (speakers.size > 0) return [...speakers.values()]
  for (const participant of event.participants) {
    const match = /说话人\s*(\d+)/u.exec(participant)
    if (match === null) continue
    const label = `说话人 ${match[1] ?? ''}`.trim()
    if (!speakers.has(label)) speakers.set(label, { label, colorIndex: speakers.size })
  }
  return [...speakers.values()]
}

export function timelineEventPreviewText(value: string): string {
  const paragraph = value.split(/\r?\n+/).map(line => line.trim()).find(Boolean) ?? ''
  if (paragraph.length <= 120) return paragraph
  const sentence = /^.{1,120}?[。！？]/u.exec(paragraph)?.[0]
  return sentence ?? `${paragraph.slice(0, 117).trimEnd()}…`
}

function timelineEventLocationLabel(value: string): string {
  return value.replace(/[（(][^）)]*[）)]/gu, '').trim()
}

export function timelineEventRepresentativeQuotes(event: ArkmeRecordingTimelineEvent, items: ArkmeRecordingTranscriptItem[], dateStamp: number): ArkmeRecordingTranscriptItem[] {
  const start = eventStartMillis(dateStamp, event)
  const end = eventEndMillis(dateStamp, event)
  if (start === undefined || end === undefined) return []
  return items.filter(item => item.text.trim() !== '' && item.startAtMillis <= end && Math.max(item.startAtMillis, item.endAtMillis) >= start).slice(0, 3)
}

export function RecordingTimelineParticipants({ speakers, limit = 3 }: { speakers: RecordingTimelineSpeaker[]; limit?: number }) {
  const visible = speakers.slice(0, limit)
  const hidden = speakers.slice(limit)
  if (speakers.length === 0) return null
  return <div style={styles.eventParticipants} aria-label="参与说话人">
    {visible.map(speaker => <span key={speaker.label} style={styles.eventParticipant}><span aria-hidden style={{ ...styles.eventParticipantDot, background: speakerColorAt(speaker.colorIndex) }} />{speaker.label}</span>)}
    {hidden.length > 0 && <span style={styles.eventParticipantMore} title={hidden.map(speaker => speaker.label).join('、')} aria-label={`还有${String(hidden.length)}位说话人：${hidden.map(speaker => speaker.label).join('、')}`}>+{hidden.length}</span>}
  </div>
}

export function RecordingTimelineEventCard({ event, eventIndex, speakers, onOpen }: {
  event: ArkmeRecordingTimelineEvent
  eventIndex: number
  speakers: RecordingTimelineSpeaker[]
  onOpen(): void
}) {
  const location = timelineEventLocationLabel(event.scene)
  return <button type="button" data-arkme-recording-timeline-card={event.eventId} style={styles.event} aria-label={`查看${event.timeRange || event.title}的时间轴详情`} onClick={onOpen}>
    <span style={styles.eventRail} aria-hidden /><span style={{ ...styles.eventDot, background: speakerColorAt(eventIndex) }} aria-hidden />
    <div style={styles.eventHeadingRow}>
      <header style={styles.eventHeader}><time style={styles.eventTime}>{event.timeRange || '时间未标注'}</time><h3 style={styles.eventTitle}>· {event.title}</h3></header>
      {location !== '' && <span style={styles.eventLocation} title={event.scene}>{location}</span>}
    </div>
    {event.description !== '' && <p style={styles.eventText}>{timelineEventPreviewText(event.description)}</p>}
    <RecordingTimelineParticipants speakers={speakers} />
  </button>
}

export function RecordingTimelineDetailDialog({ event, speakers, quotes, onClose }: {
  event: ArkmeRecordingTimelineEvent
  speakers: RecordingTimelineSpeaker[]
  quotes: ArkmeRecordingTranscriptItem[]
  onClose(): void
}) {
  return <div style={styles.timelineDialogBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={styles.timelineDialog} role="dialog" aria-modal="true" aria-labelledby="arkme-recording-timeline-detail-title">
      <button type="button" autoFocus style={styles.timelineDialogClose} aria-label="关闭时间轴详情" onClick={onClose}>×</button>
      <h2 id="arkme-recording-timeline-detail-title" style={styles.timelineDialogTitle}>{event.timeRange || '时间未标注'} · {event.title}</h2>
      {event.scene !== '' && <p style={styles.timelineDialogLocation}><strong style={{ color: colors.text }}>地点：</strong>{event.scene}</p>}

      {event.description !== '' && <section style={styles.timelineDialogSection} aria-labelledby="arkme-recording-timeline-summary-title">
        <h3 id="arkme-recording-timeline-summary-title" style={styles.timelineDialogSectionTitle}>📝 时段总结</h3>
        <p style={styles.timelineDialogSummary}>{event.description}</p>
      </section>}

      {speakers.length > 0 && <section style={styles.timelineDialogSection} aria-labelledby="arkme-recording-timeline-speakers-title">
        <h3 id="arkme-recording-timeline-speakers-title" style={styles.timelineDialogSectionTitle}>👥 参与人</h3>
        <div style={styles.timelineDialogParticipants}>{speakers.map(speaker => <span key={speaker.label} style={styles.timelineDialogParticipant}><span aria-hidden style={{ ...styles.eventParticipantDot, background: speakerColorAt(speaker.colorIndex) }} />{speaker.label}</span>)}</div>
      </section>}

      {quotes.length > 0 && <section style={styles.timelineDialogSection} aria-labelledby="arkme-recording-timeline-quotes-title">
        <h3 id="arkme-recording-timeline-quotes-title" style={styles.timelineDialogSectionTitle}>💬 代表性原话</h3>
        <ul style={styles.timelineDialogQuoteList}>{quotes.map(quote => <li key={quote.itemId} style={styles.timelineDialogQuote}>
          <span aria-hidden style={{ ...styles.timelineDialogQuoteDot, background: speakerColorAt(quote.speakerColorIndex) }} />
          <span><span style={styles.timelineDialogQuoteSpeaker}>{quote.speakerLabel}：</span>“{quote.text}”</span>
        </li>)}</ul>
      </section>}
    </section>
  </div>
}

function compareDurationLabel(item: ArkmeRecordingTranscriptItem): string {
  const seconds = Math.max(0, Math.round((item.endAtMillis - item.startAtMillis) / 1_000))
  if (seconds < 60) return `${String(seconds)}秒`
  return `${String(Math.floor(seconds / 60))}分${String(seconds % 60)}秒`
}

function compareSectionState(section: ArkmeRecordingSection<ArkmeRecordingTranscriptItem> | undefined): string {
  if (section === undefined || section.state === 'empty') return '尚未生成'
  if (section.state === 'processing') return '转写中'
  if (section.state === 'failed') return '生成失败'
  if (section.state === 'error') return '读取失败'
  return `${String(section.items.length)} 段`
}

export function RecordingTranscriptCompareDialog({ system, doubao, starting, message, onClose }: {
  system: ArkmeRecordingSection<ArkmeRecordingTranscriptItem>
  doubao: ArkmeRecordingSection<ArkmeRecordingTranscriptItem> | undefined
  starting: boolean
  message: string
  onClose(): void
}) {
  const systemRef = useRef<HTMLDivElement>(null)
  const doubaoRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener?.('keydown', closeOnEscape)
    return () => { globalThis.removeEventListener?.('keydown', closeOnEscape) }
  }, [onClose])

  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (syncing.current || target === null) return
    const sourceRange = Math.max(0, source.scrollHeight - source.clientHeight)
    const targetRange = Math.max(0, target.scrollHeight - target.clientHeight)
    if (sourceRange <= 0 || targetRange <= 0) return
    syncing.current = true
    target.scrollTop = (source.scrollTop / sourceRange) * targetRange
    globalThis.requestAnimationFrame?.(() => { syncing.current = false })
  }

  const column = (
    title: string,
    section: ArkmeRecordingSection<ArkmeRecordingTranscriptItem> | undefined,
    ref: { current: HTMLDivElement | null },
    otherRef: { current: HTMLDivElement | null },
    right: boolean,
  ) => <section style={{ ...styles.compareColumn, ...(right ? styles.compareColumnRight : {}) }} aria-label={title}>
    <header style={styles.compareColumnTitle}>
      <span>{title}</span>
      <span style={styles.compareColumnState}>{title === '豆包转写' && starting ? '正在发起…' : compareSectionState(section)}</span>
    </header>
    {section === undefined || section.items.length === 0
      ? <div style={styles.compareEmpty}>{title === '豆包转写'
        ? starting ? '正在接入豆包模型并检查可转写音频…' : message || section?.message || '豆包转写暂无结果'
        : section?.message || '暂无系统转写内容'}</div>
      : <div ref={ref} style={styles.compareList} onScroll={event => { syncScroll(event.currentTarget, otherRef.current) }}>
        {section.items.map(item => {
          const neutral = item.transcriptStatus !== undefined && item.transcriptStatus !== 'ready'
          return <article key={item.itemId} style={styles.compareRow} data-arkme-recording-compare-source={item.transcriptSource}>
            <span aria-hidden style={{ ...styles.compareSpeakerDot, background: neutral ? '#a4a4a4' : speakerColorAt(item.speakerColorIndex) }} />
            <span style={styles.compareSpeaker}>{item.speakerLabel}</span>
            <span style={styles.compareText}>{item.text}</span>
            <time style={styles.compareTime}>{timeLabel(item.startAtMillis)} {compareDurationLabel(item)}</time>
          </article>
        })}
      </div>}
  </section>

  return <div style={styles.compareBackdrop} role="presentation" data-arkme-recording-compare="doubao">
    <section style={styles.compareDialog} role="dialog" aria-modal="true" aria-labelledby="arkme-recording-compare-title">
      <header style={styles.compareHeader}>
        <h2 id="arkme-recording-compare-title" style={styles.compareTitle}>转写对比</h2>
        <button type="button" style={styles.compareClose} aria-label="关闭转写对比" onClick={onClose}>×</button>
      </header>
      <div style={styles.compareColumns}>
        {column('系统转写', system, systemRef, doubaoRef, false)}
        {column('豆包转写', doubao, doubaoRef, systemRef, true)}
      </div>
    </section>
  </div>
}

function SectionState({ section, loading }: { section: ArkmeRecordingSection<unknown> | undefined; loading: boolean }) {
  if (loading) return <div style={styles.status}>正在读取…</div>
  if (section === undefined) return <div style={styles.status}>暂无数据</div>
  const message = section.message || (section.state === 'empty' ? '暂无已生成内容' : '读取失败')
  return section.state === 'error'
    ? <div style={styles.error} role="alert">{message}</div>
    : <div style={styles.status}>{message}</div>
}

function StatusBanner({ section }: { section: ArkmeRecordingSection<ArkmeRecordingVersion> }) {
  if (section.state !== 'processing' && section.state !== 'failed') return null
  return <div style={styles.banner}>{section.message}</div>
}

function SafeMarkdown({ content }: { content: string }) {
  const nodes: ReactNode[] = []
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd()
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    const bullet = /^[-*+]\s+(.+)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (line.trim() === '') nodes.push(<div key={index} style={{ height: 8 }} />)
    else if (heading !== null) nodes.push(<div key={index} style={{ ...styles.markdownHeading, fontSize: Math.max(14, 20 - (heading[1]?.length ?? 1)) }}>{heading[2]}</div>)
    else if (bullet !== null) nodes.push(<div key={index} style={styles.markdownLine}>• {bullet[1]}</div>)
    else if (numbered !== null) nodes.push(<div key={index} style={styles.markdownLine}>{line}</div>)
    else if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) nodes.push(<hr key={index} style={{ border: 0, borderTop: `1px solid ${colors.border}` }} />)
    else nodes.push(<div key={index} style={styles.markdownLine}>{line}</div>)
  }
  return <div style={styles.markdown}>{nodes}</div>
}

function VersionPicker({ versions, selectedId, onChange, onRegenerate }: {
  versions: ArkmeRecordingVersion[]
  selectedId: string
  onChange(id: string): void
  onRegenerate?(): void
}) {
  const selectable = versions.filter(version => version.selectable)
  if (selectable.length === 0) return null
  return <section style={styles.versionBar} aria-label="历史版本">
    <span style={styles.versionSummary}>历史版本：</span>
    <div style={styles.versionControls}><select aria-label="选择历史版本" style={styles.select} value={selectedId} onChange={event => { onChange(event.target.value) }}>
      {selectable.map(version => <option key={version.id} value={version.id}>{versionLabel(version)}</option>)}
    </select><button type="button" style={{ ...styles.regenerate, opacity: onRegenerate === undefined ? .45 : 1, cursor: onRegenerate === undefined ? 'default' : 'pointer' }} disabled={onRegenerate === undefined} onClick={onRegenerate}>重新生成</button></div>
  </section>
}

export function RecordingEmptyActions() {
  const importRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder>()
  const streamRef = useRef<MediaStream>()
  const startingRef = useRef(false)
  const chunksRef = useRef<Blob[]>([])
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewName, setPreviewName] = useState('')

  const replacePreview = (blob: Blob, name: string) => {
    setPreviewUrl(URL.createObjectURL(blob))
    setPreviewName(name)
  }

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    if (previewUrl !== '') URL.revokeObjectURL(previewUrl)
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
  }, [previewUrl])

  const startRecording = async () => {
    if (startingRef.current || recording) return
    if (typeof MediaRecorder === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      setNotice('当前浏览器不支持直接录音，请改用“导入历史音频”。')
      return
    }
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        replacePreview(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }), '刚刚录制的音频')
        for (const track of stream.getTracks()) track.stop()
        streamRef.current = undefined
        setRecording(false)
        setNotice('录音已完成，可在下方试听。第一版暂存在当前页面，不会自动上传。')
      }
      recorder.start()
      setRecording(true)
      setNotice('正在录音，完成后请点击“结束录音”。')
    } catch {
      setNotice('没有获得麦克风权限。允许使用麦克风后，可再次开始录音。')
    } finally {
      startingRef.current = false
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  return <section style={styles.captureArea} aria-label="全天候录音操作">
    <div style={styles.captureToolbar}>
      <button type="button" style={{ ...styles.captureButton, ...styles.capturePrimary }} disabled={recording} onClick={() => { setNotice('请先在 Arkme 移动端完成“Arkme 随身录”绑定，绑定后的内容会同步显示在这里。') }}><CaptureGlyph kind="bind" />绑定 Arkme 随身录</button>
      <button type="button" style={styles.captureButton} disabled={recording} onClick={() => { importRef.current?.click() }}><CaptureGlyph kind="import" />导入历史音频</button>
      <button type="button" style={styles.captureButton} onClick={() => { if (recording) stopRecording(); else void startRecording() }}><CaptureGlyph kind="record" />{recording ? '结束录音' : '手动录音'}</button>
      <input ref={importRef} hidden type="file" accept="audio/*" aria-label="选择历史音频" onChange={event => {
        const file = event.target.files?.[0]
        if (file === undefined) return
        replacePreview(file, file.name)
        setNotice('音频已载入，可在下方试听。第一版暂存在当前页面，不会自动上传。')
        event.target.value = ''
      }} />
    </div>
    {notice !== '' && <p style={styles.captureNotice} role="status">{notice}</p>}
    {previewUrl !== '' && <div><p style={styles.captureNotice}>{previewName}</p><audio controls src={previewUrl} style={styles.localAudio} aria-label="本地音频试听" /></div>}
  </section>
}

function RecordingEmptyState() {
  return <section style={styles.emptyCard} aria-label="当天暂无录音">
    <div aria-hidden style={{ fontSize: 44, opacity: .45 }}>◌</div>
    <h3 style={styles.emptyTitle}>暂无转写内容，快去录音吧！</h3>
    <p style={styles.emptyText}>可从左侧绑定 Arkme 随身录、导入历史音频或使用电脑麦克风录制。</p>
  </section>
}

export function ArkmeRecordingSurface() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingTargetScrollRef = useRef(false)
  const [compact, setCompact] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today)
  const [visibleMonth, setVisibleMonth] = useState(monthStart(today))
  const [activeTab, setActiveTab] = useState<RecordingTab>('transcript')
  const [calendar, setCalendar] = useState<ArkmeRecordingCalendarMonth>()
  const [day, setDay] = useState<ArkmeRecordingDay>()
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(true)
  const [calendarError, setCalendarError] = useState('')
  const [dayError, setDayError] = useState('')
  const [summaryVersionId, setSummaryVersionId] = useState('')
  const [timelineVersionId, setTimelineVersionId] = useState('')
  const [demoAudioUrl, setDemoAudioUrl] = useState('')
  const [demoPosition, setDemoPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [activeTranscriptItemId, setActiveTranscriptItemId] = useState('')
  const [timelineExpanded, setTimelineExpanded] = useState(true)
  const [toolbarNotice, setToolbarNotice] = useState('')
  const [transcriptQuery, setTranscriptQuery] = useState('')
  const [transcriptSearchIndex, setTranscriptSearchIndex] = useState(0)
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState<ArkmeRecordingTimelineEvent>()
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareStarting, setCompareStarting] = useState(false)
  const [comparePolling, setComparePolling] = useState(false)
  const [compareMessage, setCompareMessage] = useState('')
  const comparePollStartedAtRef = useRef(0)
  const compareRequestRef = useRef(0)
  const compareStartInFlightRef = useRef(false)

  useEffect(() => {
    const target = ui.recordingTarget
    if (target === undefined || target.dateStamp <= 0) return
    const targetDate = startOfLocalDay(new Date(target.dateStamp))
    setSelectedDate(targetDate)
    setVisibleMonth(monthStart(targetDate))
    setActiveTab('transcript')
    setTranscriptQuery('')
    setTranscriptSearchIndex(0)
  }, [ui.recordingTarget])

  useEffect(() => {
    const root = rootRef.current
    if (root === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { setCompact((entries[0]?.contentRect.width ?? 980) < 900) })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    let cancelled = false
    const from = monthStart(visibleMonth)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    setCalendar(undefined); setCalendarLoading(true); setCalendarError('')
    void callArkme<ArkmeRecordingCalendarMonth>('recordings.calendar', { fromStamp: from.getTime(), toStamp: to.getTime() })
      .then(value => { if (!cancelled) setCalendar(value) })
      .catch(error => { if (!cancelled) { setCalendar(undefined); setCalendarError(errorMessage(error)) } })
      .finally(() => { if (!cancelled) setCalendarLoading(false) })
    return () => { cancelled = true }
  }, [visibleMonth])

  useEffect(() => {
    let cancelled = false
    compareRequestRef.current += 1
    compareStartInFlightRef.current = false
    setCompareOpen(false); setCompareStarting(false); setComparePolling(false); setCompareMessage('')
    setDay(undefined); setDayLoading(true); setDayError('')
    setSummaryVersionId(''); setTimelineVersionId('')
    void callArkme<ArkmeRecordingDay>('recordings.day', { dateStamp: selectedDate.getTime() })
      .then(value => {
        if (cancelled) return
        setDay(value)
        setSummaryVersionId(value.summary.items.find(version => version.selectable)?.id ?? '')
        setTimelineVersionId(value.timeline.items.find(version => version.selectable)?.id ?? '')
      })
      .catch(error => { if (!cancelled) setDayError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setDayLoading(false) })
    return () => { cancelled = true }
  }, [selectedDate])

  useEffect(() => {
    if (!compareOpen || !comparePolling) return
    let cancelled = false
    const refresh = async () => {
      try {
        const value = await callArkme<ArkmeRecordingDay>('recordings.day', {
          dateStamp: selectedDate.getTime(),
        })
        if (cancelled) return
        setDay(value)
        const state = value.doubaoTranscript?.state
        if (state === 'ready' || state === 'failed' || state === 'error') {
          setComparePolling(false)
        } else if (Date.now() - comparePollStartedAtRef.current > 120_000) {
          setComparePolling(false)
          setCompareMessage('豆包模型仍在后台转写，稍后重新打开即可查看结果')
        }
      } catch (error) {
        if (!cancelled) {
          setComparePolling(false)
          setCompareMessage(errorMessage(error))
        }
      }
    }
    const timer = window.setInterval(() => { void refresh() }, 2_500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [compareOpen, comparePolling, selectedDate])

  useEffect(() => {
    setDemoPosition(0)
    setPlaying(false)
    setActiveTranscriptItemId('')
    setSelectedTimelineEvent(undefined)
    if (day?.transcript.state !== 'ready' || day.transcript.items.length === 0) {
      setDemoAudioUrl('')
      return
    }
    const url = createDemoWavUrl(recordingDemoDurationSeconds)
    setDemoAudioUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [day])

  useEffect(() => {
    if (toolbarNotice === '') return
    const timeout = window.setTimeout(() => { setToolbarNotice('') }, 3_600)
    return () => { window.clearTimeout(timeout) }
  }, [toolbarNotice])

  useEffect(() => {
    if (selectedTimelineEvent === undefined) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedTimelineEvent(undefined) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [selectedTimelineEvent])

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(item => [dateKey(item.dateStamp), item])), [calendar])
  const calendarYears = useMemo(() => Array.from({ length: today.getFullYear() - 1970 + 1 }, (_, index) => today.getFullYear() - index), [today])
  const calendarMonths = useMemo(() => Array.from({ length: visibleMonth.getFullYear() === today.getFullYear() ? today.getMonth() + 1 : 12 }, (_, index) => index + 1), [today, visibleMonth])
  const canGoPreviousMonth = visibleMonth.getFullYear() > 1970 || visibleMonth.getMonth() > 0
  const canGoNextMonth = visibleMonth.getTime() < monthStart(today).getTime()
  const selectedSummary = day?.summary.items.find(version => version.id === summaryVersionId && version.selectable)
  const selectedTimeline = day?.timeline.items.find(version => version.id === timelineVersionId && version.selectable)
  const transcriptItems = useMemo(() => day?.transcript.state === 'ready' ? day.transcript.items : [], [day])
  const transcriptGroups = useMemo(() => groupRecordingTranscriptByHour(transcriptItems), [transcriptItems])
  const transcriptSearchMatches = useMemo(() => recordingTranscriptSearchMatches(transcriptItems, transcriptQuery), [transcriptItems, transcriptQuery])
  const displayedTranscriptSearchIndex = transcriptSearchMatches.length === 0 ? 0 : Math.min(transcriptSearchIndex, transcriptSearchMatches.length - 1)
  const currentTranscriptSearchMatch = transcriptSearchMatches[displayedTranscriptSearchIndex]

  useEffect(() => {
    setTranscriptSearchIndex(current => transcriptSearchMatches.length === 0 ? 0 : Math.min(current, transcriptSearchMatches.length - 1))
  }, [transcriptSearchMatches.length])

  const exportRecording = () => {
    if (transcriptItems.length === 0) {
      setToolbarNotice('当前无内容可导出')
      return
    }
    const exportDate = recordingExportDate(selectedDate)
    const suffix = String(Date.now())
    const files: Array<{ filename: string; content: string; type: string }> = [{
      filename: `转写_${exportDate}_${suffix}.txt`,
      content: recordingTranscriptExport(transcriptItems),
      type: 'text/plain;charset=utf-8',
    }]
    if (selectedSummary?.content.trim()) files.push({
      filename: `总结_${exportDate}_${suffix}.md`,
      content: selectedSummary.content,
      type: 'text/markdown;charset=utf-8',
    })
    if (selectedTimeline !== undefined) {
      const timelineContent = recordingTimelineExport(selectedTimeline)
      if (timelineContent.trim() !== '') files.push({
        filename: `时间轴_${exportDate}_${suffix}.md`,
        content: timelineContent,
        type: 'text/markdown;charset=utf-8',
      })
    }
    for (const file of files) downloadTextFile(file.filename, file.content, file.type)
    setToolbarNotice(`导出成功：已下载${String(files.length)}个文件`)
  }

  useEffect(() => {
    const target = ui.recordingTarget
    if (target === undefined || target.startAtMillis <= 0 || transcriptItems.length === 0 || demoAudioUrl === ''
      || dateKey(target.dateStamp) !== dateKey(selectedDate)) return
    let nearest = transcriptItems[0]
    for (const item of transcriptItems) {
      if (nearest === undefined || Math.abs(item.startAtMillis - target.startAtMillis) < Math.abs(nearest.startAtMillis - target.startAtMillis)) nearest = item
    }
    if (nearest === undefined) return
    const index = transcriptItems.indexOf(nearest)
    const nextPosition = transcriptDemoPosition(index, transcriptItems.length)
    if (audioRef.current !== null) audioRef.current.currentTime = nextPosition
    setDemoPosition(nextPosition)
    setActiveTranscriptItemId(nearest.itemId)
    setActiveTab('transcript')
    pendingTargetScrollRef.current = true
  }, [demoAudioUrl, selectedDate, transcriptItems, ui.recordingTarget])

  useEffect(() => {
    if (!pendingTargetScrollRef.current || activeTab !== 'transcript' || activeTranscriptItemId === '') return
    const target = rootRef.current?.querySelector('[data-arkme-recording-active="true"]')
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'center' })
    pendingTargetScrollRef.current = false
  }, [activeTab, activeTranscriptItemId])

  useEffect(() => {
    if (activeTab !== 'transcript' || currentTranscriptSearchMatch === undefined) return
    const target = rootRef.current?.querySelector('[data-arkme-recording-search-current="true"]')
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'center' })
  }, [activeTab, currentTranscriptSearchMatch])

  const changeTranscriptQuery = (value: string) => {
    setTranscriptQuery(value)
    setTranscriptSearchIndex(0)
  }

  const moveTranscriptSearch = (direction: -1 | 1) => {
    if (transcriptSearchMatches.length === 0) return
    setTranscriptSearchIndex(current => (Math.min(current, transcriptSearchMatches.length - 1) + direction + transcriptSearchMatches.length) % transcriptSearchMatches.length)
  }

  const chooseDate = (value: Date) => {
    const normalized = startOfLocalDay(value)
    setSelectedDate(normalized)
    setTranscriptQuery('')
    setTranscriptSearchIndex(0)
    if (normalized.getFullYear() !== visibleMonth.getFullYear() || normalized.getMonth() !== visibleMonth.getMonth()) {
      setVisibleMonth(monthStart(normalized))
    }
  }

  const seekDemo = (seconds: number) => {
    const next = Math.max(0, Math.min(recordingDemoDurationSeconds, seconds))
    if (audioRef.current !== null) audioRef.current.currentTime = next
    setDemoPosition(next)
    const item = transcriptItems[transcriptIndexAtDemoPosition(next, transcriptItems.length)]
    setActiveTranscriptItemId(item?.itemId ?? '')
  }

  const toggleDemoPlayback = () => {
    const audio = audioRef.current
    if (audio === null) return
    if (audio.paused) void audio.play().catch(() => { setPlaying(false) })
    else audio.pause()
  }

  const playTranscriptItem = (item: ArkmeRecordingTranscriptItem, autoPlay = true) => {
    const index = transcriptItems.findIndex(candidate => candidate.itemId === item.itemId)
    if (index < 0) return
    seekDemo(transcriptDemoPosition(index, transcriptItems.length))
    setActiveTranscriptItemId(item.itemId)
    if (autoPlay) void audioRef.current?.play().catch(() => { setPlaying(false) })
  }

  const playTimelineEvent = (event: ArkmeRecordingTimelineEvent, autoPlay = true) => {
    const target = eventStartMillis(selectedDate.getTime(), event)
    let nearest = transcriptItems[0]
    if (target !== undefined) {
      for (const item of transcriptItems) {
        if (nearest === undefined || Math.abs(item.startAtMillis - target) < Math.abs(nearest.startAtMillis - target)) nearest = item
      }
    }
    if (nearest !== undefined) playTranscriptItem(nearest, autoPlay)
  }

  const openDoubaoCompare = async () => {
    if (compareStartInFlightRef.current) return
    compareStartInFlightRef.current = true
    const requestId = compareRequestRef.current + 1
    compareRequestRef.current = requestId
    const requestedDateStamp = selectedDate.getTime()
    setCompareOpen(true)
    setCompareStarting(true)
    setCompareMessage('正在检查豆包转写…')
    comparePollStartedAtRef.current = Date.now()
    try {
      const result = await callArkme<ArkmeRecordingDoubaoBackfillResult>('recordings.doubao.start', {
        dateStamp: requestedDateStamp,
      })
      if (compareRequestRef.current !== requestId) return
      const shouldPoll = result.queuedChildCount > 0 || result.inFlightChildCount > 0
      setComparePolling(shouldPoll)
      if (result.missingAudioChildCount > 0 && !shouldPoll) {
        setCompareMessage('当天音频已过期，暂时无法生成豆包转写')
      } else if (shouldPoll) {
        setCompareMessage('豆包模型正在转写，完成后会自动显示')
      } else {
        setCompareMessage('')
      }
      const value = await callArkme<ArkmeRecordingDay>('recordings.day', {
        dateStamp: requestedDateStamp,
      })
      if (compareRequestRef.current !== requestId) return
      setDay(value)
      const state = value.doubaoTranscript?.state
      if (state === 'ready' || state === 'failed' || state === 'error') setComparePolling(false)
    } catch (error) {
      if (compareRequestRef.current !== requestId) return
      setComparePolling(false)
      setCompareMessage(errorMessage(error))
    } finally {
      if (compareRequestRef.current === requestId) {
        compareStartInFlightRef.current = false
        setCompareStarting(false)
      }
    }
  }

  const closeDoubaoCompare = () => {
    compareRequestRef.current += 1
    compareStartInFlightRef.current = false
    setCompareOpen(false)
    setCompareStarting(false)
    setComparePolling(false)
  }

  const renderTranscript = () => {
    const section = day?.transcript
    if (dayLoading || section === undefined || section.state !== 'ready') return <SectionState section={section} loading={dayLoading} />
    const currentMatchId = currentTranscriptSearchMatch?.matchId ?? ''
    const searching = transcriptQuery.trim() !== ''
    return <>
      <RecordingTranscriptSearch
        value={transcriptQuery}
        matchCount={transcriptSearchMatches.length}
        activeMatchIndex={displayedTranscriptSearchIndex}
        onChange={changeTranscriptQuery}
        onPrevious={() => { moveTranscriptSearch(-1) }}
        onNext={() => { moveTranscriptSearch(1) }}
        onCompare={() => { void openDoubaoCompare() }}
        onEdit={() => { setToolbarNotice('正在开发中，敬请期待') }}
      />
      {transcriptItems.length === 0
        ? <RecordingEmptyState />
        : <div style={{ padding: 18 }}>{transcriptGroups.map((group, groupIndex) => <section key={group.label} style={{ ...styles.transcriptGroup, ...(groupIndex === 0 ? styles.transcriptGroupFirst : {}) }}>
          <h3 style={styles.transcriptGroupTitle}>{group.label}</h3>
          <ul style={styles.transcriptList}>{group.items.map(item => {
            const playbackActive = !searching && activeTranscriptItemId === item.itemId
            return <li key={item.itemId}><RecordingTranscriptRow
              item={item}
              query={transcriptQuery}
              currentMatchId={currentMatchId}
              playbackActive={playbackActive}
              selected={activeTranscriptItemId === item.itemId}
              playing={playing}
              onPlay={() => { playTranscriptItem(item) }}
            /></li>
          })}</ul>
        </section>)}</div>}
    </>
  }

  const renderSummary = () => {
    const section = day?.summary
    if (dayLoading || section === undefined || selectedSummary === undefined) return <>
      <SectionState section={section} loading={dayLoading} />
    </>
    return <>
      <StatusBanner section={section} />
      <div style={{ padding: 18 }}><SafeMarkdown content={selectedSummary.content} /></div>
    </>
  }

  const renderTimeline = () => {
    const section = day?.timeline
    if (dayLoading || section === undefined || selectedTimeline === undefined) return <>
      <SectionState section={section} loading={dayLoading} />
    </>
    return <>
      <StatusBanner section={section} />
      <div style={styles.eventList}>{selectedTimeline.timelineEvents.map((event, eventIndex) => <RecordingTimelineEventCard
        key={event.eventId}
        event={event}
        eventIndex={eventIndex}
        speakers={recordingTimelineEventSpeakers(event, transcriptItems, selectedDate.getTime())}
        onOpen={() => { playTimelineEvent(event, false); setSelectedTimelineEvent(event) }}
      />)}</div>
    </>
  }

  return <div ref={rootRef} style={{ ...styles.root, overflow: compact ? 'auto' : 'hidden' }}>
    <div style={{
      ...styles.layout,
      height: compact ? 'auto' : '100%',
      gridTemplateColumns: compact ? 'minmax(0,1fr)' : 'minmax(420px,44%) minmax(0,1fr)',
      gridTemplateRows: compact ? 'auto auto' : 'minmax(0,1fr)',
    }}>
      <div style={styles.leftColumn}>
        <aside style={styles.calendar} aria-label="录音日历">
          <div style={styles.monthHeader}>
            <div style={styles.monthNavigation}>
              <button type="button" disabled={!canGoPreviousMonth} style={{ ...styles.iconButton, opacity: canGoPreviousMonth ? 1 : .3 }} aria-label="上个月" onClick={() => { setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1)) }}>‹</button>
              <button type="button" disabled={!canGoNextMonth} style={{ ...styles.iconButton, opacity: canGoNextMonth ? 1 : .3 }} aria-label="下个月" onClick={() => { setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)) }}>›</button>
              <div style={styles.monthTitle} aria-label="选择录音月份">
                <select style={{ ...styles.monthSelect, width: 58 }} aria-label="月份" value={visibleMonth.getMonth() + 1} onChange={event => { setVisibleMonth(new Date(visibleMonth.getFullYear(), Number(event.target.value) - 1, 1)) }}>{calendarMonths.map(month => <option key={month} value={month}>{month}月</option>)}</select>
                <select style={{ ...styles.monthSelect, width: 76 }} aria-label="年份" value={visibleMonth.getFullYear()} onChange={event => {
                  const year = Number(event.target.value)
                  const month = year === today.getFullYear() ? Math.min(visibleMonth.getMonth(), today.getMonth()) : visibleMonth.getMonth()
                  setVisibleMonth(new Date(year, month, 1))
                }}>{calendarYears.map(year => <option key={year} value={year}>{year}</option>)}</select>
              </div>
            </div>
            <button type="button" style={styles.todayButton} onClick={() => { chooseDate(today) }}>↻　回到今日</button>
          </div>
          {calendarError !== '' && <div style={styles.error} role="alert">{calendarError}</div>}
          <div style={styles.week}>{['一', '二', '三', '四', '五', '六', '日'].map(label => <span key={label} style={styles.weekDay}>{label}</span>)}</div>
          <div style={{ ...styles.days, opacity: calendarLoading ? .55 : 1 }}>
            {calendarCells(visibleMonth).map((date, index) => {
              if (date === undefined) return <span key={`blank:${index}`} />
              const meta: ArkmeRecordingCalendarDay | undefined = calendarByDay.get(dateKey(date))
              const selected = dateKey(date) === dateKey(selectedDate)
              const isToday = dateKey(date) === dateKey(today)
              const isPast = date.getTime() < today.getTime()
              const disabled = date.getTime() > today.getTime()
              return <RecordingCalendarCell key={dateKey(date)} date={date} meta={meta} selected={selected} isToday={isToday} isPast={isPast} disabled={disabled} onClick={() => { chooseDate(date) }} />
            })}
          </div>
        </aside>
        <RecordingEmptyActions />
      </div>

      <section style={styles.content} aria-label="录音详情">
        <audio ref={audioRef} src={demoAudioUrl} preload="metadata" onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false); setDemoPosition(0); setActiveTranscriptItemId('') }} onTimeUpdate={event => {
            const next = event.currentTarget.currentTime
            setDemoPosition(next)
            const item = transcriptItems[transcriptIndexAtDemoPosition(next, transcriptItems.length)]
            setActiveTranscriptItemId(item?.itemId ?? '')
          }} />
        {toolbarNotice !== '' && <div style={styles.toolbarNotice} role="status">{toolbarNotice}</div>}
        <RecordingSignalOverview items={transcriptItems} dayStartMillis={selectedDate.getTime()} positionSeconds={demoPosition} playing={playing} canPlay={transcriptItems.length > 0} expanded={timelineExpanded} onToggle={toggleDemoPlayback} onSeek={seekDemo} onExpand={() => { setTimelineExpanded(true) }} />
        <nav style={styles.tabs} aria-label="录音内容">
          <div style={styles.tabList}>{([
            { id: 'timeline', label: '时间轴', icon: 'timeline' },
            { id: 'summary', label: '总结', icon: 'summary' },
            { id: 'transcript', label: '转写', icon: 'transcript' },
          ] as const).map(({ id, label, icon }) => {
            const selected = activeTab === id
            return <button key={id} type="button" data-arkme-recording-tab={id} style={{ ...styles.tab, ...(selected ? styles.tabActive : {}) }} aria-current={selected ? 'page' : undefined} onClick={() => { setActiveTab(id) }}>
              <RecordingTabGlyph kind={icon} />
              <span>{label}</span>
              {selected && <span data-arkme-recording-tab-indicator="active" style={styles.tabActiveIndicator} aria-hidden />}
            </button>
          })}</div>
          <RecordingTabActions
            activeTab={activeTab}
            timelineExpanded={timelineExpanded}
            onSelectMode={() => { setToolbarNotice('转写多选入口已按客户端保留；网页测试版尚未接入批量操作') }}
            onToggleTimeline={() => { setTimelineExpanded(value => !value) }}
            onExport={exportRecording}
          />
        </nav>
        <div style={styles.tabPanel} aria-label="录音标签内容">
          {activeTab === 'timeline' && day?.timeline !== undefined && selectedTimeline !== undefined && <VersionPicker versions={day.timeline.items} selectedId={selectedTimeline.id} onChange={setTimelineVersionId} onRegenerate={() => { setToolbarNotice('重新生成入口已按客户端保留；网页测试版尚未接入生成接口') }} />}
          {activeTab === 'summary' && day?.summary !== undefined && selectedSummary !== undefined && <VersionPicker versions={day.summary.items} selectedId={selectedSummary.id} onChange={setSummaryVersionId} onRegenerate={() => { setToolbarNotice('重新生成入口已按客户端保留；网页测试版尚未接入生成接口') }} />}
          <div style={styles.pane} data-arkme-recording-pane="active">
            {dayError !== '' ? <div style={styles.error} role="alert">{dayError}</div>
              : !dayLoading && day?.transcript.state === 'empty' ? <RecordingEmptyState />
                : activeTab === 'transcript' ? renderTranscript()
                : activeTab === 'summary' ? renderSummary() : renderTimeline()}
          </div>
        </div>
      </section>
    </div>
    {selectedTimelineEvent !== undefined && <RecordingTimelineDetailDialog
      event={selectedTimelineEvent}
      speakers={recordingTimelineEventSpeakers(selectedTimelineEvent, transcriptItems, selectedDate.getTime())}
      quotes={timelineEventRepresentativeQuotes(selectedTimelineEvent, transcriptItems, selectedDate.getTime())}
      onClose={() => { setSelectedTimelineEvent(undefined) }}
    />}
    {compareOpen && day !== undefined && <RecordingTranscriptCompareDialog
      system={day.transcript}
      doubao={day.doubaoTranscript}
      starting={compareStarting}
      message={compareMessage}
      onClose={closeDoubaoCompare}
    />}
  </div>
}
