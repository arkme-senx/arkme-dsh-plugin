import { expect, it, vi, afterEach } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { transcriptViewTools } from '../src/tools/business/recordings/transcript-views.js'
import type { ArkmeService } from '../src/arkme-service.js'
afterEach(() => vi.useRealTimers())
it('public SDK discovers capability and dispatches to the same Host owner without a private import', async () => {
  const owner = {
    providerCapabilities: () => ({
      contractVersion: 1,
      features: { personalTranscriptViewsV1: true },
    }),
    readTranscriptViews: vi.fn(async () => ({ one: { revision: 1 } })),
    changeTranscriptView: vi.fn(),
  }
  const sdk = createArkmeSdk({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const value = await dispatchArkmeHostOperation(
        owner as unknown as ArkmeService,
        body.operation,
        body.params ?? {},
        undefined,
        undefined,
        undefined,
        undefined,
        init?.signal ?? undefined,
      )
      return Response.json({ ok: true, value })
    },
  })
  const signal = new AbortController().signal
  await expect(
    sdk.readTranscriptViews(
      'prod:7',
      'recording:day',
      [{ id: 'one', ref: 'opaque' }],
      signal,
    ),
  ).resolves.toEqual({ one: { revision: 1 } })
  expect(owner.readTranscriptViews).toHaveBeenCalledExactlyOnceWith(
    'prod:7',
    'recording:day',
    [{ id: 'one', ref: 'opaque' }],
    signal,
  )
  const old = createArkmeSdk({
    fetchImpl: async () =>
      Response.json({ ok: true, value: { contractVersion: 1, features: {} } }),
  })
  await expect(
    old.changeTranscriptView('prod:7', 'opaque', {
      operation_id: 'one',
      expected_revision: 0,
      original_version: 'v1',
      action: 'restore',
    }),
  ).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
  expect(owner.changeTranscriptView).not.toHaveBeenCalled()
})
it('separates read and explicit write grants and rejects writes through the read tool', async () => {
  expect(transcriptViewTools.map((t) => t.meta)).toMatchObject([
    { effect: 'read' },
    { effect: 'write', grant: 'explicit-user-write' },
  ])
  const ports = {
    readTranscriptViews: vi.fn(),
    changeTranscriptView: vi.fn(),
    transcriptViewCapabilities: vi.fn(async () => ({
      accountKey: 'prod:7',
      supported: true,
      protocol_version: 1,
    })),
  }
  const read = transcriptViewTools[0].create(ports as never)
  await expect(
    read.execute(
      {
        action: 'change',
        account_key: 'prod:7',
        scope: 's',
        items_json: '[]',
      } as never,
      {} as never,
    ),
  ).rejects.toThrow()
  expect(ports.changeTranscriptView).not.toHaveBeenCalled()
  await read.execute({ action: 'capabilities' } as never, {} as never)
  expect(ports.transcriptViewCapabilities).toHaveBeenCalledOnce()
})
it('stops observations after consumer disposal without an orphan poll', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn(async (_url, init) => {
    const op = JSON.parse(String(init?.body)).operation
    return Response.json({
      ok: true,
      value:
        op === 'provider.capabilities'
          ? {
              contractVersion: 1,
              features: { personalTranscriptViewsV1: true },
            }
          : {},
    })
  })
  const sdk = createArkmeSdk({ fetchImpl }),
    changed = vi.fn()
  sdk.observeTranscriptViews('prod:7', 's', [], changed, vi.fn())
  await vi.advanceTimersByTimeAsync(0)
  expect(changed).toHaveBeenCalledOnce()
  sdk.dispose()
  const count = fetchImpl.mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(fetchImpl).toHaveBeenCalledTimes(count)
})
