import type { TeamConversation } from '../team-app-contract.js'
import { mergeTeamNotificationPolicy } from '../team-notification-contract.js'

const rows = new Map<string, Map<string, TeamConversation>>()
const listeners = new Set<(account: string) => void>()
const emit = (account: string) => { for (const listener of listeners) listener(account) }

/** A successful explicit open is a display fact, independent of first publication. */
export function mergeOpenedTeamConversation(previous: TeamConversation | undefined, incoming: TeamConversation): TeamConversation {
  if (!previous) return incoming
  const older = incoming.lastSeq < previous.lastSeq || incoming.lastSeq === previous.lastSeq &&
    (incoming.revision < previous.revision || incoming.revision === previous.revision && incoming.updatedAt < previous.updatedAt)
  const current = older ? previous : incoming, other = older ? incoming : previous
  return { ...current,
    ...(current.lastSeq === other.lastSeq && current.myReadSeq < other.myReadSeq ? { myReadSeq: other.myReadSeq, unread: other.unread } : {}),
    notificationPolicy: mergeTeamNotificationPolicy(previous.notificationPolicy, incoming.notificationPolicy) }
}

export const openedTeamConversations = {
  read(account: string): readonly TeamConversation[] { return [...(rows.get(account)?.values() ?? [])] },
  retain(account: string, conversation: TeamConversation): void {
    if (!account || conversation.side !== 'team' || !conversation.ref || !conversation.key || !conversation.channel?.jotmoId) return
    let entries = rows.get(account)
    if (!entries) { entries = new Map(); rows.set(account, entries) }
    const value = mergeOpenedTeamConversation(entries.get(conversation.key), conversation)
    entries.delete(conversation.key); entries.set(conversation.key, value)
    while (entries.size > 100) entries.delete(entries.keys().next().value!)
    while (rows.size > 8) rows.delete(rows.keys().next().value!)
    emit(account)
  },
  // Directory owner transforms authority updates without recursively publishing its own refresh.
  reconcile(account: string, transform: (conversation: TeamConversation) => TeamConversation | undefined): void {
    const entries = rows.get(account)
    if (!entries) return
    for (const [key, value] of entries) {
      const next = transform(value)
      if (next) entries.set(key, next); else entries.delete(key)
    }
  },
  reset(account?: string): void {
    for (const key of [...rows.keys()]) if (account === undefined || account === key) { rows.delete(key); emit(key) }
  },
  remove(account: string, key: string): void { if (rows.get(account)?.delete(key)) emit(account) },
  activate(account: string): void {
    for (const key of [...rows.keys()]) if (account !== key) this.reset(key)
  },
  subscribe(listener: (account: string) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
}
