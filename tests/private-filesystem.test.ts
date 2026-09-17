import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { expect, it } from 'vitest'
import { securePrivateDirectory, securePrivateDirectorySync, securePrivateFile, securePrivateFileSync } from '../src/private-filesystem.js'
import { DshRemoteSessionOwnershipStore } from '../src/dsh-remote/session-ownership-store.js'
import { expectPrivatePath } from './helpers/private-path.js'

it('secures long paths through sync/async owners and persists remote Session ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme-long-path-'))
  const directory = join(root, 'profile with spaces '.repeat(5).trimEnd(), 'runtime '.repeat(16).trimEnd(), 'private-state-cache')
  const path = join(directory, 'state.json')
  const aclPath = (value: string) => process.platform === 'win32' ? win32.toNamespacedPath(value) : value
  try {
    expect(directory.length).toBeGreaterThan(260)
    await mkdir(directory, { recursive: true })
    await writeFile(path, '{}')
    for (const secure of [securePrivateDirectorySync, securePrivateDirectory]) {
      await secure(directory)
      expectPrivatePath(aclPath(directory), 0o700)
    }
    for (const secure of [securePrivateFileSync, securePrivateFile]) {
      await secure(path)
      expectPrivatePath(aclPath(path), 0o600)
    }
    const store = new DshRemoteSessionOwnershipStore(directory, 'web')
    await store.claimUnownedAndListOwned({ accountId: '42', sessionRefs: ['created-session'], origin: 'remote-create' })
    const reopened = new DshRemoteSessionOwnershipStore(directory, 'web')
    await expect(reopened.listOwned('42', ['created-session'])).resolves.toEqual(new Set(['created-session']))
    await expect(reopened.listOwned('43', ['created-session'])).resolves.toEqual(new Set())
  } finally { await rm(root, { recursive: true, force: true }) }
})
