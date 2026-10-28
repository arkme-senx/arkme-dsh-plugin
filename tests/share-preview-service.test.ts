import { describe, expect, it, vi } from 'vitest'
import { SharePreviewService } from '../src/services/share-preview-service.js'
import type { ServiceRuntime } from '../src/services/service.js'

const url = 'https://jiwo.cc/s/Abcdef1234567890'
function setup(response = async () => new Response(JSON.stringify({ code: 200, data: { items: [{ sender_display_name: '作者', text_content: '公开内容' }] } })), accessToken?: string) {
  let userId: number | undefined = 42
  const fetchImpl = vi.fn(response)
  const listeners = new Set<() => void>()
  const runtime = {
    config: { environment: 'prod', requestTimeoutMs: 2000, chatBaseUrl: 'https://chat.example.com', authBaseUrl: 'https://auth.example.com', worldBaseUrl: 'https://world.example.com', subjectBaseUrl: 'https://subject.example.com', webrtcBaseUrl: 'https://call.example.com', audioBaseUrl: 'https://audio.example.com', extensionPublishBaseUrl: 'https://extension.example.com' },
    fetchImpl, accountScopedSession: async () => userId ? { userId, accessToken, refreshToken: 'private-session-secret' } : undefined,
    subscribeAccountScope(listener: () => void) { listeners.add(listener); listener(); return () => listeners.delete(listener) },
  } as unknown as ServiceRuntime
  return { service: new SharePreviewService(runtime), fetchImpl, changeAccount(next?: number) { userId = next; listeners.forEach(listener => listener()) } }
}
describe('share preview bounded read boundary', () => {
  it('resolves the same shared original as Me only for its author, independently of who forwards it', async () => {
    const original = { access_mode: 'normal', shared_by_user_id: 99,
      items: [{ record_uid: 'original', sender_display_name: '小林', text_content: '正文' }],
      source_context: { chat_session_uid: 'private-source', anchors: [{ record_uid: 'original', record_owner_user_id: 42 }] },
    }
    const { service, changeAccount, fetchImpl } = setup(async () => new Response(JSON.stringify({ code: 200, data: original })), 'test-access-token')
    expect(await service.resolve(url)).toMatchObject({ author: '小林', authorIsMe: true })
    changeAccount(99)
    const recipient = await service.resolve(url)
    expect(recipient).toMatchObject({ author: '小林', summary: '正文' })
    expect(recipient).not.toHaveProperty('authorIsMe')
    expect(recipient).not.toHaveProperty('source_context')
    expect(JSON.stringify(recipient)).not.toContain('private-source')
    changeAccount(42)
    expect(await service.resolve(url)).toMatchObject({ authorIsMe: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    for (const call of fetchImpl.mock.calls) expect((call as unknown as [string, RequestInit])[1].body).toBe('{"sid":"Abcdef1234567890"}')
  })
  it('retains the original display name when a personal-note snapshot has no sender identity', async () => {
    const { service } = setup(async () => new Response(JSON.stringify({ code: 200, data: {
      access_mode: 'link_read_only', items: [{ sender_display_name: '小林', sender_avatar_url: 'https://cdn.example.com/avatar.png',
        text_content: '个人快记', send_at: 1790000000, template_kind: 1 }],
    } })), 'test-access-token')
    const result = await service.resolve(url)
    expect(result).toMatchObject({ author: '小林', summary: '个人快记' })
    expect(result).not.toHaveProperty('authorIsMe')
  })
  it('reads only the authenticated snapshot for original ownership, without hydrating replies or source history', async () => {
    const { service, fetchImpl } = setup(async () => new Response(JSON.stringify({ code: 200, data: {
      access_mode: 'normal', items: [{ record_uid: 'original', sender_display_name: '原作者', text_content: '分享范围' }],
      source_context: { anchors: [{ record_uid: 'original', record_owner_user_id: 42 }] },
    } })), 'test-access-token')
    const result = await service.resolve(url)
    expect(result).toMatchObject({ author: '原作者', authorIsMe: true, summary: '分享范围' })
    expect(result).not.toHaveProperty('source_context')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]).toEqual(['https://chat.example.com/api/v1/chats/messages/copy-link/resolve', expect.objectContaining({
      body: '{"sid":"Abcdef1234567890"}', headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
    })])
  })
  it('falls back to the public snapshot without forwarding credentials or inferring Me when login expires', async () => {
    let attempt = 0
    const { service, fetchImpl } = setup(async () => ++attempt === 1 ? new Response('', { status: 401 })
      : new Response(JSON.stringify({ code: 200, data: { items: [{ sender_display_name: '同名用户', text_content: '内容' }] } })), 'test-access-token')
    expect(await service.resolve(url)).toMatchObject({ author: '同名用户', summary: '内容' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [endpoint, options] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(endpoint).toContain('/api/public/v1/chats/messages/copy-link/detail')
    expect(options.headers).not.toHaveProperty('Authorization')
  })
  it('never sends the login token to other public share services', async () => {
    const { service, fetchImpl } = setup(undefined, 'test-access-token')
    await service.resolve('https://jiwo.cc/share/topic/topic?code=x&s=100')
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('test-access-token')
  })
  it('reads only public snapshot without auth, private resolution, replies or media download', async () => {
    const { service, fetchImpl } = setup()
    expect(await service.resolve(url)).toMatchObject({ author: '作者', summary: '公开内容' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [endpoint, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(endpoint).toBe('https://chat.example.com/api/public/v1/chats/messages/copy-link/detail')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', body: '{"sid":"Abcdef1234567890"}' })
    expect(JSON.stringify(options)).not.toContain('private-session-secret')
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(options.signal?.aborted).toBe(false)
  })
  it.each([`https://jiwo.cc/share/call/${'a'.repeat(24)}.${'b'.repeat(64)}`, 'https://jiwo.cc/v#t=secret', 'https://jiwo.cc/app/auto-sticker/invite?code=secret', 'https://app-test.arkme.ai/s/Abcdef1234567890'])('never auto-performs unsafe or cross-environment reads for %s', async raw => {
    const { service, fetchImpl } = setup()
    expect((await service.resolve(raw))?.state).toBe('generic')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('only sends voiceprint p, never binding t', async () => {
    const { service, fetchImpl } = setup()
    await service.resolve('https://jiwo.cc/v?p=preview#t=binding-secret')
    const [endpoint, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(endpoint).toContain('/voiceprint/invites/preview')
    expect(options.body).toBe('{"preview_token":"preview"}')
  })
  it('uses explicit preview paths, not invitation start/join/retry-audit/installation', async () => {
    const { service, fetchImpl } = setup()
    await service.resolve('https://jiwo.cc/share/topic/topic?code=x&s=100')
    await service.resolve('https://jiwo.cc/share-call?token=x')
    await service.resolve('https://jiwo.cc/app/forward/abc?code=x&s=100')
    expect(fetchImpl.mock.calls.map(call => (call as unknown as [string])[0])).toEqual([
      'https://subject.example.com/api/public/v1/subject/preview-remote-subject',
      'https://call.example.com/api/public/v1/trtc/share-call-link/resolve',
      'https://chat.example.com/api/public/v1/chats/records/forward/share/detail',
    ])
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('retry_audit')
  })
  it('rejects oversized and invalid responses', async () => {
    const huge = setup(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    expect((await huge.service.resolve(url))?.state).toBe('error')
    const malformed = setup(async () => new Response('invalid-json'))
    expect((await malformed.service.resolve(url))?.state).toBe('error')
  })
  it('drops an in-flight result when account changes', async () => {
    let finish!: (value: Response) => void
    const { service, fetchImpl, changeAccount } = setup(() => new Promise<Response>(resolve => { finish = resolve }))
    const pending = service.resolve(url)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    changeAccount(99)
    finish(new Response(JSON.stringify({ code: 200, data: { items: [{ text_content: '旧内容' }] } })))
    expect(await pending).toBeNull()
  })
  it('does not read logged-out or unrecognized URLs', async () => {
    const { service, fetchImpl, changeAccount } = setup()
    changeAccount()
    expect((await service.resolve(url))?.state).toBe('restricted')
    expect(await service.resolve('https://evil.example.com/s/Abcdef1234567890')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each([[401, 'restricted'], [403, 'restricted'], [404, 'unavailable'], [410, 'expired'], [500, 'error']])('handles HTTP %s without inventing content', async (status, state) => {
    expect(await setup(async () => new Response('', { status })).service.resolve(url)).toEqual({ kind: 'message', state })
  })
})
