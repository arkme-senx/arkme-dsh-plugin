import type { ReactionHistoryEvent, ReactionHistoryPage } from '../reaction-contract.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

type HistoryItem = ReactionHistoryEvent & Partial<Pick<import('../world-reaction-contract.js').WorldReactionHistoryEvent, 'target' | 'state'>>
type Stream = { pending: HistoryItem[]; done: boolean; before_at?: number | undefined; before_id?: string | undefined }
export type CombinedReactionHistoryPage = { items: HistoryItem[]; has_more: boolean; streams: Stream[] }

/** Merge bounded pages; each owner keeps its own cursor, including equal timestamps. */
export async function readReactionHistory(accountKey: string, start_at: number, end_at: number, signal: AbortSignal,
  previous?: CombinedReactionHistoryPage, read: typeof callArkme = callArkme): Promise<CombinedReactionHistoryPage> {
  const streams = await Promise.all((['reactions', 'world.reactions'] as const).map(async (operation, index): Promise<Stream> => {
    const old = previous?.streams[index]
    if (old?.done || old?.pending.length) return { ...old, pending: [...old.pending] }
    const page = await withArkmeReadDeadline(s => read<ReactionHistoryPage>(operation, { action: 'history', accountKey, start_at, end_at, limit: 100,
      ...(old?.before_at === undefined ? {} : { before_at: old.before_at, before_id: old.before_id }) }, s), signal)
    signal.throwIfAborted()
    if (!Array.isArray(page.items) || page.items.length > 100 || typeof page.has_more !== 'boolean'
      || page.has_more && (!page.items.length || !page.before_id || !Number.isFinite(page.before_at)
        || old?.before_at === page.before_at && old?.before_id === page.before_id)) throw Error('表态记录分页未推进，请重试')
    return { pending: page.items.map(item => index === 0 ? item : { ...item, event_uid: `world:${item.event_uid}`, source_kind: 'world' }),
      done: !page.has_more, before_at: page.before_at, before_id: page.before_id }
  }))
  const items: HistoryItem[] = []
  while (items.length < 100) {
    // Refill an exhausted unfinished stream on the next page before exposing older rows.
    if (streams.some(stream => !stream.pending.length && !stream.done)) break
    const next = streams.filter(stream => stream.pending.length).sort((a, b) => b.pending[0]!.at - a.pending[0]!.at || b.pending[0]!.event_uid.localeCompare(a.pending[0]!.event_uid))[0]
    if (!next) break
    items.push(next.pending.shift()!)
  }
  return { items, has_more: streams.some(stream => stream.pending.length || !stream.done), streams }
}
