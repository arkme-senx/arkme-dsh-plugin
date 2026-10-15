import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog, type ArkmeCoreToolPorts } from '../src/tools/index.js'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

it('SDK discovers support and forwards cancellable queries through Host to the same owner', async () => {
  const service = { startRecordingEntities: vi.fn(async () => ({ status: 'accepted' })), recordingEntities: vi.fn(async query => ({ ...query, entities: [] })), recordingEntityOccurrences: vi.fn(async query => ({ ...query, items: [] })) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    init?.signal?.throwIfAborted()
    const { operation, params } = JSON.parse(String(init?.body))
    const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingEntities: true, recordingEntityStart: true } }
      : await dispatchArkmeHostOperation(service as unknown as ArkmeService, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  await sdk.startRecordingEntities({ dateStamp: 123 }, signal)
  expect(service.startRecordingEntities).toHaveBeenCalledWith({ dateStamp: 123, transcriptSource: 'system' }, signal)
  await sdk.recordingEntities({ dateStamp: 123 }, signal)
  await sdk.recordingEntityOccurrences({ entityRef: 'opaque', offset: 50 }, signal)
  expect(service.recordingEntities).toHaveBeenCalledWith({ dateStamp: 123, transcriptSource: 'system', knownStateRevision: 0, knownProjectionRevision: 0 }, signal)
  expect(service.recordingEntityOccurrences).toHaveBeenCalledWith({ entityRef: 'opaque', offset: 50, limit: 50 }, signal)
  await expect(sdk.recordingEntities({ dateStamp: 123 }, AbortSignal.abort())).rejects.toThrow()
  const unsupported = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
  await expect(unsupported.startRecordingEntities({ dateStamp: 123 })).rejects.toThrow('不支持')
  await expect(unsupported.recordingEntities({ dateStamp: 123 })).rejects.toThrow('不支持')
})

it('registers a read-only Tool with the same owner and rejects ambiguous inputs', async () => {
  const ports = { recordingEntities: vi.fn(async () => ({ entities: [] })), recordingEntityOccurrences: vi.fn(async () => ({ items: [] })) }
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(tool => tool.name === 'arkme_recording_entities')!
  expect(arkmeToolCatalog.modulesFor('business').find(module => module.meta.toolName === tool.name)?.meta.effect).toBe('read')
  const exec = { signal: new AbortController().signal } as never
  await tool.execute({ action: 'list', date_stamp: 123 }, exec)
  await tool.execute({ action: 'occurrences', entity_ref: 'opaque', limit: 10 }, exec)
  expect(ports.recordingEntityOccurrences).toHaveBeenCalledWith({ entityRef: 'opaque', offset: 0, limit: 10 }, expect.any(AbortSignal))
  await expect(tool.execute({ action: 'list', date_stamp: 123, entity_ref: 'opaque' }, exec)).rejects.toThrow()
  await expect(tool.execute({ action: 'occurrences' }, exec)).rejects.toThrow()
})

it('registers manual recognition separately with the explicit user write grant', async () => {
  const ports = { startRecordingEntities: vi.fn(async () => ({ status: 'accepted' })) }
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(tool => tool.name === 'arkme_recording_entities_start')!
  expect(arkmeToolCatalog.modulesFor('business').find(module => module.meta.toolName === tool.name)?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
  await tool.execute({ date_stamp: 123 }, { signal: new AbortController().signal } as never)
  expect(ports.startRecordingEntities).toHaveBeenCalledWith({ dateStamp: 123, transcriptSource: 'system' }, expect.any(AbortSignal))
  await expect(tool.execute({ date_stamp: -1 }, {} as never)).rejects.toThrow()
})

it('requires an allowed Origin before HTTP manual recognition can write', async () => {
  const service = { startRecordingEntities: vi.fn(async () => ({ status: 'accepted' })) }
  const server = createServer(createArkmeHostApi(service as unknown as ArkmeService, { expectedPort: 3080, allowNonLoopback: false }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address() as { port: number }
  const body = JSON.stringify({ operation: 'recordings.entities.start', params: { dateStamp: 123 } })
  try {
    const endpoint = `http://127.0.0.1:${address.port}/arkme-self/api`
    const rejected = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect(rejected.status).toBe(403); expect(service.startRecordingEntities).not.toHaveBeenCalled()
    const accepted = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3080' }, body })
    expect(accepted.status).toBe(200); expect(service.startRecordingEntities).toHaveBeenCalledOnce()
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
})
