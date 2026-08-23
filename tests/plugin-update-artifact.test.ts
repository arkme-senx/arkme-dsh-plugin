import { createServer } from 'node:http'
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  downloadAndCachePluginArtifact,
  inspectPluginPackageTgz,
  parsePluginUpdateManifest,
} from '../src/plugin-update-artifact.js'
import {
  pluginPackageTgz,
  pluginPackageTgzWithEntryType,
} from './plugin-update-fixtures.js'

async function withArtifactServer(body: Buffer, work: (origin: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.byteLength),
    })
    response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing test server address')
  try {
    await work(`http://127.0.0.1:${String(address.port)}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  }
}

describe('private plugin update artifacts', () => {
  it('downloads a direct HTTPS tgz URL, inspects package metadata, and caches immutably', async () => {
    const artifactBytes = pluginPackageTgz('0.1.11')
    await withArtifactServer(artifactBytes, async origin => {
      const artifactUrl = `${origin.replace('http:', 'https:')}/downloads/dsh-arkme-0.1.11.tgz?signature=temporary`
      const payload = {
        version: '0.1.11',
        releaseNotes: '直接下载测试',
        downloadUrl: artifactUrl,
      }
      const cacheDirectory = await mkdtemp(join(tmpdir(), 'arkme-plugin-cache-'))
      const manifest = parsePluginUpdateManifest(payload, {
        updateServiceOrigin: 'https://api.jotmo.cc',
        artifactOrigin: new URL(artifactUrl).origin,
      })

      const cachedPath = await downloadAndCachePluginArtifact(manifest, {
        cacheDirectory,
        fetchImpl: async input => fetch(String(input).replace('https:', 'http:')),
        requestTimeoutMs: 1_000,
      })

      expect(cachedPath).toBe(join(cacheDirectory, '0.1.11', 'dsh-arkme-0.1.11.tgz'))
      expect(await readFile(cachedPath)).toEqual(artifactBytes)
      expect((await lstat(cachedPath)).isFile()).toBe(true)
      await expect(readFile(join(cacheDirectory, '0.1.11', 'release-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('rejects dangerous tgz entries before cache promotion', () => {
    expect(() => inspectPluginPackageTgz(pluginPackageTgz('0.1.11', new Map([
      ['package/../evil.js', Buffer.from('evil')],
    ])))).toThrowError(expect.objectContaining({ code: 'plugin-update-tgz-path-invalid' }))

    expect(() => inspectPluginPackageTgz(pluginPackageTgzWithEntryType('package/lib/index.js', '2')))
      .toThrowError(expect.objectContaining({ code: 'plugin-update-tgz-entry-type' }))

    const invalidHeader = gunzipSync(pluginPackageTgz('0.1.11'))
    invalidHeader[0] = (invalidHeader[0] ?? 0) ^ 1
    expect(() => inspectPluginPackageTgz(gzipSync(invalidHeader)))
      .toThrowError(expect.objectContaining({ code: 'plugin-update-tgz-checksum-invalid' }))

    const hiddenTrailer = gunzipSync(pluginPackageTgz('0.1.11'))
    hiddenTrailer[hiddenTrailer.byteLength - 1] = 1
    expect(() => inspectPluginPackageTgz(gzipSync(hiddenTrailer)))
      .toThrowError(expect.objectContaining({ code: 'plugin-update-tgz-trailing-data' }))
  })

  it('replaces an invalid partial cache entry from the configured origin', async () => {
    const artifactBytes = pluginPackageTgz('0.1.11')
    await withArtifactServer(artifactBytes, async origin => {
      const artifactUrl = `${origin.replace('http:', 'https:')}/downloads/dsh-arkme-0.1.11.tgz`
      const cacheDirectory = await mkdtemp(join(tmpdir(), 'arkme-plugin-cache-recovery-'))
      const cachedPath = join(cacheDirectory, '0.1.11', 'dsh-arkme-0.1.11.tgz')
      await mkdir(join(cacheDirectory, '0.1.11'), { recursive: true })
      await writeFile(cachedPath, 'partial')

      await expect(downloadAndCachePluginArtifact(parsePluginUpdateManifest({
        version: '0.1.11', releaseNotes: '恢复缓存', downloadUrl: artifactUrl,
      }, {
        updateServiceOrigin: 'https://api.jotmo.cc', artifactOrigin: new URL(artifactUrl).origin,
      }), {
        cacheDirectory,
        artifactOrigin: new URL(artifactUrl).origin,
        fetchImpl: async input => fetch(String(input).replace('https:', 'http:')),
      })).resolves.toBe(cachedPath)
      expect(await readFile(cachedPath)).toEqual(artifactBytes)
    })
  })

  it('rejects an artifact outside the configured download origin', () => {
    expect(() => parsePluginUpdateManifest({
      version: '0.1.11',
      releaseNotes: '跨源下载',
      downloadUrl: 'https://evil.example/dsh-arkme-0.1.11.tgz',
    }, {
      updateServiceOrigin: 'https://api.jotmo.cc',
      artifactOrigin: 'https://d.jiwo.cc',
    })).toThrowError(expect.objectContaining({ code: 'plugin-update-artifact-origin-invalid' }))
  })

  it('accepts multiline release notes from the update service', () => {
    const manifest = parsePluginUpdateManifest({
      version: '0.1.17',
      releaseNotes: '新增功能1\n新增功能2\t详情\r\n完成',
      downloadUrl: 'https://d.jiwo.cc/app/arkme/test/plugin/senguoyun-dsh-arkme-0.1.17.tgz',
    }, {
      updateServiceOrigin: 'https://jotmo.senguo.me', artifactOrigin: 'https://d.jiwo.cc',
    })

    expect(manifest.notice.summary).toBe('新增功能1\n新增功能2\t详情\r\n完成')
  })

  it('rejects control characters in remote release notes', () => {
    expect(() => parsePluginUpdateManifest({
      version: '0.1.11',
      releaseNotes: '更新\u0000说明',
      downloadUrl: 'https://d.jiwo.cc/app/arkme/prod/plugin/dsh-arkme-0.1.11.tgz',
    }, {
      updateServiceOrigin: 'https://api.jotmo.cc', artifactOrigin: 'https://d.jiwo.cc',
    })).toThrowError(expect.objectContaining({ code: 'plugin-update-manifest-control' }))
  })
})
