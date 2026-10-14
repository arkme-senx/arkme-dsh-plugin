import { asDshRemoteError } from './errors.js'

/** One Host owns conflict isolation. A rejected identity never ACKs, but cannot
 * starve unrelated new sessions. Failed snapshots remain explicitly incomplete.
 * Cache metadata only; account teardown clears it, retries resume after 5 min. */
export class ProjectionUpload {
  private readonly rejected = new Map<string, number>()
  clear(): void { this.rejected.clear() }
  async page<T extends { session_ref: string }>(items: T[], send: (items: T[]) => Promise<unknown>, signal: AbortSignal): Promise<{ accepted: number; rejected: number }> {
    signal.throwIfAborted()
    const now = Date.now()
    for (const [id, until] of this.rejected) if (until <= now) this.rejected.delete(id)
    const pending = items.filter(item => !this.rejected.has(item.session_ref))
    const result = { accepted: 0, rejected: items.length - pending.length }
    const upload = async (batch: T[]): Promise<void> => {
      signal.throwIfAborted()
      try { await send(batch); signal.throwIfAborted(); result.accepted += batch.length }
      catch (error) {
        signal.throwIfAborted()
        if (asDshRemoteError(error).code !== 'REMOTE_PROJECTION_CONFLICT') throw error
        if (batch.length <= 1) {
          if (!batch.length) throw error
          if (this.rejected.size >= 10_000) this.rejected.delete(this.rejected.keys().next().value!)
          this.rejected.set(batch[0]!.session_ref, Date.now() + 300_000)
          result.rejected++; return
        }
        // Sequential bisection keeps one request in flight and at most 2N-1
        // attempts for a page; known conflicts skip requests on later polls.
        const middle = Math.floor(batch.length / 2)
        await upload(batch.slice(0, middle)); await upload(batch.slice(middle))
      }
    }
    if (pending.length || !items.length) await upload(pending)
    return result
  }
}
