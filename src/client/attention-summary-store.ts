import type { ArkmeChatAttentionSummary } from '../types.js'

export interface ArkmeAttentionSummarySnapshot {
  ready: boolean
  revision: number
  accountUserId?: number
  accountScope?: string
  summary?: ArkmeChatAttentionSummary
}

export class ArkmeAttentionSummaryStore {
  private snapshot: ArkmeAttentionSummarySnapshot = { ready: false, revision: 0 }
  private readonly listeners = new Set<() => void>()
  private activeUserId: number | undefined
  private activeAccountScope: string | undefined

  readonly getSnapshot = (): ArkmeAttentionSummarySnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  apply(summary: ArkmeChatAttentionSummary): void {
    if (!Number.isSafeInteger(summary.summaryVersion) || summary.summaryVersion <= 0
      || summary.summaryVersion < (this.snapshot.summary?.summaryVersion ?? 0)) return
    if (summary.summaryVersion === this.snapshot.summary?.summaryVersion
      && JSON.stringify(summary) === JSON.stringify(this.snapshot.summary)) return
    this.snapshot = {
      ready: true,
      revision: this.snapshot.revision + 1,
      ...(this.activeUserId === undefined ? {} : { accountUserId: this.activeUserId }),
      ...(this.activeAccountScope === undefined ? {} : { accountScope: this.activeAccountScope }),
      summary: { ...summary },
    }
    this.emit()
  }

  activateAccount(userId: number | undefined, accountScope?: string): void {
    const nextScope = userId === undefined ? undefined : accountScope ?? String(userId)
    if (userId === this.activeUserId && nextScope === this.activeAccountScope) return
    this.activeUserId = userId
    this.activeAccountScope = nextScope
    this.clear()
  }

  clear(): void {
    if (!this.snapshot.ready && this.snapshot.summary === undefined) return
    this.snapshot = {
      ready: false,
      revision: this.snapshot.revision + 1,
      ...(this.activeUserId === undefined ? {} : { accountUserId: this.activeUserId }),
      ...(this.activeAccountScope === undefined ? {} : { accountScope: this.activeAccountScope }),
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const arkmeAttentionSummary = new ArkmeAttentionSummaryStore()
