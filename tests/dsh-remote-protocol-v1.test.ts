import { describe, expect, it } from 'vitest'
import { parseDshRemoteRequest } from '../src/dsh-remote/protocol-v1.js'

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'request_12345678',
    host_generation: 7, issued_at: 1_000, execute_before: 2_000,
    operation: 'session.history', body: { session_ref: 'session-1' }, ...overrides,
  }
}

describe('dsh.remote/v1 envelopes', () => {
  it('strictly validates generation, deadline, operations and additional fields', () => {
    expect(parseDshRemoteRequest(request(), { expectedHostGeneration: 7, nowMillis: 1_500 }).operation).toBe('session.history')
    expect(() => parseDshRemoteRequest(request({ host_generation: 6 }), { expectedHostGeneration: 7, nowMillis: 1_500 })).toThrow(/失效/)
    expect(() => parseDshRemoteRequest(request({ execute_before: 1_400 }), { expectedHostGeneration: 7, nowMillis: 1_500 })).toThrow(/过期/)
    expect(() => parseDshRemoteRequest(request({ unexpected: true }), { expectedHostGeneration: 7, nowMillis: 1_500 })).toThrow(/未定义字段/)
    expect(() => parseDshRemoteRequest(request({ body: { session_id: 'session-1' } }), { expectedHostGeneration: 7, nowMillis: 1_500 }))
      .toThrow(/body 包含未定义字段/)
    expect(() => parseDshRemoteRequest(request({
      operation: 'session.prompt', body: { session_ref: 'session-1', mode: 'queue', content: { type: 'image', data: 'secret' } },
    }), { expectedHostGeneration: 7, nowMillis: 1_500 })).toThrow(/普通文本/)
  })

  it('requires an exact paired Provider and model for model-aware session creation', () => {
    expect(parseDshRemoteRequest(request({
      operation: 'model.list', body: {},
    }), { expectedHostGeneration: 7, nowMillis: 1_500 }).operation).toBe('model.list')
    expect(parseDshRemoteRequest(request({
      operation: 'session.create',
      body: {
        workspace_ref: 'workspace-1',
        model_provider: 'arkme-managed',
        model_id: 'deepseek-v4-flash',
      },
    }), { expectedHostGeneration: 7, nowMillis: 1_500 }).body).toMatchObject({
      model_provider: 'arkme-managed', model_id: 'deepseek-v4-flash',
    })
    expect(() => parseDshRemoteRequest(request({
      operation: 'session.create',
      body: { workspace_ref: 'workspace-1', model_provider: 'arkme-managed' },
    }), { expectedHostGeneration: 7, nowMillis: 1_500 })).toThrow(/同时提供/)
  })
})
