import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { InterwovenService } from '../../src/services/interwoven-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: false,
}

describe('InterwovenService', () => {
  it('returns the configured disabled state for a valid private source', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')

    await expect(new InterwovenService(runtime, source, profile).interwovenMoments(sourceRef))
      .resolves.toMatchObject({ state: 'disabled', moments: [] })
  })

  it('revalidates interwoven access before resolving a related quick-note locator', async () => {
    const runtime = {
      config: { interwovenMomentsEnabled: true },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      stateStore: { async uniqueCode() { return 'device-secret' } },
      authenticatedAuthPost: vi.fn(async () => ({ able: true })),
      authenticatedSubjectPost: vi.fn(async () => ({ exist: false })),
      authenticatedChatPost: vi.fn(async (path: string) => {
        if (path === '/api/v1/chats/detail') return {
          session: { chat_session_uid: 'private-chat-1', session_kind: 1 },
          private_counterpart: { user_id: 7 },
        }
        if (path === '/api/v1/chats/interwoven/inline-bootstrap') return {
          prepared_at: 1_710_000_000_000,
          groups: [{
            moment_type: 1,
            group_title: '项目群',
            group_preview_items: [{
              moment_type: 1,
              moment_id: 'moment-1',
              occurred_at: 1_710_000_000_000,
              jump_target: {
                chat_session_uid: 'group-chat-9', record_owner_user_id: 13,
                record_uid: 'record-b', rel_uid: 'relation-b', seq: 8,
              },
              render_payload: { group_name: '项目群', sender_user_id: 13, content: '问题不大' },
            }],
          }],
        }
        throw new Error(`unexpected chat route: ${path}`)
      }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'private_chat', ownerRef: 'private-chat-1', displayName: '同事',
      })),
    }
    const profile = {
      interwovenProfilesByUserIds: vi.fn(async () => new Map([[13, { displayName: 'B 用户', hasAvatar: false }]])),
    }
    const service = new InterwovenService(runtime as never, source as never, profile as never)
    const bootstrap = await service.interwovenMoments('source-ref')
    const momentRef = bootstrap.moments[0]?.momentRef ?? ''
    const signal = new AbortController().signal

    await expect(service.relatedQuickNoteLocator('source-ref', momentRef, signal)).resolves.toEqual({
      viewerUserId: 42,
      sourceRef: 'source-ref',
      sourceOwnerRef: 'private-chat-1',
      contextType: 'chat',
      recordUid: 'record-b',
      recordOwnerUserId: 13,
      chatSessionUid: 'group-chat-9',
    })
    expect(runtime.authenticatedAuthPost).toHaveBeenLastCalledWith(
      '/api/v1/auth/able-func', { func_type: 12 },
      expect.objectContaining({ userId: 42 }), signal,
    )
    expect(runtime.authenticatedChatPost).toHaveBeenLastCalledWith(
      '/api/v1/chats/detail', { chat_session_uid: 'private-chat-1' },
      expect.objectContaining({ userId: 42 }), signal,
    )

    runtime.authenticatedAuthPost.mockResolvedValue({ able: false })
    await expect(service.relatedQuickNoteLocator('source-ref', momentRef))
      .rejects.toMatchObject({ code: 'interwoven-disabled' })
  })
})
