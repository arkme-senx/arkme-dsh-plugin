import { randomUUID } from 'node:crypto'
import { isArkmeBotAvatarRef } from '../bot-avatar-ref.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { createOpenClawProvisioner, OpenClawProvisionResult } from '../openclaw/index.js'
import { SecretValue } from '../secret-value.js'
import type {
  ArkmeBotList,
  ArkmeBotManageProfile,
  ArkmeBotNotificationPreference,
  ArkmeBotPrivateChatDirectory,
  ArkmeBotPrivateChatConversation,
  ArkmeBotPrivateChatMessage,
  ArkmeBotPrivateChatSendResult,
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
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeBotRefPayload {
  version: 2
  userId: number
  botId: string
  provider: 'openclaw' | 'webhook'
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

const BOT_CHAT_SESSION_UID_KEYS = [
  'chat_session_uid',
  'chatSessionUid',
  'direct_chat_session_uid',
  'directChatSessionUid',
  'private_chat_session_uid',
  'privateChatSessionUid',
] as const

/** Read the standard-session aliases accepted by the Flutter desktop client. */
function botChatSessionUid(data: Record<string, unknown>): string | undefined {
  const read = (value: Record<string, unknown>, allowUid = false): string | undefined => {
    for (const key of BOT_CHAT_SESSION_UID_KEYS) {
      const candidate = stringValue(value[key]).trim()
      if (candidate !== '' && candidate !== 'null') return candidate
    }
    const uid = allowUid ? stringValue(value.uid).trim() : ''
    return uid !== '' && uid !== 'null' ? uid : undefined
  }
  const direct = read(data)
  if (direct !== undefined) return direct
  for (const key of ['chat_session', 'direct_chat_session', 'private_chat_session']) {
    const nested = read(objectValue(data[key]), true)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * Flutter accepts the legacy `session_id` returned by the Bot endpoint only
 * after proving it resolves to a chat session. Keep the same guard here: a
 * bot id (or a raw Bot topic id) must never become a generic chat source.
 */
function legacyBotChatSessionCandidate(value: unknown, botId: string): string | undefined {
  const candidate = stringValue(value).trim()
  if (candidate === '' || candidate === botId) return undefined
  if (candidate.includes('_bot') && !candidate.startsWith('chat_session_')) return undefined
  return candidate
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

function botProfileSubjectUid(data: Record<string, unknown>): string {
  const bot = botProfileSource(data)
  return stringValue(bot.subject_uid ?? bot.topic_uid ?? data.subject_uid ?? data.topic_uid).trim()
}

function botPrivateChatMessage(value: unknown, fallbackContent = ''): ArkmeBotPrivateChatMessage {
  const raw = objectValue(value)
  const role = stringValue(raw.role).trim().toLowerCase() === 'user' ? 'user' : 'assistant'
  return {
    role,
    content: stringValue(raw.content).trim() || fallbackContent,
    status: stringValue(raw.status).trim() || 'sent',
    createdAtMillis: botPrivateChatTimestamp(raw.created_at ?? raw.createdAt),
  }
}

function botWithPrivateChatActivity(
  bot: ArkmeBotSummary,
  messages: readonly ArkmeBotPrivateChatMessage[],
): ArkmeBotSummary {
  const latest = messages.reduce<ArkmeBotPrivateChatMessage | undefined>((current, message) => {
    if (current === undefined || message.createdAtMillis >= current.createdAtMillis) return message
    return current
  }, undefined)
  if (latest === undefined) return bot
  return {
    ...bot,
    ...(latest.createdAtMillis > 0 ? { latestMessageAtMillis: latest.createdAtMillis } : {}),
    ...(latest.content === '' ? {} : { latestMessagePreview: latest.content }),
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
    const items: ArkmeBotSummary[] = []
    for (const value of listValue(data.bots)) {
      const raw = objectValue(value)
      const provider = arkmeNormalizeBotProvider(raw.provider)
      if (provider === undefined) continue
      try {
        items.push(await this.botSummaryFromData(raw, session.userId))
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
    return await this.botManageProfileFromData(data, session.userId)
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
    return await this.botManageProfileFromData(refreshed, session.userId)
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

  async botNotificationPreference(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotNotificationPreference> {
    const { session, subjectUid } = await this.botNotificationTarget(botRef, options)
    const data = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/subject/get-able-push-status', { subject_uid: subjectUid }, session, options.signal,
    )
    return { muted: data.able_push === false }
  }

  async updateBotNotificationPreference(
    botRef: string,
    muted: boolean,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotNotificationPreference> {
    const { session, subjectUid } = await this.botNotificationTarget(botRef, options)
    await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/subject/set-able-push-status', { subject_uid: subjectUid, able_push: !muted }, session, options.signal,
    )
    return { muted }
  }

  private async botNotificationTarget(botRef: string, options: { signal?: AbortSignal } = {}): Promise<{ session: ArkmeSessionCredentials; subjectUid: string }> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/profile', { bot_id: reference.botId }, session, options.signal,
    )
    const subjectUid = botProfileSubjectUid(data)
    if (subjectUid === '') throw new ArkmePluginError('bot-notification-unavailable', '当前 Bot 未返回可用私聊通知标识', false, 409)
    return { session, subjectUid }
  }

  async openBotPrivateChat(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotPrivateChatConversation> {
    const session = await this.runtime.requireSession()
    const bot = (await this.listBots(options)).items.find(item => item.botRef === botRef)
    if (bot === undefined) throw new ArkmePluginError('bot-ref-not-owned', '当前账号不存在该 Bot', false, 404)
    return await this.openBotPrivateChatForSummary(bot, session, options.signal)
  }

  async listBotPrivateChatDirectory(options: { signal?: AbortSignal } = {}): Promise<ArkmeBotPrivateChatDirectory> {
    const session = await this.runtime.requireSession()
    const { items } = await this.listBots(options)
    const hydrated = await Promise.all(items.map(async bot => {
      try {
        return (await this.openBotPrivateChatForSummary(bot, session, options.signal)).bot
      } catch {
        return bot
      }
    }))
    return { items: hydrated }
  }

  private async openBotPrivateChatForSummary(
    bot: ArkmeBotSummary,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeBotPrivateChatConversation> {
    const reference = await this.openBotRef(bot.botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: reference.botId }, session, signal,
    )
    const messages = listValue(data.messages).map(message => botPrivateChatMessage(message))
    return { bot: botWithPrivateChatActivity(bot, messages), messages }
  }

  async sendBotPrivateChatMessage(
    botRef: string,
    contentInput: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotPrivateChatSendResult> {
    const content = contentInput.trim()
    if (content === '') throw new ArkmePluginError('bot-private-chat-content-invalid', '请输入消息内容', false, 400)
    if (content.length > 20_000) throw new ArkmePluginError('bot-private-chat-content-invalid', '消息不能超过 20000 个字符', false, 400)
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/message/send', { bot_id: reference.botId, content }, session, options.signal,
    )
    const botMessages = [
      ...listValue(data.bot_messages).map(message => botPrivateChatMessage(message)),
      ...(Object.keys(objectValue(data.bot_message)).length === 0 ? [] : [botPrivateChatMessage(data.bot_message)]),
    ]
    return {
      userMessage: botPrivateChatMessage(data.user_message, content),
      botMessages,
      status: stringValue(data.status).trim() || 'ok',
    }
  }

  async openBotChat(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeSourceItem> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const bot = (await this.listBots(options)).items.find(item => item.botRef === botRef)
    if (bot === undefined) throw new ArkmePluginError('bot-ref-not-owned', '当前账号不存在该 OpenClaw Bot', false, 404)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: reference.botId }, session, options.signal,
    )
    const chatSessionUid = botChatSessionUid(data)
    if (chatSessionUid !== undefined) {
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

    const legacySessionId = legacyBotChatSessionCandidate(data.session_id, reference.botId)
    if (legacySessionId !== undefined) {
      const source = await this.source.searchTargetSource(3, legacySessionId, bot.name, options.signal)
      if (source !== undefined) return source
    }

    throw new ArkmePluginError(
      'bot-chat-source-unavailable',
      '当前 Bot 私聊未返回可用会话，暂时不能复用统一 source 读写链路',
      false,
      409,
    )
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
      const { directChatAvailable: _directChatAvailable, ...summary } = await this.botSummaryFromData(raw, session.userId)
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

  private async botSummaryFromData(raw: Record<string, unknown>, userId: number): Promise<ArkmeBotSummary> {
    const botId = stringValue(raw.bot_id).trim()
    const name = stringValue(raw.name).trim()
    const provider = arkmeNormalizeBotProvider(raw.provider)
    if (botId === '' || name === '' || provider === undefined) {
      throw new ArkmePluginError('bot-contract-invalid', 'Bot 响应不完整', true, 502)
    }
    const rawStatus = stringValue(raw.status).trim()
    const status: ArkmeBotStatus = rawStatus === 'online' || rawStatus === 'offline' ? rawStatus : 'unknown'
    const createdAtMillis = botPrivateChatTimestamp(raw.created_at ?? raw.createdAt)
    return {
      botRef: this.sealBotRef(userId, botId, provider),
      name,
      provider,
      description: stringValue(raw.description).trim(),
      status,
      directChatAvailable: stringValue(raw.subject_uid).trim() !== ''
        || stringValue(raw.chat_session_uid).trim() !== '',
      ...(createdAtMillis === 0 ? {} : { createdAtMillis }),
      ...this.botAvatarProjection(raw, userId, botId),
    }
  }

  private async botManageProfileFromData(data: Record<string, unknown>, userId: number): Promise<ArkmeBotManageProfile> {
    const raw = botProfileSource(data)
    const summary = await this.botSummaryFromData(raw, userId)
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

  private sealBotRef(userId: number, botId: string, provider: 'openclaw' | 'webhook'): string {
    this.pruneBotRefs()
    const key = `${String(userId)}\u0000${provider}\u0000${botId}`
    const existingRef = this.botRefByKey.get(key)
    const existing = existingRef === undefined ? undefined : this.botRefs.get(existingRef)
    if (existing !== undefined) {
      this.botRefs.set(existingRef!, {
        ...existing,
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
      key,
      expiresAtMillis: this.now() + (this.refOptions.ttlMillis ?? BOT_REF_TTL_MILLIS),
    })
    this.botRefByKey.set(key, botRef)
    this.pruneBotRefs()
    return botRef
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
