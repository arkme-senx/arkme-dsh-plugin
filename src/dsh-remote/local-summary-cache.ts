type Summary = { updatedAt: number; projectionAsOfSeq?: number; running: boolean }

/** One account-owned metadata snapshot for every page/window. Events invalidate
 * it; the short fallback TTL covers old DSH versions with incomplete events. */
export class LocalSummaryCache {
  private generation = 0
  private cached: { value: Map<string, Summary>; until: number; generation: number } | undefined
  private flight: { value: Promise<Map<string, Summary>>; generation: number } | undefined
  constructor(private readonly read: () => Promise<Map<string, Summary>>) {}
  invalidate(): void { this.generation++; this.cached = undefined }
  clear(): void { this.invalidate() }
  async get(signal: AbortSignal): Promise<Map<string, Summary>> {
    signal.throwIfAborted()
    if (this.cached && this.cached.until > Date.now()) return this.cached.value
    const generation = this.generation
    if (!this.flight) {
      const value = this.read().then(value => {
        if (value.size > 10_000) throw new Error('Local summary limit exceeded')
        if (this.generation === generation) this.cached = { value, generation, until: Date.now() + 30_000 }
        return value
      })
      const flight = { value, generation }
      this.flight = flight
      void value.finally(() => { if (this.flight === flight) this.flight = undefined }).catch(() => undefined)
    }
    const flight = this.flight
    const value = await flight.value
    signal.throwIfAborted()
    if (flight.generation !== this.generation) throw new Error('Local directory changed during read')
    return value
  }
}
