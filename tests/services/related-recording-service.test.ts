import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RelatedRecordingService } from '../../src/services/related-recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true, relatedRecordingsEnabled: false,
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
}

describe('RelatedRecordingService', () => {
  it('reports the configured disabled eligibility without owner access', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new RelatedRecordingService(runtime, source)
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')
    await expect(service.relatedRecordingEligibility(sourceRef)).resolves.toEqual({ allowed: false })
  })

  it('keeps desktop participant names and shared source flags from related recording payloads', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime({ ...config, relatedRecordingsEnabled: true }, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/auth/able-func')) {
        expect(body).toEqual({ func_type: 17 })
        return json({ able: true })
      }
      if (url.endsWith('/api/v1/chats/records/related-recordings/page')) {
        expect(body).toMatchObject({ chat_session_uid: 'chat-1', page_size: 10 })
        return json({
          state: '3',
          has_entry: 'true',
          has_more: 'false',
          partial: 'false',
          moment_ls: [
            {
              moment_id: 'moment-1',
              start_at: '1786086780000',
              end_at: '1786088340000',
              date_stamp: '20260807',
              tz_offset: '28800000',
              time_range_text: '2026-08-07 12:33 - 12:59',
              title: 'AI高效协作方法论指导',
              summary: '继续指导运营同事如何有效使用AI。',
              summary_status: '2',
              transcript: '完整原文',
              transcript_available: 'true',
              is_shared_by_other: '1',
              shared_by_user_id: '188',
              participant_ls: [
                { ref_usr_id: '42', display_name_snapshot: '我', role: '2' },
                { speaker_name: '陈依涵-运营', role: '3' },
              ],
            },
            {
              moment_id: 'moment-2',
              start_at: 1786080000000,
              end_at: 1786080300000,
              title: '只有说话人的录音',
              summary: '用说话人列表兜底参与者展示。',
              summary_status: 2,
              speaker_ls: [{ speaker_id: 'speaker-1', nick_name: '落日' }],
            },
          ],
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new RelatedRecordingService(runtime, source)
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')

    const page = await service.relatedRecordings(sourceRef, { limit: 10 })

    expect(page).toMatchObject({ state: 'success', hasEntry: true, hasMore: false })
    expect(page.items[0]).toMatchObject({
      title: 'AI高效协作方法论指导',
      transcriptAvailable: true,
      isSharedByOther: true,
      sharedByUserId: 188,
      participants: [
        { speakerId: 'participant:0', refUserId: 42, displayName: '我', role: 2 },
        { speakerId: 'participant:1', displayName: '陈依涵-运营', role: 3 },
      ],
    })
    expect(page.items[1]?.participants).toMatchObject([
      { speakerId: 'speaker-1', displayName: '落日' },
    ])
  })
})
