import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorldService } from '../src/services/world-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import { ArkmeService } from '../src/arkme-service.js'
import { parseShareLink } from '../src/share-link-preview.js'

const runtimes: ServiceRuntime[] = []
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()) })
async function fixture(recordUid = 'record-1') {
  let userId = 42
  const raw: Record<string, unknown> = { record_uid: recordUid, principal: { kind: 'person', user_id: 7, name: '公开昵称' }, user_id: 7, nick_name: '公开昵称', text_content: '公开正文', is_public: true, check_status: 2, images: [], videos: [], voices: [] }
  const config = { environment: 'test', worldBaseUrl: 'https://world.test', authBaseUrl: 'https://auth.test',
    subjectBaseUrl: 'https://subject.test', recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test',
    botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test',
    relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test', audioBaseUrl: 'https://audio.test',
    shareWebsite: 'https://app-test.arkme.ai', requestTimeoutMs: 5000, maxTextLength: 20_000 } as ArkmeServiceConfig
  const readAuthor = vi.fn(async () => ({ items: [{ user_id: 7, jotmo_id: 'author_7' }] }))
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname
    const data = path.endsWith('/query') ? { items: [raw], has_more: false } : path.endsWith('/read') ? raw : await readAuthor()
    return new Response(JSON.stringify({ code: path.endsWith('/read') && (raw.is_public === false || [1, 4].includes(Number(raw.check_status))) ? 404 : 200, data }))
  })
  const runtime = new ServiceRuntime(config, { async read() { return { userId, accessToken: 'access', refreshToken: `refresh-${userId}` } }, async write() {}, async delete() {} },
    { async uniqueCode() { return 'world-share-test-secret' } } as StateStore, fetcher)
  runtimes.push(runtime)
  const world = new WorldService(runtime, {} as never, {} as never, {} as never)
  const target = (await world.listWorldFeed()).items[0]!.recordRef
  fetcher.mockClear()
  return { world, target, raw, config, fetcher, readAuthor, changeAccount() { userId = 99 } }
}

describe('World public sharing', () => {
  it('uses the original public record URL and only reads the publication and public author profile', async () => {
    const f = await fixture()
    expect(await f.world.shareWorldRecord(f.target, 42)).toEqual({ url: 'https://app-test.arkme.ai/shijie/author_7/record/record-1', title: '公开昵称的世界', previewText: '公开正文' })
    expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/public/v1/world/read', '/api/v1/auth/get-public-users-by-ids'])
  })
  it('round-trips namespaced legacy IDs while rejecting encoded path separators and double encoding', async () => {
    const f = await fixture('7:imported-record')
    const share = await f.world.shareWorldRecord(f.target, 42)
    expect(share.url).toBe('https://app-test.arkme.ai/shijie/author_7/record/7%3Aimported-record')
    expect(parseShareLink(share.url)).toMatchObject({ kind: 'public-record', id: '7:imported-record' })
    expect(parseShareLink(share.url.replace('7%3A', '7%253A'))).toBeUndefined()
    expect(parseShareLink(share.url.replace('7%3A', '7%2F'))).toBeUndefined()
  })
  it.each([{ is_public: false }, { check_status: 1 }, { check_status: 4 }, { record_uid: 'another-record' }, { parent_record_uid: 'root' }])('rejects an unpublished, unaudited or mismatched publication: %j', async changes => {
    const f = await fixture(); Object.assign(f.raw, changes)
    await expect(f.world.shareWorldRecord(f.target, 42)).rejects.toMatchObject({ httpStatus: 404 })
    expect(f.readAuthor).not.toHaveBeenCalled()
  })
  it('does not reuse another account reference or a missing author identity', async () => {
    const f = await fixture()
    await expect(f.world.shareWorldRecord(f.target, 99)).rejects.toMatchObject({ code: 'world-account-changed' })
    expect(f.fetcher).not.toHaveBeenCalled()
    f.readAuthor.mockResolvedValue({ items: [] })
    await expect(f.world.shareWorldRecord(f.target, 42)).rejects.toMatchObject({ code: 'world-share-author-invalid' })
  })
  it('rejects a response arriving after an account change and a cross-environment URL', async () => {
    const f = await fixture()
    f.config.shareWebsite = 'https://app.arkme.ai'
    await expect(f.world.shareWorldRecord(f.target, 42)).rejects.toMatchObject({ code: 'world-share-url-invalid' })
    f.config.shareWebsite = 'https://app-test.arkme.ai'
    f.readAuthor.mockImplementation(async () => { f.changeAccount(); return { items: [{ user_id: 7, jotmo_id: 'author_7' }] } })
    await expect(f.world.shareWorldRecord(f.target, 42)).rejects.toMatchObject({ code: 'world-account-changed' })
  })
  it('rechecks publication before forwarding and sends only its URL and the new comment', async () => {
    const f = await fixture(), send = vi.fn(async () => ({ localState: 'synced', itemUid: 'sent' }))
    const service = { world: f.world, chat: { sendSourceText: send } } as unknown as ArkmeService
    const options = { targetSourceRef: 'target', recordUid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', commentText: '我的附言' }
    await ArkmeService.prototype.forwardWorldRecord.call(service, f.target, 42, options)
    expect(send).toHaveBeenCalledWith('target', '我的附言\n\nhttps://app-test.arkme.ai/shijie/author_7/record/record-1', { recordUid: options.recordUid, expectedUserId: 42 })
    send.mockClear(); f.raw.is_public = false
    await expect(ArkmeService.prototype.forwardWorldRecord.call(service, f.target, 42, options)).rejects.toMatchObject({ httpStatus: 404 })
    expect(send).not.toHaveBeenCalled()
  })
})

it('shares team ownership without looking up the publishing actor as a person', async () => {
  const f = await fixture()
  f.raw.principal = { kind: 'team', team_id: 123, jotmo_id: 'team_123', name: '研发团队' }
  delete f.raw.user_id
  expect(await f.world.shareWorldRecord(f.target, 42)).toEqual({ url: 'https://app-test.arkme.ai/shijie/team_123/record/record-1', title: '研发团队的世界', previewText: '公开正文' })
  expect(f.readAuthor).not.toHaveBeenCalled()
  expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/public/v1/world/read'])
})
