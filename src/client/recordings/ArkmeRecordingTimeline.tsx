import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { arkmeTheme } from '../arkme-theme.js'

export const RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS = [
  86_400, 43_200, 21_600, 10_800, 7_200, 3_600, 1_800, 900,
  600, 300, 180, 60, 30, 15, 10, 5,
] as const

const DAY_MILLIS = 86_400_000

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

export interface ArkmeVisibleTimelineItem extends ArkmeRecordingWorkbenchItem {
  aggregatedCount: number
}

export function recordingVisibleTimelineItems(
  items: readonly ArkmeRecordingWorkbenchItem[],
  windowStart: number,
  windowEnd: number,
  maxNodes = 480,
): ArkmeVisibleTimelineItem[] {
  const visible = items.filter(item => item.endAtMillis >= windowStart && item.startAtMillis <= windowEnd)
  if (visible.length <= maxNodes) return visible.map(item => ({ ...item, aggregatedCount: 1 }))
  const bucketSize = Math.ceil(visible.length / maxNodes)
  const aggregated: ArkmeVisibleTimelineItem[] = []
  for (let index = 0; index < visible.length; index += bucketSize) {
    const bucket = visible.slice(index, index + bucketSize)
    const first = bucket[0]
    if (first === undefined) continue
    aggregated.push({
      ...first,
      startAtMillis: Math.min(...bucket.map(item => item.startAtMillis)),
      endAtMillis: Math.max(...bucket.map(item => item.endAtMillis)),
      aggregatedCount: bucket.length,
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
  shell: { display: 'grid', gridTemplateRows: '28px 52px', gap: 7 },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  controls: { display: 'flex', alignItems: 'center', gap: 4 },
  button: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 7, background: arkmeTheme.layer1, color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 11, padding: '3px 8px' },
  track: { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none', borderRadius: 9, background: arkmeTheme.layer2, cursor: 'grab' },
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
  const [zoomIndex, setZoomIndex] = useState(0)
  const visibleMillis = RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[zoomIndex]! * 1_000
  const [windowStart, setWindowStart] = useState(bounds.start)
  const [followPlayback, setFollowPlayback] = useState(true)
  const dragRef = useRef<{ x: number; start: number; moved: boolean }>()

  useEffect(() => {
    setZoomIndex(0)
    setWindowStart(bounds.start)
    setFollowPlayback(true)
  }, [bounds.start])

  useEffect(() => {
    if (!followPlayback || playheadMillis === undefined) return
    setWindowStart(current => recordingTimelineFollowStart(playheadMillis, current, visibleMillis, bounds.start, bounds.end))
  }, [bounds.end, bounds.start, followPlayback, playheadMillis, visibleMillis])

  const windowEnd = Math.min(bounds.end, windowStart + visibleMillis)
  const visibleItems = useMemo(
    () => recordingVisibleTimelineItems(items, windowStart, windowEnd),
    [items, windowEnd, windowStart],
  )

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

  return <div style={styles.shell} aria-label="真实录音时间轴">
    <div style={styles.toolbar}>
      <span style={styles.controls}>
        <button type="button" style={styles.button} onClick={onTogglePlayback} aria-label={isPlaying ? '暂停录音' : '播放录音'}>{isPlaying ? '暂停' : '播放'}</button>
        <span aria-live="polite" style={{ color: arkmeTheme.secondary, fontSize: 10 }}>{playheadMillis === undefined ? `${String(items.length)} 个转写片段` : timeLabel(playheadMillis)}</span>
      </span>
      <span style={styles.controls}>
        {!followPlayback && <button type="button" style={styles.button} onClick={() => { setFollowPlayback(true) }}>跟随播放</button>}
        <button type="button" style={styles.button} disabled={zoomIndex === 0} onClick={() => { zoomTo(zoomIndex - 1) }}>缩小</button>
        <span style={{ minWidth: 42, color: arkmeTheme.tertiary, fontSize: 9, textAlign: 'center' }}>{durationLabel(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS[zoomIndex]!)}</span>
        <button type="button" style={styles.button} disabled={zoomIndex === RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS.length - 1} onClick={() => { zoomTo(zoomIndex + 1) }}>放大</button>
      </span>
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
            key={`${item.itemId}:${String(item.startAtMillis)}`}
            type="button"
            style={{
              ...styles.segment,
              left: `${String(layout.leftPercent)}%`,
              width: `${String(layout.widthPercent)}%`,
              background: item.isBackground ? arkmeTheme.tertiary : arkmeTheme.accent,
            }}
            aria-label={`${item.speakerLabel}，播放该片段${item.aggregatedCount > 1 ? `，聚合 ${String(item.aggregatedCount)} 个片段` : ''}`}
            title={`${item.speakerLabel} · ${item.text.slice(0, 80)}`}
            onPointerDown={event => { event.stopPropagation() }}
            onClick={event => { event.stopPropagation(); onActivate(item) }}
          />
        })}
        {playheadVisible && <span style={{ ...styles.playhead, left: `${String(playheadPercent)}%` }} aria-hidden><span style={styles.playheadDot} /></span>}
      </div>
    </div>
  </div>
}
