import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test', audioBaseUrl: 'https://audio.test', routePath: '/arkme-self/api',
  requestTimeoutMs: 5000, maxTextLength: 20_000, geetestCaptchaId: 'test',
}

class Sessions {
  session: ArkmeSessionCredentials | undefined = { userId: 1001, accessToken: 'access', refreshToken: 'refresh' }
  async read() { return this.session }
  async write(value: ArkmeSessionCredentials) { this.session = value }
  async delete() { this.session = undefined }
}

const state = { async uniqueCode() { return 'quick-add-group-test-device' } } as never
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), {
  headers: { 'content-type': 'application/json' },
})

describe('Arkme group quick-add owner', () => {
  it('creates an owner-only group with caller-stable identity', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, new Sessions(), state, async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ url: String(input), body })
      return ok({
        session: {
          chat_session_uid: body.chat_session_uid, session_kind: 2, title: body.title,
          last_active_at: 1, last_seq: 0,
        },
        current_policy: {}, unread_snapshot: { unread_count: 0 },
      })
    })

    const source = await service.createGroup(' 项目群 ', 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b')

    expect(source).toMatchObject({ kind: 'group_chat', displayName: '项目群' })
    expect(calls).toEqual([{
      url: 'https://chat.test/api/v1/chats/create-group',
      body: expect.objectContaining({
        chat_session_uid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
        title: '项目群', member_user_ids: [],
      }),
    }])
  })

  it('rejects invalid titles and mutation IDs before transport', async () => {
    const fetchImpl = async () => { throw new Error('must not call transport') }
    const service = new ArkmeService(config, new Sessions(), state, fetchImpl)
    await expect(service.createGroup('', 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'))
      .rejects.toMatchObject({ code: 'group-title-invalid' })
    await expect(service.createGroup('项目群', 'not-a-uuid'))
      .rejects.toMatchObject({ code: 'client-mutation-id-invalid' })
  })
})
