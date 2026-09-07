import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: mocks.callArkme,
}))

import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import type { ArkmeRecordingDay } from '../src/types.js'

function recordingDay(dateStamp: number, text: string): ArkmeRecordingDay {
  return {
    dateStamp, totalDurationMillis: 5_000,
    transcript: {
      state: 'ready', message: '', totalDurationMillis: 5_000, processingCount: 0,
      items: [{
        itemId: text, itemRef: text, startAtMillis: dateStamp + 1_000, endAtMillis: dateStamp + 6_000,
        speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 0, speakerLabel: '说话人',
        sameSpeakerItemCount: 1, isSelf: false, isBackground: false, text,
      }],
    },
    summary: { state: 'empty', message: '', items: [] },
    timeline: { state: 'empty', message: '', items: [] },
  }
}

describe('recording calendar selection', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 4, 12))
    mocks.callArkme.mockReset()
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    vi.useRealTimers()
  })

  it('keeps the browsed month distinct from the selected date and import date', async () => {
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: params.fromStamp, toStamp: params.toStamp, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation === 'recordings.day') return recordingDay(params.dateStamp, '当前录音')
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    const onOpenRecordingImport = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={onOpenRecordingImport} recordingRefreshRevision={0} />)
    })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '上个月' }).props.onClick() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.day')).toHaveLength(1)
    expect(renderer.root.findAll(node => node.type === 'button' && node.props['aria-pressed'] === true)).toHaveLength(0)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '8月31日' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '8月31日' }).props['aria-pressed']).toBe(true)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '下个月' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '9月4日' }).props['aria-pressed']).toBe(false)
    const importButton = renderer.root.findAll(node => node.type === 'button' && node.children.includes('导入历史音频'))[0]!
    await act(async () => { importButton.props.onClick() })
    expect(onOpenRecordingImport).toHaveBeenLastCalledWith(new Date(2026, 7, 31).getTime())
    await act(async () => { renderer.root.findByProps({ 'aria-label': '9月3日' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '9月4日' }).props.style.borderColor).toBe('transparent')
    await act(async () => { importButton.props.onClick() })
    expect(onOpenRecordingImport).toHaveBeenLastCalledWith(new Date(2026, 8, 3).getTime())
    const tab = (label: string) => renderer.root.findAll(node => node.type === 'button' && node.children.includes(label))[0]!
    await act(async () => { tab('总结').props.onClick() })
    await act(async () => { tab('转写').props.onClick() })
    expect(tab('转写').props['aria-current']).toBe('page')
    expect(JSON.stringify(renderer.toJSON())).toContain('当前录音')
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.day').map(([, params]) => params.dateStamp))
      .toEqual([new Date(2026, 8, 4).getTime(), new Date(2026, 7, 31).getTime(), new Date(2026, 8, 3).getTime()])
  })

  it.each(['resolve', 'reject'] as const)('ignores a superseded date request that later completes with %s', async completion => {
    let resolveOld!: (value: ArkmeRecordingDay) => void
    let rejectOld!: (error: Error) => void
    const oldDay = new Promise<ArkmeRecordingDay>((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
    const todayStamp = new Date(2026, 8, 4).getTime()
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation === 'recordings.day') return params.dateStamp === todayStamp ? await oldDay : recordingDay(params.dateStamp, '新日期内容')
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
    })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '9月3日' }).props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('新日期内容')
    await act(async () => {
      if (completion === 'resolve') resolveOld(recordingDay(todayStamp, '旧日期内容'))
      else rejectOld(new Error('旧日期错误'))
    })
    const rendered = JSON.stringify(renderer.toJSON())
    expect(rendered).toContain('新日期内容')
    expect(rendered).not.toContain('旧日期内容')
    expect(rendered).not.toContain('旧日期错误')
    expect(renderer.root.findByProps({ 'aria-label': '9月3日' }).props['aria-pressed']).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '9月4日' }).props.style.borderColor).toBe('transparent')
  })

  it.each(['loading', 'failed'] as const)('clears previous borders and allows date changes while details are %s', async state => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation === 'recordings.day') {
        if (state === 'failed') throw new Error('录音读取失败')
        return await new Promise(() => {})
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    const onOpenRecordingImport = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={onOpenRecordingImport} recordingRefreshRevision={0} />)
    })
    if (state === 'loading') {
      expect(renderer.root.findByProps({ 'aria-label': '转写加载中' })).toBeDefined()
    } else {
      expect(renderer.root.findAll(node => node.props.role === 'alert' && node.children.includes('录音读取失败'))).toHaveLength(1)
    }
    const dates = () => renderer.root.findAll(node => node.type === 'button' && typeof node.props['aria-pressed'] === 'boolean')
    const date = (day: number) => renderer.root.findByProps({ 'aria-label': `9月${String(day)}日` })
    const today = date(4)
    const expectSelection = (day: number) => {
      expect(dates().filter(node => node.props['aria-pressed'])).toEqual([date(day)])
      for (const node of dates()) {
        if (!node.props['aria-pressed']) expect(node.props.style.borderColor).toBe('transparent')
      }
      expect(date(day).props.style.borderColor).not.toBe('transparent')
      expect(date(day).props.disabled).toBe(false)
      expect(date(5).props.disabled).toBe(true)
    }
    for (const day of [3, 2, 3]) {
      await act(async () => { date(day).props.onClick() })
      expectSelection(day)
      expect(date(4)).toBe(today)
    }
    const returnToday = renderer.root.findAll(node => node.type === 'button' && node.children.includes('回到今日'))[0]!
    await act(async () => { returnToday.props.onClick() })
    expectSelection(4)
    expect(returnToday.props.disabled).toBe(true)
    expect(onOpenRecordingImport).not.toHaveBeenCalled()
    const dayReads = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.day')
    expect(dayReads.map(([, params]) => params.dateStamp)).toEqual([4, 3, 2, 3, 4].map(day => new Date(2026, 8, day).getTime()))
    expect(dayReads.slice(0, -1).every(([, , signal]) => signal.aborted)).toBe(true)
    expect([...new Set(mocks.callArkme.mock.calls.map(([operation]) => operation))].sort())
      .toEqual(['recordings.calendar', 'recordings.day', 'recordings.summary-model-config'])
  })
})
