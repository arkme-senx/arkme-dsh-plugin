import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('extension icon Host owner', () => {
  it('keeps signed upload/download transport inside Host and caches verified bytes', async () => {
    const data = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const sha256 = createHash('sha256').update(data).digest('hex')
    const posts: string[] = []
    const stored = new Map<string, Uint8Array>([[sha256, data]])
    let pending = { sha256, size: data.byteLength, mediaType: 'image/png' }
    const post = vi.fn(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      posts.push(path)
      if (path.endsWith('/create')) {
        pending = {
          sha256: String(body.icon_sha256), size: Number(body.icon_size), mediaType: String(body.content_type),
        }
        return {
        icon_upload_session_id: 'iconup-1', extension_id: 'ext-1', status: 'uploading',
          upload_url: `https://objects.test/icon-put-${pending.sha256}`, upload_headers: { 'content-type': pending.mediaType }, expires_at: 1,
        } as T
      }
      if (path.endsWith('/complete')) return {
        icon_upload_session_id: 'iconup-1', extension_id: 'ext-1', status: 'applied', icon_ref: `icon_v1_${pending.sha256}`,
        content_type: pending.mediaType, icon_size: pending.size, icon_sha256: pending.sha256, updated_at: 1,
      } as T
      if (path.endsWith('/icon-resolve')) {
        const iconRef = String(body.icon_ref)
        const resolvedSha = iconRef.slice('icon_v1_'.length)
        const bytes = stored.get(resolvedSha)
        if (bytes === undefined) throw new Error(`unknown icon ${iconRef}`)
        return {
          extension_id: 'ext-1', icon_ref: iconRef, content_type: 'image/png',
          icon_size: bytes.byteLength, icon_sha256: resolvedSha, width: 64, height: 64,
          download_url: `https://objects.test/icon-get-${resolvedSha}`, download_headers: {}, expires_at: 1,
        } as T
      }
      throw new Error(`unexpected ${path}`)
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/icon-put-')) {
        expect(init?.method).toBe('PUT')
        const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
        stored.set(url.slice(url.lastIndexOf('-') + 1), bytes)
        return new Response('', { status: 200 })
      }
      if (url.includes('/icon-get-')) {
        const bytes = stored.get(url.slice(url.lastIndexOf('-') + 1))
        if (bytes === undefined) throw new Error(`missing ${url}`)
        return new Response(bytes as BodyInit, {
          status: 200, headers: { 'Content-Length': String(bytes.byteLength), 'Content-Type': 'image/png' },
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-icon-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    const manager = new ArkmeExtensionManager(
      new ExtensionPublishClient(post, fetchImpl as typeof fetch), store, {} as never,
      { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' },
    )

    const applied = await manager.setIcon({
      extensionId: 'ext-1', mediaType: 'image/png', data,
      idempotencyKey: '9f445b4f-55aa-45c1-9250-25161832d432',
    })
    expect(applied).toMatchObject({ icon_ref: `icon_v1_${sha256}` })
    expect(applied).not.toHaveProperty('upload_url')
    const first = await manager.readIcon('ext-1', applied.icon_ref)
    const second = await manager.readIcon('ext-1', applied.icon_ref)
    expect(first.data).toEqual(data)
    expect(second.data).toEqual(data)
    expect(posts.filter(path => path.endsWith('/icon-resolve'))).toHaveLength(1)
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).includes('/icon-get-'))).toHaveLength(1)

    const replacement = new Uint8Array([137, 80, 78, 71, 5, 6, 7, 8])
    await manager.setIcon({
      extensionId: 'ext-1', mediaType: 'image/png', data: replacement,
      idempotencyKey: '5aa2bd95-89b7-42a0-a8ab-59095e303839',
    })
    await manager.readIcon('ext-1', applied.icon_ref)
    expect(posts.filter(path => path.endsWith('/icon-resolve'))).toHaveLength(2)
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).includes('/icon-get-'))).toHaveLength(2)
    store.close()
  })
})
