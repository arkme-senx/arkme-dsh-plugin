import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mock.call }))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeUi, ArkmeUiController } from '../src/client/ui-controller.js'

const dateStamp = new Date(2026, 9, 9).getTime()
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 13, 12))
  mock.call.mockReset().mockImplementation(async (op, params) => {
    if (op === 'recordings.calendar') return { days: [] }
    if (op === 'recordings.day') return {
      dateStamp: params.dateStamp, totalDurationMillis: 10000,
      transcript: { state: 'ready', items: [], totalDurationMillis: 10000, message: '', processingCount: 0 },
      coverage: { state: 'ready', intervals: [{ startAtMillis: params.dateStamp, endAtMillis: params.dateStamp + 10000, status: 'ready' }] },
      summary: { state: 'ready', message: '', items: ['latest', 'original'].map(id => ({ id, status: 'done', selectable: true, generationStage: 1, generatedAtMillis: dateStamp, modelDisplayName: 'model', content: `${id} summary`, timelineEvents: [], error: '' })) },
      timeline: { state: 'empty', message: '', items: [] },
    }
    throw new Error('Unsupported fixture operation')
  })
})
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; arkmeUi.showConversations(); vi.useRealTimers(); vi.restoreAllMocks() })
const open = async (version?: string) => { await act(async () => {
  arkmeUi.showRecordingSummaryTarget(dateStamp, version)
  if (!renderer) renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
}) }
const version = () => renderer!.root.findAll(node => node.props.ariaLabel === '切换总结版本')[0]?.props.value

it('opens the source day and original summary rather than the latest summary', async () => {
  await open('original')
  expect(version()).toBe('original')
  expect(renderer!.root.findAllByType('button').find(node => node.props['aria-current'] === 'page')?.children).toContain('总结')
  expect(mock.call.mock.calls.some(([op, params]) => op === 'recordings.day' && params.dateStamp === dateStamp)).toBe(true)
  expect(mock.call.mock.calls.some(([op]) => op.startsWith('recordings.playback'))).toBe(false)
})

it('can switch sources on the same day without a day reload resetting the version', async () => {
  await open('latest')
  const reads = mock.call.mock.calls.filter(([op]) => op === 'recordings.day').length
  await open('original')
  expect(version()).toBe('original')
  expect(mock.call.mock.calls.filter(([op]) => op === 'recordings.day')).toHaveLength(reads)
})

it('announces a missing source version and offers the available day content', async () => {
  await open('deleted-summary')
  expect(version()).toBe('latest')
  expect(JSON.stringify(renderer!.toJSON())).toContain('来源总结版本暂不可用')
})

it('reopens the same source after the user manually switches back to transcript', async () => {
  await open('original')
  const transcript = renderer!.root.findAllByType('button').find(node => node.children.includes('转写'))!
  await act(async () => transcript.props.onClick())
  expect(version()).toBeUndefined()
  await open('original')
  expect(version()).toBe('original')
})

it('opens day-only provenance and lets normal search replace the summary target', async () => {
  await open()
  expect(version()).toBe('latest')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('来源总结版本暂不可用')
  const controller = new ArkmeUiController()
  controller.showRecordingSummaryTarget(dateStamp, 'original')
  controller.showRecordingTarget(dateStamp, dateStamp + 2000)
  expect(controller.getSnapshot().recordingTarget?.summary).toBeUndefined()
})
it('opens a notification version outside the local-day list with its original day range', async () => {
  const originalCall = mock.call.getMockImplementation()!
  const id = '0123456789abcdef01234567'
  mock.call.mockImplementation(async (op, params) => op === 'recordings.workflow' ? { version: { id, status: 'done', selectable: true, generationStage: 1, generatedAtMillis: dateStamp, modelDisplayName: 'model', content: '精确历史版本', timelineEvents: [], error: '' } } : originalCall(op, params))
  const window = { date: '2026-10-09', timeZone: 'America/New_York', dateStamp: Date.parse('2026-10-09T00:00:00-04:00'), endStamp: Date.parse('2026-10-10T00:00:00-04:00') }
  await act(async () => {
    arkmeUi.showRecordingSummaryTarget(window.dateStamp, id, window)
    renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
  })
  expect(version()).toBe(id)
  expect(JSON.stringify(renderer!.toJSON())).toContain('精确历史版本')
  expect(mock.call.mock.calls).toContainEqual(['recordings.workflow', { operation: 'version', versionId: id, kind: 'summary' }, expect.any(AbortSignal)])
  expect(mock.call.mock.calls.some(([op, params]) => op === 'recordings.day' && params.window?.dateStamp === window.dateStamp)).toBe(true)
})

it('keeps an exact notification result visible when the local calendar has no recording', async () => {
  const id = '0123456789abcdef01234567'
  const previous = mock.call.getMockImplementation()!
  mock.call.mockImplementation(async (op, params) => {
    if (op === 'recordings.workflow') return { version: { id, status: 'done', selectable: true, generationStage: 1, generatedAtMillis: dateStamp, content: '保留的历史总结', timelineEvents: [] } }
    const value = await previous(op, params)
    if (op === 'recordings.day') return { ...value, totalDurationMillis: 0, transcript: { ...value.transcript, state: 'empty', totalDurationMillis: 0 }, coverage: { state: 'empty', intervals: [] }, summary: { state: 'empty', items: [] } }
    return value
  })
  const window = { date: '2026-10-09', timeZone: 'America/New_York', dateStamp: Date.parse('2026-10-09T00:00:00-04:00'), endStamp: Date.parse('2026-10-10T00:00:00-04:00') }
  await act(async () => { arkmeUi.showRecordingSummaryTarget(window.dateStamp, id, window); renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
  expect(JSON.stringify(renderer!.toJSON())).toContain('保留的历史总结')
})
