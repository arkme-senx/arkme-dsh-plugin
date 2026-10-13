import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeRecordingNotificationDetail, recordingNoticeTitle } from '../src/client/ArkmeRecordingNotificationDetail.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { RecordingWorkflowNotice } from '../src/recording-workflow-contract.js'
const notice: RecordingWorkflowNotice = { id: 'notice-0001', batchId: 'batch-0001', timeZone: 'America/New_York', stage: 'analysis', state: 'partial', fileCount: 2, completedCount: 2, failedCount: 0, atMillis: 1000, readAtMillis: 0, message: '时间轴生成失败', days: [
  { date: '2026-10-09', dateStamp: Date.parse('2026-10-09T00:00:00-04:00'), endStamp: Date.parse('2026-10-10T00:00:00-04:00'), summary: { state: 'completed', versionId: 'summary-old' }, timeline: { state: 'failed' } },
  { date: '2026-10-10', dateStamp: Date.parse('2026-10-10T00:00:00-04:00'), endStamp: Date.parse('2026-10-11T00:00:00-04:00'), summary: { state: 'completed', versionId: 'summary-new' }, timeline: { state: 'completed', versionId: 'timeline-new' } },
] }
it('opens the chosen recording date and exact generated version, withholding failed result links', () => {
  const summary = vi.spyOn(arkmeUi, 'showRecordingSummaryTarget'), timeline = vi.spyOn(arkmeUi, 'showRecordingTimelineTarget')
  let renderer!: ReturnType<typeof create>
  act(() => { renderer = create(<ArkmeRecordingNotificationDetail notice={notice} onClose={() => {}} />) })
  const buttons = renderer.root.findAllByType('button')
  const summaries = buttons.filter(b => b.children.includes('查看总结'))
  const timelines = buttons.filter(b => b.children.includes('查看时间轴'))
  expect(summaries).toHaveLength(2); expect(timelines).toHaveLength(1)
  act(() => { summaries[0]!.props.onClick(); timelines[0]!.props.onClick() })
  expect(summary).toHaveBeenCalledWith(Date.parse('2026-10-09T00:00:00-04:00'), 'summary-old', expect.objectContaining({ date: '2026-10-09', timeZone: 'America/New_York' }))
  expect(timeline).toHaveBeenCalledWith(Date.parse('2026-10-10T00:00:00-04:00'), 'timeline-new', expect.objectContaining({ date: '2026-10-10', timeZone: 'America/New_York' }))
  expect(arkmeUi.getSnapshot().recordingTarget?.timeline?.versionId).toBe('timeline-new')
  act(() => renderer.unmount()); vi.restoreAllMocks()
})
it('never describes partial processing as all complete', () => {
  expect(recordingNoticeTitle({ ...notice, stage: 'processing', state: 'partial' })).toBe('录音处理未全部完成')
  expect(recordingNoticeTitle(notice)).toBe('录音整理未全部完成')
})

it.each(['processing', 'analysis'] as const)('shows an empty-result title for skipped %s without failure actions', stage => {
  const empty = { ...notice, stage, state: 'skipped' as const, message: '没有可供整理的转写', days: [] }
  expect(recordingNoticeTitle(empty)).toBe('录音暂无可整理内容')
  let renderer!: ReturnType<typeof create>
  act(() => { renderer = create(<ArkmeRecordingNotificationDetail notice={empty} onClose={() => {}} />) })
  expect(JSON.stringify(renderer.toJSON())).not.toContain('未全部完成')
  expect(renderer.root.findAllByType('button').map(button => button.children.join(''))).toEqual(['返回通知'])
  act(() => renderer.unmount())
})
it('labels a failed projection as generation failure while preserving the successful link', () => {
  let renderer!: ReturnType<typeof create>
  act(() => { renderer = create(<ArkmeRecordingNotificationDetail notice={notice} onClose={() => {}} />) })
  expect(JSON.stringify(renderer.toJSON())).toContain('生成失败')
  expect(renderer.root.findAllByType('button').filter(button => button.children.includes('查看总结'))).toHaveLength(2)
  act(() => renderer.unmount())
})
