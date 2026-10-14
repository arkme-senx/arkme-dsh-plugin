import { describe, expect, it } from 'vitest'
import { callSummaryNeedsDetail, renderCallRecordSummary } from '../src/call-record-presentation.js'

function call() {
  return {
    caller_user_id: 77, callee_user_ids: [42], connected_user_ids: [42, 77],
    participant_profiles: [{ user_id: 77, display_name: '公开昵称' }, { user_id: 42, display_name: 'Tison' }],
    call_summary_template: '{{speaker:s1}}与{{speaker:s4}}确认排期。',
    call_summary_speaker_labels: {
      '{{speaker:s1}}': '公开昵称方说话人A', '{{speaker:s2}}': '公开昵称方说话人B',
      '{{speaker:s3}}': 'Tison方说话人A', '{{speaker:s4}}': 'Tison方说话人B',
    } as Record<string, string>,
    // Deliberately shuffled, with speaker numbers different from first-appearance order.
    room_transcript_segments: [
      { speaker_user_id: 42, speaker_num: 1, speaker_profile_segment_key: 'self', start_ms: 30, end_ms: 40, text: '确认' },
      { speaker_user_id: 77, speaker_num: 2, speaker_profile_segment_key: 'peer', start_ms: 0, end_ms: 10, text: '排期' },
      { speaker_user_id: 42, speaker_num: 2, speaker_profile_segment_key: 'self', start_ms: 10, end_ms: 20, text: '嗯' },
      { speaker_user_id: 77, speaker_num: 1, speaker_profile_segment_key: 'peer', start_ms: 20, end_ms: 30, text: '嗯' },
    ],
  }
}

describe('call summary participant perspective', () => {
  it('renders both viewers from one template with their own private contact names', () => {
    const source = { ...call(), call_summary_template: '{{speaker:s1}}与{{speaker:s4}}确认排期。' }
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇']]))).toBe('万宇与你确认排期。')
    expect(renderCallRecordSummary(source, 77, new Map([[42, 'Tison']]))).toBe('你与Tison确认排期。')
    expect(renderCallRecordSummary(source, 42, new Map([[77, '新的备注']]))).toBe('新的备注与你确认排期。')
    expect(source.call_summary_speaker_labels['{{speaker:s1}}']).toBe('公开昵称方说话人A')
  })

  it('keeps explicitly bound guests and private speaker remarks ahead of device ownership', () => {
    const source = { ...call(), call_summary_template: '{{speaker:s1}}与{{speaker:s4}}确认排期。',
      call_summary_speaker_user_ids: { s1: 88 } }
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇'], [88, '小林']]))).toBe('小林与你确认排期。')
    source.call_summary_speaker_labels['{{speaker:s4}}'] = '现场同事'
    expect(renderCallRecordSummary(source, 42, new Map([[88, '小林']]))).toBe('小林与现场同事确认排期。')
  })

  it('does not merge independent speakers from the same endpoint', () => {
    const source = { ...call(), call_summary_template: '{{speaker:s1}}、{{speaker:s2}}与{{speaker:s4}}确认排期。' }
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇']]))).toBe('公开昵称方说话人A、公开昵称方说话人B与你确认排期。')
    source.call_summary_template = '{{user:77}}与{{speaker:s1}}确认排期。'
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇']]))).toBe('万宇与公开昵称方说话人A确认排期。')
  })

  it('merges multiple groups only when their explicit bindings confirm the same person', () => {
    const source = { ...call(), call_summary_template: '{{speaker:s1}}与{{speaker:s2}}都提到了{{speaker:s4}}。',
      call_summary_speaker_user_ids: { s1: 77, s2: 77, s4: 42 } }
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇']]))).toBe('万宇与万宇都提到了你。')
  })

  it.each(['missing transcript', 'missing label', 'different order', 'third participant', 'unknown speaker'])('keeps ambiguous labels for %s', scenario => {
    const source = { ...call(), call_summary_template: '{{speaker:s1}}与{{speaker:s4}}确认排期。' }
    if (scenario === 'missing transcript') source.room_transcript_segments = []
    if (scenario === 'missing label') delete source.call_summary_speaker_labels['{{speaker:s2}}']
    if (scenario === 'different order') source.call_summary_speaker_labels['{{speaker:s1}}'] = '公开昵称方说话人B'
    if (scenario === 'third participant') source.callee_user_ids.push(88)
    if (scenario === 'unknown speaker') source.room_transcript_segments[0]!.speaker_user_id = 88
    expect(renderCallRecordSummary(source, 42, new Map([[77, '万宇']]))).toContain('公开昵称方说话人')
  })

  it('requests detail only when the aggregate lacks a usable speaker identity', () => {
    expect(callSummaryNeedsDetail({ call_summary_template: '{{speaker:s1}}确认排期' })).toBe(true)
    expect(callSummaryNeedsDetail(call())).toBe(true)
    expect(callSummaryNeedsDetail({ smt: '{{speaker:s1}}确认排期', ssu: { s1: 77 } })).toBe(false)
    expect(callSummaryNeedsDetail({ smt: '{{speaker:s1}}确认排期', ssl: { s1: '现场同事' } })).toBe(false)
    expect(callSummaryNeedsDetail({ smt: '{{user:77}}确认排期' })).toBe(false)
  })
})
