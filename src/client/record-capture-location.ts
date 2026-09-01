import type { ArkmeRecordLocationCapture, ArkmeSourceItem } from '../types.js'

const LOCATION_ENABLED_PREFIX = 'arkme.record-capture.location.enabled.'
export const ARKME_DESKTOP_LOCATION_BRIDGE_TIMEOUT_MILLIS = 5_000
export const ARKME_DESKTOP_LOCATION_PERMISSION_REQUEST_TIMEOUT_MILLIS = 65_000
const listeners = new Map<string, Set<() => void>>()

export type ArkmeLocationPermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'restricted'
  | 'services-disabled'
  | 'unavailable'

export interface ArkmeDesktopLocationPermissionSnapshot {
  readonly schemaVersion: 1
  readonly state: ArkmeLocationPermissionState
}

export interface ArkmeDesktopLocationBridge {
  permissionState(): Promise<ArkmeDesktopLocationPermissionSnapshot>
  requestPermission(): Promise<ArkmeDesktopLocationPermissionSnapshot>
  openSettings(): Promise<boolean>
}

export interface ArkmeLocationNavigator {
  readonly geolocation?: Pick<Geolocation, 'getCurrentPosition'>
  readonly permissions?: {
    query(descriptor: PermissionDescriptor): Promise<{ readonly state: PermissionState }>
  }
}

export interface ArkmeLocationRuntimeScope {
  readonly navigator?: ArkmeLocationNavigator
  readonly arkmeDesktopLocation?: ArkmeDesktopLocationBridge
  readonly desktopBridgeTimeoutMillis?: number
}

export type ArkmeLocationCaptureIntent = 'explicit-user-action' | 'automatic-send'

export type ArkmeLocationCaptureFailure =
  | Exclude<ArkmeLocationPermissionState, 'granted'>
  | 'position-unavailable'
  | 'timeout'
  | 'capture-failed'

declare global {
  interface Window {
    readonly arkmeDesktopLocation?: ArkmeDesktopLocationBridge
  }
}

export class ArkmeLocationCaptureError extends Error {
  constructor(
    message: string,
    readonly failure: ArkmeLocationCaptureFailure,
  ) {
    super(message)
    this.name = 'ArkmeLocationCaptureError'
  }
}

const LOCATION_PERMISSION_STATES = new Set<ArkmeLocationPermissionState>([
  'granted',
  'prompt',
  'denied',
  'restricted',
  'services-disabled',
  'unavailable',
])

function browserLocationRuntimeScope(): ArkmeLocationRuntimeScope {
  return {
    ...(typeof navigator === 'undefined' ? {} : { navigator }),
    ...(typeof window === 'undefined' || window.arkmeDesktopLocation === undefined
      ? {}
      : { arkmeDesktopLocation: window.arkmeDesktopLocation }),
  }
}

function desktopPermissionState(value: unknown): ArkmeLocationPermissionState {
  if (typeof value !== 'object' || value === null) return 'unavailable'
  const snapshot = value as Partial<ArkmeDesktopLocationPermissionSnapshot>
  return snapshot.schemaVersion === 1 && LOCATION_PERMISSION_STATES.has(snapshot.state as ArkmeLocationPermissionState)
    ? snapshot.state as ArkmeLocationPermissionState
    : 'unavailable'
}

function permissionError(
  state: Exclude<ArkmeLocationPermissionState, 'granted'>,
  input: { desktop: boolean; explicit: boolean },
): ArkmeLocationCaptureError {
  if (state === 'denied') {
    return new ArkmeLocationCaptureError('Arkme 的位置权限已被拒绝，请打开系统定位设置后允许访问位置', state)
  }
  if (state === 'restricted') {
    return new ArkmeLocationCaptureError('此设备限制了 Arkme 使用位置，无法记录当前位置', state)
  }
  if (state === 'services-disabled') {
    return new ArkmeLocationCaptureError('系统定位服务未开启，请先打开系统定位设置', state)
  }
  if (state === 'unavailable') {
    return new ArkmeLocationCaptureError(
      input.desktop ? 'Arkme 客户端当前无法使用系统定位服务' : '当前浏览器不支持位置采集',
      state,
    )
  }
  return new ArkmeLocationCaptureError(
    input.explicit
      ? '尚未完成位置授权，请在系统授权弹窗中选择“允许”'
      : '位置权限尚未授权；请先在输入框中点击“开启位置记录”',
    state,
  )
}

function geolocationError(error: GeolocationPositionError): ArkmeLocationCaptureError {
  if (error.code === 1) {
    return new ArkmeLocationCaptureError('系统未允许 Arkme 读取位置，请打开系统定位设置后允许访问位置', 'denied')
  }
  if (error.code === 2) {
    return new ArkmeLocationCaptureError('暂时无法获取当前位置，请检查系统定位服务后重试', 'position-unavailable')
  }
  if (error.code === 3) {
    return new ArkmeLocationCaptureError('获取当前位置超时，请移动到定位信号较好的位置后重试', 'timeout')
  }
  return new ArkmeLocationCaptureError('位置采集失败，请稍后重试', 'capture-failed')
}

function storageKey(accountId: number | string | undefined): string | undefined {
  if (accountId === undefined || String(accountId).trim() === '') return undefined
  return `${LOCATION_ENABLED_PREFIX}${String(accountId)}`
}

export function arkmeSourceSupportsLocationCapture(kind: ArkmeSourceItem['kind'] | undefined): boolean {
  return kind === 'private_chat' || kind === 'group_chat' || kind === 'send_to_self'
    || kind === 'default_category' || kind === 'topic'
}

export function arkmeLocationCaptureEnabled(accountId: number | string | undefined): boolean {
  const key = storageKey(accountId)
  if (key === undefined) return false
  try { return window.localStorage.getItem(key) === 'enabled' } catch { return false }
}

export function setArkmeLocationCaptureEnabled(accountId: number | string | undefined, enabled: boolean): void {
  const key = storageKey(accountId)
  if (key === undefined) return
  try { window.localStorage.setItem(key, enabled ? 'enabled' : 'disabled') } catch { /* local preference is optional */ }
  for (const listener of listeners.get(key) ?? []) listener()
}

export function subscribeArkmeLocationCapturePreference(
  accountId: number | string | undefined,
  listener: () => void,
): () => void {
  const key = storageKey(accountId)
  if (key === undefined) return () => undefined
  const accountListeners = listeners.get(key) ?? new Set<() => void>()
  accountListeners.add(listener)
  listeners.set(key, accountListeners)
  const onStorage = (event: StorageEvent) => { if (event.key === key) listener() }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    accountListeners.delete(listener)
    if (accountListeners.size === 0) listeners.delete(key)
  }
}

async function withDesktopBridgeDeadline<T>(
  operation: () => Promise<T>,
  timeoutMillis: number,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      callback()
    }
    const timer = globalThis.setTimeout(() => {
      finish(() => { reject(new Error('Arkme 桌面位置桥响应超时')) })
    }, Math.max(1, Math.trunc(timeoutMillis)))
    void Promise.resolve().then(operation).then(
      value => { finish(() => { resolve(value) }) },
      error => { finish(() => { reject(error) }) },
    )
  })
}

function desktopBridgeTimeoutMillis(scope: ArkmeLocationRuntimeScope, fallback: number): number {
  return scope.desktopBridgeTimeoutMillis ?? fallback
}

export async function arkmeLocationPermissionState(
  scope: ArkmeLocationRuntimeScope = browserLocationRuntimeScope(),
): Promise<ArkmeLocationPermissionState> {
  const desktop = scope.arkmeDesktopLocation
  if (typeof desktop?.permissionState === 'function') {
    try {
      return desktopPermissionState(await withDesktopBridgeDeadline(
        () => desktop.permissionState(),
        desktopBridgeTimeoutMillis(scope, ARKME_DESKTOP_LOCATION_BRIDGE_TIMEOUT_MILLIS),
      ))
    }
    catch { return 'unavailable' }
  }
  const locationNavigator = scope.navigator
  if (typeof locationNavigator?.geolocation?.getCurrentPosition !== 'function') return 'unavailable'
  if (typeof locationNavigator.permissions?.query !== 'function') return 'prompt'
  try {
    const state = (await locationNavigator.permissions.query({ name: 'geolocation' as PermissionName })).state
    return state === 'granted' || state === 'denied' ? state : 'prompt'
  } catch {
    return 'prompt'
  }
}

/**
 * One location owner for every input surface.
 *
 * Explicit user actions may ask the desktop owner (or the browser fallback)
 * for permission. Automatic sends are strictly granted-only and can therefore
 * never create an unsolicited permission prompt.
 */
export async function captureArkmeRecordLocation(
  intent: ArkmeLocationCaptureIntent,
  scope: ArkmeLocationRuntimeScope = browserLocationRuntimeScope(),
): Promise<ArkmeRecordLocationCapture> {
  const desktop = scope.arkmeDesktopLocation
  const locationNavigator = scope.navigator
  const explicit = intent === 'explicit-user-action'
  let permission = await arkmeLocationPermissionState(scope)

  if (permission === 'prompt' && explicit && desktop !== undefined) {
    if (typeof desktop.requestPermission !== 'function') permission = 'unavailable'
    else {
      try {
        permission = desktopPermissionState(await withDesktopBridgeDeadline(
          () => desktop.requestPermission(),
          desktopBridgeTimeoutMillis(scope, ARKME_DESKTOP_LOCATION_PERMISSION_REQUEST_TIMEOUT_MILLIS),
        ))
      }
      catch { permission = 'unavailable' }
    }
  }

  // In a normal browser, getCurrentPosition is the permission request owner.
  // The desktop bridge is authoritative whenever it exists, so a desktop
  // prompt must be resolved by requestPermission before Web geolocation runs.
  const browserMayPrompt = explicit && desktop === undefined && permission === 'prompt'
  if (permission !== 'granted' && !browserMayPrompt) {
    throw permissionError(permission, { desktop: desktop !== undefined, explicit })
  }
  if (typeof locationNavigator?.geolocation?.getCurrentPosition !== 'function') {
    throw permissionError('unavailable', { desktop: desktop !== undefined, explicit })
  }

  return await new Promise((resolve, reject) => {
    locationNavigator.geolocation!.getCurrentPosition(position => {
      const { latitude, longitude, accuracy, altitude, speed } = position.coords
      resolve({
        latitude, longitude,
        capturedAtMillis: position.timestamp > 0 ? position.timestamp : Date.now(),
        ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracyMeters: accuracy } : {}),
        ...(altitude === null ? {} : { altitudeMeters: altitude }),
        ...(speed === null || speed < 0 ? {} : { speedMetersPerSecond: speed }),
      })
    }, error => { reject(geolocationError(error)) },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 })
  })
}

export async function requestArkmeRecordLocation(
  scope: ArkmeLocationRuntimeScope = browserLocationRuntimeScope(),
): Promise<ArkmeRecordLocationCapture> {
  return await captureArkmeRecordLocation('explicit-user-action', scope)
}

export function arkmeLocationSettingsAvailable(
  scope: ArkmeLocationRuntimeScope = browserLocationRuntimeScope(),
): boolean {
  return typeof scope.arkmeDesktopLocation?.openSettings === 'function'
}

export async function arkmeOpenLocationSettings(
  scope: ArkmeLocationRuntimeScope = browserLocationRuntimeScope(),
): Promise<boolean> {
  const openSettings = scope.arkmeDesktopLocation?.openSettings
  if (typeof openSettings !== 'function') return false
  try {
    return await withDesktopBridgeDeadline(
      async () => await openSettings.call(scope.arkmeDesktopLocation),
      desktopBridgeTimeoutMillis(scope, ARKME_DESKTOP_LOCATION_BRIDGE_TIMEOUT_MILLIS),
    )
  }
  catch { return false }
}

export function arkmeLocationErrorCanOpenSettings(error: unknown): boolean {
  return error instanceof ArkmeLocationCaptureError
    && ['prompt', 'denied', 'restricted', 'services-disabled', 'unavailable', 'position-unavailable'].includes(error.failure)
}

export type ArkmeRecordLocationForSendResult =
  | { state: 'captured'; location: ArkmeRecordLocationCapture; source: 'selected' | 'granted-preference' }
  | { state: 'disabled' }
  | { state: 'permission-required'; permission: Exclude<ArkmeLocationPermissionState, 'granted'> }
  | { state: 'failed'; message: string }

/**
 * Resolve one send-scoped location without ever opening a permission prompt.
 * The explicit composer button remains the only permission-request owner;
 * once granted, the enabled preference records each later message automatically.
 */
export async function captureArkmeRecordLocationForSend(
  enabled: boolean,
  selectedLocation?: ArkmeRecordLocationCapture,
  dependencies: {
    permissionState?: typeof arkmeLocationPermissionState
    requestLocation?: typeof requestArkmeRecordLocation
  } = {},
): Promise<ArkmeRecordLocationForSendResult> {
  if (selectedLocation !== undefined) {
    return { state: 'captured', location: selectedLocation, source: 'selected' }
  }
  if (!enabled) return { state: 'disabled' }
  const permission = await (dependencies.permissionState ?? arkmeLocationPermissionState)()
  if (permission !== 'granted') return { state: 'permission-required', permission }
  try {
    const location = dependencies.requestLocation === undefined
      ? await captureArkmeRecordLocation('automatic-send')
      : await dependencies.requestLocation()
    return { state: 'captured', location, source: 'granted-preference' }
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : '位置采集失败，请稍后重试' }
  }
}
