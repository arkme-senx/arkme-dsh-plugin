import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TeamEntryPreferenceService, teamEntryCloudKey } from '../src/services/team-entry-preference-service.js'
import type { StateStore } from '../src/services/service.js'
import { ArkmeUpstreamResponseError } from '../src/services/service.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { teamEntryTools } from '../src/tools/business/contacts/team-entries.js'
const folder = { entry_kind: 'team_folder', team_id: '9223372036854775800' }
const target = { kind: 'folder' as const, ref: 'opaque' }
const row = (extra = {}) => ({ entry: folder, accessible: true, pinned: false, dismissed: false, version: 0, activity_seq: 2, ...extra })
const data = (extra = {}) => ({ schema_version: 1, items: [row(extra)], has_more: false })
function fixture() {
  const disk = new Map<string, unknown>()
  const storage = { teamEntryPreferenceState: vi.fn(async (account: string, value?: unknown) => { if (value !== undefined) disk.set(account, structuredClone(value)); return structuredClone(disk.get(account)) }), localDirectoryPreferences: vi.fn(async () => ({})) } as unknown as StateStore
  const refs = { open: vi.fn(async () => ({ team_id: folder.team_id })), seal: vi.fn(async () => 'opaque') }
  return { disk, storage, refs, service: new TeamEntryPreferenceService(storage, refs) }
}
it('freezes a durable command before HTTP and replays it verbatim after restart/response loss', async () => {
  const f = fixture(), command = { operationId: randomUUID(), changes: [{ target, action: 'dismiss', expectedVersion: 0 }] }
  const sent: unknown[] = []
  let fail = true
  const post = vi.fn(async (_path: string, input?: Record<string, unknown>) => {
    expect(f.disk.get('test:11')).toHaveProperty('pending')
    sent.push(structuredClone(input))
    if (fail) throw new Error('response lost')
    return data({ dismissed: false, version: 1, activity_seq: 3 })
  })
  await expect(f.service.execute('team.app.entries.change', command, 11, 'test', post)).rejects.toThrow('response lost')
  fail = false
  const restarted = new TeamEntryPreferenceService(f.storage, f.refs)
  const result = await restarted.execute('team.app.entries.query', { entries: [target] }, 11, 'test', post)
  expect(sent[0]).toEqual(sent[1])
  expect((sent[1] as any).changes[0].entry.team_id).toBe(folder.team_id)
  expect(result.items[0]?.dismissed).toBe(false)
  expect((f.disk.get('test:11') as any).pending).toEqual({})
  expect((await restarted.execute('team.app.entries.cached', {}, 12, 'test', post)).items).toEqual([])
  expect(result.items[0]?.key).toBe(teamEntryCloudKey(11, 'folder', folder.team_id))
  expect(JSON.stringify(result)).not.toContain(folder.team_id)
})
it('fails before network when durable persistence is unavailable', async () => {
  const f = fixture(), post = vi.fn()
  vi.mocked(f.storage.teamEntryPreferenceState!).mockImplementation(async (_account, value) => { if (value !== undefined) throw new Error('disk full'); return {} })
  await expect(f.service.execute('team.app.entries.change', { operationId: randomUUID(), changes: [{ target, action: 'pin', expectedVersion: 0 }] }, 11, 'test', post)).rejects.toThrow('disk full')
  expect(post).not.toHaveBeenCalled()
})
it('imports only explicit legacy rows, with cloud defaults preferred and unknown folder removal visible', async () => {
  const f = fixture(), legacy = '["folder","old-name"]'
  f.service.register(11, folder, legacy)
  vi.mocked(f.storage.localDirectoryPreferences!).mockResolvedValue({ [`team:${legacy}`]: { pinned: false, pinnedAt: 0, removal: { at: 100, sequences: {} } } })
  const post = vi.fn(async () => data())
  const result = await f.service.execute('team.app.entries.query', { entries: [target] }, 11, 'test', post)
  expect(post.mock.calls.map(([path]) => path)).toEqual(['entry-preferences/query', 'entry-preferences/import', 'entry-preferences/query'])
  expect(post.mock.calls[1]?.[1]).toEqual({ items: [{ entry: folder, pinned: false }] })
  expect(result.migrationNotice).toContain('保留为可见')
  post.mockReset().mockResolvedValue(data({ version: 1 }))
  await f.service.execute('team.app.entries.query', { entries: [target] }, 11, 'test', post)
  expect(post).toHaveBeenCalledOnce()
})
it('SDK, Host and granted Tool adapters share the exact command and reject unsupported providers', async () => {
  const service = { providerCapabilities: () => ({ contractVersion: 1, features: { teamEntryPreferencesV1: true } }), listTeamEntryPreferences: vi.fn(async () => data()), queryTeamEntryPreferences: vi.fn(async () => data()), changeTeamEntryPreferences: vi.fn(async () => data()) }
  const fetchImpl = vi.fn(async (_path: unknown, init?: RequestInit) => { const { operation, params } = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true, value: await dispatchArkmeHostOperation(service as never, operation, params, init?.signal ?? undefined) })) }) as typeof fetch
  const sdk = new ArkmeSdk({ fetchImpl }), command = { operationId: randomUUID(), changes: [{ target, action: 'pin' as const, expectedVersion: 0 }] }
  await sdk.queryTeamEntryPreferences([target]); await sdk.changeTeamEntryPreferences(command)
  expect(service.changeTeamEntryPreferences).toHaveBeenCalledWith(command, undefined)
  const tool = teamEntryTools.find(t => t.meta.effect === 'write')!
  expect(tool.meta.grant).toBe('explicit-user-write')
  await tool.create(service as never).execute!({ kind: 'folder', ref: 'opaque', action: 'pin', expected_version: 0, operation_id: command.operationId }, { signal: undefined } as never)
  expect(service.changeTeamEntryPreferences).toHaveBeenLastCalledWith(command, undefined)
  const unsupported = new ArkmeSdk({ fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } }))) as typeof fetch })
  await expect(unsupported.changeTeamEntryPreferences(command)).rejects.toThrow('不支持')
})
it('seals pagination cursors rather than exposing internal user/entry keys', async () => {
  const f = fixture(), raw = 'entry:11:team_folder:secret-id:', post = vi.fn(async () => ({ ...data(), has_more: true, next_cursor: raw }))
  const page = await f.service.execute('team.app.entries.list', {}, 11, 'test', post)
  expect(page.nextCursor).toBe('opaque')
  expect(f.refs.seal).toHaveBeenCalledWith('entry-cursor', { cursor: raw }, 11)
  f.refs.open.mockResolvedValueOnce({ cursor: raw } as never)
  await f.service.execute('team.app.entries.list', { cursor: page.nextCursor }, 11, 'test', post)
  expect(post).toHaveBeenLastCalledWith('entry-preferences/list', { cursor: raw, limit: 100 }, true)
})
