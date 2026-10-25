import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorldService } from '../src/services/world-service.js'
import { WorldCard, WorldInteractionThreadList, applyWorldAuthorLabels, applyWorldInteractionAuthorLabels } from '../src/client/ArkmeWorldSurface.js'
import type { ArkmeWorldFeedItem, ArkmeWorldInteractionItem } from '../src/types.js'

const services: WorldService[] = []
afterEach(() => { services.splice(0).forEach(service => service.dispose()); vi.restoreAllMocks(); vi.useRealTimers() })
async function fixture() {
  let viewer = 42
  const raw = [7, 7, 8, 9, 10, 11, 42].map((id, index) => ({ user_id: id, record_uid: `record-${index}`, nick_name: `作者${id}`, text_content: '公开正文', images: [], videos: [], voices: [] }))
  const publicRead = vi.fn(async (_path, _body, _session, _signal) => ({ items: [
    { user_id: 7, member_type: 1 }, { user_id: 8, member_type: 2 }, { user_id: 9, member_type: 0 },
    { user_id: 10 }, { user_id: 99, member_type: 2 },
  ] }))
  const ownRead = vi.fn(async () => ({ member_type: 2 }))
  const remarks = vi.fn(async () => new Map([[7, '我的备注']]))
  const runtime = { config: { environment: 'test', worldBaseUrl: 'https://world.test' }, stateStore: { async uniqueCode() { return 'world-member-test' } },
    async requireSession() { return { userId: viewer, accessToken: 'access', refreshToken: `refresh-${viewer}` } },
    async post(_base, path, body) { return path.endsWith('/world-list') ? { list: raw, total: raw.length } : raw.find(item => item.record_uid === body.record_uid) },
    authenticatedAuthPost: publicRead, authenticatedAuthReadPost: ownRead }
  const world = new WorldService(runtime as never, {} as never, {} as never, {} as never, { privateDisplayNamesByUserIds: remarks })
  services.push(world)
  const page = await world.listWorldFeed()
  return { world, page, publicRead, ownRead, remarks, changeAccount() { viewer = 99 } }
}

describe('World author memberships', () => {
  it('loads unique peers in one background batch, handles self through the current-account API, and keeps private remarks', async () => {
    const f = await fixture()
    expect(f.publicRead).not.toHaveBeenCalled(); expect(f.ownRead).not.toHaveBeenCalled()
    const labels = await f.world.worldAuthorLabels(f.page.items.map(item => item.recordRef))
    expect(f.publicRead).toHaveBeenCalledOnce()
    expect(f.publicRead.mock.calls[0]![1]).toEqual({ user_ids: [7, 8, 9, 10, 11] })
    expect(f.ownRead.mock.calls[0]!.slice(0, 2)).toEqual(['/api/v1/premium/get/member', {}])
    expect(labels.map(item => item.memberType)).toEqual(['vip', 'vip', 'svip', 'free', 'unknown', 'unknown', 'svip'])
    expect(labels[0]!.authorName).toBe('我的备注')
    expect(f.remarks.mock.calls[0]![0]).not.toContain(42)
    await f.world.worldAuthorLabels(f.page.items.map(item => item.recordRef))
    expect(f.publicRead).toHaveBeenCalledOnce(); expect(f.ownRead).toHaveBeenCalledOnce()
    expect((await f.world.readWorldRecord(f.page.items[0]!.recordRef)).memberType).toBe('vip')
  })

  it('shares concurrent batches and lets one cancelled reader leave the other intact', async () => {
    const f = await fixture(), controller = new AbortController()
    let resolve!: (value: { items: { user_id: number; member_type: number }[] }) => void
    f.publicRead.mockImplementation(() => new Promise(done => { resolve = done }))
    const ref = f.page.items[0]!.recordRef
    const first = f.world.worldAuthorLabels([ref], controller.signal)
    const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = f.world.worldAuthorLabels([ref])
    await vi.waitFor(() => expect(f.publicRead).toHaveBeenCalledOnce())
    controller.abort(); resolve({ items: [{ user_id: 7, member_type: 1 }] })
    await failed
    expect((await second)[0]!.memberType).toBe('vip')
    expect(f.publicRead).toHaveBeenCalledOnce()
  })

  it('expires paid cache, retains unknown after failure, then retries without treating a missing field as free', async () => {
    const f = await fixture(), clock = vi.spyOn(Date, 'now')
    const now = Date.now(); clock.mockReturnValue(now)
    const ref = f.page.items[0]!.recordRef
    expect((await f.world.worldAuthorLabels([ref]))[0]!.memberType).toBe('vip')
    clock.mockReturnValue(now + 60_001); f.publicRead.mockRejectedValueOnce(new Error('离线'))
    expect((await f.world.worldAuthorLabels([ref]))[0]!.memberType).toBe('unknown')
    await f.world.worldAuthorLabels([ref]); expect(f.publicRead).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(now + 65_002)
    expect((await f.world.worldAuthorLabels([ref]))[0]!.memberType).toBe('vip')
    expect(f.publicRead).toHaveBeenCalledTimes(3)
  })

  it('does not project a delayed entitlement after account change or service disposal', async () => {
    const f = await fixture()
    f.publicRead.mockImplementation(async () => { f.changeAccount(); return { items: [{ user_id: 7, member_type: 2 }] } })
    await expect(f.world.worldAuthorLabels([f.page.items[0]!.recordRef])).rejects.toMatchObject({ code: 'world-account-changed' })
    const other = await fixture()
    other.publicRead.mockImplementation(async () => { other.world.dispose(); return { items: [{ user_id: 7, member_type: 2 }] } })
    await expect(other.world.worldAuthorLabels([other.page.items[0]!.recordRef])).rejects.toMatchObject({ code: 'world-account-changed' })
  })
})

const post: ArkmeWorldFeedItem = { recordRef: 'post', authorName: '作者', headline: '', textContent: '正文', imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, tags: [], templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1, extendCount: 0 }
describe('World membership presentation', () => {
  it.each(['vip', 'svip', 'free', 'unknown', undefined] as const)('uses the shared badge for %s, with no placeholder for a non-member or unknown', memberType => {
    const item = { ...post, ...(memberType ? { memberType } : {}) }
    const html = renderToStaticMarkup(<WorldCard item={item} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false}
      onOpenInteractions={() => {}} onInteractionCreated={() => {}} onToggleVoiceprint={() => {}} />)
    const paid = memberType === 'vip' || memberType === 'svip'
    expect(html.includes('data-arkme-membership=')).toBe(paid)
    if (paid) expect(html).toContain(`aria-label="${memberType.toUpperCase()} 会员"`)
  })

  it('decorates self and peer comments and clears a former paid badge when membership becomes free', () => {
    const view = { status: 'success' as const, items: [{ ...post, memberType: 'vip' as const }] }
    const updated = applyWorldAuthorLabels(view, new Map([['post', '作者备注']]), new Map([['post', 'free']]))
    expect(updated.items[0]).toMatchObject({ authorName: '作者备注', memberType: 'free' })
    const items = [{ interactionRef: 'comment', parentRef: 'post', isSelf: true, authorName: '我', textContent: '评论', createdAtMillis: 1, publishedAtMillis: 1, imageCount: 0, videoCount: 0, voiceCount: 0 }] satisfies ArkmeWorldInteractionItem[]
    const comments = applyWorldInteractionAuthorLabels(items, [{ authorRef: 'comment', authorName: '我', memberType: 'svip' }])
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(<WorldInteractionThreadList rootRef="post" items={comments} compact={compact} />)
      expect(html).toContain('data-arkme-membership="svip"')
      expect(html).toContain('aria-label="SVIP 会员"')
    }
  })
})
