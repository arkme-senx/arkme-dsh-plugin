import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ArkmeRecordingTimeline,
  RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS,
  recordingTimelineDayBounds,
  recordingTimelineFollowStart,
  recordingSegmentLayout,
  recordingTimelineItemAt,
  recordingTimelinePanStart,
  recordingTimelineSeekMillis,
  recordingTimelineZoomStart,
  recordingVisibleTimelineItems,
} from '../src/client/recordings/ArkmeRecordingTimeline.js'

describe('recording timeline math', () => {
  it('projects real segments into the visible time window', () => {
    expect(recordingSegmentLayout(1_000, 3_000, 0, 10_000)).toEqual({ leftPercent: 10, widthPercent: 20 })
    expect(recordingSegmentLayout(-1_000, 500, 0, 10_000)).toEqual({ leftPercent: 0, widthPercent: 5 })
  })

  it('converts a bounded track position into an owner timestamp', () => {
    expect(recordingTimelineSeekMillis(0.25, 1_000, 9_000)).toBe(3_000)
    expect(recordingTimelineSeekMillis(2, 1_000, 9_000)).toBe(9_000)
  })

  it('selects the containing segment or the nearest real segment for timeline seeking', () => {
    const items = [
      { itemRef: 'first', startAtMillis: 1_000, endAtMillis: 2_000 },
      { itemRef: 'second', startAtMillis: 4_000, endAtMillis: 5_000 },
    ] as never
    expect(recordingTimelineItemAt(items, 1_500)).toMatchObject({ itemRef: 'first' })
    expect(recordingTimelineItemAt(items, 3_800)).toMatchObject({ itemRef: 'second' })
  })

  it('uses the same bounded 24-hour to 5-second zoom levels as desktop', () => {
    expect(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS).toEqual([
      86_400, 43_200, 21_600, 10_800, 7_200, 3_600, 1_800, 900,
      600, 300, 180, 60, 30, 15, 10, 5,
    ])
  })

  it('clips the workbench to the local day even when a transcript crosses midnight', () => {
    const localDay = new Date(2026, 7, 28).getTime()
    const items = [{
      itemRef: 'cross-midnight',
      startAtMillis: localDay + 86_399_000,
      endAtMillis: localDay + 86_405_000,
    }] as never
    expect(recordingTimelineDayBounds(items)).toEqual({ start: localDay, end: localDay + 86_400_000 })
    expect(recordingSegmentLayout(
      items[0]!.startAtMillis,
      items[0]!.endAtMillis,
      localDay,
      localDay + 86_400_000,
    )).toEqual({ leftPercent: 99.9988425925926, widthPercent: 0.35 })
  })

  it('keeps the pointer or playhead anchor stable while changing zoom level', () => {
    expect(recordingTimelineZoomStart({
      currentStart: 20_000,
      currentVisibleMillis: 10_000,
      targetVisibleMillis: 5_000,
      anchorMillis: 22_500,
      anchorRatio: 0.25,
      dayStart: 0,
      dayEnd: 100_000,
    })).toBe(21_250)
    expect(recordingTimelineZoomStart({
      currentStart: 0,
      currentVisibleMillis: 10_000,
      targetVisibleMillis: 5_000,
      anchorMillis: 500,
      anchorRatio: 0.5,
      dayStart: 0,
      dayEnd: 100_000,
    })).toBe(0)
  })

  it('pans within day bounds and recenters only when follow playback leaves the safe viewport', () => {
    expect(recordingTimelinePanStart(30_000, 250, 1_000, 20_000, 0, 100_000)).toBe(25_000)
    expect(recordingTimelinePanStart(0, 250, 1_000, 20_000, 0, 100_000)).toBe(0)
    expect(recordingTimelineFollowStart(25_000, 20_000, 20_000, 0, 100_000)).toBe(20_000)
    expect(recordingTimelineFollowStart(39_000, 20_000, 20_000, 0, 100_000)).toBe(29_000)
  })

  it('filters offscreen items and aggregates dense windows to a bounded node count', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      itemId: `item-${String(index)}`,
      itemRef: `ref-${String(index)}`,
      startAtMillis: index * 1_000,
      endAtMillis: index * 1_000 + 500,
    })) as never
    const visible = recordingVisibleTimelineItems(items, 100_000, 200_000, 20)
    expect(visible.length).toBeLessThanOrEqual(20)
    expect(visible.every(item => item.endAtMillis >= 100_000 && item.startAtMillis <= 200_000)).toBe(true)
    expect(visible.some(item => item.aggregatedCount > 1)).toBe(true)
  })

  it('keeps a ten-hour high-density recording bounded at every desktop zoom level', () => {
    const start = new Date(2026, 7, 28, 8).getTime()
    const items = Array.from({ length: 36_000 }, (_, index) => ({
      itemId: `item-${String(index)}`,
      itemRef: `ref-${String(index)}`,
      speakerLabel: `说话人 ${String(index % 8)}`,
      text: `第 ${String(index)} 个片段`,
      startAtMillis: start + index * 1_000,
      endAtMillis: start + index * 1_000 + 800,
      isBackground: false,
    })) as never

    for (const seconds of RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS) {
      const visible = recordingVisibleTimelineItems(items, start, start + seconds * 1_000)
      expect(visible.length).toBeLessThanOrEqual(480)
      expect(visible.every(item => item.endAtMillis >= start && item.startAtMillis <= start + seconds * 1_000)).toBe(true)
    }
  })

  it('renders keyboard, playback, zoom and accessible segment controls', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerLabel: '说话人 1', text: '对齐时间轴',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    } as never
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={[item]}
      dayStartMillis={dayStart}
      playheadMillis={dayStart + 1_500}
      isPlaying
      onActivate={() => {}}
      onTogglePlayback={() => {}}
    />)
    expect(markup).toContain('role="slider"')
    expect(markup).toContain('暂停录音')
    expect(markup).toContain('24小时')
    expect(markup).toContain('说话人 1，播放该片段')
  })
})
