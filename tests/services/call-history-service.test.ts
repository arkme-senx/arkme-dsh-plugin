import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { CallHistoryService } from '../../src/services/call-history-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  dataBaseUrl: 'https://data.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

const sessions: ArkmeSessionStore = {
  async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
  async write() {},
  async delete() {},
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function service(fetchImpl: typeof fetch, override: Partial<ArkmeServiceConfig> = {}): CallHistoryService {
  const runtime = new ServiceRuntime(
    { ...config, ...override },
    sessions,
    { async uniqueCode() { return 'call-history-secret' } } as StateStore,
    fetchImpl,
  )
  return new CallHistoryService(runtime, new ProfileService(runtime))
}

describe('CallHistoryService', () => {
  it('lists safe call history without leaking raw room or media fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://data.test/api/v1/call/history-aggregate')
      return envelope({
        items: [{
          stable_id: 'trtc:room-1',
          sort_time_ms: 1_787_310_000_000,
          trtc: {
            room_id: 'room-1',
            caller_user_id: 42,
            callee_user_ids: [77],
            connected_user_ids: [77],
            call_media_type: 0,
            call_result: 'NormalEnd',
            start_time: 1_787_310_000,
            accept_time: 1_787_310_003,
            end_time: 1_787_310_063,
            call_summary_status: 'done',
            call_summary: '确认了周五排期',
            recording_url: 'https://secret.example/recording.m4a',
            user_sig: 'must-not-leak',
          },
        }],
        has_more: true,
        next_cursor: 'next-1',
        recent_contacts: [{ user_id: 77, display_name: '林林' }],
      })
    })

    const page = await service(fetchImpl).listCallHistory({ limit: 10 })

    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: 'next-1',
      items: [{
        peerDisplayName: 'Arkme 用户 77',
        peerUserId: 77,
        mediaType: 'audio',
        durationSeconds: 60,
        resultLabel: '已接通',
        summaryStatus: 'done',
        summaryPreview: '确认了周五排期',
      }],
      recentContacts: [{ userId: 77, displayName: '林林' }],
    })
    expect(page.items[0]!.callRef).toMatch(/^arkme-call-v1\./)
    expect(page.items[0]!.callRef.split('.')).toHaveLength(4)
    for (const segment of page.items[0]!.callRef.split('.').slice(1)) {
      expect(Buffer.from(segment, 'base64url').toString('utf8')).not.toContain('room-1')
    }
    expect(JSON.stringify(page)).not.toContain('room-1')
    expect(JSON.stringify(page)).not.toContain('recording')
    expect(JSON.stringify(page)).not.toContain('user_sig')
  })

  it('attaches opaque avatar refs without leaking raw avatar URLs', async () => {
    const avatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/77/avatar.png?x-oss-signature=avatar'
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/call/history-aggregate')) {
        return envelope({
          items: [{
            stable_id: 'trtc:room-avatar',
            trtc: { room_id: 'room-avatar', caller_user_id: 42, callee_user_ids: [77], connected_user_ids: [77] },
          }],
          has_more: false,
          recent_contacts: [{ user_id: 77, display_name: '林林' }],
        })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        return envelope({ items: [{ user_id: 77, nick_name: '林林', head_img: avatarUrl }] })
      }
      throw new Error(`unexpected ${url}`)
    })

    const page = await service(fetchImpl).listCallHistory({ limit: 10 })

    expect(page.items[0]!.peerDisplayName).toBe('林林')
    expect(page.items[0]!.peerAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(page.recentContacts?.[0]?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(JSON.stringify(page)).not.toContain('jotmo-userfiles-test')
    expect(JSON.stringify(page)).not.toContain('x-oss-signature')
  })

  it('reads detail with an issued call ref and keeps real video record metadata for UI playback', async () => {
    let callRef = ''
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/call/history-aggregate')) {
        return envelope({ items: [{ trtc: { room_id: 'room-2', caller_user_id: 77, callee_user_ids: [42] } }], has_more: false })
      }
      if (url.endsWith('/api/v1/trtc/recent-call-contacts')) return envelope({ contact_user_ids: [] })
      if (url.endsWith('/api/v1/trtc/call-detail')) {
        return envelope({
          room_id: 'room-2',
          title: '和林林的通话',
          call_media_type: 1,
          call_result: 'NormalEnd',
          start_time: 1_787_310_000,
          accept_time: 1_787_310_010,
          end_time: 1_787_310_070,
          call_summary_status: 'done',
          call_summary: '讨论了上线风险',
          participants: [{ user_id: 42, display_name: '我' }, { user_id: 77, display_name: '林林' }],
          transcript_segments: [{
            segment_id: 'seg-1',
            speaker_user_id: 77,
            speaker_display_name: '林林',
            text: '我们周五上线。',
            audio_url: 'https://secret.example/audio.m4a',
          }],
          video_clips: [
            { user_id: 42, url: 'https://media.example/self.mp4', poster_url: 'https://media.example/self.jpg' },
            { user_id: 77, url: 'https://media.example/peer.mp4', poster_url: 'https://media.example/peer.jpg' },
          ],
        })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        return envelope({ items: [
          { user_id: 42, nick_name: '我', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/42/avatar.png?x-oss-signature=me' },
          { user_id: 77, nick_name: '林林', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/77/avatar.png?x-oss-signature=lin' },
        ] })
      }
      throw new Error(`unexpected ${url}`)
    })
    const callService = service(fetchImpl)
    const history = await callService.listCallHistory({ includeRecentContacts: false })
    callRef = history.items[0]!.callRef

    const detail = await callService.callDetail(callRef)

    expect(detail).toMatchObject({
      title: '和林林的通话',
      mediaType: 'video',
      durationSeconds: 60,
      summaryText: '讨论了上线风险',
      participants: [
        { userId: 42, displayName: '我', isCurrentUser: true, avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
        { userId: 77, displayName: '林林', avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
      ],
      transcriptSegments: [{ segmentId: 'seg-1', speakerDisplayName: '林林', text: '我们周五上线。' }],
      videoRecord: {
        available: true,
        source: 'real',
        videoUrl: 'https://media.example/self.mp4',
        posterUrl: 'https://media.example/self.jpg',
        perspectives: [
          { perspective: 'self', videoUrl: 'https://media.example/self.mp4', posterUrl: 'https://media.example/self.jpg' },
          { perspective: 'peer', videoUrl: 'https://media.example/peer.mp4', posterUrl: 'https://media.example/peer.jpg' },
        ],
      },
    })
    expect(JSON.stringify(detail)).not.toContain('room-2')
    expect(JSON.stringify(detail)).not.toContain('audio_url')
    expect(JSON.stringify(detail)).not.toContain('secret.example')
  })

  it('submits summary retry and refreshes detail', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/api/v1/call/history-aggregate')) {
        return envelope({ items: [{ trtc: { room_id: 'room-3', caller_user_id: 42, callee_user_ids: [77] } }], has_more: false })
      }
      if (url.endsWith('/api/v1/trtc/retry-call-summary')) return envelope({ ok: true })
      if (url.endsWith('/api/v1/trtc/call-detail')) {
        return envelope({ room_id: 'room-3', call_summary_status: 'pending' })
      }
      throw new Error(`unexpected ${url}`)
    })
    const callService = service(fetchImpl)
    const history = await callService.listCallHistory({ includeRecentContacts: false })

    await expect(callService.retryCallSummary(history.items[0]!.callRef)).resolves.toMatchObject({
      status: 'submitted',
      detail: { summaryStatus: 'pending' },
    })
    expect(calls.some(url => url.endsWith('/api/v1/trtc/retry-call-summary'))).toBe(true)
  })

  it('rejects invalid refs before calling WebRTC detail', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(service(fetchImpl).callDetail('bad-ref')).rejects.toMatchObject({
      code: 'call-ref-invalid',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails clearly when Data service is not configured', async () => {
    const disabled = service(vi.fn<typeof fetch>(), { dataBaseUrl: '' })
    await expect(disabled.listCallHistory()).rejects.toBeInstanceOf(ArkmePluginError)
    await expect(disabled.listCallHistory()).rejects.toMatchObject({
      code: 'data-service-disabled',
      httpStatus: 503,
    })
  })
})
