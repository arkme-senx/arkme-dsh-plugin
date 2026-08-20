import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createArkmeExtensionPreviewReadHandler, createArkmeExtensionPreviewUploadHandler,
} from '../../src/extensions/preview-routes.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('extension preview same-origin routes', () => {
  it('requires same-origin raw upload and serves immutable verified bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const previewRef = `preview_v1_${'a'.repeat(64)}`
    const addPreview = vi.fn(async () => ({
      extension_id: 'ext-1', applied_preview_ref: previewRef,
      preview_images: [{ preview_ref: previewRef, content_type: 'image/png' as const, preview_size: data.byteLength, width: 640, height: 480, created_at: 1 }],
      preview_revision: 1,
    }))
    const readPreview = vi.fn(async () => ({
      extensionId: 'ext-1', previewRef, mediaType: 'image/png' as const, data,
    }))
    let uploadHandler: ReturnType<typeof createArkmeExtensionPreviewUploadHandler>
    let readHandler: ReturnType<typeof createArkmeExtensionPreviewReadHandler>
    const server = createServer((req, res) => {
      void (req.url?.startsWith('/upload') === true ? uploadHandler(req, res) : readHandler(req, res))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    const options = { expectedPort: address.port, allowNonLoopback: false, manager: () => ({ addPreview, readPreview }) as never }
    uploadHandler = createArkmeExtensionPreviewUploadHandler(options)
    readHandler = createArkmeExtensionPreviewReadHandler(options)

    const missingOrigin = await fetch(`${origin}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png', 'X-Arkme-Extension-Id': 'ext-1', 'X-Arkme-Idempotency-Key': randomUUID(),
      },
      body: data,
    })
    expect(missingOrigin.status).toBe(403)
    expect(addPreview).not.toHaveBeenCalled()

    const upload = await fetch(`${origin}/upload`, {
      method: 'POST',
      headers: {
        Origin: origin, 'Content-Type': 'image/png', 'X-Arkme-Extension-Id': 'ext-1',
        'X-Arkme-Idempotency-Key': randomUUID(),
      },
      body: data,
    })
    expect(upload.status).toBe(200)
    const envelope = await upload.json() as { value?: Record<string, unknown> }
    expect(envelope.value).not.toHaveProperty('upload_url')
    expect(addPreview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data,
    }))

    const read = await fetch(`${origin}/preview?extension_id=ext-1&preview_ref=${previewRef}`)
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('image/png')
    expect(read.headers.get('etag')).toBe(`"${previewRef}"`)
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(data)
    const head = await fetch(`${origin}/preview?extension_id=ext-1&preview_ref=${previewRef}`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    expect(readPreview).toHaveBeenCalledWith('ext-1', previewRef)
  })
})
