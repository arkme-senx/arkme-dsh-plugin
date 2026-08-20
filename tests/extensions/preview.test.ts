import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('extension preview Host owner', () => {
  it('keeps signed transport Host-only, applies CAS mutations, and evicts deleted refs', async () => {
    const data = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const sha256 = createHash('sha256').update(data).digest('hex')
    const previewRef = `preview_v1_${sha256}`
    const secondRef = `preview_v1_${'b'.repeat(64)}`
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const post = vi.fn(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      posts.push({ path, body })
      if (path.endsWith('/create')) return {
        preview_upload_session_id: 'previewup-1', extension_id: 'ext-1', status: 'uploading',
        upload_url: 'https://objects.test/preview-put', upload_headers: { 'content-type': 'image/png' }, expires_at: new Date().toISOString(),
      } as T
      if (path.endsWith('/complete')) return {
        extension_id: 'ext-1', applied_preview_ref: previewRef,
        preview_images: [{ preview_ref: previewRef, content_type: 'image/png', preview_size: data.byteLength, width: 640, height: 480, created_at: 1 }],
        preview_revision: 1,
      } as T
      if (path.endsWith('/previews/delete')) return {
        extension_id: 'ext-1', preview_images: [], preview_revision: 2,
      } as T
      if (path.endsWith('/previews/reorder')) return {
        extension_id: 'ext-1',
        preview_images: [
          { preview_ref: secondRef, content_type: 'image/png', preview_size: 5, width: 800, height: 600, created_at: 2 },
          { preview_ref: previewRef, content_type: 'image/png', preview_size: data.byteLength, width: 640, height: 480, created_at: 1 },
        ],
        preview_revision: 3,
      } as T
      if (path.endsWith('/preview-resolve')) return {
        extension_id: 'ext-1', preview_ref: previewRef, content_type: 'image/png',
        preview_size: data.byteLength, preview_sha256: sha256, width: 640, height: 480,
        download_url: 'https://objects.test/preview-get', download_headers: {}, expires_at: new Date().toISOString(),
      } as T
      throw new Error(`unexpected ${path}`)
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview-put')) {
        expect(init?.method).toBe('PUT')
        expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(data)
        return new Response('', { status: 200 })
      }
      if (url.endsWith('/preview-get')) return new Response(data as BodyInit, {
        status: 200, headers: { 'Content-Length': String(data.byteLength), 'Content-Type': 'image/png' },
      })
      throw new Error(`unexpected ${url}`)
    })
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-preview-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    const manager = new ArkmeExtensionManager(
      new ExtensionPublishClient(post, fetchImpl as typeof fetch), store, {} as never,
      { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' },
    )

    const applied = await manager.addPreview({
      extensionId: 'ext-1', mediaType: 'image/png', data, idempotencyKey: randomUUID(),
    })
    expect(applied).toMatchObject({ applied_preview_ref: previewRef, preview_revision: 1 })
    expect(applied).not.toHaveProperty('upload_url')
    const first = await manager.readPreview('ext-1', previewRef)
    const cached = await manager.readPreview('ext-1', previewRef)
    expect(first.data).toEqual(data)
    expect(cached.data).toEqual(data)
    expect(posts.filter(item => item.path.endsWith('/preview-resolve'))).toHaveLength(1)

    const reordered = await manager.reorderPreviews({
      extensionId: 'ext-1', orderedPreviewRefs: [secondRef, previewRef], expectedRevision: 2,
    })
    expect(reordered.preview_images.map(item => item.preview_ref)).toEqual([secondRef, previewRef])
    expect(posts.at(-1)?.body).toEqual({
      extension_id: 'ext-1', ordered_preview_refs: [secondRef, previewRef], expected_revision: 2,
    })

    const deleted = await manager.deletePreview({ extensionId: 'ext-1', previewRef, expectedRevision: 1 })
    expect(deleted).toMatchObject({ preview_images: [], preview_revision: 2 })
    await manager.readPreview('ext-1', previewRef)
    expect(posts.filter(item => item.path.endsWith('/preview-resolve'))).toHaveLength(2)
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/preview-get'))).toHaveLength(2)
    store.close()
  })
})
