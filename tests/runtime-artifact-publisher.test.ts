import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  publishRuntimeArtifact,
  requestBackendJSON,
  uploadRuntimeObject,
} from '../scripts/publish-runtime-artifact.mjs'

const roots: string[] = []
const sourceSHA = '0123456789012345678901234567890123456789'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function artifactFixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme-runtime-publisher-'))
  roots.push(root)
  const version = '0.1.35-pre.128'
  const file = `dsh-arkme-${version}.tar.zst`
  const bytes = Buffer.from('runtime-artifact')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, file), bytes)
  await writeFile(join(root, 'artifact-metadata.json'), JSON.stringify({
    schemaVersion: 1,
    component: 'arkme-plugin',
    name: '@senguoyun/dsh-arkme',
    version,
    file,
    sha256,
    size: bytes.length,
    unpackedSize: 100,
    requiredEntries: ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js'],
  }))
  return { root, version, file, sha256 }
}

describe('runtime artifact publisher', () => {
  it('gets exact-object STS, uploads, creates, polls, and activates without exposing credentials', async () => {
    const fixture = await artifactFixture()
    const calls: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const objectKey = `app/arkme/test/plugin/${fixture.version}/${fixture.sha256}/${fixture.file}`
    const responses = [
      {
        bucket: 'arkme-release-bucket',
        upload_endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        object_key: objectKey,
        public_url: `https://d.jiwo.cc/${objectKey}`,
        credentials: {
          expiration: '2026-08-31T12:00:00Z',
          access_key_id: 'temporary-ak',
          access_key_secret: 'temporary-sk',
          security_token: 'temporary-token',
        },
      },
      { version: { id: 'version-1', status: 'validating' }, reused: false },
      { id: 'version-1', status: 'ready' },
      { component: 'arkme-plugin', version_id: 'version-1', version_code: 9, already_current: false },
    ]
    const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url: String(url), init, body })
      return new Response(JSON.stringify(responses.shift()), { status: init.method === 'POST' ? 201 : 200 })
    }
    const uploads: unknown[] = []
    const masks: string[] = []

    const result = await publishRuntimeArtifact({
      artifactDirectory: fixture.root,
      backendBaseURL: 'https://backend.example.com',
      secret: 'publisher-secret',
      sourceSHA,
      notes: 'pre-release build',
    }, {
      fetchImpl,
      createOSSClient: clientOptions => ({
        put: async (key, filePath, uploadOptions) => uploads.push({
          client: {
            bucket: clientOptions.bucket,
            endpoint: clientOptions.endpoint,
            hasCredentials: Boolean(clientOptions.accessKeyId && clientOptions.accessKeySecret && clientOptions.stsToken),
            retryMax: clientOptions.retryMax,
          },
          key,
          filePath,
          upload: uploadOptions,
        }),
      }),
      mask: value => masks.push(value),
      sleep: async () => {},
    })

    expect(result).toEqual({ version: fixture.version, versionId: 'version-1', versionCode: 9, reused: false })
    expect(calls.map(call => call.url)).toEqual([
      'https://backend.example.com/api/public/v1/ci/arkme-plugin/runtime/upload-credentials',
      'https://backend.example.com/api/public/v1/ci/arkme-plugin/runtime/versions',
      'https://backend.example.com/api/public/v1/ci/arkme-plugin/runtime/versions/version-1',
      'https://backend.example.com/api/public/v1/ci/arkme-plugin/runtime/versions/version-1/activate',
    ])
    expect(calls[0].body).toEqual({
      version: fixture.version,
      source_sha: sourceSHA,
      file: fixture.file,
      sha256: fixture.sha256,
      size: 16,
    })
    expect(calls[1].body).toEqual({ ...calls[0].body as object, notes: 'pre-release build' })
    expect(calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer publisher-secret')).toBe(true)
    expect(masks).toEqual(['temporary-ak', 'temporary-sk', 'temporary-token'])
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      client: { hasCredentials: true, retryMax: 0 },
      key: objectKey,
      upload: { headers: {
        'Content-Type': 'application/zstd',
        'x-oss-forbid-overwrite': 'true',
        'x-oss-meta-sha256': fixture.sha256,
        'x-oss-meta-source-sha': sourceSHA,
      } },
    })
    expect(JSON.stringify({ calls, uploads })).not.toContain('temporary-sk')
  })

  it('rejects a changed artifact before requesting credentials', async () => {
    const fixture = await artifactFixture()
    await writeFile(join(fixture.root, fixture.file), 'changed')
    let fetchCalls = 0

    await expect(publishRuntimeArtifact({
      artifactDirectory: fixture.root,
      backendBaseURL: 'https://backend.example.com',
      secret: 'publisher-secret',
      sourceSHA,
      notes: 'pre-release build',
    }, {
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error('must not call Backend')
      },
      createOSSClient: () => { throw new Error('must not create OSS client') },
      mask: () => {},
      sleep: async () => {},
    })).rejects.toThrow('artifact size does not match metadata')
    expect(fetchCalls).toBe(0)
  })

  it('rejects an unsafe object prefix returned by Backend before uploading', async () => {
    const fixture = await artifactFixture()
    const unsafeObjectKey = `app/arkme/../plugin/${fixture.version}/${fixture.sha256}/${fixture.file}`
    let ossClients = 0

    await expect(publishRuntimeArtifact({
      artifactDirectory: fixture.root,
      backendBaseURL: 'https://backend.example.com',
      secret: 'publisher-secret',
      sourceSHA,
      notes: 'pre-release build',
    }, {
      fetchImpl: async () => new Response(JSON.stringify({
        bucket: 'arkme-release-bucket',
        upload_endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        object_key: unsafeObjectKey,
        public_url: `https://d.jiwo.cc/${unsafeObjectKey}`,
        credentials: {
          expiration: '2026-08-31T12:00:00Z',
          access_key_id: 'temporary-ak',
          access_key_secret: 'temporary-sk',
          security_token: 'temporary-token',
        },
      }), { status: 200 }),
      createOSSClient: () => {
        ossClients += 1
        throw new Error('must not create OSS client')
      },
      mask: () => {},
      sleep: async () => {},
    })).rejects.toThrow('Backend returned invalid upload credentials')
    expect(ossClients).toBe(0)
  })

  it('retries network and 5xx failures but not authorization failures', async () => {
    let attempts = 0
    const recovered = await requestBackendJSON('https://backend.example.com/path', {
      method: 'GET', secret: 'secret', fetchImpl: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network unavailable')
        if (attempts === 2) return new Response('{}', { status: 503 })
        return new Response('{"ok":true}', { status: 200 })
      }, sleep: async () => {},
    })
    expect(recovered).toEqual({ ok: true })
    expect(attempts).toBe(3)

    let unauthorizedAttempts = 0
    await expect(requestBackendJSON('https://backend.example.com/path', {
      method: 'GET', secret: 'secret', fetchImpl: async () => {
        unauthorizedAttempts += 1
        return new Response('{"error":"unauthorized"}', { status: 401 })
      }, sleep: async () => {},
    })).rejects.toThrow('HTTP 401 unauthorized')
    expect(unauthorizedAttempts).toBe(1)
  })

  it('retries retryable OSS failures and treats an immutable existing object as idempotent', async () => {
    let attempts = 0
    const client = {
      put: async () => {
        attempts += 1
        if (attempts < 3) throw Object.assign(new Error('temporarily unavailable'), { status: 503 })
        return { ok: true }
      },
    }
    await uploadRuntimeObject(client, 'object-key', '/artifact.tar.zst', {}, { sleep: async () => {} })
    expect(attempts).toBe(3)

    let existingAttempts = 0
    await expect(uploadRuntimeObject({
      put: async () => {
        existingAttempts += 1
        throw Object.assign(new Error('already exists'), { status: 409, code: 'FileAlreadyExists' })
      },
    }, 'object-key', '/artifact.tar.zst', {}, { sleep: async () => {} })).resolves.toEqual({ alreadyExists: true })
    expect(existingAttempts).toBe(1)

    let forbiddenAttempts = 0
    await expect(uploadRuntimeObject({
      put: async () => {
        forbiddenAttempts += 1
        throw Object.assign(new Error('forbidden'), { status: 403 })
      },
    }, 'object-key', '/artifact.tar.zst', {}, { sleep: async () => {} })).rejects.toThrow('forbidden')
    expect(forbiddenAttempts).toBe(1)
  })
})
