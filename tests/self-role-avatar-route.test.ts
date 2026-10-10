import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeSelfRoleAvatarHandler } from '../src/rich-media-routes.js'
import { MAX_SELF_ROLE_AVATAR_BYTES, SelfRoleAvatarStore } from '../src/self-role-avatar-store.js'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h5kAAAAASUVORK5CYII=',
  'base64',
)

describe('local self-role avatar HTTP route', () => {
  it('saves a real image locally and rejects account changes, spoofed images and oversized uploads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-route-'))
    const store = new SelfRoleAvatarStore(join(directory, 'avatars'))
    let activeUserId = 42
    const saveSelfRoleAvatar = vi.fn(async (userId: number, data: Uint8Array, mimeType: 'image/png') =>
      await store.save(userId, data, mimeType))
    const service = { fileSessionUser: async () => activeUserId, saveSelfRoleAvatar }
    const options = { expectedPort: 0, allowNonLoopback: false, temporaryDirectory: join(directory, 'tmp'), maxUploadBytes: MAX_SELF_ROLE_AVATAR_BYTES }
    const handler = createArkmeSelfRoleAvatarHandler(service as never, options)
    const server = createServer((request, response) => { void handler(request, response) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('missing test server address')
    options.expectedPort = address.port
    const url = `http://127.0.0.1:${address.port}/arkme-self/api/self-role-avatar`
    const headers = { 'Content-Type': 'image/png', 'X-Arkme-Expected-User-Id': '42', 'X-Arkme-File-Name': 'role.png' }
    try {
      const saved = await fetch(url, { method: 'POST', headers, body: tinyPng })
      expect(saved.status).toBe(200)
      const savedBody = await saved.json() as { ok: boolean; value: { avatarRef: string } }
      expect(savedBody.ok).toBe(true)
      expect(savedBody.value.avatarRef).toMatch(/^arkme-self-role-image-v1\./)
      expect(await store.read(42, savedBody.value.avatarRef)).toMatchObject({ mediaType: 'image/png', bytes: tinyPng.byteLength })
      expect(saveSelfRoleAvatar).toHaveBeenCalledOnce()

      activeUserId = 43
      const wrongAccount = await fetch(url, { method: 'POST', headers, body: tinyPng })
      expect(wrongAccount.status).toBe(409)
      expect(await wrongAccount.json()).toMatchObject({ ok: false, error: { code: 'file-account-changed' } })
      expect(saveSelfRoleAvatar).toHaveBeenCalledOnce()

      activeUserId = 42
      const forgedImage = await fetch(url, { method: 'POST', headers, body: Buffer.from('not an image') })
      expect(forgedImage.status).toBe(400)
      expect(await forgedImage.json()).toMatchObject({ ok: false, error: { code: 'self-role-avatar-invalid' } })
      const wrongMediaType = await fetch(url, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: tinyPng,
      })
      expect(wrongMediaType.status).toBe(400)
      const tooLarge = await fetch(url, {
        method: 'POST', headers, body: Buffer.alloc(MAX_SELF_ROLE_AVATAR_BYTES + 1),
      })
      expect(tooLarge.status).toBe(413)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
