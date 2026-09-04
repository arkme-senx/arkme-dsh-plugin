import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as recordingSurface from '../src/client/ArkmeRecordingSurface.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const { ArkmeRecordingSurface } = recordingSurface
const recordingSurfaceElement = () => <ArkmeRecordingSurface
  onOpenRecordingImport={() => {}}
  recordingRefreshRevision={0}
/>

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
    const markup = renderToStaticMarkup(recordingSurfaceElement())
    const root = matchStyle(markup, /^<div style="([^"]+)"/)

    expect(root.get('overflow')).toBe('hidden')
    expect(markup).toContain('aria-label="上个月"')
    expect(markup).toContain('aria-label="下个月"')
    expect(markup).toContain('>回到今日</button>')
    expect(markup).not.toContain('展开月历')
    expect(markup).toContain('>导入历史音频<')
    expect(markup).toContain('时间轴')
    expect(markup).toContain('总结')
    expect(markup).toContain('>转写<span')
    expect(markup).not.toContain('转写 · 系统')
    expect(markup.indexOf('>转写<span')).toBeLessThan(markup.indexOf('>总结</button>'))
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
    const markup = renderToStaticMarkup(recordingSurfaceElement())
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(markup).toContain('aria-label="选择月份"')
    expect(markup).toContain('aria-label="选择年份"')
    expect(source).toContain('function RecordingCalendarDropdown')
    expect(source).toContain('interface RecordingDropdownAnchor')
    expect(source).toContain('useState<RecordingDropdownAnchor>()')
    expect(source).not.toContain('<select aria-label="月份"')
    expect(source).not.toContain('<select aria-label="年份"')
  })

  it('keeps one responsive presentation without changing the recording business owner', () => {
    const markup = renderToStaticMarkup(recordingSurfaceElement())
    expect(markup).toContain('data-arkme-recording-layout="wide"')
    expect(recordingSurface).toHaveProperty('recordingWorkbenchLayoutMode')
    expect(markup).toContain('grid-template-columns:repeat(7,minmax(0,1fr))')
  })

  it('remounts the complete recording workbench when the authenticated account changes', async () => {
    const sidebarSource = await readFile(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')

    expect(sidebarSource).toContain("key={`recordings:${auth?.status ?? 'unknown'}:${auth?.environment ?? 'unknown'}:${String(auth?.userId ?? 0)}`}")
    expect(sidebarSource).toContain('onOpenRecordingImport={openRecordingImport}')
    expect(sidebarSource).toContain("key={`recording-import:${authenticatedAccountKey ?? 'unknown'}`}")
  })

  it('uses the existing Arkme theme owner instead of hard-coded light-only colors', async () => {
    const markup = renderToStaticMarkup(recordingSurfaceElement())
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
    expect(importSource).toContain("case 'completed': return arkmeTheme.success")
    expect(importSource).toContain("case 'partial': return arkmeTheme.warning")
    expect(importSource).not.toContain("return '#52c41a'")
    expect(importSource).not.toContain("return '#fa8c16'")
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
    const markup = renderToStaticMarkup(recordingSurfaceElement())
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

  it('schedules a local-day refresh at the next midnight', () => {
    const { recordingMillisUntilNextLocalDay } = recordingSurface as typeof recordingSurface & {
      recordingMillisUntilNextLocalDay(value: Date): number
    }

    expect(recordingMillisUntilNextLocalDay(new Date(2026, 7, 31, 23, 59, 59, 500))).toBe(500)
    expect(recordingMillisUntilNextLocalDay(new Date(2026, 7, 31, 0, 0, 0, 0))).toBe(24 * 60 * 60 * 1_000)
  })

  it('does not invent speaker filtering that the desktop speaker bar does not own', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')
    const timelineSource = await readFile(new URL('../src/client/recordings/ArkmeRecordingTimeline.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('focusedSpeakerKey')
    expect(source).not.toContain('speakerFocused')
    expect(timelineSource).not.toContain('onFocusedSpeakerChanged')
    expect(timelineSource).toContain('onEditSpeaker')
  })

  it('does not add per-transcript playback actions that do not exist on desktop', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain("'播放片段'")
    expect(source).not.toContain("'暂停片段'")
    expect(source).not.toContain("'继续播放'")
    expect(source).not.toContain('transcriptActions')
    expect(source).toContain('onDoubleClick={onSelect}')
    expect(source).toContain('onSelect={() => { setSelectedTimelineMillis(item.startAtMillis) }}')
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

  it('uses the desktop empty-panel generation actions and hides them while processing', () => {
    const EmptyState = (recordingSurface as typeof recordingSurface & {
      ArkmeRecordingAnalysisEmptyState: ComponentType<{
        kind: 'summary' | 'timeline'
        state: 'empty' | 'processing' | 'failed'
        onGenerate(): void
      }>
    }).ArkmeRecordingAnalysisEmptyState

    const summary = renderToStaticMarkup(<EmptyState kind="summary" state="empty" onGenerate={() => {}} />)
    const summaryLoading = renderToStaticMarkup(<EmptyState kind="summary" state="processing" onGenerate={() => {}} />)
    const timelineFailure = renderToStaticMarkup(<EmptyState kind="timeline" state="failed" onGenerate={() => {}} />)

    for (const markup of [summary, summaryLoading, timelineFailure]) {
      expect(markup).toContain('width="186"')
      expect(markup).toContain('height="133"')
    }
    expect(summary).toContain('暂无总结内容，')
    expect(summary).toContain('>点击生成总结</button>')
    expect(summaryLoading).toContain('生成总结中...')
    expect(summaryLoading).not.toContain('>点击生成')
    expect(timelineFailure).toContain('时间轴生成失败，')
    expect(timelineFailure).toContain('>点击生成时间轴</button>')
  })

  it('formats transcript timestamps and durations with the desktop contract', () => {
    const surface = recordingSurface as typeof recordingSurface & {
      recordingTranscriptTimeLabel(value: number): string
      recordingTranscriptDurationLabel(startAtMillis: number, endAtMillis: number): string
    }
    const startAtMillis = new Date(2026, 7, 3, 12, 30, 1).getTime()

    expect(surface.recordingTranscriptTimeLabel(startAtMillis)).toBe('12:30:01')
    expect(surface.recordingTranscriptDurationLabel(startAtMillis, startAtMillis + 5_000)).toBe('5秒')
    expect(surface.recordingTranscriptDurationLabel(startAtMillis, startAtMillis + 62_000)).toBe('1分2秒')
    expect(surface.recordingTranscriptDurationLabel(startAtMillis, startAtMillis + 3_720_000)).toBe('1小时2分')
  })

  it('renders each transcript as the desktop inline speaker, content, and trailing-time row', () => {
    type TranscriptRowProps = {
      item: ArkmeRecordingWorkbenchItem
      selected: boolean
      onEditSpeaker(): void
      onSelect(): void
    }
    const TranscriptRow = (recordingSurface as unknown as {
      ArkmeRecordingTranscriptRow?: ComponentType<TranscriptRowProps>
    }).ArkmeRecordingTranscriptRow

    expect(TranscriptRow).toBeDefined()
    if (TranscriptRow === undefined) return

    const startAtMillis = new Date(2026, 7, 3, 12, 30, 1).getTime()
    const markup = renderToStaticMarkup(<TranscriptRow
      item={{
        itemId: 'item-1',
        itemRef: 'sealed-item-1',
        startAtMillis,
        endAtMillis: startAtMillis + 62_000,
        speakerNumber: 16,
        speakerKey: 'speaker:16',
        speakerColorIndex: 0,
        speakerLabel: '说话人 16',
        sameSpeakerItemCount: 3,
        isSelf: false,
        isBackground: false,
        text: '我就是九了。',
      }}
      selected
      onEditSpeaker={() => undefined}
      onSelect={() => undefined}
    />)
    const row = matchStyle(markup, /<li[^>]*style="([^"]+)"/)

    expect(row.get('padding')).toBe('3px')
    expect(row.get('border-radius')).toBe('6px')
    expect(row.get('background')).toContain('--dsw-specific-input-major')
    expect(markup).toContain('aria-label="编辑说话人 说话人 16"')
    expect(markup).toContain('width:16px;height:16px')
    expect(markup).toContain('background:#ec7fa9')
    expect(markup).toContain('width:66px;flex:none;margin-left:4px')
    expect(markup).toContain('font-size:14px;line-height:22px;letter-spacing:.28px')
    expect(markup).toContain('width:88px')
    expect(markup).toContain('font-size:12px;line-height:22px;letter-spacing:.24px')
    expect(markup).toContain('float:right')
    expect(markup).toContain('>12:30:01 1分2秒</time>')
    expect(markup).not.toContain('>背景音<')
  })

  it('keeps long recording days responsive without a ResizeObserver per transcript row', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('new ResizeObserver')
    expect(source).not.toContain('document.createRange()')
    expect(source).toContain("className=\"arkme-recording-transcript-speaker\"")
  })

  it('shows the desktop transcript import-and-transcribe skeleton while the day is loading', () => {
    const markup = renderToStaticMarkup(recordingSurfaceElement())

    expect(markup).toContain('aria-label="转写加载中"')
    expect(markup).toContain('音频文字正在导入&amp;转写中')
    expect(markup).not.toContain('>正在读取…<')
  })

  it('keeps owner ASR processing out of the empty-day branch', async () => {
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain("section.state === 'processing'")
    expect(source).toContain('section.processingCount > 0')
    expect(source).toContain("loading={dayLoading || day?.transcript.state === 'processing'}")
  })
})
