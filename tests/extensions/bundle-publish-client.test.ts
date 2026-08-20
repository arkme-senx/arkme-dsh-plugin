import { describe, expect, it, vi } from 'vitest'
import { packLocalBundleDirectory } from '../../src/extensions/bundle-artifact.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  it('creates one dual-upload session and uses the signed content types', async () => {
    const root = fixture()
    try {
      const source = packLocalBundleDirectory(root)
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
          package_json_sha256: source.bundle.packageJsonSha256,
          source_sha256: source.source.sourceSha256,
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
})
