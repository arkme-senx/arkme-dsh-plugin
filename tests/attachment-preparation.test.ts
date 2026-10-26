import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentPreparationQueue, type AttachmentPreparationPort } from '../src/client/attachment-preparation.js'
import { arkmeAttachmentId, arkmeAttachmentsPending, ArkmeComposerDraftStore, releaseArkmeComposerAttachment, type ArkmeComposerAttachment } from '../src/client/composer-draft-store.js'
import type { ArkmeLocalFile } from '../src/file-transfer-contract.js'
const file = (name: string, size = 1) => new File([new Uint8Array(size)], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' })
const local = (file: File): ArkmeLocalFile => ({ fileRef: `arkme-file-v1.${crypto.randomUUID()}`, fileName: file.name, fileKind: file.type.startsWith('image') ? 1 : 4, mimeType: file.type, size: file.size })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(overrides: Partial<AttachmentPreparationPort> = {}) {
  let items: readonly ArkmeComposerAttachment[] = []
  const port = { get: () => items, update: (fn: (items: readonly ArkmeComposerAttachment[]) => readonly ArkmeComposerAttachment[]) => { items = fn(items) }, current: () => true,
    policy: vi.fn(async () => ({ version: 1 as const, maxAttachments: 3, maxFileBytes: 100, maxImageBytes: 100 })),
    stage: vi.fn(async (f: File) => local(f)), discard: vi.fn(async () => {}), ...overrides }
  const queue = new AttachmentPreparationQueue(port)
  const remove = (index: number) => { releaseArkmeComposerAttachment(items[index]!); items = items.filter((_, i) => i !== index) }
  return { queue, port, remove, get: () => items }
}
afterEach(() => vi.restoreAllMocks())
describe('immediate per-file preparation', () => {
  it('publishes the whole selection before capabilities or staging resolve and keeps identities/order on completion', async () => {
    const policy = deferred<Awaited<ReturnType<AttachmentPreparationPort['policy']>>>()
    const { queue, get, port } = setup({ policy: () => policy.promise })
    queue.add([file('a.png'), file('b.txt')])
    expect(get().map(i => i.preparation?.fileName)).toEqual(['a.png', 'b.txt'])
    expect(get()[0]!.previewUrl).toMatch(/^blob:/)
    expect(port.stage).not.toHaveBeenCalled()
    const ids = get().map(arkmeAttachmentId)
    policy.resolve({version:1,maxAttachments:3,maxFileBytes:100,maxImageBytes:100})
    await queue.settled()
    expect(get().map(arkmeAttachmentId)).toEqual(ids)
    expect(get().map(i => i.localFile?.fileName)).toEqual(['a.png', 'b.txt'])
    expect(arkmeAttachmentsPending(get())).toBe(false)
    get().forEach(releaseArkmeComposerAttachment)
  })
  it('allows more selections during preparation and isolates errors to their own tiles', async () => {
    const first = deferred<ArkmeLocalFile>()
    const { queue, get } = setup({ stage: vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (f: File) => local(f)) })
    queue.add([file('a.txt')]); await Promise.resolve(); await Promise.resolve()
    queue.add([file('b.txt')])
    expect(get()).toHaveLength(2)
    first.reject(new Error('读取失败'))
    await queue.settled()
    expect(get()[0]!.preparation).toMatchObject({state:'failed',error:'读取失败'})
    expect(get()[1]!.localFile?.fileName).toBe('b.txt')
    expect(arkmeAttachmentsPending(get())).toBe(true)
    const id = arkmeAttachmentId(get()[0]!)
    get()[0]!.preparation!.retry(); get()[0]!.preparation!.retry()
    await queue.settled()
    expect(arkmeAttachmentId(get()[0]!)).toBe(id)
    expect(get().every(i => i.localFile !== undefined)).toBe(true)
  })
  it('does not resurrect a removed file even when transport completes after cancellation', async () => {
    const first = deferred<ArkmeLocalFile>()
    const { queue, get, remove, port } = setup({ stage: vi.fn().mockReturnValue(first.promise) })
    queue.add([file('a.png'), file('b.txt')])
    await vi.waitFor(() => expect(port.stage).toHaveBeenCalledOnce())
    remove(0); remove(0)
    first.resolve(local(file('a.png')))
    await queue.settled()
    expect(get()).toHaveLength(0)
    expect(port.stage).toHaveBeenCalledOnce()
    expect(port.discard).toHaveBeenCalledOnce()
  })
  it('keeps reordered slots when a preparation finishes', async () => {
    const first = deferred<ArkmeLocalFile>()
    const { queue, get, port } = setup({ stage: vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (f: File) => local(f)) })
    queue.add([file('a.txt'), file('b.txt')])
    await vi.waitFor(() => expect(port.stage).toHaveBeenCalledOnce())
    port.update(items => [...items].reverse())
    first.resolve(local(file('a.txt'))); await queue.settled()
    expect(get().map(i => i.localFile?.fileName)).toEqual(['b.txt','a.txt'])
  })
  it('does not spend valid attachment slots on invalid files and enforces limits again on retry', async () => {
    const { queue, get, port } = setup({ policy: async () => ({version:1,maxAttachments:1,maxFileBytes:100,maxImageBytes:100}) })
    queue.add([file('empty.txt',0),file('ok.txt'),file('extra.txt')]); await queue.settled()
    expect(get().map(i => i.preparation?.state ?? 'ready')).toEqual(['failed','ready','failed'])
    expect(port.stage).toHaveBeenCalledOnce()
    get()[2]!.preparation!.retry(); await queue.settled()
    expect(port.stage).toHaveBeenCalledOnce()
  })
  it('retains files in place on a capabilities failure and retries only the chosen one', async () => {
    const { queue, get, port } = setup()
    port.policy = vi.fn().mockRejectedValueOnce(new Error('离线')).mockResolvedValue({version:1,maxAttachments:3,maxFileBytes:100,maxImageBytes:100})
    queue.add([file('a.txt')]); await queue.settled()
    expect(get()[0]!.preparation?.error).toBe('离线')
    get()[0]!.preparation!.retry(); await queue.settled()
    expect(get()[0]!.localFile).toBeDefined()
  })
  it('rejects unsupported Arko image types inside their own card', async () => {
    const { queue, get, port } = setup({ imagesOnly: true })
    queue.add([file('a.txt'),file('b.png')]); await queue.settled()
    expect(get()[0]!.preparation?.state).toBe('failed')
    expect(get()[1]!.localFile).toBeDefined(); expect(port.stage).toHaveBeenCalledOnce()
    get().forEach(releaseArkmeComposerAttachment)
  })
  it('does not publish into another account when the owner changes mid-transfer', async () => {
    let current = true; const pending = deferred<ArkmeLocalFile>()
    const { queue, get, port } = setup({ current: () => current, stage: vi.fn(() => pending.promise) })
    queue.add([file('a.txt')]); await vi.waitFor(() => expect(port.stage).toHaveBeenCalledOnce()); current = false
    pending.resolve(local(file('a.txt'))); await queue.settled()
    expect(get()[0]!.localFile).toBeUndefined(); expect(port.discard).toHaveBeenCalledOnce()
    queue.dispose()
  })
  it('does not persist temporary files, callbacks, or blob previews as durable attachments', async () => {
    const writes = new Map<string,string>()
    const store = new ArkmeComposerDraftStore({ getItem: key => writes.get(key) ?? null, setItem: (key,value) => {writes.set(key,value)}, removeItem: key => {writes.delete(key)} })
    const key='arkme-composer:1:source:self', policy=deferred<Awaited<ReturnType<AttachmentPreparationPort['policy']>>>()
    const { queue } = setup({ get: () => store.get(key).attachments, update: update => store.updateAttachments(key, update), policy: () => policy.promise })
    queue.add([file('private.png')]); expect(store.get(key).attachments).toHaveLength(1)
    expect([...writes.values()].join('')).not.toContain('blob:')
    policy.resolve({version:1,maxAttachments:3,maxFileBytes:100,maxImageBytes:100}); await queue.settled()
    expect(store.get(key).attachments[0]!.localFile).toBeDefined()
    store.clearAccount(1)
  })
})
