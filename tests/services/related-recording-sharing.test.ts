import { afterEach, describe, expect, it } from 'vitest'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RelatedRecordingService } from '../../src/services/related-recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const runtimes: ServiceRuntime[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose() })
const own = { moment_id: 'moment-1', session_id: 'audio-1', start_at: 1786086780000, end_at: 1786088340000,
  title: '协作讨论', summary: '讨论摘要', transcript: '录音原文', transcript_available: true,
  share_state_known: true, is_shared: false }
function json(data: unknown, code = 200) { return new Response(JSON.stringify({ code, data }), { status: 200 }) }

async function fixture(patch: Record<string, unknown> = {}, intercept?: (path: string, body: Record<string, unknown>) => Promise<Response | undefined>) {
  let session: ArkmeSessionCredentials = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test',
    audioBaseUrl: 'https://audio.test', relatedRecordingsEnabled: true, requestTimeoutMs: 5000 } as ArkmeServiceConfig,
  { async read() { return session }, async write(value) { session = value }, async delete() {} },
  { async uniqueCode() { return 'test-signing-key' } } as StateStore, async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ path, body })
    const overridden = await intercept?.(path, body)
    if (overridden) return overridden
    if (path.endsWith('/able-func')) return json({ able: true })
    if (path.endsWith('/related-recordings/page')) return json({ moment_ls: [{ ...own, ...patch }] })
    if (path.endsWith('/chats/detail')) return json({ session: { chat_session_uid: 'chat-1', session_kind: 1 }, private_counterpart: { user_id: 88 } })
    if (path.endsWith('/share-ticket')) return json({ ticket: 'opaque-ticket', expires_at: Date.now() + 300000 })
    if (path.endsWith('/shared-recording')) return json({ chat_session_uid: 'chat-1', rel_uid: 'relation-1', record_uid: 'record-1', seq: 8, already_existed: false })
    if (path.endsWith('/revoke')) return json({ chat_session_uid: 'chat-1', rel_uid: 'relation-1', revoked: true })
    throw new Error(`Unexpected test request: ${path}`)
  })
  runtimes.push(runtime)
  const source = new SourceService(runtime, new ProfileService(runtime), {
    async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
  })
  const service = new RelatedRecordingService(runtime, source)
  const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')
  const item = (await service.relatedRecordings(sourceRef)).items[0]!
  return { service, source, sourceRef, item, calls, setUser(userId: number) { session = { ...session, userId } } }
}

describe('related recording sharing', () => {
  it('shares a server-resolved ticket with the current counterpart, then withdraws only its chat relation', async () => {
    const f = await fixture()
    const shared = await f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')
    expect(shared).toMatchObject({ recordingRef: f.item.recordingRef, isShared: true, shareStateKnown: true, sequence: 8 })
    expect(f.calls.find(call => call.path.endsWith('/share-ticket'))?.body).toEqual({ counterpart_user_id: 88, session_id: 'audio-1', moment_id: 'moment-1' })
    expect(f.calls.find(call => call.path.endsWith('/shared-recording'))?.body).toEqual({ chat_session_uid: 'chat-1', share_ticket: 'opaque-ticket' })
    const withdrawn = await f.service.mutateShare(f.sourceRef, shared.shareActionRef, 'withdraw')
    expect(withdrawn).toMatchObject({ isShared: false, timelineItemKey: shared.timelineItemKey })
    expect(shared.timelineItemKey).toBe(await f.source.chatTimelineItemKey(42, 'chat-1', 'relation-1'))
    expect(f.calls.at(-1)?.body).toEqual({ chat_session_uid: 'chat-1', rel_uid: 'relation-1' })
    expect(f.calls.filter(call => call.path.startsWith('/api/v1/audio/')).map(call => call.path)).toEqual(['/api/v1/audio/related-recordings/share-ticket'])
  })

  it.each([{ is_shared_by_other: true }, { share_state_known: false }, { session_id: '' }, { transcript: '' }, { summary: '' }])(
    'does not issue an owner capability for received, unknown or incomplete items: %j', async patch => {
      const f = await fixture(patch)
      expect(f.item.shareActionRef).toBeUndefined()
      await expect(f.service.mutateShare(f.sourceRef, '', 'share')).rejects.toMatchObject({ code: 'related-recording-share-ref-invalid' })
      expect(f.calls.some(call => call.path.endsWith('/share-ticket'))).toBe(false)
    },
  )

  it('rejects a tampered ref, another chat and another account before writes', async () => {
    const f = await fixture()
    await expect(f.service.mutateShare(f.sourceRef, `${f.item.shareActionRef!}x`, 'share')).rejects.toMatchObject({ httpStatus: 403 })
    const otherChat = await f.source.sealSourceRef(42, 'private_chat', 'chat-2', '其他人')
    await expect(f.service.mutateShare(otherChat, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ httpStatus: 403 })
    f.setUser(99)
    const otherUser = await f.source.sealSourceRef(99, 'private_chat', 'chat-1', '同事')
    await expect(f.service.mutateShare(otherUser, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ httpStatus: 403 })
    expect(f.calls.some(call => call.path.endsWith('/share-ticket'))).toBe(false)
  })

  it('coalesces duplicate clicks while the same share is pending', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({}, async path => { if (path.endsWith('/share-ticket')) await gate; return undefined })
    const first = f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')
    const second = f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')
    release()
    const results = await Promise.all([first, second])
    expect(results[0]).toEqual(results[1])
    expect(f.calls.filter(call => call.path.endsWith('/shared-recording'))).toHaveLength(1)
  })

  it('renews exactly once on an explicit expired ticket', async () => {
    let sends = 0
    const f = await fixture({}, async path => path.endsWith('/shared-recording') && ++sends === 1
      ? json({ reason: 'share_ticket_expired' }, 1001) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')).resolves.toMatchObject({ isShared: true })
    expect(f.calls.filter(call => call.path.endsWith('/share-ticket'))).toHaveLength(2)
    expect(sends).toBe(2)
  })

  it('does not blindly resend an ambiguous transport failure', async () => {
    const f = await fixture({}, async path => { if (path.endsWith('/shared-recording')) throw new TypeError('connection lost'); return undefined })
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ writeOutcomeUnknown: true })
    expect(f.calls.filter(call => call.path.endsWith('/shared-recording'))).toHaveLength(1)
  })

  it('stops after the single ticket renewal fails again', async () => {
    const f = await fixture({}, async path => path.endsWith('/shared-recording') ? json({ reason: 'share_ticket_expired' }, 1001) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ code: 'arkme-code-1001' })
    expect(f.calls.filter(call => call.path.endsWith('/share-ticket'))).toHaveLength(2)
  })

  it('rejects an invalid current counterpart before requesting a ticket', async () => {
    const f = await fixture({}, async path => path.endsWith('/chats/detail')
      ? json({ session: { chat_session_uid: 'chat-1', session_kind: 2 }, private_counterpart: { user_id: 88 } }) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ code: 'related-recording-peer-invalid' })
    expect(f.calls.some(call => call.path.endsWith('/share-ticket'))).toBe(false)
  })

  it('does not send a ticket after switching accounts', async () => {
    let switchUser: () => void = () => undefined
    const f = await fixture({}, async path => { if (path.endsWith('/share-ticket')) switchUser(); return undefined })
    switchUser = () => f.setUser(99)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'share')).rejects.toMatchObject({ code: 'related-recording-share-context-changed' })
    expect(f.calls.some(call => call.path.endsWith('/shared-recording'))).toBe(false)
  })

  it('recovers missing relation identity from a unique own active share', async () => {
    let pages = 0
    const f = await fixture({ is_shared: true }, async path => path.endsWith('/related-recordings/page') && ++pages > 1
      ? json({ moment_ls: [{ ...own, is_shared: true, source_relation_uid: 'relation-1', shared_sequence: 8 }] }) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'withdraw')).resolves.toMatchObject({ isShared: false, sequence: 8 })
    expect(f.calls.at(-1)?.path).toMatch(/\/revoke$/)
  })

  it('refuses ambiguous withdrawal candidates', async () => {
    let pages = 0
    const f = await fixture({ is_shared: true }, async path => path.endsWith('/related-recordings/page') && ++pages > 1
      ? json({ moment_ls: ['relation-1', 'relation-2'].map(uid => ({ ...own, is_shared: true, rel_uid: uid })) }) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'withdraw')).rejects.toMatchObject({ code: 'related-recording-share-relation-missing' })
    expect(f.calls.some(call => call.path.endsWith('/revoke'))).toBe(false)
  })

  it('accepts already revoked as successful, but rejects an unconfirmed revoke', async () => {
    const f = await fixture({ is_shared: true, rel_uid: 'relation-1' }, async path => path.endsWith('/revoke')
      ? json({ chat_session_uid: 'chat-1', rel_uid: 'relation-1', revoked: false, already_revoked: true }) : undefined)
    await expect(f.service.mutateShare(f.sourceRef, f.item.shareActionRef!, 'withdraw')).resolves.toMatchObject({ isShared: false })
    const denied = await fixture({ is_shared: true, rel_uid: 'relation-1' }, async path => path.endsWith('/revoke')
      ? json({ chat_session_uid: 'chat-1', rel_uid: 'relation-1', revoked: false, already_revoked: false }) : undefined)
    await expect(denied.service.mutateShare(denied.sourceRef, denied.item.shareActionRef!, 'withdraw')).rejects.toMatchObject({ code: 'related-recording-withdraw-response-invalid' })
  })
})
