import { describe, expect, it, vi } from 'vitest'
import { ArchiveService } from '../../src/services/archive-service.js'
import { SourceService } from '../../src/services/source-service.js'
import type { ProfileService } from '../../src/services/profile-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const normal = { entity_type: 1, entity_uid: 'child', owner_available: true, self_status: 1, effective_status: 1, revision: 0, display_archive_at: 0 }
const inherited = { ...normal, effective_status: 2, display_archive_at: 100, inherited_from: { entity_type: 1, entity_uid: 'parent' } }

async function fixture() {
  let session = { userId: 42, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
  const post = vi.fn()
  const invalidate = vi.fn()
  const runtime = {
    requireSession: async () => session, accountScopedSession: async () => session,
    stateStore: { uniqueCode: async () => 'archive-fixture-signing-key' },
    runOwnerRead: async (_route: string, _params: unknown, read: (signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal) => read(signal ?? new AbortController().signal),
    withOwnerReadInvalidation: async (_route: string, write: () => Promise<unknown>) => { try { return await write() } finally { invalidate() } },
    authenticatedPost: post,
  } as unknown as ServiceRuntime
  const sources = new SourceService(runtime, {} as ProfileService, {} as never)
  const directory = vi.spyOn(sources, 'invalidateSourceListCache').mockImplementation(() => {})
  const service = new ArchiveService(runtime, sources)
  const ref = await sources.sealSourceRef(42, 'topic', 'child', 'Child')
  return { service, sources, post, invalidate, directory, ref, switchAccount: () => { session = { ...session, userId: 99 } } }
}

describe('Archive Host owner', () => {
  it('preserves independent and inherited states, opaque identity and page cursor', async () => {
    const f = await fixture()
    f.post.mockResolvedValue({ items: [{ ...inherited, title: 'secret title', privacy_locked: true }], has_more: true, next_cursor: 'next' })
    const page = await f.service.list()
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'next', items: [{ selfArchived: false, effectiveArchived: true, privacyLocked: true, source: { displayName: '隐私主题' } }] })
    expect(JSON.stringify(page)).not.toContain('secret title')
    expect(JSON.stringify(page)).not.toContain('entity_uid')
    const item = page.items[0]!
    expect(await f.sources.openSourceRef(item.inheritedFrom!.sourceRef, 42)).toMatchObject({ ownerRef: 'parent' })
    await expect(f.sources.openSourceRef(item.sourceRef, 99)).rejects.toThrow()
    f.post.mockResolvedValue({ items: [inherited] })
    expect(await f.service.states([f.ref])).toMatchObject([{ sourceRef: f.ref, selfArchived: false, effectiveArchived: true, revision: 0 }])
  })

  it('forwards CAS once and keeps effective archive when an ancestor still applies', async () => {
    const f = await fixture()
    f.post.mockResolvedValue({ ...inherited, revision: 4, state_changed: true, effective_changed_count: 0 })
    const result = await f.service.set({ sourceRef: f.ref, selfArchived: false, expectedRevision: 3 })
    expect(result).toMatchObject({ selfArchived: false, effectiveArchived: true, revision: 4, stateChanged: true, effectiveChangedCount: 0 })
    expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/v1/archives/set', { entity_type: 1, entity_uid: 'child', self_status: 1, expected_revision: 3 }, expect.anything(), undefined, { trackWriteOutcome: true })
    expect(f.directory).toHaveBeenCalledWith(42, 'send_to_self')
    expect(f.invalidate).toHaveBeenCalledOnce()
  })

  it.each(['ARCHIVE_REVISION_CONFLICT', 'write-outcome-unknown'])('does not retry %s and invalidates stale directory flights', async code => {
    const f = await fixture()
    f.post.mockRejectedValue(new Error(code))
    await expect(f.service.set({ sourceRef: f.ref, selfArchived: true, expectedRevision: 0 })).rejects.toThrow(code)
    expect(f.post).toHaveBeenCalledOnce()
    expect(f.directory).toHaveBeenCalledOnce()
  })

  it('rejects foreign references, duplicate identities, cancellation and late account results', async () => {
    const f = await fixture()
    const foreign = await f.sources.sealSourceRef(99, 'topic', 'child', 'foreign')
    await expect(f.service.states([foreign])).rejects.toThrow()
    await expect(f.service.states([f.ref, f.ref])).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(f.service.set({ sourceRef: f.ref, selfArchived: true, expectedRevision: 0 }, abort.signal)).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementation(async () => { f.switchAccount(); return { items: [normal] } })
    await expect(f.service.states([f.ref])).rejects.toThrow('账号已变化')
  })

  it.each([{ self_status: '2' }, { effective_status: 3 }, { revision: -1 }, { entity_type: 5 }, { entity_uid: 'other' }])('fails closed on malformed owner state %o', async patch => {
    const f = await fixture()
    f.post.mockResolvedValue({ items: [{ ...normal, ...patch }] })
    await expect(f.service.states([f.ref])).rejects.toThrow()
  })
})
