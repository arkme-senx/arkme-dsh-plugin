import { expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { SourceService } from '../src/services/source-service.js'
import { MediaService } from '../src/services/media-service.js'
import { ServiceRuntime, type StateStore, type ArkmeServiceConfig } from '../src/services/service.js'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../src/sdk/index.js'
const config: ArkmeServiceConfig = { environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test', recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test', audioBaseUrl: 'https://audio.test', routePath: '/arkme-self/api', requestTimeoutMs: 2000, maxTextLength: 20000, geetestCaptchaId: 'test', interwovenMomentsEnabled: true }
const wire = { version: 1, items: [{ target_index: 0, accessible: true, complete: true, comment_count: 0, quote_count: 0, source_record_version: 1, anchors: [] }] }
function fixture(fetcher: typeof fetch) {
  let session = { userId: 7, accessToken: 'synthetic', refreshToken: 'synthetic-refresh' }
  const runtime = new ServiceRuntime(config, { async read() { return session }, async write(next) { session = next }, async delete() {} }, { async uniqueCode() { return 'synthetic-signing' } } as StateStore, fetcher)
  const service = Object.create(ChatService.prototype) as ChatService
  Object.assign(service, { runtime, source: { openSourceRef: async () => ({ kind: 'group_chat', ownerRef: 'chat' }) }, openMessageActionRef: async () => ({ chatSessionUid: 'chat', recordOwnerUserId: 8, recordUid: 'source', relationUid: 'source-rel', sourceSequence: 1 }) })
  return { runtime, service, switchAccount() { session = { userId: 9, accessToken: 'other', refreshToken: 'other-refresh' } } }
}
it('fences a late Host response when the authenticated account changes', async () => {
  let finish!: () => void, started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const pending = new Promise<void>(resolve => { finish = resolve })
  const f = fixture(async () => { started(); await pending; return new Response(JSON.stringify({ code: 200, data: wire })) })
  try {
    const result = f.service.sourceMessageExtensionSummaries('source', ['action'])
    const outcome = result.then(value => ({ value }), error => ({ error }))
    await ready; f.switchAccount(); finish()
    await expect(outcome).resolves.toMatchObject({ error: { code: 'read-account-changed' } })
  } finally { f.runtime.dispose() }
})
it('a summary outage does not cool down ordinary sends to the same Chat service', async () => {
  const sends = vi.fn()
  const f = fixture(async input => {
    if (String(input).endsWith('/summaries/batch')) return new Response(JSON.stringify({ code: 503, message: 'unavailable' }), { status: 503 })
    sends(); return new Response(JSON.stringify({ code: 200, data: { accepted: true } }))
  })
  try {
    await expect(f.service.sourceMessageExtensionSummaries('source', ['action'])).rejects.toBeDefined()
    await expect(f.runtime.authenticatedChatPost('/api/v1/chats/records/send', { record_uid: 'normal-send' })).resolves.toEqual({ accepted: true })
    expect(sends).toHaveBeenCalledTimes(1)
  } finally { f.runtime.dispose() }
})
it('SDK disposal cancels an in-flight capability lookup before the summary call', async () => {
  const operations: string[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); operations.push(request.operation)
    if (request.operation === 'provider.capabilities') await pending
    return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { messageExtensionSummariesV1: true } } : [] }))
  } })
  const result = sdk.sourceMessageExtensionSummaries('source', ['action']).then(value => ({ value }), error => ({ error }))
  sdk.dispose(); finish()
  await expect(result).resolves.toHaveProperty('error')
  expect(operations).toEqual(['provider.capabilities'])
})

function audienceFixture() {
  const session = { userId: 42, accessToken: 'synthetic', refreshToken: 'synthetic-refresh' }
  const requests: { path: string; frame: string | null }[] = []
  const runtime = new ServiceRuntime(config, { async read() { return session }, async write() {}, async delete() {} },
    { async uniqueCode() { return 'summary-audience-signing' } } as StateStore, async (input, init) => {
      const path = new URL(String(input)).pathname, frame = new Headers(init?.headers).get('X-Chat-Access-Ref')
      requests.push({ path, frame })
      if (path !== '/api/v1/chats/extensions/summaries/batch') throw new Error(`unexpected request: ${path}`)
      // The current backend denies this personal-member query for delegated audiences.
      if (frame) return new Response(JSON.stringify({ code: 1004, message: 'team audience denied', data: { reason: 'team_group_denied' } }))
      return new Response(JSON.stringify({ code: 200, data: { version: 1, items: [{
        ...wire.items[0], comment_count: 5, source_record_version: 3,
      }] } }))
    })
  const sources = new SourceService(runtime, {} as never, {} as never)
  const media = new MediaService(runtime, {} as never, {} as never, {} as never)
  const service = new ChatService(runtime, sources, {} as never, media, {} as never, {} as never, {} as never,
    { timelineAiPolish: () => undefined } as never, {} as never)
  const frame = { accessRef: 'team-A', teamId: '42', membershipKind: 'member' as const, membershipRevision: 4,
    groupMembershipUid: 'admission-A', groupMembershipRevision: 1, visibleFromSeq: 7 }
  const sourceRef = (accessRef?: string) => sources.sealSourceRef(42, 'group_chat', 'chat', 'group', accessRef
    ? { groupDelegation: { ...frame, accessRef, groupMembershipUid: `admission-${accessRef}` } } : {})
  const actionRef = async (ref: string) => {
    const source = await sources.openSourceRef(ref, 42)
    const [item] = await service.projectChatTimelineItems([{ relation: {
      rel_uid: 'rel', record_uid: 'record', sender_user_id: 77, seq: 7,
    }, record: { status: 1, payload: { record_uid: 'record', owner_user_id: 77, version: 3, text_content: 'public' } } }],
    source, session, undefined, { basicPresentation: true })
    return item!.messageActionRef!
  }
  return { runtime, service, sourceRef, actionRef, requests }
}

it('keeps a delegated summary denial separate from a personal read of the same group', async () => {
  const f = audienceFixture()
  try {
    const personal = await f.sourceRef(), delegated = await f.sourceRef('team-A')
    const personalAction = await f.actionRef(personal), delegatedAction = await f.actionRef(delegated)
    const [allowed, denied] = await Promise.allSettled([
      f.service.sourceMessageExtensionSummaries(personal, [personalAction]),
      f.service.sourceMessageExtensionSummaries(delegated, [delegatedAction]),
    ])
    expect(allowed).toMatchObject({ status: 'fulfilled', value: [{ summary: { commentCount: 5 } }] })
    expect(denied).toMatchObject({ status: 'rejected', reason: { code: 'arkme-code-1004', retryable: false } })
    expect(f.requests).toHaveLength(2)
    expect(f.requests).toEqual(expect.arrayContaining([
      { path: '/api/v1/chats/extensions/summaries/batch', frame: null },
      { path: '/api/v1/chats/extensions/summaries/batch', frame: 'team-A' },
    ]))
  } finally { f.runtime.dispose() }
})

it('rejects cross-audience summary action refs and never falls back after a delegated denial', async () => {
  const f = audienceFixture()
  try {
    const a = await f.sourceRef('team-A'), b = await f.sourceRef('team-B')
    const actionA = await f.actionRef(a), actionB = await f.actionRef(b)
    await expect(f.service.sourceMessageExtensionSummaries(b, [actionA])).rejects.toMatchObject({ code: 'message-action-ref-invalid' })
    expect(f.requests).toHaveLength(0)
    await expect(f.service.sourceMessageExtensionSummaries(b, [actionB])).rejects.toMatchObject({ code: 'arkme-code-1004', retryable: false })
    expect(f.requests).toEqual([{ path: '/api/v1/chats/extensions/summaries/batch', frame: 'team-B' }])
  } finally { f.runtime.dispose() }
})
