import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { InterwovenService } from '../../src/services/interwoven-service.js'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

// Pair with Chat TestPrivateInteractionOwnerFixture. No fetch/service mocks:
// official DSH -> Host coordinator -> HTTP handlers -> isolated real Mongo.
const endpoint = process.env.JOTMO_INTERACTION_E2E_URL
it.skipIf(!endpoint)('runs nonzero unread, paging, read/ACK, privacy and recovery through Chat', async () => {
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const session = { userId: 1001, accessToken: 'interaction-fixture', refreshToken: 'fixture-refresh' }
  const sessions = { async read() { return session }, async write() {}, async delete() {} }
  const runtime = new ServiceRuntime({ environment: 'test', chatBaseUrl: endpoint, requestTimeoutMs: 10_000, interwovenMomentsEnabled: true } as ArkmeServiceConfig,
    sessions, { async uniqueCode() { return 'isolated-interaction-test-key' } } as StateStore)
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {} as never)
  const owner = new InterwovenService(runtime, source, profile)
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const dshSession = ctx.sessions.create(); const agent = { id: dshSession.id, session: dshSession }
  registerArkmeTools(ctx, { privateInteractionSummary: owner.privateInteractionSummary.bind(owner), queryPrivateInteractions: owner.queryPrivateInteractions.bind(owner) } as never, 'business')
  let callId = 0
  const invoke = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await ctx.tools.execute({ callId: CallId(`interaction-${++callId}`), agent: agent as never, signal: new AbortController().signal, name, arguments: args })
    expect(result.isError, String(result.value)).toBe(error)
    if (error) return undefined
    return JSON.parse(String(result.value).split('<data_from_arkme>\n')[1]!.split('\n</data_from_arkme>')[0]!)
  }
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer interaction-fixture' }, body: JSON.stringify(body) })
    expect(response.ok).toBe(true)
    const result = await response.json() as { code?: number, data?: any }
    if (path.startsWith('/api/')) expect(result.code).toBe(200)
    return result.data
  }
  const p1 = await source.sealSourceRef(1001, 'private_chat', 'p1', '联系人一')
  const p2 = await source.sealSourceRef(1001, 'private_chat', 'p2', '联系人二')
  const summary = (ref = p1) => invoke('arkme_private_interaction_summary', { source_ref: ref })
  const query = (args: Record<string, unknown> = {}) => invoke('arkme_private_interactions_query', args)
  try {
    expect(await summary()).toMatchObject({ unreadCount: 2, attentionCount: 2, latest: { summary: 'gb-2', senderIsMe: true, unread: false } })
    const first = await query({ limit: 2 })
    const next = await query({ limit: 2, cursor: first.nextCursor, expected_version: first.version })
    expect([first.items.length, next.items.length, next.hasMore]).toEqual([2, 2, false])
    expect(new Set([...first.items, ...next.items].map(x => x.interactionRef)).size).toBe(4)
    expect((await query({ unread_only: true })).items).toHaveLength(3)
    const directory = await post('/api/v1/chats/interwoven/directory/query', { limit: 1 })
    expect(directory.items[0]).toMatchObject({ session: { chat_session_uid: 'p1' }, latest_display_source: 'group_interaction', interaction: { unread_count: 2 } })
    await post('/api/v1/chats/cursor/update', { chat_session_uid: 'ga', read_seq: 1, read_at: Date.now() })
    expect(await summary()).toMatchObject({ unreadCount: 1 })
    expect(await summary(p2)).toMatchObject({ unreadCount: 1 })
    await invoke('arkme_private_interactions_query', { cursor: first.nextCursor, limit: 2 }, true)
    await post('/api/v1/chats/mentions/read', { chat_session_uid: 'gb', record_owner_user_id: 2001, record_uid: 'gb-1', mention_kind: 1, mentioned_user_id: 1001, ack_at: Date.now() })
    expect(await summary()).toMatchObject({ unreadCount: 0 })
    expect(await summary(p2)).toMatchObject({ unreadCount: 1 })
    owner.dispose() // new account lifecycle re-queries durable cursor/ACK facts
    expect(await summary()).toMatchObject({ unreadCount: 0 })
    await post('/fixture/change', { action: 'new' })
    expect(await summary()).toMatchObject({ unreadCount: 1, latest: { summary: 'ga-3' } })
    await post('/api/v1/chats/policy/update', { chat_session_uid: 'p1', patch: { mute_state: 2 } })
    expect(await summary()).toMatchObject({ unreadCount: 1, attentionCount: 0 })
    await post('/fixture/change', { action: 'withdraw' })
    expect(await summary()).toMatchObject({ unreadCount: 0, latest: { summary: 'gb-2' } })
    await post('/fixture/change', { action: 'remove-mention' })
    expect(await summary()).toMatchObject({ unreadCount: 0, latest: { summary: 'gb-1' } })
    await post('/api/v1/chats/policy/update', { chat_session_uid: 'p1', patch: { privacy_state: 2 } })
    await invoke('arkme_private_interaction_summary', { source_ref: p1 }, true)
    expect((await query()).items).toHaveLength(1)
    await post('/api/v1/chats/policy/update', { chat_session_uid: 'p1', patch: { privacy_state: 1 } })
    await post('/fixture/change', { action: 'outage' })
    await invoke('arkme_private_interactions_query', {}, true)
    await post('/fixture/change', { action: 'recover' })
    expect((await query()).items).toHaveLength(3)
    await post('/fixture/change', { action: 'disable' })
    await invoke('arkme_private_interaction_summary', { source_ref: p1 }, true)
    console.info(`Interaction E2E: ${callId} real DSH tool calls completed`)
  } finally {
    await post('/finish', {})
    owner.dispose(); source.dispose(); runtime.dispose(); await ctx.fiber.dispose()
  }
}, 90_000)
