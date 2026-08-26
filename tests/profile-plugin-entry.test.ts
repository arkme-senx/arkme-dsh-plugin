import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detachManagedProfilePluginLink } from '../src/profile-plugin-entry.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })))
})

describe('detachManagedProfilePluginLink', () => {
  it('detaches a legacy junction without changing its target', async () => {
    const fixture = await createFixture()
    const target = join(fixture.root, 'installed-app-plugin')
    const sentinel = join(target, 'sentinel.txt')
    await mkdir(target, { recursive: true })
    await writeFile(sentinel, 'preserved')
    await mkdir(join(fixture.pluginPath, '..'), { recursive: true })
    await symlink(target, fixture.pluginPath, 'junction')

    await expect(detachManagedProfilePluginLink({
      dshHome: fixture.dshHome,
      profileName: 'web',
    })).resolves.toBe('detached')

    await expect(lstat(fixture.pluginPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserved')
    await expect(detachManagedProfilePluginLink({
      dshHome: fixture.dshHome,
      profileName: 'web',
    })).resolves.toBe('missing')
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserved')
  })

  it('leaves a physical plugin directory for the package manager to remove', async () => {
    const fixture = await createFixture()
    await mkdir(fixture.pluginPath, { recursive: true })

    await expect(detachManagedProfilePluginLink({
      dshHome: fixture.dshHome,
      profileName: 'web',
    })).resolves.toBe('directory')
    expect((await lstat(fixture.pluginPath)).isDirectory()).toBe(true)
  })

  it('returns missing when no managed plugin entry exists', async () => {
    const fixture = await createFixture()

    await expect(detachManagedProfilePluginLink({
      dshHome: fixture.dshHome,
      profileName: 'web',
    })).resolves.toBe('missing')
  })

  it.each(['', '.', '..', '../web', 'nested/web', 'nested\\web'])(
    'rejects unsafe profile name %j',
    async profileName => {
      const fixture = await createFixture()
      await expect(detachManagedProfilePluginLink({
        dshHome: fixture.dshHome,
        profileName,
      })).rejects.toThrow('single path segment')
    },
  )

  it('rejects a non-directory, non-link plugin entry', async () => {
    const fixture = await createFixture()
    await mkdir(join(fixture.pluginPath, '..'), { recursive: true })
    await writeFile(fixture.pluginPath, 'unexpected')

    await expect(detachManagedProfilePluginLink({
      dshHome: fixture.dshHome,
      profileName: 'web',
    })).rejects.toThrow('neither a link nor a directory')
  })
})

async function createFixture(): Promise<{
  root: string
  dshHome: string
  pluginPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'profile-plugin-entry-'))
  temporaryDirectories.push(root)
  const dshHome = join(root, 'dsh')
  return {
    root,
    dshHome,
    pluginPath: join(
      dshHome,
      'profiles',
      'web',
      'node_modules',
      '@senguoyun',
      'dsh-arkme',
    ),
  }
}
