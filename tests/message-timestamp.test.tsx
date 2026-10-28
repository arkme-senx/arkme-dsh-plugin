import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArkmeMessageTimestamp } from '../src/client/ArkmeMessageTimestamp.js'
import { dayKey, dayLabel } from '../src/client/conversation-message-presentation.js'

const originalZone = process.env.TZ
afterEach(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone })

describe('conversation dates and original message times', () => {
  it('shows the exact year for past and future years, including local New Year boundaries', () => {
    process.env.TZ = 'Asia/Shanghai'
    const now = new Date('2026-01-01T00:01:00+08:00').getTime()
    expect(dayLabel(new Date('2024-06-27T14:32:00+08:00').getTime(), now)).toBe('2024年6月27日')
    expect(dayLabel(new Date('2025-12-31T23:59:00+08:00').getTime(), now)).toBe('昨天')
    expect(dayLabel(now, now)).toBe('今天')
    expect(dayLabel(new Date('2027-01-01T00:00:00+08:00').getTime(), now)).toBe('2027年1月1日')
    expect(dayKey(now)).not.toBe(dayKey(new Date('2025-12-31T23:59:00+08:00').getTime()))
  })

  it('keeps the visible clock compact and exposes the complete original instant', () => {
    process.env.TZ = 'Asia/Shanghai'
    const at = new Date('2024-06-27T14:32:09+08:00').getTime()
    const html = renderToStaticMarkup(<ArkmeMessageTimestamp at={at} />)
    expect(html).toContain('>14:32</time>')
    expect(html).toContain('dateTime="2024-06-27T06:32:09.000Z"')
    expect(html).toContain('title="2024/06/27 14:32:09"')
    expect(html).toContain('aria-label="2024/06/27 14:32:09"')
  })

  it('uses the same local date boundary for the separator and message timestamp', () => {
    const at = new Date('2025-12-31T16:30:00Z').getTime()
    const now = new Date('2026-06-01T00:00:00Z').getTime()
    process.env.TZ = 'Asia/Shanghai'
    expect(dayLabel(at, now)).toBe('今年 1月1日')
    expect(renderToStaticMarkup(<ArkmeMessageTimestamp at={at} />)).toContain('2026/01/01 00:30:00')
    process.env.TZ = 'America/New_York'
    expect(dayLabel(at, now)).toBe('2025年12月31日')
    expect(renderToStaticMarkup(<ArkmeMessageTimestamp at={at} />)).toContain('2025/12/31 11:30:00')
  })

  it('uses familiar labels for local days and identifies earlier dates this year', () => {
    process.env.TZ = 'Asia/Shanghai'
    const now = new Date('2026-10-15T00:01:00+08:00').getTime()
    expect(dayLabel(now, now)).toBe('今天')
    expect(dayLabel(new Date('2026-10-14T23:59:00+08:00').getTime(), now)).toBe('昨天')
    expect(dayLabel(new Date('2026-10-13T23:59:00+08:00').getTime(), now)).toBe('前天')
    expect(dayLabel(new Date('2026-06-27T23:59:00+08:00').getTime(), now)).toBe('今年 6月27日')
    expect(dayLabel(new Date('2026-10-16T00:00:00+08:00').getTime(), now)).toBe('今年 10月16日')
  })

  it.each([
    ['2026-03-09T00:01:00-04:00', '2026-03-08T00:01:00-05:00'],
    ['2026-11-02T00:01:00-05:00', '2026-11-01T00:01:00-04:00'],
  ])('compares calendar days across DST: %s', (now, at) => {
    process.env.TZ = 'America/New_York'
    expect(dayLabel(new Date(at).getTime(), new Date(now).getTime())).toBe('昨天')
  })

  it.each([0, -1, NaN, Infinity, 9e15])('does not invent a date for invalid time %s', at => {
    expect(dayLabel(at)).toBe('')
    expect(renderToStaticMarkup(<ArkmeMessageTimestamp at={at} />)).toBe('')
  })
})
