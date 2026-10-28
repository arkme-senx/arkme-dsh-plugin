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

it.skipIf(!ownerUrl)('reads canonical pages with source facts, fragmented text and the recording uploader from the real Audio router', async () => {
  const endpoint = new URL(ownerUrl!)
  expect(endpoint.protocol).toBe('http:'); expect(endpoint.hostname).toBe('127.0.0.1')
  const fixture = await (await fetch(new URL('/fixture', endpoint))).json()
  const session = { userId: fixture.owner, accessToken: fixture.app_access_token, refreshToken: 'test-only' }
  const runtime = new ServiceRuntime({ environment: 'test', audioBaseUrl: endpoint.origin, requestTimeoutMs: 5000 } as ArkmeServiceConfig,
    { async read() { return session }, async write() {}, async delete() {} }, {} as StateStore, fetch)
  const { RecordingReadOwner } = await import('../src/services/recording-read-owner.js')
  const owner = new RecordingReadOwner(runtime)
  const window = { startAt: 0, endAt: 10000 }
  const facts = await owner.recordings(window, session)
  expect(facts.find(row => row.recording_uid === fixture.earliest)?.uploaderUserId).toBe(session.userId)
  const first = await owner.transcript(fixture.earliest, 'primary', window, session, { limit: 1 })
  expect(first.items).toHaveLength(1)
  expect(first.items[0]!.textEnd).toBeLessThan(first.items[0]!.textTotal)
  expect(first.items[0]!.speaker.label).toBe('验收张三')
  expect(first.items[0]!.speakerEdit?.revision).toMatch(/^[a-f0-9]{64}$/)
  const all = await owner.completeDay(window, 'primary', session)
  expect(all.items.some(item => item.text.endsWith('尾句'))).toBe(true)
  expect(all.items.every(item => item.textEnd === item.textTotal)).toBe(true)
})
