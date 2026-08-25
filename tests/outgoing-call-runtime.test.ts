import { describe, expect, it, vi } from 'vitest'
import type { ArkmeOutgoingCallIntentClaim, ArkmeOutgoingCallPrepareResult } from '../src/outgoing-call-contract.js'
import { OutgoingCallUiController } from '../src/client/outgoing-call-ui-controller.js'
import { OutgoingCallRuntime } from '../src/client/outgoing-call-runtime.js'

const prepareResult: ArkmeOutgoingCallPrepareResult = {
  callRequestId: 'request-1',
  displayName: '小林',
  bootstrap: {
    sdkAppId: 123, userId: 'me', userSig: 'TOP_SECRET_SIG', nickName: '我', avatar: '', outgoingOnly: true,
  },
  call: {
    roomId: 'room-1', mediaType: 'video', calleeAccounts: ['peer'], calleeName: '小林',
    calleeAvatar: '', callerName: '我', callerAvatar: '', timeoutSec: 30, userData: '{}',
    offlinePushInfo: {
      title: '我', description: '邀请你进行视频通话', extension: '{}', ignoreIOSBadge: true, iOSPushType: 1,
    },
  },
}

function iframe(onHostMessage = vi.fn()) {
  return {
    frame: { contentWindow: { __JOTMO_DESKTOP_CALL_HOST__: { onHostMessage } } } as unknown as HTMLIFrameElement,
    onHostMessage,
  }
}

async function settle() {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
}

function sentCommand(target: ReturnType<typeof iframe>, type: string): boolean {
  return target.onHostMessage.mock.calls.some(([message]) => {
    try { return JSON.parse(String(message)).type === type } catch { return false }
  })
}

describe('outgoing call runtime', () => {
  it('prepares a direct request, bootstraps the iframe, and never exposes UserSig in snapshots', async () => {
    const api = vi.fn(async (operation: string) => operation === 'calls.outgoing.prepare' ? structuredClone(prepareResult) : undefined)
    const controller = new OutgoingCallUiController()
    const runtime = new OutgoingCallRuntime({ api, controller, randomId: () => 'request-1' })
    const target = iframe()
    runtime.mount()
    runtime.attachFrame(target.frame)

    controller.request({ sourceRef: 'signed-private-ref', displayName: '小林', mediaType: 'video' })
    expect(runtime.getSnapshot()).toMatchObject({ visible: true, phase: 'preparing', displayName: '小林' })
    await settle()

    expect(target.onHostMessage).toHaveBeenCalledWith(expect.stringContaining('TOP_SECRET_SIG'))
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain('TOP_SECRET_SIG')
    runtime.handleBridgeMessage({ type: 'ready' })
    expect(target.onHostMessage).toHaveBeenLastCalledWith(expect.stringContaining('"type":"call"'))
    runtime.handleBridgeMessage({ type: 'calling' })
    expect(runtime.getSnapshot().phase).toBe('calling')
    runtime.dispose()
  })

  it('claims Tool intents and resolves success only after the iframe reports calling', async () => {
    const claim: ArkmeOutgoingCallIntentClaim = {
      intentId: 'intent-1', claimToken: 'claim-1', callRequestId: 'request-1', sourceRef: 'signed-private-ref',
      displayName: '小林', mediaType: 'video', expiresAtMillis: Date.now() + 30_000,
    }
    const api = vi.fn(async (operation: string) => {
      if (operation === 'calls.outgoing.intent.claim') return claim
      if (operation === 'calls.outgoing.prepare') return structuredClone(prepareResult)
      return undefined
    })
    const runtime = new OutgoingCallRuntime({ api, controller: new OutgoingCallUiController() })
    const target = iframe()
    runtime.attachFrame(target.frame)

    await runtime.pollToolIntent()
    runtime.handleBridgeMessage({ type: 'ready' })
    expect(api).not.toHaveBeenCalledWith('calls.outgoing.intent.resolve', expect.objectContaining({ status: 'calling' }))
    runtime.handleBridgeMessage({ type: 'calling' })
    await settle()
    expect(api).toHaveBeenCalledWith('calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'calling',
    })
    runtime.dispose()
  })

  it('releases the lease and reports Tool failure when cancelled before calling', async () => {
    const claim: ArkmeOutgoingCallIntentClaim = {
      intentId: 'intent-1', claimToken: 'claim-1', callRequestId: 'request-1', sourceRef: 'signed-private-ref',
      displayName: '小林', mediaType: 'audio', expiresAtMillis: Date.now() + 30_000,
    }
    const audioPrepare = structuredClone(prepareResult)
    audioPrepare.call.mediaType = 'audio'
    const api = vi.fn(async (operation: string) => {
      if (operation === 'calls.outgoing.intent.claim') return claim
      if (operation === 'calls.outgoing.prepare') return audioPrepare
      return undefined
    })
    const runtime = new OutgoingCallRuntime({ api, controller: new OutgoingCallUiController() })
    await runtime.pollToolIntent()
    runtime.cancel()
    await settle()

    expect(api).toHaveBeenCalledWith('calls.outgoing.intent.resolve', expect.objectContaining({
      intentId: 'intent-1', status: 'failed', code: 'call-cancelled',
    }))
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    expect(runtime.getSnapshot().visible).toBe(false)
    runtime.dispose()
  })

  it('hides the overlay and releases the lease when the iframe reports a fatal error', async () => {
    const api = vi.fn(async (operation: string) => operation === 'calls.outgoing.prepare' ? structuredClone(prepareResult) : undefined)
    const controller = new OutgoingCallUiController()
    const runtime = new OutgoingCallRuntime({ api, controller, randomId: () => 'request-1' })
    const target = iframe()
    runtime.mount()
    runtime.attachFrame(target.frame)

    controller.request({ sourceRef: 'signed-private-ref', displayName: '小林', mediaType: 'video' })
    await settle()
    runtime.handleBridgeMessage({ type: 'fatal_error', message: '呼叫引擎启动失败' })
    await settle()

    expect(runtime.getSnapshot().visible).toBe(false)
    expect(runtime.getSnapshot().phase).toBe('idle')
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    runtime.dispose()
  })

  it.each(['audio', 'video'] as const)('keeps a hidden iframe long enough to terminate an unanswered %s call', async (mediaType) => {
    const timeouts: Array<() => void> = []
    const result = structuredClone(prepareResult)
    result.call.mediaType = mediaType
    const api = vi.fn(async (operation: string) => operation === 'calls.outgoing.prepare' ? result : undefined)
    const controller = new OutgoingCallUiController()
    const runtime = new OutgoingCallRuntime({
      api,
      controller,
      randomId: () => 'request-1',
      setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      setTimeout: ((callback: () => void) => {
        timeouts.push(callback)
        return timeouts.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
    })
    const target = iframe()
    runtime.mount()
    runtime.attachFrame(target.frame)

    controller.request({ sourceRef: 'signed-private-ref', displayName: '小林', mediaType })
    await settle()
    runtime.handleBridgeMessage({ type: 'ready' })

    expect(sentCommand(target, 'call')).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({ visible: true, phase: 'bootstrapping' })

    runtime.cancel()

    expect(sentCommand(target, 'terminate')).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: true, phase: 'ending', statusText: '通话已结束' })
    expect(api).not.toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })

    timeouts.splice(0).forEach(callback => { callback() })
    await settle()

    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: false, phase: 'idle' })
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    runtime.dispose()
  })

  it('hides the overlay immediately when an active call is cancelled or reports end', async () => {
    const timeouts: Array<() => void> = []
    const api = vi.fn(async (operation: string) => operation === 'calls.outgoing.prepare' ? structuredClone(prepareResult) : undefined)
    const controller = new OutgoingCallUiController()
    const settled = vi.fn()
    controller.subscribeSettled(settled)
    const runtime = new OutgoingCallRuntime({
      api,
      controller,
      randomId: () => 'request-1',
      setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      setTimeout: ((callback: () => void) => {
        timeouts.push(callback)
        return timeouts.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
    })
    const target = iframe()
    runtime.mount()
    runtime.attachFrame(target.frame)

    controller.request({ sourceRef: 'signed-private-ref', displayName: '小林', mediaType: 'video' })
    await settle()
    runtime.handleBridgeMessage({ type: 'calling' })
    runtime.handleBridgeMessage({ type: 'begin' })

    runtime.cancel()

    expect(sentCommand(target, 'terminate')).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: true, phase: 'ending', statusText: '通话已结束' })
    expect(api).not.toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    expect(settled).not.toHaveBeenCalled()

    timeouts.splice(0).forEach(callback => { callback() })
    await settle()

    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: false, phase: 'idle' })
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    expect(settled).toHaveBeenCalledWith({
      callRequestId: 'request-1',
      displayName: '小林',
      mediaType: 'video',
      status: 'ended',
    })
    runtime.dispose()
  })

  it('hides the overlay immediately when the iframe reports call end', async () => {
    const timeouts: Array<() => void> = []
    const api = vi.fn(async (operation: string) => operation === 'calls.outgoing.prepare' ? structuredClone(prepareResult) : undefined)
    const controller = new OutgoingCallUiController()
    const runtime = new OutgoingCallRuntime({
      api,
      controller,
      randomId: () => 'request-1',
      setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      setTimeout: ((callback: () => void) => {
        timeouts.push(callback)
        return timeouts.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
    })
    const target = iframe()
    runtime.mount()
    runtime.attachFrame(target.frame)

    controller.request({ sourceRef: 'signed-private-ref', displayName: '小林', mediaType: 'video' })
    await settle()
    runtime.handleBridgeMessage({ type: 'calling' })
    runtime.handleBridgeMessage({ type: 'begin' })

    runtime.handleBridgeMessage({ type: 'end', message: '通话已结束' })

    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: true, phase: 'ending', statusText: '通话已结束' })
    expect(api).not.toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })

    timeouts.splice(0).forEach(callback => { callback() })
    await settle()

    expect(runtime.getSnapshot()).toMatchObject({ visible: false, retainFrame: false, phase: 'idle' })
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: 'request-1' })
    runtime.dispose()
  })
})
