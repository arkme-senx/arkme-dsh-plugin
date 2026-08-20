import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertExtensionArtifactSize, canonicalExtensionSignatureMessage, packArkmeExtension, unpackArkmeExtension,
} from '../../src/extensions/artifact.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager, verifyExtensionResolutionSignature } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { ARKME_EXTENSION_FORMAT_VERSION, ARKME_EXTENSION_MAX_BYTES } from '../../src/extensions/types.js'
import type { DynamicCordisRunnerLike } from '../../src/extensions/types.js'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arkme-extension-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('.arkext v1 artifact', () => {
  it('packs identical source into deterministic bytes and validates its checksums', () => {
    const input = {
      name: '天气卡片',
      description: '显示天气',
      version: '1.0.0',
      arkmeProviderContract: 1,
      permissions: ['records.search', 'profile.read'],
      hostCode: 'return { name: "weather", apply(ctx) {\r\n  ctx.logger.info("ok")\r\n} }',
      clientCode: 'return { name: "weather-client", apply() {} }',
    }
    const first = packArkmeExtension(input)
    const second = packArkmeExtension(input)

    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true)
    expect(first.artifactSha256).toBe(second.artifactSha256)
    const unpacked = unpackArkmeExtension(first.bytes)
    expect(unpacked.manifest).toEqual(first.manifest)
    expect(unpacked.hostCode).not.toContain('\r')
    expect(JSON.parse(unpacked.files.get('checksums.json')!.toString('utf8'))).toEqual({
      files: {
        'client.js': expect.stringMatching(/^[a-f0-9]{64}$/),
        'host.js': expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
  })

  it('uses the exact 100 MiB boundary without allocating a 100 MiB fixture', () => {
    expect(() => { assertExtensionArtifactSize(ARKME_EXTENSION_MAX_BYTES) }).not.toThrow()
    expect(() => { assertExtensionArtifactSize(ARKME_EXTENSION_MAX_BYTES + 1) }).toThrow('100 MiB')
  })

  it('reports streamed download bytes and the declared total', async () => {
    const progress: Array<{ downloadedBytes: number; totalBytes?: number }> = []
    const client = new ExtensionPublishClient(async () => { throw new Error('not used') }, async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.enqueue(new Uint8Array([3, 4, 5]))
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Length': '5' } })
    })

    const bytes = await client.downloadArtifact(
      'https://objects.test/ext.arkext',
      {},
      undefined,
      item => { progress.push(item) },
    )

    expect([...bytes]).toEqual([1, 2, 3, 4, 5])
    expect(progress).toEqual([
      { downloadedBytes: 0, totalBytes: 5 },
      { downloadedBytes: 2, totalBytes: 5 },
      { downloadedBytes: 5, totalBytes: 5 },
    ])
  })
})

describe('extension signature and runtime bridge', () => {
  it('verifies the fixed canonical Ed25519 envelope and rejects tampering', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const resolution = {
      format_version: ARKME_EXTENSION_FORMAT_VERSION,
      extension_id: 'ext_weather',
      version: '1.0.0',
      artifact_sha256: 'a'.repeat(64),
      manifest_sha256: 'b'.repeat(64),
      published_at: 1_787_000_000_000,
      signing_key_id: 'test-key-1',
    }
    const signature = sign(null, canonicalExtensionSignatureMessage(resolution), privateKey).toString('base64')
    const trusted = new Map([['test-key-1', publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]])

    expect(() => { verifyExtensionResolutionSignature({ ...resolution, signature }, trusted) }).not.toThrow()
    expect(() => {
      verifyExtensionResolutionSignature({ ...resolution, artifact_sha256: 'c'.repeat(64), signature }, trusted)
    }).toThrow('签名验证失败')

    const rawTrusted = new Map([['test-key-1', publicKey.export({ format: 'jwk' }).x!]])
    expect(() => { verifyExtensionResolutionSignature({ ...resolution, signature }, rawTrusted) }).not.toThrow()
  })

  it('recovers publish completion through the idempotent status endpoint', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const uploads: string[] = []
    const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      requests.push({ path, body })
      if (path.endsWith('/create')) return {
        publish_session_id: 'pub-1', extension_id: 'ext-1', status: 'uploading',
        bundle_upload: { url: 'https://objects.test/bundle', method: 'PUT', headers: {}, expires_at: 'soon' },
        source_upload: { url: 'https://objects.test/source', method: 'PUT', headers: {}, expires_at: 'soon' },
      } as T
      if (path.endsWith('/complete')) throw new Error('connection dropped after commit')
      if (path.endsWith('/status')) return { extension_id: 'ext-1', version: '1.0.0', status: 'published' } as T
      throw new Error(`unexpected ${path}`)
    }
    const client = new ExtensionPublishClient(post, async (input, init) => {
      expect(init?.method).toBe('PUT')
      uploads.push(String(input))
      return new Response('', { status: 200 })
    })
    const directory = temporaryDirectory()
    const store = new ArkmeExtensionInstallStore(directory)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: (_agent, pluginId, packageId) => ({
        pluginId, packageId, name: '插件', purpose: '用途', code: { host: 'return { name: "x", apply() {} }' },
      }),
      define: () => { throw new Error('not used') },
      run: async () => { throw new Error('not used') },
    }, { artifactDirectory: join(directory, 'artifacts'), trustedSigningKeys: '{}' })

    const result = await manager.publish({
      agent: { id: 'session-1' }, pluginId: 'plug-1', packageId: 'pkg-1', name: '插件', description: '用途',
      version: '1.0.0', visibility: 'public', idempotencyKey: 'same-key',
    })
    expect(result.status).toBe('published')
    expect(requests.map(item => item.path)).toEqual([
      '/api/v1/extensions/publish-session/create',
      '/api/v1/extensions/publish-session/complete',
      '/api/v1/extensions/publish-session/status',
    ])
    expect(uploads).toEqual(['https://objects.test/bundle', 'https://objects.test/source'])
    expect(requests[0]?.body.idempotency_key).toBe('same-key')
    expect(requests[0]?.body).toMatchObject({
      artifact_contract_version: 2,
      artifact_kind: 'dsh-bundle-tgz',
      execution_model: 'arkme-sandboxed',
      package_name: expect.stringMatching(/^@arkme-generated\/[a-f0-9]{24}$/),
      bundle_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      source_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    store.close()
  })

  it('returns an already-published Bundle session without attempting another upload', async () => {
    const requests: string[] = []
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 })) as typeof fetch
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      requests.push(path)
      return {
        publish_session_id: 'pub-existing', extension_id: 'ext-existing', version: '1.0.0',
        status: 'published', idempotent_replay: true,
      } as T
    }, fetchImpl)
    const directory = temporaryDirectory()
    const store = new ArkmeExtensionInstallStore(directory)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: (_agent, pluginId, packageId) => ({
        pluginId, packageId, name: '插件', purpose: '用途', code: { host: 'return { apply() {} }' },
      }),
      define: () => { throw new Error('not used') }, run: async () => { throw new Error('not used') },
    }, { artifactDirectory: join(directory, 'artifacts'), trustedSigningKeys: '{}' })

    await expect(manager.publish({
      agent: {}, pluginId: 'plug-1', packageId: 'pkg-1', name: '插件', description: '用途',
      version: '1.0.0', visibility: 'private', idempotencyKey: 'bundle-existing-publish',
    })).resolves.toMatchObject({ extension_id: 'ext-existing', version: '1.0.0', status: 'published' })
    expect(requests).toEqual(['/api/v1/extensions/publish-session/create'])
    expect(fetchImpl).not.toHaveBeenCalled()
    store.close()
  })

  it('soft deletes an exact owned extension through the authenticated registry client', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const client = new ExtensionPublishClient(async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      requests.push({ path, body })
      return { extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123 } as T
    })
    const directory = temporaryDirectory()
    const store = new ArkmeExtensionInstallStore(directory)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: () => { throw new Error('not used') },
      define: () => { throw new Error('not used') },
      run: async () => { throw new Error('not used') },
    }, { artifactDirectory: join(directory, 'artifacts'), trustedSigningKeys: '{}' })

    await expect(manager.delete('ext-owned')).resolves.toEqual({
      extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123,
    })
    expect(requests).toEqual([{
      path: '/api/v1/extensions/delete', body: { extension_id: 'ext-owned' },
    }])
    store.close()
  })
})
