import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'
const id = 'a'.repeat(64)
const page = { accountScope: 'test:11', supported: true, items: [{ id, content: 'answer', canRetry: true, replyTargetRef: 'opaque', status: 'failed' }] }
it('uses the same cancellable Host owner from SDK read and retry', async () => {
  const owner = { sourceMessageThoughtContinuations: vi.fn(async () => page) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const { operation, params } = JSON.parse(String(init?.body))
    const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: { arkoThoughtContinuationsV1: true } }
      : await dispatchArkmeHostOperation(owner as never, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  await sdk.sourceMessageThoughtContinuations('source', 'action', { cursor: 'b'.repeat(24), signal })
  expect(owner.sourceMessageThoughtContinuations).toHaveBeenLastCalledWith('source', 'action', { cursor: 'b'.repeat(24) }, signal)
  await sdk.retrySourceMessageThoughtContinuation('source', 'action', id, signal)
  expect(owner.sourceMessageThoughtContinuations).toHaveBeenLastCalledWith('source', 'action', { retryId: id }, signal)
})
it('exposes existing continuation status and explicit-human retry through the registered tools', async () => {
  const owner = { sourceMessageThoughtContinuations: vi.fn(async () => page), retrySourceMessageThoughtContinuation: vi.fn(async () => page) }
  const tools = createArkmeCoreToolDefinitions(owner as never), signal = new AbortController().signal
  const read = tools.find(t => t.name === 'arkme_message_thoughts')!, write = tools.find(t => t.name === 'arkme_thought_reply')!
  expect(String(await read.execute({ source_ref: 'source', message_action_ref: 'action', action: 'continuations' }, { callId: 'read', signal } as never))).toContain(id)
  await write.execute({ source_ref: 'source', message_action_ref: 'action', action: 'retry', continuation_id: id }, { callId: 'retry', signal } as never)
  expect(owner.retrySourceMessageThoughtContinuation).toHaveBeenCalledExactlyOnceWith('source', 'action', id, signal)
  await expect(write.execute({ source_ref: 'source', message_action_ref: 'action', action: 'retry', continuation_id: id, text: 'another write' }, { callId: 'bad', signal } as never)).rejects.toThrow()
})
