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
  it('uses the updated Demo two-column recording browser and analysis layout', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const root = matchStyle(markup, /^<div style="([^"]+)"/)

    expect(root.get('grid-template-columns')).toBe('384px minmax(0,1fr)')
    expect(markup).toContain('aria-label="上个月"')
    expect(markup).toContain('aria-label="下个月"')
    expect(markup).toContain('>回到今日</button>')
    expect(markup).not.toContain('展开月历')
    expect(markup).toContain('>当天时间轴<')
    expect(markup).toContain('>转写</button>')
    expect(markup).toContain('>总结</button>')
    expect(markup).toContain('>时间轴</button>')
  })

  it('adapts the workbench into compact and stacked layouts without clipping the calendar', () => {
    expect(recordingSurface.recordingWorkbenchLayoutMode(1_280)).toBe('wide')
    expect(recordingSurface.recordingWorkbenchLayoutMode(820)).toBe('compact')
    expect(recordingSurface.recordingWorkbenchLayoutMode(640)).toBe('stacked')

    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    expect(markup).toContain('data-arkme-recording-layout="wide"')
  })

  it('uses semantic DSH colors across the recording page', async () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSurface />)
    const source = await readFile(new URL('../src/client/ArkmeRecordingSurface.tsx', import.meta.url), 'utf8')

    expect(markup).toContain('background:var(--dsw-alias-bg-base, #ffffff)')
    expect(markup).toContain('background:var(--dsw-alias-bg-layer-1, #f8f9fa)')
    expect(markup).not.toContain('background:#fff')
    expect(markup).not.toContain('background:#fcfcfd')
    expect(source).toMatch(/daySelected: \{[^}]*background: colors\.primaryAction, color: colors\.onPrimaryAction/)
    expect(source).toMatch(/recordingRow: \{[^}]*background: colors\.layer2/)
    expect(source).toMatch(/trackSegment: \{[^}]*background: colors\.text/)
    expect(source).toMatch(/event: \{[^\n]*background: colors\.layer1/)
    expect(source).not.toContain("selected ? { background: '#fff' }")
    expect(source).toContain('selected ? styles.selectedMonthDuration')
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
    expect(source).toContain("monthDurationBrief: { background: '#f5e4e2', color: '#9d331a' }")
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
