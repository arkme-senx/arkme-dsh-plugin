import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import type { ArkmeRecordingCalendarDay, ArkmeRecordingTimelineEvent, ArkmeRecordingTranscriptItem } from '../src/types.js'
import * as recordingSurface from '../src/client/ArkmeRecordingSurface.js'

const { ArkmeRecordingSurface } = recordingSurface

function styleMap(value: string): Map<string, string> {
  return new Map(value.split(';').filter(Boolean).map(rule => {
    const separator = rule.indexOf(':')
    return [rule.slice(0, separator), rule.slice(separator + 1)]
  }))
}

function matchStyle(markup: string, pattern: RegExp): Map<string, string> {
  const match = pattern.exec(markup)
  expect(match?.[1]).toBeDefined()
  return styleMap(match?.[1] ?? '')
}

describe('ArkmeRecordingSurface layout', () => {
  it('widens the desktop calendar column to keep seven cells readable', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const layout = matchStyle(markup, /<div style="([^"]*grid-template-columns:[^"]+)">/)

    expect(layout.get('grid-template-columns')).toBe('minmax(420px,44%) minmax(0,1fr)')
    expect(markup).toContain('aria-label="月份"')
    expect(markup).toContain('aria-label="年份"')
    expect(markup).toMatch(/<button type="button" disabled=""[^>]*aria-label="下个月"/)
    expect(markup).toContain('>今日<')
  })

  it('keeps page chrome fixed and scrolls only the active tab pane', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)
    const detail = matchStyle(markup, /<section style="([^"]+)" aria-label="录音详情">/)
    const panel = matchStyle(markup, /<div style="([^"]+)" aria-label="录音标签内容">/)
    const pane = matchStyle(markup, /<div style="([^"]+)" data-arkme-recording-pane="active">/)

    expect(root.get('overflow')).toBe('hidden')
    expect(detail.get('display')).toBe('flex')
    expect(detail.get('flex-direction')).toBe('column')
    expect(detail.get('height')).toBe('100%')
    expect(detail.get('min-height')).toBe('0')
    expect(panel.get('display')).toBe('flex')
    expect(panel.get('flex-direction')).toBe('column')
    expect(panel.get('border-top')).toBe('1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))')
    expect(panel.get('border-radius')).toBe('10px 10px 0 0')
    expect(pane.get('flex')).toBe('1')
    expect(pane.get('min-height')).toBe('0')
    expect(pane.get('overflow-y')).toBe('auto')
    expect(pane.get('overscroll-behavior')).toBe('contain')
    expect(markup).toContain('aria-label="收起时间轴"')
    expect(markup).toContain('aria-label="导出录音分析"')
    expect(markup).toContain('aria-label="转写多选模式"')
    expect(markup).toMatch(/data-arkme-recording-tab="transcript"[^>]*aria-current="page"/)
    expect(markup).toContain('data-arkme-recording-tab-icon="timeline"')
    expect(markup).toContain('data-arkme-recording-tab-icon="summary"')
    expect(markup).toContain('data-arkme-recording-tab-icon="transcript"')
    expect(markup).not.toContain('◷ 时间轴')
    expect(markup).not.toContain('▥ 总结')
    expect(markup).not.toContain('▤ 转写')
  })

  it('matches the client tab treatment with normal surfaces and one ten-pixel active underline', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const timelineMatch = /<button type="button" data-arkme-recording-tab="timeline" style="([^"]+)">([\s\S]*?)<\/button>/.exec(markup)
    const summaryMatch = /<button type="button" data-arkme-recording-tab="summary" style="([^"]+)"/.exec(markup)
    const transcriptMatch = /<button type="button" data-arkme-recording-tab="transcript" style="([^"]+)" aria-current="page">([\s\S]*?)<\/button>/.exec(markup)

    expect(timelineMatch?.[1]).toBeDefined()
    expect(summaryMatch?.[1]).toBeDefined()
    expect(transcriptMatch?.[1]).toBeDefined()
    const timeline = styleMap(timelineMatch?.[1] ?? '')
    const summary = styleMap(summaryMatch?.[1] ?? '')
    const selected = styleMap(transcriptMatch?.[1] ?? '')

    expect(selected.get('border-color')).toBe('rgba(0,0,0,0)')
    expect(selected.get('background')).toBe('transparent')
    expect(selected.get('font-weight')).toBe('500')
    expect(timeline.get('border-color')).toBe('rgba(0,0,0,0)')
    expect(timeline.get('background')).toBe('transparent')
    expect(summary.get('border-color')).toBe('rgba(0,0,0,0)')
    expect(summary.get('background')).toBe('transparent')
    expect(markup.match(/data-arkme-recording-tab-indicator="active"/g)).toHaveLength(1)
    expect(transcriptMatch?.[2]).toContain('data-arkme-recording-tab-indicator="active"')
    const indicator = matchStyle(markup, /<span data-arkme-recording-tab-indicator="active" style="([^"]+)"/)
    expect(indicator.get('width')).toBe('10px')
    expect(indicator.get('height')).toBe('2px')
  })

  it('shows the complete calendar duration in compact hours', () => {
    type CalendarCellProps = {
      date: Date
      meta: ArkmeRecordingCalendarDay
      selected: boolean
      isToday: boolean
      onClick(): void
    }
    const RecordingCalendarCell = (recordingSurface as unknown as {
      RecordingCalendarCell?: ComponentType<CalendarCellProps>
    }).RecordingCalendarCell

    expect(RecordingCalendarCell).toBeDefined()
    if (RecordingCalendarCell === undefined) return

    const markup = renderToStaticMarkup(<RecordingCalendarCell
      date={new Date(2026, 6, 9)}
      meta={{ dateStamp: new Date(2026, 6, 9).getTime(), durationMillis: 42 * 60_000, hasRecording: true, unreviewedCount: 1 }}
      selected={false}
      isToday={false}
      onClick={() => {}}
    />)

    expect(markup).toContain('>9<')
    expect(markup).toContain('>0.7h<')
    expect(markup).not.toContain('text-overflow:ellipsis')
    expect(markup).not.toContain('aria-hidden')
    expect(markup).not.toContain('>1</span>')
  })

  it('uses white only for past dates while today and future dates stay on the gray calendar surface', () => {
    const Cell = recordingSurface.RecordingCalendarCell
    const date = new Date(2026, 7, 21)
    const past = renderToStaticMarkup(<Cell date={date} meta={undefined} selected={false} isToday={false} isPast onClick={() => {}} />)
    const today = renderToStaticMarkup(<Cell date={date} meta={undefined} selected isToday isPast={false} onClick={() => {}} />)
    const future = renderToStaticMarkup(<Cell date={date} meta={undefined} selected={false} isToday={false} isPast={false} disabled onClick={() => {}} />)

    expect(past).toContain('data-arkme-calendar-day-state="past"')
    expect(past).toContain('background:var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-2, #ffffff))')
    expect(today).toContain('data-arkme-calendar-day-state="today"')
    expect(today).toContain('background:var(--dsw-alias-bg-layer-2, #f3f4f6)')
    expect(future).toContain('data-arkme-calendar-day-state="future"')
    expect(future).toContain('background:var(--dsw-alias-bg-layer-2, #f3f4f6)')
  })

  it('reserves fixed rows so dates align whether a duration exists or not', () => {
    type CalendarCellProps = {
      date: Date
      meta: ArkmeRecordingCalendarDay
      selected: boolean
      isToday: boolean
      onClick(): void
    }
    const RecordingCalendarCell = (recordingSurface as unknown as {
      RecordingCalendarCell?: ComponentType<CalendarCellProps>
    }).RecordingCalendarCell

    expect(RecordingCalendarCell).toBeDefined()
    if (RecordingCalendarCell === undefined) return

    const markup = renderToStaticMarkup(<RecordingCalendarCell
      date={new Date(2026, 6, 9)}
      meta={{ dateStamp: new Date(2026, 6, 9).getTime(), durationMillis: 42 * 60_000, hasRecording: true, unreviewedCount: 0 }}
      selected={false}
      isToday={false}
      onClick={() => {}}
    />)
    const cell = matchStyle(markup, /^<button[^>]*style="([^"]+)"/)

    expect(cell.get('display')).toBe('grid')
    expect(cell.get('grid-template-rows')).toBe('24px 12px')
    expect(cell.get('height')).toBe('76px')
    expect(markup).toContain('grid-row:1;line-height:24px')
  })

  it('shows a stable speaker color dot beside the numeric speaker label', () => {
    type SpeakerLabelProps = {
      label: string
      colorIndex: number
      isBackground: boolean
    }
    const RecordingSpeakerLabel = (recordingSurface as unknown as {
      RecordingSpeakerLabel?: ComponentType<SpeakerLabelProps>
    }).RecordingSpeakerLabel

    expect(RecordingSpeakerLabel).toBeDefined()
    if (RecordingSpeakerLabel === undefined) return

    const markup = renderToStaticMarkup(<RecordingSpeakerLabel
      label="说话人 4"
      colorIndex={0}
      isBackground
    />)

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('background:#ec7fa9')
    expect(markup).toContain('>说话人 4<')
    expect(markup).toContain('>背景音<')
  })

  it('matches the client transcript flow so wrapped lines return to the row content edge', () => {
    type TranscriptRowProps = {
      item: ArkmeRecordingTranscriptItem
      query?: string
      currentMatchId?: string
      playbackActive?: boolean
      playing?: boolean
      onPlay(): void
    }
    const RecordingTranscriptRow = (recordingSurface as unknown as {
      RecordingTranscriptRow?: ComponentType<TranscriptRowProps>
    }).RecordingTranscriptRow

    expect(RecordingTranscriptRow).toBeDefined()
    if (RecordingTranscriptRow === undefined) return

    const markup = renderToStaticMarkup(<RecordingTranscriptRow
      item={{
        itemId: 'long-segment', sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system',
        startAtMillis: new Date(2026, 7, 21, 15, 7, 46).getTime(), endAtMillis: new Date(2026, 7, 21, 15, 8, 3).getTime(),
        speakerNumber: 9, speakerColorIndex: 0, speakerLabel: '说话人 9', isSelf: false, isBackground: false,
        text: '万出错，在这个圈子里有无数双眼睛盯神公司规定我必须是温婉优雅，永远无懈可接。',
      }}
      onPlay={() => {}}
    />)
    const row = matchStyle(markup, /data-arkme-recording-transcript-item="long-segment" style="([^"]+)"/)
    const speaker = matchStyle(markup, /data-arkme-recording-transcript-speaker="long-segment" style="([^"]+)"/)
    const text = matchStyle(markup, /data-arkme-recording-transcript-text="long-segment" style="([^"]+)"/)
    const meta = matchStyle(markup, /data-arkme-recording-transcript-meta="long-segment" style="([^"]+)"/)
    const reserve = matchStyle(markup, /data-arkme-recording-transcript-meta-reserve="long-segment"[^>]*style="([^"]+)"/)

    expect(row.get('position')).toBe('relative')
    expect(row.get('display')).toBe('block')
    expect(row.has('grid-template-columns')).toBe(false)
    expect(speaker.get('position')).toBe('absolute')
    expect(text.get('padding-left')).toBe('20px')
    expect(text.get('text-indent')).toBe('118px')
    expect(meta.get('position')).toBe('absolute')
    expect(meta.get('right')).toBe('10px')
    expect(meta.get('bottom')).toBe('8px')
    expect(reserve.get('display')).toBe('inline-flex')
    expect(reserve.get('visibility')).toBe('hidden')
  })

  it('groups long transcripts by hour so the page remains scannable', () => {
    const groupRecordingTranscriptByHour = (recordingSurface as unknown as {
      groupRecordingTranscriptByHour?: (items: ArkmeRecordingTranscriptItem[]) => Array<{ label: string; items: ArkmeRecordingTranscriptItem[] }>
    }).groupRecordingTranscriptByHour
    expect(groupRecordingTranscriptByHour).toBeDefined()
    if (groupRecordingTranscriptByHour === undefined) return
    const item = (itemId: string, hour: number): ArkmeRecordingTranscriptItem => ({
      itemId, sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system',
      startAtMillis: new Date(2026, 7, 2, hour, 5).getTime(), endAtMillis: new Date(2026, 7, 2, hour, 6).getTime(),
      speakerNumber: 1, speakerColorIndex: 0, speakerLabel: '说话人 1', isSelf: false, isBackground: false, text: itemId,
    })

    const groups = groupRecordingTranscriptByHour([item('a', 8), item('b', 8), item('c', 10)])
    expect(groups.map(group => [group.label, group.items.length])).toEqual([['08:00–08:59', 2], ['10:00–10:59', 1]])
  })

  it('matches and renders the current-day transcript search', () => {
    type TranscriptSearchProps = {
      value: string
      matchCount: number
      activeMatchIndex: number
      onChange(value: string): void
      onPrevious(): void
      onNext(): void
      onCompare(): void
      onEdit(): void
    }
    const RecordingTranscriptSearch = (recordingSurface as unknown as {
      RecordingTranscriptSearch?: ComponentType<TranscriptSearchProps>
    }).RecordingTranscriptSearch
    const recordingTranscriptSearchMatches = recordingSurface.recordingTranscriptSearchMatches
    const RecordingTranscriptHighlightedText = recordingSurface.RecordingTranscriptHighlightedText
    expect(RecordingTranscriptSearch).toBeDefined()
    expect(recordingTranscriptSearchMatches).toBeDefined()
    expect(RecordingTranscriptHighlightedText).toBeDefined()
    if (RecordingTranscriptSearch === undefined) return

    const markup = renderToStaticMarkup(<RecordingTranscriptSearch value="露营" matchCount={2} activeMatchIndex={0} onChange={() => {}} onPrevious={() => {}} onNext={() => {}} onCompare={() => {}} onEdit={() => {}} />)
    expect(markup).toContain('data-arkme-recording-transcript-search="today"')
    expect(markup).toContain('type="text"')
    expect(markup).toContain('role="searchbox"')
    expect(markup).toContain('maxLength="64"')
    expect(markup).toContain('aria-label="搜索当天转写"')
    expect(markup).toContain('placeholder="搜索当天转写"')
    expect(markup).toContain('aria-label="清空转写搜索"')
    expect(markup).toContain('aria-label="转写专属操作"')
    expect(markup).toContain('aria-label="转写对比"')
    expect(markup).toContain('aria-label="编辑转写"')
    expect(markup).toContain('title="编辑转写"')
    expect(markup).toContain('data-arkme-recording-toolbar-icon="compare"')
    expect(markup).toContain('aria-label="搜索结果 1/2"')
    expect(markup).toContain('>1/2</span>')
    expect(markup).toContain('>上一个</button>')
    expect(markup).toContain('>下一个</button>')
    expect(markup).toContain('border-color:var(--dsw-alias-label-primary, #17191c)')

    const at = new Date(2026, 7, 21, 15, 10, 12).getTime()
    const item = (itemId: string, speakerLabel: string, text: string): ArkmeRecordingTranscriptItem => ({
      itemId, sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system',
      startAtMillis: at, endAtMillis: at + 10_000, speakerNumber: 1, speakerColorIndex: 0,
      speakerLabel, isSelf: false, isBackground: false, text,
    })
    const items = [item('camp', '刘大爷', '今天露营，明天继续露营'), item('work', '小王', '下午回公司开会')]
    const matches = recordingTranscriptSearchMatches(items, '露营')
    expect(matches.map(value => [value.itemId, value.field, value.start])).toEqual([
      ['camp', 'text', 2],
      ['camp', 'text', 9],
    ])
    expect(recordingTranscriptSearchMatches(items, '小王').map(value => value.field)).toEqual(['speaker'])
    expect(recordingTranscriptSearchMatches(items, '15:10').map(value => value.itemId)).toEqual(['camp', 'work'])
    expect(recordingTranscriptSearchMatches(items, '  ')).toEqual([])

    const highlighted = renderToStaticMarkup(<RecordingTranscriptHighlightedText
      text={items[0]?.text ?? ''}
      query="露营"
      itemId="camp"
      field="text"
      currentMatchId={matches[0]?.matchId ?? ''}
    />)
    expect(highlighted.match(/data-arkme-recording-search-match=/g)).toHaveLength(2)
    expect(highlighted.match(/data-arkme-recording-search-current="true"/g)).toHaveLength(1)
    expect(highlighted).toContain('background:var(--dsw-alias-state-warn-tertiary, #fff8e6)')
    expect(highlighted).toContain('background:var(--dsw-alias-bg-layer-2, #f3f4f6)')
    expect(markup).not.toContain('state-business-primary')
    expect(highlighted).not.toContain('state-business-tertiary')
  })

  it('renders the full system-versus-Doubao transcript comparison', () => {
    const RecordingTranscriptCompareDialog = recordingSurface.RecordingTranscriptCompareDialog
    const systemItem: ArkmeRecordingTranscriptItem = {
      itemId: 'system:0', sessionId: 'session', childId: 'child', asrItemIndex: 0,
      transcriptSource: 'system', startAtMillis: new Date(2026, 7, 21, 12, 33, 6).getTime(),
      endAtMillis: new Date(2026, 7, 21, 12, 33, 22).getTime(), speakerNumber: 20,
      speakerColorIndex: 0, speakerLabel: '说话人 20', isSelf: false, isBackground: false,
      text: '系统转写内容',
    }
    const doubaoItem: ArkmeRecordingTranscriptItem = {
      ...systemItem, itemId: 'doubao:0', transcriptSource: 'doubao', transcriptStatus: 'processing',
      speakerLabel: '豆包转写中', text: '豆包转写中...',
    }
    const markup = renderToStaticMarkup(<RecordingTranscriptCompareDialog
      system={{ state: 'ready', message: '', items: [systemItem] }}
      doubao={{ state: 'processing', message: '豆包转写中', items: [doubaoItem] }}
      starting={false}
      message=""
      onClose={() => {}}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('>转写对比<')
    expect(markup).toContain('aria-label="系统转写"')
    expect(markup).toContain('aria-label="豆包转写"')
    expect(markup).toContain('data-arkme-recording-compare-source="system"')
    expect(markup).toContain('data-arkme-recording-compare-source="doubao"')
    expect(markup).toContain('系统转写内容')
    expect(markup).toContain('豆包转写中...')
    expect(markup).toContain('aria-label="关闭转写对比"')
  })

  it('switches the toolbar actions to the desktop-client transcript controls', () => {
    type TabActionsProps = {
      activeTab: 'timeline' | 'summary' | 'transcript'
      timelineExpanded: boolean
      onSelectMode(): void
      onToggleTimeline(): void
      onExport(): void
    }
    const RecordingTabActions = (recordingSurface as unknown as {
      RecordingTabActions?: ComponentType<TabActionsProps>
    }).RecordingTabActions
    expect(RecordingTabActions).toBeDefined()
    if (RecordingTabActions === undefined) return

    const timeline = renderToStaticMarkup(<RecordingTabActions
      activeTab="timeline"
      timelineExpanded
      onSelectMode={() => {}}
      onToggleTimeline={() => {}}
      onExport={() => {}}
    />)
    expect(timeline).toContain('aria-label="收起时间轴"')
    expect(timeline).toContain('aria-label="导出录音分析"')
    expect(timeline).not.toContain('aria-label="转写多选模式"')
    expect(timeline).not.toContain('aria-label="编辑转写"')

    const transcript = renderToStaticMarkup(<RecordingTabActions
      activeTab="transcript"
      timelineExpanded
      onSelectMode={() => {}}
      onToggleTimeline={() => {}}
      onExport={() => {}}
    />)
    expect(transcript).toContain('aria-label="转写多选模式"')
    expect(transcript).toContain('data-arkme-recording-toolbar-icon="select"')
    expect(transcript).toContain('aria-label="收起时间轴"')
    expect(transcript).toContain('aria-label="导出录音分析"')
    expect(transcript).not.toContain('aria-label="编辑转写"')
  })

  it('matches the compact desktop timeline card and expands into a detailed location dialog', () => {
    const dayStartMillis = new Date(2026, 7, 21).getTime()
    const event: ArkmeRecordingTimelineEvent = {
      eventId: 'village', startAt: '15:07', endAt: '15:38', timeRange: '15:07–15:38',
      title: '刘大爷的告别与东北村落纪事',
      description: '多人围坐或活动于雪中村落，讨论公众人物承受的舆论压力。\n聚焦刘大爷一生的悲苦经历。',
      scene: '户外/村庄（推测为东北农村）', emotion: '', todo: '', tags: [],
      participants: ['说话人9', '说话人10', '说话人11', '说话人12', '说话人13'], rawText: '',
    }
    const item = (speaker: number, minute: number): ArkmeRecordingTranscriptItem => ({
      itemId: `speaker-${String(speaker)}`, sessionId: 'session', childId: 'child', asrItemIndex: speaker, transcriptSource: 'system',
      startAtMillis: dayStartMillis + 15 * 3_600_000 + minute * 60_000,
      endAtMillis: dayStartMillis + 15 * 3_600_000 + minute * 60_000 + 8_000,
      speakerNumber: speaker, speakerColorIndex: speaker - 9, speakerLabel: `说话人 ${String(speaker)}`,
      isSelf: false, isBackground: false, text: `第${String(speaker)}位说话人的代表性原话`,
    })
    const transcriptItems = [item(9, 8), item(10, 9), item(11, 10), item(12, 11), item(13, 12)]
    const speakers = recordingSurface.recordingTimelineEventSpeakers(event, transcriptItems, dayStartMillis)
    const quotes = recordingSurface.timelineEventRepresentativeQuotes(event, transcriptItems, dayStartMillis)

    expect(speakers.map(value => value.label)).toEqual(['说话人 9', '说话人 10', '说话人 11', '说话人 12', '说话人 13'])
    expect(quotes).toHaveLength(3)
    expect(recordingSurface.timelineEventPreviewText(event.description)).toBe('多人围坐或活动于雪中村落，讨论公众人物承受的舆论压力。')

    const card = renderToStaticMarkup(<recordingSurface.RecordingTimelineEventCard event={event} eventIndex={0} speakers={speakers} onOpen={() => {}} />)
    const titleStyle = matchStyle(card, /<h3 style="([^"]+)"/)
    const summaryStyle = matchStyle(card, /<p style="([^"]+)"/)
    expect(card).toContain('data-arkme-recording-timeline-card="village"')
    expect(card).toContain('aria-label="查看15:07–15:38的时间轴详情"')
    expect(card).toContain('>户外/村庄</span>')
    expect(card).not.toContain('场景 ·')
    expect(card).toContain('aria-label="还有2位说话人：说话人 12、说话人 13"')
    expect(card).toContain('>+2</span>')
    expect(card).not.toContain('聚焦刘大爷一生的悲苦经历。')
    expect(titleStyle.get('font-size')).toBe('15px')
    expect(summaryStyle.get('font-size')).toBe('14px')

    const dialog = renderToStaticMarkup(<recordingSurface.RecordingTimelineDetailDialog event={event} speakers={speakers} quotes={quotes} onClose={() => {}} />)
    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain('aria-label="关闭时间轴详情"')
    expect(dialog).toContain('<strong style="color:var(--dsw-alias-label-primary, #17191c)">地点：</strong>户外/村庄（推测为东北农村）')
    expect(dialog).toContain('>📝 时段总结</h3>')
    expect(dialog).toContain('>👥 参与人</h3>')
    expect(dialog).toContain('>💬 代表性原话</h3>')
    expect(dialog).toContain('>说话人 13</span>')
    expect(dialog).toContain('第9位说话人的代表性原话')
  })

  it('matches the desktop audio-analysis hierarchy with a day track, focus track, and speaker legend', () => {
    type OverviewProps = {
      items: ArkmeRecordingTranscriptItem[]
      dayStartMillis: number
      positionSeconds: number
      playing: boolean
      canPlay: boolean
      expanded?: boolean
      onToggle(): void
      onSeek(seconds: number): void
      onExpand?(): void
    }
    const RecordingSignalOverview = (recordingSurface as unknown as {
      RecordingSignalOverview?: ComponentType<OverviewProps>
    }).RecordingSignalOverview
    expect(RecordingSignalOverview).toBeDefined()
    if (RecordingSignalOverview === undefined) return
    const dayStartMillis = new Date(2026, 7, 21).getTime()
    const item: ArkmeRecordingTranscriptItem = {
      itemId: 'segment', sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system',
      startAtMillis: dayStartMillis + 15 * 3_600_000 + 5 * 60_000,
      endAtMillis: dayStartMillis + 15 * 3_600_000 + 8 * 60_000,
      speakerNumber: 1, speakerColorIndex: 1, speakerLabel: '说话人 10', isSelf: false, isBackground: false, text: '测试',
    }
    const markup = renderToStaticMarkup(<RecordingSignalOverview items={[item]} dayStartMillis={dayStartMillis} positionSeconds={4} playing={false} canPlay onToggle={() => {}} onSeek={() => {}} />)
    const overviewTrack = matchStyle(markup, /<div style="([^"]+)" aria-label="24小时录音概览">/)
    const focusTrack = matchStyle(markup, /<div style="([^"]+)" role="slider"[^>]*aria-label="当前录音片段分布，拖动浏览，点击定位"/)
    const focusTrackShell = matchStyle(markup, /<div style="([^"]*margin-top:[^"]+)"><div style="[^"]+" role="slider"/)

    expect(markup).toContain('aria-label="全天录音分布"')
    expect(markup).toContain('aria-label="24小时录音概览"')
    expect(markup).toContain('aria-label="当前录音片段分布，拖动浏览，点击定位"')
    expect(markup).toContain('aria-label="拖动全天缩略导航"')
    expect(markup).toContain('aria-label="缩小时间轴"')
    expect(markup).toContain('aria-label="放大时间轴"')
    expect(markup).toContain('>滚轮缩放<')
    expect(markup).toContain('data-arkme-recording-visible-millis="1500000"')
    expect(overviewTrack.get('height')).toBe('10px')
    expect(overviewTrack.get('background')).toBe('var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, #f5f6f8))')
    expect(focusTrack.get('height')).toBe('22px')
    expect(focusTrack.get('background')).toBe('var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, #f5f6f8))')
    expect(focusTrackShell.get('margin-top')).toBe('15px')
    expect(markup).toContain('aria-label="说话人图例"')
    expect(markup).toContain('>说话人 10<')
    expect(markup).toContain('background:#799eff')
    expect(markup).toContain('background:var(--dsw-alias-state-business-primary, #3964fe)')
    expect(markup).toContain('data-arkme-recording-playhead="interactive"')
    expect(markup).toContain('aria-label="播放当前录音"')
    expect(markup).toContain('>15:05:40<span')
    expect(markup).not.toContain('全天录音演示进度')
  })

  it('shows the client-shaped centered expand arrow when the timeline is collapsed', () => {
    const dayStartMillis = new Date(2026, 7, 21).getTime()
    const item: ArkmeRecordingTranscriptItem = {
      itemId: 'segment', sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system',
      startAtMillis: dayStartMillis + 15 * 3_600_000 + 5 * 60_000,
      endAtMillis: dayStartMillis + 15 * 3_600_000 + 8 * 60_000,
      speakerNumber: 1, speakerColorIndex: 1, speakerLabel: '说话人 10', isSelf: false, isBackground: false, text: '测试',
    }

    const markup = renderToStaticMarkup(<recordingSurface.RecordingSignalOverview
      items={[item]}
      dayStartMillis={dayStartMillis}
      positionSeconds={4}
      playing={false}
      canPlay
      expanded={false}
      onToggle={() => {}}
      onSeek={() => {}}
      onExpand={() => {}}
    />)

    expect(markup).toContain('data-arkme-recording-expanded="false"')
    expect(markup).toContain('data-arkme-recording-overview-expand="client"')
    expect(markup).toContain('aria-label="展开完整时间轴"')
    expect(markup).toContain('viewBox="0 0 24 5"')
    expect(markup).toContain('d="M1 1L12 4L23 1.135"')
    expect(markup).not.toContain('aria-label="24小时录音概览"')
    expect(markup).not.toContain('aria-label="说话人图例"')
  })

  it('matches the client speaker distribution totals and compact duration labels', () => {
    const dayStartMillis = new Date(2026, 7, 21).getTime()
    const addSpeakerItems = (speaker: number, colorIndex: number, count: number, durationMillis: number): ArkmeRecordingTranscriptItem[] => {
      const baseDuration = Math.floor(durationMillis / count)
      let remainder = durationMillis - baseDuration * count
      return Array.from({ length: count }, (_, index) => {
        const itemDuration = baseDuration + (remainder > 0 ? 1 : 0)
        remainder = Math.max(0, remainder - 1)
        const startAtMillis = dayStartMillis + 15 * 3_600_000 + index * 20_000 + colorIndex * 1_000
        return {
          itemId: `${String(speaker)}-${String(index)}`,
          sessionId: 'session', childId: 'child', asrItemIndex: index, transcriptSource: 'system',
          startAtMillis, endAtMillis: startAtMillis + itemDuration,
          speakerNumber: speaker, speakerColorIndex: colorIndex, speakerLabel: `说话人 ${String(speaker)}`,
          isSelf: false, isBackground: false, text: '测试',
        }
      })
    }
    const items = [
      ...addSpeakerItems(9, 0, 13, 89_000),
      ...addSpeakerItems(10, 1, 57, 855_000),
      ...addSpeakerItems(11, 2, 2, 5_000),
      ...addSpeakerItems(12, 3, 10, 22_000),
      ...addSpeakerItems(13, 4, 5, 22_000),
    ]
    const distributions = recordingSurface.recordingSpeakerDistributions(items)

    expect(distributions.map(value => [value.label, value.itemCount, recordingSurface.recordingDistributionDurationLabel(value.durationMillis)])).toEqual([
      ['说话人 10', 57, '14m15s'],
      ['说话人 9', 13, '1m29s'],
      ['说话人 12', 10, '22s'],
      ['说话人 13', 5, '22s'],
      ['说话人 11', 2, '5s'],
    ])
    expect(distributions.map(value => value.percentage.toFixed(1))).toEqual(['86.1', '9.0', '2.2', '2.2', '0.5'])
    expect(recordingSurface.recordingTranscriptDurationLabel({ startAtMillis: 1_000, endAtMillis: 16_000 })).toBe('15秒')

    const markup = renderToStaticMarkup(<recordingSurface.RecordingSignalOverview items={items} dayStartMillis={dayStartMillis} positionSeconds={4} playing={false} canPlay onToggle={() => {}} onSeek={() => {}} />)
    expect(markup).toContain('aria-label="展开完整说话人分布"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>+1</span>')
    expect(markup).not.toContain('data-arkme-recording-speaker-distribution="expanded"')
  })

  it('turns an empty recording day into three actionable next steps', () => {
    const RecordingEmptyActions = (recordingSurface as unknown as {
      RecordingEmptyActions?: ComponentType
    }).RecordingEmptyActions
    expect(RecordingEmptyActions).toBeDefined()
    if (RecordingEmptyActions === undefined) return

    const markup = renderToStaticMarkup(<RecordingEmptyActions />)
    const buttonStyle = matchStyle(markup, /<button type="button" style="([^"]+)"[^>]*>.*?绑定即我随身录/)
    expect(markup).toContain('aria-label="全天候录音操作"')
    expect(markup).toContain('>绑定即我随身录<')
    expect(markup).toContain('>导入历史音频<')
    expect(markup).toContain('>手动录音<')
    expect(markup).toContain('accept="audio/*"')
    expect(buttonStyle.get('font-size')).toBe('14px')
    expect(buttonStyle.get('font-weight')).toBe('500')
    expect(buttonStyle.get('line-height')).toBe('16px')
    expect(buttonStyle.get('gap')).toBe('8px')
    expect(buttonStyle.get('padding')).toBe('10px 12px')
    expect(buttonStyle.get('white-space')).toBe('nowrap')
    expect(markup).toContain('flex-wrap:nowrap')
  })
})
