import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeLocationCaptureError,
  arkmeLocationErrorCanOpenSettings,
  arkmeLocationPermissionState,
  arkmeLocationSettingsAvailable,
  arkmeOpenLocationSettings,
  captureArkmeRecordLocation,
  captureArkmeRecordLocationForSend,
  type ArkmeDesktopLocationBridge,
  type ArkmeLocationPermissionState,
  type ArkmeLocationRuntimeScope,
} from '../src/client/record-capture-location.js'

function permissionSnapshot(state: ArkmeLocationPermissionState) {
  return { schemaVersion: 1 as const, state }
}

function position(): GeolocationPosition {
  return {
    coords: {
      latitude: 30.52,
      longitude: 114.31,
      accuracy: 18,
      altitude: 12,
      altitudeAccuracy: null,
      heading: null,
      speed: 1.5,
    },
    timestamp: 100,
  }
}

function locationScope(input: {
  state?: ArkmeLocationPermissionState
  requestedState?: ArkmeLocationPermissionState
  bridge?: boolean
  geolocationErrorCode?: number
}) {
  const calls: string[] = []
  const permissionState = vi.fn(async () => {
    calls.push('permission-state')
    return permissionSnapshot(input.state ?? 'prompt')
  })
  const requestPermission = vi.fn(async () => {
    calls.push('request-permission')
    return permissionSnapshot(input.requestedState ?? 'granted')
  })
  const openSettings = vi.fn(async () => true)
  const getCurrentPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
    calls.push('geolocation')
    if (input.geolocationErrorCode !== undefined) {
      failure?.({ code: input.geolocationErrorCode, message: 'test failure' } as GeolocationPositionError)
      return
    }
    success(position())
  })
  const browserPermissionQuery = vi.fn(async () => ({ state: 'denied' as PermissionState }))
  const bridge: ArkmeDesktopLocationBridge = { permissionState, requestPermission, openSettings }
  const scope: ArkmeLocationRuntimeScope = {
    navigator: {
      permissions: { query: browserPermissionQuery },
      geolocation: { getCurrentPosition: getCurrentPosition as unknown as Geolocation['getCurrentPosition'] },
    },
    ...(input.bridge === false ? {} : { arkmeDesktopLocation: bridge }),
  }
  return { scope, bridge, calls, permissionState, requestPermission, openSettings, getCurrentPosition, browserPermissionQuery }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Arkme record location capture', () => {
  it('uses the desktop permission owner before browser permission state', async () => {
    const runtime = locationScope({ state: 'granted' })

    await expect(arkmeLocationPermissionState(runtime.scope)).resolves.toBe('granted')
    expect(runtime.permissionState).toHaveBeenCalledOnce()
    expect(runtime.browserPermissionQuery).not.toHaveBeenCalled()
  })

  it('fails closed when the desktop permission-state bridge never resolves', async () => {
    vi.useFakeTimers()
    const runtime = locationScope({ state: 'granted' })
    runtime.permissionState.mockImplementation(async () => await new Promise(() => undefined))
    const pending = arkmeLocationPermissionState({ ...runtime.scope, desktopBridgeTimeoutMillis: 25 })

    await vi.advanceTimersByTimeAsync(25)

    await expect(pending).resolves.toBe('unavailable')
    expect(runtime.browserPermissionQuery).not.toHaveBeenCalled()
  })

  it('fails closed when the explicit desktop permission request never resolves', async () => {
    vi.useFakeTimers()
    const runtime = locationScope({ state: 'prompt' })
    runtime.requestPermission.mockImplementation(async () => await new Promise(() => undefined))
    const pending = captureArkmeRecordLocation('explicit-user-action', {
      ...runtime.scope,
      desktopBridgeTimeoutMillis: 25,
    })
    const assertion = expect(pending).rejects.toMatchObject({ failure: 'unavailable' })

    await vi.advanceTimersByTimeAsync(25)

    await assertion
    expect(runtime.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('requests desktop permission only for an explicit input action, then reads Web geolocation', async () => {
    const runtime = locationScope({ state: 'prompt', requestedState: 'granted' })

    await expect(captureArkmeRecordLocation('explicit-user-action', runtime.scope)).resolves.toEqual({
      latitude: 30.52,
      longitude: 114.31,
      accuracyMeters: 18,
      altitudeMeters: 12,
      speedMetersPerSecond: 1.5,
      capturedAtMillis: 100,
    })
    expect(runtime.calls).toEqual(['permission-state', 'request-permission', 'geolocation'])
  })

  it('never requests permission or Web geolocation from an automatic send', async () => {
    const runtime = locationScope({ state: 'prompt', requestedState: 'granted' })

    await expect(captureArkmeRecordLocation('automatic-send', runtime.scope)).rejects.toMatchObject({
      failure: 'prompt',
      message: '位置权限尚未授权；请在设置中允许位置访问',
    })
    expect(runtime.requestPermission).not.toHaveBeenCalled()
    expect(runtime.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('captures an automatic send only when desktop permission is already granted', async () => {
    const runtime = locationScope({ state: 'granted' })

    await expect(captureArkmeRecordLocation('automatic-send', runtime.scope)).resolves.toMatchObject({
      latitude: 30.52,
      longitude: 114.31,
    })
    expect(runtime.requestPermission).not.toHaveBeenCalled()
    expect(runtime.getCurrentPosition).toHaveBeenCalledOnce()
  })

  it('requests permission on the first send and captures directly after it is granted', async () => {
    const permissionState = vi.fn()
      .mockResolvedValueOnce('prompt')
      .mockResolvedValueOnce('granted')
    const requestPermissionAndLocation = vi.fn(async () => ({ latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 }))
    const captureGrantedLocation = vi.fn(async () => ({ latitude: 31.23, longitude: 121.47, capturedAtMillis: 200 }))

    await expect(captureArkmeRecordLocationForSend({
      permissionState,
      requestPermissionAndLocation,
      captureGrantedLocation,
    })).resolves.toMatchObject({ state: 'captured', location: { capturedAtMillis: 100 } })
    expect(requestPermissionAndLocation).toHaveBeenCalledOnce()
    expect(captureGrantedLocation).not.toHaveBeenCalled()

    await expect(captureArkmeRecordLocationForSend({
      permissionState,
      requestPermissionAndLocation,
      captureGrantedLocation,
    })).resolves.toMatchObject({ state: 'captured', location: { capturedAtMillis: 200 } })
    expect(requestPermissionAndLocation).toHaveBeenCalledOnce()
    expect(captureGrantedLocation).toHaveBeenCalledOnce()
  })

  it('does not reopen the permission flow after the system denies it', async () => {
    const requestPermissionAndLocation = vi.fn()
    const captureGrantedLocation = vi.fn()

    await expect(captureArkmeRecordLocationForSend({
      permissionState: async () => 'denied',
      requestPermissionAndLocation,
      captureGrantedLocation,
    })).resolves.toEqual({ state: 'permission-required', permission: 'denied' })
    expect(requestPermissionAndLocation).not.toHaveBeenCalled()
    expect(captureGrantedLocation).not.toHaveBeenCalled()
  })

  it('shares one in-flight permission request across simultaneous first sends', async () => {
    let resolveLocation!: (value: { latitude: number; longitude: number; capturedAtMillis: number }) => void
    const requestPermissionAndLocation = vi.fn(async () => await new Promise<{
      latitude: number; longitude: number; capturedAtMillis: number
    }>(resolve => { resolveLocation = resolve }))
    const dependencies = {
      permissionState: async () => 'prompt' as const,
      requestPermissionAndLocation,
    }

    const first = captureArkmeRecordLocationForSend(dependencies)
    const second = captureArkmeRecordLocationForSend(dependencies)
    await vi.waitFor(() => { expect(requestPermissionAndLocation).toHaveBeenCalledOnce() })
    resolveLocation({ latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: 'captured', location: { latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 } },
      { state: 'captured', location: { latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 } },
    ])
  })

  it('keeps the browser permission prompt fallback when the desktop bridge is absent', async () => {
    const runtime = locationScope({ bridge: false })
    runtime.browserPermissionQuery.mockResolvedValueOnce({ state: 'prompt' })

    await expect(captureArkmeRecordLocation('explicit-user-action', runtime.scope)).resolves.toMatchObject({
      latitude: 30.52,
      longitude: 114.31,
    })
    expect(runtime.requestPermission).not.toHaveBeenCalled()
    expect(runtime.getCurrentPosition).toHaveBeenCalledOnce()
  })

  it.each([
    ['denied', 'Arkme 的位置权限已被拒绝，请打开系统定位设置后允许访问位置'],
    ['restricted', '此设备限制了 Arkme 使用位置，无法记录当前位置'],
    ['services-disabled', '系统定位服务未开启，请先打开系统定位设置'],
    ['unavailable', 'Arkme 客户端当前无法使用系统定位服务'],
  ] as const)('reports the desktop %s state without touching geolocation', async (state, message) => {
    const runtime = locationScope({ state })

    await expect(captureArkmeRecordLocation('explicit-user-action', runtime.scope)).rejects.toMatchObject({ failure: state, message })
    expect(runtime.requestPermission).not.toHaveBeenCalled()
    expect(runtime.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('fails closed on a malformed desktop permission snapshot without falling back to browser permission', async () => {
    const runtime = locationScope({ state: 'granted' })
    runtime.permissionState.mockResolvedValue({ schemaVersion: 2, state: 'granted' } as never)

    await expect(arkmeLocationPermissionState(runtime.scope)).resolves.toBe('unavailable')
    await expect(captureArkmeRecordLocation('explicit-user-action', runtime.scope)).rejects.toMatchObject({
      failure: 'unavailable',
      message: 'Arkme 客户端当前无法使用系统定位服务',
    })
    expect(runtime.browserPermissionQuery).not.toHaveBeenCalled()
    expect(runtime.requestPermission).not.toHaveBeenCalled()
    expect(runtime.getCurrentPosition).not.toHaveBeenCalled()
  })

  it.each([
    [1, 'denied', '系统未允许 Arkme 读取位置，请打开系统定位设置后允许访问位置'],
    [2, 'position-unavailable', '暂时无法获取当前位置，请检查系统定位服务后重试'],
    [3, 'timeout', '获取当前位置超时，请移动到定位信号较好的位置后重试'],
  ] as const)('maps geolocation failure %i to %s', async (code, failure, message) => {
    const runtime = locationScope({ state: 'granted', geolocationErrorCode: code })

    await expect(captureArkmeRecordLocation('explicit-user-action', runtime.scope)).rejects.toMatchObject({ failure, message })
  })

  it('exposes a safe desktop settings recovery path only when the bridge provides it', async () => {
    const desktop = locationScope({ state: 'denied' })
    const browser = locationScope({ bridge: false })
    const error = new ArkmeLocationCaptureError('denied', 'denied')

    expect(arkmeLocationSettingsAvailable(desktop.scope)).toBe(true)
    expect(arkmeLocationSettingsAvailable(browser.scope)).toBe(false)
    expect(arkmeLocationErrorCanOpenSettings(error)).toBe(true)
    expect(arkmeLocationErrorCanOpenSettings(new ArkmeLocationCaptureError('prompt', 'prompt'))).toBe(true)
    await expect(arkmeOpenLocationSettings(desktop.scope)).resolves.toBe(true)
    expect(desktop.openSettings).toHaveBeenCalledOnce()
    await expect(arkmeOpenLocationSettings(browser.scope)).resolves.toBe(false)
  })
})
