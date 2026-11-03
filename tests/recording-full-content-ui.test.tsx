import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
const calls = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: calls.read }))
vi.mock('../src/client/recordings/RecordingTotalMetrics.js', () => ({ RecordingTotalMetricsLoader: () => null }))
import { ArkmeRecordingSurface, ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { recordingDayCache } from '../src/client/recordings/recording-day-cache.js'

let renderer: ReactTestRenderer
function page(dateStamp: number, continued = false): ArkmeRecordingTranscriptPage {
  return { dateStamp, transcriptSource: 'system', viewRef: 'same-view', nextCursor: continued ? '' : 'sealed-next', state: 'ready', message: '', processingCount: 0, totalDurationMillis: 1000,
    items: [{ itemId: 'one', itemRef: 'sealed-item', sessionKey: 'session', transcriptSource: 'system', startAtMillis: dateStamp+1000, endAtMillis: dateStamp+2000,
      speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我', canBindSpeaker: true, isSelf: true, isBackground: false,
      text: continued ? '尾部' : '汉🎙', textStartOffset: continued ? 2 : 0, textEndOffset: continued ? 4 : 2, textTotalLength: 4 }],
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026,8,10,12))
  recordingDayCache.clear()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  calls.read.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'recordings.calendar') return { fromStamp: params.fromStamp, days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp, totalDurationMillis: 1000, transcript: page(params.dateStamp),
      summary: { state: 'empty', message: '', items: [] }, timeline: { state: 'empty', message: '', items: [] } }
    if (operation === 'recordings.day.overview') return { viewRef: 'same-view', items: [{ ...page(params.dateStamp).items[0], textPreview: '汉🎙尾部' }] }
    if (operation === 'recordings.transcript.page') return page(params.dateStamp, true)
    throw new Error(`Unexpected ${operation}`)
  })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  recordingDayCache.clear(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('full-content workbench actions', () => {
  it('keeps export progress outside the scroller and permits only one pending download', async () => {
    const click = vi.fn(), pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>(), blobs: Blob[] = []
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:fixture' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const implementation = calls.read.getMockImplementation()!
    calls.read.mockImplementation(async (op, params) => op === 'recordings.transcript.page' ? pending.promise : implementation(op, params))
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    const button = renderer.root.findByProps({ 'aria-label': '导出' })
    expect(button.props.disabled).toBe(true)
    expect(button.props['aria-busy']).toBe(true)
    const status = renderer.root.findByProps({ 'data-recording-export-status': true })
    expect(JSON.stringify(renderer.toJSON())).toContain('正在准备完整转写')
    expect(status.props.role).toBe('status')
    expect(renderer.root.findByProps({ 'data-recording-day-pane': true }).findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
    // Exercise the operation guard as well as the disabled DOM control.
    await act(async () => { button.props.onClick() })
    expect(calls.read.mock.calls.filter(([op]) => op === 'recordings.transcript.page')).toHaveLength(1)
    const stamp = calls.read.mock.calls.find(([op]) => op === 'recordings.transcript.page')![1].dateStamp
    await act(async () => { pending.resolve(page(stamp, true)) })
    expect(click).toHaveBeenCalledTimes(1)
    expect(await blobs[0]!.text()).toContain('汉🎙尾部')
    expect(renderer.root.findByProps({ 'aria-label': '导出' }).props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
  })

  it('keeps the failed export visible and retries without downloading a partial file', async () => {
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const implementation = calls.read.getMockImplementation()!
    let fail = true
    calls.read.mockImplementation(async (op, params) => {
      if (op === 'recordings.transcript.page' && fail) throw new Error('读取失败')
      return implementation(op, params)
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    expect(click).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'data-recording-export-status': true })).toBeTruthy()
    fail = false
    await act(async () => { renderer.root.findByProps({ 'aria-label': '重试下载完整转写' }).props.onClick() })
    expect(click).toHaveBeenCalledTimes(1)
    expect(renderer.root.findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
  })

  it.each(['date', 'account', 'unmount'] as const)('discards a pending export after changing %s', async change => {
    const click = vi.fn(), pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    const implementation = calls.read.getMockImplementation()!
    calls.read.mockImplementation(async (op, params) => op === 'recordings.transcript.page' ? pending.promise : implementation(op, params))
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    const stamp = calls.read.mock.calls.find(([op]) => op === 'recordings.transcript.page')![1].dateStamp
    await act(async () => {
      if (change === 'date') renderer.root.findByProps({ 'aria-label': '9月9日' }).props.onClick()
      else if (change === 'account') arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 999 })
      else renderer.unmount()
    })
    await act(async () => { pending.resolve(page(stamp, true)) })
    expect(click).not.toHaveBeenCalled()
    if (change !== 'unmount') expect(renderer.root.findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
    if (change !== 'unmount') {
      await act(async () => {
        if (change === 'date') renderer.root.findByProps({ 'aria-label': '9月10日' }).props.onClick()
        else arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
      })
      expect(renderer.root.findByProps({ 'aria-label': '导出' }).props.disabled).toBe(false)
      expect(renderer.root.findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
    }
  })

  it('keeps the tab panel in the content row while overview loading and failure notices change', async () => {
    const pending = Promise.withResolvers<unknown>(), implementation = calls.read.getMockImplementation()!
    calls.read.mockImplementation(async (op, params) => op === 'recordings.day.overview' ? pending.promise : implementation(op, params))
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    const checkRows = () => {
      const detail = renderer.root.findByProps({ 'aria-label': '录音详情' })
      const gridItems = detail.children.filter(child => typeof child !== 'string')
      expect(gridItems).toHaveLength(3)
      const overview = renderer.root.findByProps({ 'data-recording-day-overview': true })
      expect(overview.findAllByProps({ 'data-recording-overview-notices': true })).toHaveLength(1)
      expect((gridItems[2] as typeof detail).findAllByProps({ 'aria-label': '录音内容' })).toHaveLength(1)
    }
    for (const tab of ['总结', '时间轴', '音频文件', '转写']) {
      await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes(tab))!.props.onClick() })
      checkRows()
    }
    await act(async () => { pending.reject(new Error('概览暂时不可用')) })
    checkRows()
    expect(JSON.stringify(renderer.toJSON())).toContain('全天概览读取失败')
  })

  it('cancels a late export when the user leaves the transcript tab without leaking its error into the next tab', async () => {
    const click = vi.fn(), pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    const implementation = calls.read.getMockImplementation()!
    calls.read.mockImplementation(async (op, params) => op === 'recordings.transcript.page' ? pending.promise : implementation(op, params))
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    const navigation = renderer.root.findByProps({ 'aria-label': '录音内容' })
    await act(async () => { navigation.findAllByType('button').find(button => button.children.includes('总结'))!.props.onClick() })
    const dateStamp = calls.read.mock.calls.find(([op]) => op === 'recordings.transcript.page')![1].dateStamp
    await act(async () => { pending.resolve(page(dateStamp, true)) })
    expect(click).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).not.toContain('完整转写读取失败')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取完整转写')
    await act(async () => { navigation.findAllByType('button').find(button => button.children.includes('转写'))!.props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '导出' }).props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({ 'data-recording-export-status': true })).toHaveLength(0)
  })

  it('preloads the overview while rendering only the first body page, then exports all original text once complete', async () => {
    const click = vi.fn(), blobs: Blob[] = []
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    vi.spyOn(URL,'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:fixture' })
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(() => {})
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(calls.read.mock.calls.filter(([op]) => op === 'recordings.transcript.page')).toHaveLength(0)
    expect(renderer.root.findByType(ArkmeRecordingTranscriptRow).props.item.text).toBe('汉🎙')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    expect(calls.read.mock.calls.filter(([op]) => op === 'recordings.transcript.page')).toHaveLength(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(await blobs[0]!.text()).toContain('汉🎙尾部')
  })

  it('finds text beyond the loaded page and never downloads a partial result on owner failure', async () => {
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.props['aria-label'] === '搜索')!.props.onClick() })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '搜索当天转写' }).props.onChange({ target: { value: '尾部' } }); await vi.advanceTimersByTimeAsync(251) })
    expect(JSON.stringify(renderer.root.findByProps({ 'aria-label': '搜索命中数' }).children)).toContain('1/1')
    await act(async () => { renderer.unmount() })
    const implementation = calls.read.getMockImplementation()!
    calls.read.mockImplementation(async (op, params) => op === 'recordings.transcript.page' ? Promise.reject(new Error('录音版本已更新')) : implementation(op,params))
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    expect(click).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('完整转写读取失败')
    expect(JSON.stringify(renderer.toJSON())).toContain('汉🎙')
  })
})
