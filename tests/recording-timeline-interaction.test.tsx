import { type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeRecordingTimeline,
  RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS,
  recordingTimelineDayBounds,
  recordingTimelineFollowStart,
  recordingTimelineInitialView,
  recordingSegmentLayout,
  recordingTimelinePanStart,
  recordingTimelineSeekMillis,
  recordingTimelineZoomStart,
  recordingTimelineWheelZoom,
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

  it('uses the same bounded 24-hour to 5-second zoom levels as desktop', () => {
    expect(RECORDING_TIMELINE_ZOOM_LEVELS_SECONDS).toEqual([
      86_400, 43_200, 21_600, 10_800, 7_200, 3_600, 1_800, 900,
      600, 300, 180, 60, 30, 15, 10, 5,
    ])
  })

  it('opens real recordings in the desktop 30-minute context and keeps empty days at 24 hours', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    expect(recordingTimelineInitialView([{ startAtMillis: dayStart + 8 * 3_600_000 }] as never, dayStart, dayStart + 86_400_000))
      .toEqual({ zoomIndex: 6, windowStart: dayStart + 8 * 3_600_000 - 300_000 })
    expect(recordingTimelineInitialView([], dayStart, dayStart + 86_400_000)).toEqual({ zoomIndex: 0, windowStart: dayStart })
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
    )).toEqual({ leftPercent: 99.9988425925926, widthPercent: 0.0011574074074074073 })
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

  it('accumulates precision trackpad deltas without zooming once per wheel event', () => {
    expect(recordingTimelineWheelZoom(0, 4)).toEqual({ accumulatedDelta: 4, zoomStep: 0 })
    expect(recordingTimelineWheelZoom(20, 4)).toEqual({ accumulatedDelta: 0, zoomStep: -1 })
    expect(recordingTimelineWheelZoom(20, -4)).toEqual({ accumulatedDelta: -4, zoomStep: 0 })
    expect(recordingTimelineWheelZoom(0, -2, 1)).toEqual({ accumulatedDelta: 0, zoomStep: 1 })
  })

  it('filters offscreen items and aggregates dense windows to a bounded node count', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      itemId: `item-${String(index)}`,
      itemRef: `ref-${String(index)}`,
      speakerKey: `speaker-${String(index % 2)}`,
      startAtMillis: index * 1_000,
      endAtMillis: index * 1_000 + 500,
    })) as never
    const visible = recordingVisibleTimelineItems(items, 100_000, 200_000, 20)
    expect(visible.length).toBeLessThanOrEqual(20)
    expect(visible.every(item => item.endAtMillis >= 100_000 && item.startAtMillis <= 200_000)).toBe(true)
    expect(visible.some(item => item.aggregatedCount > 1)).toBe(true)
  })

  it('does not present a dense mixed-speaker bucket as the first speaker', () => {
    const items = [
      {
        itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', speakerColorIndex: 1,
        text: '第一段', startAtMillis: 1_000, endAtMillis: 1_400, isBackground: false,
      },
      {
        itemId: 'item-2', itemRef: 'ref-2', speakerKey: 'speaker-2', speakerLabel: '说话人 2', speakerColorIndex: 2,
        text: '第二段', startAtMillis: 1_500, endAtMillis: 1_900, isBackground: false,
      },
    ] as never

    expect(recordingVisibleTimelineItems(items, 0, 3_000, 1)).toEqual([
      expect.objectContaining({ aggregatedCount: 2, isMixedSpeakerAggregate: true }),
    ])
  })

  it('does not merge distinct owner speakers that happen to share a label and color', () => {
    const items = [
      { itemId: 'a', itemRef: 'a-ref', speakerKey: 'speaker-a', speakerLabel: '同名', speakerColorIndex: 1, startAtMillis: 1_000, endAtMillis: 1_400, isBackground: false },
      { itemId: 'b', itemRef: 'b-ref', speakerKey: 'speaker-b', speakerLabel: '同名', speakerColorIndex: 1, startAtMillis: 1_500, endAtMillis: 1_900, isBackground: false },
    ] as never

    expect(recordingVisibleTimelineItems(items, 0, 3_000, 1)[0]?.isMixedSpeakerAggregate).toBe(true)
  })

  it('keeps a ten-hour high-density recording bounded at every desktop zoom level', () => {
    const start = new Date(2026, 7, 28, 8).getTime()
    const items = Array.from({ length: 36_000 }, (_, index) => ({
      itemId: `item-${String(index)}`,
      itemRef: `ref-${String(index)}`,
      speakerKey: `speaker-${String(index % 8)}`,
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

  it('renders the desktop framed 24-hour timeline and selection controls', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '对齐时间轴',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    } as never
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={[item]}
      dayStartMillis={dayStart}
      playheadMillis={dayStart + 1_500}
      isPlaying
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)
    expect(markup).toContain('role="slider"')
    expect(markup).toContain('暂停录音')
    expect(markup).toContain('30分钟')
    expect(markup).toContain('说话人 1，选择该片段')
    expect(markup).not.toContain('播放该片段')
    expect(markup).toContain('24 小时缩略导航')
    expect(markup).toContain('当前窗口说话人')
    expect(markup).toMatch(/style="[^"]*border:1px solid [^;"]+;[^"]*border-radius:10px[^"]*" aria-label="真实录音时间轴"/)
  })

  it('renders the three desktop timeline layers as independent rows', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const items = [
      { itemId: 'a', itemRef: 'a-ref', speakerKey: 'speaker-a', speakerLabel: '说话人 A', speakerColorIndex: 1, text: '第一段', startAtMillis: dayStart + 18 * 3_600_000 + 30 * 60_000, endAtMillis: dayStart + 18 * 3_600_000 + 31 * 60_000, isBackground: false },
      { itemId: 'b', itemRef: 'b-ref', speakerKey: 'speaker-b', speakerLabel: '说话人 B', speakerColorIndex: 2, text: '第二段', startAtMillis: dayStart + 20 * 3_600_000, endAtMillis: dayStart + 20 * 3_600_000 + 60_000, isBackground: false },
    ] as never

    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={items}
      dayStartMillis={dayStart}
      isPlaying={false}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)

    const overviewIndex = markup.indexOf('aria-label="24 小时概览"')
    const detailIndex = markup.indexOf('aria-label="详细时间轴')
    const legendIndex = markup.indexOf('aria-label="当前窗口说话人图例"')
    expect(overviewIndex).toBeGreaterThan(-1)
    expect(detailIndex).toBeGreaterThan(overviewIndex)
    expect(legendIndex).toBeGreaterThan(detailIndex)
    for (const label of ['00:00', '06:00', '12:00', '18:00', '24:00']) expect(markup).toContain(`>${label}<`)
    expect(markup).toContain('data-timeline-layer="overview"')
    expect(markup).toContain('data-timeline-layer="detail"')
    expect(markup).toMatch(/<span style="[^"]*display:block[^"]*" data-timeline-ticks="detail"/)
    expect(markup).toContain('data-timeline-layer="speakers"')
    expect(markup).toContain('滚轮缩放')
  })

  it('does not show a free-floating playback action before a time is selected', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '等待定位',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    } as never
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={[item]}
      dayStartMillis={dayStart}
      isPlaying={false}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)

    expect(markup).not.toContain('aria-label="播放录音"')
    expect(markup).not.toContain('>播放</button>')
  })

  it('does not start hidden playback from the detail rail keyboard before a playable time is selected', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '等待定位',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    }
    const toggle = vi.fn()
    const Timeline = ArkmeRecordingTimeline as ComponentType<Record<string, unknown>>
    const renderer = create(<Timeline
      items={[item]}
      dayStartMillis={dayStart}
      isPlaying={false}
      onSelectAtMillis={() => {}}
      onTogglePlayback={toggle}
    />)

    act(() => {
      renderer.root.findByProps({ role: 'slider' }).props.onKeyDown({ key: ' ', preventDefault: vi.fn() })
    })

    expect(toggle).not.toHaveBeenCalled()
  })

  it('keeps the desktop play control disabled when the selected time is outside every recording', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '已录音',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    } as never
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={[item]}
      dayStartMillis={dayStart}
      playheadMillis={dayStart + 5_000}
      isPlaying={false}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="播放录音"/)
  })

  it('keeps the complete desktop timeline and import entry on an empty day', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={[]}
      dayStartMillis={dayStart}
      isPlaying={false}
      onImportAudio={() => {}}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)

    expect(markup).toContain('aria-label="24 小时概览"')
    expect(markup).toContain('aria-label="详细时间轴，可拖拽平移，滚轮缩放"')
    expect(markup).toContain('>无录音<')
    expect(markup).toContain('>导入音频<')
    expect(markup).not.toContain('当前窗口说话人图例')
  })

  it('does not mistake loading or failure for an empty recording day', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const shared = {
      items: [], dayStartMillis: dayStart, isPlaying: false,
      onSelectAtMillis: () => {}, onTogglePlayback: () => {},
    }
    const loadingMarkup = renderToStaticMarkup(<ArkmeRecordingTimeline {...shared} loading />)
    const failedMarkup = renderToStaticMarkup(<ArkmeRecordingTimeline {...shared} emptyState={false} />)

    expect(loadingMarkup).toContain('aria-label="正在读取录音"')
    expect(loadingMarkup).not.toContain('>无录音<')
    expect(failedMarkup).not.toContain('>无录音<')
    expect(failedMarkup).not.toContain('>导入音频<')
    expect(failedMarkup).not.toContain('有录音无人声')
    expect(failedMarkup).not.toContain('有人声')
  })

  it('selects a timeline segment without starting playback', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '只定位，不播放',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    }
    const select = vi.fn()
    const Timeline = ArkmeRecordingTimeline as ComponentType<Record<string, unknown>>
    const renderer = create(<Timeline
      items={[item]}
      dayStartMillis={dayStart}
      isPlaying={false}
      onSelectAtMillis={select}
      onTogglePlayback={() => {}}
    />)
    const segment = renderer.root.findAllByType('button').find(node => String(node.props['aria-label']).includes('说话人 1'))
    expect(segment).toBeDefined()

    act(() => { segment?.props.onClick({ stopPropagation: vi.fn(), detail: 0 }) })

    expect(select).toHaveBeenCalledWith(item.startAtMillis)
  })

  it('opens the desktop batch speaker editor from the speaker bar instead of filtering transcripts', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1',
      speakerColorIndex: 1, text: '内容', startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000,
      isBackground: false,
    }
    const editSpeaker = vi.fn()
    const Timeline = ArkmeRecordingTimeline as ComponentType<Record<string, unknown>>
    const renderer = create(<Timeline
      items={[item]}
      dayStartMillis={dayStart}
      isPlaying={false}
      onEditSpeaker={editSpeaker}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)
    const speakerButton = renderer.root.findAllByType('button')
      .find(node => node.props['aria-label'] === '编辑说话人 说话人 1')
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()

    act(() => { speakerButton?.props.onClick({
      stopPropagation,
      preventDefault,
      currentTarget: { getBoundingClientRect: () => ({ left: 10, right: 106, top: 90, bottom: 118 }) },
    }) })

    expect(editSpeaker).toHaveBeenCalledWith(item, { left: 10, right: 106, top: 90, bottom: 118 })
    expect(stopPropagation).toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalled()
  })

  it('keeps expanded speaker statistics read-only without inventing a speech drill-down', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const items = [
      {
        itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1',
        speakerColorIndex: 1, text: '第一段内容', startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 31_000,
        isBackground: false,
      },
      {
        itemId: 'item-2', itemRef: 'ref-2', speakerKey: 'speaker-1', speakerLabel: '说话人 1',
        speakerColorIndex: 1, text: '第二段内容', startAtMillis: dayStart + 61_000, endAtMillis: dayStart + 91_000,
        isBackground: false,
      },
    ]
    const editSpeaker = vi.fn()
    const Timeline = ArkmeRecordingTimeline as ComponentType<Record<string, unknown>>
    const renderer = create(<Timeline
      items={items}
      dayStartMillis={dayStart}
      isPlaying={false}
      onEditSpeaker={editSpeaker}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)
    expect(editSpeaker).not.toHaveBeenCalled()
    const serialized = JSON.stringify(renderer.toJSON())
    expect(serialized).not.toContain('返回说话人列表')
    expect(renderer.root.findAllByProps({ 'aria-label': '查看说话人 1的发言' })).toHaveLength(0)
    for (const label of ['占比 100.0%', '2个片段', '总时长: 1分钟']) {
      expect(renderer.root.findAll(node => node.children.filter(child => typeof child === 'string').join('') === label)).toHaveLength(1)
    }
  })

  it('derives the speaker legend from the visible window while keeping owner identities separate', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const items = [
      { itemId: 'morning', itemRef: 'morning-ref', speakerKey: 'morning-speaker', speakerLabel: '早间说话人', speakerColorIndex: 0, text: '早', startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false },
      { itemId: 'night', itemRef: 'night-ref', speakerKey: 'night-speaker', speakerLabel: '晚间说话人', speakerColorIndex: 1, text: '晚', startAtMillis: dayStart + 20 * 3_600_000, endAtMillis: dayStart + 20 * 3_600_000 + 1_000, isBackground: false },
    ] as never
    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline items={items} dayStartMillis={dayStart} isPlaying={false} onSelectAtMillis={() => {}} onTogglePlayback={() => {}} />)
    expect(markup).toContain('早间说话人')
    expect(markup).not.toContain('晚间说话人')
  })

  it('shows the desktop voice-presence legend instead of speaker identities at 24-hour zoom', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'item-1', itemRef: 'ref-1', speakerKey: 'speaker-1', speakerLabel: '说话人 1',
      speakerColorIndex: 1, text: '内容', startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000,
      isBackground: false,
    }
    const Timeline = ArkmeRecordingTimeline as ComponentType<Record<string, unknown>>
    const renderer = create(<Timeline items={[item]} dayStartMillis={dayStart} isPlaying={false} onSelectAtMillis={() => {}} onTogglePlayback={() => {}} />)
    for (let index = 0; index < 7; index += 1) {
      act(() => { renderer.root.findByProps({ 'aria-label': '缩小' }).props.onClick() })
    }

    const serialized = JSON.stringify(renderer.toJSON())
    expect(serialized).toContain('有录音无人声')
    expect(serialized).toContain('有人声')
    expect(serialized).not.toContain('当前窗口说话人图例')
  })

  it('labels dense mixed-speaker aggregates without borrowing the first speaker identity', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      itemId: `item-${String(index)}`,
      itemRef: `ref-${String(index)}`,
      speakerKey: `speaker-${String(index % 2)}`,
      speakerLabel: `说话人 ${String(index % 2 + 1)}`,
      speakerColorIndex: index % 2,
      text: `片段 ${String(index)}`,
      startAtMillis: dayStart + index * 1_000,
      endAtMillis: dayStart + index * 1_000 + 500,
      isBackground: false,
    })) as never

    const markup = renderToStaticMarkup(<ArkmeRecordingTimeline
      items={items}
      dayStartMillis={dayStart}
      isPlaying={false}
      onSelectAtMillis={() => {}}
      onTogglePlayback={() => {}}
    />)
    expect(markup).toContain('多个说话人，选择聚合的')
    expect(markup).not.toContain('播放聚合')
    expect(markup).toContain('多个说话人 · 聚合')
  })
  it('uses the rail coordinate when clicking inside a segment, and allows panning from the segment', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = { itemId: 'a', itemRef: 'ref', speakerKey: 's', speakerLabel: 'speaker',
      speakerColorIndex: 0, sameSpeakerItemCount: 1, startAtMillis: dayStart, endAtMillis: dayStart + 1_800_000, text: '', isBackground: false }
    const select = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={[item]} dayStartMillis={dayStart}
      isPlaying={false} onSelectAtMillis={select} onTogglePlayback={() => {}} />)
    const segment = renderer.root.findAllByType('button').find(node => String(node.props['aria-label']).includes('选择该片段'))!
    const stopPropagation = vi.fn()
    // A pointer click on a child must reach the rail; keyboard activation still selects the segment start.
    segment.props.onPointerDown?.({ stopPropagation })
    expect(stopPropagation).not.toHaveBeenCalled()
    const rail = () => renderer.root.findByProps({ role: 'slider' })
    const currentTarget = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 100, width: 600 }) }
    act(() => {
      rail().props.onPointerDown({ button: 0, clientX: 400, pointerId: 1, currentTarget, target: { dataset: { recordingSegmentIndex: '0' } } })
      rail().props.onPointerUp({ clientX: 400, currentTarget })
      segment.props.onClick({ detail: 1, stopPropagation })
    })
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(dayStart + 900_000)
    select.mockClear()
    act(() => { rail().props.onPointerDown({ button: 0, clientX: 400, pointerId: 2, currentTarget, target: { dataset: { recordingSegmentIndex: '0' } } }) })
    act(() => { rail().props.onPointerMove({ clientX: 430, currentTarget }) })
    act(() => { rail().props.onPointerUp({ clientX: 430, currentTarget }) })
    expect(select).not.toHaveBeenCalled()
  })

  it('always displays the selected time and exposes cancellation during media loading', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = { itemId: 'a', itemRef: 'ref', speakerKey: 's', speakerLabel: 'speaker',
      speakerColorIndex: 0, sameSpeakerItemCount: 1, startAtMillis: dayStart, endAtMillis: dayStart + 60_000, text: '', isBackground: false }
    const toggle = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={[item]} dayStartMillis={dayStart}
      playheadMillis={dayStart + 30_000} isPlaying={false} playbackLoading
      onSelectAtMillis={() => {}} onTogglePlayback={toggle} />)
    expect(renderer.root.findByType('time').children.join('')).toBe('00:00:30')
    const cancel = renderer.root.findByProps({ 'aria-label': '取消录音加载' })
    expect(cancel.props.disabled).toBe(false)
    act(() => { cancel.props.onClick() })
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('leaves Space activation on a segment to its native button instead of toggling playback', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = {
      itemId: 'a', itemRef: 'a', speakerKey: 'speaker-1', speakerLabel: '说话人 1', text: '片段',
      startAtMillis: dayStart + 1_000, endAtMillis: dayStart + 2_000, isBackground: false,
    } as never
    const select = vi.fn()
    const toggle = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={[item]} dayStartMillis={dayStart}
      playheadMillis={dayStart + 1_500} isPlaying={false} onSelectAtMillis={select} onTogglePlayback={toggle} />)
    const rail = renderer.root.findByProps({ role: 'slider' })
    const preventDefault = vi.fn()
    act(() => {
      rail.props.onKeyDown({ key: ' ', target: {}, currentTarget: {}, preventDefault })
    })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
    const segment = renderer.root.findByProps({ 'aria-label': '说话人 1，选择该片段' })
    act(() => { segment.props.onClick({ detail: 0, stopPropagation: vi.fn() }) })
    expect(select).toHaveBeenCalledWith(dayStart + 1_000)
    const element = {}
    act(() => { rail.props.onKeyDown({ key: ' ', target: element, currentTarget: element, preventDefault }) })
    expect(toggle).toHaveBeenCalledTimes(1)
    act(() => { renderer.unmount() })
  })

  it('selects a short segment when its minimum-width hit area extends beyond its real duration', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = { itemId: 'short', itemRef: 'short-ref', speakerKey: 's', speakerLabel: 'short',
      speakerColorIndex: 0, sameSpeakerItemCount: 1, startAtMillis: dayStart, endAtMillis: dayStart + 500, text: '', isBackground: false }
    const select = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={[item]} dayStartMillis={dayStart}
      isPlaying={false} onSelectAtMillis={select} onTogglePlayback={() => {}} />)
    const rail = renderer.root.findByProps({ role: 'slider' })
    const segment = renderer.root.findByProps({ 'aria-label': 'short，选择该片段' })
    const currentTarget = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, width: 1000 }) }
    const target = { dataset: { recordingSegmentIndex: '0' } }
    act(() => {
      rail.props.onPointerDown({ button: 0, clientX: 1, pointerId: 1, currentTarget, target })
      rail.props.onPointerUp({ clientX: 1, currentTarget })
    })
    expect(select).toHaveBeenLastCalledWith(dayStart)
    expect(segment.props['data-recording-segment-index']).toBe(0)
    select.mockClear()
    // An actual click on the empty rail must retain its exact empty time.
    act(() => {
      rail.props.onPointerDown({ button: 0, clientX: 10, pointerId: 2, currentTarget, target: { dataset: {} } })
      rail.props.onPointerUp({ clientX: 10, currentTarget })
    })
    expect(select).toHaveBeenLastCalledWith(dayStart + 18_000)
    act(() => { renderer.unmount() })
  })

  it('does not snap an aggregate gap to its first item', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const items = Array.from({ length: 1000 }, (_, index) => ({
      itemId: String(index), itemRef: String(index), speakerKey: String(index % 2), speakerLabel: 'speaker',
      speakerColorIndex: 0, sameSpeakerItemCount: 1, startAtMillis: dayStart + index * 1000,
      endAtMillis: dayStart + index * 1000 + 200, text: '', isBackground: false,
    }))
    const select = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={items} dayStartMillis={dayStart}
      isPlaying={false} onSelectAtMillis={select} onTogglePlayback={() => {}} />)
    const rail = renderer.root.findByProps({ role: 'slider' })
    const currentTarget = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, width: 1800 }) }
    act(() => {
      rail.props.onPointerDown({ button: 0, clientX: .5, pointerId: 1, currentTarget, target: { dataset: { recordingSegmentIndex: '0' } } })
      rail.props.onPointerUp({ clientX: .5, currentTarget })
    })
    expect(select).toHaveBeenCalledWith(dayStart + 500)
    act(() => { renderer.unmount() })
  })

  it('keeps a clipped minimum-width segment selection inside the visible day', () => {
    const dayStart = new Date(2026, 7, 28).getTime()
    const item = { itemId: 'clipped', itemRef: 'clipped-ref', speakerKey: 's', speakerLabel: 'speaker',
      speakerColorIndex: 0, sameSpeakerItemCount: 1, startAtMillis: dayStart - 10_000,
      endAtMillis: dayStart + 500, text: '', isBackground: false }
    const select = vi.fn()
    const renderer = create(<ArkmeRecordingTimeline items={[item]} dayStartMillis={dayStart}
      isPlaying={false} onSelectAtMillis={select} onTogglePlayback={() => {}} />)
    const rail = renderer.root.findByProps({ role: 'slider' })
    const currentTarget = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, width: 1000 }) }
    act(() => {
      rail.props.onPointerDown({ button: 0, clientX: 1, pointerId: 1, currentTarget, target: { dataset: { recordingSegmentIndex: '0' } } })
      rail.props.onPointerUp({ clientX: 1, currentTarget })
    })
    expect(select).toHaveBeenCalledWith(dayStart)
    act(() => { renderer.unmount() })
  })

  it('excludes segments that only touch the viewport boundary without a playable intersection', () => {
    const items = [
      { startAtMillis: 0, endAtMillis: 1000 },
      { startAtMillis: 2000, endAtMillis: 3000 },
    ] as never
    expect(recordingVisibleTimelineItems(items, 1000, 2000)).toEqual([])
  })

})
