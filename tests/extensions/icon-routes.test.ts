import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createArkmeExtensionIconReadHandler, createArkmeExtensionIconUploadHandler,
} from '../../src/extensions/icon-routes.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('extension icon same-origin routes', () => {
  it('uploads raw bytes without returning signed transport and serves verified cached bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const setIcon = vi.fn(async () => ({
      icon_upload_session_id: 'iconup-1', extension_id: 'ext-1', status: 'applied' as const,
      icon_ref: `icon_v1_${'a'.repeat(64)}`, content_type: 'image/png' as const,
      icon_size: data.byteLength, icon_sha256: 'a'.repeat(64), updated_at: 1,
    }))
    const readIcon = vi.fn(async () => ({
      extensionId: 'ext-1', iconRef: `icon_v1_${'a'.repeat(64)}`, mediaType: 'image/png' as const, data,
    }))
    let uploadHandler: ReturnType<typeof createArkmeExtensionIconUploadHandler>
    let readHandler: ReturnType<typeof createArkmeExtensionIconReadHandler>
    const server = createServer((req, res) => {
      void (req.url?.startsWith('/upload') === true ? uploadHandler(req, res) : readHandler(req, res))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    const options = { expectedPort: address.port, allowNonLoopback: false, manager: () => ({ setIcon, readIcon }) as never }
    uploadHandler = createArkmeExtensionIconUploadHandler(options)
    readHandler = createArkmeExtensionIconReadHandler(options)

    const upload = await fetch(`${origin}/upload`, {
      method: 'POST',
      headers: {
        Origin: origin, 'Content-Type': 'image/png', 'X-Arkme-Extension-Id': 'ext-1',
        'X-Arkme-Idempotency-Key': '9f445b4f-55aa-45c1-9250-25161832d432',
      },
      body: data,
    })
    expect(upload.status).toBe(200)
    const envelope = await upload.json() as { value?: Record<string, unknown> }
    expect(envelope.value).not.toHaveProperty('upload_url')
    expect(setIcon).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data,
    }))

    const read = await fetch(`${origin}/icon?extension_id=ext-1&icon_ref=icon_v1_${'a'.repeat(64)}`)
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(data)
    expect(readIcon).toHaveBeenCalledWith('ext-1', `icon_v1_${'a'.repeat(64)}`)
  })
})
