import { expect, it } from 'vitest'
import { TimelineCacheWorker } from '../src/timeline-cache-port.js'
const fixture = (source: string) => new URL(`data:text/javascript,${encodeURIComponent(`import { parentPort } from 'node:worker_threads'; ${source}`)}`)
it('bounds admission and isolates a worker failure from subsequent callers', async () => {
  const worker = new TimelineCacheWorker('unused', fixture("parentPort.on('message', ({id}) => setTimeout(() => parentPort.postMessage({id,value:17}), 30));"))
  try {
    const requests = Array.from({ length: 32 }, () => worker.call<number>({ kind: 'reserve' }))
    await expect(worker.call({ kind: 'reserve' })).rejects.toThrow('unavailable')
    expect(await Promise.all(requests)).toEqual(Array(32).fill(17))
    expect(await worker.call({ kind: 'reserve' })).toBe(17)
  } finally { worker.close() }
  const broken = new TimelineCacheWorker('unused', fixture("parentPort.on('message', () => { throw new Error('private disk detail'); });"))
  await expect(broken.call({ kind: 'reserve' })).rejects.toThrow('Timeline storage unavailable')
  await expect(broken.call({ kind: 'reserve' })).rejects.toThrow('Timeline storage unavailable')
  broken.close()
})
it('rejects oversized writes before cloning them into the worker', async () => {
  const worker = new TimelineCacheWorker('unused', fixture("parentPort.on('message', ({id}) => parentPort.postMessage({id}));"))
  try {
    await expect(worker.call({ kind: 'write', scope: 'scope', request: 'page', options: {},
      page: { source: {}, items: [], hasMore: false, large: 'x'.repeat(3 * 1024 * 1024) } as never })).rejects.toThrow('unavailable')
  } finally { worker.close() }
})
