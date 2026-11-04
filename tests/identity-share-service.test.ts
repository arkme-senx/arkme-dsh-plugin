import { describe, expect, it, vi } from 'vitest'
import { IdentityShareService } from '../src/services/identity-share-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { identityShareTarget } from '../src/identity-share-link.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

const scope = 'prod:7', personUrl = 'https://jiwo.cc/linshare'
const token = 'chat_v1_' + Buffer.from(JSON.stringify({ c: 'native-group', i: 9 })).toString('base64url')
const groupUrl = `https://jiwo.cc/share/topic/${token}?code=signed-code&s=1793650000000`
const groupSource = { kind: 'group_chat', sourceRef: 'signed-new-group', displayName: '产品交流' }
function fixture() {
  let actor = 7
  const profile = { publicProfileSummariesByUserIds: vi.fn(async () => new Map([[8, { accountName: 'linshare', displayName: 'B公开昵称' }], [7, { accountName: 'myself', displayName: '我' }]])),
    shareIdentityByArkmeId: vi.fn(async (id: string) => ({ userId: id === 'myself' ? 7 : 8, accountName: id, displayName: 'B公开昵称' })) }
  const state = { title: '产品交流', creator_display_name: '邀请人', has_join: false, join_mode: 1, my_request_status: 0, expire_at: Date.now() + 3600_000, is_grey: false }
  const subject = vi.fn(async (path: string) => path.endsWith('/invite-preview-state') ? state : { res: 1 })
  const chatPost = vi.fn(async (_path: string, body: Record<string, unknown>) => ({ session: { chat_session_uid: body.chat_session_uid, session_kind: body.chat_session_uid === 'private' ? 1 : 2, status: 1 }, current_member: { user_id: actor, status: 1 }, private_counterpart: { user_id: 8 } }))
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId: actor, accessToken: 'token' }), authenticatedSubjectPost: subject, authenticatedChatPost: chatPost }
  const source = { openSourceRef: vi.fn(async (ref: string) => ({ kind: ref === 'private' ? 'private_chat' : 'group_chat', ownerRef: ref })),
    cachedChatSource: () => undefined, chatSourceFromBundle: vi.fn(async () => groupSource), setChatSource: vi.fn(), invalidateSourceListCache: vi.fn() }
  const contacts = { resolveTeamRecipient: vi.fn(async () => 8) }, groups = { groupInvitePreview: vi.fn(async () => ({ inviteLink: groupUrl, expireAtMillis: state.expire_at })) }
  const chat = { openPrivateChatFromUser: vi.fn(async () => ({ source: { kind: 'private_chat', sourceRef: 'A-B', displayName: 'B公开昵称' } })), memberWorldTarget: vi.fn(async () => ({ userId: 8 })) }
  const world = { worldAuthorFromRef: vi.fn(async () => ({ userId: 8 })) }
  return { service: new IdentityShareService(runtime as never, profile as never, source as never, contacts as never, groups as never, chat as never, world as never), runtime, profile, state, subject, chatPost, chat, source, groups, world, switchAccount: () => { actor = 99 } }
}

describe('portable person and group links', () => {
  it('resolves navigation without querying handles or private viewer labels and still fences accounts', async () => {
    const f = fixture(), controller = new AbortController()
    f.profile.publicProfileSummariesByUserIds.mockImplementation(() => new Promise(() => {}))
    await expect(f.service.person(scope, { kind: 'author', authorRef: 'viewer-bound' }, controller.signal, false)).resolves.toEqual({ userId: 8, isSelf: false })
    expect(f.world.worldAuthorFromRef).toHaveBeenCalledWith('viewer-bound', true, { labels: false, signal: controller.signal })
    expect(f.profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
    f.world.worldAuthorFromRef.mockImplementation(async () => { f.switchAccount(); return { userId: 8 } })
    await expect(f.service.person(scope, { kind: 'author', authorRef: 'viewer-bound' }, controller.signal, false)).rejects.toMatchObject({ code: 'identity-share-account-changed' })
  })
  it('validates the lightweight profile option at the host boundary', async () => {
    const read = vi.fn(async () => ({ userId: 8, isSelf: false })), controller = new AbortController()
    const facade = { identityPersonProfile: read } as never
    await dispatchArkmeHostOperation(facade, 'identity.person.read', { accountScope: scope, kind: 'author', authorRef: 'issued', includeAccountName: false }, undefined, undefined, undefined, undefined, controller.signal)
    expect(read).toHaveBeenCalledWith(scope, { kind: 'author', authorRef: 'issued' }, controller.signal, false)
    await expect(dispatchArkmeHostOperation(facade, 'identity.person.read', { accountScope: scope, kind: 'author', authorRef: 'issued', includeAccountName: 'false' })).rejects.toBeInstanceOf(Error)
    expect(read).toHaveBeenCalledOnce()
  })
  it('rejects lightweight reads combined with cache probes or refresh without dispatching a lookup', async () => {
    const read = vi.fn(), facade = { identityPersonProfile: read } as never
    const target = { accountScope: scope, kind: 'person', userId: 8, includeAccountName: false }
    for (const options of [{ cacheOnly: true }, { forceRefresh: true }]) {
      await expect(dispatchArkmeHostOperation(facade, 'identity.person.read', { ...target, ...options })).rejects.toMatchObject({ code: 'identity-profile-options-invalid' })
    }
    expect(read).not.toHaveBeenCalled()
    await dispatchArkmeHostOperation(facade, 'identity.person.read', { ...target, cacheOnly: false, forceRefresh: false })
    expect(read).toHaveBeenCalledWith(scope, { kind: 'person', userId: 8 }, undefined, false)
  })
  it('keeps explicit decorated reads compatible with public cache options', async () => {
    const f = fixture()
    await expect(f.service.person(scope, { kind: 'person', userId: 8 }, undefined, true)).resolves.toMatchObject({ userId: 8, accountName: 'linshare' })
    expect(f.profile.publicProfileSummariesByUserIds).toHaveBeenCalledOnce()
    const read = vi.fn(), facade = { identityPersonProfile: read } as never
    await dispatchArkmeHostOperation(facade, 'identity.person.read', { accountScope: scope, kind: 'person', userId: 8, includeAccountName: true, cacheOnly: true })
    expect(read).toHaveBeenCalledWith(scope, { kind: 'person', userId: 8 }, undefined, { cacheOnly: true, forceRefresh: false })
  })
  it('resolves a world target without requiring a shareable handle or creating a conversation', async () => {
    const f = fixture()
    f.profile.publicProfileSummariesByUserIds.mockResolvedValue(new Map())
    await expect(f.service.person(scope, { kind: 'member', sourceRef: 'group', memberRef: 'signed-member' })).resolves.toEqual({ userId: 8, isSelf: false })
    await expect(f.service.person(scope, { kind: 'self' })).resolves.toEqual({ userId: 7, isSelf: true })
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
    expect(f.profile.shareIdentityByArkmeId).not.toHaveBeenCalled()
  })
  it('rejects a profile result when the account changes while resolving its owner', async () => {
    const f = fixture()
    f.chat.memberWorldTarget.mockImplementation(async () => { f.switchAccount(); return { userId: 8 } })
    await expect(f.service.person(scope, { kind: 'member', sourceRef: 'group', memberRef: 'signed-member' })).rejects.toMatchObject({ code: 'identity-share-account-changed' })
    expect(f.profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
  })
  it('rechecks a cached link target before team contact and rejects a reassigned public handle', async () => {
    const f=fixture()
    await expect(f.service.teamRecipient(scope,personUrl,8)).resolves.toBe(8)
    f.profile.shareIdentityByArkmeId.mockResolvedValue({userId:999,accountName:'linshare',displayName:'新持有人'})
    await expect(f.service.teamRecipient(scope,personUrl,8)).rejects.toMatchObject({code:'identity-share-person-changed'})
    await expect(f.service.teamRecipient(scope,'https://jiwo.cc/myself',7)).rejects.toMatchObject({code:'identity-share-person-changed'})
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('uses the existing test share host for a test account', async () => {
    const f = fixture(); f.runtime.config.environment = 'test'
    await expect(f.service.link('test:7', { kind: 'person', userId: 8 })).resolves.toEqual({ kind: 'person', url: 'https://jotmo-app.senguo.me/linshare' })
  })
  it('copies verified public identities from contact, member, author and private sources without copying remarks or creating a chat', async () => {
    const f = fixture()
    for (const target of [{ kind: 'contact', contactRef: 'opaque' }, { kind: 'member', sourceRef: 'private', memberRef: 'opaque' }, { kind: 'author', authorRef: 'opaque' }, { kind: 'source', sourceRef: 'private' }] as const) {
      await expect(f.service.link(scope, target)).resolves.toEqual({ kind: 'person', url: personUrl })
    }
    await expect(f.service.link(scope, { kind: 'self' })).resolves.toEqual({ kind: 'person', url: 'https://jiwo.cc/myself' })
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
    expect(f.subject).not.toHaveBeenCalled()
  })
  it('does not share an account-name fallback that resolves to a different person', async () => {
    const f = fixture()
    f.profile.shareIdentityByArkmeId.mockResolvedValue({ userId: 999, accountName: 'linshare', displayName: '同名者' })
    await expect(f.service.link(scope, { kind: 'person', userId: 8 })).rejects.toMatchObject({ code: 'identity-share-person-unavailable' })
  })
  it('keeps the exact existing group invitation and its expiry', async () => {
    const f = fixture()
    await expect(f.service.link(scope, { kind: 'source', sourceRef: 'native-group' })).resolves.toEqual({ kind: 'group', url: groupUrl, expireAtMillis: f.state.expire_at })
    expect(f.groups.groupInvitePreview).toHaveBeenCalledWith('native-group', undefined)
  })
  it('resolves on the receiving account and only creates/opens a private chat on explicit action', async () => {
    const f = fixture()
    expect(await f.service.read(scope, personUrl)).toMatchObject({ kind: 'person', userId: 8, displayName: 'B公开昵称', isSelf: false })
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
    await expect(f.service.open(scope, personUrl, 8)).resolves.toMatchObject({ status: 'opened', source: { sourceRef: 'A-B' } })
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledExactlyOnceWith(8, { expectedViewerUserId: 7 })
    await expect(f.service.open(scope, personUrl, 999)).rejects.toMatchObject({ code: 'identity-share-person-changed' })
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledTimes(1)
    await expect(f.service.open(scope, 'https://jiwo.cc/myself', 7)).rejects.toMatchObject({ code: 'identity-share-self' })
  })
  it('reads group cards without joining and validates token evidence again before joining', async () => {
    const f = fixture()
    await expect(f.service.read(scope, groupUrl)).resolves.toMatchObject({ kind: 'group', hasJoined: false, joinMode: 1 })
    expect(f.subject.mock.calls.map(call => call[0])).toEqual(['/api/v1/subject/invite-preview-state'])
    await expect(f.service.open(scope, groupUrl)).rejects.toMatchObject({ code: 'identity-share-not-joined' })
    await expect(f.service.join(scope, groupUrl)).resolves.toEqual({ status: 'opened', source: groupSource })
    expect(f.subject).toHaveBeenCalledWith('/api/v1/subject/request-join', { ob_remote_subject: token, code: 'signed-code', stamp: 1793650000000, display_name: '', apply_note: '' }, expect.objectContaining({ userId: 7 }), undefined)
    expect(f.chatPost).toHaveBeenCalledWith('/api/v1/chats/detail', { chat_session_uid: 'native-group' }, expect.objectContaining({ userId: 7 }), undefined, expect.objectContaining({ bypassCache: true }))
  })
  it('opens existing membership without a join write and preserves pending approval', async () => {
    const f = fixture(); f.state.has_join = true
    await expect(f.service.open(scope, groupUrl)).resolves.toMatchObject({ status: 'opened' })
    expect(f.subject.mock.calls.some(([path]) => path.endsWith('/request-join'))).toBe(false)
    f.state.has_join = false; f.state.join_mode = 2
    f.subject.mockImplementation(async path => path.endsWith('/invite-preview-state') ? f.state : { res: 4 })
    await expect(f.service.join(scope, groupUrl)).resolves.toEqual({ status: 'pending' })
    f.state.my_request_status = 1; const writes = f.subject.mock.calls.filter(([path]) => path.endsWith('/request-join')).length
    await expect(f.service.join(scope, groupUrl)).resolves.toEqual({ status: 'pending' })
    expect(f.subject.mock.calls.filter(([path]) => path.endsWith('/request-join'))).toHaveLength(writes)
  })
  it('rejects expired, malformed and cross-environment links before any membership write', async () => {
    const f = fixture(); f.state.expire_at = Date.now() - 1
    await expect(f.service.join(scope, groupUrl)).rejects.toMatchObject({ code: 'identity-share-expired' })
    await expect(f.service.read(scope, 'https://evil.example/linshare')).rejects.toMatchObject({ code: 'identity-share-environment-mismatch' })
    await expect(f.service.read(scope, 'https://app-test.arkme.ai/linshare')).rejects.toMatchObject({ code: 'identity-share-environment-mismatch' })
    await expect(f.service.read(scope, 'https://jiwo.cc/share/topic/chat_v1_bad?code=a&s=1')).rejects.toMatchObject({ code: 'identity-share-invalid' })
    expect(f.subject.mock.calls.some(([path]) => path.endsWith('/request-join'))).toBe(false)
    expect(identityShareTarget('https://jiwo.cc/share/topic/old-invite?code=a&s=1')).toBeUndefined()
  })
  it('fences account changes before requests and before exposing late responses', async () => {
    const f = fixture()
    await expect(f.service.read('prod:99', personUrl)).rejects.toMatchObject({ code: 'identity-share-account-changed' })
    expect(f.profile.shareIdentityByArkmeId).not.toHaveBeenCalled()
    f.profile.shareIdentityByArkmeId.mockImplementation(async () => { f.switchAccount(); return { userId: 8, accountName: 'linshare', displayName: 'B' } })
    await expect(f.service.read(scope, personUrl)).rejects.toMatchObject({ code: 'identity-share-account-changed' })
  })
  it('Host forwards only target-kind fields and the actual abort signal', async () => {
    const facade = { identityShareLink: vi.fn(async () => ({})) }, controller = new AbortController()
    await dispatchArkmeHostOperation(facade as never, 'identity.share.link', { accountScope: scope, kind: 'contact', contactRef: 'issued', userId: 999, sourceRef: 'forged' }, undefined, undefined, undefined, undefined, controller.signal)
    expect(facade.identityShareLink).toHaveBeenCalledWith(scope, { kind: 'contact', contactRef: 'issued' }, controller.signal)
  })
})

describe('public identity lookup contract', () => {
  it('projects the optional avatar from the identity response without a second public lookup', async () => {
    const read=vi.fn(async()=>({items:[{user_id:8,jotmo_id:'linshare',nick_name:'公开昵称',head_img:'phone_avatar://v1/7/林'}]}))
    const service=new ProfileService({requireSession:async()=>({userId:7}),accountScopedPublicAuthReadPost:read} as never)
    await expect(service.shareIdentityByArkmeId('linshare')).resolves.toMatchObject({userId:8,avatarFallback:{kind:'phone_default',colorIndex:7,label:'林'}})
    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0]).toEqual(['/api/public/v1/auth/get-public-user-by-jotmo-ids',{jotmo_ids:['linshare']},7,undefined,{lane:'interactive-read',bypassCache:true}])
  })
  it('reads only public names and handles, never the viewer remark, and rejects ambiguous identities', async () => {
    const read = vi.fn(async () => ({ items: [{ user_id: 8, jotmo_id: 'linshare', nick_name: '公开昵称', remark: '私有备注', head_img: '' }] }))
    const service = new ProfileService({ requireSession: async () => ({ userId: 7 }), accountScopedPublicAuthReadPost: read } as never)
    await expect(service.shareIdentityByArkmeId('linshare')).resolves.toMatchObject({ userId: 8, accountName: 'linshare', displayName: '公开昵称' })
    expect(read).toHaveBeenCalledOnce()
    read.mockResolvedValue({ items: [{ user_id: 8, jotmo_id: 'other', nick_name: '同名者', remark: '', head_img: '' }] })
    await expect(service.shareIdentityByArkmeId('linshare')).rejects.toMatchObject({ code: 'identity-share-person-unavailable' })
  })
})
