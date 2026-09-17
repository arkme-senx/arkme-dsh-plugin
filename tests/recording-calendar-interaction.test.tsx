import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: mocks.callArkme,
}))

import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
import type { ArkmeRecordingDailyMetrics, ArkmeRecordingDay } from '../src/types.js'

function inputMetrics(state: 'processing' | 'ready' | 'unavailable' | 'partial', pending = state === 'processing' ? 1 : 0): ArkmeRecordingDailyMetrics {
  return { archiveBytes: 0, archiveState: 'ready', confirmedCount: 0, pendingCount: 0, unknownCount: 0, textCount: 4,
    asrInputState: state, asrInputDurationMillis: state === 'ready' || state === 'partial' ? 6000 : 0,
    asrInputConfirmedCount: state === 'ready' || state === 'partial' ? 1 : 0,
    asrInputPendingCount: pending, asrInputUnknownCount: state === 'unavailable' || state === 'partial' ? 1 : 0,
    asrInputEstimatedCount: 0 }
}

function recordingDay(dateStamp: number, text: string): ArkmeRecordingDay {
  return {
    dateStamp, totalDurationMillis: 5_000,
    transcript: { viewRef: 'fixture-view', nextCursor: '', transcriptSource: 'system',
      state: 'ready', message: '', totalDurationMillis: 5_000, processingCount: 0,
      items: [{
        itemId: text, itemRef: text, startAtMillis: dateStamp + 1_000, endAtMillis: dateStamp + 6_000,
        speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 0, speakerLabel: '说话人',
        canBindSpeaker: true, isSelf: false, isBackground: false, text,
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
    expect(renderer.root.findByProps({ 'aria-label': '9月4日' }).props.style.background).toBe('transparent')
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

  it.each(['first-open', 'transcript-finishes', 'mixed-history'] as const)('refreshes a late input receipt automatically: %s', async scenario => {
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation !== 'recordings.day') throw new Error(`unexpected operation: ${operation}`)
      reads++
      const day = recordingDay(params.dateStamp, '已完成文本')
      const awaiting = reads < (scenario === 'transcript-finishes' ? 3 : 2)
      day.transcript.dailyMetrics = scenario === 'mixed-history'
        ? inputMetrics(awaiting ? 'unavailable' : 'partial', awaiting ? 1 : 0)
        : inputMetrics(awaiting ? 'processing' : 'ready')
      if (scenario === 'transcript-finishes' && reads === 1) day.transcript.state = 'processing'
      return day
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 暂不可用')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    if (scenario === 'transcript-finishes') {
      expect(JSON.stringify(renderer.toJSON())).toContain('已完成文本')
      expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 暂不可用')
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    }
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 6秒')
    const settledReads = reads
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(reads).toBe(settledReads)
  })

  it('does not keep polling historical unknown input', async () => {
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation !== 'recordings.day') throw new Error(`unexpected operation: ${operation}`)
      reads++
      const day = recordingDay(params.dateStamp, '历史文本')
      day.transcript.dailyMetrics = inputMetrics('unavailable')
      return day
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(reads).toBe(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 暂不可用')
  })

  it('refreshes retry input automatically without hiding previously observed input', async () => {
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation !== 'recordings.day') throw new Error(`unexpected operation: ${operation}`)
      const day = recordingDay(params.dateStamp, '重试文本')
      const pending = ++reads === 1
      day.transcript.dailyMetrics = { ...inputMetrics(pending ? 'processing' : 'partial'),
        asrInputConfirmedCount: 1, asrInputDurationMillis: pending ? 4000 : 10000 }
      return day
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 4秒（已确认）')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 10秒（已确认）')
    const settledReads = reads
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(reads).toBe(settledReads)
  })

  it('ignores a late input poll after the user selects another date', async () => {
    const todayStamp = new Date(2026, 8, 4).getTime()
    let todayReads = 0, finishOldPoll!: (day: ArkmeRecordingDay) => void
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return { options: [] }
      if (operation !== 'recordings.day') throw new Error(`unexpected operation: ${operation}`)
      if (params.dateStamp === todayStamp && ++todayReads === 2) return await new Promise(resolve => { finishOldPoll = resolve })
      const day = recordingDay(params.dateStamp, params.dateStamp === todayStamp ? '旧日期内容' : '新日期内容')
      day.transcript.dailyMetrics = inputMetrics(params.dateStamp === todayStamp ? 'processing' : 'ready')
      return day
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '9月3日' }).props.onClick() })
    const stale = recordingDay(todayStamp, '过期轮询内容')
    stale.transcript.dailyMetrics = { ...inputMetrics('ready'), asrInputDurationMillis: 99000 }
    await act(async () => { finishOldPoll(stale) })
    expect(JSON.stringify(renderer.toJSON())).toContain('新日期内容')
    expect(JSON.stringify(renderer.toJSON())).toContain('转写输入时长 6秒')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('过期轮询内容')
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(todayReads).toBe(2)
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
    expect(renderer.root.findByProps({ 'aria-label': '9月4日' }).props.style.background).toBe('transparent')
  })

  it.each(['loading', 'failed'] as const)('moves the single selection background and allows date changes while details are %s', async state => {
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
        expect(node.props.style.border).toBe(0)
        if (!node.props['aria-pressed']) expect(node.props.style.background).toBe('transparent')
      }
      expect(date(day).props.style.background).toBe(arkmeTheme.layer2)
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
