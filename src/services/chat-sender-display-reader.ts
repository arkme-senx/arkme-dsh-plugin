import { measureConversationReadPhase } from '../conversation-read-diagnostics.js'
import { hasMissingBotProfile, supplementBotProfiles,
  type BotDisplayCacheEntry, type BotDisplayProfile, type BotDisplayProfiles, type BotDisplayProfilesReader, type BotDisplaySnapshot } from '../chat-sender-display.js'
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

const BOT_DISPLAY_FRESH_MS = 5 * 60_000
const BOT_DISPLAY_MISSING_MS = 60_000
const BOT_DISPLAY_RETRY_MS = 10_000
const BOT_DISPLAY_STALE_MS = 24 * 60 * 60_000
type ReadInput = Parameters<BotDisplayProfilesReader['read']>[0]
type Cache = {
  entries: Map<string, BotDisplayCacheEntry>
  ready: Promise<void>
  retries: Map<string, { until: number; profile?: BotDisplayProfile }>
  flight?: Promise<void>
}

export class RuntimeBotDisplayProfilesReader implements BotDisplayProfilesReader {
  private readonly scopes = new Map<string, Cache>()

  constructor(private readonly runtime: ServiceRuntime, private readonly bot: Pick<BotService, 'senderDisplayProfiles'>) {}

  private scope(input: ReadInput, session: ArkmeSessionCredentials): string {
    return JSON.stringify([this.runtime.config?.environment, session.userId, input.chatSessionUid])
  }

  private cache(scope: string): Cache {
    const existing = this.scopes.get(scope)
    if (existing) {
      this.scopes.delete(scope)
      this.scopes.set(scope, existing)
      return existing
    }
    const cache: Cache = { entries: new Map(), retries: new Map(), ready: Promise.resolve() }
    if (this.runtime.stateStore?.readBotDisplayCache) {
      cache.ready = measureConversationReadPhase('bot-display-disk', async () => {
        const entries = await this.runtime.stateStore.readBotDisplayCache!(scope)
        for (const entry of entries) cache.entries.set(entry.uid, entry)
      }).catch(() => undefined)
    }
    this.scopes.set(scope, cache)
    this.trimScopes(scope)
    return cache
  }

  private trimScopes(keep?: string): void {
    for (const [key, value] of this.scopes) {
      if (this.scopes.size <= 128) break
      if (value.flight || key === keep) continue
      this.scopes.delete(key)
    }
  }

  private profiles(cache: Cache, input: ReadInput): BotDisplayProfiles {
    const profiles = new Map<string, BotDisplayProfile>()
    for (const uid of input.botUids) {
      const entry = cache.entries.get(uid)
      const cached = entry?.profile && Date.now() - entry.observedAt < BOT_DISPLAY_STALE_MS ? entry.profile : undefined
      const retry = cache.retries.get(uid)
      const partial = retry && retry.until > Date.now() ? retry.profile : undefined
      const avatarUrl = cached?.avatarUrl || partial?.avatarUrl
      if (cached || partial) profiles.set(uid, { displayName: cached?.displayName || partial?.displayName || '', ...(avatarUrl ? { avatarUrl } : {}) })
    }
    return profiles
  }

  async cached(input: ReadInput, session: ArkmeSessionCredentials): Promise<BotDisplayProfiles> {
    if (input.botUids.size === 0) return new Map()
    const cache = this.cache(this.scope(input, session))
    await cache.ready
    return this.profiles(cache, input)
  }

  async read(input: ReadInput, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<BotDisplayProfiles> {
    signal?.throwIfAborted()
    if (input.botUids.size === 0) return new Map()
    if (input.snapshot || input.uncached) {
      const profiles = await this.readRemote(input, session, signal)
      return new Map([...profiles].filter(([uid]) => input.botUids.has(uid)))
    }
    const scope = this.scope(input, session)
    const cache = this.cache(scope)
    await cache.ready
    for (;;) {
      signal?.throwIfAborted()
      const now = Date.now()
      const missing = new Set([...input.botUids].filter(uid => {
        const entry = cache.entries.get(uid)
        const ttl = entry?.profile?.displayName && entry.profile.avatarUrl ? BOT_DISPLAY_FRESH_MS : BOT_DISPLAY_MISSING_MS
        return (cache.retries.get(uid)?.until ?? 0) <= now && (!entry || now - entry.observedAt >= ttl)
      }))
      if (!missing.size) return this.profiles(cache, input)
      // A caller can leave without cancelling the shared lookup used by other pages.
      cache.flight ??= this.refresh(scope, cache, { ...input, botUids: missing }, session).finally(() => {
        delete cache.flight
        this.trimScopes()
      })
      if (!signal) await cache.flight
      else await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        cache.flight!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    }
  }

  private async refresh(scope: string, cache: Cache, input: ReadInput, session: ArkmeSessionCredentials): Promise<void> {
    let failed = false
    const profiles = await measureConversationReadPhase('bot-display-network',
      () => this.readRemote(input, session, undefined, () => { failed = true })).catch(error => {
      if (error instanceof ArkmeStaleRequestError) throw error
      failed = true
      return new Map<string, BotDisplayProfile>()
    })
    const now = Date.now()
    for (const [uid, retry] of cache.retries) if (retry.until <= now) cache.retries.delete(uid)
    const extras = [...profiles.keys()].filter(uid => !input.botUids.has(uid)).slice(0, Math.max(0, 512 - input.botUids.size))
    for (const uid of [...extras, ...input.botUids]) {
      const profile = profiles.get(uid)
      if (failed && (!profile?.displayName || !profile.avatarUrl)) {
        if (input.botUids.has(uid)) cache.retries.set(uid, { until: now + BOT_DISPLAY_RETRY_MS, ...(profile ? { profile } : {}) })
        continue
      }
      if (!input.botUids.has(uid) && (!profile?.displayName || !profile.avatarUrl)) continue
      cache.entries.delete(uid)
      cache.entries.set(uid, { uid, ...(profile ? { profile } : {}), observedAt: now })
    }
    while (cache.entries.size > 512) cache.entries.delete(cache.entries.keys().next().value!)
    while (cache.retries.size > 512) cache.retries.delete(cache.retries.keys().next().value!)
    await this.runtime.stateStore?.writeBotDisplayCache?.(scope, [...cache.entries.values()]).catch(() => undefined)
  }

  private async readRemote(input: ReadInput, session: ArkmeSessionCredentials, signal?: AbortSignal,
    onFailure?: () => void): Promise<BotDisplayProfiles> {
    if (input.botUids.size === 0) return new Map()
    const budget = AbortSignal.timeout(1_500)
    const identitySignal = signal === undefined ? budget : AbortSignal.any([signal, budget])
    const optionalFailure = (error: unknown) => {
      if (signal?.aborted || error instanceof ArkmeStaleRequestError) throw error
      onFailure?.()
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
    let profiles: BotDisplayProfiles = new Map(snapshot?.profiles)
    if (!identitySignal.aborted && hasMissingBotProfile(input.botUids, profiles)) {
      try {
        const directory = await this.bot.senderDisplayProfiles(session, identitySignal)
        profiles = supplementBotProfiles(profiles, new Set(directory.keys()), directory)
      }
      catch (error) { optionalFailure(error) }
    }
    if (input.isGroup && !identitySignal.aborted && hasMissingBotProfile(input.botUids, profiles)) {
      try {
        const directory = await this.groupSenderDisplayProfiles(input.chatSessionUid, session, identitySignal, snapshot)
        profiles = supplementBotProfiles(profiles, new Set(directory.keys()), directory)
      }
      catch (error) { optionalFailure(error) }
    }
    signal?.throwIfAborted()
    if (identitySignal.aborted) onFailure?.()
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
