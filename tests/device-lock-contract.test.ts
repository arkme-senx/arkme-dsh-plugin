import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import { deviceLockToolModules } from '../src/tools/business/account/device-lock.js'

describe('device lock shared Host/SDK/Tool contract', () => {
  it('routes all three surfaces to the same owner and rejects caller-supplied authentication', async () => {
    const snapshot = { available: true, locked: true, sessionEnded: false, message: '请在手机上确认' }
    const owner = { deviceLockStatus: vi.fn(async () => snapshot), lockDevice: vi.fn(async () => snapshot), requestDeviceUnlock: vi.fn(async () => snapshot) }
    const sdk = new ArkmeSdk({ fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ok: true, value: await dispatchArkmeHostOperation(owner as never, request.operation, request.params ?? {})}))
    } })
    await expect(sdk.deviceLockStatus()).resolves.toEqual(snapshot)
    await expect(sdk.lockDevice()).resolves.toEqual(snapshot)
    await expect(sdk.requestDeviceUnlock()).resolves.toEqual(snapshot)
    for (const module of deviceLockToolModules) {
      const tool = module.create(owner as never)
      await tool.execute({}, {} as never)
      if (module.meta.effect === 'write') expect(module.meta.grant).toBe('explicit-user-write')
    }
    for (const forged of [{authenticated: true}, {password: 'not-a-real-password'}, {sessionId: 'another-login'}]) {
      await expect(dispatchArkmeHostOperation(owner as never, 'device.lock.unlock', forged)).rejects.toMatchObject({code: 'invalid-params'})
    }
    expect(owner.requestDeviceUnlock).toHaveBeenCalledTimes(2)
    expect(owner.lockDevice).toHaveBeenCalledTimes(2)
  })
})
