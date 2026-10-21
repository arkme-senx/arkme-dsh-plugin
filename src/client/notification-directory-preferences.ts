import { useSyncExternalStore } from 'react'

const prefix = 'arkme.notification.directory.pin.v1:'

/** Local presentation only. The full environment/account key keeps profiles separate. */
export class NotificationDirectoryPreferences {
  private listeners = new Set<() => void>()
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  invalidate = () => { for (const listener of this.listeners) listener() }
  read = (account: string): boolean => {
    if (!account) return false
    try { return this.storage()?.getItem(prefix + account) === 'true' } catch { return false }
  }
  pin(account: string, pinned: boolean): void {
    if (!account) throw new Error('请先登录')
    try {
      const storage = this.storage()
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(prefix + account, String(pinned))
    } catch { throw new Error('本机设置保存失败，请重试') }
    this.invalidate()
  }
}

export const notificationDirectoryPreferences = new NotificationDirectoryPreferences(() => {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
})
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith(prefix)) notificationDirectoryPreferences.invalidate()
})
export const useNotificationDirectoryPin = (account: string) => useSyncExternalStore(
  notificationDirectoryPreferences.subscribe,
  () => notificationDirectoryPreferences.read(account),
  () => false,
)
