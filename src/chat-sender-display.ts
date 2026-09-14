import type { ArkmeSessionCredentials } from './keychain-store.js'
import type { ArkmeGroupBotBindingTarget } from './services/source-service.js'

/** Display-only data: never evidence of membership, installation or permission. */
export interface BotDisplayProfile {
  readonly displayName: string
  readonly avatarUrl?: string
}
export type BotDisplayProfiles = ReadonlyMap<string, BotDisplayProfile>
export interface BotDisplaySnapshot {
  readonly chatSessionUid: string
  readonly profiles: BotDisplayProfiles
  readonly groupTarget?: ArkmeGroupBotBindingTarget
}
export interface BotDisplayProfilesReader {
  read(input: {
    readonly botUids: ReadonlySet<string>
    readonly chatSessionUid: string
    readonly isGroup: boolean
    readonly snapshot?: BotDisplaySnapshot
  }, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<BotDisplayProfiles>
}

export function identifyTimelineSender(input: { recordUid: string; actorKind: number; botUid: string }):
  { kind: 'human' } | { kind: 'bot'; botUid: string } {
  const uid = input.recordUid.trim()
  const prefix = uid.startsWith('bot_reply_') ? 'bot_reply_'
    : uid.startsWith('bot_outbound_') ? 'bot_outbound_' : ''
  const oldFormat = /^\d+_bot[0-9A-Za-z]+~\d+_\d+_\d+~\d+$/.test(uid)
  if (input.actorKind !== 2 && prefix === '' && !oldFormat) return { kind: 'human' }
  let legacyUid = ''
  if (prefix !== '') {
    const main = uid.slice(prefix.length).split('__')[0] ?? ''
    const channel = /^([+-]?\d+)_([^_]+)_(.+)$/.exec(main)
    legacyUid = channel?.[2]?.trim() ?? /^([^_]+)_(.+)$/.exec(main)?.[1]?.trim() ?? ''
  } else legacyUid = /^\d+_(bot[0-9A-Za-z]+)~/.exec(uid)?.[1] ?? ''
  return { kind: 'bot', botUid: input.botUid.trim() || legacyUid }
}

export function hasMissingBotProfile(ids: ReadonlySet<string>, profiles: BotDisplayProfiles): boolean {
  return [...ids].some(uid => !profiles.get(uid)?.displayName.trim() || !profiles.get(uid)?.avatarUrl?.trim())
}

/** Participant fields win independently; directory profiles fill missing fields. */
export function supplementBotProfiles(
  profiles: BotDisplayProfiles, ids: ReadonlySet<string>, additions: BotDisplayProfiles,
): BotDisplayProfiles {
  const result = new Map(profiles)
  for (const [uid, profile] of additions) {
    if (!ids.has(uid)) continue
    const current = result.get(uid)
    const avatarUrl = current?.avatarUrl?.trim() || profile.avatarUrl?.trim()
    result.set(uid, { displayName: current?.displayName.trim() || profile.displayName.trim(),
      ...(avatarUrl ? { avatarUrl } : {}) })
  }
  return result
}

export function botDisplayName(profiles: BotDisplayProfiles, uid: string): string {
  return profiles.get(uid)?.displayName.trim() || 'Bot'
}
