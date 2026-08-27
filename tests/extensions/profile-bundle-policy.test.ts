import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyArkmeProfileBundlePolicy } from '../../src/extensions/profile-bundle-policy.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function profileManifest(profileDirectory: string): {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
} {
  return JSON.parse(readFileSync(join(profileDirectory, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
}

describe('Arkme Profile Bundle activation policy', () => {
  it('removes disabled layers while preserving unmanaged order and enabled positions', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme profile policy-'))
    directories.push(root)
    const profileDirectory = join(root, 'profiles', 'web')
    mkdirSync(profileDirectory, { recursive: true })
    writeFileSync(join(profileDirectory, 'package.json'), JSON.stringify({
      dependencies: {
        '@deepseek-ai/dsh-base': '1.0.0',
        'deepseek-pet': '1.0.0',
        'snake-floating': '1.0.0',
        'unmanaged-layer': '1.0.0',
      },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-base', 'deepseek-pet', 'snake-floating', 'unmanaged-layer', 'deepseek-pet',
      ] } },
    }))

    expect(applyArkmeProfileBundlePolicy(profileDirectory, [
      { packageName: 'deepseek-pet', enabled: false },
      { packageName: 'snake-floating', enabled: true },
    ])).toEqual({ changed: true, changedPackages: ['deepseek-pet'] })
    expect(profileManifest(profileDirectory).dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base', 'snake-floating', 'unmanaged-layer',
    ])
  })

  it('removes a stale disabled layer even when its dependency has already disappeared', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-profile-stale-policy-'))
    directories.push(root)
    const profileDirectory = join(root, 'profiles', 'web')
    mkdirSync(profileDirectory, { recursive: true })
    writeFileSync(join(profileDirectory, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh-base': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'deepseek-pet'] } },
    }))

    expect(applyArkmeProfileBundlePolicy(profileDirectory, [
      { packageName: 'deepseek-pet', enabled: false },
    ])).toEqual({ changed: true, changedPackages: ['deepseek-pet'] })
    expect(profileManifest(profileDirectory).dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('rejects enabling a package that is not installed without rewriting the Profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-profile-missing-policy-'))
    directories.push(root)
    const profileDirectory = join(root, 'profiles', 'web')
    mkdirSync(profileDirectory, { recursive: true })
    const manifestPath = join(profileDirectory, 'package.json')
    const original = JSON.stringify({
      dependencies: { '@deepseek-ai/dsh-base': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    writeFileSync(manifestPath, original)

    expect(() => applyArkmeProfileBundlePolicy(profileDirectory, [
      { packageName: 'deepseek-pet', enabled: true },
    ])).toThrow('扩展尚未安装到当前 DSH Profile')
    expect(readFileSync(manifestPath, 'utf8')).toBe(original)
  })
})
