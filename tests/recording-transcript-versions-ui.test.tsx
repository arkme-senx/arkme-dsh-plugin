import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
import type { ArkmeRecordingTranscriptPage, ArkmeRecordingWorkbenchItem } from '../src/types.js'

const calls = vi.hoisted(() => ({ host: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: calls.host }))
vi.mock('../src/client/ArkmeRecordingTour.js', () => ({ useRecordingTour: () => ({ sample: false, panel: null, finish: () => {} }) }))
import { ArkmeRecordingSurface, ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'

function item(text: string, startAt = 1000): ArkmeRecordingWorkbenchItem {
  return {
    itemId: text, itemRef: '', playable: false, transcriptSource: 'system', sessionKey: '',
    startAtMillis: startAt, endAtMillis: startAt + 1000, speakerNumber: 2,
    speakerKey: 'speaker', speakerColorIndex: 2, speakerLabel: '说话人 2', canBindSpeaker: false,
    isSelf: false, isBackground: false, text, textStartOffset: 0, textEndOffset: [...text].length, textTotalLength: [...text].length,
  }
}
function page(dateStamp: number, text: string, versionRef?: string, nextCursor = ''): ArkmeRecordingTranscriptPage {
  return {
    retainedSnapshot: true, dateStamp, viewRef: versionRef ?? 'current-snapshot', transcriptSource: 'system',
    ...(versionRef ? { versionRef } : {}), nextCursor, state: 'ready', message: '',
    totalDurationMillis: 0, processingCount: 0, items: [item(text, nextCursor ? 1000 : 2000)],
  }
}
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => { renderer?.unmount(); renderer = undefined })
  calls.host.mockReset()
})

it('opens a separate history dialog and only switches the affected period', async () => {
  let stamp = 0
  const current = (date: number) => ({ ...page(date, '当前正文'), items: [item('当前正文', 1000), item('未变化正文', 61000), item('后来新增', 121000)] })
  calls.host.mockImplementation(async (op: string, args: { dateStamp: number; versionRef?: string; cursor?: string }) => {
    if (op === 'recordings.day') { stamp = args.dateStamp; return { dateStamp: stamp, totalDurationMillis: 0,
      coverage: { state: 'ready', intervals: [] }, transcript: current(stamp),
      summary: { state: 'empty', items: [], message: '' }, timeline: { state: 'empty', items: [], message: '' } } }
    if (op === 'recordings.transcript.versions') return { supported: true, nextCursor: '', versions: [{ versionRef: 'old', createdAtMillis: 1794000000000 }] }
    if (op === 'recordings.transcript.page') return args.versionRef
      ? { ...page(stamp, '旧正文', 'old'), items: [item('旧正文', 1000), item('未变化正文', 61000)] } : current(stamp)
    if (op === 'recordings.calendar') return { days: [] }
    return { options: [] }
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
  const root = renderer!.root
  expect(root.findAllByProps({ 'aria-label': '历史版本' }).filter(n => n.type === 'select')).toHaveLength(0)
  expect(calls.host.mock.calls.filter(([op, args]) => op === 'recordings.transcript.page' && args.versionRef)).toHaveLength(0)
  await act(async () => { root.findByProps({ 'aria-label': '查看转写历史' }).props.onClick() })
  const dialog = () => root.findByProps({ role: 'dialog' })
  expect(dialog()).toBeDefined()
  const triggers = dialog().findAll(node => node.type === 'button' && node.props['data-history-period-trigger'] !== undefined)
  expect(triggers).toHaveLength(1)
  await act(async () => { triggers[0]!.props.onClick() })
  await act(async () => { dialog().findByProps({ 'data-history-version': 'old' }).props.onClick() })
  expect(dialog().findAllByProps({ className: 'arkme-recording-transcript-content' }).map(n => n.findAllByType('span')[0]?.children.join(''))).toEqual(['旧正文', '未变化正文', '后来新增'])
  expect(root.findAllByProps({ 'data-recording-transcript-item': '当前正文' }).length).toBeGreaterThan(0)
  await act(async () => { dialog().findByProps({ 'aria-label': '关闭转写历史' }).props.onClick() })
  expect(root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  await act(async () => { root.findByProps({ 'aria-label': '查看转写历史' }).props.onClick() })
  expect(dialog().findAllByProps({ 'data-recording-transcript-item': '当前正文' })).toHaveLength(1)
  expect(calls.host.mock.calls.some(([op]) => op === 'recordings.playback.open')).toBe(false)
}, 20_000)

it('removes the added effective ranges and read-only playback control while preserving bubble timestamps', async () => {
  await act(async () => { renderer = create(<ArkmeRecordingTranscriptRow item={{ ...item('部分保留的正文', 1000), endAtMillis: 31000,
    activeRanges: [{ startAtMillis: 1000, endAtMillis: 11000 }, { startAtMillis: 21000, endAtMillis: 31000 }],
  }} selected={false} readOnly onTogglePlayback={() => {}} />) })
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('有效时段')
  expect(renderer!.root.findAllByType('button')).toHaveLength(0)
  expect(renderer!.root.findByProps({ className: 'arkme-recording-transcript-timestamp' }).children.join('')).toMatch(/:00:01$/)
})

it('counts all retained transcript pages while the storage owner reports zero bytes', async () => {
  const zeroStorage = { bytes: 0, archive_bytes: 0, clip_bytes: 0, confirmed_count: 0, pending_count: 0, unknown_count: 0 }
  const withPageMetrics = (value: ArkmeRecordingTranscriptPage) => ({
    ...value, dailyMetrics: projectRecordingDailyMetrics({ ...zeroStorage, unknown_count: 1 }, value.items),
  })
  calls.host.mockImplementation(async (operation: string, { dateStamp, part, cursor }: { dateStamp: number; part?: string; cursor?: string }) => {
    if (operation === 'recordings.day' && part === 'metrics') return { dateStamp, metrics: projectRecordingDailyMetrics(zeroStorage, []) }
    if (operation === 'recordings.day') return {
      dateStamp, totalDurationMillis: 0, coverage: { state: 'ready', intervals: [] },
      transcript: withPageMetrics(page(dateStamp, '保留 正文', undefined, 'retained-rest')),
      summary: { state: 'empty', items: [], message: '' }, timeline: { state: 'empty', items: [], message: '' },
    }
    if (operation === 'recordings.transcript.page' && cursor === 'retained-rest') return withPageMetrics(page(dateStamp, '第二页'))
    if (operation === 'recordings.transcript.versions') return { supported: true, versions: [], nextCursor: '' }
    if (operation === 'recordings.calendar') return { days: [] }
    return { options: [] }
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
  expect(renderer!.root.findAllByProps({ 'aria-label': '查看转写历史' })).toHaveLength(0)
  const metrics = renderer!.root.findByProps({ 'aria-label': '当天录音统计' })
  const labels = metrics.findAllByType('span').map(node => node.children.join(''))
  expect(labels).toContain('云端录音存储 0 B（已记录）')
  expect(labels).toContain('转写 7 字')
  expect(calls.host.mock.calls.filter(([op, params]) => op === 'recordings.transcript.page' && params.cursor === 'retained-rest')).toHaveLength(1)
})
