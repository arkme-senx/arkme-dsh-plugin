import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CallHistoryService } from '../src/services/call-history-service.js'
import { ArkmeCallTranscript, callTranscriptClock } from '../src/client/ArkmeCallTranscript.js'

describe('call transcript identity and time', () => {
  it('resolves actual speakers, absolute timestamps and the real hangup actor', async () => {
    const start = 1788949920000
    const runtime = {
      stateStore: { uniqueCode: async () => 'test-key' },
      requireSession: async () => ({ userId: 42 }), requestScope: () => 'test',
      authenticatedWebrtcPost: async () => ({
        caller_user_id: 42, callee_user_ids: [77], call_result: 'NormalEnd', start_time: start / 1000,
        accept_time: start / 1000, end_time: start / 1000 + 9, call_media_type: 0,
        room_transcript_segments: [
          { speaker_user_id: 42, start_ms: start + 3000, end_ms: start + 4000, text: '我这边确认了' },
          { speaker_user_id: 77, start_ms: start, end_ms: start + 1000, text: '你好' },
        ], member_actions: [{ action: 'hangup', user_id: 42 }],
      }),
    }
    const profile = {
      publicProfileSummariesByUserIds: async () => new Map([[42, { displayName: '自己', avatarUrl: 'https://example.test/me' }], [77, { displayName: '同事', avatarUrl: 'https://example.test/peer' }]]),
      sealProfileImageRef: async (_viewer: number, user: number) => `avatar-${user}`,
    }
    const owner = new CallHistoryService(runtime as never, profile as never)
    const record = await owner.timelineCallRecord({ crd: { ri: 'test-room', cr: 42, mt: 'Audio', rs: 'NormalEnd' } }, 42)
    const detail = await owner.callDetail(record!.callRef!)
    expect(detail.participants).toEqual([
      { userId: 42, displayName: '自己', isCurrentUser: true, avatarRef: 'avatar-42' },
      { userId: 77, displayName: '同事', avatarRef: 'avatar-77' },
    ])
    expect(detail.transcriptSegments.map(segment => [segment.speakerDisplayName, segment.startMillis, segment.spokenAtMillis])).toEqual([
      ['同事', 0, start], ['自己', 3000, start + 3000],
    ])
    expect(detail.hangupParticipant?.displayName).toBe('自己')
    const html = renderToStaticMarkup(<ArkmeCallTranscript detail={detail} />)
    expect(html).toContain('data-arkme-call-speaker="self"')
    expect(html).toContain('data-arkme-call-speaker="peer"')
    expect(html).toContain('--arkme-chat-self-bubble')
    expect(html).toContain('自己已挂断通话')
    expect(html).not.toContain('Arkme 用户')
    expect(html).toContain(callTranscriptClock(3000, start, start + 3000))
  })
})
