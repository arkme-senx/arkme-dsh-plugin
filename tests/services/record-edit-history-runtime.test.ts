import { expect, it } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { RecordEditHistoryService } from '../../src/services/record-edit-history-service.js'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../../src/sdk/index.js'

it.each(['recordEditHistory', 'recordRevisionSnapshot'] as const)('%s cannot return a result or issue a read after SDK disposal', async method => {
  const operations: string[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); operations.push(request.operation)
    if (request.operation === 'provider.capabilities') await pending
    return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
      ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { recordEditHistoryV1: true } } : { items: [], hasMore: false } }))
  } })
  const read = method === 'recordEditHistory' ? sdk.recordEditHistory('source', 'action') : sdk.recordRevisionSnapshot('source', 'action', 'revision')
  const outcome = read.then(value => ({ value }), error => ({ error }))
  sdk.dispose(); finish()
  await expect(outcome).resolves.toHaveProperty('error')
  expect(operations).toEqual(['provider.capabilities'])
})

it.each(['chat', 'owned'] as const)('a %s history outage does not delay ordinary writes to that owner', async kind => {
  const config = { environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test', recordBaseUrl: 'https://record.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig
  const session = { userId: 7, accessToken: 'synthetic', refreshToken: 'synthetic' }
  const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => 'synthetic' } as StateStore,
    async url => new URL(String(url)).pathname.endsWith('/revisions/query')
      ? new Response(JSON.stringify({ code: 503, message: 'unavailable' }), { status: 503 })
      : new Response(JSON.stringify({ code: new URL(String(url)).hostname === 'record.test' ? 0 : 200, data: { accepted: true } })))
  const history = new RecordEditHistoryService(runtime, { projectPage: async () => [] })
  try {
    await expect(history.page(kind === 'owned' ? { viewerUserId: 7, recordUid: 'record', kind }
      : { viewerUserId: 7, recordUid: 'record', kind, chatSessionUid: 'chat', relationUid: 'relation', recordOwnerUserId: 7 })).rejects.toBeDefined()
    await expect(kind === 'owned' ? runtime.authenticatedPost('/api/v1/records/create', {}, session)
      : runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session)).resolves.toEqual({ accepted: true })
  } finally { runtime.dispose() }
})
