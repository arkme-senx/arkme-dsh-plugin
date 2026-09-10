type MemberEventHint = { account: string; sourceKey: string; eventId: string; occurredAtMillis: number }
const listeners = new Set<(hint: MemberEventHint) => void>()

export function publishMemberEventHint(hint: MemberEventHint): void {
  for (const listener of listeners) listener(hint)
}

export function subscribeAllMemberEventHints(listener: (hint: MemberEventHint) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function subscribeMemberEventHints(account: string, sourceKey: string, listener: (eventId: string, occurredAt: number) => void): () => void {
  const scoped = (hint: MemberEventHint) => {
    if (hint.account === account && hint.sourceKey === sourceKey) listener(hint.eventId,hint.occurredAtMillis)
  }
  listeners.add(scoped)
  return () => { listeners.delete(scoped) }
}
