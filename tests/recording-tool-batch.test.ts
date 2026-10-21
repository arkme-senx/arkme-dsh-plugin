import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { planRecordingToolBatch, recordingToolMemberKey } from '../src/recording-tool-batch.js'
import { recordingImportBatchID, RECORDING_IMPORT_RECOVERY_MILLIS } from '../src/recording-workflow-contract.js'
import { recordingToolBatchPlanner } from '../src/services/recording-tool-workflow.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { RecordingWorkflowService } from '../src/services/recording-workflow-service.js'

const dirs: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const candidate = (name: string, isNew = true) => ({ key: recordingToolMemberKey(name), isNew })
const rows = [candidate('a'), candidate('b'), candidate('c')]
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'arkme-batch-journal-')); dirs.push(dir)
  return { dir, store: new ArkmeStateStore(dir) }
}
describe('DSH import batch journal', () => {
  it('freezes a single batch before upload and recovers exact slots after Host restart, reordered subset and timezone change', async () => {
    const { dir, store } = await fixture()
    const first = await store.planRecordingToolBatch('prod:11', rows, 'Asia/Shanghai')
    expect(new Set(Object.values(first).map(row => row.batch.batchId)).size).toBe(1)
    expect(Object.values(first).map(row => row.batch.itemIndex)).toEqual([0, 1, 2])
    const resumed = await new ArkmeStateStore(dir).planRecordingToolBatch('prod:11', [rows[2]!, rows[0]!], 'UTC')
    expect(resumed[rows[2]!.key]).toEqual(first[rows[2]!.key])
    expect(resumed[rows[0]!.key]!.batch).toMatchObject({ itemCount: 3, timeZone: 'Asia/Shanghai' })
    expect((await readFile(join(dir, 'state.json'), 'utf8'))).toContain(first[rows[0]!.key]!.batch.batchId)
  })
  it('does not allocate slots for pre-existing uploads and isolates account/environment', async () => {
    const { store } = await fixture()
    const first = await store.planRecordingToolBatch('prod:11', [rows[0]!, candidate('old', false)], 'UTC')
    expect(Object.keys(first)).toHaveLength(1)
    expect(first[rows[0]!.key]!.batch.itemCount).toBe(1)
    const otherUser = await store.planRecordingToolBatch('prod:12', rows, 'UTC')
    const otherEnv = await store.planRecordingToolBatch('test:11', rows, 'UTC')
    expect(otherUser[rows[0]!.key]!.batch.batchId).not.toBe(first[rows[0]!.key]!.batch.batchId)
    expect(otherEnv[rows[0]!.key]!.batch.batchId).not.toBe(first[rows[0]!.key]!.batch.batchId)
  })
  it('serializes overlapping submissions and keeps original membership while grouping additions separately', async () => {
    const { store } = await fixture()
    const [first, second] = await Promise.all([
      store.planRecordingToolBatch('prod:11', rows.slice(0, 2), 'UTC'),
      store.planRecordingToolBatch('prod:11', rows.slice(1), 'UTC'),
    ])
    expect(second[rows[1]!.key]).toEqual(first[rows[1]!.key])
    expect(second[rows[2]!.key]!.batch).toMatchObject({ itemIndex: 0, itemCount: 1 })
  })
  it('fails closed on corrupt recovery state and does not overwrite evidence', async () => {
    const { dir } = await fixture()
    const data = JSON.stringify({ version: 2, recordingToolBatches: { 'prod:11': { broken: null } } })
    await writeFile(join(dir, 'state.json'), data)
    await expect(new ArkmeStateStore(dir).planRecordingToolBatch('prod:11', rows, 'UTC')).rejects.toThrow('损坏')
    expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe(data)
  })
  it('rejects expired pending members rather than quietly recreating them', () => {
    const first = planRecordingToolBatch(undefined, rows, 'UTC')
    first.journal[rows[0]!.key]!.batch.batchId = recordingImportBatchID(Date.now() - RECORDING_IMPORT_RECOVERY_MILLIS - 1000)
    expect(() => planRecordingToolBatch(first.journal, [rows[0]!], 'UTC')).toThrow('30 天')
    expect(() => planRecordingToolBatch(first.journal, [{ ...rows[0]!, isNew: false }], 'UTC')).not.toThrow()
  })
  it('does not expose original paths in its journal identity', () => {
    const key = recordingToolMemberKey(['/private/user/recording.wav', 123, 'self'])
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(() => planRecordingToolBatch(undefined, [candidate('a'), candidate('a')], 'UTC')).toThrow()
  })
  it('uses the same durable journal through the actual SQLite Host adapter', async () => {
    const { dir, store } = await fixture()
    const database = new ArkmeLocalDatabase(dir, store)
    const first = await database.planRecordingToolBatch('prod:11', rows, 'UTC')
    const second = await new ArkmeStateStore(dir).planRecordingToolBatch('prod:11', rows, 'Asia/Shanghai')
    expect(second).toEqual(first)
  })
})

describe('batch capability boundary', () => {
  async function fixturePlanner() {
    const { store } = await fixture()
    let userId = 11
    const request = vi.fn(async () => ({ supported: true }))
    const runtime = { config: { environment: 'prod' }, stateStore: store,
      requireSession: async () => ({ userId }) } as unknown as ServiceRuntime
    return { store, request, plan: recordingToolBatchPlanner(runtime, { request } as unknown as RecordingWorkflowService),
      change: () => { userId = 12 } }
  }
  it('does not allocate a plan or degrade on a network/auth failure', async () => {
    const f = await fixturePlanner(), save = vi.spyOn(f.store, 'planRecordingToolBatch')
    f.request.mockRejectedValueOnce(new Error('network down'))
    await expect(f.plan(11, rows)).rejects.toThrow('network down')
    expect(save).not.toHaveBeenCalled()
  })
  it('allows only explicit unsupported responses to omit automatic workflow', async () => {
    const f = await fixturePlanner()
    f.request.mockResolvedValueOnce({ supported: false })
    expect(await f.plan(11, rows)).toEqual({ supported: false, members: {} })
  })
  it('never changes a previously registered batch to an ordinary upload', async () => {
    const f = await fixturePlanner()
    await f.plan(11, rows)
    f.request.mockResolvedValueOnce({ supported: false })
    await expect(f.plan(11, rows)).rejects.toMatchObject({ code: 'recording-workflow-support-lost' })
  })
  it('rejects account changes during capability lookup before saving any manifest', async () => {
    const f = await fixturePlanner(), save = vi.spyOn(f.store, 'planRecordingToolBatch')
    f.request.mockImplementationOnce(async () => { f.change(); return { supported: true } })
    await expect(f.plan(11, rows)).rejects.toMatchObject({ code: 'recording-import-account-mismatch' })
    expect(save).not.toHaveBeenCalled()
  })
})
