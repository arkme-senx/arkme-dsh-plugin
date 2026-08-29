import type { ArkmeRecordLocationCapture, ArkmeSourceItem } from '../types.js'

const LOCATION_ENABLED_PREFIX = 'arkme.record-capture.location.enabled.'
const listeners = new Set<() => void>()

function storageKey(userId: number | undefined): string { return `${LOCATION_ENABLED_PREFIX}${String(userId ?? 0)}` }

export function arkmeSourceSupportsLocationCapture(kind: ArkmeSourceItem['kind'] | undefined): boolean {
  return kind === 'private_chat' || kind === 'group_chat' || kind === 'send_to_self'
    || kind === 'default_category' || kind === 'topic'
}

export function arkmeLocationCaptureEnabled(userId: number | undefined): boolean {
  try { return window.localStorage.getItem(storageKey(userId)) === 'enabled' } catch { return false }
}

export function setArkmeLocationCaptureEnabled(userId: number | undefined, enabled: boolean): void {
  try { window.localStorage.setItem(storageKey(userId), enabled ? 'enabled' : 'disabled') } catch { /* local preference is optional */ }
  for (const listener of listeners) listener()
}

export function subscribeArkmeLocationCapturePreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function arkmeLocationPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  if (!('geolocation' in navigator)) return 'unavailable'
  const permissions = navigator as Navigator & { permissions?: { query?: (descriptor: PermissionDescriptor) => Promise<{ state: PermissionState }> } }
  if (typeof permissions.permissions?.query !== 'function') return 'prompt'
  try { return (await permissions.permissions.query({ name: 'geolocation' as PermissionName })).state } catch { return 'prompt' }
}

export function requestArkmeRecordLocation(): Promise<ArkmeRecordLocationCapture> {
  if (!('geolocation' in navigator)) return Promise.reject(new Error('当前浏览器不支持位置采集'))
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy, altitude, speed } = position.coords
      resolve({
        latitude, longitude,
        capturedAtMillis: position.timestamp > 0 ? position.timestamp : Date.now(),
        ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracyMeters: accuracy } : {}),
        ...(altitude === null ? {} : { altitudeMeters: altitude }),
        ...(speed === null || speed < 0 ? {} : { speedMetersPerSecond: speed }),
      })
    }, error => reject(new Error(error.code === error.PERMISSION_DENIED ? '你未允许浏览器记录位置' : '位置采集失败，请稍后重试')),
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 })
  })
}
