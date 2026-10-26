import type { ArkmeChatClientEvent } from '../types.js'
import type { TeamConversation } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { showBrowserNotification } from './browser-notification.js'
import { openTeamMessages } from './team-messaging-events.js'

type Notice = Extract<ArkmeChatClientEvent, { type: 'team-message-notification' }>['notification']
interface Ports {
  current(): boolean
  resolve(ref: string, signal: AbortSignal): Promise<TeamConversation>
  open(conversation: TeamConversation): void
  show: typeof showBrowserNotification
}

/** Plugin-owned presentation: the desktop shell never interprets Team identity. */
export class TeamMessageNotificationPresenter {
  private readonly notices = new Map<string, { expires: number; close(): void }>()
  private readonly controller = new AbortController()
  private opening: AbortController | undefined
  constructor(private readonly ports: Ports) {}

  show(notice: Notice): void {
    if (this.controller.signal.aborted || !this.ports.current() || notice.expiresAtMillis <= Date.now()) return
    for (const [key, entry] of this.notices) {
      if (entry.expires <= Date.now()) { entry.close(); this.notices.delete(key) }
    }
    if (this.notices.has(notice.eventUid)) return
    const close = this.ports.show(notice.title, notice.body, `arkme-team-message-${notice.eventUid}`, () => {
      if (!this.ports.current() || this.controller.signal.aborted) return
      this.opening?.abort()
      const request = new AbortController()
      this.opening = request
      const signal = AbortSignal.any([request.signal, this.controller.signal, AbortSignal.timeout(10000)])
      void this.ports.resolve(notice.sourceRef, signal).then(conversation => {
        if (!signal.aborted && this.opening === request && this.ports.current()) this.ports.open(conversation)
      }).catch(() => { /* Current access/network failure cannot open stale content. */ })
        .finally(() => { if (this.opening === request) this.opening = undefined })
    })
    if (!close) return
    this.notices.set(notice.eventUid, { expires: notice.expiresAtMillis, close })
    while (this.notices.size > 64) {
      const first = this.notices.entries().next().value
      if (!first) break
      first[1].close(); this.notices.delete(first[0])
    }
  }

  dispose(): void {
    this.controller.abort()
    this.opening?.abort()
    for (const entry of this.notices.values()) entry.close()
    this.notices.clear()
  }
}

export function createTeamMessageNotificationPresenter(current: () => boolean): TeamMessageNotificationPresenter {
  return new TeamMessageNotificationPresenter({ current,
    resolve: (notificationRef, signal) => callArkme<TeamConversation>('team.app.notification.open', { notificationRef }, signal),
    open: conversation => openTeamMessages({ kind: 'conversation', conversation }),
    show: showBrowserNotification,
  })
}
