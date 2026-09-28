/** A bounded, explicitly recent estimate from the existing day-transcript API. */
export interface RecentSpeakerTranscriptDay {
  dateStamp: number
  response: unknown
}

export interface RecentSpeakerPresenceStat {
  speakerId: string
  dayCount: number
  lastSeenAt: number
}

export interface RecentSpeakerMember {
  /** Stable only within this owner's recognized-speaker projection. */
  identityKey: string
  token: string
  dayCount: number
  lastSeenAt: number
}

export interface RecentSpeakerPresenceDetail extends RecentSpeakerPresenceStat {
  members: RecentSpeakerMember[]
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : NaN

/**
 * Count positive-duration ASR facts, including a segment whose text is empty.
 * The day endpoint already scopes visible recordings; user_id additionally
 * prevents a shared or unrelated session from entering this owner's estimate.
 */
export function projectRecentSpeakerDetails(
  speakers: unknown,
  days: readonly RecentSpeakerTranscriptDay[],
  ownerUserId: number,
): RecentSpeakerPresenceDetail[] {
  const personBySpeaker = new Map<string, string>()
  for (const raw of list(speakers)) {
    const speaker = record(raw)
    const id = string(speaker.speaker_id ?? speaker.id ?? speaker.spk_id)
    if (id === '') continue
    const userId = number(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id)
    personBySpeaker.set(id, Number.isSafeInteger(userId) && userId > 0 ? `user:${userId}` : `speaker:${id}`)
  }
  const presenceByPerson = new Map<string, {
    days: Set<number>
    lastSeenAt: number
    members: Map<string, { token: string; days: Set<number>; lastSeenAt: number }>
  }>()
  for (const day of days) {
    const dayEnd = new Date(day.dateStamp)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const sessions = new Map<string, {
      startAt: number
      speakerByNumber: Map<number, { speakerId: string; identityKey: string; token: string }>
    }>()
    const response = record(day.response)
    for (const raw of list(response.session_ls ?? response.sessions)) {
      const session = record(raw)
      const sessionId = string(session.id ?? session.session_id)
      if (sessionId === '' || number(session.user_id) !== ownerUserId) continue
      const speakerByNumber = new Map<number, { speakerId: string; identityKey: string; token: string }>()
      for (const rawSpeaker of list(session.spk_ls ?? session.speakers)) {
        const speaker = record(rawSpeaker)
        const speakerNumber = number(speaker.num ?? speaker.speaker_num)
        if (!Number.isSafeInteger(speakerNumber)) continue
        const displayNumber = number(speaker.speaker_display_number)
        const innerId = string(speaker.inner_spk_id)
        const dayId = string(speaker.day_spk_id)
        const legacyToken = string(speaker.inner_display ?? speaker.label)
        const identityKey = Number.isSafeInteger(displayNumber) && displayNumber > 0
          ? `number:${displayNumber}` : innerId !== '' ? `inner:${innerId}` : dayId !== '' ? `day:${dayId}` : ''
        const token = Number.isSafeInteger(displayNumber) && displayNumber > 0 ? String(displayNumber) : legacyToken
        speakerByNumber.set(speakerNumber, {
          speakerId: string(speaker.spk_id ?? speaker.speaker_id),
          identityKey: identityKey !== '' && token !== '' ? identityKey : '',
          token,
        })
      }
      sessions.set(sessionId, { startAt: number(session.start_at), speakerByNumber })
    }
    for (const raw of list(response.child_ls ?? response.children)) {
      const child = record(raw)
      const session = sessions.get(string(child.session_id))
      if (session === undefined || !Number.isFinite(session.startAt)) continue
      const offset = number(child.start_at)
      if (!Number.isFinite(offset)) continue
      const childStart = offset >= 100_000_000_000 ? offset : session.startAt + offset
      for (const rawItem of list(child.asr)) {
        const item = record(rawItem)
        const startOffset = number(item.s ?? item.start_at)
        const endOffset = number(item.e ?? item.end_at)
        const seenAt = childStart + startOffset
        const seenEndAt = childStart + endOffset
        if (!Number.isFinite(seenAt) || !Number.isFinite(seenEndAt) || seenEndAt <= seenAt
          || seenAt < day.dateStamp || seenAt >= dayEnd.getTime()) continue
        const identitySource = string(item.speaker_identity_source)
        if (identitySource === 'system') continue
        const recognized = session.speakerByNumber.get(number(item.n ?? item.speaker_num))
        const sessionSpeakerId = recognized?.speakerId ?? ''
        const effectiveId = string(item.effective_spk_id)
        const directId = string(item.q)
        const explicitlyUnassigned = directId === '' && sessionSpeakerId !== ''
          && string(item.q_unassigned_spk_id) === sessionSpeakerId
        const speakerId = effectiveId || (explicitlyUnassigned ? '' : directId || sessionSpeakerId)
        const personKey = personBySpeaker.get(speakerId)
        if (personKey === undefined) continue
        let presence = presenceByPerson.get(personKey)
        if (presence === undefined) {
          presence = { days: new Set<number>(), lastSeenAt: 0, members: new Map() }
          presenceByPerson.set(personKey, presence)
        }
        presence.days.add(day.dateStamp)
        presence.lastSeenAt = Math.max(presence.lastSeenAt, seenEndAt)
        if (recognized?.identityKey) {
          let member = presence.members.get(recognized.identityKey)
          if (member === undefined) {
            member = { token: recognized.token, days: new Set<number>(), lastSeenAt: 0 }
            presence.members.set(recognized.identityKey, member)
          }
          member.days.add(day.dateStamp)
          member.lastSeenAt = Math.max(member.lastSeenAt, seenEndAt)
        }
      }
    }
  }
  return [...personBySpeaker].flatMap(([speakerId, personKey]) => {
    const presence = presenceByPerson.get(personKey)
    return presence === undefined ? [] : [{
      speakerId, dayCount: presence.days.size, lastSeenAt: presence.lastSeenAt,
      members: [...presence.members].map(([identityKey, member]) => ({
        identityKey, token: member.token, dayCount: member.days.size, lastSeenAt: member.lastSeenAt,
      })).sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.token.localeCompare(right.token)),
    }]
  })
}

export function projectRecentSpeakerPresence(
  speakers: unknown,
  days: readonly RecentSpeakerTranscriptDay[],
  ownerUserId: number,
): RecentSpeakerPresenceStat[] {
  return projectRecentSpeakerDetails(speakers, days, ownerUserId)
    .map(({ speakerId, dayCount, lastSeenAt }) => ({ speakerId, dayCount, lastSeenAt }))
}
