import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
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

it('shows retained current text, reads and pages immutable history, disables missing audio, and ignores late history', async () => {
  const delayed = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
  let stamp = 0
  calls.host.mockImplementation(async (operation: string, args: { dateStamp: number; versionRef?: string; cursor?: string }) => {
    if (operation === 'recordings.day') {
      stamp = args.dateStamp
      return {
        dateStamp: stamp, totalDurationMillis: 0, coverage: { state: 'ready', intervals: [] },
        transcript: page(stamp, '删除原音后保留的当前正文'),
        summary: { state: 'empty', items: [], message: '' }, timeline: { state: 'empty', items: [], message: '' },
      }
    }
    if (operation === 'recordings.transcript.versions') {
      return { supported: true, nextCursor: '', versions: [
        { versionRef: 'late-version', createdAtMillis: 1_795_000_000_000 },
        { versionRef: 'read-version', createdAtMillis: 1_794_000_000_000 },
      ] }
    }
    if (operation === 'recordings.transcript.page' && args.versionRef === 'late-version') return delayed.promise
    if (operation === 'recordings.transcript.page' && args.versionRef === 'read-version') {
      return args.cursor
        ? page(stamp, '历史正文第二页', 'read-version')
        : page(stamp, '历史正文第一页', 'read-version', 'fixed-history-cursor')
    }
    if (operation === 'recordings.calendar') return { days: [] }
    return { options: [] }
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
  const root = renderer!.root
  const select = () => root.findByProps({ 'aria-label': '历史版本' })
  const contains = (text: string) => JSON.stringify(renderer!.toJSON()).includes(text)
  const choose = async (value: string) => { await act(async () => { select().props.onChange({ currentTarget: { value } }) }) }
  expect(select().props.value).toBe('')
  expect(select().findAllByType('option').map(option => String(option.props.children))).toEqual([
    '当前版本', expect.stringContaining('更新前'), expect.stringContaining('更新前'),
  ])
  expect(contains('删除原音后保留的当前正文')).toBe(true)
  await choose('late-version')
  const lateCall = calls.host.mock.calls.find(call => call[1]?.versionRef === 'late-version')
  await choose('read-version')
  expect(lateCall?.[2]?.aborted).toBe(true)
  expect(contains('历史正文第一页')).toBe(true)
  expect(contains('删除原音后保留的当前正文')).toBe(false)
  expect(root.findByProps({ 'aria-label': '原音不可用' }).props.disabled).toBe(true)
  expect(root.findAll(node => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('编辑说话人'))).toHaveLength(0)
  expect(contains('恢复此版本')).toBe(false)
  await act(async () => {
    root.findAllByType('button').find(button => button.props.children === '加载更多')!.props.onClick()
  })
  expect(contains('历史正文第一页')).toBe(true)
  expect(contains('历史正文第二页')).toBe(true)
  expect(calls.host.mock.calls.some(([op, args]) => op === 'recordings.transcript.page'
    && args.versionRef === 'read-version' && args.cursor === 'fixed-history-cursor')).toBe(true)
  await choose('')
  await act(async () => { delayed.resolve(page(stamp, '迟到的历史正文', 'late-version')) })
  expect(contains('删除原音后保留的当前正文')).toBe(true)
  expect(contains('迟到的历史正文')).toBe(false)
  expect(contains('历史正文第二页')).toBe(false)
  expect(calls.host.mock.calls.some(([op]) => op === 'recordings.playback.open')).toBe(false)
}, 20_000)

it('labels effective time ranges on one row and disables playback for partially overwritten text', async () => {
  const toggle = vi.fn()
  await act(async () => {
    renderer = create(<ArkmeRecordingTranscriptRow item={{
      ...item('部分保留的正文', 1000), endAtMillis: 31_000,
      activeRanges: [{ startAtMillis: 1000, endAtMillis: 11_000 }, { startAtMillis: 21_000, endAtMillis: 31_000 }],
    }} selected={false} readOnly onTogglePlayback={toggle} />)
  })
  const row = renderer!.root
  expect(row.findAllByType('li')).toHaveLength(1)
  expect(row.findByType('time').props.title).toMatch(/有效时段 .*:00:01–.*:00:11、.*:00:21–.*:00:31/)
  expect(row.findByProps({ 'aria-label': '原音不可用' }).props.disabled).toBe(true)
  expect(toggle).not.toHaveBeenCalled()
})
