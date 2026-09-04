import { createHmac, randomUUID } from 'node:crypto'
import { isArkmeBotAvatarRef } from '../bot-avatar-ref.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { createOpenClawProvisioner, OpenClawProvisionResult } from '../openclaw/index.js'
import { SecretValue } from '../secret-value.js'
import type {
  ArkmeBotList,
  ArkmeBotManageProfile,
  ArkmeBotStatus,
  ArkmeBotSummary,
  ArkmeBotWebhookSecurity,
  ArkmeSourceItem,
} from '../types.js'
import type {
  ArkmeBotCreateInput,
  ArkmeBotCreateResult,
  ArkmeGroupBotList,
  ArkmeGroupBotMutationResult,
} from '../tools/ports/bots.js'
import {
  arkmeGroupBotBindingBody,
  arkmeGroupBotBindingTargetFromBundle,
  SourceService,
  type ArkmeSourceRefPayload,
} from './source-service.js'
import {
  BOT_DIRECT_CONVERSATION_LIST_ENTITY,
  type ConversationListPreferenceEntry,
} from './conversation-list-preference-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

const BOT_CONVERSATION_OWNER = {
  subject: 'jotmo-subject',
  chat: 'jotmo-chat',
} as const
type BotConversationOwner = typeof BOT_CONVERSATION_OWNER[keyof typeof BOT_CONVERSATION_OWNER]

export type BotConversationTarget =
  | { kind: 'subject'; subjectUid: string }
  | { kind: 'chat'; chatSessionUid: string }
  | { kind: 'unavailable'; reason: 'missing' | 'conflict' | 'duplicate_chat_target' }

export interface ArkmeBotRefPayload {
  version: 2
  userId: number
  botId: string
  provider: 'openclaw' | 'webhook'
  target: BotConversationTarget
  conversationListActivityAtMillis: number
}

interface ArkmeBotRefEntry extends ArkmeBotRefPayload { key: string; expiresAtMillis: number }

export interface ArkmeBotImageEntry {
  viewerUserId: number
  sourceUrl: string
  expiresAtMillis: number
}

export interface ArkmeMentionableBot {
  botId: string
  name: string
}

export interface ArkmeBotManageUpdateInput {
  name: string
  description: string
  avatar?: string
  mentionEntryEnabled?: boolean
  webhookSecurity?: ArkmeBotWebhookSecurity
}

interface ArkmeBotImageRefEntry extends ArkmeBotImageEntry { key: string }

const BOT_REF_TTL_MILLIS = 30 * 60_000
const BOT_REF_CAP = 2_000
const BOT_REF_PATTERN = /^arkme-bot-v2\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BOT_IMAGE_REF_PATTERN = /^arkme-bot-image-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

export function arkmeNormalizeBotProvider(value: unknown): 'openclaw' | 'webhook' | undefined {
  const normalized = stringValue(value).trim().toLowerCase()
  if (normalized === 'openclaw' || normalized === 'webhook') return normalized
  return undefined
}

function botPrivateChatTimestamp(value: unknown): number {
  const numeric = numberValue(value)
  if (numeric <= 0) return 0
  if (numeric < 10_000_000_000) return numeric * 1_000

  // The legacy Bot private-chat API returns Unix microseconds, while the
  // browser (and the regular conversation directory) use milliseconds.
  // Preserve millisecond inputs and normalize microseconds/nanoseconds.
  let millis = numeric
  while (millis >= 100_000_000_000_000) millis = Math.trunc(millis / 1_000)
  return millis
}

function botWebhookSecurity(value: unknown): ArkmeBotWebhookSecurity {
  const raw = objectValue(value)
  return {
    keywordEnabled: booleanValue(raw.keyword_enabled),
    keyword: stringValue(raw.keyword).trim(),
    tokenEnabled: booleanValue(raw.token_enabled ?? raw.signature_enabled),
    ipWhitelistEnabled: booleanValue(raw.ip_whitelist_enabled),
    ipWhitelist: listValue(raw.ip_whitelist).map(item => stringValue(item).trim()).filter(item => item !== '').slice(0, 100),
  }
}

function botProfileSource(data: Record<string, unknown>): Record<string, unknown> {
  const bot = objectValue(data.bot)
  return Object.keys(bot).length === 0 ? data : bot
}

function botConversationTarget(data: Record<string, unknown>): BotConversationTarget {
  const subjectUid = stringValue(data.subject_uid).trim()
  const chatSessionUid = stringValue(data.chat_session_uid).trim()
  if (subjectUid !== '' && chatSessionUid !== '') return { kind: 'unavailable', reason: 'conflict' }
  if (subjectUid !== '') return { kind: 'subject', subjectUid }
  if (chatSessionUid !== '') return { kind: 'chat', chatSessionUid }
  return { kind: 'unavailable', reason: 'missing' }
}

function botConversationCapabilities(target: BotConversationTarget, provider: 'openclaw' | 'webhook') {
  const owner: BotConversationOwner | undefined = target.kind === 'subject'
    ? BOT_CONVERSATION_OWNER.subject
    : target.kind === 'chat' ? BOT_CONVERSATION_OWNER.chat : undefined
  return {
    directChatAvailable: owner !== undefined,
    privateChatOutboundEnabled: owner === BOT_CONVERSATION_OWNER.chat
      || (owner === BOT_CONVERSATION_OWNER.subject && provider === 'openclaw'),
    refreshOnRecordChanges: owner === BOT_CONVERSATION_OWNER.subject,
    conversationProjection: owner === BOT_CONVERSATION_OWNER.subject
      ? 'record' as const
      : owner === BOT_CONVERSATION_OWNER.chat ? 'chat' as const : 'none' as const,
  }
}

export class BotService {
  private openClawProvisioner: ReturnType<typeof createOpenClawProvisioner> | undefined
  private readonly botRefs = new Map<string, ArkmeBotRefEntry>()
  private readonly botRefByKey = new Map<string, string>()
  private readonly botImageRefs = new Map<string, ArkmeBotImageRefEntry>()
  private readonly botImageRefByKey = new Map<string, string>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly refOptions: {
      ttlMillis?: number
      maxEntries?: number
      now?: () => number
      randomId?: () => string
    } = {},
  ) {}

  dispose(): void {
    this.openClawProvisioner = undefined
    this.clearAccountRefs()
  }

  clearAccountRefs(): void {
    this.botRefs.clear()
    this.botRefByKey.clear()
    this.botImageRefs.clear()
    this.botImageRefByKey.clear()
  }

  attachOpenClawProvisioner(provisioner: ReturnType<typeof createOpenClawProvisioner>): void {
    if (this.openClawProvisioner !== undefined) throw new Error('OpenClaw provisioner is already attached')
    this.openClawProvisioner = provisioner
  }

  async connectOpenClawBot(botRef: string, options: { signal?: AbortSignal } = {}): Promise<OpenClawProvisionResult> {
    const bot = (await this.listBots(options)).items.find(item => item.botRef === botRef)
    if (bot === undefined) throw new ArkmePluginError('bot-ref-not-owned', '当前账号不存在该 Bot', false, 404)
    if (bot.provider !== 'openclaw') {
      throw new ArkmePluginError('bot-provider-mismatch', '只有 OpenClaw Bot 可以连接本地 OpenClaw', false, 400)
    }
    if (this.openClawProvisioner === undefined) {
      throw new ArkmePluginError('openclaw-not-configured', '请先安装并配置本地 OpenClaw', false, 503)
    }
    return await this.openClawProvisioner.reconcile({
      botRef,
      allowGatewayRestart: true,
      resolveConnectionMetadata: async () => await this.resolveBotConnectionMetadata(botRef, options),
      revealSecret: async () => await this.revealBotSecret(botRef, options),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async listBots(options: { signal?: AbortSignal } = {}): Promise<ArkmeBotList> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/list', {}, session, options.signal,
    )
    const rawBots = listValue(data.bots).map(objectValue)
    const candidates = rawBots.filter(raw => (
      stringValue(raw.bot_id).trim() !== ''
      && stringValue(raw.name).trim() !== ''
      && arkmeNormalizeBotProvider(raw.provider) !== undefined
    ))
    const chatTargetCounts = new Map<string, number>()
    for (const raw of rawBots) {
      const chatSessionUid = stringValue(raw.chat_session_uid).trim()
      if (chatSessionUid === '') continue
      chatTargetCounts.set(chatSessionUid, (chatTargetCounts.get(chatSessionUid) ?? 0) + 1)
    }
    const items: ArkmeBotSummary[] = []
    for (const raw of candidates) {
      const candidateTarget = botConversationTarget(raw)
      const target: BotConversationTarget = candidateTarget.kind === 'chat'
        && (chatTargetCounts.get(candidateTarget.chatSessionUid) ?? 0) > 1
        ? { kind: 'unavailable', reason: 'duplicate_chat_target' }
        : candidateTarget
      try {
        items.push(await this.botSummaryFromData(raw, session.userId, target))
      } catch (error) {
        if (!(error instanceof ArkmePluginError) || error.code !== 'bot-contract-invalid') throw error
      }
    }
    return { items }
  }

  async countBots(options: { signal?: AbortSignal } = {}): Promise<number> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/list', { limit: 0 }, session, options.signal,
    )
    return Math.max(0, numberValue(data.total ?? data.total_count))
  }

  async createBot(
    input: ArkmeBotCreateInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotCreateResult> {
    const name = input.name.trim()
    const provider = input.provider
    const description = input.description?.trim() ?? ''
    const avatar = input.avatar?.trim() ?? ''
    if (name === '') throw new ArkmePluginError('bot-name-invalid', 'Bot 名称不能为空', false)
    if (provider !== 'openclaw' && provider !== 'webhook') {
      throw new ArkmePluginError('bot-provider-unsupported', 'Bot Provider 不受支持', false, 400)
    }
    if (avatar !== '' && !isArkmeBotAvatarRef(avatar)) {
      throw new ArkmePluginError('bot-avatar-invalid', 'Bot 头像引用无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
        '/api/v1/bot/create', { name, provider, description, avatar }, session, options.signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && ['arkme-network-error', 'arkme-timeout'].includes(error.code)) {
        throw new ArkmePluginError(
          'bot-create-outcome-unknown',
          'Bot 创建结果未知，请刷新 Bot 列表确认；不会自动重试',
          false,
          409,
          { cause: error },
        )
      }
      throw error
    }
    try {
      const token = stringValue(objectValue(data.token_info).token).trim()
      if (!token.startsWith('jbot_')) throw new Error('missing Bot token')
      return {
        bot: await this.botSummaryFromData(objectValue(data.bot), session.userId),
        secret: new SecretValue(token),
      }
    } catch (error) {
      throw new ArkmePluginError(
        'bot-create-outcome-unknown',
        'Bot 可能已创建，但响应不完整；请刷新 Bot 列表确认',
        false,
        409,
        { cause: error },
      )
    }
  }

  /** Browser-safe result: the one-time credential never leaves the Host owner. */
  async createBotSummary(
    input: ArkmeBotCreateInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotSummary> {
    return (await this.createBot(input, options)).bot
  }

  async revealBotSecret(botRef: string, options: { signal?: AbortSignal } = {}): Promise<SecretValue> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/token/reveal', { bot_id: reference.botId }, session, options.signal,
    )
    const token = stringValue(data.token).trim()
    if (!token.startsWith('jbot_')) {
      throw new ArkmePluginError('bot-token-contract-invalid', 'Bot 凭据响应无效', false, 502)
    }
    return new SecretValue(token)
  }

  async manageBotProfile(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotManageProfile> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    return await this.botManageProfileFromData(data, session.userId, reference)
  }

  async updateManagedBot(
    botRef: string,
    input: ArkmeBotManageUpdateInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotManageProfile> {
    const name = input.name.trim()
    const description = input.description.trim()
    if (name === '' || [...name].length > 50) throw new ArkmePluginError('bot-name-invalid', 'Bot 名称需为 1-50 个字符', false, 400)
    if ([...description].length > 200) throw new ArkmePluginError('bot-description-invalid', 'Bot 简介不能超过 200 个字符', false, 400)
    if (input.avatar !== undefined && !isArkmeBotAvatarRef(input.avatar)) throw new ArkmePluginError('bot-avatar-invalid', 'Bot 头像引用无效', false, 400)
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const currentData = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    const current = botProfileSource(currentData)
    const provider = arkmeNormalizeBotProvider(current.provider)
    if (provider === undefined) throw new ArkmePluginError('bot-contract-invalid', 'Bot 配置响应不完整', true, 502)
    const security = input.webhookSecurity
    if (security !== undefined && provider !== 'webhook') {
      throw new ArkmePluginError('bot-webhook-security-invalid', '仅 Webhook Bot 支持安全设置', false, 400)
    }
    await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/update', {
        bot_id: reference.botId,
        name,
        description,
        avatar: input.avatar ?? stringValue(current.avatar).trim(),
        ...(input.mentionEntryEnabled === undefined ? {} : { mention_entry_enabled: input.mentionEntryEnabled }),
        ...(security === undefined ? {} : { webhook_security: {
          keyword_enabled: security.keywordEnabled,
          keyword: security.keyword.trim(),
          token_enabled: security.tokenEnabled,
          ip_whitelist_enabled: security.ipWhitelistEnabled,
          ip_whitelist: security.ipWhitelist.map(item => item.trim()).filter(item => item !== '').slice(0, 100),
        } }),
      }, session, options.signal,
    )
    const refreshed = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    return await this.botManageProfileFromData(refreshed, session.userId, reference)
  }

  async revealManagedBotToken(botRef: string, options: { signal?: AbortSignal } = {}): Promise<{ token: string }> {
    return { token: (await this.revealBotSecret(botRef, options)).reveal() }
  }

  async deleteManagedBot(botRef: string, confirmationName: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    if (confirmationName.trim() !== stringValue(botProfileSource(data).name).trim()) {
      throw new ArkmePluginError('bot-delete-confirmation-invalid', '请输入完整 Bot 名称以确认删除', false, 400)
    }
    await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/delete', { bot_id: reference.botId }, session, options.signal,
    )
    this.deleteBotRef(botRef)
  }

  async openBotChat(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeSourceItem> {
    const session = await this.runtime.requireSession()
    await this.openBotRef(botRef, session.userId)
    const bot = (await this.listBots(options)).items.find(item => item.botRef === botRef)
    if (bot === undefined) throw new ArkmePluginError('bot-ref-not-owned', '当前账号不存在该 OpenClaw Bot', false, 404)
    const reference = await this.openBotRef(botRef, session.userId)
    if (reference.target.kind !== 'chat') {
      throw new ArkmePluginError('bot-chat-source-unavailable', '当前 Bot 不属于 Chat 私聊链路', false, 409)
    }
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: reference.botId }, session, options.signal,
    )
    const chatSessionUid = stringValue(data.chat_session_uid).trim()
    if (chatSessionUid === '' || chatSessionUid !== reference.target.chatSessionUid) {
      throw new ArkmePluginError('bot-chat-source-unavailable', '当前 Bot 私聊会话确认不一致', false, 409)
    }
    const source: ArkmeSourceItem = {
      sourceRef: await this.source.sealSourceRef(session.userId, 'private_chat', chatSessionUid, bot.name),
      kind: 'private_chat',
      displayName: bot.name,
      activeAtMillis: 0,
      unreadCount: 0,
    }
    this.source.setChatSourceByKey(`${String(session.userId)}:${chatSessionUid}`, source)
    return source
  }

  private async resolveBotConnectionMetadata(botRef: string, options: { signal?: AbortSignal } = {}): Promise<{ gatewayUrl: string; tokenPreview: string }> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    const gatewayUrl = stringValue(data.gateway_url).trim()
    let parsed: URL
    try { parsed = new URL(gatewayUrl) } catch {
      throw new ArkmePluginError('bot-gateway-contract-invalid', 'Bot Gateway 地址无效', false, 502)
    }
    if (parsed.protocol !== 'wss:' || parsed.username !== '' || parsed.password !== '') {
      throw new ArkmePluginError('bot-gateway-contract-invalid', 'Bot Gateway 地址必须使用安全 WebSocket', false, 502)
    }
    const tokenPreview = stringValue(objectValue(data.bot).token_preview).trim()
    if (tokenPreview === '') {
      throw new ArkmePluginError('bot-token-contract-invalid', 'Bot 凭据版本信息无效', false, 502)
    }
    return { gatewayUrl: parsed.toString(), tokenPreview }
  }

  async listGroupBots(
    groupSourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotList> {
    const session = await this.runtime.requireSession()
    const group = await this.openGroupSourceRef(groupSourceRef, session.userId)
    const groupTargetBody = await this.resolveGroupBotBindingBody(group, session, options.signal)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/group/list', groupTargetBody, session, options.signal,
    )
    const items: ArkmeGroupBotList['items'] = []
    for (const value of listValue(data.bots)) {
      const raw = objectValue(value)
      const provider = arkmeNormalizeBotProvider(raw.provider)
      if (provider !== 'openclaw') continue
      const summary = await this.groupBotSummaryFromData(raw, session.userId)
      items.push({ ...summary, installed: booleanValue(raw.installed) })
    }
    return {
      groupSourceRef,
      displayName: stringValue(data.subject_title).trim() || group.displayName,
      canAddBots: booleanValue(data.can_current_user_add_bots),
      items,
    }
  }

  async addGroupBot(
    groupSourceRef: string,
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotMutationResult> {
    const session = await this.runtime.requireSession()
    const [group, bot] = await Promise.all([
      this.openGroupSourceRef(groupSourceRef, session.userId),
      this.openBotRef(botRef, session.userId),
    ])
    const groupTargetBody = await this.resolveGroupBotBindingBody(group, session, options.signal)
    await this.runtime.authenticatedBotPost(
      '/api/v1/bot/group/add',
      { bot_id: bot.botId, ...groupTargetBody, subject_title: group.displayName },
      session,
      options.signal,
    )
    return await this.confirmGroupBotState(groupSourceRef, botRef, true, options.signal)
  }

  async removeGroupBot(
    groupSourceRef: string,
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotMutationResult> {
    const session = await this.runtime.requireSession()
    const [group, bot] = await Promise.all([
      this.openGroupSourceRef(groupSourceRef, session.userId),
      this.openBotRef(botRef, session.userId),
    ])
    const groupTargetBody = await this.resolveGroupBotBindingBody(group, session, options.signal)
    await this.runtime.authenticatedBotPost(
      '/api/v1/bot/group/remove', { bot_id: bot.botId, ...groupTargetBody }, session, options.signal,
    )
    return await this.confirmGroupBotState(groupSourceRef, botRef, false, options.signal)
  }

  private async confirmGroupBotState(
    groupSourceRef: string,
    botRef: string,
    expectedInstalled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupBotMutationResult> {
    const list = await this.listGroupBots(groupSourceRef, signal === undefined ? {} : { signal })
    const item = list.items.find(candidate => candidate.botRef === botRef)
    if (item?.installed !== expectedInstalled) {
      throw new ArkmePluginError('bot-group-state-unconfirmed', '无法确认 Bot 群聊安装状态', true, 503)
    }
    return { botRef, groupSourceRef, installed: expectedInstalled }
  }

  private async openGroupSourceRef(sourceRef: string, userId: number): Promise<ArkmeSourceRefPayload> {
    const source = await this.source.openSourceRef(sourceRef, userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('bot-group-source-invalid', 'Bot 只能安装到群聊', false)
    }
    return source
  }

  async listMentionableGroupBots(
    group: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeMentionableBot[]> {
    const groupTargetBody = await this.resolveGroupBotBindingBody(group, session, signal)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/group/list', groupTargetBody, session, signal,
    )
    return listValue(data.bots).flatMap(value => {
      const raw = objectValue(value)
      if (arkmeNormalizeBotProvider(raw.provider) !== 'openclaw' || !booleanValue(raw.installed)) return []
      const botId = stringValue(raw.bot_id).trim()
      const name = stringValue(raw.name).trim()
      if (botId === '' || name === '') {
        throw new ArkmePluginError('bot-contract-invalid', 'Bot 响应不完整', true, 502)
      }
      return [{ botId, name }]
    })
  }

  private async resolveGroupBotBindingBody(
    group: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (group.botGroupTarget !== undefined) return arkmeGroupBotBindingBody(group)
    const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail',
      { chat_session_uid: group.ownerRef },
      session,
      signal,
      {
        lane: 'interactive-read',
        key: `group-bot-target:${group.ownerRef}`,
        failureCooldownMs: 2_000,
      },
    ).catch(() => undefined)
    const botGroupTarget = detail === undefined ? undefined : arkmeGroupBotBindingTargetFromBundle(detail)
    return arkmeGroupBotBindingBody(botGroupTarget === undefined ? group : { ...group, botGroupTarget })
  }

  private async botSummaryBaseFromData(
    raw: Record<string, unknown>,
    userId: number,
    target: BotConversationTarget | undefined,
  ): Promise<Omit<ArkmeBotSummary,
    'directChatAvailable' | 'privateChatOutboundEnabled' | 'refreshOnRecordChanges'
    | 'conversationProjection' | 'chatSourceKey' | 'unreadCount' | 'isMuted'>> {
    const botId = stringValue(raw.bot_id).trim()
    const name = stringValue(raw.name).trim()
    const provider = arkmeNormalizeBotProvider(raw.provider)
    if (botId === '' || name === '' || provider === undefined) {
      throw new ArkmePluginError('bot-contract-invalid', 'Bot 响应不完整', true, 502)
    }
    const rawStatus = stringValue(raw.status).trim()
    const status: ArkmeBotStatus = rawStatus === 'online' || rawStatus === 'offline' ? rawStatus : 'unknown'
    const createdAtMillis = botPrivateChatTimestamp(raw.created_at ?? raw.createdAt)
    const conversationListActivityAtMillis = botPrivateChatTimestamp(
      raw.latest_activity_at ?? raw.latestActivityAt,
    )
    const latestMessageAtMillis = botPrivateChatTimestamp(
      raw.latest_message_at ?? raw.latestMessageAt ?? raw.last_message_at ?? raw.lastMessageAt,
    )
    return {
      botRef: this.sealBotRef(
        userId,
        botId,
        provider,
        target,
        Math.max(createdAtMillis, conversationListActivityAtMillis, latestMessageAtMillis),
      ),
      directoryKey: await this.botDirectoryKey(userId, botId),
      name,
      provider,
      description: stringValue(raw.description).trim(),
      status,
      ...(createdAtMillis === 0 ? {} : { createdAtMillis }),
      ...(conversationListActivityAtMillis === 0 ? {} : { conversationListActivityAtMillis }),
      ...(latestMessageAtMillis === 0 ? {} : { latestMessageAtMillis }),
      ...this.botAvatarProjection(raw, userId, botId),
    }
  }

  private async botSummaryFromData(
    raw: Record<string, unknown>,
    userId: number,
    knownTarget?: BotConversationTarget,
  ): Promise<ArkmeBotSummary> {
    const target = knownTarget ?? botConversationTarget(raw)
    const summary = await this.botSummaryBaseFromData(raw, userId, target)
    return {
      ...summary,
      ...botConversationCapabilities(target, summary.provider),
      ...(target.kind === 'chat'
        ? { chatSourceKey: await this.source.chatDirectorySourceKey(userId, target.chatSessionUid) }
        : {}),
    }
  }

  private async groupBotSummaryFromData(
    raw: Record<string, unknown>,
    userId: number,
  ): Promise<Omit<ArkmeGroupBotList['items'][number], 'installed'>> {
    return await this.botSummaryBaseFromData(raw, userId, undefined)
  }

  private async botManageProfileFromData(
    data: Record<string, unknown>,
    userId: number,
    reference: ArkmeBotRefPayload,
  ): Promise<ArkmeBotManageProfile> {
    const raw = botProfileSource(data)
    if (stringValue(raw.bot_id).trim() !== reference.botId
      || arkmeNormalizeBotProvider(raw.provider) !== reference.provider) {
      throw new ArkmePluginError('bot-contract-invalid', 'Bot 配置响应与当前 Bot 不一致', true, 502)
    }
    const summary = await this.botSummaryFromData(raw, userId, reference.target)
    const joinedGroups = listValue(data.joined_groups).map(value => objectValue(value)).map(group => ({
      title: stringValue(group.subject_title).trim() || stringValue(group.subject_uid).trim() || '未命名群聊',
      installedAtMillis: botPrivateChatTimestamp(group.installed_at),
    }))
    return {
      ...summary,
      mentionEntryEnabled: raw.mention_entry_enabled !== false,
      tokenPreview: stringValue(raw.token_preview).trim(),
      canRevealToken: raw.can_reveal_token !== false,
      tokenRevealEnabled: data.token_reveal_enabled !== false,
      gatewayUrl: stringValue(data.gateway_url).trim(),
      webhookUrl: stringValue(data.webhook_url).trim(),
      recordCount: Math.max(-1, Math.trunc(numberValue(raw.record_count))),
      webhookSecurity: botWebhookSecurity(data.webhook_security ?? raw.webhook_security),
      joinedGroups,
    }
  }

  private botAvatarProjection(
    raw: Record<string, unknown>,
    userId: number,
    botId: string,
  ): { avatarRef?: string } {
    const sourceUrl = stringValue(raw.avatar_url ?? raw.avatarUrl).trim()
    if (sourceUrl === '') return {}
    this.pruneBotImageRefs()
    const key = `${String(userId)}\u0000${botId}\u0000${sourceUrl}`
    const existingRef = this.botImageRefByKey.get(key)
    const existing = existingRef === undefined ? undefined : this.botImageRefs.get(existingRef)
    if (existing !== undefined) {
      this.botImageRefs.set(existingRef!, {
        ...existing,
        expiresAtMillis: this.now() + (this.refOptions.ttlMillis ?? BOT_REF_TTL_MILLIS),
      })
      return { avatarRef: existingRef! }
    }
    const avatarRef = `arkme-bot-image-v1.${(this.refOptions.randomId ?? randomUUID)()}`
    this.botImageRefs.set(avatarRef, {
      viewerUserId: userId,
      sourceUrl,
      key,
      expiresAtMillis: this.now() + (this.refOptions.ttlMillis ?? BOT_REF_TTL_MILLIS),
    })
    this.botImageRefByKey.set(key, avatarRef)
    return { avatarRef }
  }

  private pruneBotImageRefs(): void {
    const now = this.now()
    for (const [avatarRef, entry] of this.botImageRefs) {
      if (entry.expiresAtMillis > now) continue
      this.botImageRefs.delete(avatarRef)
      if (this.botImageRefByKey.get(entry.key) === avatarRef) this.botImageRefByKey.delete(entry.key)
    }
    while (this.botImageRefs.size >= (this.refOptions.maxEntries ?? BOT_REF_CAP)) {
      const oldestRef = this.botImageRefs.keys().next().value as string | undefined
      if (oldestRef === undefined) break
      const entry = this.botImageRefs.get(oldestRef)
      this.botImageRefs.delete(oldestRef)
      if (entry !== undefined && this.botImageRefByKey.get(entry.key) === oldestRef) {
        this.botImageRefByKey.delete(entry.key)
      }
    }
  }

  async openBotImageRef(imageRef: string, expectedViewerUserId: number): Promise<ArkmeBotImageEntry> {
    const normalized = imageRef.trim()
    const entry = BOT_IMAGE_REF_PATTERN.test(normalized) ? this.botImageRefs.get(normalized) : undefined
    if (entry === undefined || entry.viewerUserId !== expectedViewerUserId || entry.expiresAtMillis <= this.now()) {
      if (entry !== undefined) {
        this.botImageRefs.delete(normalized)
        if (this.botImageRefByKey.get(entry.key) === normalized) this.botImageRefByKey.delete(entry.key)
      }
      throw new ArkmePluginError('bot-image-ref-invalid', 'Bot 头像引用无效或已过期', false, 403)
    }
    return { viewerUserId: entry.viewerUserId, sourceUrl: entry.sourceUrl, expiresAtMillis: entry.expiresAtMillis }
  }

  private sealBotRef(
    userId: number,
    botId: string,
    provider: 'openclaw' | 'webhook',
    target: BotConversationTarget | undefined,
    conversationListActivityAtMillis = 0,
  ): string {
    this.pruneBotRefs()
    const key = `${String(userId)}\u0000${provider}\u0000${botId}`
    const existingRef = this.botRefByKey.get(key)
    const existing = existingRef === undefined ? undefined : this.botRefs.get(existingRef)
    if (existing !== undefined) {
      this.botRefs.set(existingRef!, {
        ...existing,
        ...(target === undefined ? {} : { target }),
        conversationListActivityAtMillis: Math.max(
          existing.conversationListActivityAtMillis,
          conversationListActivityAtMillis,
        ),
        expiresAtMillis: this.now() + (this.refOptions.ttlMillis ?? BOT_REF_TTL_MILLIS),
      })
      return existingRef!
    }
    const botRef = `arkme-bot-v2.${(this.refOptions.randomId ?? randomUUID)()}`
    this.botRefs.set(botRef, {
      version: 2,
      userId,
      botId,
      provider,
      target: target ?? { kind: 'unavailable', reason: 'missing' },
      conversationListActivityAtMillis: Math.max(0, conversationListActivityAtMillis),
      key,
      expiresAtMillis: this.now() + (this.refOptions.ttlMillis ?? BOT_REF_TTL_MILLIS),
    })
    this.botRefByKey.set(key, botRef)
    this.pruneBotRefs()
    return botRef
  }

  private async botDirectoryKey(userId: number, botId: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`arkme-bot-directory-v1:${String(userId)}:${botId}`)
      .digest('base64url')
    return `arkme-bot-directory-v1.${digest}`
  }

  async openBotRef(botRef: string, expectedUserId: number): Promise<ArkmeBotRefPayload> {
    const normalized = botRef.trim()
    if (!BOT_REF_PATTERN.test(normalized)) {
      throw new ArkmePluginError('bot-ref-invalid', 'Bot 引用无效', false)
    }
    const entry = this.botRefs.get(normalized)
    if (entry === undefined) {
      throw new ArkmePluginError('bot-ref-expired', 'Bot 引用已过期，请刷新 Bot 列表', false, 410)
    }
    if (entry.expiresAtMillis <= this.now()) {
      this.deleteBotRef(normalized, entry)
      throw new ArkmePluginError('bot-ref-expired', 'Bot 引用已过期，请刷新 Bot 列表', false, 410)
    }
    if (entry.userId !== expectedUserId) {
      throw new ArkmePluginError('bot-ref-account-mismatch', 'Bot 引用与当前账号不匹配', false, 403)
    }
    const { expiresAtMillis: _expiresAtMillis, key: _key, ...reference } = entry
    return { ...reference }
  }

  async botConversationListPreferenceEntry(botRef: string): Promise<ConversationListPreferenceEntry> {
    const session = await this.runtime.requireSession()
    const bot = await this.openBotRef(botRef, session.userId)
    if (bot.target.kind === 'chat') {
      return await this.source.chatConversationListPreferenceEntryBySessionUid(
        bot.target.chatSessionUid,
        session.userId,
      )
    }
    if (bot.target.kind === 'unavailable' && bot.target.reason !== 'missing') {
      throw new ArkmePluginError(
        'bot-conversation-preference-identity-unavailable',
        '当前 Bot 会话归属不明确，请刷新后重试',
        false,
        409,
      )
    }
    return {
      ownerUserId: session.userId,
      ref: { entityKind: BOT_DIRECT_CONVERSATION_LIST_ENTITY, entityUid: bot.botId },
      evidence: {
        sequence: 0,
        activityAtMillis: bot.conversationListActivityAtMillis,
      },
    }
  }

  private pruneBotRefs(): void {
    const now = this.now()
    for (const [ref, entry] of this.botRefs) {
      if (entry.expiresAtMillis <= now) this.deleteBotRef(ref, entry)
    }
    const cap = this.refOptions.maxEntries ?? BOT_REF_CAP
    while (this.botRefs.size > cap) {
      const oldest = this.botRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.deleteBotRef(oldest)
    }
  }

  private deleteBotRef(ref: string, knownEntry?: ArkmeBotRefEntry): void {
    const entry = knownEntry ?? this.botRefs.get(ref)
    if (entry !== undefined && this.botRefByKey.get(entry.key) === ref) this.botRefByKey.delete(entry.key)
    this.botRefs.delete(ref)
  }

  private now(): number {
    return (this.refOptions.now ?? Date.now)()
  }
}
