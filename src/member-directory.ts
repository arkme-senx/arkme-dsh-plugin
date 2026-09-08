import type { ArkmeConversationMemberItem, ArkmeConversationMemberFacts, ArkmeConversationMemberJoinEvent, ArkmeConversationMemberJoinPerson, ArkmeConversationMemberUpdate } from './types.js'

/** Only for the members/page and members/by-user-ids read contracts: 2001/2002 mean unreadable membership/session. */
export function invalidatesMemberSnapshot(error: unknown): boolean {
  const failure = error as { code?: string; body?: { code?: string } }
  const code = failure?.body?.code ?? failure?.code
  return code !== undefined && ['auth-http-401', 'auth-http-403', 'login-required', 'login-expired', 'source-ref-invalid',
    'arkme-code-1000', 'arkme-code-403', 'arkme-code-1004', 'arkme-code-2001', 'arkme-code-2002', 'chat-members-source-invalid'].includes(code)
}

export function mergeMemberFacts(previous: ArkmeConversationMemberItem | undefined, facts: ArkmeConversationMemberFacts): ArkmeConversationMemberItem {
  const { memberName: _oldName, ...base } = previous ?? {
    displayName: facts.memberName || '群成员', recordCount: 0, mentionCount: 0, statsKnown: false,
  }
  return { ...base, memberRef: facts.memberRef, role: facts.role, status: facts.status,
    isSelf: facts.isSelf, isOwner: facts.isOwner, joinedAtMillis: facts.joinedAtMillis,
    ...(facts.memberName === undefined ? {} : { memberName: facts.memberName }) } as ArkmeConversationMemberItem
}

export function mergeMemberPresentation(previous: ArkmeConversationMemberItem | undefined, incoming: ArkmeConversationMemberItem, profileUnavailable: boolean): ArkmeConversationMemberItem {
  if (!profileUnavailable) return { ...incoming, statsKnown: true }
  return { ...incoming, statsKnown: true,
    ...(['', '群成员', '成员'].includes(incoming.displayName) && previous !== undefined ? { displayName: previous.displayName } : {}),
    ...(previous?.avatarRef === undefined ? {} : { avatarRef: previous.avatarRef }),
  }
}

/** Membership creates entities; details can only enrich or explicitly remove known entities. */
export function applyMemberUpdate(members: Map<string, ArkmeConversationMemberItem>, update: ArkmeConversationMemberUpdate): boolean {
  let changed = false
  const put = (item: ArkmeConversationMemberItem) => {
    const old = members.get(item.memberRef)
    const fields = new Set([...Object.keys(old ?? {}), ...Object.keys(item)] as (keyof ArkmeConversationMemberItem)[])
    if (old !== undefined && [...fields].every(field => old[field] === item[field])) return
    members.set(item.memberRef, item)
    changed = true
  }
  if (update.kind === 'membership') {
    for (const facts of update.items) put(mergeMemberFacts(members.get(facts.memberRef), facts))
  } else {
    const unavailable = new Set(update.unavailableProfileMemberRefs)
    for (const item of update.items) {
      const old = members.get(item.memberRef)
      if (old !== undefined) put(mergeMemberPresentation(old, item, unavailable.has(item.memberRef)))
    }
  }
  for (const ref of update.removedMemberRefs) if (members.delete(ref)) changed = true
  return changed
}

function validFacts(value: unknown): value is ArkmeConversationMemberFacts {
  if (!value || typeof value !== 'object') return false
  const item = value as ArkmeConversationMemberFacts
  return typeof item.memberRef === 'string' && item.memberRef.trim() !== '' && item.status === 'active'
    && ['owner', 'admin', 'member', 'unknown'].includes(item.role)
    && typeof item.isSelf === 'boolean' && typeof item.isOwner === 'boolean'
    && Number.isSafeInteger(item.joinedAtMillis) && item.joinedAtMillis >= 0
    && (item.memberName === undefined || typeof item.memberName === 'string')
}

export function cachedMemberItem(value: unknown): ArkmeConversationMemberItem | undefined {
  if (!validFacts(value)) return undefined
  const item = value as ArkmeConversationMemberItem
  if (typeof item.displayName !== 'string' || !Number.isSafeInteger(item.recordCount) || item.recordCount < 0
    || !Number.isSafeInteger(item.mentionCount) || item.mentionCount < 0 || (item.statsKnown !== undefined && typeof item.statsKnown !== 'boolean')) return undefined
  const result: ArkmeConversationMemberItem = {
    memberRef: item.memberRef, role: item.role, status: item.status, isSelf: item.isSelf, isOwner: item.isOwner,
    joinedAtMillis: item.joinedAtMillis, displayName: item.displayName, recordCount: item.recordCount, mentionCount: item.mentionCount,
    ...(item.statsKnown === undefined ? {} : { statsKnown: item.statsKnown }),
  }
  for (const field of ['memberName', 'secondaryName', 'avatarRef', 'mentionRef', 'mentionDisplayName', 'mentionSecondaryName'] as const) {
    if (item[field] === undefined) continue
    if (typeof item[field] !== 'string') return undefined
    result[field] = item[field]
  }
  return result
}

export function validateMemberUpdate(update: ArkmeConversationMemberUpdate): void {
  if (!Array.isArray(update.items) || !Array.isArray(update.removedMemberRefs) || update.items.some(item => !validFacts(item))
    || new Set(update.items.map(item => item.memberRef)).size !== update.items.length
    || update.removedMemberRefs.some(ref => typeof ref !== 'string' || !ref || update.items.some(item => item.memberRef === ref))) throw new Error('成员响应无效')
  if (update.kind === 'presentation') {
    if (update.items.length + update.removedMemberRefs.length > 50) throw new Error('成员资料超出批次上限')
    if (!Array.isArray(update.unavailableProfileMemberRefs)
      || update.unavailableProfileMemberRefs.some(ref => !update.items.some(item => item.memberRef === ref))
      || update.items.some(item => cachedMemberItem(item) === undefined)) throw new Error('成员资料响应无效')
  } else if (update.kind !== 'membership' || !['owner', 'admin', 'member'].includes(update.selfRole) || typeof update.hasMore !== 'boolean' || update.items.length + update.removedMemberRefs.length > 100) throw new Error('成员分页响应无效')
}

function joinPerson(value: ArkmeConversationMemberJoinPerson): ArkmeConversationMemberJoinPerson {
  if (!value || typeof value.displayName !== 'string' || typeof value.isSelf !== 'boolean'
    || (value.memberRef !== undefined && (typeof value.memberRef !== 'string' || !value.memberRef.trim()))) throw new Error('入群事件成员无效')
  return { displayName: value.displayName, isSelf: value.isSelf, ...(value.memberRef === undefined ? {} : { memberRef: value.memberRef }) }
}

export function mergeMemberJoinEvents(previous: readonly ArkmeConversationMemberJoinEvent[], incoming: readonly ArkmeConversationMemberJoinEvent[]): ArkmeConversationMemberJoinEvent[] {
  const events = new Map(previous.map(event => [event.eventId, event]))
  for (const event of incoming) {
    if (!event || typeof event.eventId !== 'string' || !event.eventId || !['invite', 'direct_add'].includes(event.action)
      || !Number.isSafeInteger(event.occurredAtMillis) || event.occurredAtMillis < 0 || !Array.isArray(event.invitees)) throw new Error('入群事件无效')
    const inviter = joinPerson(event.inviter)
    const incomingPeople = event.invitees.map(joinPerson)
    if (incomingPeople.some(person => !person.memberRef)) throw new Error('入群事件缺少成员身份')
    const old = events.get(event.eventId)
    const invitees = new Map((old?.invitees ?? []).map(person => [person.memberRef!, person]))
    for (const person of incomingPeople) invitees.set(person.memberRef!, person)
    events.set(event.eventId, { eventId: event.eventId, action: event.action, occurredAtMillis: event.occurredAtMillis, inviter, invitees: [...invitees.values()] })
  }
  return [...events.values()].slice(-2_000)
}
