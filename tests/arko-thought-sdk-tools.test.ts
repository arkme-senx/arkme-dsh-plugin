import { describe, expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { arkmeToolCatalog, createArkmeCoreToolDefinitions } from '../src/tools/index.js'

const thought = { id: 'thought', recordUid: 'source-record', biz: 1, generation: 2, content: '官方想法', replyTargetRef: 'signed-target' }
describe('Arko thought SDK and Tools', () => {
  it('routes SDK reads and typed writes through the same Host owner with cancellation', async () => {
    const signal = new AbortController().signal
    const owner = { sourceMessageThoughts: vi.fn(async () => ({ accountScope: 'test:11', items: [thought] })),
      extendSourceMessage: vi.fn(async () => ({ recordUid: 'reply', localState: 'synced' })) }
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const { operation, params } = JSON.parse(String(init?.body))
      const value = operation === 'provider.capabilities' ? { contractVersion: 1, features: { arkoThoughtRepliesV1: true } }
        : await dispatchArkmeHostOperation(owner as never, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
      return new Response(JSON.stringify({ ok: true, value }))
    } })
    expect((await sdk.sourceMessageThoughts('source', 'action', signal)).items[0]?.replyTargetRef).toBe('signed-target')
    expect(owner.sourceMessageThoughts).toHaveBeenCalledWith('source', 'action', signal)
    await sdk.extendSourceMessage('source', 'action', '继续讨论', { thoughtReplyRef: 'signed-target', recordUid: 'reply', signal })
    expect(owner.extendSourceMessage).toHaveBeenCalledWith('source', 'action', '继续讨论', 'reply', [], expect.objectContaining({ thoughtReplyRef: 'signed-target', signal }))
  })
  it('fails on old SDK providers before reading or sending Arko replies', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
    const sdk = createArkmeSdk({ fetchImpl })
    await expect(sdk.sourceMessageThoughts('source', 'action')).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
    await expect(sdk.extendSourceMessage('source', 'action', 'body', { thoughtReplyRef: 'signed' })).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
    expect(fetchImpl.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).operation === 'provider.capabilities')).toBe(true)
  })
  it('registers a bounded read and an explicitly granted write with stable retry identity', async () => {
    const signal = new AbortController().signal
    const owner = { sourceMessageThoughts: vi.fn(async () => ({ accountScope: 'test:11', items: [{ ...thought, content: 'x'.repeat(9000) }] })),
      sourceMessageExtensionContext: vi.fn(async () => ({ parentRecordUid: 'root', extensions: [], nextCursor: 'next', extensionCount: 0 })),
      extendSourceMessage: vi.fn(async () => ({ recordUid: 'reply', localState: 'synced', privateThoughtReply: true })) }
    const tools = createArkmeCoreToolDefinitions(owner as never)
    const read = tools.find(t => t.name === 'arkme_message_thoughts')!
    const reply = tools.find(t => t.name === 'arkme_thought_reply')!
    const result = String(await read.execute({ source_ref: 'source', message_action_ref: 'action' }, { callId: 'read', signal } as never))
    expect(result).toContain('signed-target'); expect(result).toContain('contentTruncated'); expect(result.length).toBeLessThan(10000)
    await read.execute({ source_ref: 'source', message_action_ref: 'action', action: 'replies', cursor: 'cursor' }, { callId: 'read-page', signal } as never)
    expect(owner.sourceMessageExtensionContext).toHaveBeenCalledWith('source', 'action', { paginated: true, pageCursor: 'cursor', signal })
    const args = { source_ref: 'source', message_action_ref: 'action', text: '继续讨论', private_reply_ref: 'private-ref', operation_uid: 'same-operation' }
    await reply.execute(args, { callId: 'one', signal } as never)
    await reply.execute(args, { callId: 'two', signal } as never)
    expect(owner.extendSourceMessage.mock.calls[0]).toEqual(owner.extendSourceMessage.mock.calls[1])
    expect(owner.extendSourceMessage).toHaveBeenCalledWith('source', 'action', '继续讨论', expect.any(String), [], expect.objectContaining({ privateThoughtReplyRef: 'private-ref', signal }))
    await expect(reply.execute({ ...args, thought_reply_ref: 'also' }, { callId: 'three', signal } as never)).rejects.toThrow()
    expect(owner.extendSourceMessage).toHaveBeenCalledTimes(2)
    expect(arkmeToolCatalog.modules.find(m => m.meta.toolName === reply.name)?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
  })
  it('reports unknown writes without inventing success or replaying with a new identity', async () => {
    const owner = { extendSourceMessage: vi.fn(async () => { throw Object.assign(new Error('timeout'), { writeOutcomeUnknown: true }) }) }
    const reply = createArkmeCoreToolDefinitions(owner as never).find(t => t.name === 'arkme_thought_reply')!
    const result = String(await reply.execute({ source_ref: 'source', message_action_ref: 'action', thought_reply_ref: 'signed', text: 'reply', operation_uid: 'preserve-this' }, { callId: 'call', signal: new AbortController().signal } as never))
    expect(result).toContain('preserve-this'); expect(result).toContain('unknown'); expect(result).toContain('"confirmed": false')
    expect(owner.extendSourceMessage).toHaveBeenCalledOnce()
  })
  it('redacts protected reply shells and explicitly reports a truncated legacy list', async () => {
    const owner = { sourceMessageExtensionContext: vi.fn(async () => ({ parentRecordUid: 'root', extensionCount: 101,
      extensions: Array.from({ length: 101 }, (_, i) => ({ recordUid: `shell-${i}`, textContent: 'never-expose', protectedContent: true,
        privateThoughtReplyRef: 'never-expose-ref', thoughtReply: { content: 'never-expose-snapshot' } })) })) }
    const read = createArkmeCoreToolDefinitions(owner as never).find(t => t.name === 'arkme_message_thoughts')!
    const result = String(await read.execute({ source_ref: 'source', message_action_ref: 'action', action: 'replies' }, { callId: 'read', signal: new AbortController().signal } as never))
    expect(result).toContain('"itemsTruncated": true'); expect(result).not.toContain('never-expose')
  })
})
