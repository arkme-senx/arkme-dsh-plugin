import { expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import { AiVideoService } from '../src/services/ai-video-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'

// Opt-in counterpart of Audio's TestRecordingE2EOwnerFixture. Never use a user account.
const ownerUrl = process.env.JOTMO_RECORDING_E2E_URL
it.skipIf(!ownerUrl)('maps public utterances through the existing authenticated Audio detail API', async () => {
  const endpoint = new URL(ownerUrl!)
  expect(endpoint.protocol).toBe('http:')
  expect(endpoint.hostname).toBe('127.0.0.1')
  const fixture = await (await fetch(new URL('/fixture', endpoint))).json()
  const sessions: ArkmeSessionStore = {
    async read() { return { userId: fixture.owner, accessToken: fixture.app_access_token, refreshToken: 'test-only' } },
    async write() {}, async delete() {},
  }
  const runtime = new ServiceRuntime({
    environment: 'test', audioBaseUrl: endpoint.origin, requestTimeoutMs: 5000,
  } as ArkmeServiceConfig, sessions, {} as StateStore, fetch)
  const selected = await new AiVideoService(runtime).aiVideoResolveSelection(fixture.earliest, [
    { startOffsetMillis: 100, endOffsetMillis: 190, text: '验收正文' },
    { startOffsetMillis: 200, endOffsetMillis: 290, text: '验收正文' },
  ])
  expect(selected).toHaveLength(2)
  expect(selected.map(item => item.asrItemIndex)).toEqual([1, 2])
  for (const item of selected) {
    expect(item).toEqual({ childId: expect.stringMatching(/^[0-9a-f]{24}$/), asrItemIndex: expect.any(Number), transcriptSource: 'system' })
  }
})
