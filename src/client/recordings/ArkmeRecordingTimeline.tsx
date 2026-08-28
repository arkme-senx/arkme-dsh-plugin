import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { arkmeTheme } from '../arkme-theme.js'
import { recordingSpeakerColor } from './recording-speaker-presentation.js'

export const RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS = [
  86_400, 43_200, 21_600, 10_800, 7_200, 3_600, 1_800, 900,
  600, 300, 180, 60, 30, 15, 10, 5,
] as const

const DAY_MILLIS = 86_400_000
const DEFAULT_RECORDING_ZOOM_INDEX = 6

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
    widthPercent: Math.max(.35, (clippedEnd - clippedStart) / span * 100),
  }
}

export function recordingTimelineSeekMillis(ratio: number, windowStart: number, windowEnd: number): number {
  const bounded = Math.min(1, Math.max(0, ratio))
  return Math.round(windowStart + (windowEnd - windowStart) * bounded)
}

export function recordingTimelineItemAt(
  items: readonly ArkmeRecordingWorkbenchItem[],
  targetMillis: number,
): ArkmeRecordingWorkbenchItem | undefined {
  return items.find(item => item.startAtMillis <= targetMillis && targetMillis <= item.endAtMillis)
    ?? items.reduce<ArkmeRecordingWorkbenchItem | undefined>((closest, item) => {
      if (closest === undefined) return item
      return Math.abs(item.startAtMillis - targetMillis) < Math.abs(closest.startAtMillis - targetMillis) ? item : closest
    }, undefined)
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

function recordingTimelineSpeakerIdentity(item: ArkmeRecordingWorkbenchItem): string {
  return item.isBackground ? 'background' : `${item.speakerLabel}:${String(item.speakerColorIndex)}`
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

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value)
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'grid', gridTemplateRows: '28px 10px 52px', gap: 7 },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  controls: { display: 'flex', alignItems: 'center', gap: 4 },
  legend: { position: 'relative', fontSize: 10, color: arkmeTheme.secondary },
  legendSummary: { display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', listStyle: 'none' },
  legendPanel: { position: 'absolute', zIndex: 8, top: 22, left: 0, minWidth: 180, padding: 8, display: 'grid', gap: 6, border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.elevated, boxShadow: '0 8px 24px rgba(0,0,0,.12)' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
  legendDot: { width: 9, height: 9, flex: 'none', borderRadius: 3 },
  button: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 7, background: arkmeTheme.layer1, color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 11, padding: '3px 8px' },
  track: { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none', borderRadius: 9, background: arkmeTheme.layer2, cursor: 'grab' },
  overview: { position: 'relative', overflow: 'hidden', height: 10, touchAction: 'none', borderRadius: 5, background: arkmeTheme.layer2, cursor: 'pointer' },
  overviewSegment: { position: 'absolute', top: 2, height: 6, minWidth: 1, borderRadius: 2, opacity: .72 },
  overviewWindow: { position: 'absolute', zIndex: 3, top: 0, bottom: 0, minWidth: 2, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.primaryAction}`, borderRadius: 5, background: 'rgba(23,25,28,.08)', pointerEvents: 'none' },
  canvas: { position: 'relative', width: '100%', height: 52 },
  base: { position: 'absolute', left: 8, right: 8, top: 24, height: 2, background: arkmeTheme.border },
  segment: { position: 'absolute', top: 13, height: 23, minWidth: 5, border: 0, borderRadius: 6, cursor: 'pointer', opacity: .92 },
  playhead: { position: 'absolute', zIndex: 4, top: 5, bottom: 4, width: 2, transform: 'translateX(-1px)', background: arkmeTheme.primaryAction, pointerEvents: 'none' },
  playheadDot: { position: 'absolute', top: -2, left: -3, width: 8, height: 8, borderRadius: '50%', background: arkmeTheme.primaryAction },
  edgeTime: { position: 'absolute', bottom: 2, color: arkmeTheme.tertiary, fontSize: 8, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' },
}

export function ArkmeRecordingTimeline({ items, dayStartMillis, playheadMillis, isPlaying, onActivate, onTogglePlayback }: {
  items: ArkmeRecordingWorkbenchItem[]
  dayStartMillis?: number
  playheadMillis?: number
  isPlaying: boolean
  onActivate(item: ArkmeRecordingWorkbenchItem, seekAtMillis?: number): void
  onTogglePlayback(): void
}) {
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
  const visibleSpeakers = useMemo(() => {
    const speakers = new Map<string, { label: string; colorIndex: number; durationMillis: number }>()
    for (const item of items) {
      if (item.isBackground || item.endAtMillis < windowStart || item.startAtMillis > windowEnd) continue
      const key = `${item.speakerLabel}:${String(item.speakerColorIndex)}`
      const current = speakers.get(key) ?? { label: item.speakerLabel, colorIndex: item.speakerColorIndex, durationMillis: 0 }
      current.durationMillis += Math.max(0, Math.min(windowEnd, item.endAtMillis) - Math.max(windowStart, item.startAtMillis))
      speakers.set(key, current)
    }
    return [...speakers.values()].sort((left, right) => right.durationMillis - left.durationMillis)
  }, [items, windowEnd, windowStart])

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
    const item = recordingTimelineItemAt(items, seekAtMillis)
    if (item !== undefined) onActivate(item, seekAtMillis)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
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
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
    const anchorMillis = windowStart + visibleMillis * ratio
    zoomTo(zoomIndex + (event.deltaY > 0 ? -1 : 1), ratio, anchorMillis)
  }

  const playheadVisible = playheadMillis !== undefined && playheadMillis >= windowStart && playheadMillis <= windowEnd
  const playheadPercent = playheadVisible ? (playheadMillis - windowStart) / Math.max(1, windowEnd - windowStart) * 100 : 0
  const overviewWindowLeft = (windowStart - bounds.start) / DAY_MILLIS * 100
  const overviewWindowWidth = Math.min(100, visibleMillis / DAY_MILLIS * 100)
  const navigateOverview = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    const target = recordingTimelineSeekMillis((clientX - rect.left) / Math.max(1, rect.width), bounds.start, bounds.end)
    setFollowPlayback(false)
    setWindowStart(clampWindowStart(target - visibleMillis / 2, visibleMillis, bounds.start, bounds.end))
  }

  return <div style={styles.shell} aria-label="真实录音时间轴">
    <div style={styles.toolbar}>
      <span style={styles.controls}>
        <button type="button" style={styles.button} onClick={onTogglePlayback} aria-label={isPlaying ? '暂停录音' : '播放录音'}>{isPlaying ? '暂停' : '播放'}</button>
        <span aria-live="polite" style={{ color: arkmeTheme.secondary, fontSize: 10 }}>{playheadMillis === undefined ? `${String(items.length)} 个转写片段` : timeLabel(playheadMillis)}</span>
        {visibleSpeakers.length > 0 && <details style={styles.legend}>
          <summary style={styles.legendSummary} aria-label="可视范围说话人">
            {visibleSpeakers.slice(0, 3).map(speaker => <span key={`${speaker.label}:${String(speaker.colorIndex)}`} style={styles.legendItem}>
              <span aria-hidden style={{ ...styles.legendDot, background: recordingSpeakerColor(speaker.colorIndex) }} />{speaker.label}
            </span>)}
            {visibleSpeakers.length > 3 && <span>+{visibleSpeakers.length - 3}</span>}
          </summary>
          <span style={styles.legendPanel}>
            {visibleSpeakers.map(speaker => <span key={`${speaker.label}:${String(speaker.colorIndex)}`} style={styles.legendItem}>
              <span aria-hidden style={{ ...styles.legendDot, background: recordingSpeakerColor(speaker.colorIndex) }} />
              <span>{speaker.label}</span><small>{durationLabel(Math.max(1, Math.round(speaker.durationMillis / 1_000)))}</small>
            </span>)}
          </span>
        </details>}
      </span>
      <span style={styles.controls}>
        {!followPlayback && <button type="button" style={styles.button} onClick={() => { setFollowPlayback(true) }}>跟随播放</button>}
        <button type="button" style={styles.button} disabled={zoomIndex === 0} onClick={() => { zoomTo(zoomIndex - 1) }}>缩小</button>
        <span style={{ minWidth: 42, color: arkmeTheme.tertiary, fontSize: 9, textAlign: 'center' }}>{durationLabel(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[zoomIndex]!)}</span>
        <button type="button" style={styles.button} disabled={zoomIndex === RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS.length - 1} onClick={() => { zoomTo(zoomIndex + 1) }}>放大</button>
      </span>
    </div>
    <div
      style={styles.overview}
      role="scrollbar"
      aria-label="24 小时缩略导航"
      aria-valuemin={bounds.start}
      aria-valuemax={bounds.end}
      aria-valuenow={windowStart}
      onPointerDown={event => {
        if (event.button !== 0) return
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
          background: item.isMixedSpeakerAggregate
            ? arkmeTheme.secondary
            : item.item.isBackground ? arkmeTheme.tertiary : recordingSpeakerColor(item.item.speakerColorIndex),
        }} />
      })}
      <span aria-hidden style={{ ...styles.overviewWindow, left: `${String(overviewWindowLeft)}%`, width: `${String(overviewWindowWidth)}%` }} />
    </div>
    <div
      style={styles.track}
      tabIndex={0}
      role="slider"
      aria-label="当天录音时间轴，可拖拽平移，滚轮缩放"
      aria-valuemin={bounds.start}
      aria-valuemax={bounds.end}
      aria-valuenow={playheadMillis ?? windowStart}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { dragRef.current = undefined }}
      onWheel={handleWheel}
      onKeyDown={event => {
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
          event.preventDefault(); onTogglePlayback()
        }
      }}
    >
      <div style={styles.canvas}>
        <span style={styles.base} />
        <span style={{ ...styles.edgeTime, left: 4 }}>{timeLabel(windowStart)}</span>
        <span style={{ ...styles.edgeTime, right: 4 }}>{timeLabel(windowEnd)}</span>
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
                ? arkmeTheme.secondary
                : item.item.isBackground ? arkmeTheme.tertiary : recordingSpeakerColor(item.item.speakerColorIndex),
            }}
            aria-label={item.isMixedSpeakerAggregate
              ? `多个说话人，播放聚合的 ${String(item.aggregatedCount)} 个片段中的第一段`
              : `${item.item.speakerLabel}，播放该片段${item.aggregatedCount > 1 ? `，聚合 ${String(item.aggregatedCount)} 个片段` : ''}`}
            title={item.isMixedSpeakerAggregate
              ? `多个说话人 · 聚合 ${String(item.aggregatedCount)} 个片段`
              : `${item.item.speakerLabel} · ${item.item.text.slice(0, 80)}`}
            onPointerDown={event => { event.stopPropagation() }}
            onClick={event => { event.stopPropagation(); onActivate(item.item) }}
          />
        })}
        {playheadVisible && <span style={{ ...styles.playhead, left: `${String(playheadPercent)}%` }} aria-hidden><span style={styles.playheadDot} /></span>}
      </div>
    </div>
  </div>
}
