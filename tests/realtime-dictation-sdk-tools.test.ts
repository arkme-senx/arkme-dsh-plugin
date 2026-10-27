import { expect, it, vi } from 'vitest'
import { createArkmeSdk, ArkmeClientError } from '../src/sdk/index.js'
import { arkmeToolCatalog, createArkmeCoreToolDefinitions } from '../src/tools/index.js'
it('discovers the SDK capability, calls the typed same-origin command and propagates cancellation', async () => {
  const signal = new AbortController().signal
  const fetchImpl = vi.fn(async (_url, init) => {
    expect(init.signal).toBe(signal)
    const body = JSON.parse(init.body)
    return new Response(JSON.stringify({ ok: true, value: body.operation === 'provider.capabilities'
      ? { contractVersion: 1, features: { realtimeDictationV1: true } } : { version: 1, streamRef: 'opaque', phase: 'listening', text: '', revision: 0 } }))
  })
  const sdk = createArkmeSdk({ fetchImpl: fetchImpl as never, route: '/custom/api' })
  expect((await sdk.realtimeDictation({ action: 'start', expectedUserId: 42 }, signal)).streamRef).toBe('opaque')
  expect(fetchImpl.mock.calls[1]![0]).toBe('/custom/api')
  expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({ operation: 'dictation.realtime', params: { request: { action: 'start', expectedUserId: 42 } } })
})
it('fails explicitly on older Providers before opening a stream', async () => {
  const sdk = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
  await expect(sdk.openRealtimeDictation({ expectedUserId: 42, onUpdate() {}, onError() {} })).rejects.toBeInstanceOf(ArkmeClientError)
})
it('materializes a business Tool with a grant and invokes the shared Host owner without credentials', async () => {
  const owner = vi.fn(async () => ({ version: 1, streamRef: 'opaque', phase: 'finished', text: '结果', revision: 1 }))
  const tools = createArkmeCoreToolDefinitions({ realtimeDictationCommand: owner } as never)
  const tool = tools.find(value => value.name === 'arkme_realtime_dictation')!
  expect(tool).toBeDefined()
  expect(arkmeToolCatalog.modulesFor('business').find(value => value.meta.toolName === tool.name)?.meta.grant).toBe('explicit-user-write')
  const signal = new AbortController().signal
  const value = await tool.execute({ request_json: JSON.stringify({ action: 'status', streamRef: 'opaque' }) }, { signal } as never)
  expect(owner).toHaveBeenCalledWith({ action: 'status', streamRef: 'opaque' }, signal)
  expect(value).toContain('结果'); expect(value).not.toContain('accessToken')
})
