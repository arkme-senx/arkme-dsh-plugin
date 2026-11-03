import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingDay } from '../src/types.js'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: api.call }))
vi.mock('../src/client/recordings/RecordingTotalMetrics.js', () => ({ RecordingTotalMetricsLoader: () => null }))
vi.mock('../src/client/recordings/RecordingDayArrangements.js', () => ({ RecordingDayArrangements: () => null }))
vi.mock('../src/client/recordings/ArkmeRecordingPresence.js', () => ({ ArkmeRecordingPresence: () => null }))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { recordingDayCache } from '../src/client/recordings/recording-day-cache.js'

const a = new Date(2026, 10, 3).getTime(), b = new Date(2026, 10, 2).getTime()
let renderer: ReactTestRenderer
function day(date: number, account = 1, more = false): ArkmeRecordingDay {
  const text = `账号${account}-${date === a ? 'A' : 'B'}-${more ? '后半天' : '前半天'}`
  return { dateStamp: date, totalDurationMillis: 5000, transcript: { dateStamp: date, transcriptSource: 'system', viewRef: `view-${account}-${date}`,
    nextCursor: date === a && !more ? 'next' : '', state: 'ready', message: '', totalDurationMillis: 5000, processingCount: 0,
    items: [{ itemId: text, itemRef: text, sessionKey: 'fixture', transcriptSource: 'system', startAtMillis: date + (more ? 3000 : 1000), endAtMillis: date + (more ? 4000 : 2000),
      speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 0, speakerLabel: '说话人', canBindSpeaker: true, sameSpeakerItemCount: 1, isSelf: false, isBackground: false,
      text, textStartOffset: 0, textEndOffset: text.length, textTotalLength: text.length }],
  }, summary: { state: 'ready', message: '', items: ['最新总结', '旧版总结'].map((content, index) => ({ id: String(index), status: 'done', selectable: true,
    generationStage: 2, generatedAtMillis: 2000 - index, modelDisplayName: '模型', content, error: '', timelineEvents: [] })) }, timeline: { state: 'empty', message: '', items: [] } }
}
const ui = () => <ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />
const rows = () => renderer.root.findAll(node => typeof node.props['data-transcript-row'] === 'string').map(node => node.props['data-transcript-row']).join('|')
const clickDate = async (label: string) => { await act(async () => { renderer.root.findByProps({ 'aria-label': label }).props.onClick() }) }
const click = async (label: string) => { await act(async () => { renderer.root.findAll(node => node.type === 'button' && node.children.includes(label))[0]!.props.onClick() }) }
const account = () => arkmeAuthStore.getSnapshot().auth?.userId ?? 1
const signIn = (userId: number) => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 3, 11)); recordingDayCache.clear(); arkmeUi.showRecordings(); signIn(1)
  api.call.mockReset().mockImplementation(async (op, p) => {
    if (op === 'recordings.calendar') return { days: [] }
    if (op === 'recordings.day') return day(p.dateStamp, account())
    if (op === 'recordings.transcript.page') return day(p.dateStamp, account(), true).transcript
    if (op === 'recordings.day.overview') return { viewRef: day(p.dateStamp, account()).transcript.viewRef, items: [] }
    if (op === 'recordings.entities') return { entities: [], pollable: false, version: 'fixture' }
    return { options: [] }
  })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() }); recordingDayCache.clear(); arkmeUi.showConversations()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('restores a completely read date before its background read settles, without scanning unchanged pages again', async () => {
  await act(async () => { renderer = create(ui()) }); await click('加载更多')
  expect(rows()).toContain('账号1-A-后半天')
  await clickDate('11月2日')
  const pending = Promise.withResolvers<ArkmeRecordingDay>(), original = api.call.getMockImplementation()!
  api.call.mockImplementation((op, p, ...rest) => op === 'recordings.day' && p.dateStamp === a ? pending.promise : original(op, p, ...rest))
  await clickDate('11月3日')
  expect(rows()).toContain('账号1-A-后半天')
  await act(async () => { pending.resolve(day(a)) })
  expect(rows()).toContain('账号1-A-后半天')
  expect(renderer.root.findAll(node => node.type === 'button' && node.children.includes('加载更多'))).toHaveLength(0)
  const count = (op: string) => api.call.mock.calls.filter(([name, p]) => name === op && p.dateStamp === a && (op !== 'recordings.day' || p.part === 'transcript')).length
  expect(count('recordings.day')).toBe(2)
  expect(count('recordings.day.overview')).toBe(1)
  expect(count('recordings.transcript.page')).toBe(1)
})

it('shows coverage, the first transcript and input/storage metrics without waiting for projections or the full overview', async () => {
  const first = Promise.withResolvers<ArkmeRecordingDay>(), overview = Promise.withResolvers<unknown>(), original = api.call.getMockImplementation()!
  api.call.mockImplementation((op, p, ...rest) => {
    if (op === 'recordings.day' && p.part === 'transcript') return first.promise
    if (op === 'recordings.day' && p.part === 'coverage') return Promise.resolve({ dateStamp: a, coverage: { state: 'ready', intervals: [{ startAtMillis: a, endAtMillis: a + 5000, sourceLabel: '录音', status: 'saved' }] } })
    if (op === 'recordings.day.overview') return overview.promise
    return original(op, p, ...rest)
  })
  await act(async () => { renderer = create(ui()) })
  expect(renderer.root.findAllByProps({ 'data-recording-loading': 'reading' })).toHaveLength(1)
  expect(JSON.stringify(renderer.toJSON())).not.toContain('音频文字正在导入&转写中')
  expect(api.call.mock.calls.filter(([op, p]) => op === 'recordings.day' && ['summary', 'timeline'].includes(p.part))).toHaveLength(0)
  const ready = day(a)
  ready.transcript.dailyMetrics = { storage: { bytes: 1024, archiveBytes: 512, clipBytes: 512, state: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0 },
    archiveBytes: 1024, archiveState: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0, textCount: 10,
    asrInputDurationMillis: 60000, asrInputState: 'ready', asrInputConfirmedCount: 1, asrInputEstimatedCount: 0, asrInputPendingCount: 0, asrInputUnknownCount: 0 }
  await act(async () => { first.resolve({ dateStamp: a, transcript: ready.transcript, totalDurationMillis: 5000 } as ArkmeRecordingDay) })
  expect(rows()).toContain('账号1-A-前半天')
  const text = JSON.stringify(renderer.toJSON())
  expect(text).toContain('1 KiB'); expect(text).toContain('1分0秒'); expect(text).toContain('全天字数统计中')
  expect(api.call.mock.calls.some(([op]) => op === 'recordings.playback.open')).toBe(false)
})

it('can show a requested summary even while the first transcript remains pending', async () => {
  const pending = Promise.withResolvers<ArkmeRecordingDay>(), original = api.call.getMockImplementation()!
  api.call.mockImplementation((op, p, ...rest) => op === 'recordings.day' && p.part === 'transcript' ? pending.promise : original(op, p, ...rest))
  await act(async () => { renderer = create(ui()) }); await click('总结')
  expect(JSON.stringify(renderer.toJSON())).toContain('最新总结')
  expect(rows()).toBe('')
  await act(async () => { pending.resolve(day(a)) })
  expect(JSON.stringify(renderer.toJSON())).toContain('最新总结')
})

it('keeps a newer summary when restoring the cached transcript prefix finishes later', async () => {
  await act(async () => { renderer = create(ui()) }); await click('加载更多'); await click('总结')
  const continuation = Promise.withResolvers<ArkmeRecordingDay['transcript']>(), summary = Promise.withResolvers<unknown>(), original = api.call.getMockImplementation()!
  const fresh = day(a)
  fresh.transcript = { ...fresh.transcript, viewRef: 'new-view', nextCursor: 'new-next' }
  fresh.summary.items[0]!.content = '后台先到达的最新总结'
  api.call.mockImplementation((op, p, ...rest) => {
    if (op === 'recordings.day' && p.part === 'summary') return summary.promise
    if (op === 'recordings.day') return Promise.resolve({ dateStamp: a,
      ...(p.part === 'transcript' ? { transcript: fresh.transcript, totalDurationMillis: fresh.totalDurationMillis }
        : {}) })
    if (op === 'recordings.transcript.page') return continuation.promise
    return original(op, p, ...rest)
  })
  await act(async () => { renderer.update(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={1} />) })
  expect(api.call.mock.calls.some(([op, p]) => op === 'recordings.transcript.page' && p.cursor === 'new-next')).toBe(true)
  await act(async () => { summary.resolve({ dateStamp: a, summary: fresh.summary }) })
  expect(JSON.stringify(renderer.toJSON())).toContain('后台先到达的最新总结')
  await act(async () => { continuation.resolve({ ...day(a, 1, true).transcript, viewRef: 'new-view' }) })
  expect(JSON.stringify(renderer.toJSON())).toContain('后台先到达的最新总结')
})

it('shows independently loaded metrics before any transcript and retains the summary after a transcript failure', async () => {
  const pending = Promise.withResolvers<ArkmeRecordingDay>(), original = api.call.getMockImplementation()!
  const metrics = { archiveBytes: 2048, archiveState: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0, textCount: 0,
    storage: { bytes: 2048, archiveBytes: 1024, clipBytes: 1024, state: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0 },
    asrInputDurationMillis: 60000, asrInputState: 'ready', asrInputConfirmedCount: 1, asrInputEstimatedCount: 0, asrInputPendingCount: 0, asrInputUnknownCount: 0 }
  api.call.mockImplementation((op, p, ...rest) => op === 'recordings.day' && p.part === 'transcript' ? pending.promise
    : op === 'recordings.day' && p.part === 'metrics' ? Promise.resolve({ dateStamp: a, metrics }) : original(op, p, ...rest))
  await act(async () => { renderer = create(ui()) })
  expect(rows()).toBe('')
  expect(JSON.stringify(renderer.toJSON())).toContain('2 KiB')
  expect(JSON.stringify(renderer.toJSON())).toContain('全天字数统计中')
  await click('总结')
  await act(async () => { pending.reject(new Error('正文读取暂不可用')) })
  expect(JSON.stringify(renderer.toJSON())).toContain('最新总结')
})

it('restores an account after remount, discards its late response while another account is active, and keeps cached text on refresh failure', async () => {
  await act(async () => { renderer = create(ui()) }); await click('加载更多')
  const old = Promise.withResolvers<ArkmeRecordingDay>(), original = api.call.getMockImplementation()!
  api.call.mockImplementation((op, p, ...rest) => op === 'recordings.day' && account() === 1 ? old.promise : original(op, p, ...rest))
  await act(async () => { renderer.update(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={1} />) })
  await act(async () => { signIn(2) })
  expect(rows()).toContain('账号2-A-前半天'); expect(rows()).not.toContain('账号1')
  const stale = day(a); stale.transcript.items[0]!.text = '迟到的旧账号内容'
  await act(async () => { old.resolve(stale) })
  expect(rows()).not.toContain('迟到的旧账号内容')
  const current = Promise.withResolvers<ArkmeRecordingDay>()
  api.call.mockImplementation((op, p, ...rest) => op === 'recordings.day' ? current.promise : original(op, p, ...rest))
  await act(async () => { renderer.unmount(); signIn(1) })
  await act(async () => { renderer = create(ui()) })
  expect(rows()).toContain('账号1-A-后半天'); expect(rows()).not.toContain('账号2')
  await act(async () => { current.reject(new Error('网络暂时中断')) })
  expect(rows()).toContain('账号1-A-后半天')
  expect(JSON.stringify(renderer.toJSON())).toContain('更新暂未完成，当前内容已保留')
})

it('restores each date tab, selected summary version and reading position across remounts', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
  const pane = { scrollTop: 0, scrollLeft: 0, querySelectorAll: () => [], querySelector: () => null, contains: () => false,
    addEventListener: () => {}, removeEventListener: () => {},
    getBoundingClientRect: () => ({ top: 0, bottom: 500 }) }
  await act(async () => { renderer = create(ui(), { createNodeMock: element => element.props['data-recording-day-pane'] ? pane : null }) })
  const scroll = async (top: number) => { pane.scrollTop = top; await act(async () => { renderer.root.findByProps({ 'data-recording-day-pane': true }).props.onScroll() }) }
  await scroll(1234); await click('总结')
  await act(async () => { renderer.root.findAll(node => node.props.ariaLabel === '切换总结版本')[0]!.props.onChange('1') })
  await scroll(456); await clickDate('11月2日'); await clickDate('11月3日')
  expect(renderer.root.findAll(node => node.props.ariaLabel === '切换总结版本')[0]!.props.value).toBe('1')
  expect(pane.scrollTop).toBe(456)
  await act(async () => { renderer.unmount() }); pane.scrollTop = 0
  await act(async () => { renderer = create(ui(), { createNodeMock: element => element.props['data-recording-day-pane'] ? pane : null }) })
  expect(renderer.root.findAll(node => node.props.ariaLabel === '切换总结版本')[0]!.props.value).toBe('1')
  expect(pane.scrollTop).toBe(456)
  await click('转写'); expect(pane.scrollTop).toBe(1234)
})
