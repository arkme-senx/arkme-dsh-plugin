import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalHistoryCloudRepair } from '../src/local-history-cloud-repair.js'
import * as localHistory from '../src/local-session-persistence.js'
import { localHistoryAccountRef } from '../src/local-session-discovery.js'

it.skipIf(!process.env.DSH_HISTORY_REPAIR_ACCEPTANCE_FILE)('repairs through real HTTP and Mongo from an official read-only journal while its original writer remains locked', async () => {
  const fixture = JSON.parse(await readFile(process.env.DSH_HISTORY_REPAIR_ACCEPTANCE_FILE!, 'utf8'))
  if (new URL(fixture.url).hostname !== '127.0.0.1') throw new Error('local fixture only')
  const home = await realpath(await mkdtemp(join(tmpdir(), 'arkme-repair-http-'))), old = new Context(), current = new Context()
  const oldHome = join(home, 'old', 'Arkme Harness', 'dsh-containers', 'scope_old', 'dsh'), currentHome = join(home, 'current')
  const id = SessionId(fixture.sessionRef), identity = { accountId: '42', environment: 'test' as const, runtimeRef: fixture.runtimeRef, sessionRef: id }
  let repair: LocalHistoryCloudRepair | undefined
  try {
    await mkdir(oldHome, { recursive: true }); await mkdir(currentHome, { recursive: true })
    const accountRef = localHistoryAccountRef('42')
    await writeFile(join(home, 'old', 'Arkme Harness', 'dsh-account-scopes.json'), JSON.stringify({
      version: 1, activeContainerRef: 'scope_old', accounts: { [accountRef]: 'scope_old' },
      containers: { scope_old: { createdAtMillis: 1, updatedAtMillis: 1, owner: { kind: 'account', accountRef } } },
    }))
    const state = join(oldHome, 'arkme-self', 'test', 'dsh-remote'); await mkdir(state, { recursive: true })
    await writeFile(join(state, 'runtime-state.json'), JSON.stringify({ schemaVersion: 2, accounts: { '42': { runtimes: { web: { runtimeRef: fixture.runtimeRef } }, projections: { web: { sessions: [{ sessionRef: id }] } } } } }))
    await old.plugin(jsonl, { root: join(oldHome, 'sessions') })
    const writer = await old.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, cwd: home, createdAt: 1, isSeeded: false })
    const events = Array.from({ length: 203 }, (_, seq) => ({ type: 'user/message' as const, seq, time: seq + 1, surfaceOp: 'append' as const, data: { id: `message-${seq}`, role: 'user' as const, source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: `recovered ${seq}` }] } }))
    await writer.append(events as never); await writer.flush()
    await current.plugin(localHistory, { dshHome: currentHome, userHome: home, indexRoot: join(home, 'index'), dataRoots: [], searchRoots: [home] })
    const history = current.arkmeLocalHistory
    const post = async (path: string, body: Record<string, unknown>, signal: AbortSignal) => {
      const response = await fetch(`${fixture.url}${path}`, { method: 'POST', signal, headers: { Authorization: 'Bearer device-b', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as any
      if (result.code !== 200) throw Object.assign(new Error(result.message ?? 'fixture failed'), { code: result.data?.error_code })
      return result.data
    }
    const report = vi.fn()
    repair = new LocalHistoryCloudRepair({ root: join(currentHome, 'queue'), scope: 'test:42', persistence: history,
      host: () => ({ ref: fixture.importerRuntimeRef, generation: fixture.importerHostGeneration }), authorize: async () => {},
      discover: (runtime, session, signal) => history.discover({ ...identity, runtimeRef: runtime, sessionRef: session }, signal), post, report })
    await repair.enqueue(fixture.runtimeRef, id)
    await vi.waitFor(() => expect(repair!.status(fixture.runtimeRef, id)?.state, String(report.mock.calls.map(args => args[0]))).toBe('complete'), { timeout: 15000 })
    expect(report).not.toHaveBeenCalled()
    const readback: any[] = []; let before: number | undefined
    do {
      const page = await post('/api/v1/dsh-remote/session-events/list', { runtime_ref: fixture.runtimeRef, session_ref: id, limit: 100, ...(before === undefined ? {} : { before_seq: before }) }, new AbortController().signal)
      readback.unshift(...page.entries)
      before = page.next_cursor
    } while (before !== undefined)
    expect(readback.map(row => row.entry?.event ?? row.event)).toEqual(events)
    const contexts = await post('/api/v1/dsh-remote/messages/selection-context', { targets: [{ runtime_ref: fixture.runtimeRef, session_ref: id, event_seq: 0, role: 'user' }, { runtime_ref: fixture.runtimeRef, session_ref: id, event_seq: 202, role: 'user' }] }, new AbortController().signal)
    expect(contexts.items.map((row: any) => row.canonical_text)).toEqual(['recovered 0', 'recovered 202'])
    expect((await writer.read()).events).toEqual(events)
    await expect(current.sessionPersistence.open(id, 'write')).rejects.toThrow()
    await writer.close()
  } finally { await repair?.close(); await current.fiber.dispose(); await old.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
}, 25000)
