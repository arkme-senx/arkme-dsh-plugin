import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'

it('shares the exact revision and version cursor Host owner through the public SDK', async () => {
  const owner = { recordEditHistoryPage: vi.fn(async () => ({ items: [], hasMore: false })),
    recordRevisionSnapshot: vi.fn(async () => ({ revisionUid: 'r', durationState: 'complete', editDurationMillis: 0 })) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const { operation, params } = JSON.parse(String(init?.body))
    const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordEditHistoryV1: true } }
      : await dispatchArkmeHostOperation(owner as never, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  await sdk.recordEditHistory('source', 'action', 9, signal)
  expect(owner.recordEditHistoryPage).toHaveBeenCalledWith('source', 'action', 9, signal)
  expect(await sdk.recordRevisionSnapshot('source', 'action', 'r', signal)).toMatchObject({ editDurationMillis: 0 })
  expect(owner.recordRevisionSnapshot).toHaveBeenCalledWith('source', 'action', 'r', signal)
})
it('fails clearly for a Provider without the history capability', async () => {
  const sdk = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
  await expect(sdk.recordEditHistory('source', 'action')).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
})
it('registers a read-only history Tool and strips private device, location and audio details', async () => {
  const owner = { recordRevisionSnapshot: vi.fn(async () => ({ revisionUid: 'r', textContent: 'historical', durationState: 'complete', editDurationMillis: 0,
    captureContext: { clientName: 'private-device' }, locationCapture: { latitude: 31, longitude: 121 }, audioUrl: 'secret-url' })) }
  const tool = createArkmeCoreToolDefinitions(owner as never).find(t => t.name === 'arkme_record_history')!
  const signal = new AbortController().signal
  const out = String(await tool.execute({ source_ref: 'source', message_action_ref: 'action', revision_uid: 'r' }, { signal, callId: 'read' } as never))
  expect(owner.recordRevisionSnapshot).toHaveBeenCalledWith('source', 'action', 'r', signal)
  expect(out).toContain('historical'); expect(out).toContain('editDurationMillis')
  expect(out).not.toMatch(/private-device|latitude|longitude|secret-url/)
  await expect(tool.execute({ source_ref: 'source', message_action_ref: 'action', revision_uid: 'r', cursor_version: 0 }, { signal, callId: 'bad' } as never)).rejects.toThrow('互斥')
})
