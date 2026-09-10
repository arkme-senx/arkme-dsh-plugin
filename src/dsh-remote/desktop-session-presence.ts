import { DshRemoteError } from './errors.js'

export const DESKTOP_SESSION_LEASE_MS = 30_000

/** Browser selection is ephemeral; it is neither session history nor run state. */
export class DesktopSessionPresence {
  private readonly windows = new Map<string, {
    revision: number; sessionRef: string | null; seenAt: number; selectedAt: number
  }>()

  private selected: string | undefined
  private revision = 0

  clear(): void { this.windows.clear(); this.selected = undefined; this.revision = 0 }

  snapshot(now: number): { sessionRef: string | undefined; revision: number } {
    this.prune(now)
    const sessionRef = [...this.windows.values()].filter(value => value.sessionRef !== null)
      .sort((a, b) => b.selectedAt - a.selectedAt)[0]?.sessionRef ?? undefined
    if (sessionRef !== this.selected) { this.selected = sessionRef; this.revision++ }
    return { sessionRef, revision: this.revision }
  }

  expiryDelay(now: number): number | undefined {
    this.prune(now)
    if (this.windows.size === 0) return undefined
    return Math.max(1, Math.min(...[...this.windows.values()].map(value => value.seenAt + DESKTOP_SESSION_LEASE_MS - now)))
  }

  report(input: { windowRef: string; revision: number; sessionRef: string | null }, now: number): void {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.windowRef)
      || !Number.isSafeInteger(input.revision) || input.revision < 1
      || (input.sessionRef !== null && !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(input.sessionRef))) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '当前会话状态无效')
    }
    this.prune(now)
    const previous = this.windows.get(input.windowRef)
    if (previous !== undefined && input.revision <= previous.revision) return
    if (previous === undefined && this.windows.size >= 8) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '当前会话窗口数量超出限制')
    }
    this.windows.set(input.windowRef, {
      revision: input.revision, sessionRef: input.sessionRef, seenAt: now,
      selectedAt: previous?.sessionRef === input.sessionRef ? previous.selectedAt : now,
    })
  }

  current(now: number): string | undefined {
    return this.snapshot(now).sessionRef
  }

  private prune(now: number): void {
    for (const [key, value] of this.windows) {
      if (now - value.seenAt >= DESKTOP_SESSION_LEASE_MS) this.windows.delete(key)
    }
  }
}
