import type { DshAccountSession } from './account-session-types.js'

export type LocalHistoryCut = { runtimeRef: string; updatedAt: number; projectionAsOfSeq: number }
export interface LocalAliasReader {
  summaries(refs: string[], signal: AbortSignal): Promise<Map<string, { updatedAt: number; projectionAsOfSeq?: number; running: boolean }>>
}
/** Directory identity is server-owned metadata. Never scan journal bodies or
 * change row identity when content advances. Source readiness only chooses the
 * default reader; an already running native session retains its native owner. */
export class LocalHistoryCoverage {
  constructor(private readonly local: LocalAliasReader) {}
  clear(): void {}
  async annotate(rows: DshAccountSession[], runtime: string | undefined, signal: AbortSignal): Promise<void> {
    const candidates = rows.filter(row => !row.local && row.origin !== 'subagent' && (row.canonicalIdentity || (runtime !== undefined && row.previousRuntimeRefs?.includes(runtime))))
    if (!candidates.length) return
    const summaries = await this.local.summaries(candidates.map(row => row.sessionRef), signal)
    signal.throwIfAborted()
    for (const row of candidates) {
      const local = summaries.get(row.sessionRef)
      if (!local) continue
      row.coveredLocalHistory = { ...(runtime === undefined ? {} : { runtimeRef: runtime }), updatedAt: local.updatedAt, projectionAsOfSeq: local.projectionAsOfSeq ?? -1,
        source: !row.archived && (local.running || (runtime !== undefined && row.readableRuntimeRefs?.includes(runtime))) ? 'local' : 'cloud' }
    }
  }
}
