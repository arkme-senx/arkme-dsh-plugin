import type { ArkmeArkoHistoryPage } from '../types.js'
import { callArkme } from './api.js'
import {
  ArkmeArkoConversationPreviewStore,
  arkmeArkoConversationPreviewStore,
} from './arko-conversation-preview-store.js'

export const ARKO_CONVERSATION_PREVIEW_SYNC_INTERVAL_MS = 15_000

export interface ArkmeArkoPreviewVisibilityTarget {
  readonly visibilityState: string
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export type ArkmeArkoPreviewHistoryLoader = (
  signal: AbortSignal,
) => Promise<ArkmeArkoHistoryPage>

function browserVisibilityTarget(): ArkmeArkoPreviewVisibilityTarget | undefined {
  return typeof document === 'undefined'
    ? undefined
    : document as unknown as ArkmeArkoPreviewVisibilityTarget
}

/**
 * Keeps the navigation preview fresh when Arko messages are written by another
 * client or a DSH Tool. Arko has no dedicated cross-device push projection, so
 * this foreground-only poll is the browser-side freshness owner.
 */
export class ArkmeArkoConversationPreviewSync {
  private running = false
  private userId: number | undefined
  private generation = 0
  private interval: ReturnType<typeof setInterval> | undefined
  private controller: AbortController | undefined
  private pending: Promise<void> | undefined
  private readonly onVisibilityChange = () => {
    if (this.visibilityTarget?.visibilityState === 'visible') void this.refresh()
  }

  constructor(
    private readonly store: ArkmeArkoConversationPreviewStore = arkmeArkoConversationPreviewStore,
    private readonly loadHistory: ArkmeArkoPreviewHistoryLoader = async signal => await callArkme<ArkmeArkoHistoryPage>(
      'arko.history',
      { limit: 10, offset: 0 },
      signal,
    ),
    private readonly intervalMs = ARKO_CONVERSATION_PREVIEW_SYNC_INTERVAL_MS,
    private readonly visibilityTarget = browserVisibilityTarget(),
  ) {}

  start(userId: number): () => void {
    this.stop()
    if (!Number.isSafeInteger(userId) || userId <= 0) return () => undefined
    this.running = true
    this.userId = userId
    this.store.activateUser(userId)
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibilityChange)
    void this.refresh()
    this.interval = setInterval(() => { void this.refresh() }, this.intervalMs)
    return () => { this.stop() }
  }

  stop(): void {
    const wasRunning = this.running
    this.running = false
    this.userId = undefined
    this.generation += 1
    this.controller?.abort()
    this.controller = undefined
    this.pending = undefined
    if (this.interval !== undefined) clearInterval(this.interval)
    this.interval = undefined
    if (wasRunning) this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  async refresh(): Promise<void> {
    if (!this.running || this.userId === undefined) return
    if (this.visibilityTarget !== undefined && this.visibilityTarget.visibilityState !== 'visible') return
    if (this.pending !== undefined) return await this.pending
    const request = this.store.beginHistoryRequest(this.userId)
    if (request === undefined) return
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    const task = this.loadHistory(controller.signal)
      .then(page => {
        if (!this.running || controller.signal.aborted || this.generation !== generation) return
        this.store.setLatestFromHistory(request, page.items)
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.controller === controller) this.controller = undefined
        if (this.pending === task) this.pending = undefined
      })
    this.pending = task
    await task
  }
}
