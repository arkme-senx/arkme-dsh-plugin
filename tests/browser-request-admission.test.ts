import { afterEach, expect, it, vi } from 'vitest'
import { runArkmeBrowserRequest as run } from '../src/sdk/browser-request-admission.js'

afterEach(() => vi.unstubAllGlobals())
function browser() {
  const root: any = { location: { protocol: 'http:', origin: 'http://localhost:1234' } }
  root.parent = root
  vi.stubGlobal('window', root)
  return root
}
it('keeps SDK calls usable in non-browser hosts with a partial window shim', async () => {
  vi.stubGlobal('window', {})
  const work = vi.fn(async () => 'ok')
  await expect(run('files.send', undefined, work)).resolves.toBe('ok')
  expect(work).toHaveBeenCalledOnce()
})
it('reserves delivery capacity and admits it before queued reads across same-origin frames', async () => {
  const root = browser(), releases: Array<() => void> = [], entered: string[] = []
  const read = (label: string) => async () => { entered.push(label); await new Promise<void>(r => releases.push(r)); return label }
  const controller = new AbortController()
  const ordinary = Array.from({ length: 5 }, (_, i) => run('source.timeline', controller.signal, read(`read-${i}`)))
  const results = Promise.allSettled(ordinary)
  await vi.waitFor(() => expect(entered).toHaveLength(4))
  vi.stubGlobal('window', { location: root.location, parent: root })
  const delivery = [run('files.send', controller.signal, read('send')), run('files.send.tasks', controller.signal, read('receipt'))]
  await vi.waitFor(() => expect(entered).toEqual(['read-0', 'read-1', 'read-2', 'read-3', 'send']))
  releases[0]!()
  await vi.waitFor(() => expect(entered.at(-1)).toBe('receipt'))
  controller.abort(); releases.forEach(r => r())
  await Promise.allSettled(delivery); await results
  expect(entered).toHaveLength(6)
  expect(await run('source.timeline', undefined, async () => 'released')).toBe('released')
})
it('holds a slot until the complete response is consumed and never retries a write', async () => {
  browser()
  const release: Array<() => void> = [], calls: number[] = []
  const active = Array.from({ length: 4 }, (_, i) => run('sources.list', undefined, async () => {
    calls.push(i); await new Promise<void>(r => release.push(r)); return i
  }))
  await vi.waitFor(() => expect(calls).toHaveLength(4))
  const next = run('source.timeline', undefined, async () => { calls.push(4); return 4 })
  await Promise.resolve(); expect(calls).toHaveLength(4)
  release[0]!(); expect(await next).toBe(4)
  release.forEach(r => r()); await Promise.all(active)
  const failed = vi.fn(async () => { throw new Error('unknown write outcome') })
  await expect(run('files.send', undefined, failed)).rejects.toThrow('unknown write outcome')
  expect(failed).toHaveBeenCalledOnce()
})
