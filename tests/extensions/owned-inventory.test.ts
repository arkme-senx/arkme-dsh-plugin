import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeOwnedExtensionInventory, selectPublishPackage } from '../../src/extensions/owned-inventory.js'
import { ArkmeOwnedExtensionRefs } from '../../src/extensions/owned-refs.js'
import { ArkmeOwnedExtensionStore } from '../../src/extensions/owned-store.js'
import { createHash } from 'node:crypto'

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
      publish: { allowed: false, reason: '该扩展已发布' },
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
      items: [{
        states: ['cordis'],
        publish: {
          allowed: true, route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz',
        },
      }], warnings: ['cloud-unavailable'],
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
    expect(page.items[0]?.publish).toMatchObject({
      allowed: true, route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz',
    })

    const result = await inventory.publishCordis({
      ownedRef: page.items[0]!.ownedRef, name: '天气助手', description: '天气', version: '1.0.0',
      visibility: 'private', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    })

    expect(result.status).toBe('published')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      agent, pluginId: 'weather-1', packageId: 'pkg-1',
      packageName: '@arkme-generated/03ff558573117308370085b8',
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(store.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-new')
    store.close()
  })

  it('preflights a Cordis source fingerprint without publishing and detects later code changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-inventory-preflight-'))
    const profile = join(root, 'profiles', 'web')
    writeJson(join(profile, 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const publish = vi.fn(async () => ({ extension_id: 'ext-new', version: '1.0.0', status: 'published' as const }))
    let hostCode = 'return { apply() {} }'
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
        inspectPackage: () => ({
          pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '天气', code: { host: hostCode },
        }),
      },
      agents: { get: () => ({ id: 'session-1' }) },
      publish,
    })
    const page = await inventory.list({ currentSessionId: 'session-1' })
    const input = {
      ownedRef: page.items[0]!.ownedRef,
      name: '天气助手', description: '天气', version: '1.0.0', visibility: 'private' as const,
      clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    }

    const first = await inventory.preparePublish(input)
    const replay = await inventory.preparePublish(input)
    hostCode = 'return { apply() { return true } }'
    const changed = await inventory.preparePublish(input)

    expect(first.input).toEqual(input)
    expect(first).toMatchObject({
      publishRoute: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz',
    })
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(replay.sourceFingerprint).toBe(first.sourceFingerprint)
    expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint)
    expect(publish).not.toHaveBeenCalled()
    store.close()
  })

  it('publishes an owned Profile Bundle without exposing its local directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-owned-local-publish-'))
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'My Local Bundle')
    const packageName = 'local-weather'
    const prefix = createHash('sha256').update(packageName).digest('hex').slice(0, 16)
    writeJson(join(local, 'package.json'), {
      name: packageName, version: '1.0.0', description: '本地天气', files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(local, 'cordis.patch.yml'), [
      '- insert:', `    - id: arkme-${prefix}-main`, `      name: '${packageName}'`, '',
    ].join('\n'))
    mkdirSync(join(local, 'lib'), { recursive: true })
    writeFileSync(join(local, 'lib', 'index.js'), 'export function apply() {}\n')
    writeJson(join(profile, 'package.json'), {
      dependencies: { [packageName]: 'link:../../My Local Bundle' },
      dsh: { profile: { bundles: [packageName] } },
    })
    const store = new ArkmeOwnedExtensionStore(join(root, 'state'))
    const publishBundle = vi.fn(async () => ({ extension_id: 'ext-local', version: '1.0.0', status: 'published' as const }))
    const inventory = new ArkmeOwnedExtensionInventory({
      hostInstanceId: 'instance-1', profileDirectory: profile, profileName: 'web', store,
      refs: new ArkmeOwnedExtensionRefs(), providerState: async () => ({ authStatus: 'authenticated', userId: 7 }),
      cloudList: async () => ({ items: [], total: 0 }),
      runner: { inventory: () => [], inspectPackage: () => { throw new Error('not used') } },
      agents: { get: () => undefined }, publish: async () => { throw new Error('not used') }, publishBundle,
    })

    const page = await inventory.list()
    expect(page.items).toMatchObject([{
      name: packageName, states: ['persisted'], publish: {
        allowed: true, mode: 'new', route: 'profile-native-v3',
        artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz',
      },
    }])
    expect(JSON.stringify(page)).not.toContain(local)

    await expect(inventory.preparePublish({
      ownedRef: page.items[0]!.ownedRef, name: '本地天气', description: '', version: '1.0.0',
      visibility: 'private', clientMutationId: '4df2bb67-dd68-4b6c-8cbf-e3380da55043',
    })).resolves.toMatchObject({
      publishRoute: 'profile-native-v3', artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz',
    })

    const result = await inventory.publish({
      ownedRef: page.items[0]!.ownedRef, name: '本地天气', description: '', version: '1.0.0',
      visibility: 'private', clientMutationId: '15ba6620-9952-4ea4-a34c-89966ad82ec4',
    })

    expect(result.status).toBe('published')
    expect(publishBundle).toHaveBeenCalledWith(expect.objectContaining({
      name: '本地天气', source: expect.objectContaining({
        bundle: expect.objectContaining({ packageName, version: '1.0.0' }),
      }),
    }))
    expect(store.cloudLink('profile', `web\0${packageName}`, 7)).toBe('ext-local')

    await inventory.publish({
      ownedRef: page.items[0]!.ownedRef, extensionId: 'ext-local',
      name: '本地天气', description: '', version: '1.0.0', visibility: 'private',
      clientMutationId: '985c8698-7622-45f3-9ba7-085d4254aa16',
    })
    expect(publishBundle).toHaveBeenLastCalledWith(expect.objectContaining({ extensionId: 'ext-local' }))
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
      cloudList: async () => ({ items: [{ ...cloudItem(), extension_id: 'ext-existing' }], total: 1 }),
      runner: {
        inventory: () => [{
          agentId: 'session-1', pluginId: 'weather-1', currentPackageId: 'pkg-1',
          packages: [{ packageId: 'pkg-1', name: '天气助手', purpose: '天气', hasHostHalf: true, hasClientHalf: false }],
        }],
        inspectPackage: () => ({ pluginId: 'weather-1', packageId: 'pkg-1', name: '天气助手', purpose: '', code: { host: 'return {}' } }),
      },
      agents: { get: () => agent }, publish,
    })

    const page = await inventory.list({ currentSessionId: 'session-1' })
    const source = page.items.find(item => item.states.includes('cordis'))!
    const input = {
      ownedRef: source.ownedRef, extensionId: 'ext-existing',
      name: '天气助手', description: '天气', version: '1.1.0', visibility: 'private',
      clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    } as const
    await expect(inventory.preparePublish({ ...input, extensionId: 'ext-other' }))
      .rejects.toMatchObject({ code: 'extension-target-not-owned' })
    const prepared = await inventory.preparePublish(input)
    await inventory.publish(prepared.input)

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ extensionId: 'ext-existing' }))
    expect(store.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-existing')
    await expect(inventory.preparePublish({ ...input, extensionId: undefined })).resolves.toMatchObject({
      input: expect.objectContaining({ extensionId: 'ext-existing' }),
    })
    await expect(inventory.preparePublish({
      ownedRef: source.ownedRef, extensionId: 'ext-other',
      name: '天气助手', description: '天气', version: '1.2.0', visibility: 'private',
      clientMutationId: 'bc495f57-e44f-439f-a37d-655b712b4394',
    })).rejects.toMatchObject({ code: 'extension-lineage-mismatch' })
    publish.mockResolvedValueOnce({ extension_id: 'ext-other', version: '1.2.0', status: 'published' as const })
    await expect(inventory.publish({ ...input, version: '1.2.0' }))
      .rejects.toMatchObject({ code: 'extension-publish-target-mismatch' })
    expect(store.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-existing')
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
