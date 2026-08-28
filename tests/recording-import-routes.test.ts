import { createServer, request, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createArkmeRecordingImportHandler,
  scavengeRecordingImportTemporaryFiles,
  type ArkmeRecordingImportRouteOptions,
} from '../src/recording-import-routes.js'

const servers: Server[] = []
afterEach(async () => await Promise.all(servers.splice(0).map(async server => await new Promise<void>(resolve => server.close(() => resolve())))))

async function rawRequest(port: number, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1', port, path: '/recording/import', method: options.method ?? 'POST', headers: options.headers,
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

describe('recording import route', () => {
  it('streams an account-scoped temporary file into the recording service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const acceptRecordingImport = vi.fn(async (path: string) => {
      expect(await readFile(path, 'utf8')).toBe('recording-bytes')
      return { importRef: 'opaque', revision: 1, phase: 'prepared', progress: 0 }
    })
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: root,
    }
    const handler = createArkmeRecordingImportHandler({ acceptRecordingImport } as never, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/recording/import`, {
      method: 'POST',
      headers: {
        'content-type': 'audio/wav',
        origin: `http://127.0.0.1:${String(address.port)}`,
        'x-arkme-file-name': encodeURIComponent('会议.wav'),
        'x-arkme-start-at': '1725000000000',
      },
      body: Buffer.from('recording-bytes'),
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ ok: true, value: { importRef: 'opaque' } })
    expect(acceptRecordingImport).toHaveBeenCalledWith(expect.stringMatching(/\.upload$/), expect.objectContaining({
      fileName: '会议.wav', mimeType: 'audio/wav', fileSize: 15,
      startAtMillis: 1_725_000_000_000, sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    const temporaryPath = acceptRecordingImport.mock.calls[0]?.[0]
    expect((await stat(temporaryPath!)).mode & 0o777).toBe(0o600)
  })

  it('rejects unsupported metadata before writing an owner job', async () => {
    const acceptRecordingImport = vi.fn()
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: root,
    }
    const handler = createArkmeRecordingImportHandler({ acceptRecordingImport } as never, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/recording/import`, {
      method: 'POST',
      headers: {
        'content-type': 'video/mp4', origin: `http://127.0.0.1:${String(address.port)}`,
        'x-arkme-file-name': 'movie.mp4', 'x-arkme-start-at': '1725000000000',
      },
      body: Buffer.from('bad'),
    })
    expect(response.status).toBe(400)
    expect(acceptRecordingImport).not.toHaveBeenCalled()
  })

  it('rejects wrong methods, missing length and declared oversize before creating a temporary file', async () => {
    const acceptRecordingImport = vi.fn()
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: root,
    }
    const handler = createArkmeRecordingImportHandler({ acceptRecordingImport } as never, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port
    const baseHeaders = {
      origin: `http://127.0.0.1:${String(address.port)}`,
      'content-type': 'audio/wav',
      'x-arkme-file-name': 'voice.wav',
      'x-arkme-start-at': '1725000000000',
    }

    await expect(rawRequest(address.port, { method: 'GET' })).resolves.toMatchObject({ status: 405 })
    await expect(rawRequest(address.port, { headers: baseHeaders })).resolves.toMatchObject({ status: 400 })
    await expect(rawRequest(address.port, {
      headers: { ...baseHeaders, 'content-length': String(1024 * 1024 * 1024 + 1) },
    })).resolves.toMatchObject({ status: 400 })
    expect(acceptRecordingImport).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('reports a bounded internal error when its private temporary directory cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const blocked = join(root, 'not-a-directory')
    await writeFile(blocked, 'occupied')
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: blocked,
    }
    const handler = createArkmeRecordingImportHandler({ acceptRecordingImport: vi.fn() } as never, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/recording/import`, {
      method: 'POST',
      headers: {
        'content-type': 'audio/wav', origin: `http://127.0.0.1:${String(address.port)}`,
        'x-arkme-file-name': 'voice.wav', 'x-arkme-start-at': '1725000000000',
      },
      body: Buffer.from('recording-bytes'),
    })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'recording-import-internal-error', retryable: true },
    })
  })

  it('requires the same loopback Origin for the raw-file mutation route', async () => {
    const acceptRecordingImport = vi.fn()
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: root,
    }
    const handler = createArkmeRecordingImportHandler({ acceptRecordingImport } as never, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port

    for (const origin of [undefined, 'https://attacker.example']) {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/recording/import`, {
        method: 'POST',
        headers: {
          'content-type': 'audio/wav',
          ...(origin === undefined ? {} : { origin }),
          'x-arkme-file-name': 'voice.wav', 'x-arkme-start-at': '1725000000000',
        },
        body: Buffer.from('voice'),
      })
      expect(response.status).toBe(403)
    }
    expect(acceptRecordingImport).not.toHaveBeenCalled()
  })

  it('cleans the private temporary file when owner acceptance fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const options: ArkmeRecordingImportRouteOptions = {
      expectedPort: 0, allowNonLoopback: false, temporaryDirectory: root,
    }
    const handler = createArkmeRecordingImportHandler({
      async acceptRecordingImport() { throw new Error('owner unavailable') },
    }, options)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/recording/import`, {
      method: 'POST',
      headers: {
        'content-type': 'audio/wav', origin: `http://127.0.0.1:${String(address.port)}`,
        'x-arkme-file-name': 'voice.wav', 'x-arkme-start-at': '1725000000000',
      },
      body: Buffer.from('recording-bytes'),
    })
    expect(response.status).toBe(500)
    expect(await readdir(root)).toEqual([])
  })

  it('scavenges only stale recording upload files after an abnormal exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-route-'))
    const stale = join(root, 'stale.upload')
    const fresh = join(root, 'fresh.upload')
    const unrelated = join(root, 'keep.txt')
    await Promise.all([writeFile(stale, 'stale'), writeFile(fresh, 'fresh'), writeFile(unrelated, 'keep')])
    await utimes(stale, new Date(1_000), new Date(1_000))

    await expect(scavengeRecordingImportTemporaryFiles(root, 100_000, 10_000)).resolves.toBe(1)
    expect((await readdir(root)).sort()).toEqual(['fresh.upload', 'keep.txt'])
  })
})
