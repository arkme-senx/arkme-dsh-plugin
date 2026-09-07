import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  dshAgentInputRecordUid,
  dshAgentInputTextFromEvent,
  registerDSHAgentInputRecordSync,
} from '../src/dsh-agent-input-sync.js'

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => { queueMicrotask(resolve) })
}

function fakeContext() {
  let listener: ((session: unknown, event: unknown) => void) | undefined
  let listenerOptions: unknown
  let disposeEffect: (() => void) | undefined
  const warnings: string[] = []
  const ctx = {
    logger: { warn(message: string) { warnings.push(message) } },
    on(name: string, next: (session: unknown, event: unknown) => void, options?: unknown) {
      expect(name).toBe('session/event')
      listener = next
      listenerOptions = options
      return () => { listener = undefined }
    },
    effect(register: () => () => void) {
      disposeEffect = register()
      return disposeEffect
    },
  } as unknown as Context
  return {
    ctx,
    warnings,
    listenerOptions() {
      return listenerOptions
    },
    dispose() {
      disposeEffect?.()
    },
    emit(session: unknown, event: unknown) {
      listener?.(session, event)
    },
  }
}

describe('DSH Agent input sync', () => {
  it('extracts only direct human text blocks from user/message events', () => {
    expect(dshAgentInputTextFromEvent({
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: ' hello ' },
          { type: 'image', url: 'opaque' },
          { type: 'text', text: 'world' },
        ],
      },
    })).toBe('hello\nworld')
    expect(dshAgentInputTextFromEvent({
      type: 'user/message',
      data: { source: { kind: 'plugin', plugin: 'ctx' }, content: [{ type: 'text', text: 'skip' }] },
    })).toBeUndefined()
    expect(dshAgentInputTextFromEvent({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'skip' }] } },
    })).toBeUndefined()
  })

  it('writes direct DSH input once with a stable record uid', async () => {
    const harness = fakeContext()
    const createDSHAgentInputText = vi.fn(async () => ({ recordUid: 'record', status: 1 }))
    registerDSHAgentInputRecordSync(harness.ctx, { createDSHAgentInputText })
    const event = {
      type: 'user/message',
      seq: 7,
      time: 1713830400000,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记下来' }] },
    }

    harness.emit({ id: 'session-1' }, event)
    harness.emit({ id: 'session-1' }, event)
    await flushMicrotasks()

    expect(createDSHAgentInputText).toHaveBeenCalledTimes(1)
    expect(createDSHAgentInputText).toHaveBeenCalledWith(
      dshAgentInputRecordUid('session-1', 7),
      '记下来',
      1713830400000,
    )
    expect(harness.listenerOptions()).toEqual({ global: true })
    expect(harness.warnings).toEqual([])
  })

  it('logs sync failures without throwing from the session/event listener', async () => {
    const harness = fakeContext()
    const createDSHAgentInputText = vi.fn(async () => {
      throw new Error('remote down')
    })
    registerDSHAgentInputRecordSync(harness.ctx, { createDSHAgentInputText }, { maxAttempts: 1 })

    expect(() => {
      harness.emit({ id: 'session-1' }, {
        type: 'user/message',
        seq: 8,
        time: 1713830400000,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: '失败也不阻塞' }] },
      })
    }).not.toThrow()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(harness.warnings).toEqual([
      'dsh-arkme: failed to sync DSH Agent input record: remote down',
    ])
  })

  it('disables sync without blocking startup when session event API is unavailable', () => {
    const warnings: string[] = []
    const ctx = {
      logger: { warn(message: string) { warnings.push(message) } },
      effect(register: () => () => void) {
        return register()
      },
    } as unknown as Context

    expect(() => {
      registerDSHAgentInputRecordSync(ctx, { createDSHAgentInputText: vi.fn() })
    }).not.toThrow()
    expect(warnings).toEqual([
      'dsh-arkme: DSH session/event API is unavailable; DSH Agent input sync disabled',
    ])
  })

  it('does not retry after the effect is disposed', async () => {
    vi.useFakeTimers()
    const harness = fakeContext()
    const createDSHAgentInputText = vi.fn(async () => {
      throw new Error('remote down')
    })
    registerDSHAgentInputRecordSync(harness.ctx, { createDSHAgentInputText }, { maxAttempts: 2, retryDelayMillis: 10 })

    harness.emit({ id: 'session-1' }, {
      type: 'user/message',
      seq: 9,
      time: 1713830400000,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '卸载后不重试' }] },
    })
    harness.dispose()
    await flushMicrotasks()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(10)

    expect(createDSHAgentInputText).toHaveBeenCalledTimes(1)
    expect(harness.warnings).toEqual([])
    vi.useRealTimers()
  })
})
