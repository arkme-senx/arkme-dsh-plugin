import { expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
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
