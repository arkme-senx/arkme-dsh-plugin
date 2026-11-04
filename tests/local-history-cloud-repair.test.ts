import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as timers from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalHistoryCloudRepair } from '../src/local-history-cloud-repair.js'

vi.mock('node:timers/promises', async (original) => {
  const timers = await original<typeof import('node:timers/promises')>()
  return { ...timers, setImmediate: vi.fn(timers.setImmediate) }
})

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers() })
async function fixture(count = 203) {
  const root = await mkdtemp(join(tmpdir(), 'arkme-repair-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const events = Array.from({ length: count }, (_, seq) => ({ seq, time: seq + 1, type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `event ${seq}` }] } }))
  const snapshot = { revision: 'original' }, close = vi.fn(async () => {})
  const read = vi.fn(async (offset = 0, length = count) => ({ events: events.slice(offset, offset + length) }))
  const open = vi.fn(async (_id, access) => { expect(access).toBe('read'); return { read, close } })
  const post = vi.fn(async (path: string, body: any) => path.endsWith('capabilities') ? { enabled: true, version: 1 }
    : { next_seq: body.from_seq + body.entries.length, complete: body.from_seq + body.entries.length === body.through_seq + 1 })
  const options = { root, scope: 'test:42', persistence: { stat: async () => snapshot, open } as any,
    discover: vi.fn(async () => true), authorize: vi.fn(async () => {}), host: () => ({ ref: 'current', generation: 8 }), post, report: vi.fn() }
  const start = () => { const owner = new LocalHistoryCloudRepair(options); cleanup.push(() => owner.close()); return owner }
  return { ...options, events, snapshot, open, read, close, start }
}
it('coalesces readers, batches bounded immutable events and annotations without acquiring a writer', async () => {
  const f = await fixture(), owner = f.start()
  await Promise.all(Array.from({ length: 15 }, () => owner.enqueue('original', 'session')))
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  const batches = f.post.mock.calls.filter(([path]) => path.endsWith('/repair')).map(([, body]) => body)
  expect(batches.map(body => [body.from_seq, body.entries.length])).toEqual([[0, 100], [100, 100], [200, 3]])
  expect(batches.every(body => body.runtime_ref === 'original' && body.importer_runtime_ref === 'current' && body.through_seq === 202)).toBe(true)
  expect(batches[0].annotations[0]).toEqual({ event_seq: 0, canonical_text: 'event 0' })
  expect(f.open).toHaveBeenCalledOnce(); await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
  const persisted = await readFile(join(f.root, 'queue.json'), 'utf8')
  expect(persisted).not.toContain('event 0'); expect(JSON.parse(persisted).jobs[0].nextSeq).toBe(203)
})
it('splits rejected transport batches and advances only acknowledged events and annotations', async () => {
  const f = await fixture(7), accepted: any[] = []
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1 }
    if (body.entries.length > 2) throw Object.assign(new Error('proxy limit'), { httpStatus: 502, upstreamStatus: 413 })
    accepted.push(body)
    return { next_seq: body.from_seq + body.entries.length, complete: body.from_seq + body.entries.length === 7 }
  })
  const owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(accepted.flatMap(body => body.entries.map((entry: any) => entry.event.seq))).toEqual([0, 1, 2, 3, 4, 5, 6])
  for (const body of accepted) expect(body.annotations.map((row: any) => row.event_seq)).toEqual(body.entries.map((entry: any) => entry.event.seq))
  expect(f.report).not.toHaveBeenCalled()
})
it('stops an individually rejected event instead of retrying an unchanged oversized request', async () => {
  const f = await fixture(1)
  f.post.mockImplementation(async path => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1 }
    throw Object.assign(new Error('proxy limit'), { upstreamStatus: 413 })
  })
  const owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('failed'))
  expect(owner.status('original', 'session')?.nextSeq).toBe(0)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair'))).toHaveLength(1)
})
it('revalidates the journal digest on restart and resumes the last acknowledged prefix after interruption', async () => {
  const f = await fixture(); let interrupted = false
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1 }
    if (body.from_seq === 100 && !interrupted) { interrupted = true; throw new Error('offline') }
    return { next_seq: body.from_seq + body.entries.length, complete: body.from_seq + body.entries.length === 203 }
  })
  const owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(f.report).toHaveBeenCalled())
  expect(owner.status('original', 'session')?.nextSeq).toBe(100)
  await owner.close(); f.post.mockClear()
  const restarted = f.start()
  await vi.waitFor(() => expect(restarted.status('original', 'session')?.state).toBe('complete'), { timeout: 7000 })
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair')).map(([, body]) => body.from_seq)).toEqual([100, 200])
}, 10000)
it('stops conflicts, preserves the source, and never retries a terminal conflict on another read', async () => {
  const f = await fixture(2)
  f.post.mockImplementation(async path => { if (path.endsWith('capabilities')) return { enabled: true, version: 1 }; throw Object.assign(new Error('conflict'), { code: 'HISTORY_REPAIR_CONFLICT' }) })
  const owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('conflict'))
  await owner.enqueue('original', 'session')
  expect(f.post).toHaveBeenCalledTimes(2); expect(f.events).toHaveLength(2); expect(f.close).toHaveBeenCalledOnce()
})
it('restores acknowledged large legacy coordinates without replaying a completed revision', async () => {
  const f = await fixture(2)
  await writeFile(join(f.root, 'queue.json'), JSON.stringify({ scope: f.scope, jobs: [{ runtime: 'original', session: 'session', state: 'complete', nextSeq: 2, throughSeq: 1, sourceVersion: 1, sourceThrough: 103938, sourceNext: 103939, completedRevision: 'original', retryAt: 0, attempts: 0 }] }))
  const owner = f.start(); await owner.enqueue('original', 'session')
  expect(owner.status('original', 'session')).toEqual({ state: 'complete', nextSeq: 2, throughSeq: 1 })
  expect(f.post).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled()
})
it('rechecks only server capability until comparison rules change, independently of native format support', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const f = await fixture(1); let comparison = 2
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1, native_format_version: 4, comparison_version: comparison }
    if (comparison === 2) throw Object.assign(new Error('optional view differs'), { code: 'HISTORY_REPAIR_CONFLICT' })
    return { next_seq: body.from_seq + body.entries.length, complete: true }
  })
  const owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('conflict'))
  const reads = f.open.mock.calls.length
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(f.post.mock.calls.filter(([path]) => path.endsWith('capabilities'))).toHaveLength(2))
  expect(f.open).toHaveBeenCalledTimes(reads)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair'))).toHaveLength(1)
  comparison = 3
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8')).jobs[0].comparisonVersion).toBe(3)
})
it('resumes an interrupted large migration from acknowledged progress without retaining old failure backoff', async () => {
  const f = await fixture(2), original = Array.from({ length: 203 }, (_, seq) => ({ ...f.events[0]!, seq }))
  const formats = async () => ({ originals: [{ header: { version: 1 }, events: original }], current: { header: { version: 4 }, events: f.events } }) as any
  await writeFile(join(f.root, 'queue.json'), JSON.stringify({ scope: f.scope, jobs: [{ runtime: 'original', session: 'session', state: 'pending', nextSeq: 0, throughSeq: 1, sourceVersion: 1, sourceThrough: 202, sourceNext: 0, retryAt: 0, attempts: 6 }] }))
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1, native_format_version: 4 }
    if (body.from_seq === 100) throw new Error('interrupted')
    return { next_seq: body.from_seq + body.entries.length, complete: false }
  })
  const owner = new LocalHistoryCloudRepair({ ...f, formats }); cleanup.push(() => owner.close())
  await vi.waitFor(() => expect(f.report).toHaveBeenCalled())
  const job = JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8')).jobs[0]
  expect(job).toMatchObject({ state: 'pending', sourceNext: 100, nextSeq: 0, attempts: 1 })
  expect(job.retryAt - Date.now()).toBeLessThanOrEqual(5000)
})
it('stops unavailable migration proof without reporting a content conflict or retrying on every read', async () => {
  const f = await fixture(1)
  const formats = vi.fn(async () => { throw Object.assign(new Error('old decoder unsupported'), { code: 'LOCAL_HISTORY_FORMAT_UNAVAILABLE' }) })
  const owner = new LocalHistoryCloudRepair({ ...f, formats }); cleanup.push(() => owner.close())
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('failed'))
  await owner.enqueue('original', 'session')
  expect(formats).toHaveBeenCalledOnce()
  expect(f.post.mock.calls.some(([path]) => path.endsWith('/repair'))).toBe(false)
})
it('negotiates retained source capacity before upload and resumes automatically after the server upgrade', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const f = await fixture(2); let upgraded = false
  const original = Array.from({ length: 50001 }, (_, seq) => ({ ...f.events[0]!, seq }))
  const formats = async () => ({ originals: [{ header: { version: 1 }, events: original }], current: { header: { version: 4 }, events: f.events } }) as any
  await writeFile(join(f.root, 'queue.json'), JSON.stringify({ scope: f.scope, jobs: [{ runtime: 'original', session: 'session', state: 'pending', nextSeq: 0, throughSeq: 1, sourceVersion: 1, sourceThrough: 50000, sourceNext: 50001, retryAt: 0, attempts: 0 }] }))
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1, native_format_version: 4, ...(upgraded ? { max_source_entries: Number.MAX_SAFE_INTEGER } : {}) }
    if (!upgraded) throw new Error('must not upload before source capacity is supported')
    return { next_seq: body.from_seq + body.entries.length, complete: true }
  })
  const owner = new LocalHistoryCloudRepair({ ...f, formats }); cleanup.push(() => owner.close())
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('unsupported'))
  const reads = f.open.mock.calls.length
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(f.post.mock.calls.filter(([path]) => path.endsWith('capabilities'))).toHaveLength(2))
  expect(f.open).toHaveBeenCalledTimes(reads)
  upgraded = true
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair'))).toHaveLength(0)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/format-repair'))).toHaveLength(1)
})
it('negotiates old-server capability once without loading or uploading journals', async () => {
  const f = await fixture()
  f.post.mockResolvedValue({ enabled: false, version: 1 })
  const owner = f.start(); await owner.enqueue('original', 'session'); await owner.enqueue('original', 'another')
  await vi.waitFor(() => expect(owner.status('original', 'another')?.state).toBe('unsupported'))
  expect(f.post).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled()
})
it('replays from zero when an acknowledged source changes, exposing conflicts instead of skipping a changed prefix', async () => {
  const f = await fixture(2), owner = f.start(); await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  f.events[0]!.data.content[0]!.text = 'changed'; f.snapshot.revision = 'changed'; f.post.mockClear()
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(f.post.mock.calls[0]?.[1].from_seq).toBe(0)
})
it('finishes the acknowledged batch before processing a revision enqueued during its final yield', async () => {
  let release!: () => void, reached!: () => void
  const paused = new Promise<void>(resolve => { reached = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(timers.setImmediate).mockImplementationOnce(async () => { reached(); await gate })
  const f = await fixture(2), owner = f.start()
  cleanup.push(async () => { release() })
  await owner.enqueue('original', 'session'); await paused
  f.events[0]!.data.content[0]!.text = 'changed'; f.snapshot.revision = 'changed'; f.post.mockClear()
  await owner.enqueue('original', 'session'); release()
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(f.report).not.toHaveBeenCalled()
  expect(f.post.mock.calls[0]?.[1].from_seq).toBe(0)
})
it('does not reuse a persisted queue for another account or environment', async () => {
  const f = await fixture(1), owner = f.start(); await owner.enqueue('original', 'session'); await owner.close()
  const other = new LocalHistoryCloudRepair({ ...f, scope: 'prod:43' }); cleanup.push(() => other.close())
  await expect(other.enqueue('original', 'session')).rejects.toThrow('账号不匹配')
})
it('aborts an in-flight upload on account exit without accepting its late acknowledgement', async () => {
  const f = await fixture(2)
  let release!: () => void, requestSignal: AbortSignal | undefined
  const post = vi.fn(async (path: string, _body: any, signal: AbortSignal) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1 }
    requestSignal = signal
    await new Promise<void>(resolve => { release = resolve })
    return { next_seq: 2, complete: true }
  })
  const owner = new LocalHistoryCloudRepair({ ...f, post }); cleanup.push(() => owner.close())
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(requestSignal).toBeDefined())
  owner.cancel(); expect(requestSignal!.aborted).toBe(true)
  release(); await owner.close()
  expect(owner.status('original', 'session')).toMatchObject({ state: 'pending', nextSeq: 0 })
  expect(JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8')).jobs[0].nextSeq).toBe(0)
})

it('rechecks a persisted conflict once per Host and retries only a newer comparison version', async () => {
  const f = await fixture(2)
  f.post.mockImplementation(async path => { if (path.endsWith('capabilities')) return { enabled: true, version: 1 }; throw Object.assign(new Error('conflict'), { code: 'HISTORY_REPAIR_CONFLICT' }) })
  const first = f.start(); await first.enqueue('original', 'session')
  await vi.waitFor(() => expect(first.status('original', 'session')?.state).toBe('conflict'))
  await first.close()
  // Existing queues have no comparisonVersion; their server comparison was V1.
  const queue = JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8')); delete queue.jobs[0].comparisonVersion; queue.jobs[0].retryAt = 0
  await writeFile(join(f.root, 'queue.json'), JSON.stringify(queue))
  f.post.mockClear()
  const unchanged = f.start(); await unchanged.enqueue('original', 'session')
  await vi.waitFor(() => expect(f.post).toHaveBeenCalledOnce())
  expect(f.post.mock.calls[0]![0]).toContain('capabilities'); expect(f.open).toHaveBeenCalledOnce()
  expect(unchanged.status('original', 'session')?.state).toBe('conflict'); await unchanged.close()
  f.post.mockClear(); f.post.mockImplementation(async (path, body) => path.endsWith('capabilities') ? { enabled: true, version: 1, comparison_version: 2 }
    : { next_seq: body.from_seq + body.entries.length, complete: true })
  const upgraded = f.start()
  await vi.waitFor(() => expect(upgraded.status('original', 'session')?.state).toBe('complete'))
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair'))).toHaveLength(1)
  expect(JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8')).jobs[0].comparisonVersion).toBe(2)
})

it('repairs the original namespace before the current format and keeps message identity after continuation', async () => {
  const f = await fixture(2)
  const old = { ...structuredClone(f.events[0]!), data: { ...structuredClone(f.events[0]!.data), id: 'message-one', role: 'user' } }
  f.events[0] = { type: 'permission/preset', seq: 0, time: 0, data: { preset: 'read-only' } } as any
  f.events[1] = { ...structuredClone(old), seq: 1 }
  const formats = async () => ({ originals: [{ header: { version: 1, id: 'session' }, inheritedEventCount: 0, events: [old] }], current: { header: { version: 4, id: 'session' }, inheritedEventCount: 0, events: f.events } }) as any
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1, comparison_version: 2, native_format_version: 4 }
    if (path.endsWith('session-events/list')) return { entries: [{ event: old }] } as any
    if (path.endsWith('session-turn-objects/list')) return { items: [], has_more: false } as any
    return { next_seq: body.from_seq + body.entries.length, complete: body.from_seq + body.entries.length === body.through_seq + 1 }
  })
  const owner = new LocalHistoryCloudRepair({ ...f, formats }); cleanup.push(() => owner.close())
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  const writes = f.post.mock.calls.filter(([path]) => path.endsWith('/repair') || path.endsWith('/format-repair'))
  expect(writes.map(([path]) => path.split('/').at(-1))).toEqual(['repair', 'format-repair'])
  expect(writes[0]![1].entries).toEqual([{ event: old }])
  expect(writes[1]![1].mappings).toEqual([{ event_seq: 1, source_seq: 0, canonical_text: 'event 0' }])
  expect(await owner.annotationCoordinates('original', 'session', 1, new AbortController().signal)).toMatchObject({ formatVersion: 4, sourceSeq: 0 })
  f.events.push({ ...structuredClone(old), seq: 2, data: { ...structuredClone(old.data), id: 'message-two' } })
  f.snapshot.revision = 'continued'; f.post.mockClear()
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(owner.status('original', 'session')).toMatchObject({ state: 'complete', nextSeq: 3 }))
  const continued = f.post.mock.calls.filter(([path]) => path.endsWith('/format-repair'))
  expect(continued).toHaveLength(1); expect(continued[0]![1].from_seq).toBe(2)
  expect(continued[0]![1].mappings).toEqual([{ event_seq: 2, canonical_text: 'event 0' }])
  expect(await owner.annotationCoordinates('original', 'session', 2, new AbortController().signal)).toMatchObject({ formatVersion: 4 })
})

it('reports a proven format migration as waiting for server capability instead of a content conflict, without uploading current coordinates', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  let upgraded = false
  const f = await fixture(1), old = structuredClone(f.events[0]!)
  f.events[0] = { ...old, seq: 1 }
  const current = [{ seq: 0, time: 0, type: 'permission/preset', data: { preset: 'read-only' } }, ...f.events]
  f.read.mockImplementation(async (offset = 0, length = 100) => ({ events: current.slice(offset, offset + length) as any }))
  const formats = async () => ({ originals: [{ header: { version: 1, id: 'session' }, inheritedEventCount: 0, events: [old] }], current: { header: { version: 4, id: 'session' }, inheritedEventCount: 0, events: current } }) as any
  f.post.mockImplementation(async (path, body) => {
    if (path.endsWith('capabilities')) return { enabled: true, version: 1, comparison_version: 2, ...(upgraded ? { native_format_version: 4 } : {}) }
    if (path.endsWith('session-events/list')) return { entries: [{ event: old }] } as any
    if (path.endsWith('session-turn-objects/list')) return { items: [], has_more: false } as any
    if (!upgraded) throw new Error('unexpected write')
    return { next_seq: body.from_seq + body.entries.length, complete: body.from_seq + body.entries.length === body.through_seq + 1 }
  })
  await writeFile(join(f.root, 'queue.json'), JSON.stringify({ scope: f.scope, jobs: [{ runtime: 'original', session: 'session', state: 'conflict', nextSeq: 0, throughSeq: 1, comparisonVersion: 2, retryAt: 0, attempts: 0 }] }))
  const owner = new LocalHistoryCloudRepair({ ...f, formats }); cleanup.push(() => owner.close())
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('unsupported'))
  expect(f.report).not.toHaveBeenCalled()
  expect(f.post.mock.calls.some(([path]) => path.endsWith('/repair') || path.endsWith('/format-repair'))).toBe(false)
  const reads = f.open.mock.calls.length
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(f.post.mock.calls.filter(([path]) => path.endsWith('capabilities'))).toHaveLength(2))
  expect(f.open).toHaveBeenCalledTimes(reads)
  upgraded = true
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'))
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/format-repair'))).toHaveLength(1)
})


it('does not consume conflict revalidation while the Host is still registering', async () => {
  const f = await fixture(1); let registered = false
  await writeFile(join(f.root, 'queue.json'), JSON.stringify({ scope: f.scope, jobs: [{ runtime: 'original', session: 'session', state: 'conflict', nextSeq: 0, throughSeq: 0, comparisonVersion: 1, retryAt: 0, attempts: 0 }] }))
  f.post.mockImplementation(async (path, body) => path.endsWith('capabilities') ? { enabled: true, version: 1, comparison_version: 2 } : { next_seq: body.from_seq + body.entries.length, complete: true })
  const owner = new LocalHistoryCloudRepair({ ...f, host: () => registered ? { ref: 'current', generation: 8 } : undefined }); cleanup.push(() => owner.close())
  await vi.waitFor(() => expect(f.report).toHaveBeenCalled())
  registered = true
  await vi.waitFor(() => expect(owner.status('original', 'session')?.state).toBe('complete'), { timeout: 7000 })
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/repair'))).toHaveLength(1)
}, 10000)


it('automatically resumes unsupported jobs after a server upgrade without restarting or rereading unchanged journals', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const f = await fixture(2); let enabled = false
  f.post.mockImplementation(async (path, body) => path.endsWith('capabilities') ? { enabled, version: 1 }
    : { next_seq: body.from_seq + body.entries.length, complete: true })
  const owner = f.start()
  await owner.enqueue('original', 'session'); await owner.enqueue('original', 'another')
  await vi.waitFor(() => expect(owner.status('original', 'another')?.state).toBe('unsupported'))
  expect(f.post).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(f.post).toHaveBeenCalledTimes(2))
  expect(f.open).not.toHaveBeenCalled()
  enabled = true
  await vi.advanceTimersByTimeAsync(300_000)
  await vi.waitFor(() => expect(owner.status('original', 'another')?.state).toBe('complete'))
  expect(owner.status('original', 'session')?.state).toBe('complete')
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('capabilities'))).toHaveLength(3)
  await owner.close(); const calls = f.post.mock.calls.length
  await vi.advanceTimersByTimeAsync(600_000); expect(f.post).toHaveBeenCalledTimes(calls)
})

it('publishes durable progress and completion and does not regress an unchanged acknowledged source on restart', async () => {
  const f = await fixture(2), changed = vi.fn()
  const owner = new LocalHistoryCloudRepair({ ...f, changed }); cleanup.push(() => owner.close())
  await owner.enqueue('original', 'session')
  await vi.waitFor(() => expect(changed.mock.calls.at(-1)?.[2].state).toBe('complete'))
  const persisted = JSON.parse(await readFile(join(f.root, 'queue.json'), 'utf8'))
  expect(persisted.jobs[0].completedRevision).toBe('original')
  await owner.close(); changed.mockClear(); f.post.mockClear(); f.open.mockClear()
  const restored = new LocalHistoryCloudRepair({ ...f, changed }); cleanup.push(() => restored.close())
  await restored.enqueue('original', 'session')
  expect(restored.status('original', 'session')?.state).toBe('complete')
  expect(changed.mock.calls.map(call => call[2].state)).toEqual(['complete'])
  expect(f.post).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled()
  f.snapshot.revision = 'changed'; f.events.push({ ...f.events[0]!, seq: 2 })
  await restored.enqueue('original', 'session')
  expect(restored.status('original', 'session')?.state).toBe('pending')
})
