import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { LocalMessageActionCapabilityCodec } from '../../src/services/message-action-infrastructure.js'
import { MessageActionService } from '../../src/services/message-action-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { arkoImageInputFromWire } from '../../src/arko-image-contract.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

function messageActions(runtime: ServiceRuntime): MessageActionService {
  return new MessageActionService(
    {} as never,
    {} as never,
    new LocalMessageActionCapabilityCodec(async () => await runtime.stateStore.uniqueCode()),
  )
}

describe('ArkoService', () => {
  function imageFixture(imageInput: unknown = { enabled: true, protocol_version: 1, max_images: 2, max_image_bytes: 1024, max_total_bytes: 2048, mime_types: ['image/png'] }) {
    const sessions: ArkmeSessionStore = { async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, async () => new Response('data: {"tail":{"status":"completed"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const calls = vi.fn(async (path: string, body: unknown) => {
      if (path.endsWith('/model/list')) return { default_route_key: 'deepseek/flash', effective_route_key: 'deepseek/flash', selection_source: 'default',
        items: [{ route_key: 'deepseek/flash', provider: 'deepseek', display_name: 'Flash', description: '', selected: true, image_input: imageInput }] }
      if (path.endsWith('/new-msg-v2')) return { session_id: 88, user_msg_id: 101, assistant_msg_id: 102, run_uid: 'run-image' }
      throw new Error(`Unexpected ${path}`)
    })
    runtime.authenticatedIntelligentPost = calls as never
    const read = vi.fn(async (fileRef: string) => ({ file: { fileRef, fileName: 'test.png', mimeType: 'image/png', size: 128, fileKind: 1 as const } }))
    const upload = vi.fn(async (refs: readonly string[]) => refs.map((_, index) => ({ fileAssetUid: `asset-${index}`, fileName: 'test.png', mimeType: 'image/png', size: 128, fileKind: 1 as const })))
    const service = new ArkoService(runtime, new ProfileService(runtime), undefined, { read, upload, project: () => [] })
    return { service, runtime, calls, read, upload }
  }
  const imageRef = 'arkme-file-v1.11111111-1111-4111-8111-111111111111'

  it.each([null, { enabled: true, protocol_version: 2 }, { enabled: true, protocol_version: 1, max_images: 9 }])('does not upload or send text when image capability is absent or incomplete: %j', async capability => {
    const { service, calls, read, upload } = imageFixture(capability)
    await expect(service.arkoAsk('look', { sessionId: 88, modelRouteKey: 'deepseek/flash', imageFileRefs: [imageRef] })).rejects.toMatchObject({ code: 'arko-images-unavailable' })
    expect(read).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
    expect(calls.mock.calls.some(([path]) => path.endsWith('/new-msg-v2'))).toBe(false)
  })

  it('requires live capability and validates image limits before uploading', async () => {
    const { service, calls, read, upload } = imageFixture()
    read.mockResolvedValueOnce({ file: { fileRef: imageRef, fileName: 'test.png', mimeType: 'image/png', size: 2048, fileKind: 1 } })
    await expect(service.arkoAsk('', { sessionId: 88, modelRouteKey: 'deepseek/flash', imageFileRefs: [imageRef] })).rejects.toMatchObject({ code: 'arko-image-invalid' })
    expect(upload).not.toHaveBeenCalled()
    calls.mockRejectedValueOnce(new Error('offline'))
    await expect(service.arkoAsk('', { sessionId: 88, modelRouteKey: 'deepseek/flash', imageFileRefs: [imageRef] })).rejects.toThrow('offline')
    expect(upload).not.toHaveBeenCalled()
  })

  it('sends image-only input with ordered owned assets, explicit protocol and the original retry identity', async () => {
    const { service, calls, upload } = imageFixture()
    const refs = [imageRef, imageRef.replace('11111111', '22222222')]
    await service.arkoAsk('', { sessionId: 88, modelRouteKey: 'deepseek/flash', imageFileRefs: refs, clientTurnUid: 'same-turn', expectedUserId: 10001 })
    expect(upload).toHaveBeenCalledWith(refs, undefined)
    expect(calls.mock.calls.find(([path]) => path.endsWith('/new-msg-v2'))?.[1]).toMatchObject({
      content: '', client_turn_uid: 'same-turn', attachments_protocol_version: 1, client_capabilities: ['dsh.arko.v1', 'dsh.arko.images.v1'],
      attachments: [{ type: 'image', file_asset_uid: 'asset-0' }, { type: 'image', file_asset_uid: 'asset-1' }],
    })
    expect(JSON.stringify(calls.mock.calls)).not.toContain('arkme-file-v1')
  })

  it('blocks stale-account requests and image continuations before upload', async () => {
    const { service, upload } = imageFixture()
    await expect(service.arkoAsk('', { sessionId: 88, imageFileRefs: [imageRef], expectedUserId: 20002 })).rejects.toMatchObject({ code: 'arko-account-changed' })
    await expect(service.arkoAsk('', { sessionId: 88, imageFileRefs: [imageRef], replyToRunUid: 'run', replyToAssistantMsgId: 5 })).rejects.toMatchObject({ code: 'arko-image-continuation-unavailable' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps an image-only historical message visible when media is unavailable', async () => {
    const { runtime, service } = imageFixture()
    runtime.authenticatedIntelligentPost = async () => ({ message_ls: [{ id: 101, session_id: 88, role: 2, content: '',
      attachments: [{ type: 'image', file_asset_uid: 'asset-1', file_name: 'old.png', mime_type: 'image/png', size: 128 }] }] })
    expect((await service.arkoHistoryPage()).items[0]).toMatchObject({ text: '', contentBlocks: [{ kind: 'image', mediaRef: '', fileAssetUid: 'asset-1', fileName: 'old.png' }] })
  })

  it('never treats a model name or permissive MIME wildcard as image capability', () => {
    expect(arkoImageInputFromWire({ display_name: 'DeepSeek v4.1' })).toBeUndefined()
    expect(arkoImageInputFromWire({ enabled: true, protocol_version: 1, max_images: 9, max_image_bytes: 1024, max_total_bytes: 1024, mime_types: ['image/*'] })).toBeUndefined()
  })
  it('keeps a retired personal selection explicit with authoritative point prices', async () => {
    const sessions: ArkmeSessionStore = { async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      default_route_key: 'managed-ai/flash-custom', effective_route_key: 'managed-ai/retired-pro', selection_source: 'unavailable',
      items: [{ route_key: 'managed-ai/flash-custom', display_name: 'Flash', provider: 'managed-ai', description: '日常使用', cost_description: '报价来自当前发布目录', recommended: true, selected: false }],
    })
    const service = new ArkoService(runtime, new ProfileService(runtime))
    await expect(service.arkoModelCatalog()).resolves.toMatchObject({ selectionSource: 'unavailable', effectiveRouteKey: 'managed-ai/retired-pro', options: [{ selected: false, costDescription: '报价来自当前发布目录' }] })
  })

  it('rejects an invalid model route before owner access', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const service = new ArkoService(runtime, new ProfileService(runtime))
    await expect(service.arkoActivateModel('../invalid')).rejects.toMatchObject({ code: 'arko-model-route-invalid' })
  })

  it('uses the client-compatible send time before the creation time for history activity', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      message_ls: [{
        id: 101,
        session_id: 88,
        role: 3,
        content: '最新回复',
        send_at: 1_786_000_100,
        created_at: 1_786_000_000,
        status: 1,
      }],
    })
    const service = new ArkoService(runtime, new ProfileService(runtime))

    await expect(service.arkoHistoryPage(10, 0)).resolves.toMatchObject({
      items: [{ text: '最新回复', createdAtMillis: 1_786_000_100_000 }],
    })
  })

  it('keeps empty history reads side-effect free even when no current Agent session is projected', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    const paths: string[] = []
    runtime.authenticatedIntelligentPost = async path => {
      paths.push(path)
      return { message_ls: [] }
    }
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    await expect(service.arkoHistoryPage(10, 0)).resolves.toEqual({ items: [], hasMore: false })
    expect(paths).toEqual(['/api/v1/qa/message-list'])
  })

  it('does not bootstrap or cache a current session while projecting mixed historical Agent sessions', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    const paths: string[] = []
    runtime.authenticatedIntelligentPost = async path => {
      paths.push(path)
      if (path.endsWith('/message-list')) return { message_ls: [
        { id: 90, session_id: 77, role: 3, content: '旧会话', send_at: 1_786_000_000, status: 1 },
        { id: 101, session_id: 88, role: 3, content: '当前会话', send_at: 1_786_000_100, status: 1 },
      ] }
      throw new Error(`unexpected path ${path}`)
    }
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    const page = await service.arkoHistoryPage(10, 0)

    expect(page.items.find(item => item.sessionId === 77)).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(page.items.find(item => item.sessionId === 88)).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(paths).toEqual(['/api/v1/qa/message-list'])
  })

  it('projects stable Agent action capabilities without reusing side-effect Record ids', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      message_ls: [{
        id: 101, session_id: 88, role: 2, content: '用户问题', send_at: 1_786_000_100, status: 1,
        extra: { data: { entry_record_uid: 'entry-record' } },
        created_record_uids: ['side-effect-record'],
      }],
    })
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    await expect(service.arkoHistoryPage(10, 0)).resolves.toMatchObject({
      items: [{
        entryRecordUid: 'entry-record',
        createdRecordUids: ['side-effect-record'],
        messageActionRef: expect.any(String),
        messageActionCapabilities: { copyLink: true, forward: true },
      }],
    })
  })

  it('keeps each stable historical Agent message bound to its own owner session', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      session_id: 88,
      message_ls: [
        { id: 90, session_id: 77, role: 3, content: '旧会话', send_at: 1_786_000_000, status: 1 },
        { id: 101, session_id: 88, role: 3, content: '当前会话', send_at: 1_786_000_100, status: 1 },
      ],
    })
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)
    const page = await service.arkoHistoryPage(10, 0)

    const oldSession = page.items.find(item => item.sessionId === 77)
    const currentSession = page.items.find(item => item.sessionId === 88)
    expect(oldSession).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(currentSession).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(oldSession?.messageActionConversationRef).not.toBe(currentSession?.messageActionConversationRef)
  })
})
