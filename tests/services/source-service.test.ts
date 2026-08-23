import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
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

describe('SourceService', () => {
  it('creates a topic with an account-bound source reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      topic_uid: 'topic-1', status: 1,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.createTopic('项目复盘')).resolves.toMatchObject({
      source: {
        kind: 'topic', displayName: '项目复盘',
        sourceRef: expect.stringMatching(/^arkme-source-v1\./),
      },
    })
  })

  it('does not join concurrent root and group-only reads or share their failure state', async () => {
    const activeSession = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sessions: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    let releaseRequests = (): void => {}
    const requestGate = new Promise<void>(resolve => { releaseRequests = resolve })
    const listBodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      if (path !== '/api/v1/chats/list') throw new Error(`unexpected path: ${path}`)
      listBodies.push(body)
      await requestGate
      if (body.session_kind !== 2) {
        return new Response(JSON.stringify({ code: 500, message: 'root unavailable' }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: {
        items: [{ session: { chat_session_uid: 'group-1', session_kind: 2, title: '项目群' } }],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const rootRead = service.listSources('root', { refresh: true })
    const groupRead = service.listGroupSources({ refresh: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseRequests()
    const [rootResult, groupResult] = await Promise.allSettled([rootRead, groupRead])

    expect(rootResult.status).toBe('rejected')
    expect(groupResult).toMatchObject({
      status: 'fulfilled', value: { items: [{ kind: 'group_chat', displayName: '项目群' }] },
    })
    expect(listBodies).toEqual([
      { limit: 30 },
      { limit: 30, session_kind: 2 },
    ])
  })
})
