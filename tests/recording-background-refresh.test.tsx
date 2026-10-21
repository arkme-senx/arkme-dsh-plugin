import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingDay } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
vi.mock('../src/client/recordings/RecordingTotalMetrics.js', () => ({ RecordingTotalMetricsLoader: () => null }))
vi.mock('../src/client/recordings/RecordingDayArrangements.js', () => ({ RecordingDayArrangements: () => null }))
vi.mock('../src/client/recordings/ArkmeRecordingPresence.js', () => ({ ArkmeRecordingPresence: () => null }))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

let renderer: ReactTestRenderer
const dateStamp = new Date(2026, 9, 17).getTime()
function makeDay(date = dateStamp): ArkmeRecordingDay {
  return { dateStamp: date, totalDurationMillis: 5000,
    transcript: { state: 'ready', message: '', totalDurationMillis: 5000, processingCount: 0, items: [{ itemId: 'one', itemRef: 'one', startAtMillis: date + 1000, endAtMillis: date + 6000, speakerNumber: 1, speakerKey: 'a', speakerColorIndex: 0, speakerLabel: '我', sameSpeakerItemCount: 1, isSelf: true, isBackground: false, text: '有录音' }] },
    summary: { state: 'ready', message: '', items: ['最新总结', '正在阅读的旧版总结'].map((content, i) => ({ id: String(i), status: 'done', selectable: true, generationStage: 2, generatedAtMillis: 2000 - i * 1000, modelDisplayName: '模型', content, error: '', timelineEvents: [] })) },
    timeline: { state: 'empty', message: '', items: [] } }
}
const ui = (revision = 0) => <ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={revision} />
const rendered = () => JSON.stringify(renderer.toJSON())
const selection = () => renderer.root.findAll(n => n.props.ariaLabel === '切换总结版本')[0]!
const click = async (label: string) => { await act(async () => { renderer.root.findAll(n => n.type === 'button' && n.children.includes(label))[0]!.props.onClick() }) }
const open = async () => {
  await act(async () => { renderer = create(ui()) })
  await click('总结')
  await act(async () => selection().props.onChange('1'))
  expect(rendered()).toContain('正在阅读的旧版总结')
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17, 11))
  arkmeUi.showRecordings()
  mocks.call.mockReset().mockImplementation(async (op, p) => {
    if (op === 'recordings.calendar') return { days: [] }
    if (op === 'recordings.day') return makeDay(p.dateStamp)
    return { options: [] }
  })
})
afterEach(async () => { await act(async () => renderer?.unmount()); arkmeUi.showConversations(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); vi.useRealTimers() })

it('keeps the selected summary mounted while a background refresh is pending and after a newer version arrives', async () => {
  await open()
  const body = renderer.root.findByType(ArkmeMarkdownBody)
  const pending = deferred<ArkmeRecordingDay>()
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? pending.promise : original(op, p))
  await act(async () => renderer.update(ui(1)))
  expect(renderer.root.findByType(ArkmeMarkdownBody)).toBe(body)
  expect(selection().props.value).toBe('1')
  expect(rendered()).toContain('正在阅读的旧版总结')
  const next = makeDay(); next.summary.items.unshift({ ...next.summary.items[0]!, id: 'new', content: '刚完成的新总结' })
  await act(async () => pending.resolve(next))
  expect(selection().props.value).toBe('1')
  expect(rendered()).toContain('正在阅读的旧版总结')
  expect(rendered()).toContain('有更新版本')
  expect(rendered()).not.toContain('刚完成的新总结')
})

it('keeps readable content after a refresh failure and retries without clearing it', async () => {
  await open()
  const pending = deferred<ArkmeRecordingDay>(), original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? pending.promise : original(op, p))
  await act(async () => renderer.update(ui(1)))
  await act(async () => pending.reject(new Error('网络暂时中断')))
  expect(rendered()).toContain('正在阅读的旧版总结')
  expect(rendered()).toContain('更新暂未完成，当前内容已保留')
  const retry = deferred<ArkmeRecordingDay>()
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? retry.promise : original(op, p))
  await click('重试更新')
  expect(rendered()).toContain('正在阅读的旧版总结')
  await act(async () => retry.resolve(makeDay()))
  expect(rendered()).not.toContain('更新暂未完成')
  expect(selection().props.value).toBe('1')
})

it('ignores an older refresh response and applies the newest request', async () => {
  await open()
  const first = deferred<ArkmeRecordingDay>(), second = deferred<ArkmeRecordingDay>()
  let reads = 0; const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? (++reads === 1 ? first.promise : second.promise) : original(op, p))
  await act(async () => renderer.update(ui(1)))
  await act(async () => renderer.update(ui(2)))
  const latest = makeDay(); latest.summary.items[1]!.content = '服务器核验的新内容'
  await act(async () => second.resolve(latest))
  await act(async () => first.resolve(makeDay()))
  expect(rendered()).toContain('服务器核验的新内容')
  expect(rendered()).not.toContain('正在阅读的旧版总结')
})

it('retains a summary when only that section fails, but accepts a confirmed empty result', async () => {
  await open()
  const original = mocks.call.getMockImplementation()!
  let next = makeDay()
  next.summary = { state: 'error', items: [], message: '总结服务暂时不可用' }
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? Promise.resolve(next) : original(op, p))
  await act(async () => renderer.update(ui(1)))
  expect(rendered()).toContain('正在阅读的旧版总结')
  expect(rendered()).toContain('更新暂未完成，当前内容已保留')
  expect(selection().props.value).toBe('1')
  next = makeDay(); next.summary = { state: 'empty', items: [], message: '尚无总结' }
  await act(async () => renderer.update(ui(2)))
  expect(rendered()).not.toContain('正在阅读的旧版总结')
  expect(rendered()).not.toContain('更新暂未完成')
})

it('retains the timeline selection while another section updates', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (op, p) => {
    const value = await original(op, p)
    if (op === 'recordings.day') value.timeline = { ...value.summary, items: value.summary.items.map((v: ArkmeRecordingDay['summary']['items'][number]) => ({ ...v, timelineEvents: [{ eventId: v.id, timeRange: '10:00', title: `事件${v.id}`, description: v.content, todo: '', scene: '', emotion: '', participants: [], tags: [] }] })) }
    return value
  })
  await act(async () => { renderer = create(ui()) })
  await click('时间轴')
  const picker = () => renderer.root.findAll(n => n.props.ariaLabel === '切换时间轴版本')[0]!
  await act(async () => picker().props.onChange('1'))
  await act(async () => renderer.update(ui(1)))
  expect(picker().props.value).toBe('1')
})

it('keeps the chosen version through repeated independent transcript polling', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (op, p) => {
    const value = await original(op, p)
    if (op === 'recordings.day') value.transcript.state = 'processing'
    return value
  })
  await open()
  const body = renderer.root.findByType(ArkmeMarkdownBody)
  await act(async () => vi.advanceTimersByTimeAsync(11000))
  expect(mocks.call.mock.calls.filter(([op]) => op === 'recordings.day').length).toBeGreaterThan(3)
  expect(renderer.root.findByType(ArkmeMarkdownBody)).toBe(body)
  expect(selection().props.value).toBe('1')
})

it('clears the old day when the user changes the date rather than retaining another day as a refresh', async () => {
  await open()
  const pending = deferred<ArkmeRecordingDay>(), original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? pending.promise : original(op, p))
  await act(async () => renderer.root.findByProps({ 'aria-label': '10月16日' }).props.onClick())
  expect(rendered()).not.toContain('正在阅读的旧版总结')
  await act(async () => pending.resolve(makeDay(dateStamp - 86400000)))
  expect(selection().props.value).toBe('0')
})

it('does not retain a previous account day or accept its delayed response', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 1 })
  await open()
  const old = deferred<ArkmeRecordingDay>(), next = deferred<ArkmeRecordingDay>()
  let reads = 0; const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'recordings.day' ? (++reads === 1 ? old.promise : next.promise) : original(op, p))
  await act(async () => renderer.update(ui(1)))
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 2 }))
  expect(rendered()).not.toContain('正在阅读的旧版总结')
  await act(async () => old.resolve(makeDay()))
  expect(rendered()).not.toContain('正在阅读的旧版总结')
  const other = makeDay(); other.summary.items[0]!.content = '第二个账号的总结'
  await act(async () => next.resolve(other))
  expect(rendered()).toContain('第二个账号的总结')
})
