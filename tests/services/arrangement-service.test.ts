import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ArrangementService', () => {
  it('projects an account-bound arrangement reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: {
      list: [{ uid: 'arrangement-1', title: '整理架构', status: 1, reminder_enabled: true }],
      total: 1,
    } }), { status: 200 })) as typeof fetch
    const service = new ArrangementService(new ServiceRuntime(config, sessions, stateStore, fetchImpl))

    const page = await service.listArrangements()
    expect(page.items).toEqual([expect.objectContaining({
      title: '整理架构', status: 'identified', reminderEnabled: true,
      arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./),
    })])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

it.each([
  [{ description: 'summary', source: { source_items: [{ text: '原始输入', create_at: 100 }] } }, { kind: 'input', items: [{ text: '原始输入', createdAtMillis: 100 }], unavailableCount: 0 }],
  [{ source_text: '旧版原文' }, { kind: 'input', items: [{ text: '旧版原文' }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'], related_records: [{ uid: 'private-record', text_content: '快记原文', create_at: 200 }], source_text: 'ignored' }, { kind: 'quick-note', items: [{ text: '快记原文', createdAtMillis: 200 }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'] }, { kind: 'quick-note', items: [], unavailableCount: 1 }],
  [{ description: 'only summary' }, { kind: 'none', items: [], unavailableCount: 0 }],
])('preserves creation source without leaking owner identities: %j', async (fields, expected) => {
  const sessions = { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} } as ArkmeSessionStore
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { list: [{ uid: 'a', title: 't', status: 1, ...fields }], total: 1 } }), { status: 200 })) as typeof fetch
  const service = new ArrangementService(new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl))
  const page = await service.listArrangements()
  expect(page.items[0]).toHaveProperty('creationSource', expected)
  expect(JSON.stringify(page)).not.toContain('private-record')
})
