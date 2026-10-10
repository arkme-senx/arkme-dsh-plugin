import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutgoingCallRuntime } from '../src/client/outgoing-call-runtime.js'
import { OutgoingCallUiController } from '../src/client/outgoing-call-ui-controller.js'

const receiver = { accountUserId: 42, bootstrap: { sdkAppId: 123, userId: 'me', userSig: 'receiver-secret', nickName: '我', avatar: '', outgoingOnly: false } }
const outgoing = { callRequestId: 'outgoing', displayName: '小林', bootstrap: { ...receiver.bootstrap, outgoingOnly: true },
  call: { roomId: 'room-1', mediaType: 'audio', calleeAccounts: ['peer'], calleeName: '小林', calleeAvatar: '', callerName: '我', callerAvatar: '', timeoutSec: 30, userData: '{}',
    offlinePushInfo: { title: '我', description: '语音邀请', extension: '{}', ignoreIOSBadge: true, iOSPushType: 1 } } }
const runtimes: OutgoingCallRuntime[] = []
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function frame() {
  const send = vi.fn()
  return { frame: { contentWindow: { __JOTMO_DESKTOP_CALL_HOST__: { onHostMessage: send } } } as unknown as HTMLIFrameElement,
    send, commands: () => send.mock.calls.map(([raw]) => JSON.parse(raw)) }
}
function setup() {
  const api = vi.fn(async (operation: string): Promise<unknown> => {
    if (operation === 'calls.receiver.prepare') return structuredClone(receiver)
    if (operation === 'calls.outgoing.prepare') return structuredClone(outgoing)
    return undefined
  })
  const controller = new OutgoingCallUiController()
  let id = 0
  const runtime = new OutgoingCallRuntime({ api, controller, randomId: () => `request-${++id}` })
  runtimes.push(runtime)
  runtime.mount()
  runtime.configureReceiver(42, 'test:42')
  return { runtime, controller, api }
}
async function ready(runtime: OutgoingCallRuntime) {
  await settle()
  const target = frame()
  runtime.attachFrame(target.frame)
  runtime.handleBridgeMessage({ type: 'ready' })
  await settle()
  return target
}

describe('desktop incoming call lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.useRealTimers() })

  it('waits for engine login before allowing invitations, without opening media or creating a room', async () => {
    const { runtime, controller, api } = setup()
    let resolved = false
    const waiting = controller.ensureReceiver().then(() => { resolved = true })
    await settle()
    expect(resolved).toBe(false)
    const target = await ready(runtime)
    await waiting
    expect(target.commands()).toEqual([{ type: 'bootstrap', payload: receiver.bootstrap }])
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'listening', visible: false, retainFrame: true })
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain('receiver-secret')
    expect(api).not.toHaveBeenCalledWith('calls.outgoing.prepare', expect.anything())
    runtime.cancel()
    expect(runtime.getSnapshot().phase).toBe('listening')
  })

  it.each(['audio', 'video'] as const)('shows %s incoming calls and resumes waiting after hangup', async mediaType => {
    const { runtime, api } = setup()
    const target = await ready(runtime)
    const firstId = runtime.getSnapshot().callRequestId
    runtime.handleBridgeMessage({ type: 'incoming', callerName: '来电用户', mediaType })
    await settle()
    expect(api).toHaveBeenCalledWith('calls.receiver.claim', { callRequestId: firstId })
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'incoming', visible: true, displayName: '来电用户', mediaType })
    runtime.handleBridgeMessage({ type: 'begin' })
    expect(runtime.getSnapshot().phase).toBe('active')
    runtime.handleBridgeMessage({ type: 'end' })
    await vi.advanceTimersByTimeAsync(700)
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: firstId })
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'listening', visible: false })
    expect(runtime.getSnapshot().callRequestId).not.toBe(firstId)
    expect(target.commands().filter(command => command.type === 'bootstrap')).toHaveLength(1)
    await ready(runtime)
    runtime.handleBridgeMessage({ type: 'incoming', callerName: '第二位', mediaType })
    await settle()
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'incoming', visible: true, displayName: '第二位' })
  })

  it('terminates a rejected incoming call through the frame and keeps waiting afterward', async () => {
    const { runtime } = setup()
    const target = await ready(runtime)
    runtime.handleBridgeMessage({ type: 'incoming', mediaType: 'audio' })
    await settle()
    runtime.cancel()
    expect(target.commands().some(command => command.type === 'terminate')).toBe(true)
    await vi.advanceTimersByTimeAsync(1_900)
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'listening', visible: false })
  })

  it('suspends receiving for an outgoing call and does not send credentials into the old iframe', async () => {
    const { runtime, controller } = setup()
    const target = await ready(runtime)
    controller.request({ sourceRef: 'private-ref', displayName: '小林', mediaType: 'audio' })
    await settle()
    expect(runtime.getSnapshot().phase).toBe('bootstrapping')
    expect(target.commands().map(command => command.type)).toEqual(['bootstrap', 'logout'])
    const outbound = frame()
    runtime.attachFrame(outbound.frame)
    runtime.handleBridgeMessage({ type: 'ready' })
    expect(outbound.commands().map(command => command.type)).toEqual(['bootstrap', 'call'])
    runtime.handleBridgeMessage({ type: 'incoming', mediaType: 'audio', callerName: '旁路来电' })
    expect(runtime.getSnapshot().displayName).toBe('小林')
  })

  it('drops receiver credentials and pending readiness when logging out', async () => {
    const pending = deferred<unknown>()
    const { runtime, api, controller } = setup()
    runtime.configureReceiver(undefined)
    api.mockImplementation(async operation => operation === 'calls.receiver.prepare' ? pending.promise : undefined)
    runtime.configureReceiver(42, 'test:42')
    const readiness = expect(controller.ensureReceiver()).rejects.toThrow('中断')
    runtime.configureReceiver(undefined)
    pending.resolve(receiver)
    await settle(); await readiness
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'idle', visible: false, retainFrame: false })
    const target = frame(); runtime.attachFrame(target.frame)
    expect(target.send).not.toHaveBeenCalled()
  })

  it('bounds a stalled engine startup and allows an explicit retry', async () => {
    const { runtime, controller } = setup()
    const readiness = expect(controller.ensureReceiver()).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_001)
    await readiness
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'idle', retainFrame: false })
    const retry = controller.ensureReceiver()
    await ready(runtime); await retry
    expect(runtime.getSnapshot().phase).toBe('listening')
  })

  it('does not reveal an incoming call if another window owns the call lease', async () => {
    const { runtime, api } = setup()
    const target = await ready(runtime)
    api.mockImplementation(async operation => {
      if (operation === 'calls.receiver.claim') throw new Error('已有通话')
      if (operation === 'calls.receiver.prepare') return structuredClone(receiver)
      return undefined
    })
    runtime.handleBridgeMessage({ type: 'incoming', mediaType: 'audio' })
    await settle()
    expect(runtime.getSnapshot().visible).toBe(false)
    expect(target.commands().some(command => command.type === 'terminate')).toBe(true)
  })

  it('releases a delayed incoming lease without showing it after logout', async () => {
    const { runtime, api } = setup()
    await ready(runtime)
    const pending = deferred<unknown>()
    api.mockImplementation(async operation => operation === 'calls.receiver.claim' ? pending.promise : undefined)
    const requestId = runtime.getSnapshot().callRequestId
    runtime.handleBridgeMessage({ type: 'incoming', mediaType: 'audio' })
    runtime.configureReceiver(undefined)
    pending.resolve({}); await settle()
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'idle', visible: false })
    expect(api).toHaveBeenCalledWith('calls.outgoing.release', { callRequestId: requestId })
  })

  it('registers a single receiver owner when two host surfaces mount', () => {
    const controller = new OutgoingCallUiController()
    const first = controller.registerReceiver(async () => {})
    expect(first).toBeTypeOf('function')
    expect(controller.registerReceiver(async () => {})).toBeUndefined()
    first?.()
    expect(controller.registerReceiver(async () => {})).toBeTypeOf('function')
  })

  it('continues claiming tool requests after a receiver failure interrupts a poll', async () => {
    const { runtime, api } = setup()
    await ready(runtime)
    const pending = deferred<unknown>()
    api.mockImplementation(async operation => operation === 'calls.outgoing.intent.claim' ? pending.promise : undefined)
    const poll = runtime.pollToolIntent()
    runtime.handleBridgeMessage({ type: 'fatal_error', message: '网络中断' })
    pending.resolve(null); await poll
    api.mockClear()
    await runtime.pollToolIntent()
    expect(api).toHaveBeenCalledWith('calls.outgoing.intent.claim', undefined)
  })
})
