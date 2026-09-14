import { hasMissingBotProfile, supplementBotProfiles,
  type BotDisplayProfiles, type BotDisplayProfilesReader, type BotDisplaySnapshot } from '../chat-sender-display.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmeStaleRequestError } from '../request-coordinator.js'
import { arkmeGroupBotBindingBody, arkmeGroupBotBindingTargetFromBundle } from './source-service.js'
import type { BotService } from './bot-service.js'
import { objectValue, stringValue, type ServiceRuntime } from './service.js'

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown) => stringValue(value).trim()
const first = (raw: Record<string, unknown>, keys: string[]) => keys.map(key => text(raw[key])).find(Boolean) ?? ''

/** Normalize wire data once. Neither raw participants nor their extra fields escape this adapter. */
export function botDisplaySnapshot(bundle: Record<string, unknown>): BotDisplaySnapshot {
  const session = objectValue(bundle.session)
  const chatSessionUid = text(session.chat_session_uid)
  const extra = objectValue(session.extra)
  const groupTarget = arkmeGroupBotBindingTargetFromBundle(bundle)
    ?? arkmeGroupBotBindingTargetFromBundle({ rm_subject_id: extra.subject_id ?? extra.legacy_subject_id })
  const profiles = new Map<string, { displayName: string; avatarUrl?: string }>()
  for (const value of list(bundle.bot_participants)) {
    const participant = objectValue(value)
    const uid = text(participant.bot_uid)
    if (uid === '' || text(participant.chat_session_uid) !== chatSessionUid) continue
    const details = objectValue(participant.extra)
    const avatarUrl = first(details, ['avatar_url', 'avatarUrl', 'head_img', 'headImg'])
    profiles.set(uid, {
      displayName: text(participant.display_name_snapshot)
        || first(details, ['display_name_snapshot', 'displayNameSnapshot', 'bot_name', 'botName', 'name', 'nickname']),
      ...(avatarUrl === '' ? {} : { avatarUrl }),
    })
  }
  return { chatSessionUid, profiles, ...(groupTarget === undefined ? {} : { groupTarget }) }
}

export class RuntimeBotDisplayProfilesReader implements BotDisplayProfilesReader {
  constructor(private readonly runtime: ServiceRuntime, private readonly bot: Pick<BotService, 'senderDisplayProfiles'>) {}

  async read(input: Parameters<BotDisplayProfilesReader['read']>[0], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<BotDisplayProfiles> {
    if (input.botUids.size === 0) return new Map()
    const budget = AbortSignal.timeout(1_500)
    const identitySignal = signal === undefined ? budget : AbortSignal.any([signal, budget])
    const optionalFailure = (error: unknown) => {
      if (signal?.aborted || error instanceof ArkmeStaleRequestError) throw error
    }
    let snapshot = input.snapshot
    if (snapshot === undefined) {
      try {
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/display-snapshots', { chat_session_uids: [input.chatSessionUid] }, session, identitySignal,
          { refreshOnUnauthorized: false },
        )
        snapshot = list(data.items).map(value => botDisplaySnapshot(objectValue(value)))
          .find(item => item.chatSessionUid === input.chatSessionUid)
      } catch (error) { optionalFailure(error) }
    }
    if (snapshot?.chatSessionUid !== input.chatSessionUid) snapshot = undefined
    let profiles: BotDisplayProfiles = new Map([...snapshot?.profiles ?? []].filter(([uid]) => input.botUids.has(uid)))
    if (!identitySignal.aborted && hasMissingBotProfile(input.botUids, profiles)) {
      try { profiles = supplementBotProfiles(profiles, input.botUids, await this.bot.senderDisplayProfiles(session, identitySignal)) }
      catch (error) { optionalFailure(error) }
    }
    if (input.isGroup && !identitySignal.aborted && hasMissingBotProfile(input.botUids, profiles)) {
      try { profiles = supplementBotProfiles(profiles, input.botUids, await this.groupSenderDisplayProfiles(input.chatSessionUid, session, identitySignal, snapshot)) }
      catch (error) { optionalFailure(error) }
    }
    signal?.throwIfAborted()
    return profiles
  }

  async groupSenderDisplayProfiles(chatSessionUid: string, session: ArkmeSessionCredentials, signal?: AbortSignal, known?: BotDisplaySnapshot): Promise<BotDisplayProfiles> {
    const snapshot = known?.groupTarget !== undefined ? known : botDisplaySnapshot(await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail', { chat_session_uid: chatSessionUid }, session, signal, { refreshOnUnauthorized: false },
    ))
    if (snapshot.chatSessionUid !== chatSessionUid || snapshot.groupTarget === undefined) return new Map()
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/group/list', arkmeGroupBotBindingBody({ ownerRef: chatSessionUid, botGroupTarget: snapshot.groupTarget }), session, signal,
      { refreshOnUnauthorized: false, key: `group-bot-sender-display-names:${chatSessionUid}`, cancelWhenUnobserved: true },
    )
    const profiles = new Map<string, { displayName: string; avatarUrl?: string }>()
    for (const value of list(data.bots)) {
      const raw = objectValue(value)
      if (raw.installed === true && text(raw.bot_id) !== '' && text(raw.name) !== '') profiles.set(text(raw.bot_id), { displayName: text(raw.name), avatarUrl: text(raw.avatar_url) || text(raw.avatar) })
    }
    return profiles
  }
}
