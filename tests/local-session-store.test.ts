import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { localHistoryProfilePatch, localSessionProfilePatch, prepareLocalSessionStore } from '../src/local-session-store.js'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'

it('moves complete native directories with cloud aliases and leaves conflicting histories untouched', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'arkme-store-'))
  const home = join(temp, 'profile'), root = join(temp, 'shared')
  const accountRef = createHash('sha256').update('arkme-dsh-account-scope-v1\n42').digest('hex')
  const input = { dshHome: home, root, accountRef, environment: 'test' as const, dshVersion: '0.2.1-rc.2' }
  try {
    await mkdir(join(home, 'sessions', 'project', 's1'), { recursive: true })
    await writeFile(join(home, 'sessions', 'project', 's1', 'events.jsonl'), 'original bytes')
    await mkdir(join(home, 'attachments', 'v1'), { recursive: true })
    await writeFile(join(home, 'attachments', 'v1', 'blob'), 'attachment')
    await mkdir(join(home, 'arkme-self', 'test', 'dsh-remote'), { recursive: true })
    await writeFile(join(home, 'arkme-self', 'test', 'dsh-remote', 'runtime-state.json'), JSON.stringify({
      schemaVersion: 2, accounts: { '42': { runtimes: { web: { runtimeRef: 'origin' } }, projections: { web: { sessions: [{ sessionRef: 's1' }] } } } },
    }))
    await prepareLocalSessionStore(input)
    await expect(access(join(home, 'sessions', 'project', 's1'))).rejects.toThrow()
    expect(await readFile(join(root, 'sessions', 'project', 's1', 'events.jsonl'), 'utf8')).toBe('original bytes')
    const store = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
    try { expect(store.address('s1')).toBe('origin') } finally { store.close() }
    await prepareLocalSessionStore(input)
    await mkdir(join(home, 'sessions', 'project', 's1'), { recursive: true })
    await writeFile(join(home, 'sessions', 'project', 's1', 'events.jsonl'), 'conflicting bytes')
    await expect(prepareLocalSessionStore(input)).rejects.toThrow('未覆盖')
    expect(await readFile(join(home, 'sessions', 'project', 's1', 'events.jsonl'), 'utf8')).toBe('conflicting bytes')
  } finally { await rm(temp, { recursive: true, force: true }) }
})

it('does not reinterpret the successor projection inventory as migration aliases on restart', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'arkme-store-restart-'))
  const home = join(temp, 'profile'), root = join(temp, 'shared')
  const accountRef = createHash('sha256').update('arkme-dsh-account-scope-v1\n42').digest('hex')
  const store = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  try {
    store.bindAddress('s1', 'original-runtime')
    await mkdir(join(home, 'arkme-self', 'test', 'dsh-remote'), { recursive: true })
    await writeFile(join(home, 'arkme-self', 'test', 'dsh-remote', 'runtime-state.json'), JSON.stringify({ schemaVersion: 2,
      accounts: { '42': { runtimes: { web: { runtimeRef: 'successor-runtime' } }, projections: { web: { sessions: [{ sessionRef: 's1' }] } } } },
    }))
    await prepareLocalSessionStore({ dshHome: home, root, accountRef, environment: 'test', dshVersion: '0.2.1-rc.2' })
    expect(store.address('s1')).toBe('original-runtime')
  } finally { store.close(); await rm(temp, { recursive: true, force: true }) }
})

it('owns profile composition and rejects unsupported scopes before migration', async () => {
  const input = {root: join(tmpdir(), 'shared sessions'), accountRef: 'a'.repeat(64), environment: 'test' as const, dshVersion: '0.2.1-rc.2', pluginDir: join(tmpdir(), 'plugin files'), basePatch: '- id: arkme-self\n  config:\n    environment: test\n'}
  const patch = localSessionProfilePatch(input)
  expect(patch).toContain('local-session/index.js')
  expect(patch).toContain('local-session/gateway-browser/index.js')
  expect(patch).toContain(JSON.stringify(join(input.root, 'sessions')))
  expect(patch).not.toMatch(/credentials|stateDirectory/)
  expect(() => localSessionProfilePatch({...input, environment: 'prod'})).toThrow('测试环境')
  expect(() => localSessionProfilePatch({...input, dshVersion: '0.1.5'})).toThrow('0.2.1-rc.2')
  await expect(prepareLocalSessionStore({...input, environment: 'prod', dshHome: join(input.root, 'unused')})).rejects.toThrow('测试环境')
})

it('preserves production and user patches and composes history idempotently without redirecting logs', () => {
  const root = join(tmpdir(), 'history profile'), dshHome = join(root, 'dsh')
  const input = { root: join(root, 'coordination'), accountRef: 'a'.repeat(64), environment: 'prod' as const,
    dshVersion: '0.2.1-rc.2', pluginDir: join(root, 'plugin'), history: { dshHome, userHome: root,
      indexRoot: join(root, '.arkme'), dataRoots: [], searchRoots: [] },
    basePatch: '- id: arkme-self\n  config:\n    environment: prod\n- insert:\n  - id: user-extension\n    name: user-plugin\n  - id: arkme-local-history\n    name: stale\n' }
  const patch = localHistoryProfilePatch(input)
  expect(patch).toContain('environment: prod')
  expect(patch).toContain('user-extension')
  expect(patch).not.toContain('stale')
  expect(patch).toContain('arkme-local-attachments')
  expect(localHistoryProfilePatch({ ...input, basePatch: patch })).toBe(patch)
  expect(() => localHistoryProfilePatch({ ...input, basePatch: '- id: session-persistence-jsonl\n  config:\n    root: /custom-store\n' })).toThrow('自定义')
})
