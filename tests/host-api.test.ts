import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

function fakeService() {
  return {
    prepareOutgoingCall: vi.fn(async (input: unknown) => input),
    claimOutgoingCallIntent: vi.fn(async () => null),
    resolveOutgoingCallIntent: vi.fn(async () => undefined),
    heartbeatOutgoingCall: vi.fn(async () => ({ expiresAtMillis: 1 })),
    releaseOutgoingCall: vi.fn(async () => undefined),
    arkoRunStatus: vi.fn(async () => ({ status: 'running' })),
    arkoCancel: vi.fn(async () => ({ status: 'cancel_requested' })),
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

describe('Arko Host API dispatch', () => {
  it('passes only the authoritative run identity to status polling', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'arko.run.status', {
      sessionId: 1024, runUid: 'run-1', assistantMsgId: 999,
    })

    expect(service.arkoRunStatus).toHaveBeenCalledWith(1024, 'run-1')
  })

  it('passes the complete authoritative run identity to cancellation', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'arko.cancel', {
      sessionId: 1024, assistantMsgId: 2048, runUid: 'run-1', userId: 999,
    })

    expect(service.arkoCancel).toHaveBeenCalledWith(1024, 2048, 'run-1')
  })
})

describe('plugin update Host API dispatch', () => {
  it('reads and checks update state without touching the Arkme service', async () => {
    const updates = {
      status: vi.fn(async () => ({ availability: 'current' })),
      check: vi.fn(async () => ({ availability: 'available' })),
      acknowledge: vi.fn(async () => ({ acknowledged: true })),
      install: vi.fn(async () => ({ phase: 'preparing' })),
      installStatus: vi.fn(async () => ({ phase: 'installing' })),
    }
    const service = {} as never

    await expect(dispatchArkmeHostOperation(service, 'plugin.update.status', {}, updates as never))
      .resolves.toEqual({ availability: 'current' })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.check', {}, updates as never))
      .resolves.toEqual({ availability: 'available' })
    expect(updates.check).toHaveBeenCalledWith({ manual: true })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.acknowledge', {
      snoozeHours: 12,
      latestVersion: 'attacker-controlled',
    }, updates as never)).resolves.toEqual({ acknowledged: true })
    expect(updates.acknowledge).toHaveBeenCalledWith(12)
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.install', {}, updates as never))
      .resolves.toEqual({ phase: 'preparing' })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.install-status', {}, updates as never))
      .resolves.toEqual({ phase: 'installing' })
  })

  it('rejects invalid snooze values and missing update runtime', async () => {
    const updates = {
      status: vi.fn(), check: vi.fn(), acknowledge: vi.fn(), install: vi.fn(), installStatus: vi.fn(),
    }
    await expect(dispatchArkmeHostOperation({} as never, 'plugin.update.acknowledge', {
      snoozeHours: 25,
    }, updates as never)).rejects.toMatchObject({ code: 'plugin-update-snooze-invalid' })
    expect(updates.acknowledge).not.toHaveBeenCalled()

    await expect(dispatchArkmeHostOperation({} as never, 'plugin.update.status', {}))
      .rejects.toMatchObject({ code: 'plugin-update-unavailable' })
  })
})
