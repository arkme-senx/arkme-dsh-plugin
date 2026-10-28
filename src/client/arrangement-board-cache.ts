import type { ArkmeArrangementPage } from '../types.js'
import { arrangementColumns, type ArrangementColumn } from './arrangement-board-model.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export type ArrangementBoardPages = Partial<Record<ArrangementColumn, ArkmeArrangementPage>>
const memory = new Map<string, ArrangementBoardPages>()
const writes = new Map<string, Promise<void>>()

function firstPages(pages: ArrangementBoardPages): ArrangementBoardPages {
  return Object.fromEntries(arrangementColumns.flatMap(status => {
    const page = pages?.[status]
    if (!page || !Array.isArray(page.items) || !Number.isFinite(page.total)) return []
    const items = page.items.filter(item => item.status === status).slice(0, 50)
    const hasMore = page.total > items.length
    return [[status, structuredClone({ ...page, items, hasMore, nextOffset: hasMore ? items.length : undefined })]]
  }))
}

export function readArrangementBoardMemory(scope: string): ArrangementBoardPages {
  return structuredClone(memory.get(scope) ?? {})
}

export async function loadArrangementBoardCache(scope: string, signal: AbortSignal): Promise<ArrangementBoardPages> {
  if (!scope) return {}
  try {
    const result = await withArkmeReadDeadline(readSignal => callArkme<{ pages: ArrangementBoardPages }>('arrangements.board-cache', { accountScope: scope }, readSignal), signal)
    if (signal.aborted) return {}
    // The caller decides whether a live response has already superseded this read.
    const pages = firstPages(result.pages ?? {})
    memory.set(scope, { ...pages, ...memory.get(scope) })
    if (memory.size > 8) memory.delete(memory.keys().next().value!)
    return pages
  } catch { return {} }
}

export function saveArrangementBoardCache(scope: string, pages: ArrangementBoardPages): void {
  if (!scope) return
  const bounded = firstPages(pages)
  memory.set(scope, { ...memory.get(scope), ...bounded })
  if (memory.size > 8) memory.delete(memory.keys().next().value!)
  const task = (writes.get(scope) ?? Promise.resolve()).then(async () => {
    try {
      await withArkmeReadDeadline(signal => callArkme('arrangements.board-cache', { accountScope: scope, pages: bounded }, signal))
    } catch { /* Optional persistence must never turn a successful save into a failure. */ }
  })
  writes.set(scope, task)
  void task.finally(() => { if (writes.get(scope) === task) writes.delete(scope) })
}
