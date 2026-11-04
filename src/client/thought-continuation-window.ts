import type { ArkmeThoughtContinuation, ArkmeThoughtContinuationPage } from '../thought-continuation.js'

const capacity = 60
// Host pages contain at most 20 rows. One extra page covers a trimmed boundary.
const maxRefreshPages = 4
export interface ThoughtContinuationWindow extends ArkmeThoughtContinuationPage {
  origins: ReadonlyMap<string, string | undefined>
  historical: boolean
  startCursor?: string | undefined
}
const invalid = () => Object.assign(new Error('Arko 回复分页状态无效，请重试'), { body: { retryable: true } })
function check(page: ArkmeThoughtContinuationPage, scope: string) {
  if (page.accountScope !== scope) throw new Error('账号已切换，请重新读取回复')
}
function windowOf(page: ArkmeThoughtContinuationPage, items: ArkmeThoughtContinuation[], origins: ReadonlyMap<string, string | undefined>, historical: boolean, cursor?: string): ThoughtContinuationWindow {
  return { accountScope: page.accountScope, supported: page.supported, items,
    origins: new Map(items.map(item => [item.id, origins.get(item.id)])), historical,
    ...(historical ? { startCursor: origins.get(items[0]?.id ?? '') } : {}),
    ...(cursor ? { nextCursor: cursor } : {}) }
}

/** Explicit pagination retains the existing bounded, older-reading window. */
export function appendThoughtContinuationPage(previous: ThoughtContinuationWindow | undefined, page: ArkmeThoughtContinuationPage, before: string, scope: string): ThoughtContinuationWindow {
  check(page, scope)
  if (!page.supported) return windowOf(page, [], new Map(), false)
  const rows = new Map(previous?.items.map(item => [item.id, item]))
  const origins = new Map(previous?.origins)
  for (const item of page.items) { rows.set(item.id, item); origins.set(item.id, before) }
  const all = [...rows.values()]
  return windowOf(page, all.slice(-capacity), origins, previous?.historical === true || all.length > capacity, page.nextCursor)
}

/** Revalidate only the loaded range, then publish it atomically. Never append stale pages. */
export async function readThoughtContinuationWindow({ scope, previous, read, signal, firstPage }: {
  scope: string
  previous?: ThoughtContinuationWindow | undefined
  read(cursor?: string): Promise<ArkmeThoughtContinuationPage>
  signal: AbortSignal
  firstPage?: ArkmeThoughtContinuationPage | undefined
}): Promise<ThoughtContinuationWindow> {
  if (firstPage) {
    check(firstPage, scope)
    if (!firstPage.supported) return windowOf(firstPage, [], new Map(), false)
  }
  const historical = previous?.historical === true
  let before = historical ? previous.startCursor : undefined
  const lastId = previous?.items.at(-1)?.id
  const oldIds = new Set(previous?.items.map(item => item.id))
  const rows = new Map<string, ArkmeThoughtContinuation>(), origins = new Map<string, string | undefined>(), seen = new Set<string>()
  for (let index = 0; index < maxRefreshPages; index++) {
    signal.throwIfAborted()
    if (before && seen.has(before)) throw invalid()
    if (before) seen.add(before)
    const page = index === 0 && before === undefined && firstPage ? firstPage : await read(before)
    signal.throwIfAborted(); check(page, scope)
    if (!page.supported) return windowOf(page, [], new Map(), false)
    for (const item of page.items) { rows.set(item.id, item); origins.set(item.id, before) }
    let items = [...rows.values()]
    if (historical) {
      const start = items.findIndex(item => oldIds.has(item.id))
      if (start > 0) {
        for (const item of items.slice(0, start)) rows.delete(item.id)
        items = items.slice(start)
      }
    }
    const boundary = items.findIndex(item => item.id === lastId)
    // A cursor addresses a whole page. When trimming its tail, expose that page's
    // input cursor so "more" revalidates the overlap instead of skipping records.
    const length = boundary >= 0 && before !== undefined ? Math.min(capacity, boundary + 1) : capacity
    const trimmed = items.length > length
    items = items.slice(0, length)
    if (boundary >= 0 || !page.nextCursor || !previous?.items.length || items.length >= capacity) {
      return windowOf(page, items, origins, historical, trimmed ? before : page.nextCursor)
    }
    before = page.nextCursor
  }
  throw invalid()
}
