import React from 'react'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { useStatistics } from '../src/client/statistics/use-statistics.js'
import type { StatisticsDetail, StatisticsQuery } from '../src/statistics-contract.js'
import { ArkmeUiController } from '../src/client/ui-controller.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/read-deadline.js', () => ({ withArkmeReadDeadline: (fn: (signal: AbortSignal) => unknown, signal: AbortSignal) => fn(signal) }))
describe('statistics client navigation and races', () => {
  it('discards a slow response from the previous month', async () => {
    const pending: Array<(value: unknown) => void> = []
    call.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    let state: ReturnType<typeof useStatistics<StatisticsDetail>>
    const q: StatisticsQuery = { accountScope: 'prod:7', fromStamp: 0, toStamp: 1000, timezoneOffsetMinutes: 480 }
    function View({ query }: { query: StatisticsQuery }) { state = useStatistics('detail', query, true, 0); return null }
    let tree: ReturnType<typeof create>
    await act(async () => { tree = create(<View query={q}/>) })
    await act(async () => { tree!.update(<View query={{ ...q, fromStamp: 500 }}/>) })
    await act(async () => { pending[1]!({ recordCount: 20 }) })
    expect(state!.value?.recordCount).toBe(20)
    await act(async () => { pending[0]!({ recordCount: 100 }) })
    expect(state!.value?.recordCount).toBe(20)
    await act(async () => tree!.unmount())
  })
  it('navigates from a calendar month to statistics, and back to an exact date', () => {
    const ui = new ArkmeUiController(); ui.showCalendar(); ui.showStatistics('2026-09')
    expect(ui.getViewSnapshot()).toMatchObject({ mode: 'statistics', statisticsMonth: '2026-09' })
    expect(ui.getViewSnapshot().calendarOpen).toBeUndefined()
    ui.openCalendarDate('2026-09-08')
    expect(ui.getViewSnapshot()).toMatchObject({ calendarOpen: true, calendarInitialDate: '2026-09-08' })
    ui.hideCalendar(); expect(ui.getViewSnapshot().mode).toBe('statistics')
    expect(ui.getViewSnapshot().calendarInitialDate).toBeUndefined()
    ui.showCalendar()
    expect(ui.getViewSnapshot()).toMatchObject({ calendarOpen: true })
    expect(ui.getViewSnapshot().calendarInitialDate).toBeUndefined()
  })
  it('clears a heatmap date when the regular calendar button toggles it closed or opens after navigation', () => {
    const ui = new ArkmeUiController()
    ui.openCalendarDate('2026-09-08')
    ui.showCalendar()
    expect(ui.getViewSnapshot().calendarInitialDate).toBeUndefined()
    ui.openCalendarDate('2026-09-09')
    ui.showStatistics()
    ui.showCalendar()
    expect(ui.getViewSnapshot()).toMatchObject({ calendarOpen: true })
    expect(ui.getViewSnapshot().calendarInitialDate).toBeUndefined()
  })
})
