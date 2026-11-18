import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeUploadHandler, createArkmeLocalFileHandler } from '../src/rich-media-routes.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'

const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const metadata = { fileName: 'clip.mp4', mimeType: 'video/mp4', size: 3 }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme file origin ')); directories.push(directory)
  let userId = 42
  const fetchMedia = vi.fn(async () => ({ response: new Response('abc'), descriptor: metadata }))
  const ports = { currentUser: async () => userId, fetchMedia } as unknown as FileTransferPorts
  const owner = new FileTransfers(directory, ports, 1000)
  const path = join(directory, 'input.mp4'); await writeFile(path, 'abc')
  return { directory, path, owner, ports, fetchMedia, setUser: (value: number) => { userId = value } }
}

describe('trusted local file provenance', () => {
  it('marks actual local staging internally and ignores metadata origin supplied by a caller', async () => {
    const f = await fixture()
    const local = await f.owner.stage(f.path, { ...metadata, origin: 'received', path: '/untrusted' } as typeof metadata)
    expect(local).toMatchObject({ origin: 'local' })
    expect(local).not.toHaveProperty('path')
    const prepared = await f.owner.stageBytes('YWJj', { fileName: 'tool.mp4', mimeType: 'video/mp4', origin: 'received' } as never)
    expect(prepared).toMatchObject({ origin: 'local' })
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    expect((await restarted.readLocal(local.fileRef)).file).toEqual(local)
    expect(await restarted.files()).toEqual([local, prepared])
  })
  it.each(['arkme-media-v1.original', 'team-app-media.signed'])('persists received origin before publishing %s and keeps the warm path', async mediaRef => {
    const f = await fixture()
    await f.owner.reception(mediaRef, true); await f.owner.settled()
    const result = await f.owner.reception(mediaRef)
    expect(result).toMatchObject({ state: 'ready', file: { origin: 'received' } })
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    expect(await restarted.reception(mediaRef, true)).toEqual(result)
    expect((await restarted.readLocal(result.file!.fileRef)).file).toEqual(result.file)
    expect(f.fetchMedia).toHaveBeenCalledOnce()
    f.setUser(43)
    expect(await restarted.files()).toEqual([])
    await expect(restarted.readLocal(result.file!.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
  })
  it('never persists a received file as local when reception mapping persistence fails', async () => {
    const f = await fixture()
    const internal = f.owner as unknown as { save(user: number, state: unknown): Promise<void> }
    const save = internal.save.bind(internal)
    let writes = 0
    vi.spyOn(internal, 'save').mockImplementation(async (user, state) => {
      if (++writes === 2) throw new Error('mapping write failed')
      await save(user, state)
    })
    await f.owner.reception('team-app-media.signed', true); await f.owner.settled()
    const persisted = JSON.parse(await readFile(join(f.directory, '42', 'state.json'), 'utf8'))
    expect(Object.values(persisted.files)).toEqual([expect.objectContaining({ origin: 'received' })])
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    expect(await restarted.files()).toEqual([expect.objectContaining({ origin: 'received' })])
  })
  it.each([undefined, 'guessed-local'])('does not infer origin for old or invalid persisted metadata: %s', async origin => {
    const f = await fixture()
    const file = await f.owner.stage(f.path, metadata)
    const statePath = join(f.directory, '42', 'state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    if (origin === undefined) delete state.files[file.fileRef].origin
    else state.files[file.fileRef].origin = origin
    state.originals['team-app-media.old'] = file.fileRef
    await writeFile(statePath, JSON.stringify(state))
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    expect((await restarted.readLocal(file.fileRef)).file).not.toHaveProperty('origin')
    expect((await restarted.files())[0]).not.toHaveProperty('origin')
    expect((await restarted.reception('team-app-media.old')).file).not.toHaveProperty('origin')
  })
  it('shares trusted origin through stage/list/receive SDK and Tools, and GET/HEAD headers', async () => {
    const f = await fixture()
    const old = await f.owner.stage(f.path, metadata)
    const statePath = join(f.directory, '42', 'state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')); delete state.files[old.fileRef].origin
    await writeFile(statePath, JSON.stringify(state))
    const owner = new FileTransfers(f.directory, f.ports, 1000)
    const facade = { fileSessionUser: f.ports.currentUser, fileStage: owner.stage.bind(owner), fileReadLocal: owner.readLocal.bind(owner),
      fileCapabilities: owner.capabilities.bind(owner), fileList: owner.files.bind(owner), fileReceive: owner.reception.bind(owner),
      fileSendTasks: owner.tasks.bind(owner), fileStageBytes: owner.stageBytes.bind(owner) }
    const options = { expectedPort: 0, allowNonLoopback: false, maxUploadBytes: 1000, temporaryDirectory: join(f.directory, 'temporary') }
    const stage = createArkmeUploadHandler(facade as never, options, 'stage')
    const local = createArkmeLocalFileHandler(facade as never, options)
    const api = createArkmeHostApi(facade as never, options)
    const server = createServer((req, res) => {
      if (req.url?.includes('/files/stage')) void stage(req, res)
      else if (req.url?.includes('/files/local')) void local(req, res)
      else void api(req, res)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address')
    options.expectedPort = address.port
    const base = `http://127.0.0.1:${address.port}`
    const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(String(url), base), init) })
    try {
      const staged = await sdk.stageFile(new Blob(['abc'], { type: 'video/mp4' }), { fileName: 'local.mp4' })
      expect(staged).toMatchObject({ origin: 'local' })
      const forged = await fetch(`${base}/files/stage?origin=received`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-Arkme-File-Name': 'forged.mp4', 'X-Arkme-File-Origin': 'received' }, body: 'abc' })
      expect((await forged.json() as { value: unknown }).value).toMatchObject({ origin: 'local' })
      await sdk.receiveFile('team-app-media.signed', true); await owner.settled()
      const received = await sdk.receiveFile('team-app-media.signed')
      expect(received.file).toMatchObject({ origin: 'received' })
      expect(await sdk.localFiles()).toEqual(await owner.files())
      for (const [fileRef, origin] of [[staged.fileRef, 'local'], [received.file!.fileRef, 'received'], [old.fileRef, 'unknown']]) {
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(new URL(sdk.localFileUrl(fileRef!), base), { method, headers: { 'X-Arkme-File-Origin': 'local' } })
          expect(response.status).toBe(200)
          expect(response.headers.get('x-arkme-file-origin')).toBe(origin)
          expect(await response.text()).toBe(method === 'HEAD' ? '' : 'abc')
        }
      }
      const tools = createArkmeCoreToolDefinitions(facade as never)
      const execute = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args as never, { signal: new AbortController().signal } as never)
      expect(await execute('arkme_file_receive', { original_ref: 'team-app-media.signed' })).toContain('"origin": "received"')
      expect(await execute('arkme_file_prepare', { file_name: 'tool.mp4', mime_type: 'video/mp4', content_base64: 'YWJj', origin: 'received' })).toContain('"origin": "local"')
      const listed = await execute('arkme_files_list', {}) as string
      expect(listed).toContain('"origin": "local"'); expect(listed).toContain('"origin": "received"')
      expect(listed).not.toContain(f.directory)
      f.setUser(43)
      const rejected = await fetch(new URL(sdk.localFileUrl(staged.fileRef), base), { method: 'HEAD', headers: { 'X-Arkme-File-Origin': 'local' } })
      expect(rejected.status).toBe(400); expect(rejected.headers.get('x-arkme-file-origin')).toBeNull()
    } finally {
      owner.cancelActive(); await owner.settled()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
