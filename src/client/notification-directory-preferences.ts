import { useSyncExternalStore } from 'react'
import { localDirectoryPreferences, useLocalDirectoryPreferenceHydration } from './local-directory-preferences.js'

const prefix = 'arkme.notification.directory.pin.v1:'

/** Local presentation only. The full environment/account key keeps profiles separate. */
export class NotificationDirectoryPreferences {
  private listeners = new Set<() => void>()
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined, private durable = false) {
    if (durable) localDirectoryPreferences.subscribe(this.invalidate)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  invalidate = () => { for (const listener of this.listeners) listener() }
  read = (account: string): boolean => {
    if (!account) return false
    if (this.durable) return localDirectoryPreferences.read(account).notification?.pinned === true
    try { return this.storage()?.getItem(prefix + account) === 'true' } catch { return false }
  }
  pin(account: string, pinned: boolean): void | Promise<void> {
    if (!account) throw new Error('请先登录')
    if (this.durable) return localDirectoryPreferences.set(account, 'notification', { pinned, pinnedAt: pinned ? Date.now() : 0 })
    try {
      const storage = this.storage()
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(prefix + account, String(pinned))
    } catch { throw new Error('本机设置保存失败，请重试') }
    this.invalidate()
  }
}

export const notificationDirectoryPreferences = new NotificationDirectoryPreferences(() => undefined, true)
export function useNotificationDirectoryPin(account: string) {
  useLocalDirectoryPreferenceHydration(account)
  return useSyncExternalStore(notificationDirectoryPreferences.subscribe, () => notificationDirectoryPreferences.read(account), () => false)
}
