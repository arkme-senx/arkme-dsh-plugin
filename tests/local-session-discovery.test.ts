import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionDiscovery, localHistoryAccountRef } from '../src/local-session-discovery.js'

const roots: string[] = []
const identity = { accountId: '42', environment: 'prod' as const, runtimeRef: 'old-runtime', sessionRef: 'old-session' }
const signal = () => new AbortController().signal
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'arkme local discovery '))); roots.push(home)
  const indexRoot = join(home, '.arkme', 'instances')
  const options = { userHome: home, indexRoot, dataRoots: [] as string[], searchRoots: [home] }
  const instance = async (name: string, accountId = '42', environment = 'prod') => {
    const root = join(home, name, 'Arkme Harness'), dshHome = join(root, 'dsh-containers', 'scope_abc', 'dsh')
    const state = join(dshHome, 'arkme-self', environment, 'dsh-remote')
    await mkdir(state, { recursive: true })
    await writeFile(join(root, 'dsh-account-scopes.json'), JSON.stringify({ version: 1, activeContainerRef: 'scope_abc', accounts: { [localHistoryAccountRef(accountId)]: 'scope_abc' }, containers: { scope_abc: { createdAtMillis: 1, updatedAtMillis: 1, owner: { kind: 'account', accountRef: localHistoryAccountRef(accountId) } } } }))
    await writeFile(join(state, 'runtime-state.json'), JSON.stringify({ schemaVersion: 2, accounts: { [accountId]: {
      runtimes: { web: { runtimeRef: identity.runtimeRef } }, projections: { web: { sessions: [{ sessionRef: identity.sessionRef }] } },
    } } }))
    return { root, dshHome }
  }
  return { home, options, instance }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('same-user legacy source discovery', () => {
  it('finds a custom application root by its real registry and remembers the location', async () => {
    const { options, instance } = await fixture(), old = await instance('developer experiments/old client')
    const discovery = new LocalSessionDiscovery(options)
    expect(await discovery.find(identity, signal())).toEqual([{ runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef, dshHome: old.dshHome }])
    const warm = new LocalSessionDiscovery({ ...options, searchRoots: [] })
    expect(await warm.find(identity, signal())).toEqual([{ dshHome: old.dshHome, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef }])
    discovery.close(); warm.close()
  })
  it('checks registry account, environment, runtime and session instead of computer name', async () => {
    const { options, instance } = await fixture()
    await instance('another account', '99'); await instance('test account', '42', 'test')
    const discovery = new LocalSessionDiscovery(options)
    expect(await discovery.find(identity, signal())).toEqual([])
    await expect(discovery.find({ ...identity, sessionRef: '../escape' }, signal())).rejects.toThrow('身份')
  })
  it('rejects an owner-only registry copy even when its runtime inventory matches', async () => {
    const { options, instance } = await fixture(), old = await instance('copied fixture')
    await writeFile(join(old.root, 'dsh-account-scopes.json'), JSON.stringify({ version: 1, containers: { scope_abc: { owner: { kind: 'account', accountRef: localHistoryAccountRef('42') } } } }))
    expect(await new LocalSessionDiscovery(options).find(identity, signal())).toEqual([])
  })
  it('returns distinct physical sources as an ambiguity; it never chooses a copy to execute', async () => {
    const { options, instance } = await fixture()
    await instance('first'); await instance('second')
    expect(await new LocalSessionDiscovery(options).find(identity, signal())).toHaveLength(2)
  })
  it('does not traverse symlinks, dependency directories or known backup trees', async () => {
    const { home, options, instance } = await fixture()
    const old = await instance('node_modules/fixture')
    await instance('codex-backups/snapshot')
    await symlink(old.root, join(home, 'shortcut'))
    expect(await new LocalSessionDiscovery(options).find(identity, signal())).toEqual([])
  })
  it('finds registered launcher artifacts inside a checkout without traversing its source tree', async () => {
    const { home, options, instance } = await fixture()
    const old = await instance('worktrees/client/artifacts/prod-mac/app-data')
    await mkdir(join(home, 'worktrees/client/.git'))
    await instance('worktrees/client/src/fixture')
    const discovery = new LocalSessionDiscovery(options)
    expect(await discovery.find(identity, signal())).toEqual([{ dshHome: old.dshHome, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef }])
    expect(discovery.inventoryState).toBe('complete')
    discovery.close()
  })
  it('prioritizes application data and counts inspected directories instead of exhausting the budget on the frontier', async () => {
    const { home, options, instance } = await fixture()
    const old = await instance('artifacts/old/app-data')
    for (let i = 0; i < 60; i++) await mkdir(join(home, `ordinary-${i}`, 'nested'), { recursive: true })
    const discovery = new LocalSessionDiscovery({ ...options, limits: { directories: 50 } })
    expect(await discovery.find(identity, signal())).toEqual([{ dshHome: old.dshHome, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef }])
    expect(discovery.inventoryState).toBe('limited')
    discovery.close()
  })
  it('shares account-scoped inventory across missing sessions but revalidates ownership on every hit', async () => {
    const { options, instance } = await fixture(), old = await instance('old')
    const discovery = new LocalSessionDiscovery({ ...options, dataRoots: [old.root], searchRoots: [] })
    const reads = vi.spyOn(discovery as any, 'json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => discovery.find({ ...identity, sessionRef: `missing-${i}` }, signal())))
    expect(reads.mock.calls.filter(([path]) => String(path).endsWith('runtime-state.json'))).toHaveLength(1)
    expect(await discovery.find(identity, signal())).toHaveLength(1)
    const path = join(old.root, 'dsh-account-scopes.json'), registry = JSON.parse(await readFile(path, 'utf8'))
    registry.containers.scope_abc.owner.accountRef = localHistoryAccountRef('99')
    registry.accounts = { [localHistoryAccountRef('99')]: 'scope_abc' }
    await writeFile(path, JSON.stringify(registry))
    expect(await discovery.find(identity, signal())).toEqual([])
    expect(await discovery.find({ ...identity, environment: 'test' }, signal())).toEqual([])
    discovery.close()
  })
  it('refreshes bounded location hints when the original runtime registers another session', async () => {
    const { options, instance } = await fixture(), old = await instance('old')
    const discovery = new LocalSessionDiscovery({ ...options, dataRoots: [old.root], searchRoots: [] })
    const next = { ...identity, sessionRef: 'new-session' }
    expect(await discovery.find(next, signal())).toEqual([])
    const path = join(old.dshHome, 'arkme-self/prod/dsh-remote/runtime-state.json')
    const state = JSON.parse(await readFile(path, 'utf8')); state.accounts['42'].projections.web.sessions.push({ sessionRef: next.sessionRef })
    await writeFile(path, JSON.stringify(state))
    expect(await discovery.find(next, signal())).toEqual([])
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001)
    try { expect(await discovery.find(next, signal())).toHaveLength(1) }
    finally { now.mockRestore(); discovery.close() }
  })
  it('uses standard roots without a home walk and refuses foreign absolute roots', async () => {
    const { options, instance } = await fixture(), old = await instance('Application Support')
    const discovery = new LocalSessionDiscovery({ ...options, dataRoots: [old.root], searchRoots: [] })
    expect(await discovery.find(identity, signal())).toHaveLength(1)
    await expect(discovery.register(tmpdir(), signal())).rejects.toThrow('当前用户')
  })
  it('retains incomplete inventory coverage without blocking cloud fallback or rescanning', async () => {
    const { home, options } = await fixture()
    await mkdir(join(home, 'one', 'two'), { recursive: true })
    const discovery = new LocalSessionDiscovery({ ...options, limits: { directories: 1 } })
    expect(await discovery.find(identity, signal())).toEqual([])
    expect(discovery.inventoryState).toBe('limited')
    await mkdir(join(home, 'later'), { recursive: true })
    expect(await discovery.find(identity, signal())).toEqual([])
    expect(discovery.inventoryState).toBe('limited')
    const canceled = AbortSignal.abort(new Error('left page'))
    await expect(new LocalSessionDiscovery(options).find(identity, canceled)).rejects.toThrow('left page')
  })
  it('registers every discovered location even when the requested session is absent', async () => {
    const { options, instance } = await fixture(), old = await instance('old')
    const discovery = new LocalSessionDiscovery(options)
    expect(await discovery.find({ ...identity, sessionRef: 'missing' }, signal())).toEqual([])
    expect(discovery.inventoryState).toBe('complete')
    const warm = new LocalSessionDiscovery({ ...options, searchRoots: [] })
    expect(await warm.find(identity, signal())).toEqual([{ dshHome: old.dshHome, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef }])
    discovery.close(); warm.close()
  })
  it('ignores malformed and oversized registry contents without reading arbitrary JSON files', async () => {
    const { home, options } = await fixture()
    await writeFile(join(home, 'dsh-account-scopes.json'), '{broken')
    await writeFile(join(home, 'unrelated.json'), 'not read')
    expect(await new LocalSessionDiscovery(options).find(identity, signal())).toEqual([])
    expect(await readFile(join(home, 'unrelated.json'), 'utf8')).toBe('not read')
  })
})

it('finds a server-verified former runtime while retaining the physical provenance and all conflicting copies', async () => {
  const { options, instance } = await fixture(), original = await instance('original')
  const discovery = new LocalSessionDiscovery(options)
  const canonical = { ...identity, runtimeRef: 'canonical' }
  expect(await discovery.find(canonical, signal())).toEqual([])
  expect(await discovery.find({ ...canonical, previousRuntimeRefs: [identity.runtimeRef] }, signal()))
    .toEqual([{ dshHome: original.dshHome, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef }])
  expect(await discovery.find({ ...canonical, previousRuntimeRefs: ['unrelated'] }, signal())).toEqual([])
  const duplicate = await instance('duplicate'); await discovery.register(duplicate.dshHome, signal())
  expect(await discovery.find({ ...canonical, previousRuntimeRefs: [identity.runtimeRef] }, signal())).toHaveLength(2)
  discovery.close()
})
