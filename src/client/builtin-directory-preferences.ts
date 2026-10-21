import { useSyncExternalStore } from 'react'

export type BuiltinConversation = 'self' | 'arko' | 'harness'
export type BuiltinPins = Partial<Record<BuiltinConversation, number>>
const prefix = 'arkme.builtin.directory.pins.v1:'
const entries: BuiltinConversation[] = ['self', 'arko', 'harness']

/** Local display preferences only; never persist message contents or access references. */
export class BuiltinDirectoryPreferences {
  private listeners = new Set<() => void>()
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  invalidate = () => { for (const listener of this.listeners) listener() }
  snapshot = (account: string): string => {
    try { return account ? this.storage()?.getItem(prefix + account) ?? '{}' : '{}' } catch { return '{}' }
  }
  read(account: string): BuiltinPins { return parseBuiltinPins(this.snapshot(account)) }
  pin(account: string, entry: BuiltinConversation, pinned: boolean): void {
    if (!account) throw new Error('请先登录')
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
export const builtinDirectoryPreferences = new BuiltinDirectoryPreferences(() => {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
})
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith(prefix)) builtinDirectoryPreferences.invalidate()
})
export const useBuiltinDirectoryPins = (account: string) => useSyncExternalStore(
  builtinDirectoryPreferences.subscribe, () => builtinDirectoryPreferences.snapshot(account), () => '{}',
)
