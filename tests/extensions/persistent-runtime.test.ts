import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalExtensionSignatureMessage, packArkmeExtension } from '../../src/extensions/artifact.js'
import { applyPersistentArkmeHostExtension } from '../../src/extensions/persistent-runtime.js'

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
})
