import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharePreviewClient } from '../src/client/share-preview-client.js'
import type { ShareLinkPreview } from '../src/share-link-preview.js'

const value: ShareLinkPreview = { kind: 'message', state: 'ready', summary: '公开摘要' }
afterEach(() => vi.useRealTimers())
describe('preview account cache, deduplication and cancellation', () => {
  it('never reuses a viewer-relative Me flag for another account or environment', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ ...value, author: '原作者', authorIsMe: true })
      .mockResolvedValueOnce({ ...value, author: '原作者' })
      .mockResolvedValueOnce({ ...value, author: '测试环境作者' })
    const client = new SharePreviewClient(read)
    const mine = client.acquire('prod:42', 'same-link')
    expect(await mine.promise).toMatchObject({ authorIsMe: true })
    mine.release()
    const other = client.acquire('prod:99', 'same-link')
    expect(await other.promise).not.toHaveProperty('authorIsMe')
    other.release()
    const test = client.acquire('test:42', 'same-link')
    expect(await test.promise).toMatchObject({ author: '测试环境作者' })
    expect(await test.promise).not.toHaveProperty('authorIsMe')
    test.release()
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('shares a read, retains it until its last observer leaves and caches the result', async () => {
    let finish!: (value: ShareLinkPreview) => void
    const read = vi.fn((_url: string, _signal: AbortSignal) => new Promise<ShareLinkPreview>(resolve => { finish = resolve }))
    const client = new SharePreviewClient(read)
    const a = client.acquire('prod:1', 'link')
    const b = client.acquire('prod:1', 'link')
    expect(read).toHaveBeenCalledTimes(1)
    a.release()
    expect(read.mock.calls[0]![1].aborted).toBe(false)
    finish(value)
    expect(await b.promise).toEqual(value)
    b.release()
    expect(await client.acquire('prod:1', 'link').promise).toEqual(value)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('bounds concurrent reads to four and cancels unobserved queue entries', async () => {
    const finishes: ((value: ShareLinkPreview) => void)[] = []
    const read = vi.fn((_url: string, _signal: AbortSignal) => new Promise<ShareLinkPreview>(resolve => finishes.push(resolve)))
    const client = new SharePreviewClient(read)
    const requests = Array.from({ length: 7 }, (_, index) => client.acquire('prod:1', `${index}`))
    expect(read).toHaveBeenCalledTimes(4)
    requests[4]!.release()
    finishes[0]!(value)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5))
    expect(read.mock.calls[4]![0]).toBe('5')
    client.setScope('')
    expect(read.mock.calls.slice(1).every(call => call[1].aborted)).toBe(true)
  })
  it('drops old results and empties cache across logout and account changes', async () => {
    let finish!: (value: ShareLinkPreview) => void
    const client = new SharePreviewClient(() => new Promise(resolve => { finish = resolve }))
    const previous = client.acquire('prod:1', 'link')
    client.setScope('')
    finish(value)
    expect(await previous.promise).toBeNull()
    expect(await client.acquire('', 'link').promise).toBeNull()
    const next = client.acquire('prod:2', 'link')
    finish({ ...value, author: '账号2' })
    expect(await next.promise).toMatchObject({ author: '账号2' })
  })
  it('rechecks cached public snapshots after 60 seconds', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => value)
    const client = new SharePreviewClient(read)
    await client.acquire('prod:1', 'link').promise
    await vi.advanceTimersByTimeAsync(61000)
    await client.acquire('prod:1', 'link').promise
    expect(read).toHaveBeenCalledTimes(2)
  })
})
