/** Bounded retention of confirmed sends until the authoritative timeline catches up. */
export class ConfirmedSendRetentionOwner<T> {
  private readonly entries = new Map<string, { sourceKey: string; item: T; expiresAtMillis: number }>()

  constructor(private readonly options: {
    maxItems: number
    ttlMillis: number
    key(item: T): string
    canRetain(item: T): boolean
    isAuthoritative(item: T): boolean
    merge(local: T[], remote: T[]): T[]
  }) {}

  retain(sourceKey: string, item: T, nowMillis = Date.now()): void {
    const id = this.options.key(item)
    if (!sourceKey || !id.trim() || !this.options.canRetain(item)) return
    const key = `${sourceKey}\0${id}`
    this.entries.delete(key)
    this.entries.set(key, {
      sourceKey, item: { ...item }, expiresAtMillis: nowMillis + this.options.ttlMillis,
    })
    while (this.entries.size > this.options.maxItems) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  forget(sourceKey: string, ids: readonly string[]): void {
    for (const id of ids) this.entries.delete(`${sourceKey}\0${id}`)
  }

  clear(): void { this.entries.clear() }

  merge(sourceKey: string, authoritative: T[], nowMillis = Date.now()): T[] {
    const retained: T[] = []
    const byId = new Map(authoritative.map(item => [this.options.key(item), item]))
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMillis <= nowMillis) { this.entries.delete(key); continue }
      if (entry.sourceKey !== sourceKey) continue
      retained.push(entry.item)
      const remote = byId.get(this.options.key(entry.item))
      if (remote !== undefined && this.options.isAuthoritative(remote)) this.entries.delete(key)
    }
    return this.options.merge(retained, authoritative)
  }
}
