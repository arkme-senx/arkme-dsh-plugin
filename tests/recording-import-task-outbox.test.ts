import { describe, it, expect, vi } from 'vitest'
import { ImportTaskOutbox, type ImportTask, type ImportTaskStorage } from '../src/recording-import-task-outbox.js'
import { recordingImportBatchID } from '../src/recording-workflow-contract.js'
import { RecordingImportQueue } from '../src/recording-import-queue.js'
function fixture() {
  let durable: Record<string, ImportTask> = {}
  const store: ImportTaskStorage = { async importTasks(_scope, change) { const next = structuredClone(durable); change?.(next); durable = next; return structuredClone(next) } }
  const post = vi.fn(async (_path: string, body: unknown) => ({ items: (body as { items: ImportTask[] }).items }))
  const make = () => new ImportTaskOutbox(store, 'test:1', post)
  const items = (count: number) => Array.from({ length: count }, (_, i): ImportTask => ({task_id:recordingImportBatchID(),file_name:`${i}.wav`,file_size:100,start_at:1,duration_ms:100,belong_user_id:1,item_index:i,item_count:count,phase:'queued',revision:1}))
  return { store, post, make, items }
}
describe('durable recording task outbox', () => {
  it('persists and registers all 15 before two upload slots start', async () => {
    const f = fixture(), outbox = f.make(), manifest = f.items(15)
    await outbox.register(manifest)
    expect(Object.keys(await f.store.importTasks('test:1'))).toHaveLength(15)
    await outbox.flush()
    expect((f.post.mock.calls[0]![1] as {items: unknown[]}).items).toHaveLength(15)
    const queue = new RecordingImportQueue(2), started: string[] = [], releases: Array<() => void> = []
    const runs = manifest.map(task => queue.run(async () => { started.push(task.task_id); await new Promise<void>(resolve => releases.push(resolve)) }, new AbortController().signal))
    await new Promise(resolve => setTimeout(resolve, 0)); expect(started).toHaveLength(2)
    for (let i = 0; i < 15; i++) { releases[i]?.(); await new Promise(resolve => setTimeout(resolve, 0)) }
    await Promise.all(runs)
  })
  it('recovers failed registration after restart with the same identity', async () => {
    const f = fixture(), task = f.items(1)[0]!, first = f.make()
    await first.register([task]); f.post.mockRejectedValueOnce(new Error('offline'))
    await expect(first.flush()).rejects.toThrow('offline')
    expect((await f.store.importTasks('test:1'))[task.task_id]?.registered).toBeUndefined()
    await f.make().flush()
    expect((await f.store.importTasks('test:1'))[task.task_id]?.registered).toBe(true)
  })
  it('persists heartbeat revisions and never resurrects cancellation', async () => {
    const f = fixture(), outbox = f.make(), task = f.items(1)[0]!
    await outbox.register([task]); await outbox.flush(); await outbox.flush(undefined, true)
    expect((await f.store.importTasks('test:1'))[task.task_id]?.revision).toBe(2)
    await outbox.change(task.task_id, 'cancelled'); await outbox.change(task.task_id, 'uploading')
    await outbox.flush(undefined, true)
    expect((await f.store.importTasks('test:1'))[task.task_id]).toMatchObject({phase:'cancelled',revision:3})
  })
  it('reports failed and restores the same task with a newer revision while ignoring old callbacks', async () => {
    const f = fixture(), outbox = f.make(), task = f.items(1)[0]!
    await outbox.register([task]); await outbox.flush()
    await outbox.change(task.task_id,'uploading',false,3)
    await outbox.change(task.task_id,'failed',false,4); await outbox.flush()
    expect((f.post.mock.calls.at(-1)![1] as {items: unknown[]}).items[0]).toMatchObject({phase:'failed',error_code:'recording_import_failed'})
    await outbox.change(task.task_id,'uploading',false,5)
    await outbox.change(task.task_id,'queued',false,2)
    await outbox.flush()
    expect((await f.store.importTasks('test:1'))[task.task_id]).toMatchObject({phase:'uploading',localJobRevision:5,revision:4})
  })
  it('keeps a newer cancellation dirty when an older uploading reply arrives late', async () => {
    const f = fixture(), outbox = f.make(), task = f.items(1)[0]!
    await outbox.register([task]); await outbox.flush(); await outbox.change(task.task_id,'uploading')
    let release!: () => void
    f.post.mockImplementationOnce(async (_path, body) => { await new Promise<void>(resolve => { release = resolve }); return {items:(body as {items:ImportTask[]}).items} })
    const old = outbox.flush(); await vi.waitFor(() => expect(release).toBeDefined())
    await outbox.change(task.task_id,'cancelled'); release(); await old
    expect((await f.store.importTasks('test:1'))[task.task_id]).toMatchObject({phase:'cancelled',revision:3,acknowledged:2})
    await outbox.flush()
    expect((await f.store.importTasks('test:1'))[task.task_id]?.acknowledged).toBe(3)
  })
  it('stops heartbeats after acceptance and expires after 30 days', async () => {
    const f = fixture(), outbox = f.make(), task = f.items(1)[0]!
    await outbox.register([task]); await outbox.flush(); await outbox.change(task.task_id,'finalizing',true); await outbox.flush()
    f.post.mockClear(); await outbox.flush(undefined,true); expect(f.post).not.toHaveBeenCalled()
    const expired = {...f.items(1)[0]!,task_id:recordingImportBatchID(Date.now()-31*86400_000)}
    await outbox.register([expired]); await outbox.flush(undefined,true); expect(f.post).not.toHaveBeenCalled()
  })
  it('splits registration and heartbeats into at most 100 items', async () => {
    const f=fixture(), outbox=f.make(); await outbox.register(f.items(215)); await outbox.flush(); await outbox.flush(undefined,true)
    expect(f.post.mock.calls.map(call => (call[1] as {items:unknown[]}).items.length)).toEqual([100,100,15,100,100,15])
  })
})
