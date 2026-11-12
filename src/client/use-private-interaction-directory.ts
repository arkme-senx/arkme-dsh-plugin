import { groupInteractionTrace, groupInteractionTraceEnabled, groupInteractionTraceKey } from '../group-interaction-diagnostics.js'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ArkmePrivateInteractionDirectoryPage, ArkmePrivateInteractionSummary, ArkmeSourceItem } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { applyPrivateInteractionDirectory } from './private-interaction-directory.js'
import { arkmeChatDirectory, arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { abortableDelay } from './harness-attachment-draft.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

type Snapshot = { accountKey?: string; rows: ArkmeSourceItem[]; error?: string }
type ReadPriority = 'background' | 'foreground'
const emptyDirectory: Snapshot = { rows: [] }
const directorySnapshots = new Map<string, Snapshot>()
const directoryTasks = new Map<string, {
  watcher: ReturnType<typeof watchPrivateInteractionDirectory>
  subscribers: number
}>()
const directoryListeners = new Set<() => void>()
export const subscribePrivateInteractionDirectory = (listener: () => void) => { directoryListeners.add(listener); return () => { directoryListeners.delete(listener) } }
export const readPrivateInteractionDirectory = (accountKey: string) => directorySnapshots.get(accountKey) ?? emptyDirectory
const publishDirectory = () => { for (const listener of directoryListeners) listener() }

/** Automatic events coalesce; an explicit retry can replace a background read. */
export function watchPrivateInteractionDirectory({ read, publish, subscribe, subscribeGroupAccess, readPeer, delay = 150 }: {
  read: (cursor: string | undefined, version: string | undefined, signal: AbortSignal, priority: ReadPriority, recoveryHead?: boolean) => Promise<ArkmePrivateInteractionDirectoryPage>
  publish: (rows: ArkmeSourceItem[], error?: string) => void
  subscribe: (invalidate: (peers?: readonly string[], revalidate?: boolean, reason?: string, sourceKey?: string) => void) => () => void
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
  const peerChanges = new Map<string, { row?: ArkmeSourceItem; revision: number; groupOnly?: true }>()
  const groupOnlyRow = (key: string, source: ArkmeSourceItem | undefined): ArkmeSourceItem | undefined => {
    if (source?.privateInteraction === undefined) return undefined
    const { latestPreview: _preview, latestSequence: _sequence, ...base } = source
    return applyPrivateInteractionDirectory([{ ...base, activeAtMillis: 0 }],
      new Map([[key, source.privateInteraction]]))[0]
  }
  let pageValidationRevision = 0
  const pageValidatedReasons = new Map<string, number>()
  const deletedSourceRevisions = new Map<string, number>()
  const isPendingDeletion = (row: ArkmeSourceItem) => {
    const latest = row.privateInteraction?.latest
    return latest !== undefined && (latest.groupSourceKey === undefined
      ? deletedSourceRevisions.size !== 0 : deletedSourceRevisions.has(latest.groupSourceKey))
  }
  const confirmPageValidation = (revision: number) => {
    for (const [sourceKey, change] of deletedSourceRevisions) {
      if (change <= revision) deletedSourceRevisions.delete(sourceKey)
    }
    for (const [reason, change] of pageValidatedReasons) {
      if (change > revision) continue
      pageValidatedReasons.delete(reason)
      queuedReasons.delete(reason)
    }
    if (queuedReasons.size === 0) queued = false
  }
  const publishMerged = () => {
    const rows = new Map(directoryRows.map(row => [arkmeSourceIdentityKey(row), row]))
    for (const [key, change] of peerChanges) {
      if (change.row === undefined) rows.delete(key)
      else rows.set(key, change.row)
    }
    publishedRows = [...rows.values()].filter(row => !isRestricted(row) && !isPendingDeletion(row))
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
            const groupOnly = peerChanges.get(result.key)?.groupOnly
            const row = groupOnly ? groupOnlyRow(result.key, result.row) : result.row
            peerChanges.delete(result.key)
            peerChanges.set(result.key, { ...(row === undefined ? {} : { row }), revision: ++peerRevision,
              ...(groupOnly ? { groupOnly } : {}) })
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
  let completedTail: {
    cursor: string
    version: string
    rows: Map<string, ArkmeSourceItem>
    tailKeys: string[]
    peerRevision: number
    completedAt: number
    recovery: boolean
  } | undefined
  const hasOnlyPageValidatedReasons = () =>
    queuedReasons.size !== 0 && [...queuedReasons].every(reason => pageValidatedReasons.has(reason))

  const schedule = () => {
    if (disposed || active !== undefined || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; void run(queuedPriority) }, waitForQuiet ? Math.max(delay, 5000) : delay)
  }
  const invalidate = (peers?: readonly string[], revalidate = false, reason = 'unscoped', sourceKey?: string) => {
    if (disposed) return
    if (reason === 'timeline-private-deleted' && sourceKey
      && (peerChanges.has(sourceKey) || peerChanges.size < 4000)) {
      // The direct preview is refreshed by the Chat session projection. Keep
      // only this contact’s independent group interaction until a newer page.
      const row = groupOnlyRow(sourceKey, publishedRows.find(item => arkmeSourceIdentityKey(item) === sourceKey))
      directoryRows = directoryRows.filter(item => arkmeSourceIdentityKey(item) !== sourceKey)
      peerChanges.set(sourceKey, { ...(row === undefined ? {} : { row }), revision: ++peerRevision, groupOnly: true })
      if (peerRead?.key === sourceKey) {
        pendingPeers.add(sourceKey)
        peerRead.controller.abort()
      }
      publishMerged()
      return
    }
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
    const scopedDeletion = reason === 'timeline-deleted' && !!sourceKey
      && (deletedSourceRevisions.has(sourceKey) || deletedSourceRevisions.size < 256)
    const coveredByPage = scopedDeletion || (!revalidate
      && (reason === 'session-delta-unscoped' || reason === 'group-session-delta-unscoped'))
    if (coveredByPage) {
      pageValidatedReasons.set(reason, ++pageValidationRevision)
      groupInteractionTrace('directory-change-effective', { reason, revision: pageValidationRevision })
    }
    else completedTail = undefined
    if (scopedDeletion) {
      deletedSourceRevisions.set(sourceKey, pageValidationRevision)
      // Remove potentially withdrawn previews now; only a later owner read may restore them.
      directoryRows = directoryRows.filter(row => !isPendingDeletion(row))
      for (const [key, change] of peerChanges) {
        if (!change.row || !isPendingDeletion(change.row)) continue
        if (change.groupOnly) peerChanges.set(key, { revision: change.revision, groupOnly: true })
        else peerChanges.delete(key)
      }
      if (publishedRows.some(isPendingDeletion)) publishMerged()
    } else if (reason === 'timeline-deleted') {
      // An unscoped or overflowing deletion cannot use the narrower barrier.
      pageValidatedReasons.delete(reason)
      publishSnapshot([])
    }
    if (revalidate) {
      if (peerRead !== undefined) {
        pendingPeers.add(peerRead.key)
        peerRead.controller.abort()
      }
      if (!scopedDeletion && peerChanges.size > 0) {
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
    if (!coveredByPage && (revalidate || !active?.recovery)) revision += 1
    queuedReasons.add(reason)
    if (active?.recovery && revalidate && !coveredByPage) queuedReasons.add('recovery-retry')
    queued = true
    if (active?.priority === 'foreground') queuedPriority = 'foreground'
    retryBudget = 1
    if (waitForQuiet && timer !== undefined) { clearTimeout(timer); timer = undefined }
    schedule()
  }
  const run = async (priority: ReadPriority, reason?: string) => {
    const recovery = queuedReasons.has('network-online') || queuedReasons.has('realtime-reconcile') || queuedReasons.has('recovery-retry')
    const reasons = reason ?? [...queuedReasons].join(',')
    const recoveryGroupBurst = completedTail?.recovery === true && [...queuedReasons].every(
      item => item === 'timeline-deleted' || item === 'group-session-delta-unscoped',
    )
    const resumeWindow = recoveryGroupBurst ? 30_000 : 5000
    const resume = reason === undefined && hasOnlyPageValidatedReasons() && completedTail !== undefined
      && Date.now() - completedTail.completedAt <= resumeWindow ? completedTail : undefined
    completedTail = undefined
    queuedReasons.clear()
    groupInteractionTrace('directory-run-start', { reason: reasons, priority, resumedTail: resume !== undefined })
    const request = { controller: new AbortController(), priority, recovery, reconnectPending: false }
    active = request
    const { signal } = request.controller
    queued = false
    queuedPriority = 'background'
    waitForQuiet = false
    const requestRevision = revision
    const requestPeerRevision = resume?.peerRevision ?? peerRevision
    const current = () => !disposed && !signal.aborted && active === request && requestRevision === revision
    const retryInterruptedRecovery = () => {
      if (!current() || !request.reconnectPending) return false
      queued = true
      queuedPriority = priority
      queuedReasons.add('recovery-retry')
      return true
    }
    const rows = new Map<string, ArkmeSourceItem>(resume?.rows)
    for (const key of resume?.tailKeys ?? []) rows.delete(key)
    let cursor = resume?.cursor
    let version = resume?.version
    const visited = new Set(cursor === undefined ? [] : [cursor])
    let tailRechecks = 0
    try {
      for (let index = 0; index < 40; index += 1) {
        const validationRevision = pageValidationRevision
        const page = recovery && index === 0
          ? await read(cursor, version, signal, priority, true)
          : await read(cursor, version, signal, priority)
        if (!current()) return
        if (version !== undefined && page.version !== version) throw new Error('interaction-version-changed')
        version = page.version
        // Each accepted versioned page revalidates the same directory against Chat.
        // A hint arriving after the page started stays dirty until a later read.
        if (page.scopeComplete) confirmPageValidation(validationRevision)
        if (!page.hasMore && page.scopeComplete && cursor !== undefined && tailRechecks < 2
          && hasOnlyPageValidatedReasons()) {
          // A late hint can be checked against the same version without walking
          // earlier pages again. A changed version still restarts from the head.
          tailRechecks++
          index--
          groupInteractionTrace('directory-tail-recheck', { attempt: tailRechecks })
          continue
        }
        for (const row of page.items) rows.set(arkmeSourceIdentityKey(row), row)
        // Latest people become visible immediately, before older directory pages.
        publishSnapshot([...rows.values()], undefined, requestPeerRevision, !page.hasMore)
        if (!page.hasMore) {
          if (page.scopeComplete && cursor !== undefined) {
            // Late invalidations may recheck a just-completed snapshot. Reusing
            // its tail never extends the lifetime of the earlier page data.
            completedTail = { cursor, version, rows, tailKeys: page.items.map(arkmeSourceIdentityKey),
              peerRevision: requestPeerRevision, completedAt: resume?.completedAt ?? Date.now(),
              recovery: resume?.recovery ?? recovery }
          }
          groupInteractionTrace('directory-run-complete', { rows: rows.size })
          return
        }
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
            const validationRevision = pageValidationRevision
            const fresh = await read(undefined, undefined, signal, priority)
            if (!current()) return
            if (fresh.scopeComplete) confirmPageValidation(validationRevision)
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
      if (!change.row || !isRestricted(change.row)) continue
      if (change.groupOnly) peerChanges.set(key, { revision: change.revision, groupOnly: true })
      else peerChanges.delete(key)
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

function activeDirectoryAccount() {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

function startDirectoryTask(accountKey: string) {
  const assertAccount = () => {
    if (activeDirectoryAccount() !== accountKey) throw new Error('群互动目录账号已切换')
  }
  const watcher = watchPrivateInteractionDirectory({
    read: async (cursor, version, signal, priority, recoveryHead) => {
      assertAccount()
      const background = priority === 'background' && !recoveryHead
      const traceId = groupInteractionTraceEnabled() ? globalThis.crypto?.randomUUID?.() : undefined
      groupInteractionTrace('directory-page-start', { traceId, continuation: cursor !== undefined, priority, recoveryHead })
      const page = await callArkme<ArkmePrivateInteractionDirectoryPage>('private-interaction.directory', {
        ...(background ? { background: true } : {}),
        limit: recoveryHead ? 20 : 100, ...(cursor ? { cursor } : {}), ...(version ? { expectedVersion: version } : {}),
      }, signal, background || traceId ? { ...(background ? { priority: 'background' } : {}), ...(traceId ? { traceId } : {}) } : undefined)
      assertAccount()
      groupInteractionTrace('directory-page-response', { traceId, rows: page.items.length, hasMore: page.hasMore })
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
      directorySnapshots.set(accountKey, { accountKey, rows, ...(error ? { error } : {}) })
      publishDirectory()
    },
  })
  return watcher
}

export function usePrivateInteractionDirectory(accountKey: string | undefined, enabled: boolean) {
  const readSnapshot = useCallback(() => enabled && accountKey !== undefined
    ? readPrivateInteractionDirectory(accountKey) : emptyDirectory, [accountKey, enabled])
  const snapshot = useSyncExternalStore(subscribePrivateInteractionDirectory, readSnapshot, readSnapshot)
  const mountedAccount = useRef<string | undefined>(undefined)
  const retry = useCallback(() => {
    if (enabled && accountKey !== undefined && mountedAccount.current === accountKey
      && activeDirectoryAccount() === accountKey) {
      directoryTasks.get(accountKey)?.watcher.retry()
    }
  }, [accountKey, enabled])
  useEffect(() => {
    if (!enabled || accountKey === undefined) return
    let task = directoryTasks.get(accountKey)
    if (task === undefined) {
      task = { watcher: startDirectoryTask(accountKey), subscribers: 0 }
      directoryTasks.set(accountKey, task)
    }
    task.subscribers++
    mountedAccount.current = accountKey
    return () => {
      mountedAccount.current = undefined
      if (--task.subscribers > 0) return
      task.watcher.dispose()
      directoryTasks.delete(accountKey)
      directorySnapshots.delete(accountKey)
      publishDirectory()
    }
  }, [accountKey, enabled])
  return { ...snapshot, retry }
}
