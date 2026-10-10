import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, lstat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishMigrationFile } from '../src/app-migration.js'

// Downloads can permit writes and renames while denying hard links.
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  link: vi.fn(async () => { throw Object.assign(new Error('link denied'), { code: 'EPERM' }) }),
}))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function paths() {
  const root = await mkdtemp(join(tmpdir(), 'migration-publish-')); roots.push(root)
  return { source: join(root, 'download.part'), destination: join(root, "即我 ' 3.0.pkg") }
}
test.skipIf(process.platform !== 'darwin')('publishes without hard links and preserves the file inode', async () => {
  const { source, destination } = await paths()
  await writeFile(source, 'verified bytes')
  const before = await lstat(source)
  await publishMigrationFile(source, destination)
  expect(await readFile(destination, 'utf8')).toBe('verified bytes')
  expect((await lstat(destination)).ino).toBe(before.ino)
  await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
})
test.skipIf(process.platform !== 'darwin').each(['file', 'symlink'])('preserves existing %s without consuming the source', async kind => {
  const { source, destination } = await paths()
  await writeFile(source, 'new')
  if (kind === 'symlink') {
    await writeFile(destination + '-target', 'existing')
    await symlink(destination + '-target', destination)
  } else await writeFile(destination, 'existing')
  await expect(publishMigrationFile(source, destination)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(source, 'utf8')).toBe('new')
  expect(await readFile(destination, 'utf8')).toBe('existing')
})
test.skipIf(process.platform !== 'darwin')('concurrent publishers cannot overwrite the winner', async () => {
  const { source, destination } = await paths()
  const other = source + '-other'
  await writeFile(source, 'first'); await writeFile(other, 'second')
  const results = await Promise.allSettled([publishMigrationFile(source, destination), publishMigrationFile(other, destination)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(r => r.status === 'rejected').map(r => r.reason.code)).toEqual(['EEXIST'])
  expect(['first', 'second']).toContain(await readFile(destination, 'utf8'))
})
