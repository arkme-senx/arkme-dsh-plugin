import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeOwnedExtensionStore } from '../../src/extensions/owned-store.js'
import { scanOwnedProfileExtensions } from '../../src/extensions/profile-owned-inventory.js'
import { packLocalBundleDirectory } from '../../src/extensions/bundle-artifact.js'

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function writeBundle(directory: string, name: string, version = '1.0.0'): void {
  const prefix = createHash('sha256').update(name).digest('hex').slice(0, 16)
  writeJson(join(directory, 'package.json'), {
    name, version, description: `${name} description`,
    files: ['lib', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  mkdirSync(join(directory, 'lib'), { recursive: true })
  writeFileSync(join(directory, 'lib', 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(directory, 'cordis.patch.yml'), [
    '- insert:', `    - id: arkme-${prefix}-main`, `      name: '${name}'`, '',
  ].join('\n'))
}

describe('Profile-owned extension inventory', () => {
  it('admits local bundles while excluding DSH official, remote, and third-party Arkme wrappers', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme profile with spaces '))
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'My Local Weather')
    const officialLocal = join(root, 'DSH Official Local')
    const tarballSource = join(root, 'Tarball Source')
    const wrapper = join(profile, 'arkme-extensions', 'third-party', '1.0.0')
    writeBundle(local, 'local-weather')
    writeBundle(tarballSource, 'local-tarball')
    writeFileSync(join(root, 'local-plugin.tgz'), packLocalBundleDirectory(tarballSource).bundle.bytes)
    writeBundle(officialLocal, '@deepseek-ai/dsh-official-local')
    writeBundle(wrapper, '@arkme-local/ext-aaaaaaaaaaaaaaaa')
    writeJson(join(wrapper, 'installation.json'), { extension_id: 'ext-third-party' })
    writeJson(join(profile, 'package.json'), {
      name: 'dsh-profile-web',
      dependencies: {
        'local-weather': 'link:../../My Local Weather',
        '@deepseek-ai/dsh-official-local': 'link:../../DSH Official Local',
        'remote-extension': '^1.0.0',
        'local-tarball': 'file:../../local-plugin.tgz',
        '@arkme-local/ext-aaaaaaaaaaaaaaaa': 'link:arkme-extensions/third-party/1.0.0',
      },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-official-local',
        'local-weather', '@arkme-local/ext-aaaaaaaaaaaaaaaa',
      ] } },
    })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))

    const result = scanOwnedProfileExtensions({
      profileDirectory: profile, profileName: 'web', userId: 7, cloudOwnedExtensionIds: new Set(), store,
    })

    expect(result.items).toMatchObject([{
      sourceKey: 'web\0local-weather', packageName: 'local-weather', version: '1.0.0',
      name: 'local-weather', description: 'local-weather description', active: true,
      halves: { host: true, client: false }, publishable: true,
    }, {
      sourceKey: 'web\0local-tarball', packageName: 'local-tarball', version: '1.0.0',
      name: 'local-tarball', active: false, publishable: true,
    }])
    expect(result.items.map(item => item.packageName)).not.toContain('@deepseek-ai/dsh-base')
    expect(result.invalidEntries).toBe(0)
    expect(store.owner('profile', 'web\0local-weather')).toBe(7)
    expect(store.owner('profile', 'web\0local-tarball')).toBe(7)
    store.close()
  })

  it('admits an Arkme wrapper only when its cloud extension belongs to the current account', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-wrapper-'))
    const profile = join(root, 'profiles', 'web')
    const wrapper = join(profile, 'arkme-extensions', 'owned', '1.0.0')
    writeBundle(wrapper, '@arkme-local/ext-bbbbbbbbbbbbbbbb')
    writeJson(join(wrapper, 'installation.json'), { extension_id: 'ext-owned' })
    writeJson(join(profile, 'package.json'), {
      dependencies: { '@arkme-local/ext-bbbbbbbbbbbbbbbb': 'link:arkme-extensions/owned/1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@arkme-local/ext-bbbbbbbbbbbbbbbb'] } },
    })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))

    const result = scanOwnedProfileExtensions({
      profileDirectory: profile, profileName: 'web', userId: 7,
      cloudOwnedExtensionIds: new Set(['ext-owned']), store,
    })

    expect(result.items).toMatchObject([{
      packageName: '@arkme-local/ext-bbbbbbbbbbbbbbbb', extensionId: 'ext-owned',
    }])
    store.close()
  })
})
