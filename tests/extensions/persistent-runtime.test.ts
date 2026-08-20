import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalExtensionSignatureMessage, packArkmeExtension } from '../../src/extensions/artifact.js'
import {
  activatePersistentArkmeExtension, applyPersistentArkmeHostExtension, deactivatePersistentArkmeExtension,
  persistentArkmeExtensionActive,
} from '../../src/extensions/persistent-runtime.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('persistent extension Host runtime', () => {
  it('re-verifies the signed artifact before mounting its guarded Cordis plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-persistent-runtime-'))
    directories.push(root)
    const artifact = packArkmeExtension({
      name: '永久扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
      hostCode: 'return { name: "persistent-test", apply() {} }',
    })
    const artifactPath = join(root, 'extension.arkext')
    writeFileSync(artifactPath, artifact.bytes)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const envelope = {
      format_version: 1 as const, extension_id: 'ext_test', version: '1.0.0',
      artifact_sha256: artifact.artifactSha256, manifest_sha256: artifact.manifestSha256,
      published_at: 1_787_000_000_000, signing_key_id: 'key-1',
    }
    const installationPath = join(root, 'installation.json')
    writeFileSync(installationPath, JSON.stringify({
      ...envelope,
      artifact_path: artifactPath,
      trusted_public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      signature: sign(null, canonicalExtensionSignatureMessage(envelope), privateKey).toString('base64'),
    }))
    const plugin = vi.fn(async () => undefined)
    const effect = vi.fn(() => undefined)
    await applyPersistentArkmeHostExtension({ plugin, effect } as never, pathToFileURL(installationPath))
    expect(plugin).toHaveBeenCalledOnce()
    expect(effect).toHaveBeenCalledTimes(2)
  })

  it('retains the wrapper context so a Host-only extension can hot stop and hot start', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-persistent-runtime-toggle-'))
    directories.push(root)
    const artifact = packArkmeExtension({
      name: '热切换扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
      hostCode: 'return { name: "persistent-toggle", apply() {} }',
    })
    const artifactPath = join(root, 'extension.arkext')
    writeFileSync(artifactPath, artifact.bytes)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const envelope = {
      format_version: 1 as const, extension_id: 'ext_toggle', version: '1.0.0',
      artifact_sha256: artifact.artifactSha256, manifest_sha256: artifact.manifestSha256,
      published_at: 1_787_000_000_000, signing_key_id: 'key-1',
    }
    const installationPath = join(root, 'installation.json')
    writeFileSync(installationPath, JSON.stringify({
      ...envelope,
      artifact_path: artifactPath,
      trusted_public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      signature: sign(null, canonicalExtensionSignatureMessage(envelope), privateKey).toString('base64'),
    }))
    const dispose = vi.fn(async () => undefined)
    const fiber = { dispose, then: (resolve: (value: unknown) => void) => { resolve(undefined) } }
    const plugin = vi.fn(() => fiber)
    await applyPersistentArkmeHostExtension({ plugin, effect: vi.fn() } as never, pathToFileURL(installationPath))
    expect(persistentArkmeExtensionActive('ext_toggle')).toBe(true)
    await deactivatePersistentArkmeExtension('ext_toggle')
    expect(dispose).toHaveBeenCalledOnce()
    expect(persistentArkmeExtensionActive('ext_toggle')).toBe(false)
    await expect(activatePersistentArkmeExtension('ext_toggle')).resolves.toBe(true)
    expect(plugin).toHaveBeenCalledTimes(2)
    await deactivatePersistentArkmeExtension('ext_toggle')
  })

  it('keeps a disabled extension dormant when DSH composes its Bundle again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-persistent-runtime-disabled-'))
    directories.push(root)
    const artifact = packArkmeExtension({
      name: '关闭扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
      hostCode: 'return { name: "persistent-disabled", apply() {} }',
    })
    const artifactPath = join(root, 'extension.arkext')
    writeFileSync(artifactPath, artifact.bytes)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const envelope = {
      format_version: 1 as const, extension_id: 'ext_disabled', version: '1.0.0',
      artifact_sha256: artifact.artifactSha256, manifest_sha256: artifact.manifestSha256,
      published_at: 1_787_000_000_000, signing_key_id: 'key-1',
    }
    const installationPath = join(root, 'installation.json')
    writeFileSync(installationPath, JSON.stringify({
      ...envelope, artifact_path: artifactPath,
      trusted_public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      signature: sign(null, canonicalExtensionSignatureMessage(envelope), privateKey).toString('base64'),
    }))
    writeFileSync(join(root, 'activation.json'), JSON.stringify({
      schema_version: 1, extension_id: 'ext_disabled', enabled: false,
    }))
    const plugin = vi.fn()
    await applyPersistentArkmeHostExtension({ plugin, effect: vi.fn() } as never, pathToFileURL(installationPath))
    expect(plugin).not.toHaveBeenCalled()
    expect(persistentArkmeExtensionActive('ext_disabled')).toBe(false)
  })
})
