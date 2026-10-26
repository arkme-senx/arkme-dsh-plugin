import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { WorldLocalReactionService, localWorldReactionTarget } from '../src/services/world-local-reaction-service.js'
import type { ReactionSetResult, ReactionSnapshot } from '../src/reaction-contract.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-local-world-'))
  let database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory)), userId = 7
  const runtime = { config: { environment: 'test' }, get stateStore() { return database }, requireSession: async () => ({ userId, refreshToken: `session-${userId}` }) }
  const service = new WorldLocalReactionService(runtime as never)
  const target = await localWorldReactionTarget(runtime as never, 7, 'private-record-uid', 'a'.repeat(64))
  const command = { action: 'set' as const, accountKey: 'test:7', target, expression: { text: '赞同', color: 'purple' }, active: true, expected_revision: 0, request_id: 'add' }
  cleanups.push(async () => { database.close(); await rm(directory, { recursive: true, force: true }) })
  return { directory, service, target, command, runtime, get database() { return database }, setUser: (value: number) => { userId = value }, restart: () => { database.close(); database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory)) } }
}
describe('private local World reactions', () => {
  it('persists expressions, cancellations and phrases across real database restarts with no HTTP dependency', async () => {
    const f = await fixture()
    expect(f.target.worldRecordRef).not.toContain('private-record-uid')
    await f.service.request(f.command)
    await f.service.request({ action: 'library-set', accountKey: 'test:7', items: [{ text: '本机短语' }], expected_revision: 0, request_id: 'phrases' })
    f.restart()
    const result = await f.service.request({ action: 'query', accountKey: 'test:7', targets: [f.target] }) as { items: ReactionSnapshot[] }
    expect(result.items[0]).toMatchObject({ mine: { revision: 1 }, groups: [{ count: 1, actors: [{ userId: 7, displayName: '我' }] }] })
    expect(await f.service.request({ action: 'library-query', accountKey: 'test:7' })).toEqual({ revision: 1, items: [{ text: '本机短语' }] })
    await f.service.request({ ...f.command, active: false, expected_revision: 1, request_id: 'remove' })
    f.restart()
    expect(await f.service.request(f.command)).toMatchObject({ outcome: 'idempotent', state: { revision: 2, selections: [] } })
  })
  it('isolates accounts and content versions and rejects both forged and cloud references', async () => {
    const f = await fixture()
    await f.service.request(f.command)
    const changed = await localWorldReactionTarget(f.runtime as never, 7, 'private-record-uid', 'b'.repeat(64))
    expect(await f.service.request({ action: 'query', accountKey: 'test:7', targets: [changed] })).toMatchObject({ items: [{ mine: { selections: [] } }] })
    f.setUser(8)
    await expect(f.service.request({ ...f.command, accountKey: 'test:8' })).rejects.toMatchObject({ code: 'world-local-reactions-target-invalid' })
    expect(await f.service.request({ action: 'library-query', accountKey: 'test:8' })).toEqual({ revision: 0, items: [] })
    f.setUser(7)
    for (const worldRecordRef of [`${f.target.worldRecordRef}x`, 'arkme-world-record-v1.legacy', 'cloud-context']) {
      await expect(f.service.request({ ...f.command, target: { id: 'wrong', worldRecordRef } })).rejects.toMatchObject({ code: 'world-local-reactions-target-invalid' })
    }
  })
  it('detects competing-window changes and reused request IDs without overwriting data', async () => {
    const f = await fixture()
    await f.service.request(f.command)
    const conflict = await f.service.request({ ...f.command, expression: { text: '收到' }, request_id: 'other-window' }) as ReactionSetResult
    expect(conflict).toMatchObject({ outcome: 'revision_conflict', state: { revision: 1 } })
    await expect(f.service.request({ ...f.command, expression: { text: '篡改' } })).rejects.toThrow('内容已变化')
    await expect(f.service.request({ ...f.command, expected_revision: 1, request_id: 'invalid-emoji', expression: { text: '', emoji: 'unknown' } })).rejects.toThrow('无效')
  })
  it('preserves corrupt state rather than reporting success or silently wiping it', async () => {
    const f = await fixture()
    await f.service.request(f.command)
    const connection = (f.database as unknown as { database: { exec(sql: string): void } }).database
    connection.exec("UPDATE local_world_reactions SET payload='broken'")
    await expect(f.service.request({ ...f.command, request_id: 'new' })).rejects.toThrow('原数据已保留')
  })
})
