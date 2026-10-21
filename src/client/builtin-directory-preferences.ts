import { useSyncExternalStore } from 'react'
import { localDirectoryPreferences, useLocalDirectoryPreferenceHydration } from './local-directory-preferences.js'

export type BuiltinConversation = 'self' | 'arko' | 'harness'
export type BuiltinPins = Partial<Record<BuiltinConversation, number>>
const prefix = 'arkme.builtin.directory.pins.v1:'
const entries: BuiltinConversation[] = ['self', 'arko', 'harness']

/** Local display preferences only; never persist message contents or access references. */
export class BuiltinDirectoryPreferences {
  private listeners = new Set<() => void>()
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined, private durable = false) {
    if (durable) localDirectoryPreferences.subscribe(this.invalidate)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  invalidate = () => { for (const listener of this.listeners) listener() }
  snapshot = (account: string): string => {
    if (this.durable) {
      const pins: BuiltinPins = {}
      for (const entry of entries) { const value = localDirectoryPreferences.read(account)[`builtin:${entry}`]; if (value?.pinned) pins[entry] = Math.max(1, value.pinnedAt) }
      return JSON.stringify(pins)
    }
    try { return account ? this.storage()?.getItem(prefix + account) ?? '{}' : '{}' } catch { return '{}' }
  }
  read(account: string): BuiltinPins { return parseBuiltinPins(this.snapshot(account)) }
  pin(account: string, entry: BuiltinConversation, pinned: boolean): void | Promise<void> {
    if (!account) throw new Error('请先登录')
    if (this.durable) {
      const nextTime = Math.max(Date.now(), ...Object.values(localDirectoryPreferences.read(account)).map(value => value.pinnedAt + 1))
      return localDirectoryPreferences.set(account, `builtin:${entry}`, { pinned, pinnedAt: pinned ? nextTime : 0 })
    }
    const next = this.read(account)
    if (pinned) next[entry] = Math.max(Date.now(), ...Object.values(next).map(value => value + 1))
    else delete next[entry]
    try {
      const storage = this.storage()
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(prefix + account, JSON.stringify(next))
    } catch { throw new Error('本机设置保存失败，请重试') }
    this.invalidate()
  }
}
export function parseBuiltinPins(value: string): BuiltinPins {
  try {
    const parsed = JSON.parse(value), result: BuiltinPins = {}
    for (const key of entries) if (Number.isFinite(parsed?.[key]) && parsed[key] > 0) result[key] = parsed[key]
    return result
  } catch { return {} }
}
export const builtinDirectoryPreferences = new BuiltinDirectoryPreferences(() => undefined, true)
export function useBuiltinDirectoryPins(account: string) {
  useLocalDirectoryPreferenceHydration(account)
  return useSyncExternalStore(builtinDirectoryPreferences.subscribe, () => builtinDirectoryPreferences.snapshot(account), () => '{}')
}
