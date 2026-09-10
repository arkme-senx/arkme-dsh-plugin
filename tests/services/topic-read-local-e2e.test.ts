import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ArkmeStateStore } from '../../src/state-store.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../../src/services/service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { SourceService } from '../../src/services/source-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { BotService } from '../../src/services/bot-service.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { GroupAiPolishService } from '../../src/services/group-ai-polish-service.js'
import { dispatchArkmeHostOperation } from '../../src/host-api.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'

// Run only against the disposable jotmo-record compose stack, never a user's
// running client or Keychain. All writes belong to this fixture account.
const baseUrl = process.env.ARKME_TOPIC_READ_E2E_BASE_URL ?? ''
it.skipIf(baseUrl === '')('real topic pages reach ChatService, Host, SDK and Tools', async () => {
  expect(new URL(baseUrl).hostname).toBe('127.0.0.1')
  const userId = 25001
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ user_id: userId, client_id: 25002 })}`
  const accessToken = `${input}.${createHmac('sha256', 'record-e2e-access-token-secret').update(input).digest('base64url')}`
  const session = { userId, accessToken, refreshToken: 'local-fixture-unused' }
  const directory = await mkdtemp(join(tmpdir(), 'arkme-topic-http-'))
  const config: ArkmeServiceConfig = {
    environment: 'test', authBaseUrl: baseUrl, subjectBaseUrl: baseUrl,
    recordBaseUrl: baseUrl, chatBaseUrl: baseUrl, botBaseUrl: baseUrl,
    imBaseUrl: baseUrl, webrtcBaseUrl: baseUrl, worldBaseUrl: baseUrl,
    relationBaseUrl: baseUrl, intelligentBaseUrl: baseUrl, audioBaseUrl: baseUrl,
    routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000,
    geetestCaptchaId: 'unused-local-fixture', interwovenMomentsEnabled: false,
  }
  const paths: string[] = []
  const runtime = new ServiceRuntime(config, {
    async read() { return session }, async write() {}, async delete() {},
  }, new ArkmeStateStore(directory), async (url, init) => {
    const target = new URL(String(url))
    expect(target.origin).toBe(new URL(baseUrl).origin)
    paths.push(target.pathname)
    return await fetch(url, init)
  })
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {
    async summary() { throw new Error('topic reading must not load summary') },
    recordItem() { throw new Error('unused default-category path') },
  })
  let record!: RecordService
  const media = new MediaService(runtime, profile, {
    async openWorldImageRef() { throw new Error('unused world image') },
  }, { recordUid(raw) { return record.recordUid(raw) } })
  record = new RecordService(runtime, media, source)
  const bot = new BotService(runtime, source)
  const arko = new ArkoService(runtime, profile)
  const polish = new GroupAiPolishService(runtime, source, {
    async sendChatSourceTextRaw() { throw new Error('unused chat write') },
  })
  const chat = new ChatService(runtime, source, profile, media, record, bot, arko, polish, {
    emitChatClientEvent() {}, nextChatClientRevision() { return 1 },
    scheduleChatSessionProjection() {},
  })
  try {
    const topic = await runtime.authenticatedPost<{ topic_uid: string }>('/api/v1/topics/create', {
      title: 'plugin HTTP acceptance', show_in_home: false, privacy_state: 1,
    }, session)
    const sourceRef = await source.sealSourceRef(userId, 'topic', topic.topic_uid, 'plugin HTTP acceptance')
    expect((await chat.readSource(sourceRef)).items).toEqual([])
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const uid = randomUUID()
      ids.push(uid)
      await runtime.authenticatedPost('/api/v1/topics/records/create', {
        record_uid: uid, template_kind: 1, title: `HTTP ${i}`,
        text_content: `plugin HTTP body ${i}`, send_at: Date.now(), topic_uid: topic.topic_uid,
      }, session)
    }
    const owner = { readSource: chat.readSource.bind(chat) }
    const first = await chat.readSource(sourceRef, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const last = await chat.readSource(sourceRef, { limit: 2, cursor: first.nextCursor })
    expect(last.hasMore).toBe(false)
    expect(new Set([...first.items, ...last.items].map(item => item.itemUid))).toEqual(new Set(ids))
    const host = await dispatchArkmeHostOperation(owner as never, 'source.timeline', { sourceRef, limit: 2 })
    expect(host).toEqual(first)
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const { operation, params } = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true,
        value: await dispatchArkmeHostOperation(owner as never, operation, params) }))
    } })
    expect((await sdk.readSource(sourceRef)).items).toHaveLength(3)
    const tool = createArkmeCoreToolDefinitions(owner as never).find(item => item.name === 'arkme_source_read')!
    const output = await tool.execute({ source_ref: sourceRef }, { signal: new AbortController().signal } as never)
    expect(output).toContain('plugin HTTP body')
    expect(paths).toContain('/api/v1/topics/display/records/page')
    expect(paths).not.toContain('/api/v1/topics/display/detail')
    expect(paths).not.toContain('/api/v1/topics/display/summary')
    await runtime.authenticatedPost('/api/v1/topics/display/policy/set', {
      topic_uid: topic.topic_uid, privacy_state: 2,
    }, session)
    await expect(chat.readSource(sourceRef)).rejects.toMatchObject({ code: 'topic-privacy-locked' })
  } finally {
    media.dispose()
    runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
