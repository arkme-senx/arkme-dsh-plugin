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
  const count = (op: string) => api.call.mock.calls.filter(([name, p]) => name === op && p.dateStamp === a).length
  expect(count('recordings.day')).toBe(2)
  expect(count('recordings.day.overview')).toBe(1)
  expect(count('recordings.transcript.page')).toBe(1)
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
