import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { MediaService } from '../../src/services/media-service.js'

it('persists only confirmation data and retries the same upload after lost complete response and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avatar confirmation '))
  let db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
  const path = join(root, 'image.png')
  await writeFile(path, 'image')
  const session = { userId: 7, accessToken: 'test', refreshToken: 'test' }
  let lose = true
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('prepare-upload')) return { upload_session_uid: 'upload-1', upload_url: 'https://storage.test/upload?signature=secret' }
    if (path.endsWith('complete-upload')) {
      if (lose) { lose = false; throw new Error('complete response lost') }
      return { file_asset_uid: 'asset-1', size: 5, mime_type: 'image/png' }
    }
    throw new Error('Unexpected abort of an uncertain completed upload')
  })
  const put = vi.fn(async (_url: unknown, init: { body: AsyncIterable<Uint8Array> }) => {
    for await (const _ of init.body) { /* Drain the real file stream. */ }
    return new Response(null, { headers: { etag: 'etag' } })
  })
  const media = () => new MediaService({ config: {}, requireSession: async () => session, authenticatedPost: post, fetchImpl: put } as never, {} as never, {} as never, {} as never)
  const options = () => ({ expectedUserId: 7, completionRecovery: {
    read: () => db.selfRoleSync.pendingAvatarCompletion(7, 'local-avatar'),
    save: (completion: Parameters<typeof db.selfRoleSync.saveAvatarCompletion>[2]) => db.selfRoleSync.saveAvatarCompletion(7, 'local-avatar', completion),
  } })
  const metadata = { size: 5, sha256: 'a'.repeat(64), mimeType: 'image/png', fileName: 'avatar.png', fileKind: 1 as const }
  try {
    await expect(media().uploadLocalFile(path, metadata, options())).rejects.toThrow('complete response lost')
    expect(JSON.stringify(db.selfRoleSync.pendingAvatarCompletion(7, 'local-avatar'))).not.toContain('signature')
    expect(db.selfRoleSync.pendingAvatarCompletion(8, 'local-avatar')).toBeUndefined()
    db.close(); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
    const result = await media().uploadLocalFile(path, metadata, options())
    db.selfRoleSync.saveAsset(7, 'local-avatar', result.fileAssetUid)
    expect(post.mock.calls.map(call => call[0])).toEqual(['/api/v1/files/prepare-upload', '/api/v1/files/complete-upload', '/api/v1/files/complete-upload'])
    expect(put).toHaveBeenCalledTimes(1)
    expect(db.selfRoleSync.asset(7, 'local-avatar')).toBe('asset-1')
    expect(db.selfRoleSync.pendingAvatarCompletion(7, 'local-avatar')).toBeUndefined()
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})
