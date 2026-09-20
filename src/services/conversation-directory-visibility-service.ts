import type { ArkmeConversationDirectoryVisibility, ArkmeSourceItem } from '../types.js'
import {
  BOT_DIRECT_CONVERSATION_LIST_ENTITY,
  CHAT_SESSION_CONVERSATION_LIST_ENTITY,
  CONVERSATION_LIST_DISMISSED,
  conversationListPreferenceRefKey,
  conversationListPreferenceIsDismissed,
  type ConversationListPreferenceEntry,
  type ConversationListPreferencePort,
  type ConversationListPreferenceRef,
} from './conversation-list-preference-service.js'
import { ArkmePluginError } from './service.js'

const MAX_DIRECTORY_VISIBILITY_REFS = 1_000

export interface ConversationDirectoryChatEntryPort {
  chatConversationListPreferenceEntry(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ConversationListPreferenceEntry>
}

export interface ConversationDirectoryBotEntryPort {
  botConversationListPreferenceEntry(botRef: string): Promise<ConversationListPreferenceEntry>
  openBotChat(botRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeSourceItem>
}

export interface ConversationDirectoryVisibilityInvalidationPort {
  invalidateConversationListPreferenceForCurrentSession(): Promise<void>
}

/** Sidebar application service; raw source and Bot APIs remain unfiltered owner projections. */
export class ConversationDirectoryVisibilityService {
  constructor(
    private readonly preference: ConversationListPreferencePort,
    private readonly source: ConversationDirectoryChatEntryPort,
    private readonly bot: ConversationDirectoryBotEntryPort,
    private readonly invalidation: ConversationDirectoryVisibilityInvalidationPort,
  ) {}

  async query(sourceRefs: readonly string[], botRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeConversationDirectoryVisibility> {
    const { items } = await this.read(sourceRefs, botRefs, signal)
    return { items }
  }

  /** Host-only targeting metadata must never be returned by the public visibility query. */
  async queryAffected(
    sourceRefs: readonly string[], botRefs: readonly string[],
    expected: ReadonlyMap<string, number>, signal: AbortSignal,
  ): Promise<ArkmeConversationDirectoryVisibility & { matched: string[] }> {
    // ponytail: scan loaded Bot handles locally; add an owner index only if profiling warrants it.
    const affectedBots: string[] = []
    for (let offset = 0; offset < botRefs.length; offset += 200) {
      signal.throwIfAborted()
      const chunk = botRefs.slice(offset, offset + 200)
      const resolved = await Promise.allSettled(chunk.map(ref => this.bot.botConversationListPreferenceEntry(ref)))
      resolved.forEach((result, index) => {
        if (result.status === 'rejected') {
          if (isFatalResolutionError(result.reason)) throw result.reason
        } else if (expected.has(conversationListPreferenceRefKey(result.value.ref))) affectedBots.push(chunk[index]!)
      })
    }
    return await this.read(sourceRefs, affectedBots, signal, expected)
  }

  private async read(
    sourceRefs: readonly string[],
    botRefs: readonly string[],
    signal?: AbortSignal,
    expected?: ReadonlyMap<string, number>,
  ): Promise<ArkmeConversationDirectoryVisibility & { matched: string[] }> {
    if (sourceRefs.length + botRefs.length > MAX_DIRECTORY_VISIBILITY_REFS) {
      throw new ArkmePluginError('conversation-directory-visibility-too-large', '会话列表状态查询数量过多', false, 400)
    }
    const handles = [
      ...sourceRefs.map(entryRef => ({ entryKind: 'source' as const, entryRef })),
      ...botRefs.map(entryRef => ({ entryKind: 'bot' as const, entryRef })),
    ]
    const resolved = await Promise.allSettled(handles.map(async handle => ({
      ...handle,
      ...(handle.entryKind === 'source'
        ? await this.source.chatConversationListPreferenceEntry(handle.entryRef, signal)
        : await this.bot.botConversationListPreferenceEntry(handle.entryRef)),
    })))
    const fatal = resolved.find(result => result.status === 'rejected' && isFatalResolutionError(result.reason))
    if (fatal?.status === 'rejected') throw fatal.reason
    const entries = resolved.flatMap(result => result.status === 'fulfilled'
      && (expected === undefined || expected.has(conversationListPreferenceRefKey(result.value.ref))) ? [result.value] : [])
    const matched = [...new Set(entries.map(entry => conversationListPreferenceRefKey(entry.ref)))]
    if (entries.length === 0) {
      return { items: expected === undefined ? handles.map(handle => ({ ...handle, hidden: false })) : [], matched }
    }
    const ownerUserId = entries[0]!.ownerUserId
    if (entries.some(entry => entry.ownerUserId !== ownerUserId)) {
      throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
    }
    const owner = await this.preference.query(
      entries.map(entry => entry.ref),
      { ownerUserId, ...(signal === undefined ? {} : { signal }) },
    )
    const snapshots = new Map(owner.map(item => [conversationListPreferenceRefKey(item.ref), item]))
    if (expected !== undefined && matched.some(key => (snapshots.get(key)?.revision ?? -1) < expected.get(key)!)) {
      throw new ArkmePluginError('directory-preference-stale', '会话列表状态尚未同步', true, 409)
    }
    const evidenceByOwnerRef = new Map<string, { sequence: number; activityAtMillis: number }>()
    for (const entry of entries) {
      const key = conversationListPreferenceRefKey(entry.ref)
      const current = evidenceByOwnerRef.get(key)
      evidenceByOwnerRef.set(key, {
        sequence: Math.max(current?.sequence ?? 0, entry.evidence.sequence),
        activityAtMillis: Math.max(current?.activityAtMillis ?? 0, entry.evidence.activityAtMillis),
      })
    }
    const staleSnapshots = [...evidenceByOwnerRef.entries()].flatMap(([key, evidence]) => {
      const snapshot = snapshots.get(key)
      const evidenceAvailable = evidence.sequence > 0 || evidence.activityAtMillis > 0
      return snapshot?.visibilityState === CONVERSATION_LIST_DISMISSED
        && evidenceAvailable
        && !conversationListPreferenceIsDismissed(snapshot, evidence)
        ? [snapshot]
        : []
    })
    if (staleSnapshots.length > 0) {
      void this.preference.restoreIfUnchanged(staleSnapshots, { ownerUserId }).catch(() => undefined)
    }
    const items = resolved.flatMap((result, index) => {
      if (expected !== undefined && (result.status !== 'fulfilled'
        || !expected.has(conversationListPreferenceRefKey(result.value.ref)))) return []
      if (result.status === 'rejected') return { ...handles[index]!, hidden: false }
      const entry = result.value
      const key = conversationListPreferenceRefKey(entry.ref)
      const snapshot = snapshots.get(key)
      const evidence = evidenceByOwnerRef.get(key) ?? entry.evidence
      const evidenceAvailable = evidence.sequence > 0 || evidence.activityAtMillis > 0
      const hidden = evidenceAvailable && snapshot !== undefined
        && conversationListPreferenceIsDismissed(snapshot, evidence)
      return { entryKind: entry.entryKind, entryRef: entry.entryRef, hidden }
    })
    return { items, matched }
  }

  async setVisibility(
    entryKind: 'source' | 'bot',
    entryRef: string,
    hidden: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const entry = await this.resolveEntry(entryKind, entryRef, signal)
    const operation = { ownerUserId: entry.ownerUserId, ...(signal === undefined ? {} : { signal }) }
    if (hidden) await this.preference.dismiss(entry.ref, entry.evidence, operation)
    else await this.preference.restore([entry.ref], operation)
    await this.invalidateBestEffort()
  }

  async restoreSource(
    source: ArkmeSourceItem,
    signal?: AbortSignal,
  ): Promise<void> {
    const entry = await this.source.chatConversationListPreferenceEntry(source.sourceRef, signal)
    await this.restoreEntries([entry], signal)
  }

  async openBotContactConversation(
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceItem> {
    const previous = await this.bot.botConversationListPreferenceEntry(botRef).catch(() => undefined)
    const source = await this.bot.openBotChat(botRef, options)
    const restore = previous === undefined
      ? this.restoreSource(source)
      : this.restoreBotConversation(previous, source)
    void restore.catch(() => undefined)
    return source
  }

  /** Restores the exact owner identities when a Bot directory entry resolves from direct Bot to Chat. */
  async restoreBotConversation(
    previous: ConversationListPreferenceEntry,
    source: ArkmeSourceItem,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = await this.source.chatConversationListPreferenceEntry(source.sourceRef, signal)
    if (previous.ownerUserId !== current.ownerUserId) {
      throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
    }
    const previousIsCurrentChat = previous.ref.entityKind === CHAT_SESSION_CONVERSATION_LIST_ENTITY
      && previous.ref.entityUid === current.ref.entityUid
    if (current.ref.entityKind !== CHAT_SESSION_CONVERSATION_LIST_ENTITY
      || previous.ref.entityKind !== BOT_DIRECT_CONVERSATION_LIST_ENTITY && !previousIsCurrentChat) {
      throw new ArkmePluginError(
        'bot-conversation-preference-identity-changed',
        'Bot 会话归属已变化，请刷新后重试',
        false,
        409,
      )
    }
    await this.restoreEntries([previous, current], signal)
  }

  private async restoreEntries(
    entries: readonly ConversationListPreferenceEntry[],
    signal?: AbortSignal,
  ): Promise<void> {
    const ownerUserId = entries[0]?.ownerUserId
    if (ownerUserId === undefined || entries.some(entry => entry.ownerUserId !== ownerUserId)) {
      throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
    }
    await this.preference.restore(entries.map(entry => entry.ref), {
      ownerUserId,
      ...(signal === undefined ? {} : { signal }),
    })
    await this.invalidateBestEffort()
  }

  private async resolveEntry(
    entryKind: 'source' | 'bot',
    entryRef: string,
    signal?: AbortSignal,
  ): Promise<ConversationListPreferenceEntry> {
    return entryKind === 'source'
      ? await this.source.chatConversationListPreferenceEntry(entryRef, signal)
      : await this.bot.botConversationListPreferenceEntry(entryRef)
  }

  private async invalidateBestEffort(): Promise<void> {
    try { await this.invalidation.invalidateConversationListPreferenceForCurrentSession() }
    catch { /* Owner acceptance is authoritative; realtime/query recovery remains available. */ }
  }
}

function isFatalResolutionError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  return error !== null && typeof error === 'object'
    && 'code' in error && error.code === 'login-context-changed'
}
