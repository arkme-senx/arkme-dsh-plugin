import { useEffect, useSyncExternalStore } from 'react'
import { normalizeLocalDirectoryPreferences, type LocalDirectoryPreference, type LocalDirectoryPreferences } from '../local-directory-preferences.js'
import { callArkme } from './api.js'

type Transport = (operation: 'directory.preferences.read' | 'directory.preferences.set' | 'directory.preferences.migrate', input: Record<string, unknown>) => Promise<unknown>
const empty: LocalDirectoryPreferences = Object.freeze({})
type State = { saved: LocalDirectoryPreferences; view: LocalDirectoryPreferences; pending: Map<string, { version: number; value: LocalDirectoryPreference }>; queue: Promise<unknown>; loading?: Promise<void> | undefined; loaded: boolean }
/** The Host owns persistence. Renderer memory is an optimistic projection, independent of window origin. */
export class LocalDirectoryPreferenceStore {
  private states = new Map<string, State>()
  private listeners = new Set<() => void>()
  private version = 0
  private errors = new Map<string, string>()
  error = (account: string) => this.errors.get(account) ?? ''
  constructor(private transport: Transport, private legacy: (account: string) => LocalDirectoryPreferences = () => ({})) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private state(account: string) {
    let value = this.states.get(account)
    if (!value) { value = { saved: empty, view: empty, pending: new Map(), queue: Promise.resolve(), loaded: false }; this.states.set(account, value) }
    return value
  }
  read = (account: string): LocalDirectoryPreferences => account ? this.state(account).view : empty
  private publish(state: State) {
    state.view = { ...state.saved, ...Object.fromEntries([...state.pending].map(([key, item]) => [key, item.value])) }
    for (const listener of this.listeners) listener()
  }
  hydrate(account: string, force = false): Promise<void> {
    if (!account) return Promise.resolve()
    const state = this.state(account)
    if (state.loading) return state.loading
    if (state.loaded && !force) return Promise.resolve()
    const run = state.queue.catch(() => {}).then(async () => {
      const entries = normalizeLocalDirectoryPreferences(this.legacy(account))
      const result = await this.transport(Object.keys(entries).length ? 'directory.preferences.migrate' : 'directory.preferences.read', { accountKey: account, ...(Object.keys(entries).length ? { entries } : {}) })
      state.saved = normalizeLocalDirectoryPreferences(result); state.loaded = true; this.errors.delete(account); this.publish(state)
    })
    state.loading = run.catch(error => { this.errors.set(account, '本机置顶设置读取失败，请重试'); this.publish(state); throw error }).finally(() => { state.loading = undefined }); state.queue = state.loading
    return state.loading
  }
  set(account: string, key: string, value: LocalDirectoryPreference): Promise<void> {
    if (!account) return Promise.reject(new Error('请先登录'))
    const entries = normalizeLocalDirectoryPreferences({ [key]: value })
    if (!entries[key]) return Promise.reject(new Error('本机设置内容无效'))
    const state = this.state(account), version = ++this.version
    state.pending.set(key, { version, value: entries[key] }); this.publish(state)
    const run = state.queue.catch(() => {}).then(async () => {
      try {
        const result = await this.transport('directory.preferences.set', { accountKey: account, entries })
        state.saved = normalizeLocalDirectoryPreferences(result); this.errors.delete(account)
      } catch {
        this.errors.set(account, '本机设置保存未确认，请重试')
        throw new Error('本机设置保存未确认，请重试')
      } finally {
        if (state.pending.get(key)?.version === version) state.pending.delete(key)
        this.publish(state)
      }
    })
    state.queue = run
    return run
  }
}

export function readLegacyDirectoryPreferences(account: string, storage?: Pick<Storage, 'getItem'>): LocalDirectoryPreferences {
  const entries: LocalDirectoryPreferences = {}
  const read = (prefix: string) => { try { return JSON.parse(storage?.getItem(prefix + account) ?? 'null') } catch { return undefined } }
  const builtin = read('arkme.builtin.directory.pins.v1:')
  for (const kind of ['self', 'arko', 'harness']) if (Number.isSafeInteger(builtin?.[kind]) && builtin[kind] > 0) entries[`builtin:${kind}`] = { pinned: true, pinnedAt: builtin[kind] }
  const notification = read('arkme.notification.directory.pin.v1:')
  if (typeof notification === 'boolean') entries.notification = { pinned: notification, pinnedAt: 0 }
  const team = read('arkme.team.directory.preferences.v1:')
  if (team && typeof team === 'object' && !Array.isArray(team)) for (const [key, value] of Object.entries(team)) {
    if (value && typeof value === 'object') entries[`team:${key}`] = { ...value, pinnedAt: 0 } as LocalDirectoryPreference
  }
  return normalizeLocalDirectoryPreferences(entries)
}
export const localDirectoryPreferences = new LocalDirectoryPreferenceStore(
  (operation, input) => callArkme(operation, input, AbortSignal.timeout(10_000)),
  account => { try { return readLegacyDirectoryPreferences(account, window.localStorage) } catch { return {} } },
)
export function useLocalDirectoryPreferenceHydration(account: string) {
  useEffect(() => {
    if (!account) return
    const load = () => { void localDirectoryPreferences.hydrate(account, true).catch(() => {}) }
    void localDirectoryPreferences.hydrate(account).catch(() => {})
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [account])
}

export function useDirectoryPreferenceError(account: string) {
  return useSyncExternalStore(localDirectoryPreferences.subscribe, () => localDirectoryPreferences.error(account), () => '')
}
