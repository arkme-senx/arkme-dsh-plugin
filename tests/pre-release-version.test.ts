import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  derivePreReleaseVersion,
  preparePreReleaseVersion,
} from '../scripts/prepare-runtime-version.mjs'

describe('pre-release runtime version', () => {
  it('derives the next patch prerelease from a stable package version', () => {
    expect(derivePreReleaseVersion('0.1.34', '128')).toBe('0.1.35-pre.128')
    expect(derivePreReleaseVersion('1.9.99', 7)).toBe('1.9.100-pre.7')
  })

  it.each([
    ['0.1.34-pre.1', 128],
    ['0.1.34+build.1', 128],
    ['v0.1.34', 128],
    ['0.1.34', 0],
    ['0.1.34', -1],
    ['0.1.34', '1.5'],
  ])('rejects a non-stable base or invalid run number: %s / %s', (version, runNumber) => {
    expect(() => derivePreReleaseVersion(version, runNumber)).toThrow()
  })

  it('updates only the temporary package manifest and returns the derived version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-pre-release-version-'))
    const packagePath = join(root, 'package.json')
    try {
      await writeFile(packagePath, `${JSON.stringify({
        name: '@senguoyun/dsh-arkme',
        version: '0.1.34',
        privateField: 'preserved',
        arkme: { updateNotice: { title: 'Arkme 插件 0.1.34 更新', summary: 'summary' } },
      }, null, 2)}\n`)

      const version = await preparePreReleaseVersion({ packagePath, runNumber: 128 })

      expect(version).toBe('0.1.35-pre.128')
      expect(JSON.parse(await readFile(packagePath, 'utf8'))).toEqual({
        name: '@senguoyun/dsh-arkme',
        version: '0.1.35-pre.128',
        privateField: 'preserved',
        arkme: { updateNotice: { title: 'Arkme 插件 0.1.35-pre.128 更新', summary: 'summary' } },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
