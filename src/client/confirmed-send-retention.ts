/** Bounded retention of confirmed sends until the authoritative timeline catches up. */
export class ConfirmedSendRetentionOwner<T> {
  private readonly entries = new Map<string, { sourceKey: string; item: T; expiresAtMillis: number }>()

  constructor(private readonly options: {
    maxItems: number
    ttlMillis: number
    key(item: T): string
    canRetain(item: T): boolean
    isAuthoritative(item: T): boolean
    isTerminal?(item: T): boolean
    merge(local: T[], remote: T[]): T[]
  }) {}

  retain(sourceKey: string, item: T, nowMillis = Date.now()): void {
    const id = this.options.key(item)
    if (!sourceKey || !id.trim() || !this.options.canRetain(item)) return
    const key = `${sourceKey}\0${id}`
    const previous = this.entries.get(key)
    const next = previous ? this.options.merge([previous.item], [item]).find(value => this.options.key(value) === id) ?? item : item
    this.entries.delete(key)
    this.entries.set(key, {
      sourceKey, item: { ...next }, expiresAtMillis: nowMillis + this.options.ttlMillis,
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
    for (const item of authoritative) {
      if (this.options.isTerminal?.(item)) this.retain(sourceKey, item, nowMillis)
    }
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMillis <= nowMillis) { this.entries.delete(key); continue }
      if (entry.sourceKey !== sourceKey) continue
      const remote = byId.get(this.options.key(entry.item))
      // Keep terminal knowledge in this existing bounded owner, without adding
      // historical placeholders to unrelated windows. Late ACKs still merge it.
      if (!this.options.isTerminal?.(entry.item) || remote !== undefined) retained.push(entry.item)
      if (remote !== undefined && this.options.isAuthoritative(remote) && !this.options.isTerminal?.(entry.item)) this.entries.delete(key)
    }
    return this.options.merge(retained, authoritative)
  }
}
