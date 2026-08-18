import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

function fakeService() {
  return {
    prepareOutgoingCall: vi.fn(async (input: unknown) => input),
    claimOutgoingCallIntent: vi.fn(async () => null),
    resolveOutgoingCallIntent: vi.fn(async () => undefined),
    heartbeatOutgoingCall: vi.fn(async () => ({ expiresAtMillis: 1 })),
    releaseOutgoingCall: vi.fn(async () => undefined),
  }
}

describe('outgoing call Host API dispatch', () => {
  it('rejects an unknown outgoing media type before calling the service', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.prepare', {
      sourceRef: 'source-ref', mediaType: 'screen', callRequestId: 'request-1',
    })).rejects.toMatchObject({ code: 'call-media-type-invalid' })
    expect(service.prepareOutgoingCall).not.toHaveBeenCalled()
  })

  it('passes only the strict prepare fields to the service', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.prepare', {
      sourceRef: 'source-ref', mediaType: 'video', callRequestId: 'request-1', userId: 999,
    })

    expect(service.prepareOutgoingCall).toHaveBeenCalledWith({
      sourceRef: 'source-ref', mediaType: 'video', callRequestId: 'request-1',
    })
  })

  it('requires non-empty one-time intent credentials', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: '', claimToken: '', status: 'calling',
    })).rejects.toMatchObject({ code: 'call-intent-invalid' })
    expect(service.resolveOutgoingCallIntent).not.toHaveBeenCalled()
  })

  it('accepts calling completion without forwarding caller-supplied failure text', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'calling',
      code: 'call-engine-failed', message: 'secret details', userId: 999,
    })

    expect(service.resolveOutgoingCallIntent).toHaveBeenCalledWith({
      intentId: 'intent-1', claimToken: 'claim-1', outcome: { status: 'calling' },
    })
  })

  it('accepts only known bounded failure details', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'failed',
      code: 'arbitrary-secret-code', message: '失败',
    })).rejects.toMatchObject({ code: 'call-failure-invalid' })

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'failed',
      code: 'call-permission-denied', message: '麦克风权限被拒绝',
    })
    expect(service.resolveOutgoingCallIntent).toHaveBeenCalledWith({
      intentId: 'intent-1',
      claimToken: 'claim-1',
      outcome: { status: 'failed', code: 'call-permission-denied', message: '麦克风权限被拒绝' },
    })
  })

  it('validates heartbeat and release request IDs', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.heartbeat', {
      callRequestId: '',
    })).rejects.toMatchObject({ code: 'call-request-invalid' })
    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.release', {
      callRequestId: 'request-1', userId: 999,
    })
    expect(service.releaseOutgoingCall).toHaveBeenCalledWith('request-1')
  })
})
