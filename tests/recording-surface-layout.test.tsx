import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
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
  it('keeps the desktop workbench behavior while allowing the DSH layout to adapt', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)

    expect(root.get('overflow')).toBe('hidden')
    expect(markup).toContain('aria-label="上个月"')
    expect(markup).toContain('aria-label="下个月"')
    expect(markup).toContain('>回到今日</button>')
    expect(markup).not.toContain('展开月历')
    expect(markup).toContain('>导入历史音频<')
    expect(markup).toContain('时间轴')
    expect(markup).toContain('总结')
    expect(markup).toContain('转写')
    expect(markup.indexOf('>转写</button>')).toBeLessThan(markup.indexOf('>总结</button>'))
    expect(markup.indexOf('>总结</button>')).toBeLessThan(markup.indexOf('>时间轴</button>'))
    expect(markup).toContain('aria-current="page"')
  })

  it('uses the compact desktop tab indicator instead of a full-width browser tab border', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain("tabSlot: { width: 115")
    expect(source).toContain('tabIndicator: { position: \'absolute\'')
    expect(source).toContain('width: 10, height: 2')
    expect(source).not.toContain("borderBottom: '2px solid transparent'")
  })

  it('uses desktop-owned month and year menus instead of native selects that escape the host layer', async () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(markup).toContain('aria-label="选择月份"')
    expect(markup).toContain('aria-label="选择年份"')
    expect(source).toContain('function RecordingCalendarDropdown')
    expect(source).toContain('interface RecordingCalendarDropdownAnchor')
    expect(source).toContain('useState<RecordingCalendarDropdownAnchor>()')
    expect(source).not.toContain('<select aria-label="月份"')
    expect(source).not.toContain('<select aria-label="年份"')
  })

  it('keeps one responsive presentation without changing the recording business owner', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    expect(markup).toContain('data-arkme-recording-layout="wide"')
    expect(recordingSurface).toHaveProperty('recordingWorkbenchLayoutMode')
    expect(markup).toContain('grid-template-columns:repeat(7,minmax(0,1fr))')
  })

  it('remounts the complete recording workbench when the authenticated account changes', async () => {
    const sidebarSource = await readFile(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')

    expect(sidebarSource).toContain("<ArkmeRecordingSurface key={`recordings:${auth?.status ?? 'unknown'}:${auth?.environment ?? 'unknown'}:${String(auth?.userId ?? 0)}`} />")
  })

  it('uses the existing Arkme theme owner instead of hard-coded light-only colors', async () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')
    const timelineSource = await readFile(new URL('../src/client/recordings/ArkmeRecordingTimeline.tsx', import.meta.url), 'utf8')
    const importSource = await readFile(new URL('../src/client/recordings/ArkmeRecordingImportDialog.tsx', import.meta.url), 'utf8')
    const speakerSource = await readFile(new URL('../src/client/recordings/ArkmeRecordingSpeakerEditor.tsx', import.meta.url), 'utf8')

    expect(source).toContain("import { arkmeTheme } from './arkme-theme.js'")
    expect(source).toContain('base: arkmeTheme.base')
    expect(source).not.toContain("base: '#ffffff'")
    for (const childSource of [timelineSource, importSource, speakerSource]) {
      expect(childSource).toContain('arkmeTheme')
      expect(childSource).not.toContain("base: '#ffffff'")
      expect(childSource).not.toContain("background: '#ffffff'")
    }
    expect(importSource).toContain("overflowX: 'auto'")
  })

  it('keeps the whole-month calendar open with a return-to-today action and future dates disabled', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('calendarExpanded')
    expect(source).toContain('>回到今日</button>')
    expect(source).toContain("const canJumpToday = dateKey(selectedDate) !== dateKey(today)")
    expect(source).toContain('disabled={future}')
  })

  it('uses Flutter-style daily recording duration labels without a calendar shadow', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(recordingSurface.recordingCalendarDuration(36 * 60_000)).toBe('0.6h')
    expect(recordingSurface.recordingCalendarDuration(90 * 60_000)).toBe('1.5h')
    expect(source).toContain('monthDurationBrief: { background: colors.warningSoft, color: colors.warning }')
    expect(source).toContain('meta.durationMillis <= 60 * 60 * 1_000 ? styles.monthDurationBrief')
    expect(source).not.toMatch(/calendar: \{[^}]*boxShadow/)
  })

  it('keeps the page fixed and scrolls only the recording analysis pane', async () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(root.get('overflow')).toBe('hidden')
    expect(source).toContain("pane: { minWidth: 0, minHeight: 0")
    expect(source).toContain("overflowY: 'auto', overscrollBehavior: 'contain'")
  })

  it('clamps the retained month when switching back to the current year', () => {
    const { recordingMonthForYearChange } = recordingSurface as typeof recordingSurface & {
      recordingMonthForYearChange(value: Date, targetYear: number, today: Date): Date
    }

    expect(recordingMonthForYearChange(new Date(2025, 11, 1), 2026, new Date(2026, 7, 31)))
      .toEqual(new Date(2026, 7, 1))
    expect(recordingMonthForYearChange(new Date(2025, 11, 1), 2024, new Date(2026, 7, 31)))
      .toEqual(new Date(2024, 11, 1))
  })

  it('stops previous-month navigation at the desktop 1970-01 lower bound', () => {
    const { recordingCanGoPreviousMonth } = recordingSurface as typeof recordingSurface & {
      recordingCanGoPreviousMonth(value: Date): boolean
    }

    expect(recordingCanGoPreviousMonth(new Date(1970, 0, 1))).toBe(false)
    expect(recordingCanGoPreviousMonth(new Date(1970, 1, 1))).toBe(true)
    expect(recordingCanGoPreviousMonth(new Date(2026, 7, 1))).toBe(true)
  })

  it('never turns speaker emphasis into a transcript data filter', () => {
    const { recordingFocusedItems } = recordingSurface as typeof recordingSurface & {
      recordingFocusedItems(items: Array<{ speakerKey: string; isBackground: boolean }>, focusedSpeakerKey?: string): {
        focusedSpeakerKey?: string
        items: Array<{ speakerKey: string; isBackground: boolean }>
      }
    }
    const items = [{ speakerKey: 'speaker:a', isBackground: false }, { speakerKey: 'speaker:b', isBackground: false }]

    expect(recordingFocusedItems(items, 'speaker:a')).toEqual({ focusedSpeakerKey: 'speaker:a', items })
    expect(recordingFocusedItems(items, 'speaker:removed')).toEqual({ items })
  })

  it('does not add per-transcript playback actions that do not exist on desktop', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain("'播放片段'")
    expect(source).not.toContain("'暂停片段'")
    expect(source).not.toContain("'继续播放'")
    expect(source).not.toContain('transcriptActions')
    expect(source).toContain('onDoubleClick={() => { setSelectedTimelineMillis(item.startAtMillis) }}')
  })

  it('keeps the 146px desktop timeline container for the three timeline layers', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')
    const timelineSource = await readFile(new URL('../src/client/recordings/ArkmeRecordingTimeline.tsx', import.meta.url), 'utf8')

    expect(source).toContain("gridTemplateRows: '146px minmax(0,1fr)'")
    expect(timelineSource).toContain('height: 146')
    expect(timelineSource).toContain("gridTemplateRows: '25px minmax(0,1fr) 28px'")
  })

  it('uses the desktop empty illustration instead of tabs and the legacy placeholder track', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')
    const EmptyState = (recordingSurface as typeof recordingSurface & {
      ArkmeRecordingEmptyState: ComponentType
    }).ArkmeRecordingEmptyState
    const markup = renderToStaticMarkup(<EmptyState />)

    expect(markup).toContain('aria-label="暂无转写内容"')
    expect(markup).toContain('width="186"')
    expect(markup).toContain('height="133"')
    expect(markup).toContain('暂无转写内容，快去录音吧！')
    expect(markup).not.toContain('>转写</button>')
    expect(source).not.toContain('<div style={styles.track} aria-label="当天录音时间轴">')
    expect(source).toContain("const emptyDay = !dayLoading && dayError === '' && day?.transcript.state === 'empty'")
    expect(source).toContain('{emptyDay ? <ArkmeRecordingEmptyState />')
  })

  it('uses desktop empty panels for summary and analysis timeline without inventing generation actions', () => {
    const EmptyState = (recordingSurface as typeof recordingSurface & {
      ArkmeRecordingAnalysisEmptyState: ComponentType<{ kind: 'summary' | 'timeline'; state: 'empty' | 'processing' | 'failed' }>
    }).ArkmeRecordingAnalysisEmptyState

    const summary = renderToStaticMarkup(<EmptyState kind="summary" state="empty" />)
    const summaryLoading = renderToStaticMarkup(<EmptyState kind="summary" state="processing" />)
    const timelineFailure = renderToStaticMarkup(<EmptyState kind="timeline" state="failed" />)

    for (const markup of [summary, summaryLoading, timelineFailure]) {
      expect(markup).toContain('width="186"')
      expect(markup).toContain('height="133"')
      expect(markup).not.toContain('>点击生成')
    }
    expect(summary).toContain('暂无总结内容')
    expect(summaryLoading).toContain('生成总结中...')
    expect(timelineFailure).toContain('时间轴生成失败')
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
