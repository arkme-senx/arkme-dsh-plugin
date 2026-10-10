import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeOutgoingCallPrepareResult } from '../src/outgoing-call-contract.js'

const provider = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({
  ...await original<typeof import('../src/sdk/index.js')>(), callArkme: provider,
}))

import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { OutgoingCallUiController } from '../src/client/outgoing-call-ui-controller.js'
import { OutgoingCallRuntime } from '../src/client/outgoing-call-runtime.js'

const image = { mediaType: 'image/png', dataBase64: 'AA==' }
const imageUrl = 'data:image/png;base64,AA=='
const peerAvatarRef = 'profile-outgoing-priority-fixture'
const prepared: ArkmeOutgoingCallPrepareResult = {
  callRequestId: 'request-fixture', displayName: '联系人', peerAvatarRef,
  bootstrap: {
    sdkAppId: 1, userId: 'me-fixture', userSig: 'fixture', nickName: '我', avatar: '', outgoingOnly: true,
  },
  call: {
    roomId: 'room-fixture', mediaType: 'audio', calleeAccounts: ['peer-fixture'], calleeName: '联系人',
    calleeAvatar: '', callerName: '我', callerAvatar: '', timeoutSec: 30, userData: '{}',
    offlinePushInfo: { title: '我', description: '通话', extension: '{}', ignoreIOSBadge: true, iOSPushType: 1 },
  },
}

function imageCalls() { return provider.mock.calls.filter(call => call[0] === 'image.read') }

beforeEach(() => {
  provider.mockReset()
  arkmeAvatarImages.activateScope(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 4 })
  arkmeAvatarImages.activateScope('test:4')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('This fixture must not access the network') }))
  provider.mockImplementation(async (operation: string, _params: unknown, signal?: AbortSignal) => {
    if (operation === 'world.interactions.list') return await new Promise((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason)
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    if (operation === 'image.read') return image
    if (operation === 'calls.outgoing.prepare') return structuredClone(prepared)
    if (operation.startsWith('calls.')) return undefined
    throw new Error(`Unexpected fixture operation: ${operation}`)
  })
})
afterEach(() => {
  arkmeAvatarImages.activateScope(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  vi.unstubAllGlobals()
})

async function occupyBackground() {
  const controller = new AbortController()
  const completed = Promise.allSettled([1, 2].map(id => callArkme(
    'world.interactions.list', { recordRef: String(id) }, controller.signal, { priority: 'background' },
  )))
  const release = async () => { controller.abort(); await completed }
  try {
    await vi.waitFor(() => expect(provider.mock.calls.filter(call => call[0] === 'world.interactions.list')).toHaveLength(2))
  } catch (error) { await release(); throw error }
  return { controller, release }
}

it('serves repeated memory hits without entering an occupied background queue', async () => {
  await arkmeAvatarImages.load(peerAvatarRef)
  const blocked = await occupyBackground()
  try {
    expect(arkmeAvatarImages.current(peerAvatarRef)).toBe(imageUrl)
    await expect(Promise.all(Array.from({ length: 8 }, () => arkmeAvatarImages.load(peerAvatarRef))))
      .resolves.toEqual(Array(8).fill(imageUrl))
    expect(imageCalls()).toHaveLength(1)
    expect(blocked.controller.signal.aborted).toBe(false)
  } finally { await blocked.release() }
})

it('single-flights a Host cache-only probe outside occupied background permits', async () => {
  const blocked = await occupyBackground()
  const ref = 'file_asset://priority-local-cached'
  try {
    await expect(Promise.all(Array.from({ length: 8 }, () => arkmeAvatarImages.load(ref))))
      .resolves.toEqual(Array(8).fill(imageUrl))
    expect(imageCalls()).toHaveLength(1)
    expect(imageCalls()[0]?.[1]).toEqual({ imageRef: ref, cacheOnly: true })
    expect(blocked.controller.signal.aborted).toBe(false)
  } finally { await blocked.release() }
})

it('coalesces repeated cold avatar reads before admission and downloads once when capacity returns', async () => {
  const blocked = await occupyBackground()
  const loads = Promise.all(Array.from({ length: 8 }, () => arkmeAvatarImages.load(peerAvatarRef)))
  try {
    await Promise.resolve()
    expect(imageCalls()).toHaveLength(0)
    await blocked.release()
    await expect(loads).resolves.toEqual(Array(8).fill(imageUrl))
    expect(imageCalls()).toHaveLength(1)
  } finally { await blocked.release(); await loads }
})

it('bootstraps and sends the call while an optional avatar waits behind unrelated background reads', async () => {
  const blocked = await occupyBackground()
  const controller = new OutgoingCallUiController()
  // Match the production adapter: one shared store owns both current bytes and loading.
  const options = {
    controller,
    loadAvatar: (ref: string) => arkmeAvatarImages.load(ref),
    currentAvatar: (ref: string) => arkmeAvatarImages.current(ref),
    randomId: () => 'request-fixture',
  }
  const runtime = new OutgoingCallRuntime(options)
  const onHostMessage = vi.fn()
  const frame = { contentWindow: { __JOTMO_DESKTOP_CALL_HOST__: { onHostMessage } } } as unknown as HTMLIFrameElement
  const commands = () => onHostMessage.mock.calls.map(([message]) => JSON.parse(String(message)) as { type: string; payload?: { calleeAvatar?: string } })
  runtime.mount()
  runtime.attachFrame(frame)
  try {
    controller.request({ sourceRef: 'source-fixture', displayName: '联系人', mediaType: 'audio' })
    await vi.waitFor(() => expect(commands().some(command => command.type === 'bootstrap')).toBe(true))
    runtime.handleBridgeMessage({ type: 'ready' })
    expect(commands().filter(command => command.type === 'call')).toHaveLength(1)
    expect(commands().find(command => command.type === 'call')?.payload?.calleeAvatar).toBe('')
    expect(imageCalls()).toHaveLength(0)
    expect(blocked.controller.signal.aborted).toBe(false)

    await blocked.release()
    await arkmeAvatarImages.load(peerAvatarRef)
    expect(arkmeAvatarImages.current(peerAvatarRef)).toBe(imageUrl)
    expect(imageCalls()).toHaveLength(1)
    expect(commands().filter(command => command.type === 'call')).toHaveLength(1)
  } finally {
    await blocked.release()
    await arkmeAvatarImages.load(peerAvatarRef).catch(() => undefined)
    runtime.dispose()
  }
})
