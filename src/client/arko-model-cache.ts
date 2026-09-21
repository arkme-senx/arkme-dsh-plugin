import type { ArkmeArkoModelCatalog } from '../types.js'

const FRESH_FOR_MS = 5 * 60 * 1000
interface Entry {
  catalog?: ArkmeArkoModelCatalog
  expiresAt: number
  pending?: Promise<void>
}

/** Memory only: a new renderer starts empty. Keys include environment and account. */
export class ArkoModelCache {
  private readonly entries = new Map<string, Entry>()
  private readonly selections = new Map<string, Promise<ArkmeArkoModelCatalog>>()
  private revision = 0
  readonly getRevision = () => this.revision
  isSelecting(key: string | undefined): boolean { return key !== undefined && this.selections.has(key) }
  private readonly listeners = new Set<() => void>()
  constructor(private readonly now: () => number = Date.now) {}
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  get(key: string | undefined): ArkmeArkoModelCatalog | undefined {
    return key === undefined ? undefined : this.entries.get(key)?.catalog
  }
  set(key: string, catalog: ArkmeArkoModelCatalog): void {
    // Replace the entry to invalidate older requests, including ones before a model switch.
    this.entries.set(key, { catalog, expiresAt: this.now() + FRESH_FOR_MS })
    this.publish()
  }
  clear(): void { this.entries.clear(); this.selections.clear(); this.publish() }
  select(key: string, fetch: () => Promise<ArkmeArkoModelCatalog>): Promise<ArkmeArkoModelCatalog> {
    const existing = this.selections.get(key)
    if (existing) return existing
    const pending = Promise.resolve().then(fetch).then(catalog => {
      if (this.selections.get(key) === pending) this.set(key, catalog)
      return catalog
    }).finally(() => {
      if (this.selections.get(key) === pending) { this.selections.delete(key); this.publish() }
    })
    this.selections.set(key, pending)
    this.publish()
    return pending
  }
  load(key: string, fetch: () => Promise<ArkmeArkoModelCatalog>): Promise<void> {
    let entry = this.entries.get(key)
    if (entry?.catalog && this.now() < entry.expiresAt) return Promise.resolve()
    if (entry?.pending) return entry.pending
    if (!entry) { entry = { expiresAt: 0 }; this.entries.set(key, entry) }
    const current = entry
    current.pending = fetch().then(catalog => {
      if (this.entries.get(key) === current) this.set(key, catalog)
    }).finally(() => { delete current.pending })
    return current.pending
  }
  private publish(): void { this.revision += 1; for (const listener of this.listeners) listener() }
}
export const arkoModelCache = new ArkoModelCache()
