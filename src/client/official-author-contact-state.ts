import { useEffect, useSyncExternalStore } from 'react'
import type { ArkmeAuthSnapshot, ArkmeSourceItem, ArkmeTimelineCursor, ArkmeTimelinePage } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { isArkmeOfficialAuthor } from './ArkmeOfficialAuthorGuide.js'

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
type HistoryLoader = (sourceRef: string, cursor: ArkmeTimelineCursor | undefined, signal: AbortSignal) => Promise<ArkmeTimelinePage>

function browserStorage(): StoragePort | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

function accountKey(auth: ArkmeAuthSnapshot | undefined): string | undefined {
  return auth?.status === 'authenticated' && auth.userId !== undefined
    ? `${auth.environment}:${auth.userId}` : undefined
}

/** UI-only evidence of a successful outgoing message; never stores message content. */
export class ArkmeOfficialAuthorContactState {
  private readonly confirmed = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: () => StoragePort | undefined = browserStorage) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  hasSent(account: string | undefined): boolean {
    if (account === undefined) return false
    if (this.confirmed.has(account)) return true
    try { return this.storage()?.getItem(`arkme.official-author.sent.v1:${account}`) === 'true' } catch { return false }
  }

  confirmSent(account: string | undefined, source: ArkmeSourceItem | undefined): void {
    if (account === undefined || !isArkmeOfficialAuthor(source) || this.hasSent(account)) return
    this.confirmed.add(account)
    try { this.storage()?.setItem(`arkme.official-author.sent.v1:${account}`, 'true') } catch { /* History restores the evidence if storage is unavailable. */ }
    for (const listener of this.listeners) listener()
  }

  async recover(
    account: string, source: ArkmeSourceItem, signal: AbortSignal, isCurrent: () => boolean,
    load: HistoryLoader = (sourceRef, cursor, requestSignal) => callArkme<ArkmeTimelinePage>(
      'source.timeline', { sourceRef, limit: 100, ...(cursor === undefined ? {} : { cursor }) }, requestSignal,
    ),
  ): Promise<void> {
    if (!isArkmeOfficialAuthor(source)) return
    let cursor: ArkmeTimelineCursor | undefined
    const visited = new Set<string>()
    try {
      while (!signal.aborted && isCurrent() && !this.hasSent(account)) {
        const page = await load(source.sourceRef, cursor, signal)
        if (signal.aborted || !isCurrent()) return
        // Incoming messages and failed/queued local messages do not dismiss the hint.
        if (page.items.some(item => item.isMe && item.status > 0)) {
          this.confirmSent(account, source)
          return
        }
        if (!page.hasMore || page.nextCursor === undefined) return
        const next = JSON.stringify(page.nextCursor)
        if (visited.has(next)) return
        visited.add(next)
        cursor = page.nextCursor
      }
    } catch { /* Keep the hint and retry on a new source snapshot or next mount. */ }
  }
}

export const arkmeOfficialAuthorContactState = new ArkmeOfficialAuthorContactState()

/** Mounted only for the author row: one cancellable history read, no per-row polling. */
export function useArkmeOfficialAuthorHasSent(source: ArkmeSourceItem): boolean {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = accountKey(auth)
  const sent = useSyncExternalStore(
    arkmeOfficialAuthorContactState.subscribe,
    () => arkmeOfficialAuthorContactState.hasSent(account),
    () => false,
  )
  useEffect(() => {
    if (account === undefined || sent) return
    const controller = new AbortController()
    const deadline = setTimeout(() => { controller.abort() }, 30_000)
    void arkmeOfficialAuthorContactState.recover(account, source, controller.signal,
      () => accountKey(arkmeAuthStore.getSnapshot().auth) === account,
    ).finally(() => { clearTimeout(deadline) })
    return () => { clearTimeout(deadline); controller.abort() }
  }, [account, sent, source.sourceRef, source.latestSequence, source.latestPreview])
  return sent
}
