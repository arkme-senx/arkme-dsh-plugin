import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
const cleanup = vi.hoisted(() => ({
  wait: undefined as Promise<void> | undefined,
  started: undefined as (() => void) | undefined,
}))
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, unlink: async (path: Parameters<typeof fs.unlink>[0]) => {
    cleanup.started?.()
    await cleanup.wait
    return fs.unlink(path)
  } }
})
import { createArkmeRecordingImportHandler } from '../src/recording-import-routes.js'

it('finishes failed-import cleanup before returning the error even on a slow filesystem', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-import-cleanup-order-'))
  let release!: () => void, began!: () => void
  cleanup.wait = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { began = resolve })
  cleanup.started = began
  const options = { expectedPort: 0, allowNonLoopback: false, temporaryDirectory: directory }
  const handler = createArkmeRecordingImportHandler({
    async recordingImportUserId() { return 42 },
    async acceptRecordingImport() { throw new Error('owner unavailable') },
  }, options)
  let outgoing: ServerResponse | undefined
  const server = createServer((request, response) => { outgoing = response; void handler(request, response) })
  let pending: Promise<Response> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing port')
    options.expectedPort = address.port
    pending = fetch(`http://127.0.0.1:${address.port}/recording/import`, {
      method: 'POST', body: Buffer.from('recording-bytes'),
      headers: { 'content-type':'audio/wav', origin:`http://127.0.0.1:${address.port}`,
        'x-arkme-file-name':'voice.wav', 'x-arkme-start-at':'1725000000000', 'x-arkme-belong-user':'42' },
    })
    await started
    expect(outgoing?.headersSent).toBe(false)
    release()
    const response = await pending
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ ok:false, error:{code:'recording-import-internal-error'} })
    expect(await readdir(directory)).toEqual([])
  } finally {
    release(); cleanup.wait = undefined; cleanup.started = undefined
    await pending?.then(response => response.arrayBuffer()).catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive:true, force:true })
  }
})
