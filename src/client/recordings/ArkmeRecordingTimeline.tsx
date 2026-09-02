import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { MagnifyingGlassMinus } from '@phosphor-icons/react/dist/icons/MagnifyingGlassMinus'
import { MagnifyingGlassPlus } from '@phosphor-icons/react/dist/icons/MagnifyingGlassPlus'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { arkmeTheme } from '../arkme-theme.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { recordingSpeakerColor } from './recording-speaker-presentation.js'

const desktop = {
  base: arkmeTheme.base, surface: arkmeTheme.layer2, hover: arkmeTheme.hover, border: arkmeTheme.border,
  text: arkmeTheme.text, secondary: arkmeTheme.secondary, tertiary: arkmeTheme.tertiary,
  timelineBlue: arkmeTheme.info,
}

export const RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS = [
  86_400, 43_200, 21_600, 10_800, 7_200, 3_600, 1_800, 900,
  600, 300, 180, 60, 30, 15, 10, 5,
] as const

const DAY_MILLIS = 86_400_000
const DEFAULT_RECORDING_ZOOM_INDEX = 6
const WHEEL_ZOOM_THRESHOLD = 24

function clampWindowStart(value: number, visibleMillis: number, dayStart: number, dayEnd: number): number {
  return Math.min(Math.max(dayStart, dayEnd - visibleMillis), Math.max(dayStart, value))
}

export function recordingTimelineDayBounds(items: readonly Pick<ArkmeRecordingWorkbenchItem, 'startAtMillis'>[]): { start: number; end: number } {
  const first = items[0]?.startAtMillis ?? Date.now()
  const day = new Date(first)
  day.setHours(0, 0, 0, 0)
  return { start: day.getTime(), end: day.getTime() + DAY_MILLIS }
}

export function recordingSegmentLayout(start: number, end: number, windowStart: number, windowEnd: number): {
  leftPercent: number
  widthPercent: number
} {
  const span = Math.max(1, windowEnd - windowStart)
  const clippedStart = Math.min(windowEnd, Math.max(windowStart, start))
  const clippedEnd = Math.min(windowEnd, Math.max(clippedStart, end))
  return {
    leftPercent: (clippedStart - windowStart) / span * 100,
    widthPercent: (clippedEnd - clippedStart) / span * 100,
  }
}

export function recordingTimelineSeekMillis(ratio: number, windowStart: number, windowEnd: number): number {
  const bounded = Math.min(1, Math.max(0, ratio))
  return Math.round(windowStart + (windowEnd - windowStart) * bounded)
}

export function recordingTimelineZoomStart(input: {
  currentStart: number
  currentVisibleMillis: number
  targetVisibleMillis: number
  anchorMillis: number
  anchorRatio: number
  dayStart: number
  dayEnd: number
}): number {
  const ratio = Math.min(1, Math.max(0, input.anchorRatio))
  return clampWindowStart(
    input.anchorMillis - input.targetVisibleMillis * ratio,
    input.targetVisibleMillis,
    input.dayStart,
    input.dayEnd,
  )
}

export function recordingTimelinePanStart(
  currentStart: number,
  deltaPixels: number,
  viewportWidth: number,
  visibleMillis: number,
  dayStart: number,
  dayEnd: number,
): number {
  const deltaMillis = deltaPixels / Math.max(1, viewportWidth) * visibleMillis
  return clampWindowStart(currentStart - deltaMillis, visibleMillis, dayStart, dayEnd)
}

export function recordingTimelineFollowStart(
  playheadMillis: number,
  currentStart: number,
  visibleMillis: number,
  dayStart: number,
  dayEnd: number,
): number {
  const safeStart = currentStart + visibleMillis * .15
  const safeEnd = currentStart + visibleMillis * .85
  if (playheadMillis >= safeStart && playheadMillis <= safeEnd) return currentStart
  return clampWindowStart(playheadMillis - visibleMillis / 2, visibleMillis, dayStart, dayEnd)
}

export function recordingTimelineWheelZoom(accumulatedDelta: number, delta: number, deltaMode = 0): {
  accumulatedDelta: number
  zoomStep: -1 | 0 | 1
} {
  const normalizedDelta = delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1)
  const nextDelta = accumulatedDelta !== 0 && Math.sign(accumulatedDelta) !== Math.sign(normalizedDelta)
    ? normalizedDelta
    : accumulatedDelta + normalizedDelta
  if (Math.abs(nextDelta) < WHEEL_ZOOM_THRESHOLD) return { accumulatedDelta: nextDelta, zoomStep: 0 }
  return { accumulatedDelta: 0, zoomStep: nextDelta > 0 ? -1 : 1 }
}

export function recordingTimelineInitialView(
  items: readonly Pick<ArkmeRecordingWorkbenchItem, 'startAtMillis'>[],
  dayStart: number,
  dayEnd: number,
): { zoomIndex: number; windowStart: number } {
  const first = items[0]
  if (first === undefined) return { zoomIndex: 0, windowStart: dayStart }
  const visibleMillis = RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[DEFAULT_RECORDING_ZOOM_INDEX]! * 1_000
  return {
    zoomIndex: DEFAULT_RECORDING_ZOOM_INDEX,
    windowStart: clampWindowStart(first.startAtMillis - 5 * 60_000, visibleMillis, dayStart, dayEnd),
  }
}

export interface ArkmeVisibleTimelineItem {
  item: ArkmeRecordingWorkbenchItem
  startAtMillis: number
  endAtMillis: number
  aggregatedCount: number
  isMixedSpeakerAggregate: boolean
}

export function recordingTimelineSpeakerIdentity(item: ArkmeRecordingWorkbenchItem): string {
  return item.isBackground ? 'background' : item.speakerKey
}

export function recordingVisibleTimelineItems(
  items: readonly ArkmeRecordingWorkbenchItem[],
  windowStart: number,
  windowEnd: number,
  maxNodes = 480,
): ArkmeVisibleTimelineItem[] {
  const visible = items.filter(item => item.endAtMillis >= windowStart && item.startAtMillis <= windowEnd)
  if (visible.length <= maxNodes) return visible.map(item => ({
    item,
    startAtMillis: item.startAtMillis,
    endAtMillis: item.endAtMillis,
    aggregatedCount: 1,
    isMixedSpeakerAggregate: false,
  }))
  const bucketSize = Math.ceil(visible.length / maxNodes)
  const aggregated: ArkmeVisibleTimelineItem[] = []
  for (let index = 0; index < visible.length; index += bucketSize) {
    const bucket = visible.slice(index, index + bucketSize)
    const first = bucket[0]
    if (first === undefined) continue
    aggregated.push({
      item: first,
      startAtMillis: Math.min(...bucket.map(item => item.startAtMillis)),
      endAtMillis: Math.max(...bucket.map(item => item.endAtMillis)),
      aggregatedCount: bucket.length,
      isMixedSpeakerAggregate: new Set(bucket.map(recordingTimelineSpeakerIdentity)).size > 1,
    })
  }
  return aggregated
}

function durationLabel(seconds: number): string {
  if (seconds >= 3_600) return `${String(seconds / 3_600)}小时`
  if (seconds >= 60) return `${String(seconds / 60)}分钟`
  return `${String(seconds)}秒`
}

function speakerStatsDurationLabel(durationMillis: number): string {
  const seconds = Math.max(0, Math.round(durationMillis / 1_000))
  if (seconds < 60) return `${String(seconds)}秒`
  if (seconds < 3_600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return remainingSeconds > 0 ? `${String(minutes)}分${String(remainingSeconds)}秒` : `${String(minutes)}分钟`
  }
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return minutes > 0 ? `${String(hours)}小时${String(minutes)}分` : `${String(hours)}小时`
}

function timeLabel(value: number, showSeconds = true): string {
  const date = new Date(value)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return showSeconds
    ? `${hours}:${minutes}:${String(date.getSeconds()).padStart(2, '0')}`
    : `${hours}:${minutes}`
}

const TIMELINE_TICK_STEPS_SECONDS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800,
  3_600, 7_200, 10_800, 14_400, 21_600, 43_200, 86_400,
] as const

export function recordingTimelineTickTimes(windowStart: number, windowEnd: number): number[] {
  const visibleSeconds = Math.max(1, (windowEnd - windowStart) / 1_000)
  const targetStep = visibleSeconds / 6
  const stepSeconds = TIMELINE_TICK_STEPS_SECONDS.reduce((closest, candidate) => (
    Math.abs(candidate - targetStep) < Math.abs(closest - targetStep) ? candidate : closest
  ))
  const stepMillis = stepSeconds * 1_000
  const firstTick = Math.ceil(windowStart / stepMillis) * stepMillis
  const ticks: number[] = []
  for (let value = firstTick; value < windowEnd; value += stepMillis) ticks.push(value)
  return ticks
}

const styles: Record<string, CSSProperties> = {
  shell: { height: 146, display: 'grid', gridTemplateRows: '25px minmax(0,1fr) 28px', gap: 6, padding: 16, boxSizing: 'border-box', border: `1px solid ${desktop.border}`, borderRadius: 10, background: desktop.base },
  overviewRow: { minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'start', gap: 16 },
  overviewColumn: { minWidth: 0, height: 25, position: 'relative' },
  overview: { position: 'relative', overflow: 'hidden', height: 10, marginTop: 4, touchAction: 'none', borderRadius: 10, background: desktop.surface, cursor: 'pointer' },
  overviewSegment: { position: 'absolute', top: 2, height: 6, minWidth: 2, borderRadius: 3 },
  overviewWindow: { position: 'absolute', zIndex: 3, top: -.5, bottom: -.5, minWidth: 2, boxSizing: 'border-box', border: `1px solid ${desktop.timelineBlue}`, borderRadius: 10, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #3964fe) 20%, transparent)', pointerEvents: 'none' },
  overviewLabels: { position: 'absolute', top: 18, left: 0, right: 0, height: 11, color: desktop.tertiary, fontSize: 10, lineHeight: '11px', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' },
  overviewLabel: { position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' },
  zoomControls: { height: 20, display: 'flex', alignItems: 'center', gap: 10, color: desktop.text },
  zoomButton: { width: 16, height: 16, padding: 0, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  zoomHint: { marginLeft: -2, color: desktop.tertiary, fontSize: 10, lineHeight: '20px', whiteSpace: 'nowrap' },
  followButton: { height: 20, padding: '0 6px', border: 0, borderRadius: 4, background: desktop.hover, color: desktop.secondary, cursor: 'pointer', fontSize: 10 },
  track: { minWidth: 0, minHeight: 0, position: 'relative', paddingTop: 12, touchAction: 'none', userSelect: 'none' },
  detailRail: { position: 'relative', overflow: 'hidden', height: 18, boxSizing: 'border-box', border: `1px solid ${desktop.border}`, borderRadius: 10, background: desktop.surface, cursor: 'grab' },
  segment: { position: 'absolute', top: 1, bottom: 1, minWidth: 2, padding: 0, border: 0, borderRadius: 0, cursor: 'pointer', opacity: .96 },
  tickLabels: { position: 'relative', height: 16, display: 'block', color: desktop.tertiary, fontSize: 10, lineHeight: '16px', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' },
  tickLabel: { position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' },
  playhead: { position: 'absolute', zIndex: 4, top: 0, bottom: 0, width: 2, transform: 'translateX(-1px)', background: desktop.timelineBlue, pointerEvents: 'none' },
  playheadCap: { position: 'absolute', top: -1, left: -4, width: 10, height: 5, borderRadius: '0 0 10px 10px', background: desktop.timelineBlue },
  playControl: { position: 'absolute', zIndex: 6, top: -20, width: 24, height: 20, transform: 'translateX(-50%)', padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: desktop.text, color: desktop.base, cursor: 'pointer' },
  legend: { minWidth: 0, position: 'relative', margin: 0, color: desktop.secondary, fontSize: 12 },
  legendBackdrop: { position: 'fixed', zIndex: 11, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  legendSummary: { height: 28, boxSizing: 'border-box', padding: '4px 6px', display: 'flex', alignItems: 'center', cursor: 'pointer', listStyle: 'none', border: `1px solid ${desktop.border}`, borderRadius: 6, background: desktop.base },
  legendItems: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' },
  legendItem: { width: 96, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px', boxSizing: 'border-box', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' },
  legendName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: desktop.text, fontWeight: 500 },
  legendDot: { width: 12, height: 12, flex: 'none', borderRadius: '50%' },
  moreChip: { flex: 'none', marginRight: 2, padding: '0 6px', borderRadius: 10, background: desktop.hover, color: desktop.tertiary, fontSize: 11, lineHeight: '16px', fontWeight: 500 },
  legendPanel: { position: 'absolute', zIndex: 12, top: 31, left: 0, right: 0, maxHeight: 420, overflowY: 'auto', border: `1px solid ${desktop.border}`, borderRadius: 12, background: desktop.base, boxShadow: arkmeTheme.shadow },
  legendPanelList: { padding: '8px 0', display: 'grid' },
  legendPanelItem: { minWidth: 0, padding: '8px 12px' },
  legendPanelPrimary: { minWidth: 0, display: 'grid', gridTemplateColumns: '80px minmax(80px,1fr) 40px', alignItems: 'center' },
  legendPanelMeta: { display: 'flex', alignItems: 'center', marginTop: 5 },
  legendPanelIdentity: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  legendPanelTimeline: { position: 'relative', height: 6, margin: '0 6px 0 10px', overflow: 'hidden', borderRadius: 11, background: desktop.surface },
  legendPanelTimelineSegment: { position: 'absolute', top: 0, bottom: 0, minWidth: 2, borderRadius: 3 },
  legendMetric: { color: desktop.tertiary, fontSize: 10, lineHeight: '15px', letterSpacing: '.117px', textAlign: 'center', whiteSpace: 'nowrap' },
  defaultControl: { height: 28, display: 'flex', alignItems: 'center', color: desktop.text, fontSize: 12, lineHeight: '16px' },
  defaultLegend: { display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 },
  defaultIndicator: { width: 16, height: 16, flex: 'none', borderRadius: 4 },
  emptyControl: { height: 28, display: 'flex', alignItems: 'center', color: desktop.secondary, fontSize: 12, fontWeight: 500, lineHeight: '16px', letterSpacing: '.24px' },
  emptyIndicator: { width: 16, height: 16, flex: 'none', marginRight: 6, borderRadius: 4, background: desktop.hover },
  importButton: { height: 20, marginLeft: 6, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 2, border: 0, background: 'transparent', color: desktop.timelineBlue, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 500, lineHeight: '16px', letterSpacing: '.24px' },
  loadingControl: { width: 200, height: 16, alignSelf: 'center', borderRadius: 8, background: desktop.hover },
}

export function ArkmeRecordingTimeline({ items, dayStartMillis, playheadMillis, isPlaying, loading = false, emptyState, onEditSpeaker, onImportAudio, onSelectAtMillis, onTogglePlayback }: {
  items: ArkmeRecordingWorkbenchItem[]
  dayStartMillis?: number
  playheadMillis?: number
  isPlaying: boolean
  loading?: boolean
  emptyState?: boolean
  onEditSpeaker?(item: ArkmeRecordingWorkbenchItem, anchor: { left: number; right: number; top: number; bottom: number }): void
  onImportAudio?(): void
  onSelectAtMillis(value: number): void
  onTogglePlayback(): void
}) {
  const hasRecording = items.length > 0
  const showEmptyState = !loading && (emptyState ?? !hasRecording)
  const derivedBounds = useMemo(() => recordingTimelineDayBounds(items), [items])
  const bounds = useMemo(() => ({
    start: dayStartMillis ?? derivedBounds.start,
    end: (dayStartMillis ?? derivedBounds.start) + DAY_MILLIS,
  }), [dayStartMillis, derivedBounds.start])
  const initialView = recordingTimelineInitialView(items, bounds.start, bounds.end)
  const [zoomIndex, setZoomIndex] = useState(initialView.zoomIndex)
  const visibleMillis = RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[zoomIndex]! * 1_000
  const [windowStart, setWindowStart] = useState(initialView.windowStart)
  const [followPlayback, setFollowPlayback] = useState(true)
  const dragRef = useRef<{ x: number; start: number; moved: boolean }>()
  const overviewDragRef = useRef(false)
  const wheelDeltaRef = useRef(0)
  const legendRef = useRef<HTMLDetailsElement>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const firstItemStart = items[0]?.startAtMillis

  useEffect(() => {
    const next = recordingTimelineInitialView(items, bounds.start, bounds.end)
    setZoomIndex(next.zoomIndex)
    setWindowStart(next.windowStart)
    setFollowPlayback(true)
  }, [bounds.end, bounds.start, firstItemStart])

  useEffect(() => {
    if (!followPlayback || playheadMillis === undefined) return
    setWindowStart(current => recordingTimelineFollowStart(playheadMillis, current, visibleMillis, bounds.start, bounds.end))
  }, [bounds.end, bounds.start, followPlayback, playheadMillis, visibleMillis])

  const windowEnd = Math.min(bounds.end, windowStart + visibleMillis)
  const visibleItems = useMemo(
    () => recordingVisibleTimelineItems(items, windowStart, windowEnd),
    [items, windowEnd, windowStart],
  )
  const overviewItems = useMemo(
    () => recordingVisibleTimelineItems(items, bounds.start, bounds.end),
    [bounds.end, bounds.start, items],
  )
  const allDaySpeakers = useMemo(() => {
    const speakers = new Map<string, { key: string; label: string; colorIndex: number; avatarRef?: string; durationMillis: number; items: ArkmeRecordingWorkbenchItem[]; mergedSegments: Array<{ startAtMillis: number; endAtMillis: number }> }>()
    for (const item of items) {
      if (item.isBackground) continue
      const key = recordingTimelineSpeakerIdentity(item)
      const current = speakers.get(key) ?? {
        key,
        label: item.speakerLabel,
        colorIndex: item.speakerColorIndex,
        ...(item.speakerAvatarRef === undefined ? {} : { avatarRef: item.speakerAvatarRef }),
        durationMillis: 0,
        items: [],
        mergedSegments: [],
      }
      current.items.push(item)
      speakers.set(key, current)
    }
    for (const speaker of speakers.values()) {
      const ordered = speaker.items.toSorted((left, right) => left.startAtMillis - right.startAtMillis)
      for (const item of ordered) {
        const last = speaker.mergedSegments.at(-1)
        if (last !== undefined && item.startAtMillis - last.endAtMillis <= 2_000) {
          last.endAtMillis = Math.max(last.endAtMillis, item.endAtMillis)
        } else {
          speaker.mergedSegments.push({ startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis })
        }
      }
      speaker.durationMillis = speaker.mergedSegments.reduce((sum, segment) => sum + Math.max(0, segment.endAtMillis - segment.startAtMillis), 0)
    }
    return [...speakers.values()].sort((left, right) => right.durationMillis - left.durationMillis)
  }, [items])
  const visibleSpeakers = useMemo(() => allDaySpeakers.filter(speaker => speaker.items.some(item => (
    item.endAtMillis > windowStart && item.startAtMillis < windowEnd
  ))), [allDaySpeakers, windowEnd, windowStart])
  const totalSpeakerDurationMillis = allDaySpeakers.reduce((sum, speaker) => sum + speaker.durationMillis, 0)

  useEffect(() => {
    if (zoomIndex === 0 || visibleSpeakers.length === 0) setLegendOpen(false)
  }, [visibleSpeakers.length, zoomIndex])

  const zoomTo = (targetIndex: number, anchorRatio = .5, anchorMillis?: number) => {
    const nextIndex = Math.min(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS.length - 1, Math.max(0, targetIndex))
    const targetVisibleMillis = RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[nextIndex]! * 1_000
    const effectiveAnchor = anchorMillis ?? playheadMillis ?? windowStart + visibleMillis * anchorRatio
    setWindowStart(recordingTimelineZoomStart({
      currentStart: windowStart,
      currentVisibleMillis: visibleMillis,
      targetVisibleMillis,
      anchorMillis: effectiveAnchor,
      anchorRatio,
      dayStart: bounds.start,
      dayEnd: bounds.end,
    }))
    setZoomIndex(nextIndex)
  }

  const seekFromPointer = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    const seekAtMillis = recordingTimelineSeekMillis((clientX - rect.left) / Math.max(1, rect.width), windowStart, windowEnd)
    onSelectAtMillis(seekAtMillis)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasRecording || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, start: windowStart, moved: false }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === undefined) return
    const rect = event.currentTarget.getBoundingClientRect()
    const delta = event.clientX - drag.x
    if (Math.abs(delta) >= 3) drag.moved = true
    if (!drag.moved) return
    setFollowPlayback(false)
    setWindowStart(recordingTimelinePanStart(drag.start, delta, rect.width, visibleMillis, bounds.start, bounds.end))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = undefined
    if (drag !== undefined && !drag.moved) seekFromPointer(event.clientX, event.currentTarget)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!hasRecording) return
    event.preventDefault()
    const wheel = recordingTimelineWheelZoom(wheelDeltaRef.current, event.deltaY, event.deltaMode)
    wheelDeltaRef.current = wheel.accumulatedDelta
    if (wheel.zoomStep === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
    const anchorMillis = windowStart + visibleMillis * ratio
    zoomTo(zoomIndex + wheel.zoomStep, ratio, anchorMillis)
  }

  const playheadVisible = playheadMillis !== undefined && playheadMillis >= windowStart && playheadMillis <= windowEnd
  const canPlayAtSelection = playheadMillis !== undefined && items.some(item => (
    playheadMillis >= item.startAtMillis && playheadMillis < item.endAtMillis
  ))
  const playheadPercent = playheadVisible ? (playheadMillis - windowStart) / Math.max(1, windowEnd - windowStart) * 100 : 0
  const overviewWindowLeft = (windowStart - bounds.start) / DAY_MILLIS * 100
  const overviewWindowWidth = Math.min(100, visibleMillis / DAY_MILLIS * 100)
  const detailTicks = recordingTimelineTickTimes(windowStart, windowEnd)
  const showTickSeconds = visibleMillis <= 60_000
  const navigateOverview = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    const target = recordingTimelineSeekMillis((clientX - rect.left) / Math.max(1, rect.width), bounds.start, bounds.end)
    setFollowPlayback(false)
    setWindowStart(clampWindowStart(target - visibleMillis / 2, visibleMillis, bounds.start, bounds.end))
  }
  const editSpeaker = (event: { preventDefault(): void; stopPropagation(): void; currentTarget: HTMLElement }, item: ArkmeRecordingWorkbenchItem) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    onEditSpeaker?.(item, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
  }

  return <div style={styles.shell} aria-label="真实录音时间轴">
    <div style={styles.overviewRow} data-timeline-layer="overview">
      <div style={styles.overviewColumn} aria-label="24 小时概览">
        <div
          style={{ ...styles.overview, ...(!hasRecording ? { cursor: 'default' } : {}) }}
          role="scrollbar"
          aria-label="24 小时缩略导航"
          aria-valuemin={bounds.start}
          aria-valuemax={bounds.end}
          aria-valuenow={windowStart}
          onPointerDown={event => {
            if (!hasRecording || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            overviewDragRef.current = true
            navigateOverview(event.clientX, event.currentTarget)
          }}
          onPointerMove={event => { if (overviewDragRef.current) navigateOverview(event.clientX, event.currentTarget) }}
          onPointerUp={() => { overviewDragRef.current = false }}
          onPointerCancel={() => { overviewDragRef.current = false }}
        >
          {overviewItems.map(item => {
            const layout = recordingSegmentLayout(item.startAtMillis, item.endAtMillis, bounds.start, bounds.end)
            return <span key={`overview:${item.item.itemId}:${String(item.startAtMillis)}`} aria-hidden style={{
              ...styles.overviewSegment,
              left: `${String(layout.leftPercent)}%`,
              width: `${String(layout.widthPercent)}%`,
              background: desktop.timelineBlue,
            }} />
          })}
          <span aria-hidden style={{ ...styles.overviewWindow, left: `${String(overviewWindowLeft)}%`, width: `${String(overviewWindowWidth)}%` }} />
        </div>
        <span style={styles.overviewLabels} aria-hidden>
          {['00:00', '06:00', '12:00', '18:00', '24:00'].map((label, index) => <span key={label} style={{
            ...styles.overviewLabel,
            left: `${String(index * 25)}%`,
            ...(index === 0 ? { transform: 'none' } : index === 4 ? { transform: 'translateX(-100%)' } : {}),
          }}>{label}</span>)}
        </span>
      </div>
      <span style={styles.zoomControls}>
        {!followPlayback && <button type="button" style={styles.followButton} onClick={() => { setFollowPlayback(true) }}>跟随播放</button>}
        <button type="button" style={{ ...styles.zoomButton, ...(!hasRecording || zoomIndex === 0 ? { opacity: .3, cursor: 'default' } : {}) }} aria-label="缩小" title={hasRecording ? '缩小' : undefined} disabled={!hasRecording || zoomIndex === 0} onClick={() => { zoomTo(zoomIndex - 1) }}><MagnifyingGlassMinus size={16} aria-hidden /></button>
        <button type="button" style={{ ...styles.zoomButton, ...(!hasRecording || zoomIndex === RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS.length - 1 ? { opacity: .3, cursor: 'default' } : {}) }} aria-label="放大" title={hasRecording ? '放大' : undefined} disabled={!hasRecording || zoomIndex === RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS.length - 1} onClick={() => { zoomTo(zoomIndex + 1) }}><MagnifyingGlassPlus size={16} aria-hidden /></button>
        <span style={{ ...styles.zoomHint, ...(!hasRecording ? { opacity: .3 } : {}) }}>滚轮缩放</span>
      </span>
    </div>

    <div style={styles.track} data-timeline-layer="detail">
      {playheadVisible && <button type="button" disabled={!canPlayAtSelection} style={{ ...styles.playControl, ...(!canPlayAtSelection ? { opacity: .5, cursor: 'default' } : {}), left: `${String(playheadPercent)}%` }} onClick={onTogglePlayback} aria-label={isPlaying ? '暂停录音' : '播放录音'} title={`${timeLabel(playheadMillis)} · ${isPlaying ? '暂停' : '播放'}`}>{isPlaying ? <Pause size={11} weight="fill" aria-hidden /> : <Play size={11} weight="fill" aria-hidden />}</button>}
      <div
        style={{ ...styles.detailRail, ...(!hasRecording ? { cursor: 'default' } : {}) }}
        tabIndex={hasRecording ? 0 : -1}
        role="slider"
        aria-disabled={!hasRecording}
        aria-label="详细时间轴，可拖拽平移，滚轮缩放"
        aria-valuemin={bounds.start}
        aria-valuemax={bounds.end}
        aria-valuenow={playheadMillis ?? windowStart}
        aria-valuetext={durationLabel(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[zoomIndex]!)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = undefined }}
        onWheel={handleWheel}
        onKeyDown={event => {
          if (!hasRecording) return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setFollowPlayback(false)
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            setWindowStart(current => clampWindowStart(current + direction * visibleMillis * .1, visibleMillis, bounds.start, bounds.end))
          } else if (event.key === '+' || event.key === '=') {
            event.preventDefault(); zoomTo(zoomIndex + 1)
          } else if (event.key === '-') {
            event.preventDefault(); zoomTo(zoomIndex - 1)
          } else if (event.key === ' ') {
            event.preventDefault()
            if (canPlayAtSelection) onTogglePlayback()
          }
        }}
      >
        {visibleItems.map(item => {
          const layout = recordingSegmentLayout(item.startAtMillis, item.endAtMillis, windowStart, windowEnd)
          return <button
            key={`${item.item.itemId}:${String(item.startAtMillis)}`}
            type="button"
            style={{
              ...styles.segment,
              left: `${String(layout.leftPercent)}%`,
              width: `${String(layout.widthPercent)}%`,
              background: item.isMixedSpeakerAggregate
                ? desktop.secondary
                : item.item.isBackground ? desktop.tertiary : recordingSpeakerColor(item.item.speakerColorIndex),
            }}
            aria-label={item.isMixedSpeakerAggregate
              ? `多个说话人，选择聚合的 ${String(item.aggregatedCount)} 个片段中的第一段`
              : `${item.item.speakerLabel}，选择该片段${item.aggregatedCount > 1 ? `，聚合 ${String(item.aggregatedCount)} 个片段` : ''}`}
            title={item.isMixedSpeakerAggregate
              ? `多个说话人 · 聚合 ${String(item.aggregatedCount)} 个片段`
              : `${item.item.speakerLabel} · ${item.item.text.slice(0, 80)}`}
            onPointerDown={event => { event.stopPropagation() }}
            onClick={event => { event.stopPropagation(); onSelectAtMillis(item.item.startAtMillis) }}
          />
        })}
        {playheadVisible && <span style={{ ...styles.playhead, left: `${String(playheadPercent)}%` }} aria-hidden><span style={styles.playheadCap} /></span>}
      </div>
      <span style={styles.tickLabels} data-timeline-ticks="detail" aria-hidden>
        {detailTicks.map(tick => <span key={tick} style={{
          ...styles.tickLabel,
          left: `${String((tick - windowStart) / Math.max(1, windowEnd - windowStart) * 100)}%`,
        }}>{timeLabel(tick, showTickSeconds)}</span>)}
      </span>
    </div>

    {loading ? <span style={styles.loadingControl} data-timeline-layer="loading" aria-label="正在读取录音" /> : showEmptyState ? <span style={styles.emptyControl} data-timeline-layer="empty">
      <span style={styles.emptyIndicator} aria-hidden />
      <span>无录音</span>
      <button type="button" style={{ ...styles.importButton, ...(onImportAudio === undefined ? { cursor: 'default', opacity: .3 } : {}) }} disabled={onImportAudio === undefined} onClick={onImportAudio}>导入音频<CaretRight size={8} aria-hidden /></button>
    </span> : zoomIndex > 0 && visibleSpeakers.length > 0 ? <>
      {legendOpen && <button type="button" tabIndex={-1} aria-label="关闭当前窗口说话人统计" style={styles.legendBackdrop} onClick={() => { if (legendRef.current !== null) legendRef.current.open = false; setLegendOpen(false) }} />}
      <details ref={legendRef} open={legendOpen} style={styles.legend} data-timeline-layer="speakers" onToggle={event => { setLegendOpen(event.currentTarget.open) }}>
      <summary style={styles.legendSummary} aria-label="当前窗口说话人图例">
        <span style={styles.legendItems}>
          {visibleSpeakers.slice(0, 3).map(speaker => <button type="button" key={speaker.key} aria-label={`编辑说话人 ${speaker.label}`} style={styles.legendItem} onClick={event => { editSpeaker(event, speaker.items[0]!) }}>
            {speaker.avatarRef === undefined
              ? <span aria-hidden style={{ ...styles.legendDot, background: recordingSpeakerColor(speaker.colorIndex) }} />
              : <ArkmeUserAvatar avatarRef={speaker.avatarRef} size={12} label={`${speaker.label}头像`} />}
            <span style={{ ...styles.legendName, ...(speaker.avatarRef === undefined ? {} : { color: recordingSpeakerColor(speaker.colorIndex) }) }}>{speaker.label}</span>
          </button>)}
        </span>
        {visibleSpeakers.length > 3 && <span style={styles.moreChip}>+{visibleSpeakers.length - 3}</span>}
        <CaretDown size={16} aria-hidden />
      </summary>
      <span style={styles.legendPanel}>
        <span style={styles.legendPanelList}>
          {visibleSpeakers.map(speaker => {
            const percentage = totalSpeakerDurationMillis <= 0 ? 0 : speaker.durationMillis / totalSpeakerDurationMillis * 100
            return <span key={speaker.key} style={styles.legendPanelItem}>
              <span style={styles.legendPanelPrimary}>
              <span style={styles.legendPanelIdentity}>
                {speaker.avatarRef === undefined
                  ? <span aria-hidden style={{ ...styles.legendDot, background: recordingSpeakerColor(speaker.colorIndex) }} />
                  : <ArkmeUserAvatar avatarRef={speaker.avatarRef} size={12} label={`${speaker.label}头像`} />}
                <span style={styles.legendName}>{speaker.label}</span>
              </span>
              <span style={styles.legendPanelTimeline} aria-hidden>
                {speaker.mergedSegments.map(segment => {
                  const layout = recordingSegmentLayout(segment.startAtMillis, segment.endAtMillis, bounds.start, bounds.end)
                  return <span key={`${String(segment.startAtMillis)}:${String(segment.endAtMillis)}`} style={{ ...styles.legendPanelTimelineSegment, left: `${String(layout.leftPercent)}%`, width: `${String(layout.widthPercent)}%`, background: recordingSpeakerColor(speaker.colorIndex) }} />
                })}
              </span>
              <span style={styles.legendMetric}>{percentage.toFixed(1)}%</span>
              </span>
              <span style={styles.legendPanelMeta}>
                <span style={styles.legendMetric}>占比 {percentage.toFixed(1)}%</span>
                <span style={{ ...styles.legendMetric, margin: '0 8px' }}>•</span>
                <span style={styles.legendMetric}>{speaker.mergedSegments.length}个片段</span>
                <span style={{ ...styles.legendMetric, margin: '0 8px' }}>•</span>
                <span style={styles.legendMetric}>总时长: {speakerStatsDurationLabel(speaker.durationMillis)}</span>
              </span>
            </span>
          })}
        </span>
      </span>
    </details></> : hasRecording ? <span style={styles.defaultControl} data-timeline-layer="speakers">
      <span style={styles.defaultLegend}><span aria-hidden style={{ ...styles.defaultIndicator, border: `1px solid ${desktop.border}`, background: desktop.base }} />有录音无人声</span>
      <span style={styles.defaultLegend}><span aria-hidden style={{ ...styles.defaultIndicator, background: desktop.timelineBlue }} />有人声</span>
    </span> : <span data-timeline-layer="speakers" aria-hidden />}
  </div>
}
