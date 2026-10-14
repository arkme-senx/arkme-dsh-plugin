import { contentCovers, type ContentProof } from './history-content-proof.js'
import type { DshAccountSession } from './account-session-types.js'

export type LocalHistoryCut = { runtimeRef: string; updatedAt: number; projectionAsOfSeq: number }
export interface LocalAliasReader {
  summaries(refs: string[], signal: AbortSignal): Promise<Map<string, { updatedAt: number; projectionAsOfSeq?: number; running: boolean }>>
  content(session: string, through: number, signal: AbortSignal): Promise<ContentProof>
}
/** A bounded, account-owned proof cache shared by Tools, SDK and all windows.
 * Unknown, rewritten, incomplete or divergent histories always keep both rows.
 * It never mutates either history or grants a retired runtime write authority. */
export class LocalHistoryCoverage {
  private readonly entries = new Map<string, { signature: string; cloudSignature: string; cut: LocalHistoryCut; state: 'pending' | 'complete'; covered: false | 'local' | 'cloud'; retryAt: number }>()
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  constructor(private readonly local: LocalAliasReader, private readonly cloud: (row: DshAccountSession, signal: AbortSignal) => Promise<ContentProof>, private readonly readable: (row: DshAccountSession, signal: AbortSignal) => Promise<boolean>) {}
  clear(): void { this.entries.clear() }
  async annotate(rows: DshAccountSession[], runtime: string, signal: AbortSignal): Promise<void> {
    const candidates = rows.filter(row => !row.local && !row.archived && row.origin !== 'subagent' && row.contentRevision && row.historyRevision && row.previousRuntimeRefs?.includes(runtime))
    if (!candidates.length) return
    const summaries = await this.local.summaries(candidates.map(row => row.sessionRef), signal)
    signal.throwIfAborted()
    for (const row of candidates) {
      const local = summaries.get(row.sessionRef)
      if (!local || !Number.isSafeInteger(local.projectionAsOfSeq ?? -1) || (local.projectionAsOfSeq ?? -1) < -1 || !Number.isSafeInteger(local.updatedAt)) continue
      const cut = { runtimeRef: runtime, updatedAt: local.updatedAt, projectionAsOfSeq: local.projectionAsOfSeq ?? -1 }
      const cloudSignature = JSON.stringify([row.runtimeRef, row.historyRevision, row.contentRevision, row.projectionAsOfSeq, row.updatedAt])
      const signature = JSON.stringify([cloudSignature, cut])
      const key = JSON.stringify([runtime, row.runtimeRef, row.sessionRef])
      const previous = this.entries.get(key)
      // Native journals are append-only (replacement events retain the old
      // records). A local superset remains a superset while only it advances.
      if (previous?.covered === 'local' && previous.cloudSignature === cloudSignature
        && cut.projectionAsOfSeq >= previous.cut.projectionAsOfSeq && cut.updatedAt >= previous.cut.updatedAt) {
        row.coveredLocalHistory = { ...previous.cut, source: 'local' }; continue
      }
      if (local.running) continue
      if (previous?.signature === signature) {
        if (previous.covered) row.coveredLocalHistory = { ...cut, source: previous.covered }
        if (previous.state === 'pending' || previous.covered || Date.now() < previous.retryAt) continue
      }
      // No unbounded queue from a large catalog or simultaneous windows.
      if (this.pending >= 16) continue
      if (this.entries.size >= 256 && !this.entries.has(key)) {
        const removable = [...this.entries].find(([, value]) => value.state === 'complete')
        if (!removable) continue
        this.entries.delete(removable[0])
      }
      const entry = { signature, cloudSignature, cut, state: 'pending' as 'pending' | 'complete', covered: false as false | 'local' | 'cloud', retryAt: 0 }
      this.entries.set(key, entry); this.pending++
      this.tail = this.tail.catch(() => undefined).then(async () => {
        try {
          signal.throwIfAborted()
          if (this.entries.get(key) !== entry) return
          const scoped = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          entry.covered = await this.verify(row, cut, scoped)
          scoped.throwIfAborted()
          const latest = (await this.local.summaries([row.sessionRef], scoped)).get(row.sessionRef)
          if (!latest || latest.running || latest.updatedAt !== cut.updatedAt || (latest.projectionAsOfSeq ?? -1) !== cut.projectionAsOfSeq) entry.covered = false
        } catch { entry.covered = false }
        finally { entry.state = 'complete'; entry.retryAt = Date.now() + 300_000; this.pending-- }
      })
    }
  }
  private async verify(row: DshAccountSession, cut: LocalHistoryCut, signal: AbortSignal): Promise<false | 'local' | 'cloud'> {
    const local = await this.local.content(row.sessionRef, cut.projectionAsOfSeq, signal)
    const cloud = await this.cloud(row, signal)
    signal.throwIfAborted()
    // A fully readable local history wins ties, avoiding broken legacy cloud
    // playback. Supersets preserve every message occurrence and tool payload.
    if (contentCovers(local, cloud)) return 'local'
    if (contentCovers(cloud, local) && await this.readable(row, signal)) return 'cloud'
    return false
  }
}
