import { dshAgentInputRecordUid } from './dsh-agent-input-sync.js'
import type { ArkmeSearchRecordItem } from './types.js'

type Hit = { sessionId: string; seq: number; type: string; surface: string }
type Provider = {
  listSessions(signal?: AbortSignal): Promise<Array<{ header: { id: string; cwd?: string; createdAt?: number } }>>
  filterEvents(sessionId: string, filters: object[]): Promise<Hit[]>
}

/** Recover old sync identity using the public index and exact deterministic record IDs. */
export async function resolveDshSearchOrigins(provider: unknown, query: string, items: ArkmeSearchRecordItem[], signal?: AbortSignal): Promise<ArkmeSearchRecordItem[]> {
  const pending = new Set(items.filter(item => item.creationSource === 3 && item.dshOrigin === undefined).map(item => item.recordUid))
  if (pending.size === 0) return items
  const api = provider as Partial<Provider> | undefined
  if (typeof api?.listSessions !== 'function' || typeof api.filterEvents !== 'function') return items
  const deadline = AbortSignal.timeout(5000)
  const context = { signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) }
  const filters = [{ kind: 'type', values: ['user/message'] }, { kind: 'text', text: query }]
  const origins = new Map<string, { sessionId: string; eventSeq: number }>()
  const accept = (hit: Hit, sessionId: string) => {
    if (hit.sessionId !== sessionId || hit.type !== 'user/message'
      || !/^[A-Za-z0-9_.:-]{1,256}$/.test(sessionId) || !Number.isSafeInteger(hit.seq) || hit.seq < 0) return
    const uid = dshAgentInputRecordUid(sessionId, hit.seq)
    if (pending.delete(uid)) origins.set(uid, { sessionId, eventSeq: hit.seq })
  }
  // ponytail: scan at most 20 recent local sessions; older unresolved records remain unknown.
  // Public filterEvents has no cancellation argument; check the deadline between sequential reads.
  const sessions = await api.listSessions(context.signal)
  context.signal.throwIfAborted()
  const candidates = sessions.filter(item => item.header.cwd !== undefined)
    .sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0)).slice(0, 20)
  for (const item of candidates) {
    if (pending.size === 0) break
    context.signal.throwIfAborted()
    const events = await api.filterEvents(item.header.id, filters)
    context.signal.throwIfAborted()
    for (const hit of events) accept(hit, item.header.id)
  }
  return items.map(item => origins.has(item.recordUid) ? { ...item, dshOrigin: origins.get(item.recordUid)! } : item)
}
