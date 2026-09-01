import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { FileTransfers } from '../src/services/file-transfers.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeUploadHandler, createArkmeLocalFileHandler } from '../src/rich-media-routes.js'
import { createArkmeSdk } from '../src/sdk/index.js'

describe('file Host and external SDK transport contract', () => {
  it('stages, reads ranges, queues sends, recovers tasks, and enforces account/origin boundaries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme sdk files '))
    let userId = 42
    const upload = vi.fn(async (_path, file) => ({ ...file, fileAssetUid: 'asset-12345678' }))
    const directUpload = vi.fn(async (_path, file) => ({ ...file, fileAssetUid: 'direct-asset' }))
    const send = vi.fn(async input => ({ kind: 'owner_accepted' as const, result: {
      sourceRef: input.sourceRef, itemUid: input.recordUid, status: 1, localState: 'synced' as const,
    } }))
    const openPath = vi.fn(async () => {})
    const owner = new FileTransfers(directory, { currentUser: async () => userId, validateSource: async () => {}, upload, send, fetchMedia: async () => { throw new Error('not expected') }, openPath }, 1000)
    const facade = {
      fileSessionUser: async () => userId, fileStage: owner.stage.bind(owner), fileReadLocal: owner.readLocal.bind(owner),
      fileCapabilities: owner.capabilities.bind(owner), fileList: owner.files.bind(owner), fileSend: owner.enqueue.bind(owner),
      fileOpenLocal: owner.openLocal.bind(owner),
      fileSendTasks: owner.tasks.bind(owner), fileSendRetry: owner.retry.bind(owner), fileSendDiscard: owner.discard.bind(owner),
      fileSendReconcile: owner.reconcile.bind(owner), fileRemove: owner.remove.bind(owner), fileStageBytes: owner.stageBytes.bind(owner),
      uploadLocalFile: directUpload,
    }
    const options = { expectedPort: 0, allowNonLoopback: false, maxUploadBytes: 1000, temporaryDirectory: join(directory, 'temporary') }
    const stage = createArkmeUploadHandler(facade as never, options, 'stage')
    const uploadDirectly = createArkmeUploadHandler(facade as never, options)
    const read = createArkmeLocalFileHandler(facade as never, options)
    const api = createArkmeHostApi(facade as never, options)
    const server = createServer((request, response) => {
      if (request.url?.includes('/files/stage')) void stage(request, response)
      else if (request.url?.includes('/media/upload')) void uploadDirectly(request, response)
      else if (request.url?.includes('/files/local')) void read(request, response)
      else void api(request, response)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (typeof address !== 'object' || !address) throw new Error('missing address')
    options.expectedPort = address.port
    const base = `http://127.0.0.1:${address.port}`
    const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(String(url), base), init) })
    try {
      expect((await sdk.fileCapabilities()).version).toBe(1)
      const file = await sdk.stageFile(new Blob(['abcdefghij'], { type: 'application/pdf' }), { fileName: 'a 中文.pdf' })
      expect(file).toMatchObject({ fileKind: 4, size: 10 }); expect(upload).not.toHaveBeenCalled()
      const image = await sdk.stageFile(new Blob(['abcdefghij']), { fileName: 'browser-photo.jpg' })
      expect(image).toMatchObject({ fileKind: 1, mimeType: 'image/jpeg', size: 10 })
      const directResponse = await fetch(`${base}/media/upload`, {
        method: 'POST',
        headers: { 'content-type': 'audio/mpeg', 'content-length': '10', 'x-arkme-file-name': encodeURIComponent('picked.mp3') },
        body: 'abcdefghij',
      })
      expect(directResponse.status).toBe(200)
      expect(directUpload).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ fileName: 'picked.mp3', mimeType: 'audio/mpeg', fileKind: 2 }))
      const range = await fetch(new URL(sdk.localFileUrl(file.fileRef), base), { headers: { Range: 'bytes=2-5' } })
      expect(range.status).toBe(206); expect(await range.text()).toBe('cdef')
      expect(range.headers.get('content-range')).toBe('bytes 2-5/10')
      const rejected = await fetch(new URL(sdk.localFileUrl(file.fileRef), base), { headers: { Origin: 'https://untrusted.invalid' } })
      expect(rejected.status).toBe(403)
      const html = await sdk.stageFile(new Blob(['<script>bad()</script>'], { type: 'text/html' }), { fileName: 'untrusted.html' })
      const htmlResponse = await fetch(new URL(sdk.localFileUrl(html.fileRef), base))
      expect(htmlResponse.headers.get('content-disposition')).toMatch(/^attachment;/)
      expect(htmlResponse.headers.get('content-security-policy')).toContain('sandbox')
      await expect(sdk.openLocalFile(file.fileRef)).resolves.toMatchObject({ opened: true, file: { fileRef: file.fileRef } })
      expect(openPath).toHaveBeenCalledOnce()
      const input = { sourceRef: 'source', recordUid: '00000000-0000-4000-8000-000000000001', relationUid: '00000000-0000-4000-8000-000000000002', fileRefs: [file.fileRef], content: { textContent: 'hello' } }
      const task = await sdk.sendFiles(input); await owner.settled()
      expect((await sdk.sendFiles(input)).taskRef).toBe(task.taskRef)
      expect((await sdk.fileSendTasks())[0]!.state).toBe('sent')
      expect(upload).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce()
      const restored = new FileTransfers(directory, {} as never, 1000)
      expect(restored.capabilities().maxAttachments).toBe(9)
      userId = 43
      expect(await sdk.localFiles()).toEqual([])
      expect((await fetch(new URL(sdk.localFileUrl(file.fileRef), base))).status).toBe(400)
      userId = 42
      await sdk.discardFileSend(task.taskRef); await sdk.removeLocalFile(file.fileRef)
      expect((await sdk.localFiles()).map(value => value.fileRef)).toEqual([image.fileRef, html.fileRef])
    } finally {
      owner.cancelActive(); await owner.settled()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects an unsupported Host file contract and exposes a disposable polling subscription', async () => {
    const sdk = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { version: 2 } })) })
    await expect(sdk.fileCapabilities()).rejects.toThrow('Unsupported Arkme file contract version 2')
    let signal: AbortSignal | null | undefined
    const reader = createArkmeSdk({ fetchImpl: async (_url, init) => { signal = init?.signal; return new Response(JSON.stringify({ ok: true, value: [] })) } })
    const listener = vi.fn()
    const dispose = reader.subscribeFileSends('source', listener)
    await new Promise(resolve => setTimeout(resolve, 5)); dispose()
    expect(listener).toHaveBeenCalledOnce(); expect(signal?.aborted).toBe(true)
  })
})
