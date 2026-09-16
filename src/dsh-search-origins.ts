import { dshAgentInputRecordUid } from './dsh-agent-input-sync.js'
import type { ArkmeSearchRecordItem } from './types.js'

type Hit = { sessionId: string; seq: number; type: string; surface: string }
type Provider = {
  listSessions(signal?: AbortSignal): Promise<Array<{ header: { id: string; cwd?: string; createdAt?: number } }>>
  filterEvents(sessionId: string, filters: object[]): Promise<Hit[]>
}

/** Resolve sync identity using the public index and exact deterministic record IDs. */
export async function resolveDshSearchOrigins(provider: unknown, items: ArkmeSearchRecordItem[], signal?: AbortSignal): Promise<ArkmeSearchRecordItem[]> {
  const pending = new Set(items.filter(item => item.creationSource === 3 && item.dshOrigin === undefined).map(item => item.recordUid))
  if (pending.size === 0) return items
  const api = provider as Partial<Provider> | undefined
  const unresolved = () => items.map(item => pending.has(item.recordUid) ? { ...item, dshOriginUnverified: true as const } : item)
  if (typeof api?.listSessions !== 'function' || typeof api.filterEvents !== 'function') return unresolved()
  const deadline = AbortSignal.timeout(5000)
  const context = { signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) }
  // Identity survives user edits to the synced record; its current text is not the original event text.
  const filters = [{ kind: 'type', values: ['user/message'] }]
  const origins = new Map<string, { sessionId: string; eventSeq: number }>()
  const accept = (hit: Hit, sessionId: string) => {
    if (hit.sessionId !== sessionId || hit.type !== 'user/message'
      || !/^[A-Za-z0-9_.:-]{1,256}$/.test(sessionId) || !Number.isSafeInteger(hit.seq) || hit.seq < 0) return
    const uid = dshAgentInputRecordUid(sessionId, hit.seq)
    if (pending.delete(uid)) origins.set(uid, { sessionId, eventSeq: hit.seq })
  }
  let complete = true
  try {
    const sessions = await api.listSessions(context.signal)
    context.signal.throwIfAborted()
    const candidates = sessions.filter(item => item.header.cwd !== undefined)
      .sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
    // Public filterEvents cannot abort an in-progress read; do not start another after the deadline.
    for (const item of candidates) {
      if (pending.size === 0) break
      context.signal.throwIfAborted()
      try {
        const events = await api.filterEvents(item.header.id, filters)
        for (const hit of events) {
          accept(hit, item.header.id)
          if (pending.size === 0) break
        }
      } catch (error) {
        if (signal?.aborted) throw error
        complete = false
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error
    complete = false
  }
  signal?.throwIfAborted()
  return items.map(item => origins.has(item.recordUid)
    ? { ...item, dshOrigin: origins.get(item.recordUid)! }
    : !complete && pending.has(item.recordUid) ? { ...item, dshOriginUnverified: true } : item)
}
