import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { readFile } from 'node:fs/promises'
import type { ArkmeRecordingCalendarDay } from '../src/types.js'
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
  it('uses the updated Demo two-column recording browser and analysis layout', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)

    expect(root.get('grid-template-columns')).toBe('326px minmax(0,1fr)')
    expect(markup).toContain('aria-label="上个月"')
    expect(markup).toContain('aria-label="下个月"')
    expect(markup).toContain('aria-label="展开整月日历"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>展开月历<')
    expect(markup).toContain('>当天时间轴<')
    expect(markup).toContain('>转写</button>')
    expect(markup).toContain('>总结</button>')
    expect(markup).toContain('>时间轴</button>')
  })

  it('provides a whole-month calendar expansion with future dates disabled', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain("const [calendarExpanded, setCalendarExpanded] = useState(false)")
    expect(source).toContain('calendarExpanded ? <>')
    expect(source).toContain("aria-label={calendarExpanded ? '收起整月日历' : '展开整月日历'}")
    expect(source).toContain('disabled={future}')
  })

  it('keeps the page fixed and scrolls only the recording analysis pane', async () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(root.get('overflow')).toBe('hidden')
    expect(source).toContain("pane: { minWidth: 0, minHeight: 0")
    expect(source).toContain("overflowY: 'auto', overscrollBehavior: 'contain'")
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

  it('keeps compact fixed rows so calendar dates stay aligned', () => {
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
    expect(cell.get('grid-template-rows')).toBe('18px 18px')
    expect(cell.get('height')).toBe('53px')
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
})
