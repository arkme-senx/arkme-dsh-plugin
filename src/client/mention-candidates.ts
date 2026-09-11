import type {
  ArkmeBotSummary,
  ArkmeConversationMemberItem,
  ArkmeGroupBotCandidate,
  ArkmeTimelineMentionTarget,
} from '../types.js'

export interface ArkmeComposerMentionTrigger {
  startIndex: number
  endIndex: number
  query: string
}

export const ARKME_RESERVED_ASEN_BOT_REF = 'asen'
export const ARKME_RESERVED_ASEN_DISPLAY_NAME = '阿森'

export function arkmeComposerMentionTrigger(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): ArkmeComposerMentionTrigger | undefined {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)))
  const end = Math.max(0, Math.min(text.length, Math.trunc(selectionEnd)))
  if (start !== end) return undefined
  const prefix = text.slice(0, start)
  const atIndex = prefix.lastIndexOf('@')
  if (atIndex < 0) return undefined
  const query = text.slice(atIndex + 1, start)
  if (/[\s@]/u.test(query)) return undefined
  return { startIndex: atIndex, endIndex: start, query }
}

export function arkmeMentionCandidateMatches(
  member: Pick<ArkmeConversationMemberItem, 'displayName'> & {
    mentionDisplayName?: string
    mentionSecondaryName?: string
    memberName?: string
    secondaryName?: string
    searchText?: string
  },
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return [
    member.displayName, member.mentionDisplayName, member.mentionSecondaryName, member.memberName, member.secondaryName, member.searchText,
  ]
    .some(value => (value ?? '').toLowerCase().includes(normalizedQuery))
}

export type ArkmeMentionCandidate =
  | { kind: 'all'; displayName: '所有人' }
  | { kind: 'bot'; displayName: string; botRef: string; secondaryName?: string; avatarRef?: string; searchText?: string; reservedAgent?: 'asen' }
  | ({ kind: 'member'; mentionRef: string } & ArkmeConversationMemberItem)

export function arkmeMentionCandidateKey(candidate: ArkmeMentionCandidate): string {
  if (candidate.kind === 'all') return 'all'
  if (candidate.kind === 'bot') return `bot:${candidate.botRef}`
  return `member:${candidate.mentionRef}`
}

export function arkmeMentionCandidateIsReservedAsen(candidate: ArkmeMentionCandidate): boolean {
  return candidate.kind === 'bot'
    && (candidate.reservedAgent === 'asen' || candidate.botRef.trim().toLowerCase() === ARKME_RESERVED_ASEN_BOT_REF)
}

export function arkmeMentionCandidatePrimaryText(
  member: {
    kind: 'all' | 'bot' | 'member'
    displayName: string
    mentionDisplayName?: string
    mentionSecondaryName?: string
    secondaryName?: string
  },
): string {
  const displayName = (member.kind === 'member' ? member.mentionDisplayName : member.displayName)?.trim() || '成员'
  if (member.kind !== 'member') return displayName
  const secondaryName = (member.mentionSecondaryName ?? '').trim()
  if (secondaryName !== '' && secondaryName !== displayName) return `${displayName}（${secondaryName}）`
  return displayName
}

function arkmeAllMentionMatches(query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  return normalizedQuery === '' || '所有人'.toLowerCase().includes(normalizedQuery)
}

function arkmeReservedAsenMentionMatches(query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  return normalizedQuery === ''
    || ARKME_RESERVED_ASEN_DISPLAY_NAME.toLowerCase().includes(normalizedQuery)
    || ARKME_RESERVED_ASEN_BOT_REF.includes(normalizedQuery)
}

function arkmeLooksLikeReservedAsenBot(value: { botRef?: string; name?: string; displayName?: string }): boolean {
  const botRef = value.botRef?.trim().toLowerCase() ?? ''
  const displayName = (value.name ?? value.displayName ?? '').trim()
  return botRef === ARKME_RESERVED_ASEN_BOT_REF || displayName === ARKME_RESERVED_ASEN_DISPLAY_NAME
}

function arkmeReservedAsenMentionCandidate(query: string): ArkmeMentionCandidate[] {
  if (!arkmeReservedAsenMentionMatches(query)) return []
  return [{
    kind: 'bot',
    botRef: ARKME_RESERVED_ASEN_BOT_REF,
    displayName: ARKME_RESERVED_ASEN_DISPLAY_NAME,
    searchText: `${ARKME_RESERVED_ASEN_DISPLAY_NAME} ${ARKME_RESERVED_ASEN_BOT_REF}`,
    reservedAgent: 'asen',
  }]
}

export function arkmeGroupMentionCandidates(
  query: string,
  bots: readonly ArkmeGroupBotCandidate[],
  members: readonly ArkmeConversationMemberItem[],
): ArkmeMentionCandidate[] {
  const candidates: ArkmeMentionCandidate[] = []
  if (arkmeAllMentionMatches(query)) {
    candidates.push({ kind: 'all', displayName: '所有人' })
  }
  const botCandidates = bots
    .filter(bot => bot.installed && !arkmeLooksLikeReservedAsenBot(bot) && arkmeMentionCandidateMatches({
      displayName: bot.name,
      secondaryName: bot.description,
    }, query))
    .map(bot => ({
      kind: 'bot' as const,
      botRef: bot.botRef,
      displayName: bot.name,
      ...(bot.description.trim() === '' ? {} : { secondaryName: bot.description.trim() }),
      ...(bot.avatarRef === undefined ? {} : { avatarRef: bot.avatarRef }),
    }))
  candidates.push(...botCandidates)
  candidates.push(...arkmeReservedAsenMentionCandidate(query))
  candidates.push(...members
    .filter((member): member is ArkmeConversationMemberItem & { mentionRef: string; mentionDisplayName: string } =>
      !member.isSelf
      && member.mentionRef !== undefined
      && member.mentionDisplayName !== undefined
      && arkmeMentionCandidateMatches(member, query))
    .map(member => ({ ...member, kind: 'member' as const })))
  return candidates
}

export function arkmePrivateMentionCandidates(
  query: string,
  bots: readonly ArkmeBotSummary[],
): ArkmeMentionCandidate[] {
  const botCandidates = bots
    .filter(bot => bot.provider === 'openclaw' && !arkmeLooksLikeReservedAsenBot(bot) && arkmeMentionCandidateMatches({
      displayName: bot.name,
      secondaryName: bot.description,
    }, query))
    .slice(0, 8)
    .map(bot => ({
      kind: 'bot' as const,
      botRef: bot.botRef,
      displayName: bot.name,
      ...(bot.description.trim() === '' ? {} : { secondaryName: bot.description.trim() }),
    }))
  return [
    ...botCandidates,
    ...arkmeReservedAsenMentionCandidate(query),
  ]
}

function arkmeVisibleMentionLabel(mentionText: string): string {
  const trimmed = mentionText.trim()
  return trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed
}

export function arkmeMemberForVisibleMention(
  mentionText: string,
  members: readonly ArkmeConversationMemberItem[],
): ArkmeConversationMemberItem | undefined {
  const label = arkmeVisibleMentionLabel(mentionText)
  if (label === '' || label === '所有人') return undefined
  const matches = new Map<string, ArkmeConversationMemberItem>()
  for (const member of members) {
    if (member.status !== 'active') continue
    if ([
      member.mentionDisplayName,
      member.displayName,
      member.memberName,
      member.secondaryName,
      member.mentionSecondaryName,
    ].some(value => (value ?? '').trim() === label)) {
      matches.set(member.memberRef, member)
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined
}

export function arkmeMemberForMentionTarget(
  mentionTarget: ArkmeTimelineMentionTarget | undefined,
  members: readonly ArkmeConversationMemberItem[],
): ArkmeConversationMemberItem | undefined {
  if (mentionTarget?.kind !== 'member' || mentionTarget.memberRef === undefined) return undefined
  return members.find(member => member.status === 'active' && member.memberRef === mentionTarget.memberRef)
}

export function arkmeMemberForMention(
  mentionText: string,
  members: readonly ArkmeConversationMemberItem[],
  mentionTarget?: ArkmeTimelineMentionTarget,
): ArkmeConversationMemberItem | undefined {
  return arkmeMemberForMentionTarget(mentionTarget, members)
    ?? arkmeMemberForVisibleMention(mentionText, members)
}
