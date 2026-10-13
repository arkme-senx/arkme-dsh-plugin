import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { ArkmeCalendarLunarDate, formatCalendarLunarDate } from '../src/client/ArkmeCalendarLunarDate.js'
import { connectArkmeLocale } from '../src/client/locale.js'

let view: ReactTestRenderer | undefined
afterEach(() => { act(() => view?.unmount()); view = undefined })

it.each([
  ['2026-10-20', '农历九月十一'],
  ['2026-02-17', '农历正月初一'],
  ['2025-07-25', '农历闰六月初一'],
])('converts the selected civil date including new year and leap month: %s', (date, expected) => {
  expect(formatCalendarLunarDate(date, 'zh')).toBe(expected)
  expect(formatCalendarLunarDate(date, 'en')).toBe('')
})

it.each(['2026-02-30', 'invalid', '2026-13-01'])('does not show a fabricated lunar date for %s', date => {
  expect(formatCalendarLunarDate(date, 'zh')).toBe('')
})

it('updates immediately on language and selected-date changes without an orphan separator', async () => {
  let active = 'zh', changed = () => {}
  const stop = connectArkmeLocale({getLocale:()=>({active}),subscribe:listener=>{changed=listener;return()=>{}}})
  try {
    await act(async () => { view = create(<ArkmeCalendarLunarDate date="2026-10-20" />) })
    expect(JSON.stringify(view!.toJSON())).toContain('农历九月十一')
    await act(async () => { active = 'en'; changed() })
    expect(view!.toJSON()).toBeNull()
    await act(async () => { active = 'zh'; changed(); view!.update(<ArkmeCalendarLunarDate date="2026-02-17" />) })
    expect(JSON.stringify(view!.toJSON())).toContain('农历正月初一')
  } finally { act(() => { active='zh'; changed() }); stop() }
})
