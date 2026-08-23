import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import type { ContactDirectoryState } from './contact-directory-state.js'
import type { ArkmeDirectorySectionKind } from '../../../types.js'

const DEFAULT_DIRECTORY_CACHE_MAX_AGE_MS = 30_000

export interface ContactsTabStoreOptions {
  directoryCacheMaxAgeMs?: number
  now?: () => number
}

export interface ContactsDirectoryCache {
  state: ContactDirectoryState
  fresh: boolean
}

export type ContactsTabExpandedSections = Record<ArkmeDirectorySectionKind, boolean>

const defaultExpandedSections = (): ContactsTabExpandedSections => ({
  groups: false, bots: false, 'unmarked-speakers': false, teams: false, contacts: true,
})

export interface ContactsTabSnapshot {
  accountKey?: string
  generation: number
  refreshRevision: number
  selection: ArkmeDirectorySelection
  expandedSections: ContactsTabExpandedSections
}

/** Cross-seat state for the Contacts tab only; conversation state remains in arkmeUi. */
export class ContactsTabStore {
  private snapshot: ContactsTabSnapshot = { generation: 0, refreshRevision: 0, selection: { kind: 'none' }, expandedSections: defaultExpandedSections() }
  private directoryCache: { state: ContactDirectoryState; refreshedAtMillis: number } | undefined
  private readonly listeners = new Set<() => void>()
  private readonly aborters = new Set<() => void>()
  private readonly directoryCacheMaxAgeMs: number
  private readonly now: () => number
  constructor(options: ContactsTabStoreOptions = {}) {
    this.directoryCacheMaxAgeMs = Math.max(0, Math.trunc(options.directoryCacheMaxAgeMs ?? DEFAULT_DIRECTORY_CACHE_MAX_AGE_MS))
    this.now = options.now ?? Date.now
  }
  readonly getSnapshot = (): ContactsTabSnapshot => this.snapshot
  getSnapshotForAccount(accountKey: string | undefined): ContactsTabSnapshot {
    return this.snapshot.accountKey === accountKey ? this.snapshot : {
      ...(accountKey === undefined ? {} : { accountKey }), generation: this.snapshot.generation + 1,
      refreshRevision: 0, selection: { kind: 'none' }, expandedSections: defaultExpandedSections(),
    }
  }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Registers a network cancellation hook that must run before a new tab intent is published. */
  bindAborter(aborter: () => void): () => void {
    this.aborters.add(aborter)
    return () => { this.aborters.delete(aborter) }
  }
  getDirectoryCache(accountKey: string | undefined): ContactsDirectoryCache | undefined {
    const cached = this.directoryCache
    if (accountKey === undefined || this.snapshot.accountKey !== accountKey || cached?.state.accountKey !== accountKey) return undefined
    return {
      state: cached.state,
      fresh: cached.refreshedAtMillis > 0 && this.now() - cached.refreshedAtMillis <= this.directoryCacheMaxAgeMs,
    }
  }
  cacheDirectoryState(state: ContactDirectoryState, refreshed: boolean): void {
    if (this.snapshot.accountKey === undefined || state.accountKey !== this.snapshot.accountKey) return
    const previousRefresh = this.directoryCache?.state.accountKey === state.accountKey
      ? this.directoryCache.refreshedAtMillis
      : 0
    this.directoryCache = {
      state,
      refreshedAtMillis: refreshed ? this.now() : previousRefresh,
    }
  }
  activateAccount(accountKey: string | undefined): void {
    if (this.snapshot.accountKey !== accountKey) {
      this.abortPending()
      this.directoryCache = undefined
      this.publish({
        ...(accountKey === undefined ? {} : { accountKey }), generation: this.snapshot.generation + 1,
        refreshRevision: 0, selection: { kind: 'none' }, expandedSections: defaultExpandedSections(),
      })
    }
  }
  select(selection: ArkmeDirectorySelection): void {
    if (this.snapshot.accountKey !== undefined) {
      this.abortPending()
      this.publish({ ...this.snapshot, generation: this.snapshot.generation + 1, selection })
    }
  }
  clear(): void {
    this.abortPending()
    const cached = this.directoryCache
    if (cached !== undefined && cached.state.accountKey === this.snapshot.accountKey) {
      this.directoryCache = {
        ...cached,
        state: { ...cached.state, selection: { kind: 'none' } },
      }
    }
    this.publish({ ...this.snapshot, generation: this.snapshot.generation + 1, selection: { kind: 'none' } })
  }
  refresh(): void {
    this.abortPending()
    this.publish({ ...this.snapshot, generation: this.snapshot.generation + 1, refreshRevision: this.snapshot.refreshRevision + 1 })
  }
  setSectionExpanded(section: ArkmeDirectorySectionKind, expanded: boolean): void {
    if (this.snapshot.accountKey === undefined || this.snapshot.expandedSections[section] === expanded) return
    const cached = this.directoryCache
    if (cached?.state.accountKey === this.snapshot.accountKey) {
      const current = cached.state.sections[section]
      this.directoryCache = {
        ...cached,
        state: {
          ...cached.state,
          sections: {
            ...cached.state.sections,
            [section]: { ...current, expanded },
          },
        },
      }
    }
    this.publish({ ...this.snapshot, expandedSections: { ...this.snapshot.expandedSections, [section]: expanded } })
  }
  private publish(next: ContactsTabSnapshot): void { this.snapshot = next; for (const listener of this.listeners) listener() }
  private abortPending(): void { for (const abort of this.aborters) abort() }
}

export const arkmeContactsTab = new ContactsTabStore()
