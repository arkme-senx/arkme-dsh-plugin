import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
const calls = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: calls.read }))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'

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
  calls.read.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'recordings.calendar') return { fromStamp: params.fromStamp, days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp, totalDurationMillis: 1000, transcript: page(params.dateStamp),
      summary: { state: 'empty', message: '', items: [] }, timeline: { state: 'empty', message: '', items: [] } }
    if (operation === 'recordings.transcript.page') return page(params.dateStamp, true)
    throw new Error(`Unexpected ${operation}`)
  })
})
afterEach(async () => { await act(async () => { renderer?.unmount() }); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('full-content workbench actions', () => {
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
  })

  it('renders the first page without exhausting it, then exports all original text once complete', async () => {
    const click = vi.fn(), blobs: Blob[] = []
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    vi.spyOn(URL,'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:fixture' })
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(() => {})
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(calls.read.mock.calls.filter(([op]) => op === 'recordings.transcript.page')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('汉🎙')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '导出' }).props.onClick() })
    expect(calls.read.mock.calls.filter(([op]) => op === 'recordings.transcript.page')).toHaveLength(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(await blobs[0]!.text()).toContain('汉🎙尾部')
  })

  it('finds text beyond the loaded page and never downloads a partial result on owner failure', async () => {
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ click }), addEventListener() {}, removeEventListener() {} })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
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
