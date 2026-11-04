import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, realpath, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import LocalSessionAttachments from '../src/local-session-attachments.js'
import { expect, it } from 'vitest'
import * as localHistory from '../src/local-session-persistence.js'
import { localHistoryAccountRef } from '../src/local-session-discovery.js'
import { DshRemoteSessionOwnershipStore } from '../src/dsh-remote/session-ownership-store.js'

it.each(['inventory', 'ownership'])('reads through %s without a writer, then continues at the same physical store after release', async evidence => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'arkme old native history ')))
  const oldHome = join(home, 'old app', 'Arkme Harness', 'dsh-containers', 'scope_abc', 'dsh')
  const currentHome = join(home, 'current app', 'dsh'), source = new Context(), current = new Context()
  const id = SessionId('old-conversation'), identity = { accountId: '42', environment: 'prod' as const, runtimeRef: 'old-runtime', sessionRef: id, ...(evidence === 'ownership' ? { sourceProfileRef: 'web:scope_abc' } : {}) }
  try {
    await mkdir(oldHome, { recursive: true }); await mkdir(currentHome, { recursive: true })
    await writeFile(join(home, 'old app', 'Arkme Harness', 'dsh-account-scopes.json'), JSON.stringify({ version: 1, activeContainerRef: 'scope_abc', accounts: { [localHistoryAccountRef('42')]: 'scope_abc' }, containers: { scope_abc: { createdAtMillis: 1, updatedAtMillis: 1, owner: { kind: 'account', accountRef: localHistoryAccountRef('42') } } } }))
    const state = join(oldHome, 'arkme-self', 'prod', 'dsh-remote'); await mkdir(state, { recursive: true })
    await writeFile(join(state, 'runtime-state.json'), JSON.stringify({ schemaVersion: 2, accounts: { '42': { runtimes: { web: { runtimeRef: identity.runtimeRef } }, projections: { web: { sessions: [{ sessionRef: id }] } } } } }))
    if (evidence === 'ownership') {
      await writeFile(join(state, 'runtime-state.json'), JSON.stringify({ schemaVersion: 2, accounts: { '42': { runtimes: { 'web:scope_abc': { runtimeRef: 'rotated' } }, projections: {} } } }))
      await new DshRemoteSessionOwnershipStore(join(oldHome, 'arkme-self/prod'), 'web:scope_abc').claimUnownedAndListOwned({ accountId: '42', sessionRefs: [id], origin: 'existing-at-login' })
    }
    await source.plugin(jsonl, { root: join(oldHome, 'sessions') })
    const writer = await source.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, cwd: home, createdAt: 1, isSeeded: false })
    await writer.append([{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }])
    await writer.flush()
    await current.plugin(localHistory, { dshHome: currentHome, userHome: home, indexRoot: join(home, '.arkme', 'instances'), dataRoots: [], searchRoots: [home] })
    const history = current.arkmeLocalHistory
    expect(await history.discover(identity, new AbortController().signal)).toBe(true)
    await expect(history.discover({ ...identity, accountId: '43' }, new AbortController().signal)).rejects.toThrow('冲突')
    await expect(history.discover(identity, AbortSignal.abort(new Error('left')))).rejects.toThrow('left')
    const reader = await current.sessionPersistence.open(id, 'read')
    expect((await reader.read()).events).toHaveLength(1)
    await reader.close()
    await expect(current.sessionPersistence.open(id, 'write')).rejects.toThrow()
    await writer.close()
    const resumed = await current.sessionPersistence.open(id, 'write')
    await resumed.append([{ type: 'sandbox/mode', seq: 1, time: 2, data: { mode: 'workspace-write' } }])
    await resumed.flush(); await resumed.close()
    await current.plugin(SessionStore)
    const liveWriter = await current.sessionPersistence.open(id, 'write')
    const seed = await liveWriter.read()
    const live = current.sessions.prepare(id, { seed: [...seed.events], meta: liveWriter.header, inheritedEventCount: liveWriter.inheritedEventCount, eventState: seed.eventState })
    await liveWriter.append(live.snapshotEvents(seed.events.length))
    const detach = current.sessions.enter(live); current.sessions.announce(live)
    live.append('sandbox/mode', { mode: 'read-only' })
    expect(await current.sessions.flush(live)).toBe(true)
    expect((await liveWriter.read()).events.at(-1)).toMatchObject({ type: 'sandbox/mode', data: { mode: 'read-only' } })
    detach(); await liveWriter.close()
    const original = await source.sessionPersistence.open(id, 'read')
    expect((await original.read()).events.map(event => event.seq)).toEqual([0, 1, 2, 3])
    await original.close()
    expect((await current.sessionPersistence.list()).map(row => row.header.id)).toEqual([id])
    const created = await current.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: SessionId('new-conversation'), cwd: home, createdAt: 3, isSeeded: false })
    await created.flush(); await created.close()
    expect(await source.sessionPersistence.stat(SessionId('new-conversation'))).toBeUndefined()
  } finally {
    await current.fiber.dispose(); await source.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

it('opens a previously migrated shared journal only with an existing account-scoped alias', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'arkme shared history ')))
  const sharedRoot = join(home, 'shared'), currentHome = join(home, 'current'), old = new Context(), current = new Context()
  const id = SessionId('migrated'), identity = { accountId: '42', environment: 'test' as const, runtimeRef: 'origin', sessionRef: id }
  try {
    await mkdir(currentHome, { recursive: true })
    await old.plugin(jsonl, { root: join(sharedRoot, 'sessions') })
    const writer = await old.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, cwd: home, createdAt: 1, isSeeded: false })
    await writer.append([{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }]); await writer.flush(); await writer.close()
    await current.plugin(localHistory, { dshHome: currentHome, sharedRoot, userHome: home, indexRoot: join(home, 'index'), dataRoots: [], searchRoots: [] })
    expect(await current.arkmeLocalHistory.discover(identity, new AbortController().signal)).toBe(false)
    expect(await current.arkmeLocalHistory.discover(identity, new AbortController().signal, true)).toBe(true)
    const read = await current.sessionPersistence.open(id, 'read')
    expect((await read.read()).events).toHaveLength(1); await read.close()
  } finally { await current.fiber.dispose(); await old.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
})


it('validates native attachment bytes before takeover and keeps history readable on failure', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'arkme-resource-handoff-')))
  const sharedRoot = join(home, 'old'), currentHome = join(home, 'current'), old = new Context(), current = new Context()
  const id = SessionId('with-file'), signal = new AbortController().signal
  try {
    await mkdir(currentHome, { recursive: true })
    const attachments = new LocalAttachmentStore(old, { dshHome: sharedRoot })
    const file = await attachments.saveFile({ data: Buffer.from('complete source'), name: 'source.txt' })
    await old.plugin(jsonl, { root: join(sharedRoot, 'sessions') })
    const writer = await old.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, cwd: home, createdAt: 1, isSeeded: false })
    await writer.append([{ type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { id: 'message', role: 'user', source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] } }] as never)
    await writer.flush(); await writer.close()
    await current.plugin(localHistory, { dshHome: currentHome, sharedRoot, userHome: home, indexRoot: join(home, 'index'), dataRoots: [], searchRoots: [] })
    await current.arkmeLocalHistory.discover({ accountId: '42', environment: 'test', runtimeRef: 'original', sessionRef: id }, signal, true)
    await current.plugin(LocalSessionAttachments, { dshHome: join(home, 'new-shared') })
    const continued = await current.sessionPersistence.open(id, 'write'); await continued.close()
    await chmod(attachments.fileHostPath(file), 0o600); await writeFile(attachments.fileHostPath(file), 'corrupt')
    await expect(current.sessionPersistence.open(id, 'write')).rejects.toThrow()
    const reader = await current.sessionPersistence.open(id, 'read')
    expect((await reader.read()).events).toHaveLength(1); await reader.close()
  } finally { await current.fiber.dispose(); await old.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
})
