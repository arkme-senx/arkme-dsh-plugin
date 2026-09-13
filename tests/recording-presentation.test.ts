import { describe, expect, it } from 'vitest'
import {
  buildRecordingGenerationTranscript,
  parseRecordingTimeline,
  projectRecordingVersions,
} from '../src/recording-presentation.js'

describe('recording presentation', () => {
  it('builds the desktop generation transcript without leaking owner selectors', () => {
    const dayStart = new Date(2026, 7, 31).getTime()
    const transcript = buildRecordingGenerationTranscript([{
      itemId: 'private-item', sessionId: 'session-secret', childId: 'child-secret', asrItemIndex: 0,
      transcriptSource: 'system', childAsrItemStartAt: 1_000, childAsrItemEndAt: 6_000,
      formalSpeakerId: 'speaker-secret', sourceSpeakerNumber: 1, assignmentSpeakerNumber: 1,
      speakerIdentity: 'speaker:speaker-secret', startAtMillis: dayStart + 14 * 3_600_000,
      endAtMillis: dayStart + 14 * 3_600_000 + 5_600, speakerNumber: 1, speakerColorIndex: 0,
      speakerLabel: '小林', isSelf: false, isBackground: true, text: '键盘敲击声',
      generationText: '(背景音) 键盘敲击声', event: '工作',
    }], 'timeline', dayStart)

    expect(transcript).toContain('说话人：小林')
    expect(transcript).toContain('[important_note]: 这句话不是我本人说的')
    expect(transcript).toContain('[2026-08-31 14:00:00 6秒] 工作：')
    expect(transcript).toContain('(背景音) 键盘敲击声')
    expect(transcript).not.toContain('[背景音]')
    expect(transcript).toContain('其中，没有发现我自己说的话')
    expect(transcript).toContain('直接输出「时间轴」正文内容')
    expect(transcript).not.toContain('session-secret')
    expect(transcript).not.toContain('child-secret')
    expect(transcript).not.toContain('speaker-secret')
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
