import { useSyncExternalStore } from 'react'
import { normalizeRecentEmojiIds, isRecentEmojiId, type RecentEmojiStore } from '../emoji-recent.js'
import { callArkme } from './api.js'

type Snapshot = { ids: string[]; phase: 'idle' | 'loading' | 'ready' | 'error'; failedId?: string | undefined }
type Account = {
 snapshot: Snapshot; revision: number; listeners: Set<() => void>; pending: number
 tail: Promise<void>; read?: Promise<string[]> | undefined; dirty: Map<string, number>; failed: Set<string>
}
const empty: Snapshot = {ids: [], phase: 'idle'}
/** One account cache per Browser module; Host SQLite remains the sole durable authority. */
export class RecentEmojiCache implements RecentEmojiStore {
 private accounts = new Map<string, Account>()
 private account(key: string): Account {
  let state = this.accounts.get(key)
  if (!state) {
   if (this.accounts.size >= 8) {
    const idle = [...this.accounts].find(([,value]) => !value.listeners.size && !value.pending && !value.read && !value.dirty.size)
    if (!idle) throw new Error('最近表情缓存繁忙')
    this.accounts.delete(idle[0])
   }
   state = {snapshot: empty, revision: 0, listeners: new Set(), pending: 0, tail: Promise.resolve(), dirty: new Map(), failed: new Set()}
   this.accounts.set(key,state)
  }
  return state
 }
 private notify(state: Account, next: Snapshot): void { state.snapshot = next; for (const listener of state.listeners) listener() }
 snapshot = (key?: string): Snapshot => key ? this.account(key).snapshot : empty
 subscribe = (key: string | undefined, listener: () => void): (() => void) => {
  if (!key) return () => {}
  const state = this.account(key); state.listeners.add(listener)
  return () => { state.listeners.delete(listener) }
 }
 recentEmojiIds(key: string): Promise<string[]> {
  const state = this.account(key)
  if (state.read) return state.read
  const revision = state.revision
  this.notify(state,{...state.snapshot,phase:'loading'})
  const read = state.tail.then(() => callArkme<string[]>('emoji.recent.list',{accountKey:key},AbortSignal.timeout(2_000)))
   .then(ids => {
    if (state.revision === revision) this.notify(state,{...state.snapshot, ids:state.dirty.size ? state.snapshot.ids : normalizeRecentEmojiIds(ids), phase:'ready'})
    return state.snapshot.ids
   }, error => { this.notify(state,{...state.snapshot,phase:state.revision === revision ? 'error' : state.snapshot.phase}); throw error })
   .finally(() => { if (state.read === read) state.read = undefined })
  state.read = read
  return read
 }
 recordRecentEmoji(key: string, id: string): Promise<string[]> {
  if (!isRecentEmojiId(id)) return Promise.reject(new Error('表情不存在'))
  const state = this.account(key)
  if (state.pending >= 64) return Promise.reject(new Error('最近表情保存繁忙'))
  const revision = ++state.revision
  state.dirty.set(id,revision)
  this.notify(state,{ids:normalizeRecentEmojiIds([id,...state.snapshot.ids]),phase:'ready',failedId:state.snapshot.failedId === id ? undefined : state.snapshot.failedId})
  state.pending++
  const result = state.tail.then(() => callArkme<string[]>('emoji.recent.record',{accountKey:key,emojiId:id},AbortSignal.timeout(2_000)))
   .then(ids => {
    if (state.dirty.get(id) === revision) { state.dirty.delete(id); state.failed.delete(id) }
    this.notify(state,{...state.snapshot,failedId:state.failed.values().next().value,ids:state.revision === revision && !state.dirty.size ? normalizeRecentEmojiIds(ids) : state.snapshot.ids})
    return normalizeRecentEmojiIds(ids)
   }, error => { state.failed.add(id); this.notify(state,{...state.snapshot,failedId:state.failed.values().next().value}); throw error })
  state.tail = result.then(() => undefined, () => undefined).finally(() => { state.pending-- })
  return result
 }
 /** Preferences are best effort on exit: never consume the native 5-second draft barrier. */
 async flush(key: string): Promise<void> {
  const tail = this.accounts.get(key)?.tail
  if (!tail) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([tail,new Promise<void>(resolve => { timer = setTimeout(resolve,2_000) })]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
 }
 /** Account cache invalidation; pending saves retain their own state until settled. */
 clear(): void { this.accounts.clear() }
}
export const arkmeRecentEmojiStore = new RecentEmojiCache()
export function useRecentEmoji(key?: string): Snapshot {
 return useSyncExternalStore(listener => arkmeRecentEmojiStore.subscribe(key,listener), () => arkmeRecentEmojiStore.snapshot(key), () => empty)
}
