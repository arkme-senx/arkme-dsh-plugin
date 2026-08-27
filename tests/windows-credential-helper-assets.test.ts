import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const verifierPath = join(projectRoot, 'scripts', 'verify-windows-credential-helper.mjs')
const assetDirectory = join(projectRoot, 'assets', 'windows')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('Windows credential helper assets', () => {
  it('accepts the committed helper and manifest', async () => {
    await expect(execFileAsync(process.execPath, [verifierPath, assetDirectory])).resolves.toMatchObject({
      stderr: '',
    })
  })

  it('rejects a helper whose bytes do not match the manifest', async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'arkme-credential-helper-'))
    temporaryDirectories.push(fixtureDirectory)
    await Promise.all([
      copyFile(join(assetDirectory, 'arkme-credential-helper.exe'), join(fixtureDirectory, 'arkme-credential-helper.exe')),
      copyFile(join(assetDirectory, 'manifest.json'), join(fixtureDirectory, 'manifest.json')),
    ])
    const helperPath = join(fixtureDirectory, 'arkme-credential-helper.exe')
    const helper = await readFile(helperPath)
    helper[0] ^= 0xff
    await writeFile(helperPath, helper)

    await expect(execFileAsync(process.execPath, [verifierPath, fixtureDirectory])).rejects.toMatchObject({
      stderr: expect.stringContaining('checksum mismatch'),
    })
  })

  it('rejects a manifest that was built from different helper sources', async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'arkme-credential-helper-source-'))
    temporaryDirectories.push(fixtureDirectory)
    await Promise.all([
      copyFile(join(assetDirectory, 'arkme-credential-helper.exe'), join(fixtureDirectory, 'arkme-credential-helper.exe')),
      copyFile(join(assetDirectory, 'manifest.json'), join(fixtureDirectory, 'manifest.json')),
    ])
    const manifestPath = join(fixtureDirectory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.sourceSha256 = '0'.repeat(64)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(execFileAsync(process.execPath, [verifierPath, fixtureDirectory])).rejects.toMatchObject({
      stderr: expect.stringContaining('source checksum mismatch'),
    })
  })
})
