import { groupInteractionTrace, groupInteractionTraceKey } from '../group-interaction-diagnostics.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmePrivateInteractionDirectoryPage, ArkmePrivateInteractionSummary, ArkmeSourceItem } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { applyPrivateInteractionDirectory } from './private-interaction-directory.js'
import { arkmeChatDirectory, arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { abortableDelay } from './harness-attachment-draft.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

type Snapshot = { accountKey?: string; rows: ArkmeSourceItem[]; error?: string }
type ReadPriority = 'background' | 'foreground'
const emptyDirectory: Snapshot = { rows: [] }
const directorySnapshots = new Map<string, { owner: object; snapshot: Snapshot }>()
const directoryListeners = new Set<() => void>()
export const subscribePrivateInteractionDirectory = (listener: () => void) => { directoryListeners.add(listener); return () => { directoryListeners.delete(listener) } }
export const readPrivateInteractionDirectory = (accountKey: string) => directorySnapshots.get(accountKey)?.snapshot ?? emptyDirectory
const publishDirectory = () => { for (const listener of directoryListeners) listener() }

/** Automatic events coalesce; an explicit retry can replace a background read. */
export function watchPrivateInteractionDirectory({ read, publish, subscribe, subscribeGroupAccess, readPeer, delay = 150 }: {
  read: (cursor: string | undefined, version: string | undefined, signal: AbortSignal, priority: ReadPriority, recoveryHead?: boolean) => Promise<ArkmePrivateInteractionDirectoryPage>
  publish: (rows: ArkmeSourceItem[], error?: string) => void
  subscribe: (invalidate: (peers?: readonly string[], revalidate?: boolean, reason?: string) => void) => () => void
  subscribeGroupAccess?: (listener: (restricted: ReadonlySet<string>) => void) => () => void
  readPeer?: (key: string, rows: readonly ArkmeSourceItem[], signal: AbortSignal) =>
    Promise<{ key: string; row?: ArkmeSourceItem } | undefined>
  delay?: number
}): { dispose(): void; retry(): void } {
  let disposed = false
  let peerRead: { key: string; controller: AbortController } | undefined
  let peerWorker = false
  let directoryRows: ArkmeSourceItem[] = []
  let publishedRows: ArkmeSourceItem[] = []
  let publishedError: string | undefined
  let peerRevision = 0
  const pendingPeers = new Set<string>()
  let restrictedGroups: ReadonlySet<string> = new Set()
  const isRestricted = (row: ArkmeSourceItem) => {
    const group = row.privateInteraction?.latest.groupSourceKey
    return group !== undefined && restrictedGroups.has(group)
  }
  const peerChanges = new Map<string, { row?: ArkmeSourceItem; revision: number }>()
  const publishMerged = () => {
    const rows = new Map(directoryRows.map(row => [arkmeSourceIdentityKey(row), row]))
    for (const [key, change] of peerChanges) {
      if (change.row === undefined) rows.delete(key)
      else rows.set(key, change.row)
    }
    publishedRows = [...rows.values()].filter(row => !isRestricted(row))
    if (publishedError === undefined) publish(publishedRows)
    else publish(publishedRows, publishedError)
  }
  const publishSnapshot = (rows: ArkmeSourceItem[], error?: string, completeRevision?: number, complete = false) => {
    directoryRows = rows
    publishedError = error
    if (completeRevision !== undefined) {
      const received = complete ? undefined : new Set(rows.map(arkmeSourceIdentityKey))
      for (const [key, change] of peerChanges) {
        if (change.revision <= completeRevision && (received === undefined || received.has(key))) peerChanges.delete(key)
      }
    }
    publishMerged()
  }
  const refreshPeers = async () => {
    if (disposed || peerWorker || pendingPeers.size === 0 || readPeer === undefined) return
    peerWorker = true
    try {
      for (const key of pendingPeers) {
        pendingPeers.delete(key)
        const controller = new AbortController()
        peerRead = { key, controller }
        try {
          let result: Awaited<ReturnType<NonNullable<typeof readPeer>>>
          for (let attempt = 0; ; attempt++) {
            controller.signal.throwIfAborted()
            try {
              result = await readPeer(key, publishedRows, controller.signal)
              break
            } catch (error) {
              if (!(error instanceof ArkmeClientError) || error.body.code !== 'interaction-version-changed' || attempt >= 2) throw error
              groupInteractionTrace('summary-version-retry', { contact: groupInteractionTraceKey(key), attempt: attempt + 1 })
              await abortableDelay(controller.signal, attempt === 0 ? 150 : 350)
            }
          }
          if (!controller.signal.aborted && !disposed && result !== undefined) {
            peerChanges.delete(result.key)
            peerChanges.set(result.key, { ...(result.row === undefined ? {} : { row: result.row }), revision: ++peerRevision })
            // Match the directory's existing maximum of 40 pages of 100.
            if (peerChanges.size > 4000) {
              peerChanges.delete(peerChanges.keys().next().value!)
              invalidate(undefined, false, 'contact-cache-capacity')
            }
            publishMerged()
          }
        } catch {
          if (!controller.signal.aborted && !disposed && !queued) invalidate(undefined, false, 'contact-summary-failed')
        }
        if (disposed) break
      }
    } finally {
      peerRead = undefined
      peerWorker = false
    }
  }
  let active: { controller: AbortController; priority: ReadPriority; recovery: boolean; reconnectPending: boolean } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let queued = false
  const queuedReasons = new Set<string>()
  let queuedPriority: ReadPriority = 'background'
  let retryBudget = 1
  let waitForQuiet = false
  const schedule = () => {
    if (disposed || active !== undefined || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; void run(queuedPriority) }, waitForQuiet ? Math.max(delay, 5000) : delay)
  }
  const invalidate = (peers?: readonly string[], revalidate = false, reason = 'unscoped') => {
    if (disposed) return
    if (peers !== undefined && readPeer !== undefined) {
      let overflow = false
      for (const peer of peers) {
        if (pendingPeers.size < 50 || pendingPeers.has(peer)) pendingPeers.add(peer)
        else overflow = true
      }
      void refreshPeers()
      if (!overflow) return
      reason = 'contact-queue-capacity'
    }
    if (revalidate) {
      if (peerRead !== undefined) {
        pendingPeers.add(peerRead.key)
        peerRead.controller.abort()
      }
      if (peerChanges.size > 0) {
        // Older pages cannot fill in a row whose newer summary just lost its authorization.
        directoryRows = directoryRows.filter(row => !peerChanges.has(arkmeSourceIdentityKey(row)))
        peerChanges.clear()
        publishMerged()
      }
    }
    const recoveryHint = reason === 'network-online' || reason === 'realtime-reconcile'
    if (active?.recovery && recoveryHint && !revalidate) {
      active.reconnectPending = true
      return
    }
    if (revalidate || !active?.recovery) revision += 1
    queuedReasons.add(reason)
    queued = true
    if (active?.priority === 'foreground') queuedPriority = 'foreground'
    retryBudget = 1
    if (waitForQuiet && timer !== undefined) { clearTimeout(timer); timer = undefined }
    schedule()
  }
  const run = async (priority: ReadPriority, reason?: string) => {
    const recovery = queuedReasons.has('network-online') || queuedReasons.has('realtime-reconcile') || queuedReasons.has('recovery-retry')
    const reasons = reason ?? [...queuedReasons].join(',')
    queuedReasons.clear()
    groupInteractionTrace('directory-run-start', { reason: reasons, priority })
    const request = { controller: new AbortController(), priority, recovery, reconnectPending: false }
    active = request
    const { signal } = request.controller
    queued = false
    queuedPriority = 'background'
    waitForQuiet = false
    const requestRevision = revision
    const requestPeerRevision = peerRevision
    const current = () => !disposed && !signal.aborted && active === request && requestRevision === revision
    const retryInterruptedRecovery = () => {
      if (!current() || !request.reconnectPending) return false
      queued = true
      queuedPriority = priority
      queuedReasons.add('recovery-retry')
      return true
    }
    const rows = new Map<string, ArkmeSourceItem>()
    const visited = new Set<string>()
    let cursor: string | undefined
    let version: string | undefined
    try {
      for (let index = 0; index < 40; index += 1) {
        const page = recovery && index === 0
          ? await read(cursor, version, signal, priority, true)
          : await read(cursor, version, signal, priority)
        if (!current()) return
        if (version !== undefined && page.version !== version) throw new Error('interaction-version-changed')
        version = page.version
        for (const row of page.items) rows.set(arkmeSourceIdentityKey(row), row)
        // Latest people become visible immediately, before older directory pages.
        publishSnapshot([...rows.values()], undefined, requestPeerRevision, !page.hasMore)
        if (!page.hasMore) return
        if (!page.nextCursor || visited.has(page.nextCursor) || index === 39) throw new Error('互动目录未完整加载，请刷新重试')
        cursor = page.nextCursor
        visited.add(cursor)
      }
    } catch (error) {
      if (disposed || signal.aborted || active !== request) return
      if (retryInterruptedRecovery()) return
      const message = error instanceof Error ? error.message : ''
      if (/version|状态已变化/iu.test(message) && requestRevision !== revision) {
        // The server could not produce a stable snapshot while read state changed.
        // Retain one dirty intent and one trailing timer, instead of retrying an
        // expensive query throughout the same burst. Read acknowledgements can
        // arrive seconds apart, so allow 5s quiet. Explicit retry bypasses this.
        waitForQuiet = !queuedReasons.has('network-online') && !queuedReasons.has('realtime-reconcile')
        queuedReasons.add('version-conflict')
        queued = true; queuedPriority = priority
        publishSnapshot([], '群互动同步暂未完成，点击重试')
        return
      }
      if (!current()) return
      if (/version|状态已变化/iu.test(message)) {
        if (retryBudget-- > 0) {
          queued = true; queuedPriority = priority; queuedReasons.add('version-conflict')
          if (request.recovery) queuedReasons.add('recovery-retry')
        }
        else if (rows.size > 0) {
          // A busy account can change between pages. Never keep an obsolete
          // permission snapshot: revalidate recent contacts, drop old pages,
          // and explicitly report that earlier contacts are not loaded.
          try {
            groupInteractionTrace('directory-run-start', { reason: 'version-conflict-first-page', priority })
            const freshPeerRevision = peerRevision
            const fresh = await read(undefined, undefined, signal, priority)
            if (!current()) return
            publishSnapshot(fresh.items, fresh.hasMore ? '较早群互动暂未加载，点击重试' : undefined, freshPeerRevision, !fresh.hasMore)
          } catch {
            if (current() && !retryInterruptedRecovery()) publishSnapshot([], '群互动同步暂未完成，点击重试')
          }
        } else publishSnapshot([], '群互动同步暂未完成，点击重试')
      } else publishSnapshot([], '群互动同步暂未完成，点击重试')
    } finally {
      // A cancelled background run may settle after its foreground replacement.
      if (active === request) {
        active = undefined
        if (queued) schedule()
      }
    }
  }
  const unsubscribe = subscribe(invalidate)
  const unsubscribeAccess = subscribeGroupAccess?.(restricted => {
    restrictedGroups = restricted
    const affected = publishedRows.filter(isRestricted).map(arkmeSourceIdentityKey)
    if (!affected.length) return
    directoryRows = directoryRows.filter(row => !isRestricted(row))
    for (const [key, change] of peerChanges) {
      if (change.row && isRestricted(change.row)) peerChanges.delete(key)
    }
    publishMerged()
    invalidate(affected)
  })
  void run('background', 'initial')
  return {
    retry() {
      if (disposed || active?.priority === 'foreground') return
      revision++
      retryBudget = 1
      waitForQuiet = false
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      active?.controller.abort()
      void run('foreground', 'manual-retry')
    },
    dispose() {
      disposed = true
      pendingPeers.clear()
      peerRead?.controller.abort()
      active?.controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      unsubscribeAccess?.()
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
    const cacheOwner = {}
    setSnapshot({ accountKey, rows: [] })
    const watcher = watchPrivateInteractionDirectory({
      read: async (cursor, version, signal, priority, recoveryHead) => {
        const background = priority === 'background' && !recoveryHead
        groupInteractionTrace('directory-page-start', { continuation: cursor !== undefined, priority, recoveryHead })
        const page = await callArkme<ArkmePrivateInteractionDirectoryPage>('private-interaction.directory', {
          ...(background ? { background: true } : {}),
          limit: recoveryHead ? 20 : 100, ...(cursor ? { cursor } : {}), ...(version ? { expectedVersion: version } : {}),
        }, signal, background ? { priority: 'background' } : undefined)
        groupInteractionTrace('directory-page-response', { rows: page.items.length, hasMore: page.hasMore })
        return page
      },
      readPeer: async (key, rows, signal) => {
        if (arkmeChatDirectory.getConversationSnapshot().accountScope !== accountKey) return undefined
        const directory = arkmeChatDirectory.getSnapshot()
        const existing = (source: ArkmeSourceItem) => source.kind === 'private_chat' && arkmeSourceIdentityKey(source) === key
        const source = directory.sources.find(existing) ?? rows.find(existing)
        if (source === undefined) {
          // A partial ordinary directory cannot rule out a private chat on a later page.
          if (directory.projection?.phase !== 'complete') throw new Error('Private contact directory is incomplete')
          return undefined
        }
        if (directory.projection?.removedSourceKeys?.includes(key)
          || directory.projection?.visibility?.some(item => item.hidden && item.entryRef === source.sourceRef)) return { key }
        const contact = groupInteractionTraceKey(key)
        groupInteractionTrace('summary-request-start', { contact })
        const result = await callArkme<ArkmePrivateInteractionSummary>('private-interaction.summary',
          { sourceRef: source.sourceRef }, signal)
        const current = arkmeChatDirectory.getSnapshot()
        if (arkmeChatDirectory.getConversationSnapshot().accountScope !== accountKey) return undefined
        const currentSource = current.sources.find(existing)
        if (current.projection?.removedSourceKeys?.includes(key)
          || current.projection?.visibility?.some(item => item.hidden && item.entryRef === (currentSource ?? source).sourceRef)) return { key }
        const latest = result.latest
        groupInteractionTrace('summary-response', { contact, sequence: latest?.sequence, hasPreview: latest !== undefined })
        if (latest === undefined) return { key }
        // A directory-only row may already carry interaction activity. Rebuild that
        // overlay from the fresh summary and let the ordinary directory win on merge.
        const base = currentSource ?? { ...source, activeAtMillis: 0 }
        const [row] = applyPrivateInteractionDirectory([base],
          new Map([[key, { latest, version: result.version, unreadCount: result.unreadCount, attentionCount: result.attentionCount }]]))
        return { key, ...(row === undefined ? {} : { row }) }
      },
      subscribeGroupAccess: arkmeInterwovenInvalidation.subscribeGroupAccess,
      subscribe: listener => {
        const online = () => listener(undefined, false, 'network-online')
        const unsubscribe = arkmeInterwovenInvalidation.subscribeDirectory(listener)
        window.addEventListener('online', online)
        return () => { unsubscribe(); window.removeEventListener('online', online) }
      },
      publish: (rows, error) => {
        const snapshot = { accountKey, rows, ...(error ? { error } : {}) }
        directorySnapshots.set(accountKey, { owner: cacheOwner, snapshot }); publishDirectory()
        setSnapshot(snapshot)
      },
    })
    owner.current = { accountKey, watcher }
    return () => {
      if (owner.current?.watcher === watcher) owner.current = undefined
      watcher.dispose()
      if (directorySnapshots.get(accountKey)?.owner === cacheOwner) { directorySnapshots.delete(accountKey); publishDirectory() }
    }
  }, [accountKey, enabled])
  return { ...(enabled && snapshot.accountKey === accountKey ? snapshot : { rows: [] }), retry }
}
