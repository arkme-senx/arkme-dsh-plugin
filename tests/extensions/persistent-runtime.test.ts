import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalExtensionSignatureMessage, packArkmeExtension } from '../../src/extensions/artifact.js'
import {
  applyPersistentArkmeHostExtension,
  deactivatePersistentArkmeExtension,
  persistentArkmeExtensionActive,
} from '../../src/extensions/persistent-runtime.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function signedInstallation(input: {
  extensionId: string
  hostCode?: string
  clientCode?: string
  invalidSignature?: boolean
}): URL {
  const root = mkdtempSync(join(tmpdir(), 'arkme-persistent-runtime-'))
  directories.push(root)
  const artifact = packArkmeExtension({
    name: '永久扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
    ...(input.hostCode === undefined ? {} : { hostCode: input.hostCode }),
    ...(input.clientCode === undefined ? {} : { clientCode: input.clientCode }),
  })
  const artifactPath = join(root, 'extension.arkext')
  writeFileSync(artifactPath, artifact.bytes)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const envelope = {
    format_version: 1 as const, extension_id: input.extensionId, version: '1.0.0',
    artifact_sha256: artifact.artifactSha256, manifest_sha256: artifact.manifestSha256,
    published_at: 1_787_000_000_000, signing_key_id: 'key-1',
  }
  const installationPath = join(root, 'installation.json')
  writeFileSync(installationPath, JSON.stringify({
    ...envelope,
    artifact_path: artifactPath,
    trusted_public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    signature: input.invalidSignature
      ? Buffer.alloc(64).toString('base64')
      : sign(null, canonicalExtensionSignatureMessage(envelope), privateKey).toString('base64'),
  }))
  return pathToFileURL(installationPath)
}

function runtimeContext() {
  const cleanups: Array<() => void> = []
  const plugin = vi.fn(async () => undefined)
  const effect = vi.fn((factory: () => () => void) => { cleanups.push(factory()) })
  return { cleanups, context: { plugin, effect } as never, effect, plugin }
}

describe('persistent extension Host runtime', () => {
  it('re-verifies the signed artifact before mounting its guarded Cordis plugin', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_host_verified',
      hostCode: 'return { name: "persistent-test", apply() {} }',
    })
    const runtime = runtimeContext()

    await applyPersistentArkmeHostExtension(runtime.context, installation)

    expect(runtime.plugin).toHaveBeenCalledOnce()
    expect(runtime.effect).toHaveBeenCalledTimes(2)
    expect(persistentArkmeExtensionActive('ext_host_verified')).toBe(true)
    for (const cleanup of runtime.cleanups) cleanup()
    expect(persistentArkmeExtensionActive('ext_host_verified')).toBe(false)
  })

  it('marks a verified Client-only bundle active after its loader entry is applied', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_client_only',
      clientCode: 'return { apply() {} }',
    })
    const runtime = runtimeContext()

    await applyPersistentArkmeHostExtension(runtime.context, installation)

    expect(runtime.plugin).not.toHaveBeenCalled()
    expect(persistentArkmeExtensionActive('ext_client_only')).toBe(true)
    for (const cleanup of runtime.cleanups) cleanup()
    expect(persistentArkmeExtensionActive('ext_client_only')).toBe(false)
  })

  it('does not publish Client-only active state when lifecycle registration fails', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_client_effect_failure',
      clientCode: 'return { apply() {} }',
    })
    const effect = vi.fn(() => { throw new Error('INACTIVE_EFFECT') })

    await expect(applyPersistentArkmeHostExtension(
      { plugin: vi.fn(), effect } as never,
      installation,
    )).rejects.toThrow('INACTIVE_EFFECT')

    expect(persistentArkmeExtensionActive('ext_client_effect_failure')).toBe(false)
  })

  it('keeps a newer same-ID Client activation when the older loader cleans up', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_client_reloaded',
      clientCode: 'return { apply() {} }',
    })
    const older = runtimeContext()
    const newer = runtimeContext()

    await applyPersistentArkmeHostExtension(older.context, installation)
    await applyPersistentArkmeHostExtension(newer.context, installation)
    for (const cleanup of older.cleanups) cleanup()

    expect(persistentArkmeExtensionActive('ext_client_reloaded')).toBe(true)
    for (const cleanup of newer.cleanups) cleanup()
    expect(persistentArkmeExtensionActive('ext_client_reloaded')).toBe(false)
  })

  it('clears a Client-only active claim on explicit deactivation', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_client_deactivated',
      clientCode: 'return { apply() {} }',
    })
    const runtime = runtimeContext()
    await applyPersistentArkmeHostExtension(runtime.context, installation)

    await deactivatePersistentArkmeExtension('ext_client_deactivated')

    expect(persistentArkmeExtensionActive('ext_client_deactivated')).toBe(false)
  })

  it('never marks an invalidly signed Client-only artifact active', async () => {
    const installation = signedInstallation({
      extensionId: 'ext_client_invalid',
      clientCode: 'return { apply() {} }',
      invalidSignature: true,
    })
    const runtime = runtimeContext()

    await expect(applyPersistentArkmeHostExtension(runtime.context, installation)).rejects.toThrow()

    expect(persistentArkmeExtensionActive('ext_client_invalid')).toBe(false)
  })
})
