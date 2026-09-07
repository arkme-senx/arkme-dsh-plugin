import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ArkmePluginError } from '../src/services/service.js'
import { dshAgentInputRecordUid, dshAgentInputSubmissionsFromEvent, registerDSHAgentInputRecordSync } from '../src/dsh-agent-input-sync.js'

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function fakeContext(supported = true) {
  let listener: ((session: unknown, event: unknown) => void) | undefined
  let dispose: (() => void) | undefined
  const warnings: string[] = []
  const ctx = {
    get: () => supported ? { submitText() {} } : undefined,
    logger: { warn: (message: string) => warnings.push(message) },
    on(name: string, callback: typeof listener, options: unknown) {
      expect(name).toBe('session/event')
      expect(options).toEqual({ global: true })
      listener = callback
      return () => { listener = undefined }
    },
    effect(register: () => () => void) { dispose = register() },
  } as unknown as Context
  return { ctx, warnings, emit: (event: unknown, sessionId = 'session-1') => listener?.({ id: sessionId }, event), dispose: () => dispose?.() }
}

function accepted(submissionId = 'submit-1', text = '  人工原文  ', sessionId = 'session-1') {
  return {
    type: 'agent/inbox/spliced', seq: 7, time: 1713830400000,
    data: { target: 'next-turn', start: 0, inserted: [{
      id: 'message-1', role: 'user', content: [{ type: 'text', text: '展开后的模型提示，不是原文' }],
      source: { kind: 'user', rpcId: submissionId, submission: { schemaVersion: 1, origin: 'web-composer', sessionId, text } },
    }] },
  }
}

function service(writer = vi.fn(async () => ({ recordUid: 'record', status: 1 }))) {
  return { writer, captureDSHAgentInputWriter: vi.fn(async () => writer) }
}

afterEach(() => vi.useRealTimers())

describe('DSH Agent input sync', () => {
  it('reports unsupported hosts without archiving guessed human input', async () => {
    const harness = fakeContext(false)
    const target = service()
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit(accepted())
    harness.emit(accepted())
    await flush()
    expect(target.writer).not.toHaveBeenCalled()
    expect(harness.warnings).toHaveLength(1)
    expect(harness.warnings[0]).toContain('upgrade the DSH host and Web client together')
    harness.dispose()
  })

  it('stops retrying when account policy rejects the captured writer', async () => {
    vi.useFakeTimers()
    const harness = fakeContext()
    const target = service(vi.fn(async () => { throw new ArkmePluginError('account-scope-changed', 'changed', false) }))
    registerDSHAgentInputRecordSync(harness.ctx, target, { retryDelayMillis: 10 })
    harness.emit(accepted())
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    expect(target.writer).toHaveBeenCalledTimes(1)
    expect(harness.warnings).toEqual(['dsh-arkme: accepted DSH text sync stopped by account or input policy'])
    harness.dispose()
  })

  it.each([{ kind: 'user' }, { kind: 'user', rpcId: 'automation-rpc' }])(
    'does not infer manual submission from a user-role source: %j', source => {
      for (const event of [
        { type: 'user/message', data: { source, content: [{ type: 'text', text: 'same text' }] } },
        { type: 'agent/inbox/spliced', data: { inserted: [{ source, content: [{ type: 'text', text: 'same text' }] }] } },
      ]) expect(dshAgentInputSubmissionsFromEvent(event, 'session-1')).toEqual([])
    },
  )

  it('reads confirmed text rather than model content and rejects inherited history', () => {
    expect(dshAgentInputSubmissionsFromEvent(accepted(), 'session-1')).toEqual([{ submissionId: 'submit-1', text: '  人工原文  ' }])
    expect(dshAgentInputSubmissionsFromEvent(accepted(), 'fork-1')).toEqual([])
    expect(dshAgentInputSubmissionsFromEvent(accepted('id', 'child text', 'child'), 'child')).toEqual([{ submissionId: 'id', text: 'child text' }])
  })

  it.each([
    { schemaVersion: 2 }, { origin: 'automation' }, { text: '  ' }, { sessionId: 'other' },
  ])('refuses unsupported or malformed provenance: %j', fields => {
    const event = accepted()
    Object.assign(event.data.inserted[0]!.source.submission, fields)
    expect(dshAgentInputSubmissionsFromEvent(event, 'session-1')).toEqual([])
  })

  it('does not treat queue edits or model execution as new submissions', () => {
    const event = accepted()
    expect(dshAgentInputSubmissionsFromEvent({ ...event, data: { ...event.data, removedCount: 1 } }, 'session-1')).toEqual([])
    expect(dshAgentInputSubmissionsFromEvent({ ...event, type: 'user/message' }, 'session-1')).toEqual([])
    expect(dshAgentInputSubmissionsFromEvent({ ...event, type: 'assistant/message' }, 'session-1')).toEqual([])
  })

  it('deduplicates acceptance across inbox movement and repeated delivery', async () => {
    const harness = fakeContext()
    const target = service()
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit(accepted())
    harness.emit(accepted())
    await flush()
    harness.emit({ ...accepted(), seq: 18 })
    await flush()
    expect(target.writer).toHaveBeenCalledExactlyOnceWith(dshAgentInputRecordUid('session-1', 'submit-1'), '  人工原文  ', 1713830400000)
    expect(target.captureDSHAgentInputWriter).toHaveBeenCalledTimes(1)
    expect(harness.warnings).toEqual([])
    harness.dispose()
  })

  it.each([undefined, -1, 1.2, NaN])('does not fabricate a valid sequence from %s', seq => {
    const harness = fakeContext()
    const target = service()
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit({ ...accepted(), seq })
    expect(target.captureDSHAgentInputWriter).not.toHaveBeenCalled()
    harness.dispose()
  })

  it('retries through the captured writer, never acquiring another account', async () => {
    vi.useFakeTimers()
    const harness = fakeContext()
    const first = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    const second = vi.fn()
    const target = { captureDSHAgentInputWriter: vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second) }
    registerDSHAgentInputRecordSync(harness.ctx, target, { retryDelayMillis: 10 })
    harness.emit(accepted())
    await flush()
    await vi.advanceTimersByTimeAsync(10)
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).not.toHaveBeenCalled()
    expect(target.captureDSHAgentInputWriter).toHaveBeenCalledTimes(1)
    harness.dispose()
  })

  it('contains failures without logging input or upstream error details', async () => {
    const harness = fakeContext()
    const target = service(vi.fn(async () => { throw new Error('private input or token') }))
    registerDSHAgentInputRecordSync(harness.ctx, target, { maxAttempts: 1 })
    expect(() => harness.emit(accepted())).not.toThrow()
    await flush()
    expect(harness.warnings).toEqual(['dsh-arkme: failed to sync accepted DSH text after bounded retries'])
    harness.dispose()
  })

  it.each([false, true])('does not start writes after disposal (writer acquired=%s)', async acquired => {
    const harness = fakeContext()
    const target = service()
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit(accepted())
    if (acquired) await Promise.resolve()
    harness.dispose()
    await flush()
    expect(target.writer).not.toHaveBeenCalled()
  })

  it('does not reacquire another account after a terminal failure and queue movement', async () => {
    const harness = fakeContext()
    const target = service(vi.fn(async () => { throw new ArkmePluginError('account-scope-changed', 'changed', false) }))
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit(accepted())
    await flush()
    harness.emit({ ...accepted(), seq: 12 })
    await flush()
    expect(target.captureDSHAgentInputWriter).toHaveBeenCalledTimes(1)
    expect(target.writer).toHaveBeenCalledTimes(1)
    harness.dispose()
  })

  it('does not bind a previously rejected submission after a later login', async () => {
    const harness = fakeContext()
    const target = service()
    target.captureDSHAgentInputWriter.mockRejectedValueOnce(new Error('logged out'))
    registerDSHAgentInputRecordSync(harness.ctx, target)
    harness.emit(accepted())
    await flush()
    harness.emit({ ...accepted(), seq: 12 })
    await flush()
    expect(target.captureDSHAgentInputWriter).toHaveBeenCalledTimes(1)
    expect(target.writer).not.toHaveBeenCalled()
    harness.dispose()
  })

  it('clears pending retry work on disposal', async () => {
    vi.useFakeTimers()
    const harness = fakeContext()
    const target = service(vi.fn(async () => { throw new Error('offline') }))
    registerDSHAgentInputRecordSync(harness.ctx, target, { retryDelayMillis: 10 })
    harness.emit(accepted())
    await flush()
    harness.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(target.writer).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
