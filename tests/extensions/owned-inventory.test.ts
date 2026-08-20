import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeOwnedExtensionInventory, selectPublishPackage } from '../../src/extensions/owned-inventory.js'
import { ArkmeOwnedExtensionRefs } from '../../src/extensions/owned-refs.js'
import { ArkmeOwnedExtensionStore } from '../../src/extensions/owned-store.js'

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function profileWithOwnedWrapper(root: string): string {
  const profile = join(root, 'profiles', 'web')
  const wrapper = join(profile, 'arkme-extensions', 'owned', '1.0.0')
  writeJson(join(wrapper, 'package.json'), {
    name: '@arkme-local/ext-aaaaaaaaaaaaaaaa', version: '1.0.0', description: 'cloud description',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(wrapper, 'cordis.patch.yml'), '[]\n')
  writeJson(join(wrapper, 'installation.json'), { extension_id: 'ext-owned' })
  writeJson(join(profile, 'package.json'), {
    dependencies: { '@arkme-local/ext-aaaaaaaaaaaaaaaa': 'link:arkme-extensions/owned/1.0.0' },
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@arkme-local/ext-aaaaaaaaaaaaaaaa',
    ] } },
  })
  return profile
}

function cloudItem() {
  return {
    extension_id: 'ext-owned', name: '天气助手', description: 'cloud description', owner_user_id: 7,
    visibility: 'private' as const, version: '1.0.0', latest_stable_version: '1.0.0',
    manifest: {
      format: 'arkme-cordis-extension' as const, format_version: 1 as const, name: '天气助手', description: 'cloud description',
      version: '1.0.0', runtime: { dsh: '>=0.1.0-rc.7', arkme_provider_contract: 1 },
      halves: { host: true, client: false }, permissions: [], entrypoints: { host: 'host.js' as const },
    },
  }
}

describe('owned extension inventory', () => {
  it('merges explicit Cordis, Profile, and cloud lineage into one safe row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-inventory-'))
    const profileDirectory = profileWithOwnedWrapper(root)
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const sourceKey = 'instance-1\0session-1\0weather-1'
    store.claim('cordis', sourceKey, 7)
    store.linkCloud('cordis', sourceKey, 7, 'ext-owned')
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: 'instance-1', profileDirectory, profileName: 'web', store,
      refs: new ArkmeOwnedExtensionRefs(),
      providerState: async () => ({ authStatus: 'authenticated', userId: 7 }),
      cloudList: async () => ({ items: [cloudItem()], total: 1 }),
      runner: {
        inventory: () => [{
          agentId: 'session-1', pluginId: 'weather-1', currentPackageId: 'pkg-1',
          activeRun: { pluginRunId: 'run-1', packageId: 'pkg-1' },
          packages: [{ packageId: 'pkg-1', name: '天气助手', purpose: 'Cordis description', hasHostHalf: true, hasClientHalf: false }],
        }],
        inspectPackage: () => ({ pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '', code: { host: 'return {}' } }),
      },
      agents: { get: () => ({ id: 'session-1' }) },
      publish: async () => { throw new Error('not used') },
    })

    const page = await inventory.list({ currentSessionId: 'session-1' })

    expect(page.warnings).toEqual([])
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      name: '天气助手', states: ['cordis', 'persisted', 'published'],
      cordis: { packageCount: 1, active: true },
      persisted: { packageName: '@arkme-local/ext-aaaaaaaaaaaaaaaa', active: true },
      published: { extensionId: 'ext-owned', version: '1.0.0', visibility: 'private' },
      publish: { allowed: true, mode: 'version' },
    })
    expect(JSON.stringify(page)).not.toContain(profileDirectory)
    expect(JSON.stringify(page)).not.toContain('session-1')
    expect(JSON.stringify(page)).not.toContain('@deepseek-ai/dsh-base')
    store.close()
  })

  it('keeps Cordis results when the cloud owner is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-inventory-degraded-'))
    const profile = join(root, 'profiles', 'web')
    writeJson(join(profile, 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: 'instance-1', profileDirectory: profile, profileName: 'web', store,
      refs: new ArkmeOwnedExtensionRefs(),
      providerState: async () => ({ authStatus: 'authenticated', userId: 7 }),
      cloudList: async () => { throw new Error('offline') },
      runner: {
        inventory: () => [{
          agentId: 'session-1', pluginId: 'weather-1',
          packages: [{ packageId: 'pkg-1', name: '天气助手', purpose: '天气', hasHostHalf: true, hasClientHalf: false }],
        }],
        inspectPackage: () => ({ pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '', code: { host: 'return {}' } }),
      },
      agents: { get: () => ({ id: 'session-1' }) },
      publish: async () => { throw new Error('not used') },
    })

    await expect(inventory.list({ currentSessionId: 'session-1' })).resolves.toMatchObject({
      items: [{ states: ['cordis'] }], warnings: ['cloud-unavailable'],
    })
    store.close()
  })

  it('publishes the exact referenced Package and records cloud lineage only after success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-inventory-publish-'))
    const profile = join(root, 'profiles', 'web')
    writeJson(join(profile, 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const publish = vi.fn(async () => ({ extension_id: 'ext-new', version: '1.0.0', status: 'published' as const }))
    const agent = { id: 'session-1' }
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: 'instance-1', profileDirectory: profile, profileName: 'web', store,
      refs: new ArkmeOwnedExtensionRefs(),
      providerState: async () => ({ authStatus: 'authenticated', userId: 7 }),
      cloudList: async () => ({ items: [], total: 0 }),
      runner: {
        inventory: () => [{
          agentId: 'session-1', pluginId: 'weather-1', currentPackageId: 'pkg-1',
          packages: [{ packageId: 'pkg-1', name: '天气助手', purpose: '天气', hasHostHalf: true, hasClientHalf: false }],
        }],
        inspectPackage: () => ({ pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '', code: { host: 'return {}' } }),
      },
      agents: { get: id => id === 'session-1' ? agent : undefined },
      publish,
    })
    const page = await inventory.list({ currentSessionId: 'session-1' })

    const result = await inventory.publishCordis({
      ownedRef: page.items[0]!.ownedRef, name: '天气助手', description: '天气', version: '1.0.0',
      visibility: 'private', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    })

    expect(result.status).toBe('published')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      agent, pluginId: 'weather-1', packageId: 'pkg-1', idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(store.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-new')
    store.close()
  })

  it('preserves an explicit owned cloud identity when the Tool publishes a new version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-inventory-tool-publish-'))
    const profile = join(root, 'profiles', 'web')
    writeJson(join(profile, 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const publish = vi.fn(async () => ({ extension_id: 'ext-existing', version: '1.1.0', status: 'published' as const }))
    const agent = { id: 'session-1' }
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: 'instance-1', profileDirectory: profile, profileName: 'web', store,
      refs: new ArkmeOwnedExtensionRefs(), providerState: async () => ({ authStatus: 'authenticated', userId: 7 }),
      cloudList: async () => ({ items: [], total: 0 }),
      runner: {
        inventory: () => [{
          agentId: 'session-1', pluginId: 'weather-1', currentPackageId: 'pkg-1',
          packages: [{ packageId: 'pkg-1', name: '天气助手', purpose: '天气', hasHostHalf: true, hasClientHalf: false }],
        }],
        inspectPackage: () => ({ pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '', code: { host: 'return {}' } }),
      },
      agents: { get: () => agent }, publish,
    })

    await inventory.publishCordisPackage({
      agent, pluginId: 'weather-1', packageId: 'pkg-1', extensionId: 'ext-existing',
      name: '天气助手', description: '天气', version: '1.1.0', visibility: 'private',
      clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    })

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ extensionId: 'ext-existing' }))
    store.close()
  })
})

describe('Cordis publish package selection', () => {
  const packages = [
    { packageId: 'pkg-1', name: 'v1', purpose: '', hasHostHalf: true, hasClientHalf: false },
    { packageId: 'pkg-2', name: 'v2', purpose: '', hasHostHalf: true, hasClientHalf: false },
  ]

  it('prefers the last successful current Package over a failed or pending next Package', () => {
    expect(selectPublishPackage({ packages, currentPackageId: 'pkg-1', nextPackageId: 'pkg-2' })).toBe('pkg-1')
  })

  it('uses the last defined Package when no Package has completed activation', () => {
    expect(selectPublishPackage({ packages, nextPackageId: 'pkg-2' })).toBe('pkg-2')
  })
})
