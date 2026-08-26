import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginError } from '../../src/arkme-service.js'
import { packLocalBundleDirectory, packLocalNativeBundleDirectoryV3 } from '../../src/extensions/bundle-artifact.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bundle-publish-client-'))
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@example/client-test', version: '1.0.0', files: ['lib', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: arkme-1c9dfc5f514d310c-main',
    "      name: '@example/client-test'",
    '',
  ].join('\n'))
  writeFileSync(join(root, 'lib', 'index.js'), 'export function apply() {}\n')
  return root
}

describe('Bundle v2 publish client', () => {
  it('does not project an empty legacy manifest into a v2 catalog detail', async () => {
    const client = new ExtensionPublishClient(async <T>(): Promise<T> => ({
      extension: {
        extension_id: 'ext-v2', name: '贪吃蛇游戏3', description: '说明', visibility: 'public',
        latest_stable_version: '1.0.0',
      },
      latest_version: {
        version: '1.0.0', artifact_contract_version: 2, execution_model: 'arkme-sandboxed', permissions: [],
        manifest: {
          format: '', format_version: 0, name: '', description: '', version: '',
          runtime: { dsh: '', arkme_provider_contract: 0 },
          halves: { host: false, client: false }, permissions: null, entrypoints: {},
        },
      },
    } as T))

    const detail = await client.detail('ext-v2')

    expect(detail).toMatchObject({
      extension_id: 'ext-v2', name: '贪吃蛇游戏3', description: '说明', version: '1.0.0',
    })
    expect(detail).not.toHaveProperty('manifest')
  })

  it('projects the V3 contract and native capabilities from detail queries', async () => {
    const client = new ExtensionPublishClient(async <T>(): Promise<T> => ({
      extension: {
        extension_id: 'ext-v3', name: 'Native V3', description: '说明', visibility: 'public',
        latest_stable_version: '2.0.0',
      },
      latest_version: {
        version: '2.0.0', artifact_contract_version: 3, artifact_kind: 'dsh-native-package-tgz',
        execution_model: 'dsh-native', native_capabilities: ['bin', 'runtime_dependencies'],
      },
    } as T))

    await expect(client.detail('ext-v3')).resolves.toMatchObject({
      extension_id: 'ext-v3', version: '2.0.0', artifact_contract_version: 3,
      artifact_kind: 'dsh-native-package-tgz', execution_model: 'dsh-native',
      native_capabilities: ['bin', 'runtime_dependencies'],
    })
  })

  it('creates one dual-upload session and uses the signed content types', async () => {
    const root = fixture()
    try {
      const source = packLocalBundleDirectory(root)
      expect(Buffer.from(source.source.bytes).equals(Buffer.from(source.bundle.bytes))).toBe(true)
      expect(source.source.bytes.byteLength).toBe(source.bundle.bytes.byteLength)
      expect(source.source.sourceSha256).toBe(source.bundle.bundleSha256)
      const requests: Array<{ path: string; body: Record<string, unknown> }> = []
      const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
        requests.push({ path, body })
        return {
          publish_session_id: 'pub-v2', extension_id: 'ext-v2', status: 'uploading',
          bundle_upload: { url: 'https://objects.test/bundle', method: 'PUT', headers: {}, expires_at: 'soon' },
          source_upload: { url: 'https://objects.test/source', method: 'PUT', headers: {}, expires_at: 'soon' },
        } as T
      }
      const uploads: Array<{ url: string; contentType: string }> = []
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        uploads.push({
          url: String(input),
          contentType: new Headers(init?.headers).get('Content-Type') ?? '',
        })
        return new Response('', { status: 200 })
      }) as typeof fetch
      const client = new ExtensionPublishClient(post, fetchImpl)

      const session = await client.createBundlePublishSession({
        name: '客户端测试', description: '', visibility: 'private', idempotency_key: 'bundle-client-test-1',
        bundle: source.bundle, source: source.source,
		listingSource: { type: 'github_repository', url: 'https://github.com/example/client-test' },
      })
      await client.uploadBundle(session.bundle_upload, source.bundle)
      await client.uploadSource(session.source_upload, source.source)

      expect(requests[0]).toMatchObject({
        path: '/api/v1/extensions/publish-session/create',
        body: {
          artifact_contract_version: 2,
          artifact_kind: 'dsh-bundle-tgz',
          package_name: '@example/client-test',
          version: '1.0.0',
          execution_model: 'dsh-native',
          bundle_sha256: source.bundle.bundleSha256,
          bundle_size: source.bundle.bytes.byteLength,
          package_json_sha256: source.bundle.packageJsonSha256,
          source_sha256: source.source.sourceSha256,
          source_size: source.bundle.bytes.byteLength,
			source: { type: 'github_repository', url: 'https://github.com/example/client-test' },
        },
      })
      expect(uploads).toEqual([
        { url: 'https://objects.test/bundle', contentType: 'application/vnd.dsh.bundle+gzip' },
        { url: 'https://objects.test/source', contentType: 'application/vnd.arkme.extension-source+gzip' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates a distinct native V3 session and media type', async () => {
    const root = fixture()
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
      manifest.scripts = { prepare: 'npm run build' }
      manifest.dependencies = { 'left-pad': '1.3.0' }
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
      const source = packLocalNativeBundleDirectoryV3(root)
      const requests: Array<{ path: string; body: Record<string, unknown> }> = []
      const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
        requests.push({ path, body })
        return {
          publish_session_id: 'pub-v3', extension_id: 'ext-v3', status: 'uploading',
          bundle_upload: { url: 'https://objects.test/native', method: 'PUT', headers: {}, expires_at: 'soon' },
          source_upload: { url: 'https://objects.test/source', method: 'PUT', headers: {}, expires_at: 'soon' },
        } as T
      }
      const uploads: Array<{ url: string; contentType: string }> = []
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        uploads.push({ url: String(input), contentType: new Headers(init?.headers).get('Content-Type') ?? '' })
        return new Response('', { status: 200 })
      }) as typeof fetch
      const client = new ExtensionPublishClient(post, fetchImpl)

      const session = await client.createNativeBundlePublishSession({
        name: 'V3 客户端测试', description: '', visibility: 'private', idempotency_key: 'bundle-client-v3-test-1',
        bundle: source.bundle, source: source.source,
      })
      await client.uploadNativeBundle(session.bundle_upload!, source.bundle)
      await client.uploadSource(session.source_upload!, source.source)

      expect(requests[0]).toMatchObject({ body: {
        artifact_contract_version: 3,
        artifact_kind: 'dsh-native-package-tgz',
        execution_model: 'dsh-native',
        package_name: '@example/client-test',
      } })
      expect(uploads).toEqual([
        { url: 'https://objects.test/native', contentType: 'application/vnd.dsh.native-package+gzip' },
        { url: 'https://objects.test/source', contentType: 'application/vnd.arkme.extension-source+gzip' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

	it('rotates an owner share link through the authenticated transport', async () => {
		const post = vi.fn(async () => ({
			ref: 'extshare_0123456789abcdef0123456789abcdef',
			url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef',
		}))
		const client = new ExtensionPublishClient(post)
		await expect(client.rotateShareLink('ext-1', '9f445b4f-55aa-45c1-9250-25161832d432')).resolves.toMatchObject({
			ref: 'extshare_0123456789abcdef0123456789abcdef',
		})
		expect(post).toHaveBeenCalledWith('/api/v1/extensions/share/rotate', {
			extension_id: 'ext-1', client_mutation_id: '9f445b4f-55aa-45c1-9250-25161832d432',
		}, undefined)
	})

	it('resolves a public share target through the authenticated transport', async () => {
		const post = vi.fn(async () => ({ extension_id: 'ext-1' }))
		const client = new ExtensionPublishClient(post)
		await expect(client.resolveSharedCatalogTarget('extshare_0123456789abcdef0123456789abcdef'))
			.resolves.toEqual({ extension_id: 'ext-1' })
		expect(post).toHaveBeenCalledWith('/api/v1/extensions/share/resolve', {
			share_ref: 'extshare_0123456789abcdef0123456789abcdef',
		}, undefined)
	})

  it('marks only upload-pending completion conflicts as retryable', async () => {
    for (const message of ['制品尚未上传完成（服务错误码 40901）', '源码尚未上传完成（服务错误码 40901）']) {
      const client = new ExtensionPublishClient(async (): Promise<never> => {
        throw new ArkmePluginError('arkme-code-40901', message, false, 409, { upstreamStatus: 409 })
      })

      await expect(client.completePublishSession('pub-v2')).rejects.toMatchObject({
        code: 'extension-publish-upload-pending', retryable: true, httpStatus: 409, upstreamStatus: 409,
      })
    }

    const conflict = new ExtensionPublishClient(async (): Promise<never> => {
      throw new ArkmePluginError('arkme-code-40901', '资源状态冲突（服务错误码 40901）', false, 409, { upstreamStatus: 409 })
    })
    await expect(conflict.completePublishSession('pub-v2')).rejects.toMatchObject({
      code: 'arkme-code-40901', retryable: false,
    })
  })

	it.each([
		['arkme-code-40031', 'extension-source-invalid', false],
		['arkme-code-40331', 'extension-source-publisher-forbidden', false],
		['arkme-code-50331', 'extension-source-eligibility-unavailable', true],
		['arkme-code-40931', 'extension-source-conflict', false],
	])('maps source publication error %s to %s', async (upstreamCode, expectedCode, retryable) => {
		const root = fixture()
		try {
			const source = packLocalBundleDirectory(root)
			const client = new ExtensionPublishClient(async (): Promise<never> => {
				throw new ArkmePluginError(upstreamCode, 'registry rejected', retryable, retryable ? 503 : 409)
			})
			await expect(client.createBundlePublishSession({
				name: '来源测试', description: '', visibility: 'private', idempotency_key: 'source-error-test',
				bundle: source.bundle, source: source.source,
				listingSource: { type: 'github_repository', url: 'https://github.com/example/client-test' },
			})).rejects.toMatchObject({ code: expectedCode, retryable })
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it.each([
		['arkme-code-40431', 'extension-share-not-found', false],
		['arkme-code-40932', 'extension-share-rotate-conflict', false],
		['arkme-code-50332', 'extension-share-update-failed', true],
	])('maps share rotation error %s to %s', async (upstreamCode, expectedCode, retryable) => {
		const client = new ExtensionPublishClient(async (): Promise<never> => {
			throw new ArkmePluginError(upstreamCode, 'registry rejected', retryable, retryable ? 503 : 409)
		})
		await expect(client.rotateShareLink('ext-1', '9f445b4f-55aa-45c1-9250-25161832d432'))
			.rejects.toMatchObject({ code: expectedCode, retryable })
	})
})
