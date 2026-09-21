import { DshRemoteError } from './errors.js'

export type NativeHistoryRecord = { type: 'event'; event: { seq: number; type: string; [key: string]: unknown } }
export type NativeHistoryPage = { records: NativeHistoryRecord[]; hasMore: boolean }
export const REMOTE_HISTORY_TURNS = 5

/** Preserve the contiguous native journal, including tools and replacement events. */
export function fiveTurnPage(page: NativeHistoryPage): NativeHistoryPage | undefined {
  let turns = 0
  for (let i = page.records.length - 1; i >= 0; i--) {
    if (page.records[i]!.event.type === 'turn/start' && ++turns === REMOTE_HISTORY_TURNS) {
      return { records: page.records.slice(i), hasMore: page.hasMore || i > 0 }
    }
  }
  return page.hasMore ? undefined : page
}

/** Only local public page calls run here; the cross-computer response is one turn-aligned page. */
export async function readFiveTurns(
  initial: NativeHistoryPage,
  previous: (beforeSeq: number) => Promise<NativeHistoryPage>,
): Promise<NativeHistoryPage> {
  let page = initial
  for (let pages = 0; pages < 100; pages++) {
    const complete = fiveTurnPage(page)
    if (complete) return complete
    const before = page.records[0]?.event.seq
    if (before === undefined) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分页没有前进')
    const older = await previous(before)
    if (older.records.length === 0 || older.records.at(-1)!.event.seq !== before - 1) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史分页不连续')
    page = { records: [...older.records, ...page.records], hasMore: older.hasMore }
    if (page.records.length > 50_000) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '单轮历史过大')
  }
  throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '单轮历史分页过多')
}
