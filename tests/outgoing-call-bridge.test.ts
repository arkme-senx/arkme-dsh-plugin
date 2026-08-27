import { describe, expect, it, vi } from 'vitest'
import {
  parseDesktopCallBridgeEvent,
  requestDesktopCallMediaPermissions,
  sendDesktopCallCommand,
} from '../src/client/outgoing-call-bridge.js'

function bridgeEvent(message: unknown, overrides: Record<string, unknown> = {}) {
  const source = {}
  return {
    source,
    expectedSource: source,
    event: {
      origin: 'http://127.0.0.1:3210',
      source,
      data: {
        channel: 'jotmo-desktop-call',
        callRequestId: 'request-1',
        message: JSON.stringify(message),
      },
      ...overrides,
    } as unknown as MessageEvent,
  }
}

describe('desktop call host bridge', () => {
  it('accepts allowlisted same-origin messages from the active iframe only', () => {
    const { event, expectedSource } = bridgeEvent({ type: 'calling', roomId: 'room-1' })
    expect(parseDesktopCallBridgeEvent(event, {
      expectedSource: expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toMatchObject({ type: 'calling', roomId: 'room-1' })
  })

  it('accepts sanitized diagnostic messages from the active iframe', () => {
    const { event, expectedSource } = bridgeEvent({
      type: 'diag',
      label: 'engine_event_received',
      detail: { eventName: 'onCallEnd', roomId: 'room-1' },
    })

    expect(parseDesktopCallBridgeEvent(event, {
      expectedSource: expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toMatchObject({
      type: 'diag',
      label: 'engine_event_received',
      detail: JSON.stringify({ eventName: 'onCallEnd', roomId: 'room-1' }),
    })
  })

  it('accepts the iframe active-call flag on state messages', () => {
    const { event, expectedSource } = bridgeEvent({
      type: 'state',
      phase: 'idle',
      statusText: '已初始化，等待来电或发起呼叫',
      hasActiveCall: false,
    })

    expect(parseDesktopCallBridgeEvent(event, {
      expectedSource: expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toMatchObject({
      type: 'state',
      phase: 'idle',
      hasActiveCall: false,
    })
  })

  it('rejects incoming-call, cross-origin, mismatched request, and malformed messages', () => {
    const valid = bridgeEvent({ type: 'incoming' })
    expect(parseDesktopCallBridgeEvent(valid.event, {
      expectedSource: valid.expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toBeUndefined()
    expect(parseDesktopCallBridgeEvent(bridgeEvent({ type: 'ready' }, { origin: 'https://evil.test' }).event, {
      expectedSource: valid.expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toBeUndefined()
    expect(parseDesktopCallBridgeEvent(bridgeEvent({ type: 'ready' }, {
      data: { channel: 'jotmo-desktop-call', callRequestId: 'other', message: '{"type":"ready"}' },
    }).event, {
      expectedSource: valid.expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toBeUndefined()
    expect(parseDesktopCallBridgeEvent(bridgeEvent({ type: 'ready' }, { data: 'bad' }).event, {
      expectedSource: valid.expectedSource as Window,
      expectedOrigin: 'http://127.0.0.1:3210',
      callRequestId: 'request-1',
    })).toBeUndefined()
  })

  it('sends only allowlisted commands through the same-origin iframe host queue', () => {
    const onHostMessage = vi.fn()
    const frame = { contentWindow: { __JOTMO_DESKTOP_CALL_HOST__: { onHostMessage } } } as unknown as HTMLIFrameElement
    expect(sendDesktopCallCommand(frame, 'hangup')).toBe(true)
    expect(onHostMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'hangup', payload: {} }))
    expect(sendDesktopCallCommand(frame, 'accept' as never)).toBe(false)
  })

  it('requests microphone and camera separately so camera denial preserves audio calling', async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce({ getTracks: () => [tracks[0]] })
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))

    const result = await requestDesktopCallMediaPermissions({
      requestId: 'media-1', camera: true, microphone: true,
    }, { getUserMedia })

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: true, video: false })
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: true })
    expect(tracks[0]?.stop).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      requestId: 'media-1', microphoneGranted: true, cameraGranted: false, granted: true,
    })
  })
})
