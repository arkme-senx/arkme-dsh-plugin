import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmePrivateInteractionDirectoryPage, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

type Snapshot = { accountKey?: string; rows: ArkmeSourceItem[]; error?: string }
type ReadPriority = 'background' | 'foreground'

/** Automatic events coalesce; an explicit retry can replace a background read. */
export function watchPrivateInteractionDirectory({ read, publish, subscribe, delay = 150 }: {
  read: (cursor: string | undefined, version: string | undefined, signal: AbortSignal, priority: ReadPriority) => Promise<ArkmePrivateInteractionDirectoryPage>
  publish: (rows: ArkmeSourceItem[], error?: string) => void
  subscribe: (invalidate: () => void) => () => void
  delay?: number
}): { dispose(): void; retry(): void } {
  let disposed = false
  let active: { controller: AbortController; priority: ReadPriority } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let queued = false
  let queuedPriority: ReadPriority = 'background'
  let retryBudget = 1
  let waitForQuiet = false
  const schedule = () => {
    if (disposed || active !== undefined || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; void run(queuedPriority) }, waitForQuiet ? Math.max(delay, 5000) : delay)
  }
  const invalidate = () => {
    if (disposed) return
    revision += 1
    queued = true
    if (active?.priority === 'foreground') queuedPriority = 'foreground'
    retryBudget = 1
    if (waitForQuiet && timer !== undefined) { clearTimeout(timer); timer = undefined }
    schedule()
  }
  const run = async (priority: ReadPriority) => {
    const request = { controller: new AbortController(), priority }
    active = request
    const { signal } = request.controller
    queued = false
    queuedPriority = 'background'
    waitForQuiet = false
    const requestRevision = revision
    const current = () => !disposed && !signal.aborted && active === request && requestRevision === revision
    const rows = new Map<string, ArkmeSourceItem>()
    const visited = new Set<string>()
    let cursor: string | undefined
    let version: string | undefined
    try {
      for (let index = 0; index < 40; index += 1) {
        const page = await read(cursor, version, signal, priority)
        if (!current()) return
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
      if (disposed || signal.aborted || active !== request) return
      const message = error instanceof Error ? error.message : ''
      if (/version|状态已变化/iu.test(message) && requestRevision !== revision) {
        // The server could not produce a stable snapshot while read state changed.
        // Retain one dirty intent and one trailing timer, instead of retrying an
        // expensive query throughout the same burst. Read acknowledgements can
        // arrive seconds apart, so allow 5s quiet. Explicit retry bypasses this.
        waitForQuiet = true
        queued = true; queuedPriority = priority
        publish([], '群互动同步暂未完成，点击重试')
        return
      }
      if (!current()) return
      if (/version|状态已变化/iu.test(message)) {
        if (retryBudget-- > 0) { queued = true; queuedPriority = priority }
        else if (rows.size > 0) {
          // A busy account can change between pages. Never keep an obsolete
          // permission snapshot: revalidate recent contacts, drop old pages,
          // and explicitly report that earlier contacts are not loaded.
          try {
            const fresh = await read(undefined, undefined, signal, priority)
            if (!current()) return
            publish(fresh.items, fresh.hasMore ? '较早群互动暂未加载，点击重试' : undefined)
          } catch {
            if (current()) publish([], '群互动同步暂未完成，点击重试')
          }
        } else publish([], '群互动同步暂未完成，点击重试')
      } else publish([], '群互动同步暂未完成，点击重试')
    } finally {
      // A cancelled background run may settle after its foreground replacement.
      if (active === request) {
        active = undefined
        if (queued) schedule()
      }
    }
  }
  const unsubscribe = subscribe(invalidate)
  void run('background')
  return {
    retry() {
      if (disposed || active?.priority === 'foreground') return
      revision++
      retryBudget = 1
      waitForQuiet = false
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      active?.controller.abort()
      void run('foreground')
    },
    dispose() {
      disposed = true
      active?.controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
    },
  }
}

export function usePrivateInteractionDirectory(accountKey: string | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ rows: [] })
  const owner = useRef<{ accountKey: string; watcher: ReturnType<typeof watchPrivateInteractionDirectory> } | undefined>(undefined)
  const retry = useCallback(() => {
    if (enabled && owner.current?.accountKey === accountKey) owner.current?.watcher.retry()
  }, [accountKey, enabled])
  useEffect(() => {
    if (!enabled || accountKey === undefined) return
    setSnapshot({ accountKey, rows: [] })
    const watcher = watchPrivateInteractionDirectory({
      read: async (cursor, version, signal, priority) => await callArkme<ArkmePrivateInteractionDirectoryPage>('private-interaction.directory', {
        ...(priority === 'background' ? { background: true } : {}),
        limit: 100, ...(cursor ? { cursor } : {}), ...(version ? { expectedVersion: version } : {}),
      }, signal, priority === 'background' ? { priority } : undefined),
      subscribe: listener => arkmeInterwovenInvalidation.subscribe(listener),
      publish: (rows, error) => setSnapshot({ accountKey, rows, ...(error ? { error } : {}) }),
    })
    owner.current = { accountKey, watcher }
    return () => {
      if (owner.current?.watcher === watcher) owner.current = undefined
      watcher.dispose()
    }
  }, [accountKey, enabled])
  return { ...(enabled && snapshot.accountKey === accountKey ? snapshot : { rows: [] }), retry }
}
