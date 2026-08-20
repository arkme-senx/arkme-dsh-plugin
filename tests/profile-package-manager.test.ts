import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareProfilePackageManager } from '../src/profile-package-manager.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture(
  manifest: Record<string, unknown>,
  metadata?: string | Record<string, unknown>,
): { root: string; profile: string; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'arkme-profile-manager-'))
  directories.push(root)
  const profile = join(root, 'profiles', 'web')
  const modules = join(profile, 'node_modules')
  mkdirSync(modules, { recursive: true })
  const manifestPath = join(profile, 'package.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  if (metadata !== undefined) {
    writeFileSync(join(modules, '.modules.yaml'), typeof metadata === 'string' ? metadata : JSON.stringify(metadata))
  }
  return { root, profile, manifestPath }
}

describe('Arkme Profile package manager resolver', () => {
  it('backfills a legacy Profile only from pnpm-owned install metadata', () => {
    const { root, profile, manifestPath } = fixture(
      { name: 'dsh-profile-web', dependencies: { example: '1.0.0' } },
      { packageManager: 'pnpm@11.7.0', storeDir: '/store/v11' },
    )
    const probe = vi.fn(() => '11.7.0')

    expect(prepareProfilePackageManager(root, 'web', { probeVersion: probe })).toEqual({
      declaration: 'pnpm@11.7.0', version: '11.7.0', source: 'install-metadata', profileUpdated: true,
    })
    expect(probe).toHaveBeenCalledWith(profile, process.env)
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
      packageManager: 'pnpm@11.7.0', dependencies: { example: '1.0.0' },
    })
  })

  it('uses an existing exact Profile declaration without replacing it from metadata', () => {
    const { root, manifestPath } = fixture(
      { packageManager: 'pnpm@10.28.2' },
      { packageManager: 'pnpm@11.7.0' },
    )
    expect(prepareProfilePackageManager(root, 'web', { probeVersion: () => '10.28.2' })).toMatchObject({
      declaration: 'pnpm@10.28.2', source: 'profile', profileUpdated: false,
    })
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({ packageManager: 'pnpm@10.28.2' })
  })

  it('supports pnpm YAML metadata without guessing a version', () => {
    const { root } = fixture({}, 'layoutVersion: 5\npackageManager: pnpm@11.7.0\nstoreDir: /store/v11\n')
    expect(prepareProfilePackageManager(root, 'web', { probeVersion: () => '11.7.0' })).toMatchObject({
      declaration: 'pnpm@11.7.0', source: 'install-metadata',
    })
  })

  it('rejects invalid Profile declarations instead of replacing user configuration', () => {
    const { root, manifestPath } = fixture(
      { packageManager: 'pnpm@latest' },
      { packageManager: 'pnpm@11.7.0' },
    )
    expect(() => prepareProfilePackageManager(root, 'web', { probeVersion: () => '11.7.0' }))
      .toThrow(/精确的 pnpm 版本/)
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({ packageManager: 'pnpm@latest' })
  })

  it('fails before a DSH command when the user pnpm does not honor the Profile version', () => {
    const { root } = fixture({}, { packageManager: 'pnpm@11.7.0' })
    expect(() => prepareProfilePackageManager(root, 'web', { probeVersion: () => '10.28.2' }))
      .toThrow(/需要 pnpm 11\.7\.0.*解析为 10\.28\.2/)
  })

  it('does not invent a version when both official sources are absent', () => {
    const { root, manifestPath } = fixture({ name: 'dsh-profile-web' })
    expect(() => prepareProfilePackageManager(root, 'web', { probeVersion: () => '11.7.0' }))
      .toThrow(/没有可回填的版本/)
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({ name: 'dsh-profile-web' })
  })
})
