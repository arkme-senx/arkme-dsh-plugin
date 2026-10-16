type Source = Record<string, unknown>

function rows(value: unknown): Source[] {
  return Array.isArray(value) ? value.filter((row): row is Source => row !== null && typeof row === 'object') : []
}

function id(value: unknown): number {
  const valueId = Number(value)
  return Number.isSafeInteger(valueId) && valueId > 0 ? valueId : 0
}

interface SpeakerGroup {
  owner: number
  segmentKey: string
  speakerNum: number
  start: number
  end: number
}

/**
 * Compatibility with WebRTC's room-level speaker tokens (buildCallSummarySpeakerRefs).
 * An ordinary two-party summary may attribute one role to each call endpoint even
 * when diarization split its audio. Reconstruct the structured token order, then
 * require the server's default labels to agree. Never infer identities from prose,
 * replace a private speaker label/binding, or collapse multiple roles on one side.
 */
export function callSummaryParticipantRoles(source: Source, template: string, labels: Source, users: Source): Map<string, number> {
  const result = new Map<string, number>()
  const participants = [...new Set([
    source.caller_user_id,
    ...(Array.isArray(source.callee_user_ids) ? source.callee_user_ids : []),
    ...(Array.isArray(source.connected_user_ids) ? source.connected_user_ids : []),
  ].map(id).filter(Boolean))]
  if (participants.length !== 2) return result
  const names = new Map(rows(source.participant_profiles).map(profile => [id(profile.user_id), String(profile.display_name ?? '').trim()]))
  const groups = new Map<string, SpeakerGroup>()
  for (const segment of rows(source.room_transcript_segments)) {
    if (!String(segment.text ?? '').trim()) continue
    const owner = id(segment.speaker_user_id), speakerNum = id(segment.speaker_num)
    const segmentKey = String(segment.speaker_profile_segment_key ?? '').trim()
    const start = Number(segment.start_ms), end = Number(segment.end_ms)
    // An incomplete transcript cannot establish the token numbering reliably.
    if (!participants.includes(owner) || !speakerNum || !segmentKey || !Number.isFinite(start) || !Number.isFinite(end)) return result
    const key = JSON.stringify([owner, segmentKey, speakerNum])
    const previous = groups.get(key)
    if (!previous || start < previous.start || (start === previous.start && end < previous.end)) {
      groups.set(key, { owner, speakerNum, segmentKey, start, end })
    }
  }
  const refs: Array<{ token: string; owner: number; defaultLabel: string }> = []
  for (const owner of participants) {
    const ownerGroups = [...groups.values()].filter(group => group.owner === owner).sort((a, b) =>
      a.start - b.start || a.end - b.end || (a.segmentKey < b.segmentKey ? -1 : a.segmentKey > b.segmentKey ? 1 : 0) || a.speakerNum - b.speakerNum)
    // The server uses {{user:id}} for a side with only one group.
    if (ownerGroups.length <= 1) continue
    const name = names.get(owner)
    if (!name) return result
    ownerGroups.forEach((_, index) => refs.push({ token: `{{speaker:s${refs.length + 1}}}`, owner,
      defaultLabel: `${name}方说话人${index < 26 ? String.fromCharCode(65 + index) : index + 1}` }))
  }
  const labelFor = (token: string) => labels[token] ?? labels[token.slice(10, -2)]
  const userFor = (token: string) => users[token] ?? users[token.slice(10, -2)]
  const mentioned = new Set(template.match(/\{\{(?:speaker|user):[^{}]+\}\}/g) ?? [])
  const knownTokens = new Set(refs.map(ref => ref.token))
  if ([...mentioned].some(token => token.startsWith('{{speaker:') && !knownTokens.has(token))) return result
  // All reconstructed tokens must exist; a changed server ordering must fail closed.
  if (!refs.length || refs.some(ref => typeof labelFor(ref.token) !== 'string')) return result
  for (const owner of participants) {
    const ownerRefs = refs.filter(ref => ref.owner === owner)
    const referenced = ownerRefs.filter(ref => mentioned.has(ref.token))
    if (referenced.length !== 1 || mentioned.has(`{{user:${owner}}}`)) continue
    // Named guests or bindings to someone else indicate a genuinely multi-person side.
    if (ownerRefs.some(ref => (userFor(ref.token) !== undefined && id(userFor(ref.token)) !== owner)
      || (userFor(ref.token) === undefined && labelFor(ref.token) !== ref.defaultLabel))) continue
    const ref = referenced[0]!
    if (userFor(ref.token) === undefined && labelFor(ref.token) === ref.defaultLabel) result.set(ref.token, owner)
  }
  return result
}
