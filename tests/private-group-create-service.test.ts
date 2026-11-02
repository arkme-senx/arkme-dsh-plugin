import { describe, expect, it, vi } from 'vitest'
import { PrivateGroupCreateService } from '../src/services/private-group-create-service.js'
import { GroupService } from '../src/services/group-service.js'
import { ArkmePluginError } from '../src/services/service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

const base = { accountScope: 'test:1001', sourceRef: 'private-ref' }
const requestUid = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
const input = { ...base, personRefs: ['person-3'], title: '三人讨论', isPublic: false, clientMutationId: requestUid, allowDuplicate: false, allowUnchecked: false }
function fixture() {
  let actor = 1001
  const groups = new Map<string, { ids: number[]; title: string }>()
  const post = vi.fn(async (path: string, body: Record<string, any>) => {
    if (path.endsWith('/detail')) return { session: { chat_session_uid: 'private-a', session_kind: 1, status: 1 }, current_member: { user_id: actor, status: 1 }, private_counterpart: { user_id: 1002 } }
    if (path.endsWith('/common-group/query')) {
      const known = body.known_group_uids as string[] | undefined
      const all = [...groups].filter(([uid, g]) => g.ids.includes(1001) && g.ids.includes(body.target_user_id) && (known ? known.includes(uid) : uid > (body.after || ''))).sort(([a], [b]) => a.localeCompare(b))
      const rows = known ? all : all.slice(0, 20), hasMore = !known && all.length > rows.length
      return { items: rows.map(([uid, g]) => ({ chat_session_uid: uid, title: g.title, member_count: g.ids.length })), removed: known?.filter(uid => !rows.some(([id]) => id === uid)) ?? [], has_more: hasMore, ...(hasMore ? { next_after: rows.at(-1)![0] } : {}) }
    }
    if (path.endsWith('/members/page')) { const g = groups.get(body.chat_session_uid)!; return { chat_session_uid: body.chat_session_uid, items: g.ids.slice(0, body.limit).map(user_id => ({ user_id, status: 1 })), has_more: g.ids.length > body.limit } }
    if (path.endsWith('/create-group')) {
      if (!groups.has(body.chat_session_uid)) groups.set(body.chat_session_uid, { ids: [actor, ...body.member_user_ids], title: body.title })
      return { session: { chat_session_uid: body.chat_session_uid, title: body.title } }
    }
    throw new Error(path)
  })
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: actor, accessToken: 'fixture' }), authenticatedChatPost: post } as never
  const source = { openSourceRef: vi.fn(async (ref: string) => ref === 'private-ref' ? { kind: 'private_chat', ownerRef: 'private-a', displayName: '小王' } : { kind: 'group_chat', ownerRef: ref.replace('group:', ''), displayName: '已有群' }),
    cachedChatSource: () => undefined,
    sourceItem: async (p: { ownerRef: string; displayName: string }) => ({ sourceRef: 'group:' + p.ownerRef, kind: 'group_chat', displayName: p.displayName }),
    chatSourceFromBundle: async (p: { session: { chat_session_uid: string; title: string } }) => ({ sourceRef: 'group:' + p.session.chat_session_uid, kind: 'group_chat', displayName: p.session.title }),
    setChatSourceByKey: vi.fn(), invalidateSourceListCache: vi.fn() } as never
  const contacts = { groupCreationPeople: vi.fn(async () => ({ items: [
    { personRef: 'person-2', userId: 1002, displayName: '小王', searchText: '小王' }, { personRef: 'person-3', userId: 1003, displayName: '小陈', searchText: '小陈' },
  ], hasMore: false, incomplete: false })),
    resolveGroupCreationPerson: vi.fn(async (ref: string) => { if (!['person-2', 'person-3', 'person-4'].includes(ref)) throw new ArkmePluginError('contact-ref-invalid', '联系人已失效', false); return { userId: Number(ref.slice(-1)) + 1000, displayName: '联系人' } }),
  }
  const group = new GroupService(runtime, source, {} as never)
  const service = new PrivateGroupCreateService(runtime, source, group, contacts)
  return { service, post, groups, source, contacts, switchAccount: () => { actor = 1004 } }
}

describe('create a group from an existing private chat', () => {
  it('includes the chat partner and selected people in one native creation request', async () => {
    const { service, post, groups } = fixture()
    const result = await service.create(input)
    expect(result).toMatchObject({ status: 'created', source: { kind: 'group_chat' } })
    expect(groups.get(requestUid)?.ids).toEqual([1001, 1002, 1003])
    const writes = post.mock.calls.filter(([path]) => path.endsWith('/create-group'))
    expect(writes).toHaveLength(1)
    expect(writes[0]![1]).toMatchObject({ member_user_ids: [1002, 1003], is_public: false, chat_session_uid: requestUid })
    expect(post.mock.calls.some(([path]) => path.includes('/members/add'))).toBe(false)
  })
  it('distinguishes identical members from supersets, excluding partial overlaps', async () => {
    const { service, groups } = fixture()
    groups.set('same', { ids: [1003, 1001, 1002], title: '三人群' })
    groups.set('larger', { ids: [1001, 1002, 1003, 1004], title: '四人群' })
    groups.set('different', { ids: [1001, 1002, 1004], title: '另一批人' })
    const result = await service.matches(input)
    expect(result.map(g => [g.source.displayName, g.kind, g.extraCount])).toEqual([['三人群', 'exact', 0], ['四人群', 'includes', 1]])
  })
  it('checks all common-group pages and returns new matches before writing', async () => {
    const { service, post, groups } = fixture()
    for (let i = 0; i < 22; i++) groups.set('group-' + String(i).padStart(2, '0'), { ids: [1001, 1002, i === 21 ? 1003 : 2000 + i], title: '群 ' + i })
    const result = await service.create(input)
    expect(result).toMatchObject({ status: 'matches', matches: [{ source: { displayName: '群 21' }, kind: 'exact' }] })
    expect(post.mock.calls.some(([path]) => path.endsWith('/create-group'))).toBe(false)
    expect(post.mock.calls.filter(([path, body]) => path.endsWith('/common-group/query') && !body.known_group_uids).length).toBe(2)
    await expect(service.create({ ...input, allowDuplicate: true })).resolves.toMatchObject({ status: 'created' })
  })
  it('fails closed for incomplete checks unless the caller explicitly chooses to continue', async () => {
    const { service, post } = fixture()
    const normal = post.getMockImplementation()!
    post.mockImplementation(async (path, body) => { if (path.includes('/common-group/')) throw new Error('检查网络中断'); return await normal(path, body) })
    await expect(service.create(input)).rejects.toMatchObject({ code: 'private-group-check-failed' })
    expect(post.mock.calls.some(([path]) => path.endsWith('/create-group'))).toBe(false)
    await expect(service.create({ ...input, allowUnchecked: true })).resolves.toMatchObject({ status: 'created' })
  })
  it('reuses the native mutation identity when retrying an already-created group', async () => {
    const { service, groups, post } = fixture()
    groups.set(requestUid, { ids: [1001, 1002, 1003], title: input.title })
    await expect(service.create(input)).resolves.toMatchObject({ status: 'created' })
    expect(groups.size).toBe(1)
    expect(post.mock.calls.filter(([path]) => path.endsWith('/create-group'))).toHaveLength(1)
  })
  it('excludes the fixed chat partner from candidates and rejects invalid contacts', async () => {
    const { service, post } = fixture()
    expect((await service.people(base)).items.map(p => p.personRef)).toEqual(['person-3'])
    await expect(service.create({ ...input, personRefs: ['forged-ref'] })).rejects.toMatchObject({ code: 'contact-ref-invalid' })
    await expect(service.create({ ...input, personRefs: ['person-2'] })).rejects.toMatchObject({ code: 'private-group-people-invalid' })
    expect(post.mock.calls.some(([path]) => path.endsWith('/create-group'))).toBe(false)
  })
  it('rejects an old account before transport and discards a late response', async () => {
    const { service, post, switchAccount } = fixture()
    await expect(service.readContext({ ...base, accountScope: 'test:9999' })).rejects.toMatchObject({ code: 'private-group-account-changed' })
    expect(post).not.toHaveBeenCalled()
    const normal = post.getMockImplementation()!
    post.mockImplementationOnce(async (path, body) => { const result = await normal(path, body); switchAccount(); return result })
    await expect(service.readContext(base)).rejects.toMatchObject({ code: 'private-group-account-changed' })
  })
  it('Host forwards opaque people refs, explicit decisions and cancellation, not caller user IDs', async () => {
    const facade = { createGroupFromPrivate: vi.fn(async value => value) }, controller = new AbortController()
    await dispatchArkmeHostOperation(facade as never, 'group.private.create', { ...input, userId: 9999, memberUserIds: [9999] }, undefined, undefined, undefined, undefined, controller.signal)
    expect(facade.createGroupFromPrivate).toHaveBeenCalledWith(input, controller.signal)
    await expect(dispatchArkmeHostOperation(facade as never, 'group.private.create', { ...input, isPublic: undefined })).rejects.toBeDefined()
    expect(facade.createGroupFromPrivate).toHaveBeenCalledOnce()
  })
})
