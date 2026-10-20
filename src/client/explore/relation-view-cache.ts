import type { ExploreDetail, ExploreItem, ExplorePage } from '../../explore-contract.js'
import { arkmeAuthStore } from '../auth-store.js'

const PREFIX = 'dsh-arkme:relation-view:v1:'
const MAX_AGE = 6 * 60 * 60 * 1000 // References expire after 24 hours; never revive them by merely viewing a cache.
const MAX_ENTRY = 300_000
const MAX_TOTAL = 2_000_000
interface Entry<T> { at: number; value: T }
export interface RelationView {
  filter: string; query: string; page: ExplorePage; selected?: ExploreItem
  listTop: number; detailTop: number; savedAt: number
}
export interface RelationDetail {
  detail: ExploreDetail; recordsAt: number; overviewAt: number; firstKeys: string[]
}

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

/** Optional, bounded read cache. Failed storage must never prevent a live read. */
export class RelationViewCache {
  private memory = new Map<string, Entry<unknown>>()
  constructor(private readonly storage = browserStorage, private readonly now = Date.now, private readonly allowed = (_scope: string) => true) {}
  private key(scope: string, key: string) { return `${PREFIX}${encodeURIComponent(scope)}:${key}` }
  read<T>(scope: string, key: string, validate: (value: unknown) => value is T): Entry<T> | undefined {
    if (!scope || !this.allowed(scope)) return
    const id = this.key(scope, key)
    let entry = this.memory.get(id)
    try {
      if (!entry) {
        const raw = this.storage()?.getItem(id)
        if (raw && raw.length <= MAX_ENTRY) entry = JSON.parse(raw) as Entry<unknown>
      }
      if (entry && Number.isFinite(entry.at) && entry.at <= this.now() && this.now() - entry.at < MAX_AGE && validate(entry.value)) {
        this.memory.set(id, entry)
        return entry as Entry<T>
      }
    } catch { /* Corrupt or unavailable storage is a cache miss. */ }
    this.remove(scope, key)
  }
  write<T>(scope: string, key: string, value: T, at: number): void {
    if (!scope || !this.allowed(scope) || !Number.isFinite(at) || at <= 0) return
    const id = this.key(scope, key), entry = { at, value }
    this.memory.delete(id); this.memory.set(id, entry)
    if (this.memory.size > 24) this.memory.delete(this.memory.keys().next().value!)
    try {
      const target = this.storage(), raw = JSON.stringify(entry)
      if (!target || raw.length > MAX_ENTRY) { target?.removeItem(id); return }
      const entries: Array<{ key: string; size: number; at: number }> = []
      for (let i = 0; i < target.length; i++) {
        const k = target.key(i)
        if (!k?.startsWith(PREFIX) || k === id) continue
        const content = target.getItem(k) ?? ''
        let time = 0
        try { time = Number(JSON.parse(content).at) || 0 } catch { /* Evict malformed entries first. */ }
        entries.push({ key: k, size: content.length, at: time })
      }
      let size = raw.length + entries.reduce((sum, e) => sum + e.size, 0), count = entries.length + 1
      for (const e of entries.sort((a, b) => a.at - b.at)) {
        if (size <= MAX_TOTAL && count <= 20) break
        target.removeItem(e.key); size -= e.size; count--
      }
      target.setItem(id, raw)
    } catch { /* Quota/private-mode failures retain the in-memory result. */ }
  }
  remove(scope: string, key: string): void {
    const id = this.key(scope, key); this.memory.delete(id)
    try { this.storage()?.removeItem(id) } catch { /* Optional storage. */ }
  }
  clear(): void {
    this.memory.clear()
    try {
      const target = this.storage(); if (!target) return
      for (let i = target.length - 1; i >= 0; i--) {
        const key = target.key(i); if (key?.startsWith(PREFIX)) target.removeItem(key)
      }
    } catch { /* Optional storage. */ }
  }
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const item = (v: unknown): v is ExploreItem => object(v) && ['key','ref','title','summary','category','status'].every(k => typeof v[k] === 'string') && typeof v.date === 'number'
export function isRelationView(v: unknown): v is RelationView {
  return object(v) && typeof v.filter === 'string' && typeof v.query === 'string' && object(v.page)
    && v.page.module === 'relations' && Array.isArray(v.page.items) && v.page.items.every(item)
    && Array.isArray(v.page.filters) && v.page.filters.every(f => object(f) && typeof f.key === 'string' && typeof f.label === 'string')
    && Array.isArray(v.page.actions) && typeof v.page.total === 'number' && typeof v.page.contextRef === 'string'
    && (v.selected === undefined || item(v.selected))
    && ['listTop','detailTop','savedAt'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))
}
export function isRelationDetail(v: unknown): v is RelationDetail {
  return object(v) && object(v.detail) && item(v.detail.item) && Array.isArray(v.detail.evidence)
    && v.detail.evidence.every(e => object(e) && typeof e.key === 'string' && typeof e.text === 'string' && typeof e.label === 'string')
    && Array.isArray(v.detail.fields) && v.detail.fields.every(f => object(f) && typeof f.label === 'string' && typeof f.value === 'string')
    && Array.isArray(v.detail.actions) && Array.isArray(v.firstKeys) && v.firstKeys.every(k => typeof k === 'string')
    && typeof v.recordsAt === 'number' && typeof v.overviewAt === 'number'
}
export const relationViewCache = new RelationViewCache(browserStorage, Date.now, scope => {
  const { auth, checked } = arkmeAuthStore.getSnapshot()
  return !checked || auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === scope
})
let activeScope: string | undefined
arkmeAuthStore.subscribe(() => {
  const { auth, checked } = arkmeAuthStore.getSnapshot()
  if (!checked || !auth) return
  const scope = auth.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  if (!scope || activeScope !== undefined && scope !== activeScope) relationViewCache.clear()
  activeScope = scope
})
