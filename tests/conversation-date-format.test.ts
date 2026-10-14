import { afterEach, expect, it, vi } from 'vitest'
const language = vi.hoisted(() => ({ value: 'zh-CN' }))
vi.mock('../src/client/locale.js', () => ({ arkmeIntlLocale: () => language.value }))
import { formatConversationDate } from '../src/client/conversation-date-format.js'
const options = { time: { hour: '2-digit', minute: '2-digit', hour12: false }, weekday: { weekday: 'short' }, day: { month: '2-digit', day: '2-digit' } } satisfies Record<string, Intl.DateTimeFormatOptions>
const originalZone = process.env.TZ
afterEach(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone; vi.restoreAllMocks() })
it('matches native local dates across locale, midnight, timezone changes and both DST transitions', () => {
  for (const locale of ['zh-CN', 'en-US', 'ja-JP']) {
    language.value = locale
    for (const zone of ['Asia/Shanghai', 'America/New_York', 'America/Lima', 'Asia/Kathmandu', 'Europe/London']) {
      process.env.TZ = zone
      for (const iso of ['2026-01-01T00:15:00Z', '2026-03-08T06:59:00Z', '2026-03-08T07:01:00Z', '2026-07-01T23:55:00Z', '2026-11-01T05:59:00Z', '2026-11-01T06:01:00Z']) {
        const date = new Date(iso)
        for (const kind of ['time', 'weekday', 'day'] as const) {
          expect(formatConversationDate(date, kind)).toBe(new Intl.DateTimeFormat(locale, options[kind]).format(date))
        }
      }
    }
  }
})
it('constructs only three formatters for 3000 labels and replaces them when the locale changes', () => {
  language.value = 'de-DE'
  const Original = Intl.DateTimeFormat
  const constructor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    return new Original(locale, options)
  } as typeof Intl.DateTimeFormat)
  for (let i = 0; i < 1000; i++) for (const kind of ['time', 'weekday', 'day'] as const) formatConversationDate(new Date(1790000000000 + i * 60000), kind)
  expect(constructor).toHaveBeenCalledTimes(3)
  language.value = 'en-US'
  formatConversationDate(new Date(), 'time')
  expect(constructor).toHaveBeenCalledTimes(4)
})
