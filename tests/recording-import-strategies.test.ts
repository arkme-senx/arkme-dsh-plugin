import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { recordingImportBatchID } from '../src/recording-workflow-contract.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme-native-strategies-')); roots.push(root)
  return { root, store: new ArkmeStateStore(root) }
}

describe('native upload strategy journal', () => {
  it('persists a whole submission, isolates accounts and environments, and refuses a changed retry', async () => {
    const { root, store } = await fixture()
    const tasks = [recordingImportBatchID(), recordingImportBatchID()].map(taskId => ({ taskId, strategy: 'baseline-sd-asr/20261026' as const }))
    await store.recordingImportStrategies('prod:42', tasks)
    const restarted = new ArkmeStateStore(root)
    const lookup = tasks.map(({ taskId }) => ({ taskId }))
    const expected = Object.fromEntries(tasks.map(task => [task.taskId, task.strategy]))
    expect(await restarted.recordingImportStrategies('prod:42', lookup)).toEqual(expected)
    expect(await restarted.recordingImportStrategies('test:42', lookup)).toEqual({})
    expect(await restarted.recordingImportStrategies('prod:43', lookup)).toEqual({})
    await expect(restarted.recordingImportStrategies('prod:42', [{ taskId: tasks[0]!.taskId, strategy: 'system-sd-asr/v1' }])).rejects.toMatchObject({ code: 'recording-import-task-conflict' })
    expect(await new ArkmeStateStore(root).recordingImportStrategies('prod:42', lookup)).toEqual(expected)
  })

  it('commits no partial batch when one registration conflicts, or the request is cancelled', async () => {
    const { root, store } = await fixture()
    const existing = recordingImportBatchID(), fresh = recordingImportBatchID()
    await store.recordingImportStrategies('test:42', [{ taskId: existing, strategy: 'system-sd-asr/v1' }])
    await expect(store.recordingImportStrategies('test:42', [
      { taskId: fresh, strategy: 'baseline-sd-asr/20261026' },
      { taskId: existing, strategy: 'baseline-sd-asr/20261026' },
    ])).rejects.toThrow('已固定')
    const controller = new AbortController(); controller.abort()
    await expect(store.recordingImportStrategies('test:42', [{ taskId: fresh, strategy: 'system-sd-asr/v1' }], controller.signal)).rejects.toThrow()
    expect(await new ArkmeStateStore(root).recordingImportStrategies('test:42', [{ taskId: fresh }])).toEqual({})
  })

  it('preserves corrupt recovery evidence instead of resetting the journal', async () => {
    const { root, store } = await fixture()
    const taskId = recordingImportBatchID()
    await store.recordingImportStrategies('test:42', [{ taskId, strategy: 'system-sd-asr/v1' }])
    const file = join(root, 'state.json'), raw = JSON.parse(await readFile(file, 'utf8'))
    raw.recordingImportStrategiesByAccount['test:42'][taskId] = 'unknown'
    await writeFile(file, JSON.stringify(raw))
    const before = await readFile(file, 'utf8')
    await expect(new ArkmeStateStore(root).recordingImportStrategies('test:42', [{ taskId, strategy: 'system-sd-asr/v1' }])).rejects.toThrow('损坏')
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('serializes conflicting registrations and rejects expired task identifiers', async () => {
    const { root, store } = await fixture(), taskId = recordingImportBatchID()
    const results = await Promise.allSettled([
      store.recordingImportStrategies('test:42', [{ taskId, strategy: 'baseline-sd-asr/20261026' }]),
      store.recordingImportStrategies('test:42', [{ taskId, strategy: 'system-sd-asr/v1' }]),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await new ArkmeStateStore(root).recordingImportStrategies('test:42', [{ taskId }])).toEqual({ [taskId]: 'baseline-sd-asr/20261026' })
    await expect(store.recordingImportStrategies('test:42', [{ taskId: recordingImportBatchID(Date.now() - 31 * 86400_000), strategy: 'system-sd-asr/v1' }])).rejects.toThrow('无效')
  })

  it('uses the same persistent journal through the production local database', async () => {
    const { root } = await fixture()
    const database = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
    try {
      const taskId = recordingImportBatchID()
      await database.recordingImportStrategies('test:42', [{ taskId, strategy: 'baseline-sd-asr/20261026' }])
      expect(await database.recordingImportStrategies('test:42', [{ taskId }])).toEqual({ [taskId]: 'baseline-sd-asr/20261026' })
    } finally { database.close() }
  })
})
