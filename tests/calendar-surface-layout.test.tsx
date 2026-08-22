import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeCalendarCell, ArkmeCalendarSurface } from '../src/client/ArkmeCalendarSurface.js'

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
    expect(cell.get('display')).toBe('grid')
    expect(cell.get('align-content')).toBe('center')
    expect(cell.get('gap')).toBe('3px')
    expect(cell.get('height')).toBe('45px')
    expect(cell.get('border-color')).toBe('var(--dsw-alias-button-primary-fill, #17191c)')
    expect(cell.get('background')).toBe('var(--dsw-alias-button-primary-fill, #17191c)')
  })

  it('does not show a numeric marker for empty days', () => {
    const markup = renderToStaticMarkup(<ArkmeCalendarCell
      date={new Date(2026, 7, 22)}
      selected={false}
      disabled={false}
      onClick={() => {}}
    />)

    expect(markup).toContain('>22<')
    expect(markup).not.toContain('>0<')
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
})
