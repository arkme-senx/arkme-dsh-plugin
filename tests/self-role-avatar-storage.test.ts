import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SelfRoleAvatarStore } from '../src/self-role-avatar-store.js'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h5kAAAAASUVORK5CYII=',
  'base64',
)

describe('local self-role avatar storage', () => {
  it('keeps image bytes through restart without making them visible to another account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-store-'))
    try {
      const store = new SelfRoleAvatarStore(directory)
      const ref = await store.save(42, tinyPng, 'image/png')
      expect(ref).toMatch(/^arkme-self-role-image-v1\.[0-9a-f-]{36}$/)
      expect(await store.exists(42, ref)).toBe(true)
      expect(await store.exists(43, ref)).toBe(false)
      await expect(store.read(43, ref)).rejects.toThrow()

      const reopened = new SelfRoleAvatarStore(directory)
      const image = await reopened.read(42, ref)
      expect(image.mediaType).toBe('image/png')
      expect(image.bytes).toBe(tinyPng.byteLength)
      expect(Buffer.from(image.data)).toEqual(tinyPng)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects malformed references and enforces the requested read size limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-store-'))
    try {
      const store = new SelfRoleAvatarStore(directory)
      const ref = await store.save(42, tinyPng, 'image/png')
      expect(await store.exists(42, 'arkme-self-role-image-v1.../secret')).toBe(false)
      expect(await store.exists(42, 'file_asset://cloud-only')).toBe(false)
      await expect(store.read(42, 'arkme-self-role-image-v1.../secret')).rejects.toThrow()
      await expect(store.read(42, ref, 8)).rejects.toThrow()
      await expect(store.read(42, ref)).resolves.toMatchObject({ bytes: tinyPng.byteLength })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
