import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeCalendarCell,
  ArkmeCalendarSurface,
  arkmeCalendarRecordIsDSHAgentInput,
  arkmeCalendarRecordSourceLabel,
} from '../src/client/ArkmeCalendarSurface.js'

const surfaceSource = readFileSync(new URL('../src/client/ArkmeCalendarSurface.tsx', import.meta.url), 'utf8')

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

describe('ArkmeCalendarSurface layout', () => {
  it('renders record counts under the date and keeps the selected cell stable', () => {
    const markup = renderToStaticMarkup(<ArkmeCalendarCell
      date={new Date(2026, 7, 21)}
      meta={{ bucketDate: '2026-08-21', count: 41, protectedCount: 0, hasRecords: true }}
      selected
      disabled={false}
      onClick={() => {}}
    />)
    const cell = matchStyle(markup, /^<button[^>]*style="([^"]+)"/)

    expect(markup).toContain('>21<')
    expect(markup).toContain('>41<')
    expect(markup).toContain('data-selected="true"')
    expect(cell.get('display')).toBe('grid')
    expect(cell.get('align-content')).toBe('center')
    expect(cell.get('gap')).toBe('3px')
    expect(cell.get('height')).toBe('45px')
    expect(cell.get('border-color')).toBe('var(--dsw-alias-button-primary-fill, #17191c)')
    expect(cell.get('background')).toBe('var(--dsw-alias-button-primary-fill, #17191c)')
    expect(cell.get('transition')).toBe('background 120ms ease, border-color 120ms ease, color 120ms ease')
  })

  it('keeps the record badge geometry and transition stable while selection changes', () => {
    const renderCount = (selected: boolean) => {
      const markup = renderToStaticMarkup(<ArkmeCalendarCell
        date={new Date(2026, 7, 21)}
        meta={{ bucketDate: '2026-08-21', count: 41, protectedCount: 0, hasRecords: true }}
        selected={selected}
        disabled={false}
        onClick={() => {}}
      />)
      return matchStyle(markup, /<span style="([^"]+)">41<\/span>/)
    }
    const unselectedCount = renderCount(false)
    const selectedCount = renderCount(true)

    for (const count of [unselectedCount, selectedCount]) {
      expect(count.get('min-width')).toBe('15px')
      expect(count.get('padding')).toBe('0 4px')
      expect(count.get('transition')).toBe('background 120ms ease, color 120ms ease')
    }
    expect(selectedCount.get('background')).toBe('transparent')
    expect(selectedCount.get('opacity')).toBe('1')
  })

  it('does not show a numeric marker for empty days', () => {
    const markup = renderToStaticMarkup(<ArkmeCalendarCell
      date={new Date(2026, 7, 22)}
      selected={false}
      disabled={false}
      onClick={() => {}}
    />)

    expect(markup).toContain('>22<')
    expect(markup).toContain('data-selected="false"')
    expect(markup).not.toContain('>0<')
  })

  it('keeps the unselected border color explicit after a selected date changes', () => {
    const markup = renderToStaticMarkup(<ArkmeCalendarCell
      date={new Date(2026, 7, 22)}
      meta={{ bucketDate: '2026-08-22', count: 301, protectedCount: 0, hasRecords: true }}
      selected={false}
      disabled={false}
      onClick={() => {}}
    />)
    const cell = matchStyle(markup, /^<button[^>]*style="([^"]+)"/)

    expect(cell.get('border-width')).toBe('1px')
    expect(cell.get('border-style')).toBe('solid')
    expect(cell.get('border-color')).toBe('transparent')
  })

  it('anchors the popup beside the product rail without dimming the conversation', () => {
    const markup = renderToStaticMarkup(<ArkmeCalendarSurface anchor="product-rail" />)
    const backdrop = matchStyle(markup, /<button type="button" style="([^"]+)" aria-label="关闭日历"/)
    const card = matchStyle(markup, /<section style="([^"]+)" aria-label="客户端日历"/)

    expect(backdrop.get('background')).toBe('transparent')
    expect(backdrop.get('backdrop-filter')).toBe('none')
    expect(card.get('left')).toBe('12px')
    expect(card.get('top')).toBe('88px')
  })

  it('labels only DSH Agent input records distinctly in the calendar', () => {
    const item = {
      recordUid: 'record-dsh',
      sendAtMillis: 1,
      accessState: 'available',
      title: '',
      textContent: '你好',
      preview: '你好',
      sourceKind: 'self',
      creationSource: 3,
      templateKind: 1,
      displayKind: 0,
      protected: false,
      isUncategorized: true,
    } as const

    expect(arkmeCalendarRecordSourceLabel(item)).toBe('DSH Agent 输入')
    expect(arkmeCalendarRecordIsDSHAgentInput(item)).toBe(true)
    expect(surfaceSource).toContain('function DeepSeekLogoMark()')
    expect(surfaceSource).toContain('fill="currentColor"')
  })

  it('keeps ordinary and Agent-created records without a DSH calendar source label', () => {
    const ordinary = {
      recordUid: 'record-ordinary',
      sendAtMillis: 1,
      accessState: 'available',
      title: '',
      textContent: '测试',
      preview: '测试',
      sourceKind: 'self',
      creationSource: 0,
      templateKind: 1,
      displayKind: 0,
      protected: false,
      isUncategorized: true,
    } as const
    const agentCreated = { ...ordinary, recordUid: 'record-agent', creationSource: 1 } as const

    expect(arkmeCalendarRecordSourceLabel(ordinary)).toBe('')
    expect(arkmeCalendarRecordIsDSHAgentInput(ordinary)).toBe(false)
    expect(arkmeCalendarRecordSourceLabel(agentCreated)).toBe('')
    expect(arkmeCalendarRecordIsDSHAgentInput(agentCreated)).toBe(false)
  })

  it('refreshes open calendar data when the shared record projection changes', () => {
    expect(surfaceSource).toContain('useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)')
    expect(surfaceSource).toContain('}, [timezone, visibleMonth, ui.chatRevision])')
    expect(surfaceSource).toContain('}, [selectedDate, timezone, ui.chatRevision])')
  })
})
