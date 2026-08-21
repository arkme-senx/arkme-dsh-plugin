import { createHmac, timingSafeEqual } from 'node:crypto'
import { isArkmeBotAvatarRef } from '../bot-avatar-ref.js'
import type { createOpenClawProvisioner, OpenClawProvisionResult } from '../openclaw/index.js'
import { SecretValue } from '../secret-value.js'
import type {
  ArkmeBotList,
  ArkmeBotStatus,
  ArkmeBotSummary,
  ArkmeSourceItem,
} from '../types.js'
import type {
  ArkmeBotCreateInput,
  ArkmeBotCreateResult,
  ArkmeGroupBotList,
  ArkmeGroupBotMutationResult,
} from '../tools/ports/bots.js'
import { SourceService, type ArkmeSourceRefPayload } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeBotRefPayload { version: 1; userId: number; botId: string }

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

export class BotService {
  private openClawProvisioner: ReturnType<typeof createOpenClawProvisioner> | undefined

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
  ) {}

  dispose(): void {
    this.openClawProvisioner = undefined
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
      const provider = stringValue(raw.provider).trim()
      if (provider !== 'openclaw' && provider !== 'webhook') continue
      items.push(await this.botSummaryFromData(raw, session.userId))
    }
    return { items }
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

  async openBotChat(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeSourceItem> {
    const session = await this.runtime.requireSession()
    const reference = await this.openBotRef(botRef, session.userId)
    const bot = (await this.listBots(options)).items.find(item => item.botRef === botRef)
    if (bot === undefined) throw new ArkmePluginError('bot-ref-not-owned', '当前账号不存在该 OpenClaw Bot', false, 404)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: reference.botId }, session, options.signal,
    )
    const chatSessionUid = stringValue(data.chat_session_uid).trim()
    if (chatSessionUid === '') {
      throw new ArkmePluginError(
        'bot-chat-source-unavailable',
        '当前 Bot 私聊仍使用旧会话协议，暂时不能复用统一 source 读写链路',
        false,
        409,
      )
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
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/group/list', { subject_uid: group.ownerRef }, session, options.signal,
    )
    const items: ArkmeGroupBotList['items'] = []
    for (const value of listValue(data.bots)) {
      const raw = objectValue(value)
      if (stringValue(raw.provider).trim() !== 'openclaw') continue
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
    await this.runtime.authenticatedBotPost(
      '/api/v1/bot/group/add',
      { bot_id: bot.botId, subject_uid: group.ownerRef, subject_title: group.displayName },
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
    await this.runtime.authenticatedBotPost(
      '/api/v1/bot/group/remove', { bot_id: bot.botId, subject_uid: group.ownerRef }, session, options.signal,
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

  private async botSummaryFromData(raw: Record<string, unknown>, userId: number): Promise<ArkmeBotSummary> {
    const botId = stringValue(raw.bot_id).trim()
    const name = stringValue(raw.name).trim()
    const provider = stringValue(raw.provider).trim()
    if (botId === '' || name === '' || (provider !== 'openclaw' && provider !== 'webhook')) {
      throw new ArkmePluginError('bot-contract-invalid', 'Bot 响应不完整', true, 502)
    }
    const rawStatus = stringValue(raw.status).trim()
    const status: ArkmeBotStatus = rawStatus === 'online' || rawStatus === 'offline' ? rawStatus : 'unknown'
    return {
      botRef: await this.sealBotRef(userId, botId),
      name,
      provider,
      description: stringValue(raw.description).trim(),
      status,
      directChatAvailable: stringValue(raw.subject_uid).trim() !== ''
        || stringValue(raw.chat_session_uid).trim() !== '',
    }
  }

  private async sealBotRef(userId: number, botId: string): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, botId } satisfies ArkmeBotRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-bot-v1.${payload}.${signature}`
  }

  async openBotRef(botRef: string, expectedUserId: number): Promise<ArkmeBotRefPayload> {
    const parts = botRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-bot-v1') {
      throw new ArkmePluginError('bot-ref-invalid', 'Bot 引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('bot-ref-invalid', 'Bot 引用无效', false)
    }
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(payload)) }
    catch (error) {
      throw new ArkmePluginError('bot-ref-invalid', 'Bot 引用无效', false, 400, { cause: error })
    }
    const reference: ArkmeBotRefPayload = {
      version: 1,
      userId: numberValue(raw.userId),
      botId: stringValue(raw.botId).trim(),
    }
    if (raw.version !== 1 || reference.userId !== expectedUserId || reference.botId === '') {
      throw new ArkmePluginError('bot-ref-invalid', 'Bot 引用与当前账号不匹配', false, 403)
    }
    return reference
  }
}
