import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalRecorderMediaHandler } from '../src/local-recorder/routes.js'
import { createArkmeHostApi } from '../src/host-api.js'
import type { LocalRecorderOwner } from '../src/local-recorder/owner.js'

const servers: Server[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function listen(handler: (req: any, res: any) => unknown) {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}
describe('local recorder HTTP boundary', () => {
  it('streams byte ranges and downloads without exposing file paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'recorder-media-')); directories.push(directory)
    const path = join(directory, 'sample.wav'); await writeFile(path, Buffer.from('0123456789'))
    const owner = { resolveAudio: vi.fn(async () => ({ path, fileName: 'Arkme-TEST.wav', size: 10 })) } as unknown as LocalRecorderOwner
    let handler: ReturnType<typeof createLocalRecorderMediaHandler>
    const port = await listen((req, res) => handler(req, res)); handler = createLocalRecorderMediaHandler(owner, port)
    const base = `http://127.0.0.1:${port}`, headers = { referer: `${base}/`, 'sec-fetch-site': 'same-origin' }
    const partial = await fetch(`${base}/?ref=opaque`, { headers: { ...headers, range: 'bytes=2-5' } })
    expect(partial.status).toBe(206); expect(partial.headers.get('content-range')).toBe('bytes 2-5/10'); expect(await partial.text()).toBe('2345')
    const suffix = await fetch(`${base}/?ref=opaque`, { headers: { ...headers, range: 'bytes=-3' } })
    expect(await suffix.text()).toBe('789')
    const download = await fetch(`${base}/?ref=opaque&download=1`, { headers })
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="Arkme-TEST.wav"')
    expect(await download.text()).toBe('0123456789')
    expect((await fetch(base, { headers: { ...headers, range: 'bytes=100-200' } })).status).toBe(416)
  })
  it('rejects cross-origin and origin-less media requests before resolving a file', async () => {
    const resolveAudio = vi.fn(), owner = { resolveAudio } as unknown as LocalRecorderOwner
    let handler: ReturnType<typeof createLocalRecorderMediaHandler>
    const port = await listen((req, res) => handler(req, res)); handler = createLocalRecorderMediaHandler(owner, port)
    const base = `http://127.0.0.1:${port}`
    expect((await fetch(base)).status).toBe(403)
    expect((await fetch(base, { headers: { referer: 'https://foreign.example/' } })).status).toBe(403)
    expect(resolveAudio).not.toHaveBeenCalled()
  })
  it('requires exact local origin for all device operations, even when the Host allows remote access', async () => {
    const snapshot = vi.fn(async () => ({ supported: true, devices: [] }))
    const options = { expectedPort: 0, allowNonLoopback: true, localRecorder: { snapshot } as unknown as LocalRecorderOwner }
    const handler = createArkmeHostApi({} as never, options)
    const port = await listen((req, res) => handler(req, res)); options.expectedPort = port
    const base = `http://127.0.0.1:${port}`, body = JSON.stringify({ operation: 'recorders.local.snapshot' })
    expect((await fetch(base, { method: 'POST', body })).status).toBe(403)
    expect((await fetch(base, { method: 'POST', headers: { origin: 'https://foreign.example' }, body })).status).toBe(403)
    const response = await fetch(base, { method: 'POST', headers: { origin: base }, body })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, value: { supported: true, devices: [] } })
    expect(snapshot).toHaveBeenCalledTimes(1)
  })
})
