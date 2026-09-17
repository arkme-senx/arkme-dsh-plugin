import { useEffect, useState } from 'react'
import type { ArkmePrivateInteractionDirectoryPage, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

type Snapshot = { accountKey?: string; rows: ArkmeSourceItem[]; error?: string }

/** One read at a time. Further events queue one refresh, never abort page one. */
export function watchPrivateInteractionDirectory({ read, publish, subscribe, delay = 150 }: {
  read: (cursor: string | undefined, version: string | undefined, signal: AbortSignal) => Promise<ArkmePrivateInteractionDirectoryPage>
  publish: (rows: ArkmeSourceItem[], error?: string) => void
  subscribe: (invalidate: () => void) => () => void
  delay?: number
}): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let revision = 0
  let queued = false
  let retryBudget = 1
  const schedule = () => {
    if (controller.signal.aborted || running || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; void run() }, delay)
  }
  const invalidate = () => {
    revision += 1
    queued = true
    retryBudget = 1
    schedule()
  }
  const run = async () => {
    running = true
    queued = false
    const requestRevision = revision
    const rows = new Map<string, ArkmeSourceItem>()
    const visited = new Set<string>()
    let cursor: string | undefined
    let version: string | undefined
    try {
      for (let index = 0; index < 40; index += 1) {
        const page = await read(cursor, version, controller.signal)
        if (controller.signal.aborted || requestRevision !== revision) return
        if (version !== undefined && page.version !== version) throw new Error('interaction-version-changed')
        version = page.version
        for (const row of page.items) rows.set(arkmeSourceIdentityKey(row), row)
        // Latest people become visible immediately, before older directory pages.
        publish([...rows.values()])
        if (!page.hasMore) return
        if (!page.nextCursor || visited.has(page.nextCursor) || index === 39) throw new Error('互动目录未完整加载，请刷新重试')
        cursor = page.nextCursor
        visited.add(cursor)
      }
    } catch (error) {
      if (controller.signal.aborted || requestRevision !== revision) return
      const message = error instanceof Error ? error.message : ''
      if (/version|状态已变化/iu.test(message)) {
        if (retryBudget-- > 0) queued = true
        else if (rows.size > 0) {
          // A busy account can change between pages. Never keep an obsolete
          // permission snapshot: revalidate recent contacts, drop old pages,
          // and explicitly report that earlier contacts are not loaded.
          try {
            const fresh = await read(undefined, undefined, controller.signal)
            if (controller.signal.aborted || requestRevision !== revision) return
            publish(fresh.items, fresh.hasMore ? '较早群互动暂未加载，点击重试' : undefined)
          } catch {
            if (!controller.signal.aborted && requestRevision === revision) publish([], '群互动同步暂未完成，点击重试')
          }
        } else publish([], '群互动同步暂未完成，点击重试')
      } else publish([], '群互动同步暂未完成，点击重试')
    } finally {
      running = false
      if (queued) schedule()
    }
  }
  const unsubscribe = subscribe(invalidate)
  void run()
  return () => {
    controller.abort()
    if (timer !== undefined) clearTimeout(timer)
    unsubscribe()
  }
}

export function usePrivateInteractionDirectory(accountKey: string | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ rows: [] })
  useEffect(() => {
    if (!enabled || accountKey === undefined) return
    setSnapshot({ accountKey, rows: [] })
    return watchPrivateInteractionDirectory({
      read: async (cursor, version, signal) => await callArkme<ArkmePrivateInteractionDirectoryPage>('private-interaction.directory', {
        limit: 100, ...(cursor ? { cursor } : {}), ...(version ? { expectedVersion: version } : {}),
      }, signal),
      subscribe: listener => arkmeInterwovenInvalidation.subscribe(listener),
      publish: (rows, error) => setSnapshot({ accountKey, rows, ...(error ? { error } : {}) }),
    })
  }, [accountKey, enabled])
  return enabled && snapshot.accountKey === accountKey ? snapshot : { rows: [] }
}
