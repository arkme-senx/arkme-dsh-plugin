import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { CallHistoryService } from '../../src/services/call-history-service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { MediaService } from '../../src/services/media-service.js'
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
  const profile = new ProfileService(runtime)
  return new CallHistoryService(runtime, profile, new MediaService(runtime, profile, {} as never, {} as never),
    new SourceService(runtime, profile, {} as never))
}

describe('CallHistoryService', () => {
  it('forwards a bounded calendar date range and separates it from ordinary history cache entries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => envelope({ items: [], has_more: false }))
    const subject = service(fetchImpl)
    const startAtMillis = Date.parse('2026-09-20T00:00:00+08:00'), endAtMillis = startAtMillis + 86_400_000
    await subject.listCallHistory({ includeRecentContacts: false })
    await subject.listCallHistory({ startAtMillis, endAtMillis, includeRecentContacts: false })
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies).toContainEqual(expect.objectContaining({ start_at: startAtMillis, end_at: endAtMillis, direction: 'desc' }))
    await expect(subject.listCallHistory({ startAtMillis })).rejects.toMatchObject({ code: 'call-range-invalid' })
  })
  it.each([false, true])('resolves detail summaries by explicit identity without guessing unknown speakers (remark failure: %s)', async remarkFailure => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/trtc/call-detail')) return envelope({
        caller_user_id: 42, callee_user_ids: [77], call_summary_status: 'done',
        participant_profiles: [{ user_id: 77, display_name: '旧昵称' }],
        call_summary_template: '{{user:42}}与{{user:77}}、{{speaker:s1}}、{{speaker:s2}}和{{speaker:s3}}聊天。',
        call_summary_speaker_user_ids: { s1: 88, s3: 99 },
        call_summary_speaker_labels: { s1: '已绑定的人', s2: 'Jotmoer方说话人A', s3: '已标记姓名' },
        room_transcript_segments: [{ speaker_user_id: 77, text: '你好', start_ms: 1000, end_ms: 2000 }],
      })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return envelope({ items: [
        { user_id: 42, nick_name: '自己' }, { user_id: 77, nick_name: 'Jotmoer' }, { user_id: 88, nick_name: 'Jotmoer' },
      ] })
      if (url.endsWith('/api/v1/chats/contacts/list')) {
        if (remarkFailure) throw new Error('contact lookup failed')
        return envelope({ items: [{ user_id: 77, remark: '  英梦华 ' }, { user_id: 88, remark: '安宝' }], has_more: false })
      }
      if (url.endsWith('/api/v1/chats/list')) return envelope({ items: [], has_more: false })
      throw new Error(`unexpected ${url}`)
    })
    const owner = service(fetchImpl)
    const record = await owner.timelineCallRecord({ crd: { ri: 'identity-room', cr: 42, mt: 'Video', rs: 'NormalEnd' } }, 42)
    const detail = await owner.callDetail(record!.callRef!)
    expect(detail.stableId).toBe(record!.stableId)
    expect(detail.stableId).not.toContain('identity-room')
    expect(detail.summaryText).toBe(remarkFailure
      ? '我与Jotmoer、Jotmoer、Jotmoer方说话人A和已标记姓名聊天。'
      : '我与英梦华、安宝、Jotmoer方说话人A和已标记姓名聊天。')
    expect(detail.participants.map(p => p.userId).sort()).toEqual([42, 77])
    expect(detail.transcriptSegments[0]?.speakerDisplayName).toBe(remarkFailure ? 'Jotmoer' : '英梦华')
    expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/api/v1/auth/get-public-users-by-ids'))).toHaveLength(1)
  })

  it('keeps legacy free-form summaries unchanged even when a nickname has a remark', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/trtc/call-detail')) return envelope({ caller_user_id: 42, callee_user_ids: [77],
        call_summary: 'Jotmoer方说话人A和说话人B聊天。' })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return envelope({ items: [{ user_id: 77, nick_name: 'Jotmoer' }] })
      if (url.endsWith('/api/v1/chats/contacts/list')) return envelope({ items: [{ user_id: 77, remark: '英梦华' }], has_more: false })
      throw new Error(`unexpected ${url}`)
    })
    const owner = service(fetchImpl)
    const record = await owner.timelineCallRecord({ crd: { ri: 'legacy-room', cr: 42, mt: 'Audio', rs: 'NormalEnd' } }, 42)
    expect((await owner.callDetail(record!.callRef!)).summaryText).toBe('Jotmoer方说话人A和说话人B聊天。')
  })

  it('renders list summary templates with viewer identity, peer remarks and participant names', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/call/history-aggregate')) return envelope({ items: [
        { trtc: { room_id: 'template', caller_user_id: 42, callee_user_ids: [77], call_summary_status: 'done',
          call_summary_template: '{{speaker:self}}与{{user:77}}确认{{user:88}}的排期',
          call_summary_speaker_user_ids: { self: 42 }, participant_display_names: { 88: '小林' } } },
        { trtc: { room_id: 'fallback', call_summary_status: 'done', call_summary_template: '{{user:999}}确认排期', call_summary: '确认排期' } },
        { trtc: { room_id: 'unresolved', call_summary_status: 'done', call_summary_template: '{{user:999}}确认排期' } },
        { trtc: { room_id: 'label', call_summary_status: 'done', call_summary_template: '{{speaker:guest}}确认排期',
          call_summary_speaker_labels: { guest: '访客' } } },
      ], has_more: false })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return envelope({ items: [{ user_id: 77, nick_name: '昵称' }] })
      if (url.endsWith('/api/v1/chats/contacts/list')) return envelope({ items: [{ user_id: 77, remark: '张总' }], has_more: false })
      if (url.endsWith('/api/v1/chats/list')) return envelope({ items: [], has_more: false })
      throw new Error(`unexpected ${url}`)
    })
    const page = await service(fetchImpl).listCallHistory({ includeRecentContacts: false })
    expect(page.items.map(item => item.summaryPreview)).toEqual(['我与张总确认小林的排期', '确认排期', undefined, '访客确认排期'])
    expect(JSON.stringify(page)).not.toContain('{{')
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('call-detail'))).toBe(false)
  })
  it.each([undefined, 'page2'])('prefers viewer remarks on history page %s by user ID', async cursor => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/call/history-aggregate')) return envelope({
        items: [77, 88].map(id => ({ stable_id: `trtc:room-${id}`, trtc: {
          room_id: `room-${id}`, caller_user_id: 42, callee_user_ids: [id], peer_display_name: '同名用户',
        } })), has_more: false,
      })
      if (url.endsWith('/api/v1/chats/contacts/list')) return envelope({ items: [
        { user_id: 77, remark: '  张总（客户）  ' }, { user_id: 88, remark: '   ' },
      ], has_more: false })
      if (url.endsWith('/api/v1/chats/list')) return envelope({ items: [], has_more: false })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return envelope({ items: [
        { user_id: 77, nick_name: '同名用户' }, { user_id: 88, nick_name: '同名用户' },
      ] })
      throw new Error(`unexpected ${url}`)
    })
    const page = await service(fetchImpl).listCallHistory({ includeRecentContacts: false, ...(cursor ? { cursor } : {}) })
    expect(page.items.map(item => item.peerDisplayName)).toEqual(['张总（客户）', '同名用户'])
  })

  it('falls back to a nickname without an avatar when remark lookup fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/call/history-aggregate')) return envelope({ items: [{
        stable_id: 'trtc:room', trtc: { room_id: 'room', caller_user_id: 42, callee_user_ids: [77] },
      }], has_more: false })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return envelope({ items: [{ user_id: 77, nick_name: '张三' }] })
      throw new Error('contact service unavailable')
    })
    const page = await service(fetchImpl).listCallHistory({ includeRecentContacts: false })
    expect(page.items[0]?.peerDisplayName).toBe('张三')
  })

  it('projects real COS room transcript audio through the local media proxy', async () => {
    const owner = service(vi.fn<typeof fetch>(async () => envelope({ room_transcript_segments: [
      { start_ms: 2000, end_ms: 3000, text: '录音片段', speaker_user_id: 42,
        audio_url: 'https://webrtc-record-prod-1403070603.cos.ap-shanghai.myqcloud.com/clip.wav?q-signature=private' },
    ] })), { environment: 'prod' })
    const presentation = await owner.timelineCallRecord({ crd: { ri: 'cos-room', mt: 'Audio', rs: 'NormalEnd', cr: 42 } }, 42)
    const result = await owner.callDetail(presentation!.callRef!)
    expect(result.transcriptSegments[0]?.audioUrl).toMatch(/^\/arkme-self\/api\/media\?ref=/)
    expect(JSON.stringify(result)).not.toMatch(/myqcloud|q-signature|private/)
  })

  it('projects standalone transcript audio URLs and drops unsupported URL schemes', async () => {
    const owner = service(vi.fn<typeof fetch>(async () => envelope({ segments: [
      { id: 'a', text: '可播放', start_ms: 2000, end_ms: 3000, audio_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/clip.wav' },
      { id: 'b', text: '无录音', audio_url: 'javascript:alert(1)' },
      { id: 'c', text: '本地文件不可读', audio_url: 'file:///private/clip.wav' },
    ] })))
    const presentation = await owner.timelineCallRecord({ crd: { ri: 'audio-room', mt: 'Audio', rs: 'NormalEnd', cr: 42 } }, 42)
    const result = await owner.callDetail(presentation!.callRef!)
    expect(result.transcriptSegments.find(segment => segment.segmentId === 'a')).toMatchObject({ audioUrl: expect.stringMatching(/^\/arkme-self\/api\/media\?ref=/), startMillis: 2000 })
    expect(JSON.stringify(result)).not.toContain('oss-cn-hangzhou')
    expect(result.transcriptSegments.filter(segment => segment.segmentId !== 'a').every(segment => segment.audioUrl === undefined)).toBe(true)
  })

  it('renders a template-only summary for the viewer through the timeline detail reference', async () => {
    const owner = service(vi.fn<typeof fetch>(async () => envelope({
      call_media_type: 0, call_summary_status: 'done', call_summary_template: '{{speaker:s1}}确认周五上线',
      summary_speaker_user_ids: { s1: 42 },
    })))
    const presentation = await owner.timelineCallRecord({ crd: { ri: 'template-room', mt: 'Audio', rs: 'NormalEnd', cr: 42 } }, 42)
    await expect(owner.callDetail(presentation!.callRef!)).resolves.toMatchObject({ summaryText: '我确认周五上线', summaryStatus: 'done' })
  })

  it('seals a timeline call for the existing detail endpoint without exposing its room', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://webrtc.test/api/v1/trtc/call-detail')
      expect(JSON.parse(String(init?.body))).toMatchObject({ room_id: 'timeline-private-room' })
      return envelope({ call_media_type: 1, start_time: 1788949920, end_time: 1788949922, call_result: 'Cancel' })
    })
    const owner = service(fetchImpl)
    const presentation = await owner.timelineCallRecord({ record: { payload: { content_payload: { crd: { ri: 'timeline-private-room', cr: 42, mt: 'Video', rs: 'Cancel', st: 1788949920, du: 0 } } } } }, 42)
    expect(presentation).toMatchObject({ mediaType: 'video', text: '已取消', startedAtMillis: 1788949920000, durationSeconds: 0 })
    expect(JSON.stringify(presentation)).not.toContain('timeline-private-room')
    const detail = await owner.callDetail(presentation!.callRef!)
    expect(detail).toMatchObject({ mediaType: 'video', durationSeconds: 2, transcriptSegments: [] })
    const anchored = await owner.timelineCallRecord({ content_payload: { structured_anchor: { anchor_kind: 2, anchor_uid: 'timeline-private-room' }, crd: { mt: 'Video', rs: 'Cancel', cr: 42 } } }, 42)
    await expect(owner.callDetail(anchored!.callRef!)).resolves.toMatchObject({ mediaType: 'video' })
    const foreign = await owner.timelineCallRecord({ crd: { ri: 'other-room', mt: 'Audio', rs: 'Cancel', cr: 77 } }, 77)
    await expect(owner.callDetail(foreign!.callRef!)).rejects.toMatchObject({ code: 'call-ref-invalid' })
  })

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

describe('CallHistoryService detail sharing', () => {
 it('converts only the current account reference to a stable share URL and paginates owner viewers', async () => {
  const shareRef = `${'a'.repeat(24)}.${'b'.repeat(64)}`
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
   const url = String(input)
   if (url.endsWith('/api/v1/call/history-aggregate')) return envelope({items:[{stable_id:'trtc:room-1',trtc:{room_id:'room-1',caller_user_id:42,callee_user_ids:[]}}],has_more:false})
   if (url.endsWith('/call-detail-share/ensure')) { expect(JSON.parse(String(init?.body))).toEqual({room_id:'room-1'}); return envelope({share_ref:shareRef}) }
   if (url.endsWith('/call-detail-share/viewers')) { expect(JSON.parse(String(init?.body))).toEqual({room_id:'room-1',cursor:'1750000000000:999999999999999999999999',limit:20}); return envelope({items:[{view_id:'a'.repeat(24),user_id:7,display_name:'访客',viewed_at_ms:1750000000001}],next_cursor:''}) }
   return envelope({items:[],has_more:false})
  })
  const api = service(fetchImpl)
  const page = await api.listCallHistory({includeRecentContacts:false})
  const ref = page.items[0]!.callRef
  expect(await api.shareLink(ref)).toEqual({url:`https://jotmo-app.senguo.me/share/call/${shareRef}`})
  expect(await api.shareViewers(ref,'1750000000000:999999999999999999999999')).toEqual({items:[{viewId:'a'.repeat(24),userId:7,displayName:'访客',viewedAtMillis:1750000000001}],nextCursor:''})
  await expect(api.shareLink('room-1')).rejects.toThrow()
  await expect(api.shareViewers('room-1')).rejects.toThrow()
 })
 it('rejects another account reference before issuing share requests', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
  const api = service(fetchImpl)
  const foreign = await api.timelineCallRecord({ crd: { ri: 'other-room', mt: 'Audio', rs: 'Cancel', cr: 77 } }, 77)
  fetchImpl.mockClear()
  await expect(api.shareLink(foreign!.callRef!)).rejects.toMatchObject({ code: 'call-ref-invalid' })
  await expect(api.shareViewers(foreign!.callRef!)).rejects.toMatchObject({ code: 'call-ref-invalid' })
  expect(fetchImpl).not.toHaveBeenCalled()
 })
 it('does not turn malformed owner responses into a fake copied link or empty viewer list', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async input => String(input).endsWith('/api/v1/call/history-aggregate') ? envelope({items:[{stable_id:'trtc:room-1',trtc:{room_id:'room-1',caller_user_id:42,callee_user_ids:[]}}],has_more:false}) : envelope({}))
  const api = service(fetchImpl)
  const page = await api.listCallHistory({includeRecentContacts:false})
  await expect(api.shareLink(page.items[0]!.callRef)).rejects.toThrow('分享链接暂不可用')
  await expect(api.shareViewers(page.items[0]!.callRef)).rejects.toThrow('查看记录暂不可用')
 })
})

describe('call share viewer avatars', () => {
 it.each([false, true])('batches avatar profiles and preserves history when avatar lookup fails=%s', async fail => {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
   const url = String(input)
   if (url.endsWith('/api/v1/call/history-aggregate')) return envelope({ items: [{ stable_id: 'trtc:room-1', trtc: { room_id: 'room-1', caller_user_id: 42, callee_user_ids: [] } }], has_more: false })
   if (url.endsWith('/call-detail-share/viewers')) return envelope({ items: [7, 8].map(user_id => ({ view_id: String(user_id).repeat(24), user_id, display_name: user_id === 7 ? '公开访客' : '', viewed_at_ms: 1750000000001 })), next_cursor: '' })
   if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
    if (fail) throw new Error('profiles unavailable')
    return envelope({ items: [7, 8].map(user_id => ({ user_id, nick_name: '资料昵称', head_img: `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/${user_id}/avatar.png?x-oss-signature=avatar` })) })
   }
   return envelope({ items: [], has_more: false })
  })
  const api = service(fetchImpl)
  const page = await api.listCallHistory({ includeRecentContacts: false })
  fetchImpl.mockClear()
  const result = await api.shareViewers(page.items[0]!.callRef)
  expect(result.items.map(item => item.displayName)).toEqual(['公开访客', '即我用户'])
  const lookups = fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/api/v1/auth/get-public-users-by-ids'))
  if (!fail) expect(lookups).toHaveLength(1)
  expect(lookups.length).toBeGreaterThan(0)
  for (const [, init] of lookups) expect(JSON.parse(String(init?.body))).toEqual({ user_ids: [7, 8] })
  expect(JSON.stringify(result)).not.toContain('x-oss-signature')
  for (const item of result.items) {
   if (fail) expect(item.avatarRef).toBeUndefined()
   else expect(item.avatarRef).toMatch(/^arkme-profile-image-v1\./)
  }
 })
})
