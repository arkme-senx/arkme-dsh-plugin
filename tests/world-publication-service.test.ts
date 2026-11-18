import { expect, it, vi } from 'vitest'
import { WorldPublicationService } from '../src/services/world-publication-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { WorldPublication } from '../src/world-publication-contract.js'
function fixture() {
  let actor = 8
  const runtime = {
    config: { environment: 'test' },
    requireSession: async () => ({ userId: actor, refreshToken: 'session' }),
    stateStore: { uniqueCode: async () => 'test-publication-key' },
  } as unknown as ServiceRuntime
  const source = {
    sourceRef: 'source',
    itemUid: 'original-uid',
    version: 7,
    title: '标题',
    textContent: '原文',
    sendAtMillis: 1,
    attachments: [],
  }
  const record = { worldPublishSource: vi.fn(async () => source) }
  const chat = {
    recordEditHistoryTarget: vi.fn(async () => ({ kind: 'owned', recordUid: 'original-uid', viewerUserId: actor })),
  }
  const world = {
    publicationStatuses: vi.fn(async () => new Map([['original-uid', true]])),
    publicationPrincipal: vi.fn(async () => ({ uid: 'original-uid', owner: actor, team: 0, viewer: actor })),
    publishExistingSource: vi.fn(async () => ({ worldPublished: true })),
    unpublishExisting: vi.fn(async () => {}),
  }
  const link = {
    source_uid: 'original-uid',
    team_id: '9223372036854775800',
    team_name: '团队',
    content_uid: 'original',
    publication_uid: 'team-world-' + 'a'.repeat(64),
    revision: 3,
    public_requested: true,
    deleted: false,
    pending: false,
    can_manage: true,
  }
  const teams = {
    sourcePublicationLinks: vi.fn(async () => [link]),
    publicationLink: vi.fn(async () => link),
    unpublishLink: vi.fn(async () => ({ pending: false, result: { visibility: 'unpublished' } })),
  }
  const service = new WorldPublicationService(runtime, record as never, chat as never, world as never, teams as never)
  return {
    service,
    record,
    world,
    chat,
    teams,
    source,
    link,
    switch: () => {
      actor = 9
    },
  }
}
const targets = [{ sourceRef: 'source', messageActionRef: 'signed-action', itemUid: 'card' }]
it('returns both identities with opaque account-bound capabilities and no source/body leakage', async () => {
  const f = fixture(),
    out = (await f.service.execute({ action: 'sources', accountKey: 'test:8', targets })) as {
      items: { publications: WorldPublication[] }[]
    }
  expect(out.items[0]!.publications).toHaveLength(2)
  expect(JSON.stringify(out)).not.toMatch(/original-uid|9223372036854775800|原文/)
  const team = out.items[0]!.publications[1]!
  await f.service.execute({
    action: 'unpublish',
    accountKey: 'test:8',
    publicationRef: team.ref,
    requestUid: 'fixed-request-1234',
  })
  expect(f.teams.unpublishLink).toHaveBeenCalledWith(
    { team_id: '9223372036854775800', content_uid: 'original', revision: 3 },
    'fixed-request-1234',
    8,
    undefined,
  )
  f.switch()
  await expect(
    f.service.execute({
      action: 'unpublish',
      accountKey: 'test:9',
      publicationRef: team.ref,
      requestUid: 'fixed-request-1234',
    }),
  ).rejects.toThrow()
  expect(f.teams.unpublishLink).toHaveBeenCalledTimes(1)
})
it('publishes only the committed owner snapshot, rejects stale versions and never calls private record creation', async () => {
  const f = fixture(),
    input = {
      action: 'publish-source' as const,
      accountKey: 'test:8',
      origin: { sourceRef: 'source', itemUid: 'original-uid' },
      version: 7,
    }
  await f.service.execute(input)
  expect(f.world.publishExistingSource).toHaveBeenCalledWith(f.source, 8, undefined)
  await expect(f.service.execute({ ...input, version: 6 })).rejects.toMatchObject({ code: 'world-source-changed' })
  expect(f.world.publishExistingSource).toHaveBeenCalledTimes(1)
})
it('rejects another owner and invalid batches before publication/status I/O', async () => {
  const f = fixture()
  await expect(f.service.execute({ action: 'sources', accountKey: 'test:9', targets })).rejects.toThrow()
  await expect(
    f.service.execute({ action: 'sources', accountKey: 'test:8', targets: [...targets, ...targets] }),
  ).rejects.toThrow()
  f.chat.recordEditHistoryTarget.mockResolvedValue({
    kind: 'chat',
    recordUid: 'other',
    viewerUserId: 8,
    recordOwnerUserId: 9,
  } as never)
  await expect(f.service.execute({ action: 'sources', accountKey: 'test:8', targets })).rejects.toThrow()
  expect(f.world.publicationStatuses).not.toHaveBeenCalled()
})
it('rechecks the World principal and grants a management entry only to its current person owner', async () => {
  const f = fixture()
  f.world.publicationPrincipal.mockResolvedValue({ uid: 'other', owner: 9, team: 0, viewer: 8 })
  await expect(
    f.service.execute({ action: 'management', accountKey: 'test:8', recordRef: 'public-ref' }),
  ).resolves.toEqual({ publications: [] })
  expect(f.teams.publicationLink).not.toHaveBeenCalled()
  f.world.publicationPrincipal.mockResolvedValue({
    uid: 'team-world-' + 'a'.repeat(64),
    owner: 0,
    team: '9223372036854775800',
    viewer: 8,
  } as never)
  const out = (await f.service.execute({ action: 'management', accountKey: 'test:8', recordRef: 'public-ref' })) as {
    publications: WorldPublication[]
  }
  expect(out.publications[0]).toMatchObject({ kind: 'team', canUnpublish: true })
  expect(f.teams.publicationLink).toHaveBeenCalledWith('9223372036854775800', 'team-world-' + 'a'.repeat(64), undefined)
})
it('does not turn unavailable linkage into a private result and rejects tampered capabilities', async () => {
  const f = fixture()
  f.teams.sourcePublicationLinks.mockRejectedValue(new Error('offline'))
  await expect(f.service.execute({ action: 'sources', accountKey: 'test:8', targets })).rejects.toThrow('offline')
  await expect(
    f.service.execute({
      action: 'unpublish',
      accountKey: 'test:8',
      publicationRef: 'forged',
      requestUid: 'fixed-request-1234',
    }),
  ).rejects.toThrow()
  expect(f.world.unpublishExisting).not.toHaveBeenCalled()
})

it('accepts public-only team links without manufacturing private management capabilities', async () => {
 const f=fixture();f.teams.sourcePublicationLinks.mockResolvedValue([{source_uid:'original-uid',team_id:'9223372036854775800',team_name:'团队',publication_uid:'team-world-'+ 'a'.repeat(64),public_requested:true,can_manage:false}] as never)
 const out=await f.service.execute({action:'sources',accountKey:'test:8',targets}) as {items:{publications:WorldPublication[]}[]}
 const team=out.items[0]!.publications.find(v=>v.kind==='team')!
 expect(team).toMatchObject({requested:true,canUnpublish:false})
 await expect(f.service.execute({action:'unpublish',accountKey:'test:8',publicationRef:team.ref,requestUid:'fixed-request-1234'})).rejects.toThrow()
 expect(f.teams.unpublishLink).not.toHaveBeenCalled()
})
it('resolves a private suggestion through its versioned owner before reusing original publication', async () => {
  const f = fixture()
  const resolve = vi.fn(async () => f.source)
  const service = new WorldPublicationService({ config: { environment: 'test' }, requireSession: async () => ({ userId: 8 }), stateStore: { uniqueCode: async () => 'key' } } as never, f.record as never, f.chat as never, f.world as never, f.teams as never, resolve)
  const origin = { kind: 'suggestion' as const, sourceRef: 'opaque-suggestion', itemUid: 'candidate-key' }
  await service.execute({ action: 'publish-source', accountKey: 'test:8', origin, version: 7 })
  expect(resolve).toHaveBeenCalledWith(origin, 'test:8', undefined)
  expect(f.record.worldPublishSource).not.toHaveBeenCalled()
  expect(f.world.publishExistingSource).toHaveBeenCalledWith(f.source, 8, undefined)
  await expect(service.execute({ action: 'publish-source', accountKey: 'test:8', origin, version: 6 })).rejects.toMatchObject({ code: 'world-source-changed' })
  expect(f.world.publishExistingSource).toHaveBeenCalledOnce()
})
