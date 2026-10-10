import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArkmeStateStore } from '../src/state-store.js'
import { parseArrangementBoardCachePages } from '../src/arrangement-board-cache.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArrangementService } from '../src/services/arrangement-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeArrangementPage, ArkmeArrangementStatus } from '../src/types.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function directory() { const path = await mkdtemp(join(tmpdir(), 'arrangement-board-cache-')); directories.push(path); return path }
function page(status: ArkmeArrangementStatus = 'identified', count = 1): ArkmeArrangementPage {
  return { items: Array.from({ length: count }, (_, i) => ({
    arrangementRef: `arkme-arrangement-v1.${String(i).padStart(43, 'a')}`, title: '安排', description: '摘要', status,
    reminderEnabled: false, reminderState: '', createdAtMillis: 0, updatedAtMillis: 0,
    creationSource: { kind: 'quick-note' as const, items: [{ text: '可离线展开的原文', createdAtMillis: 10 }], unavailableCount: 1 },
  })), total: 73, hasMore: true, nextOffset: count, board: { supported: true, version: 'v1' } }
}

describe('persistent arrangement board cache', () => {
  it('survives restart, preserves first-page totals/sources and merges columns', async () => {
    const path = await directory()
    const store = new ArkmeStateStore(path)
    await store.arrangementBoardCache('test', 42, { identified: page('identified', 50) })
    await Promise.all([
      store.arrangementBoardCache('test', 42, { following: page('following') }),
      store.arrangementBoardCache('test', 42, { completed: page('completed') }),
    ])
    expect(await new ArkmeStateStore(path).arrangementBoardCache('test', 42)).toEqual({ identified: page('identified', 50), following: page('following'), completed: page('completed') })
    const files = await readdir(path)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^arrangement-board-[a-f0-9]{64}\.json$/)
    if (process.platform !== 'win32') {
      expect((await stat(join(path, files[0]!))).mode & 0o777).toBe(0o600)
      expect((await stat(path)).mode & 0o777).toBe(0o700)
    }
  })
  it('isolates accounts/environments and never accepts path-shaped scopes', async () => {
    const path = await directory(); const store = new ArkmeStateStore(path)
    await store.arrangementBoardCache('test', 42, { identified: page() })
    expect(await store.arrangementBoardCache('test', 43)).toEqual({})
    expect(await store.arrangementBoardCache('prod', 42)).toEqual({})
    expect(await store.arrangementBoardCache('../escape', 42, { identified: page() })).toEqual({})
    expect(await store.arrangementBoardCache('test', -1, { identified: page() })).toEqual({})
    expect(await readdir(path)).toHaveLength(1)
  })
  it('rejects >50 entries without destroying existing data', async () => {
    const path = await directory(); const store = new ArkmeStateStore(path)
    await store.arrangementBoardCache('test', 42, { identified: page() })
    await expect(store.arrangementBoardCache('test', 42, { identified: page('identified', 51) })).rejects.toThrow()
    expect(await store.arrangementBoardCache('test', 42)).toEqual({ identified: page() })
  })
  it('tolerates corrupt and unknown-version files without touching recovery state', async () => {
    const path = await directory(); const store = new ArkmeStateStore(path)
    await store.arrangementBoardCache('test', 42, { identified: page() })
    const file = join(path, (await readdir(path))[0]!)
    await writeFile(join(path, 'state.json'), 'recovery evidence')
    for (const contents of ['broken JSON', JSON.stringify({ schemaVersion: 2, pages: { identified: page() } }), JSON.stringify({ schemaVersion: 1, environment: 'test', userId: 43, pages: { identified: page() } })]) {
      await writeFile(file, contents)
      expect(await new ArkmeStateStore(path).arrangementBoardCache('test', 42)).toEqual({})
    }
    expect(await readFile(join(path, 'state.json'), 'utf8')).toBe('recovery evidence')
  })
  it('falls back on failed atomic rename and removes temporary files', async () => {
    const path = await directory(); const store = new ArkmeStateStore(path)
    await store.arrangementBoardCache('test', 42, { identified: page() })
    const file = join(path, (await readdir(path))[0]!)
    await rm(file); await mkdir(file)
    await expect(store.arrangementBoardCache('test', 42, { following: page('following') })).resolves.toEqual({})
    expect(await readdir(path)).toHaveLength(1)
    const blocked = join(path, 'not-a-directory'); await writeFile(blocked, 'keep')
    await expect(new ArkmeStateStore(blocked).arrangementBoardCache('test', 42, { identified: page() })).resolves.toEqual({})
    expect(await readFile(blocked, 'utf8')).toBe('keep')
  })
})

describe('board-cache host validation', () => {
  it('dispatches bounded projections and scope, ignoring supplied owner IDs', async () => {
    const arrangementBoardCache = vi.fn(async () => ({ pages: {} }))
    const service = { arrangementBoardCache } as never
    await dispatchArkmeHostOperation(service, 'arrangements.board-cache', { accountScope: 'test:42' })
    expect(arrangementBoardCache).toHaveBeenLastCalledWith('test:42', undefined)
    await dispatchArkmeHostOperation(service, 'arrangements.board-cache', { accountScope: 'test:42', pages: { identified: page() }, userId: 999 })
    expect(arrangementBoardCache).toHaveBeenLastCalledWith('test:42', { identified: page() })
  })
  it.each([
    null, [], { all: page() }, { identified: page('following') }, { identified: page('identified', 51) },
    { identified: { ...page(), total: -1 } }, { identified: { ...page(), total: Infinity } },
    { identified: { ...page(), nextOffset: 0.5 } }, { identified: { ...page(), hasMore: 'yes' } },
    { identified: { ...page(), board: { supported: 'yes', version: 'v' } } },
    { identified: { ...page(), items: [{ ...page().items[0], arrangementRef: '../file' }] } },
    { identified: { ...page(), items: [{ ...page().items[0], uid: 'private-owner' }] } },
    { identified: { ...page(), items: [{ ...page().items[0], createdAtMillis: NaN }] } },
    { identified: { ...page(), items: [{ ...page().items[0], creationSource: { kind: 'input', items: [{ text: 42 }], unavailableCount: 0 } }] } },
  ])('rejects malformed cache input: %j', async pages => {
    const arrangementBoardCache = vi.fn()
    await expect(dispatchArkmeHostOperation({ arrangementBoardCache } as never, 'arrangements.board-cache', { accountScope: 'test:42', pages })).rejects.toMatchObject({ httpStatus: 400 })
    expect(arrangementBoardCache).not.toHaveBeenCalled()
  })
  it('rejects duplicate refs and unbounded original text', () => {
    const duplicate = page(); duplicate.items.push(duplicate.items[0]!)
    expect(() => parseArrangementBoardCachePages({ identified: duplicate })).toThrow()
    const huge = page(); huge.items[0]!.creationSource!.items[0]!.text = 'x'.repeat(200001)
    expect(() => parseArrangementBoardCachePages({ identified: huge })).toThrow()
  })
})

function serviceFixture() {
  let userId: number | undefined = 42
  const sessions: ArkmeSessionStore = { async read() { return userId ? { userId, accessToken: 'access', refreshToken: 'refresh' } : undefined }, async write() {}, async delete() {} }
  const arrangementBoardCache = vi.fn(async () => ({}))
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { list: [{ uid: 'owner-1', title: '安排', status: 1 }], total: 1 } }), { status: 200 }))
  const config = { environment: 'test', intelligentBaseUrl: 'https://intelligent.test', requestTimeoutMs: 5000 } as ArkmeServiceConfig
  const runtime = new ServiceRuntime(config, sessions, { arrangementBoardCache, async uniqueCode() { return 'secret' } } as unknown as StateStore, fetchImpl)
  return { service: new ArrangementService(runtime), runtime, arrangementBoardCache, fetchImpl, switchUser: (next?: number) => { userId = next } }
}

describe('board cache account admission', () => {
  it('requires a session and rejects stale scope including empty-page writes', async () => {
    const fixture = serviceFixture()
    await fixture.service.arrangementBoardCache('test:42', {})
    expect(fixture.fetchImpl).not.toHaveBeenCalled()
    fixture.switchUser(43)
    await expect(fixture.service.arrangementBoardCache('test:42', { identified: { items: [], total: 0, hasMore: false } })).rejects.toMatchObject({ httpStatus: 403 })
    fixture.switchUser()
    await expect(fixture.service.arrangementBoardCache('test:42')).rejects.toMatchObject({ httpStatus: 401 })
    expect(fixture.arrangementBoardCache).toHaveBeenCalledTimes(1)
  })
  it('accepts only current-account issued refs and writes without remote traffic', async () => {
    const fixture = serviceFixture()
    const current = await fixture.service.listArrangements({ status: 'identified', limit: 50 })
    fixture.fetchImpl.mockClear()
    await fixture.service.arrangementBoardCache('test:42', { identified: current })
    expect(fixture.arrangementBoardCache).toHaveBeenLastCalledWith('test', 42, { identified: current })
    expect(fixture.fetchImpl).not.toHaveBeenCalled()
    fixture.switchUser(43)
    await expect(fixture.service.arrangementBoardCache('test:43', { identified: current })).rejects.toMatchObject({ httpStatus: 403 })
  })
  it('does not return old-account cache after an in-flight account switch', async () => {
    const fixture = serviceFixture()
    fixture.arrangementBoardCache.mockImplementationOnce(async () => { fixture.switchUser(43); return { identified: page() } })
    expect(await fixture.service.arrangementBoardCache('test:42')).toEqual({ pages: {} })
    expect(fixture.arrangementBoardCache).toHaveBeenCalledWith('test', 42, undefined)
  })
})
