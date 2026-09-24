import { describe, it, expect, vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { TeamChannel, TeamConversation, TeamOpen, TeamSendResult, TeamTimeline, TeamMembers } from '../src/team-app-contract.js'
import { parseOwnerJson, stringifyOwnerJson } from '../src/record-owner-id.js'
import { decodeArkmeTeamNotificationDataLine, decodeArkmeMemberEventDataLine } from '../src/chat-realtime.js'

const channel = { team_id: '9223372036854775800', name: '即我团队', jotmo_id: 'arkme_cn', public_ref: 'a'.repeat(32), enabled: true, revision: 1, can_manage: false }
const conversation = { conversation_uid: 'conversation-private', team_id: channel.team_id, external_user_id: 90, channel, side: 'external', last_seq: 2, latest_team_reply_seq: 1, my_read_seq: 0, unread: 1 }
const message = { message_uid: 'message-private', actor_user_id: 11, record_owner_user_id: 11, seq: 2, revision: 2, side: 'team', state: 'published', sender: { nickname: '小林', avatar_url: 'https://userfiles.jotmo.cc/test.png' }, record: { status: 'available', version: 3, text_content: '已收到', media: [{ file_asset_uid: 'asset-secret', file_name: 'photo.png', mime_type: 'image/png', size: 42, file_kind: 1, download_url: 'https://private-signed.invalid' }] } }
function fixture(handler: (path: string, body: Record<string, unknown>) => unknown | Promise<unknown> = () => ({})) {
  let session = { userId: 90, accessToken: 'app-token', refreshToken: 'app-refresh' }
  const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = parseOwnerJson(String(init?.body || '{}')) as Record<string, unknown>
    requests.push({ path, body, headers: new Headers(init?.headers) })
    const data = await handler(path, body)
    if (data instanceof Response) return data
    return new Response(stringifyOwnerJson({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
  })
  const config = { environment: 'test', teamBaseUrl: 'https://team.test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test', recordBaseUrl: 'https://record.test', subjectBaseUrl: 'https://subject.test', routePath: '/custom/api', requestTimeoutMs: 500, shareWebsite: 'https://share.test', maxTextLength: 20000 } as ArkmeServiceConfig
  const runtime = new ServiceRuntime(config, {} as ArkmeSessionStore, { uniqueCode: async () => 'unique-machine-key' } as StateStore, fetchImpl as typeof fetch)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => ({ ...session }))
  vi.spyOn(runtime, 'accountScopedSession').mockImplementation(async () => ({ ...session }))
  const avatars = { publicAvatarPresentationsByArkmeIds: vi.fn(async () => new Map<string, { avatarRef: string }>()) }
  const service = new TeamAppService(runtime, avatars)
  return { service, runtime, requests, fetchImpl, avatars, changeAccount() { session = { userId: 91, accessToken: 'other', refreshToken: 'other-refresh' } } }
}
async function open(f: ReturnType<typeof fixture>) { return await f.service.execute('team.app.open', { publicRef: channel.public_ref }) as TeamOpen }

describe('Team App owner adapter', () => {
  it('distinguishes missing official setup from revoked conversation access', async () => {
    const f = fixture(() => new Response(JSON.stringify({ code: 1001, data: { reason: 'official_unavailable' } })))
    await expect(f.service.execute('team.app.official', {})).rejects.toMatchObject({ code: 'team-official_unavailable', message: '暂时无法联系作者，请稍后重试' })
  })
  it('uses the App credential and lossless Team IDs without Chat, Subject or OpenAPI', async () => {
    const f = fixture(path => path.endsWith('/official-feedback-target') ? channel : path.endsWith('/message-channel/get') ? channel : {})
    const target = await f.service.execute('team.app.official', {}) as TeamChannel
    expect(target.link).toBe(`https://share.test/team-message?channel=${channel.public_ref}`)
    expect(JSON.stringify(target)).not.toContain(channel.team_id)
    await f.service.execute('team.app.channel', { teamRef: target.teamRef })
    expect(f.requests[1]?.body.team_id).toBe(channel.team_id)
    expect(f.requests.every(r => r.headers.get('authorization') === 'Bearer app-token')).toBe(true)
    expect(f.fetchImpl.mock.calls.every(args => String(args[0]).startsWith('https://team.test/'))).toBe(true)
  })
  it('redacts internal owner/actor/asset IDs and signed provider URLs from external messages', async () => {
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : { conversation, messages: [message], has_more: false, before_seq: 2 })
    const opened = await open(f)
    const page = await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline
    const encoded = JSON.stringify(page)
    for (const secret of ['conversation-private', 'message-private', 'actor_user_id', 'record_owner_user_id', 'asset-secret', 'private-signed.invalid', 'userfiles.jotmo.cc']) expect(encoded).not.toContain(secret)
    expect(page.messages[0]?.sender.nickname).toBe('小林')
    expect(page.messages[0]?.content?.text_content).toBe('已收到')
    expect(page.messages[0]!.media[0]!.url).toBe(`/custom/api/team/media?ref=${encodeURIComponent(page.messages[0]!.media[0]!.ref)}`)
  })
  it('rejects cross-account and forged references before contacting owner', async () => {
    const f = fixture(() => ({ channel, conversation }))
    const opened = await open(f), count = f.requests.length
    f.changeAccount()
    await expect(f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref })).rejects.toMatchObject({ code: 'team-reference-invalid' })
    await expect(f.service.execute('team.app.channel', { teamRef: 'team-app-team.forged' })).rejects.toMatchObject({ code: 'team-reference-invalid' })
    expect(f.requests.length).toBe(count)
  })
  it('separates stable media presentation identity from rotating encrypted access references', async () => {
    let current = structuredClone(message)
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : { conversation, messages: [current] })
    const opened = await open(f)
    const read = async () => (await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline).messages[0]!
    const first = await read(), second = await read()
    expect(second.ref).not.toBe(first.ref)
    expect(second.media[0]!.ref).not.toBe(first.media[0]!.ref)
    expect(second.media[0]!.key).toBe(first.media[0]!.key)
    expect(second.sender.imageRef).not.toBe(first.sender.imageRef)
    expect(second.sender.imageKey).toBe(first.sender.imageKey)
    current.record.version++
    current.sender.avatar_url = 'https://userfiles.jotmo.cc/changed.png'
    const edited = await read()
    expect(edited.media[0]!.key).not.toBe(first.media[0]!.key)
    expect(edited.sender.imageKey).not.toBe(first.sender.imageKey)
    f.changeAccount()
    const other = await open(f)
    const page = await f.service.execute('team.app.timeline', { conversationRef: other.conversation!.ref }) as TeamTimeline
    expect(page.messages[0]!.media[0]!.key).not.toBe(edited.media[0]!.key)
  })
  it('keeps draft and view identities separate when a visitor later joins the same team', async () => {
    let side = 'external'
    const f = fixture(() => ({ items: [{ ...conversation, side }], has_more: false }))
    const external = await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }
    side = 'team'
    const internal = await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }
    expect(internal.items[0]!.key).not.toBe(external.items[0]!.key)
    expect((await f.service.execute('team.app.conversations', { side }) as { items: TeamConversation[] }).items[0]!.key).toBe(internal.items[0]!.key)
  })
  it('drops a response completed after an account change', async () => {
    let release!: () => void
    const barrier = new Promise<void>(r => { release = r })
    const f = fixture(async () => { await barrier; return channel })
    const pending = f.service.execute('team.app.official', {})
    await vi.waitFor(() => { expect(f.requests).toHaveLength(1) })
    f.changeAccount(); release()
    await expect(pending).rejects.toMatchObject({ code: 'team-account-changed' })
  })
  it('preserves accepted operation and idempotency key on reply conflict without auto-confirming', async () => {
    const pendingMessage = { ...message, state: 'preparing', side: 'team', own: true }
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation: { ...conversation, side: 'team' } } : new Response(JSON.stringify({ code: 1004, data: { reason: 'reply_conflict', operation: pendingMessage } })))
    const opened = await open(f), p = { conversationRef: opened.conversation!.ref, clientUid: 'stable-attempt', expectedReplySeq: 2, content: { text_content: 'reply', template_kind: 1 } }
    const result = await f.service.execute('team.app.send', p) as TeamSendResult
    expect(result.reason).toBe('reply_conflict'); expect(result.message?.state).toBe('preparing')
    await f.service.execute('team.app.send', p)
    expect(f.requests.filter(r => r.path.endsWith('/send')).map(r => r.body.client_message_uid)).toEqual(['stable-attempt', 'stable-attempt'])
    expect(f.requests.some(r => r.path.endsWith('/confirm-reply'))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('message-private')
  })
  it('does not cache a previous success over a removed membership', async () => {
    let denied = false
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : denied ? new Response(JSON.stringify({ code: 1004, data: { reason: 'not_accessible' } })) : { conversation, messages: [message] })
    const opened = await open(f), p = { conversationRef: opened.conversation!.ref }
    await f.service.execute('team.app.timeline', p); denied = true
    await expect(f.service.execute('team.app.timeline', p)).rejects.toMatchObject({ code: 'team-not_accessible', retryable: false })
  })
  it('applies for protected membership without falling back to the open platform', async () => {
    const f = fixture(path => path.endsWith('/join-by-jotmo-id') ? new Response(JSON.stringify({ code: 1004, data: { reason: 'approval_required' } })) : { state: 'pending', user_id: 90, team_id: 42 })
    await expect(f.service.execute('team.app.join', { jotmoId: 'protected_team', requestUid: 'application-1' })).resolves.toEqual({ state: 'pending' })
    expect(f.requests.map(v => v.path)).toEqual(['/api/v1/team/join-by-jotmo-id', '/api/v1/team/join-requests/create'])
    expect(f.requests[1]?.body).toEqual({ jotmo_id: 'protected_team', request_uid: 'application-1' })
  })
  it('returns only current members and opaque removal handles', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? { items: [{ user_id: 11, display_name: '林', role: 3, can_remove: true }], total_count: 1 } : { teams: [{ ...channel, role: 1 }] })
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const members = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(members.items[0]?.canRemove).toBe(true)
    expect(JSON.stringify(members)).not.toContain('user_id')
    await f.service.execute('team.app.member.remove', { userRef: members.items[0]!.userRef })
    expect(f.requests.at(-1)?.body).toEqual({ team_id: channel.team_id, target_user_id: 11 })
  })
  it('preserves optional profile avatars and unavailable identity without changing member authority', async () => {
    const f = fixture(path => path.endsWith('official-feedback-target') ? channel : path.endsWith('members/list') ? {
      items: [{ user_id: 11, display_name: '林', jotmo_id: 'member_lin', identity_state: 'ready', role: 3 },
        { user_id: 12, display_name: '用户', identity_state: 'unavailable', role: 3 }], total_count: 2,
    } : { teams: [{ ...channel, role: 1 }] })
    f.avatars.publicAvatarPresentationsByArkmeIds.mockResolvedValue(new Map([['member_lin', { avatarRef: 'profile-avatar' }]]))
    const c = await f.service.execute('team.app.official', {}) as TeamChannel
    const members = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(members.items[0]).toMatchObject({ avatarRef: 'profile-avatar', identityState: 'ready' })
    expect(members.items[1]).toMatchObject({ identityState: 'unavailable' })
    expect(f.avatars.publicAvatarPresentationsByArkmeIds).toHaveBeenCalledWith(['member_lin'], expect.any(AbortSignal))
    f.avatars.publicAvatarPresentationsByArkmeIds.mockRejectedValue(new Error('avatar unavailable'))
    const degraded = await f.service.execute('team.app.members', { teamRef: c.teamRef }) as TeamMembers
    expect(degraded.items).toHaveLength(2)
    expect(degraded.items[0]?.avatarRef).toBeUndefined()
  })
  it('rechecks membership on every byte request and never forwards provider credentials or URLs', async () => {
    let denied = false
    const f = fixture(path => path.endsWith('/open') ? { channel, conversation } : path.endsWith('/media') ? denied ? new Response(JSON.stringify({ code: 1004, data: { reason: 'not_accessible' } }), { headers: { 'content-type': 'application/json' } }) : new Response('bytes', { headers: { 'content-type': 'application/octet-stream' } }) : { conversation, messages: [message] })
    const opened = await open(f), timeline = await f.service.execute('team.app.timeline', { conversationRef: opened.conversation!.ref }) as TeamTimeline
    const ref = timeline.messages[0]!.media[0]!.ref
    const bytes = await f.service.fetchMedia(ref, 'bytes=0-3', new AbortController().signal)
    expect(await bytes.response.text()).toBe('bytes')
    expect(f.requests.at(-1)?.headers.get('range')).toBe('bytes=0-3')
    denied = true
    await expect(f.service.fetchMedia(ref, undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'team-not_accessible' })
  })
  it('keeps Team notifications distinct from existing member events and rejects extra payload', () => {
    const event = { t: 28, event_uid: 'e', event_at: 100, revision: 2, kind: 'team.message.changed', conversation_uid: 'c' }
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify(event)}`)).toEqual({ eventUid: 'e', eventAtMillis: 100 })
    expect(decodeArkmeMemberEventDataLine(`data: ${JSON.stringify(event)}`)).toBeUndefined()
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({ ...event, t: 27 })}`)).toBeUndefined()
    expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({ ...event, text_content: 'private' })}`)).toBeUndefined()
  })
})
