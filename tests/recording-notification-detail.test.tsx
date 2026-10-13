import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeRecordingNotificationDetail, recordingNoticeTitle } from '../src/client/ArkmeRecordingNotificationDetail.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { RecordingWorkflowNotice } from '../src/recording-workflow-contract.js'
const notice: RecordingWorkflowNotice = { id: 'notice-0001', batchId: 'batch-0001', stage: 'analysis', state: 'partial', fileCount: 2, completedCount: 2, failedCount: 0, atMillis: 1000, readAtMillis: 0, message: '时间轴生成失败', days: [
  { date: '2026-10-09', summary: { state: 'completed', versionId: 'summary-old' }, timeline: { state: 'failed' } },
  { date: '2026-10-10', summary: { state: 'completed', versionId: 'summary-new' }, timeline: { state: 'completed', versionId: 'timeline-new' } },
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
  expect(summary).toHaveBeenCalledWith(new Date(2026, 9, 9).getTime(), 'summary-old')
  expect(timeline).toHaveBeenCalledWith(new Date(2026, 9, 10).getTime(), 'timeline-new')
  expect(arkmeUi.getSnapshot().recordingTarget?.timeline?.versionId).toBe('timeline-new')
  act(() => renderer.unmount()); vi.restoreAllMocks()
})
it('never describes partial processing as all complete', () => {
  expect(recordingNoticeTitle({ ...notice, stage: 'processing', state: 'partial' })).toBe('录音处理未全部完成')
  expect(recordingNoticeTitle(notice)).toBe('录音整理未全部完成')
})
