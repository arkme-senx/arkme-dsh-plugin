import { describe, expect, it } from 'vitest'
import {
  parseRecordingTimeline,
  projectRecordingTranscripts,
  projectRecordingVersions,
} from '../src/recording-presentation.js'

describe('recording presentation', () => {
  it('projects system transcripts with numeric speaker labels and stable color indexes', () => {
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-1', belong_usr: 7, start_at: 1_700_000_000_000,
        spk_ls: [
          { num: 1, spk_id: 'speaker-me', speaker_display_number: 4 },
          { num: 2, spk_id: '', inner_display: 'G', speaker_display_number: 5 },
          { num: 3, spk_id: '', inner_display: 'H' },
        ],
      }],
      child_ls: [{
        id: 'child-1', session_id: 'session-1', start_at: 500,
        asr: [
          { s: 1_000, e: 2_000, n: 1, t: ' 我来同步 ', effective_spk_id: 'speaker-me', b: 0 },
          { s: 3_000, e: 4_000, n: 2, t: '背景讨论', b: 1 },
          { s: 5_000, e: 6_000, n: 3, t: '数字回退' },
          { s: 7_000, e: 8_000, n: 2, t: '   ' },
        ],
        doubao_asr: [{ s: 9_000, e: 10_000, n: 1, t: '不应展示' }],
      }],
    }, [{ id: 'speaker-me', ref_usr_id: 7 }])

    expect(items).toEqual([
      {
        itemId: 'child-1:0', sessionId: 'session-1', childId: 'child-1',
        startAtMillis: 1_700_000_001_500, endAtMillis: 1_700_000_002_500,
        speakerNumber: 4, speakerColorIndex: 0, speakerLabel: '说话人 4',
        isSelf: true, isBackground: false, text: '我来同步',
      },
      {
        itemId: 'child-1:1', sessionId: 'session-1', childId: 'child-1',
        startAtMillis: 1_700_000_003_500, endAtMillis: 1_700_000_004_500,
        speakerNumber: 5, speakerColorIndex: 1, speakerLabel: '说话人 5',
        isSelf: false, isBackground: true, text: '背景讨论',
      },
      {
        itemId: 'child-1:2', sessionId: 'session-1', childId: 'child-1',
        startAtMillis: 1_700_000_005_500, endAtMillis: 1_700_000_006_500,
        speakerNumber: 3, speakerColorIndex: 2, speakerLabel: '说话人 3',
        isSelf: false, isBackground: false, text: '数字回退',
      },
    ])
  })

  it('parses structured and markdown timeline answers into the same display shape', () => {
    expect(parseRecordingTimeline({
      timelines: [{
        start_at: '09:00', end_at: '10:00', title: '周会', description: '同步项目进展',
        position: '会议', emotion: '专注', todo: '整理结论', event_tags: ['工作'],
        dialogue_points: [{ spk_name: '我' }, { spk_name: '小林' }],
      }],
    })).toEqual([{
      eventId: 'event-0', startAt: '09:00', endAt: '10:00', timeRange: '09:00–10:00',
      title: '周会', description: '同步项目进展', scene: '会议', emotion: '专注', todo: '整理结论',
      tags: ['工作'], participants: ['我', '小林'], rawText: '',
    }])

    expect(parseRecordingTimeline(`
# 今日时间轴
## 14:30 - 15:10 方案讨论
- 场景：会议室
- 角色：我（主持人）、说话人G（参与者）
- 发生的事情：确认下一阶段范围
- 我的心情：平静
- 待办：明天输出文档
- 事件标签：工作、讨论
`)).toEqual([{
      eventId: 'event-0', startAt: '14:30', endAt: '15:10', timeRange: '14:30–15:10',
      title: '方案讨论', description: '确认下一阶段范围', scene: '会议室', emotion: '平静',
      todo: '明天输出文档', tags: ['工作', '讨论'], participants: ['我', '说话人G'],
      rawText: expect.stringContaining('场景：会议室'),
    }])
  })

  it('keeps meaningful legacy text but rejects empty structured answers', () => {
    expect(parseRecordingTimeline('今天主要在整理需求\n完成了范围梳理')).toEqual([
      expect.objectContaining({ title: '今天主要在整理需求', description: '完成了范围梳理' }),
    ])
    expect(parseRecordingTimeline('[]')).toEqual([])
    expect(parseRecordingTimeline('{invalid')).toEqual([])
  })

  it('sorts history newest-first and withholds invalid successful answers from selection', () => {
    const versions = projectRecordingVersions({ audio_summary_ls: [
      { id: 'old', kind: 1, status: 2, update_at: 100, answer: '09:00-10:00 旧版本' },
      { id: 'invalid', kind: 1, status: 2, update_at: 300, answer: '无效版本', timeline_snapshot_valid: false },
      { id: 'pending', kind: 1, status: 1, update_at: 400, answer: '' },
      { id: 'new', kind: 1, status: 2, update_at: 200, answer: '10:00-11:00 新版本' },
      { id: 'summary', kind: 2, status: 2, update_at: 500, answer: '日总结' },
    ] }, 'timeline')

    expect(versions.map(item => [item.id, item.status, item.selectable])).toEqual([
      ['pending', 'processing', false],
      ['invalid', 'failed', false],
      ['new', 'done', true],
      ['old', 'done', true],
    ])
  })
})
