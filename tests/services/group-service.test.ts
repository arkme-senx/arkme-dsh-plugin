import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { GroupService } from '../../src/services/group-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('GroupService', () => {
  function fixture(fetchImpl: typeof fetch, inviteSender?: ConstructorParameters<typeof GroupService>[3]) {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const state = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, state, fetchImpl)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    return { source, service: new GroupService(runtime, source, profile, inviteSender) }
  }

  it('reads group settings through an account-bound source', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const state = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, state, async () => new Response(JSON.stringify({
      code: 200, data: { session: { chat_session_uid: 'group-1', title: '研发群' }, current_policy: { mute_state: 2 } },
    }), { status: 200 }))
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const service = new GroupService(runtime, source, profile)
    await expect(service.groupSettings(sourceRef)).resolves.toMatchObject({
      source: { displayName: '研发群' }, messageDnd: true,
    })
  })

  it('lists account-bound private-chat candidates and adds one idempotently', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const { source, service } = fixture(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      const data = path.endsWith('/members/list')
        ? { items: [{ user_id: 42, status: 1 }] }
        : path.endsWith('/chats/list')
          ? { items: [{
              session: { chat_session_uid: 'private-7', session_kind: 1 },
              private_counterpart: { user_id: 7, display_name_snapshot: '小林' },
              private_supplement: { contact_state: 1 },
            }] }
          : path.endsWith('/invite-preview')
            ? { preview: { join_mode: 1 } }
            : path.endsWith('/members/add')
              ? { item: { outcome: 'idempotent_hit' } }
              : { items: [] }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const candidates = await service.listGroupMemberCandidates(sourceRef)
    expect(candidates).toMatchObject({ mode: 'direct_add', contactCount: 1, strangerCount: 0, groups: [], items: [{ displayName: '小林', origin: 'private_chat', relation: 'contact' }] })
    const result = await service.addGroupMembers(sourceRef, [candidates.items[0]!.candidateRef])
    expect(result).toMatchObject({ succeededCount: 1, failedCount: 0, results: [{ status: 'already_member' }] })
    expect(calls.find(call => call.path.endsWith('/members/add'))?.body).toMatchObject({
      chat_session_uid: 'group-1', target_user_id: 7, display_name_snapshot: '小林',
    })
  })

  it('sends an approval invite through the candidate private chat', async () => {
    const sent: string[] = []
    const { source, service } = fixture(async (input) => {
      const path = new URL(String(input)).pathname
      const data = path.endsWith('/members/list') ? { items: [{ user_id: 42 }] }
        : path.endsWith('/chats/list') ? { items: [{
            session: { chat_session_uid: 'private-8', session_kind: 1 },
            private_counterpart: { user_id: 8, display_name_snapshot: '小周' },
          }] }
        : { preview: { join_mode: 2, invite_link: 'https://invite.test/group-1' } }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    }, {
      async sendPrivateText(_sourceRef, chatSessionUid, text) { sent.push(`${chatSessionUid}:${text}`) },
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const candidates = await service.listGroupMemberCandidates(sourceRef)
    const result = await service.addGroupMembers(sourceRef, [candidates.items[0]!.candidateRef])
    expect(result.results[0]?.status).toBe('invite_sent')
    expect(sent[0]).toContain('private-8:邀请你加入群聊“研发群”：https://invite.test/group-1')
  })
})
