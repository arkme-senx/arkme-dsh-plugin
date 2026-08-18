import { describe, expect, it } from 'vitest'
import {
  callListParticipantUserIds,
  callListRoomIds,
  projectCallDetail,
  projectCallListPage,
} from '../src/call-presentation.js'

const listPage = {
  items: [
    {
      source: 'trtc',
      stable_id: 'trtc:room-a',
      sort_time_ms: 1_700_000_000_000,
      call_media_type: 0,
      trtc: {
        room_id: 'room-a',
        caller_user_id: 101,
        callee_user_ids: [202],
        call_media_type: 0,
        call_result: 'answered',
        start_time: 1_700_000_000,
        accept_time: 1_700_000_005,
        end_time: 1_700_000_065,
        create_at: 1_700_000_000_000,
        connected_user_ids: [101, 202],
        call_summary: '  讨论了\n 发布节奏。  ',
        call_summary_status: 'done',
      },
    },
    {
      source: 'wechat_import',
      stable_id: 'wechat:ignored',
      sort_time_ms: 1_699_999_999_999,
      call_media_type: 0,
      wechat_import: { record_uid: 'ignored' },
    },
    {
      source: 'trtc',
      stable_id: 'trtc:room-group',
      sort_time_ms: 1_690_000_000_123,
      call_media_type: 1,
      trtc: {
        room_id: 'room-group',
        caller_user_id: 303,
        callee_user_ids: [101, 202, 202],
        call_media_type: 1,
        call_result: 'done',
        start_time: 0,
        accept_time: 1_690_000_010,
        end_time: 1_690_000_040,
        create_at: 1_690_000_000_000,
        connected_user_ids: [101, 202, 303],
        call_summary: '',
        call_summary_status: 'processing',
      },
    },
    {
      source: 'trtc',
      stable_id: 'trtc:bad-room',
      trtc: { room_id: ' ', caller_user_id: 999, callee_user_ids: [101] },
    },
  ],
  has_more: true,
  next_cursor: 'opaque-next',
}

const callRefs = new Map([
  ['room-a', 'jotmo-call-ref-a'],
  ['room-group', 'jotmo-call-ref-group'],
])
const names = new Map([[101, '我自己'], [202, '小林'], [303, '阿青']])

function listProjection(raw: unknown = listPage) {
  return projectCallListPage(raw, {
    viewerUserId: 101,
    displayNamesByUserId: names,
    callRefByRoomId: callRefs,
  })
}

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    room_id: 'room-a',
    caller_user_id: 101,
    callee_user_ids: [202],
    connected_user_ids: [101, 202],
    call_media_type: 0,
    call_result: 'answered',
    start_time: 1_700_000_000,
    accept_time: 1_700_000_005,
    end_time: 1_700_000_065,
    call_summary: '讨论了发布节奏。',
    call_summary_status: 'done',
    call_summary_speaker_user_ids: { speaker_1: 101 },
    call_transcription_progress: {
      enabled: true,
      overall_status: 'done',
      current_stage: 'done',
      stages: [],
      quota_owner_user_id: 101,
    },
    participant_profiles: [
      { user_id: 101, display_name: '本人昵称', avatar_url: 'SECRET_URL' },
      { user_id: 202, display_name: '小林', avatar_url: 'SECRET_PROFILE_URL' },
    ],
    room_transcript_segments: [
      {
        start_ms: 0,
        end_ms: 1_500,
        text: '今天确认发布节奏。',
        speaker_user_id: 101,
        speaker_num: 1,
        confidence: 0.99,
        audio_url: 'SECRET_URL',
        spk_id: 'SECRET_SPK',
      },
      {
        start_ms: 1_600,
        end_ms: 3_200,
        text: '我来跟进。',
        speaker_user_id: 202,
        speaker_num: 2,
        inner_spk_remark: '不应覆盖参与人昵称',
        speaker_profile_segment_key: 'SECRET_KEY',
      },
      {
        start_ms: 3_300,
        end_ms: 3_500,
        text: '  ',
        speaker_user_id: 0,
        inner_spk_id: 'SECRET_SPK',
      },
    ],
    recording_url: 'SECRET_URL',
    recording_segments: [{ object_key: 'SECRET_KEY', file_id: 'SECRET_FILE' }],
    video_clips: [{ file_name: 'SECRET_FILE', trtc_account: 'SECRET_ACCOUNT' }],
    member_actions: [{ user_id: 101, action: 'join' }],
    ...overrides,
  }
}

describe('call list projection', () => {
  it('extracts unique room and participant identifiers only from valid TRTC rows', () => {
    expect(callListRoomIds(listPage)).toEqual(['room-a', 'room-group'])
    expect(callListParticipantUserIds(listPage)).toEqual([101, 202, 303])
  })

  it('normalizes valid TRTC rows while preserving opaque pagination', () => {
    expect(listProjection()).toEqual({
      items: [
        {
          callRef: 'jotmo-call-ref-a',
          displayName: '小林',
          participantCount: 2,
          mediaType: 'audio',
          direction: 'outgoing',
          connected: true,
          startedAtMillis: 1_700_000_000_000,
          acceptedAtMillis: 1_700_000_005_000,
          endedAtMillis: 1_700_000_065_000,
          durationMillis: 60_000,
          summaryState: 'ready',
          summaryPreview: '讨论了 发布节奏。',
        },
        {
          callRef: 'jotmo-call-ref-group',
          displayName: '小林、阿青（3人）',
          participantCount: 3,
          mediaType: 'video',
          direction: 'group',
          connected: true,
          startedAtMillis: 1_690_000_000_123,
          acceptedAtMillis: 1_690_000_010_000,
          endedAtMillis: 1_690_000_040_000,
          durationMillis: 30_000,
          summaryState: 'processing',
          summaryPreview: '',
        },
      ],
      hasMore: true,
      nextCursor: 'opaque-next',
    })
  })

  it('uses safe names and connected-state fallbacks without exposing identifiers', () => {
    const result = projectCallListPage({
      items: [{
        source: 'trtc',
        sort_time_ms: 1_700_000_000_000,
        trtc: {
          room_id: 'room-fallback',
          caller_user_id: 101,
          callee_user_ids: [909],
          call_media_type: 9,
          call_result: 'missed',
          start_time: 1_700_000_000_000,
          end_time: 1_700_000_100_000,
          connected_user_ids: [101, 909],
          call_summary: 'unused',
          call_summary_status: 'failed',
        },
      }],
      has_more: false,
    }, {
      viewerUserId: 101,
      displayNamesByUserId: new Map(),
      callRefByRoomId: new Map([['room-fallback', 'safe-ref']]),
    })
    expect(result.items[0]).toMatchObject({
      callRef: 'safe-ref',
      displayName: '即我用户',
      mediaType: 'unknown',
      connected: false,
      summaryState: 'failed',
    })
    expect(JSON.stringify(result)).not.toMatch(/room-fallback|\b101\b|\b909\b/)
  })

  it('truncates summary previews by Unicode code point', () => {
    const summary = `${'😀'.repeat(160)}末`
    const raw = structuredClone(listPage)
    raw.items[0]!.trtc!.call_summary = summary
    const preview = listProjection(raw).items[0]!.summaryPreview
    expect([...preview]).toHaveLength(160)
    expect(preview).toBe('😀'.repeat(160))
  })

  it('rejects an uncontinuable page contract', () => {
    expect(() => listProjection({ items: [], has_more: true }))
      .toThrow(expect.objectContaining({ code: 'call-list-contract-invalid' }))
  })
})

describe('call detail projection', () => {
  it('builds a plain browser-safe detail DTO and strips upstream secrets', () => {
    const detail = projectCallDetail(detailFixture(), {
      viewerUserId: 101,
      expectedRoomId: 'room-a',
      callRef: 'jotmo-call-ref-a',
    })

    expect(detail).toEqual({
      callRef: 'jotmo-call-ref-a',
      displayName: '小林',
      participants: [
        { displayName: '我', isSelf: true, connected: true },
        { displayName: '小林', isSelf: false, connected: true },
      ],
      mediaType: 'audio',
      direction: 'outgoing',
      connected: true,
      startedAtMillis: 1_700_000_000_000,
      acceptedAtMillis: 1_700_000_005_000,
      endedAtMillis: 1_700_000_065_000,
      durationMillis: 60_000,
      summary: { state: 'ready', content: '讨论了发布节奏。', message: '' },
      transcript: {
        state: 'ready',
        message: '',
        items: [
          {
            itemId: 'segment-1-0-1500',
            startOffsetMillis: 0,
            endOffsetMillis: 1_500,
            speakerLabel: '我',
            isSelf: true,
            text: '今天确认发布节奏。',
          },
          {
            itemId: 'segment-2-1600-3200',
            startOffsetMillis: 1_600,
            endOffsetMillis: 3_200,
            speakerLabel: '小林',
            isSelf: false,
            text: '我来跟进。',
          },
        ],
      },
    })

    const serialized = JSON.stringify(detail)
    for (const sentinel of ['SECRET_URL', 'SECRET_KEY', 'SECRET_FILE', 'SECRET_ACCOUNT', 'SECRET_SPK']) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(serialized).not.toMatch(/room-a|"userId"|speaker_user_id|confidence|quota/)
  })

  it.each([
    ['processing', 'processing'],
    ['failed', 'failed'],
  ] as const)('lets %s transcription progress override visible segments', (overallStatus, state) => {
    const detail = projectCallDetail(detailFixture({
      call_transcription_progress: { enabled: true, overall_status: overallStatus },
    }), {
      viewerUserId: 101,
      expectedRoomId: 'room-a',
      callRef: 'safe-ref',
    })
    expect(detail.transcript).toMatchObject({ state, items: [] })
  })

  it('uses anonymous speaker remarks and terminal empty section states', () => {
    const detail = projectCallDetail(detailFixture({
      call_summary: '',
      call_summary_status: 'done',
      call_transcription_progress: { enabled: true, overall_status: 'done' },
      room_transcript_segments: [{
        start_ms: 10,
        end_ms: 20,
        text: '匿名发言',
        speaker_user_id: 0,
        speaker_num: 4,
        inner_spk_remark: '客户',
      }],
    }), {
      viewerUserId: 101,
      expectedRoomId: 'room-a',
      callRef: 'safe-ref',
    })
    expect(detail.summary).toMatchObject({ state: 'empty', content: '' })
    expect(detail.transcript.items[0]).toMatchObject({ speakerLabel: '客户', isSelf: false })

    const empty = projectCallDetail(detailFixture({
      call_transcription_progress: { enabled: true, overall_status: 'done' },
      room_transcript_segments: [],
    }), {
      viewerUserId: 101,
      expectedRoomId: 'room-a',
      callRef: 'safe-ref',
    })
    expect(empty.transcript).toMatchObject({ state: 'empty', items: [] })
  })

  it('rejects detail for a room other than the verified call reference', () => {
    expect(() => projectCallDetail(detailFixture({ room_id: 'room-other' }), {
      viewerUserId: 101,
      expectedRoomId: 'room-a',
      callRef: 'safe-ref',
    })).toThrow(expect.objectContaining({ code: 'call-detail-contract-invalid' }))
  })
})
