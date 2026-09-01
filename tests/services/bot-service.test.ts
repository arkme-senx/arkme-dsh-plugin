import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { BotService, type OpenClawBotRuntimePort } from '../../src/services/bot-service.js'
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

const runtimePort: OpenClawBotRuntimePort = {
  async chatOwnedCreatePreflight() { return { status: 'ready' } },
  async reconcile() { return { status: 'connected_unverified', resource_ref: 'openclaw.bot.v1.test' } },
}

describe('BotService', () => {
  it('projects an owned Bot without exposing its raw id', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { bots: [
      { bot_id: 'bot-raw-1', name: '测试 Bot', provider: 'webhook', status: 'default', direct_chat_available: true },
    ] } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new BotService(runtime, source)

    const result = await service.listBots()
    expect(result.items).toEqual([expect.objectContaining({ name: '测试 Bot', provider: 'webhook' })])
    expect(JSON.stringify(result)).not.toContain('bot-raw-1')
  })

  it('issues random registry handles whose bytes cannot disclose owner IDs', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42_424_242, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const rawBotId = 'bot-owner-secret-42424242'
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'unused-secret' } } as StateStore,
      vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { bots: [{
        bot_id: rawBotId, name: '安全 Bot', provider: 'webhook', status: 'online',
      }] } }), { status: 200 })) as typeof fetch)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new BotService(runtime, source)

    const ref = (await service.listBots()).items[0]!.botRef
    expect(ref).toMatch(/^arkme-bot-v2\.[0-9a-f-]{36}$/i)
    for (const privateValue of ['42424242', rawBotId]) {
      expect(ref).not.toBe(privateValue)
      expect(ref).not.toContain(privateValue)
      for (const part of ref.split('.')) {
        expect(Buffer.from(part, 'base64url').toString('utf8')).not.toContain(privateValue)
      }
    }
    expect(() => JSON.parse(Buffer.from(ref.split('.')[1]!, 'base64url').toString('utf8'))).toThrow()
  })

  it('rejects tampered, cross-account, expired, evicted, and disposed Bot handles', async () => {
    let currentUserId = 7
    let now = 1_000
    let sequence = 0
    const handles = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
    ]
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: currentUserId, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'unused-secret' } } as StateStore,
      vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { bots: [{
        bot_id: `bot-${String(sequence)}`, name: `Bot ${String(sequence)}`, provider: 'webhook', status: 'online',
      }] } }), { status: 200 })) as typeof fetch)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new BotService(runtime, source, {
      now: () => now, randomId: () => handles[sequence++]!, ttlMillis: 100, maxEntries: 2,
    })

    const first = (await service.listBots()).items[0]!.botRef
    await expect(service.openBotRef(first, 7)).resolves.toMatchObject({ version: 2, provider: 'webhook' })
    await expect(service.openBotRef(first.replace('arkme-bot-v2', 'arkme-contact-v1'), 7))
      .rejects.toMatchObject({ code: 'bot-ref-invalid' })
    await expect(service.openBotRef(`${first.slice(0, -1)}9`, 7)).rejects.toMatchObject({ code: 'bot-ref-expired' })
    currentUserId = 8
    await expect(service.openBotRef(first, 8)).rejects.toMatchObject({ code: 'bot-ref-account-mismatch' })
    currentUserId = 7
    now += 101
    await expect(service.openBotRef(first, 7)).rejects.toMatchObject({ code: 'bot-ref-expired' })

    const oldest = (await service.listBots()).items[0]!.botRef
    await service.listBots()
    await service.listBots()
    await expect(service.openBotRef(oldest, 7)).rejects.toMatchObject({ code: 'bot-ref-expired' })
    const retained = (await service.listBots()).items[0]!.botRef
    service.dispose()
    await expect(service.openBotRef(retained, 7)).rejects.toMatchObject({ code: 'bot-ref-expired' })
  })

  it('clears account handles without detaching the device OpenClaw provisioner', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'unused-secret' } } as StateStore,
      vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { bots: [{
        bot_id: 'bot-clear', name: '清理 Bot', provider: 'openclaw', status: 'online',
      }] } }), { status: 200 })) as typeof fetch)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new BotService(runtime, source)
    const botRef = (await service.listBots()).items[0]!.botRef
    service.attachOpenClawProvisioner(runtimePort)

    service.clearAccountRefs()

    await expect(service.openBotRef(botRef, 42)).rejects.toMatchObject({ code: 'bot-ref-expired' })
    expect(() => { service.attachOpenClawProvisioner(runtimePort) }).toThrow('already attached')
  })
})
