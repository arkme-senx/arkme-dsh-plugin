import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeSdk, type RecordingFileImportInput } from '../src/sdk/index.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'

const input: RecordingFileImportInput = {
  fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001',
  startAtMillis: 1_700_000_000_000, ownership: 'self',
}
const success = (value: unknown) => new Response(JSON.stringify({ ok: true, value }))

describe('public recording import SDK', () => {
  it('discovers support and shares opaque file/status/retry contracts with Host', async () => {
    const calls: Array<Record<string, unknown>> = []
    const signal = new AbortController().signal
    const sdk = createArkmeSdk({ fetchImpl: async (_url, options) => {
      expect(options?.signal).toBe(signal)
      const request = JSON.parse(String(options?.body)); calls.push(request)
      return success(request.operation === 'provider.capabilities'
        ? { contractVersion: 1, features: { recordingFileImport: true } }
        : { importRef: 'sealed-import', revision: 7, phase: 'prepared' })
    } })
    await expect(sdk.importRecordingFile(input, signal)).resolves.toMatchObject({ importRef: 'sealed-import' })
    await sdk.recordingImportStatus('sealed-import', signal)
    await sdk.retryRecordingImport('sealed-import', 7, signal)
    expect(calls.filter(call => call.operation !== 'provider.capabilities')).toEqual([
      { operation: 'recordings.import.file', params: input },
      { operation: 'recordings.import.status', params: { importRef: 'sealed-import' } },
      { operation: 'recordings.import.retry', params: { importRef: 'sealed-import', expectedRevision: 7 } },
    ])
    expect(JSON.stringify(calls)).not.toMatch(/bucket|upload_id|sourceHandle|sha256/)
  })

  it('refuses unsupported providers and disposed consumers before a write', async () => {
    const fetcher = vi.fn(async () => success({ contractVersion: 1, features: {} }))
    const sdk = createArkmeSdk({ fetchImpl: fetcher })
    await expect(sdk.importRecordingFile(input)).rejects.toThrow('不支持录音文件导入')
    await expect(sdk.recordingImportStatus('sealed')).rejects.toThrow('不支持录音文件导入')
    await expect(sdk.retryRecordingImport('sealed', 1)).rejects.toThrow('不支持录音文件导入')
    expect(fetcher).toHaveBeenCalledTimes(3)
    await expect(sdk.importRecordingFile(input, AbortSignal.abort())).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('rejects local paths, invalid time, ownership and revisions before I/O', async () => {
    const fetcher = vi.fn()
    const sdk = createArkmeSdk({ fetchImpl: fetcher })
    for (const patch of [{ fileRef: '/private/source.wav' }, { startAtMillis: -1 }, { ownership: 'contact' }]) {
      await expect(sdk.importRecordingFile({ ...input, ...patch } as RecordingFileImportInput)).rejects.toThrow()
    }
    await expect(sdk.recordingImportStatus('')).rejects.toThrow()
    await expect(sdk.retryRecordingImport('sealed', 0)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('dispatches only semantic input to the existing owner and propagates retry cancellation', async () => {
    const service = { importRecordingFile: vi.fn(), retryRecordingImport: vi.fn() }
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service as never, 'recordings.import.file', {
      ...input, userId: 999, bucket: 'untrusted', objectKey: 'untrusted',
    }, undefined, undefined, undefined, undefined, signal)
    expect(service.importRecordingFile).toHaveBeenCalledWith(input, signal)
    await dispatchArkmeHostOperation(service as never, 'recordings.import.retry', {
      importRef: 'sealed', expectedRevision: 7,
    }, undefined, undefined, undefined, undefined, signal)
    expect(service.retryRecordingImport).toHaveBeenCalledWith('sealed', 7, signal)
  })

  it('retains the existing loopback and same-origin write boundary', async () => {
    const service = { importRecordingFile: vi.fn(async () => ({ importRef: 'sealed' })) }
    const server = createServer(createArkmeHostApi(service as never, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing fixture address')
    try {
      const url = `http://127.0.0.1:${address.port}/arkme-self/api`
      const request = { method: 'POST', body: JSON.stringify({ operation: 'recordings.import.file', params: input }) }
      const rejected = await fetch(url, request)
      expect(rejected.status).toBe(403); expect(service.importRecordingFile).not.toHaveBeenCalled()
      const accepted = await fetch(url, { ...request, headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' } })
      expect(accepted.status).toBe(200); expect(service.importRecordingFile).toHaveBeenCalledOnce()
    } finally { server.close(); await once(server, 'close') }
  })
})
