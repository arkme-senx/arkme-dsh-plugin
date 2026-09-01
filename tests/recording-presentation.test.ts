import { describe, expect, it } from 'vitest'
import {
  parseRecordingTimeline,
  recordingPendingTranscriptionCount,
  projectRecordingTranscripts,
  projectRecordingVersions,
} from '../src/recording-presentation.js'

describe('recording presentation', () => {
  it('keeps Audio owner transcription progress distinct from an empty day', () => {
    expect(recordingPendingTranscriptionCount({
      session_ls: [{ id: 'session-1', start_at: 1_000, end_at: 10_000 }],
      child_ls: [
        { id: 'pending-child', session_id: 'session-1', start_at: 0, has_asr: false, asr: [] },
        { id: 'ready-child', session_id: 'session-1', start_at: 1_000, has_asr: true, asr: [{ t: '已完成' }] },
        { id: 'legacy-child', session_id: 'session-1', start_at: 2_000, asr: [] },
        { id: 'orphan-child', session_id: 'missing', start_at: 0, has_asr: false, asr: [] },
      ],
    })).toBe(1)
  })

  it('keeps owner transcript intervals on the desktop local 1970-01-01 lower bound', () => {
    const dayStart = new Date(1970, 0, 1).getTime()
    const sessionStart = Math.max(0, dayStart)
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-epoch', start_at: sessionStart, end_at: sessionStart + 60_000,
        operate_at: sessionStart + 60_000, spk_ls: [{ num: 1 }],
      }],
      child_ls: [{
        id: 'child-epoch', session_id: 'session-epoch', start_at: 0,
        asr: [
          { s: 1_000, e: 2_000, n: 1, t: '早期录音' },
          { s: 70_000, e: 71_000, n: 1, t: '越过会话边界' },
        ],
      }],
    }, [], new Map(), { dayStartMillis: dayStart, dayEndMillis: dayStart + 86_400_000 })

    expect(items).toEqual([expect.objectContaining({
      text: '早期录音', startAtMillis: sessionStart + 1_000, endAtMillis: sessionStart + 2_000,
    })])
  })

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
          { s: 1_000, e: 2_000, n: 1, t: ' 我来同步 ', b: 0 },
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
        asrItemIndex: 0, transcriptSource: 'system',
        childAsrItemStartAt: 1_000, childAsrItemEndAt: 2_000, formalSpeakerId: 'speaker-me',
        sourceSpeakerNumber: 1, assignmentSpeakerNumber: 1,
        speakerIdentity: 'speaker:speaker-me',
        startAtMillis: 1_700_000_001_500, endAtMillis: 1_700_000_002_500,
        speakerNumber: 4, speakerColorIndex: 0, speakerLabel: '说话人 4',
        isSelf: true, isBackground: false, text: '我来同步',
      },
      {
        itemId: 'child-1:1', sessionId: 'session-1', childId: 'child-1',
        asrItemIndex: 1, transcriptSource: 'system',
        childAsrItemStartAt: 3_000, childAsrItemEndAt: 4_000, formalSpeakerId: '',
        sourceSpeakerNumber: 2, assignmentSpeakerNumber: 2,
        speakerIdentity: 'inner:G',
        startAtMillis: 1_700_000_003_500, endAtMillis: 1_700_000_004_500,
        speakerNumber: 5, speakerColorIndex: 1, speakerLabel: '说话人 5',
        isSelf: false, isBackground: true, text: '背景讨论',
      },
      {
        itemId: 'child-1:2', sessionId: 'session-1', childId: 'child-1',
        asrItemIndex: 2, transcriptSource: 'system',
        childAsrItemStartAt: 5_000, childAsrItemEndAt: 6_000, formalSpeakerId: '',
        sourceSpeakerNumber: 3, assignmentSpeakerNumber: 3,
        speakerIdentity: 'inner:H',
        startAtMillis: 1_700_000_005_500, endAtMillis: 1_700_000_006_500,
        speakerNumber: 3, speakerColorIndex: 2, speakerLabel: '说话人 3',
        isSelf: false, isBackground: false, text: '数字回退',
      },
    ])
  })

  it('uses the labelled speaker name and associated avatar when available', () => {
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-1', belong_usr: 7, start_at: 1_700_000_000_000,
        spk_ls: [{ num: 1, spk_id: 'speaker-1' }],
      }],
      child_ls: [{
        id: 'child-1', session_id: 'session-1', start_at: 0,
        asr: [{ s: 0, e: 1_000, n: 1, t: '已标记的发言' }],
      }],
    }, [{ speaker_id: 'speaker-1', ref_usr_id: 42, nick_name: '英梦华' }], new Map([
      [42, { displayName: '小林', avatarRef: 'arkme-profile-image-v1.avatar' }],
    ]))

    expect(items).toEqual([expect.objectContaining({
      speakerLabel: '英梦华', speakerAvatarRef: 'arkme-profile-image-v1.avatar', isSelf: false,
    })])
  })

  it('keeps the owner q assignment separate from the source audio speaker number', () => {
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-1', belong_usr: 7, start_at: 1_700_000_000_000,
        spk_ls: [
          { num: 1, spk_id: 'speaker-source' },
          { num: -1, spk_id: 'speaker-assigned' },
        ],
      }],
      child_ls: [{
        id: 'child-1', session_id: 'session-1', start_at: 0,
        asr: [{ s: 0, e: 1_000, n: 1, q: 'speaker-assigned', t: '单片段改过说话人' }],
      }],
    }, [
      { id: 'speaker-source', nick_name: '原始声纹' },
      { id: 'speaker-assigned', ref_usr_id: 7, nick_name: '本人' },
    ])

    expect(items).toEqual([expect.objectContaining({
      formalSpeakerId: 'speaker-assigned',
      sourceSpeakerNumber: 1,
      assignmentSpeakerNumber: -1,
      speakerIdentity: 'speaker:speaker-assigned',
      speakerNumber: -1,
      speakerColorIndex: 1,
      speakerLabel: '本人',
      isSelf: true,
    })])
  })

  it('keeps only complete owner segments inside the selected local day', () => {
    const dayStart = new Date(2026, 7, 20).getTime()
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-1', start_at: dayStart - 60_000, end_at: dayStart + 120_000,
        operate_at: dayStart + 1_000, spk_ls: [{ num: 1 }],
      }],
      child_ls: [{
        id: 'child-1', session_id: 'session-1', start_at: dayStart - 60_000,
        asr: [
          { s: 0, e: 30_000, n: 1, t: '前一天内容' },
          { s: 50_000, e: 80_000, n: 1, t: '跨零点内容' },
          { s: 90_000, e: 110_000, n: 1, t: '当天内容' },
        ],
      }],
    }, [], new Map(), { dayStartMillis: dayStart, dayEndMillis: dayStart + 86_400_000 })

    expect(items.map(value => [value.text, value.startAtMillis, value.endAtMillis])).toEqual([
      ['当天内容', dayStart + 30_000, dayStart + 50_000],
    ])
  })

  it('keeps the newer effective session when overlapping owner sessions describe the same speaker interval', () => {
    const dayStart = new Date(2026, 7, 20).getTime()
    const items = projectRecordingTranscripts({
      session_ls: [
        { id: 'old', start_at: dayStart, end_at: dayStart + 120_000, operate_at: 10, spk_ls: [{ num: 1, spk_id: 'speaker-a' }] },
        { id: 'new', start_at: dayStart + 30_000, end_at: dayStart + 90_000, operate_at: 20, spk_ls: [{ num: 1, spk_id: 'speaker-a' }] },
      ],
      child_ls: [
        { id: 'old-child', session_id: 'old', start_at: dayStart, asr: [{ s: 40_000, e: 50_000, n: 1, t: '旧内容' }] },
        { id: 'new-child', session_id: 'new', start_at: dayStart + 30_000, asr: [{ s: 10_000, e: 20_000, n: 1, t: '新内容' }] },
      ],
    }, [], new Map(), { dayStartMillis: dayStart, dayEndMillis: dayStart + 86_400_000 })

    expect(items.map(value => value.text)).toEqual(['新内容'])
  })

  it('keeps the newest uploaded segment when the same speaker interval overlaps', () => {
    const dayStart = new Date(2026, 7, 20).getTime()
    const items = projectRecordingTranscripts({
      session_ls: [{
        id: 'session-1', start_at: dayStart, end_at: dayStart + 120_000,
        operate_at: 30, spk_ls: [{ num: 1, spk_id: 'speaker-a' }],
      }],
      child_ls: [
        { id: 'old-child', session_id: 'session-1', start_at: 0, upload_at: 10, asr: [{ s: 40_000, e: 60_000, n: 1, t: '旧上传' }] },
        { id: 'new-child', session_id: 'session-1', start_at: 0, upload_at: 20, asr: [{ s: 45_000, e: 55_000, n: 1, t: '新上传' }] },
      ],
    }, [], new Map(), { dayStartMillis: dayStart, dayEndMillis: dayStart + 86_400_000 })

    expect(items.map(value => value.text)).toEqual(['新上传'])
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
