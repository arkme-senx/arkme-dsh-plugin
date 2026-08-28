import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeBotList,
  ArkmeBotConversation,
  ArkmeBotConversationDirectory,
  ArkmeBotConversationMessage,
  ArkmeBotConversationReadResult,
  ArkmeBotConversationSendResult,
  ArkmeBotNotificationPreference,
  ArkmeBotSummary,
} from '../types.js'
import type { ArkmeBotRefPayload } from './bot-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

type AvailableBotRef = ArkmeBotRefPayload & {
  target: Exclude<ArkmeBotRefPayload['target'], { kind: 'unavailable' }>
}

interface BotConversationContext {
  session: ArkmeSessionCredentials
  reference: AvailableBotRef
}

interface BotConversationOwnerAdapter {
  open(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation>
  refresh(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation>
  send(context: BotConversationContext, content: string, signal?: AbortSignal): Promise<ArkmeBotConversationSendResult>
  markRead?(context: BotConversationContext, sequence: number, signal?: AbortSignal): Promise<ArkmeBotConversationReadResult>
  notificationPreference(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotNotificationPreference>
  updateNotificationPreference(context: BotConversationContext, muted: boolean, signal?: AbortSignal): Promise<ArkmeBotNotificationPreference>
}

interface BotConversationRegistryPort {
  listBots(options?: { signal?: AbortSignal }): Promise<ArkmeBotList>
  openBotRef(botRef: string, expectedUserId: number): Promise<ArkmeBotRefPayload>
}

interface ChatBotConversationPort {
  readDirectBotConversation(
    botId: string,
    chatSessionUid: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeBotConversation>
  sendDirectBotText(
    chatSessionUid: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeBotConversationSendResult>
  markDirectBotRead(
    chatSessionUid: string,
    sequence: number,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeBotConversationReadResult>
  directBotNotificationPreference(
    chatSessionUid: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeBotNotificationPreference>
  updateDirectBotNotificationPreference(
    chatSessionUid: string,
    muted: boolean,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeBotNotificationPreference>
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function botConversationTimestamp(value: unknown): number {
  const numeric = numberValue(value)
  if (numeric <= 0) return 0
  if (numeric < 10_000_000_000) return numeric * 1_000
  let millis = numeric
  while (millis >= 100_000_000_000_000) millis = Math.trunc(millis / 1_000)
  return millis
}

function subjectAttachments(value: unknown): ArkmeBotConversationMessage['attachments'] {
  return listValue(value).map(objectValue).flatMap(raw => {
    const kind = stringValue(raw.kind).trim()
    const fileName = stringValue(raw.file_name ?? raw.fileName).trim()
    const mimeType = stringValue(raw.mime_type ?? raw.mimeType).trim()
    const hasSourceFile = stringValue(raw.file_id ?? raw.fileId).trim() !== ''
    if (kind === '' && fileName === '' && mimeType === '' && !hasSourceFile) return []
    return [{
      kind: kind || 'file',
      fileName,
      mimeType,
      size: Math.max(0, Math.trunc(numberValue(raw.size))),
      durationMillis: Math.max(0, Math.trunc(numberValue(raw.duration_ms ?? raw.durationMillis))),
      width: Math.max(0, Math.trunc(numberValue(raw.width))),
      height: Math.max(0, Math.trunc(numberValue(raw.height))),
      sortOrder: Math.max(0, Math.trunc(numberValue(raw.order ?? raw.sort_order ?? raw.sortOrder))),
    }]
  })
}

function subjectMessage(value: unknown, fallbackContent = ''): ArkmeBotConversationMessage {
  const raw = objectValue(value)
  const recordUid = stringValue(raw.record_uid ?? raw.recordUid).trim()
  const content = stringValue(raw.content)
  return {
    messageId: stringValue(raw.message_id ?? raw.messageId).trim(),
    ...(recordUid === '' ? {} : { recordUid }),
    role: stringValue(raw.role).trim().toLowerCase() === 'user' ? 'user' : 'assistant',
    content: content === '' ? fallbackContent : content,
    status: stringValue(raw.status).trim() || 'sent',
    createdAtMillis: botConversationTimestamp(raw.created_at ?? raw.createdAt),
    attachments: subjectAttachments(raw.attachments),
  }
}

function dedupeMessages(messages: readonly ArkmeBotConversationMessage[]): ArkmeBotConversationMessage[] {
  const seen = new Set<string>()
  return messages.filter(message => {
    if (message.messageId === '') return true
    if (seen.has(message.messageId)) return false
    seen.add(message.messageId)
    return true
  })
}

function withLatestActivity(bot: ArkmeBotSummary, messages: readonly ArkmeBotConversationMessage[]): ArkmeBotSummary {
  const latest = messages.reduce<ArkmeBotConversationMessage | undefined>((current, message) => (
    current === undefined || message.createdAtMillis >= current.createdAtMillis ? message : current
  ), undefined)
  if (latest === undefined) return bot
  return {
    ...bot,
    ...(latest.createdAtMillis > 0 ? { latestMessageAtMillis: latest.createdAtMillis } : {}),
    ...(latest.content === '' ? {} : { latestMessagePreview: latest.content }),
  }
}

class SubjectBotConversationAdapter implements BotConversationOwnerAdapter {
  constructor(private readonly runtime: ServiceRuntime) {}

  async open(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation> {
    return await this.read(context, signal)
  }

  async refresh(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation> {
    return await this.read(context, signal)
  }

  async send(context: BotConversationContext, contentInput: string, signal?: AbortSignal): Promise<ArkmeBotConversationSendResult> {
    this.subjectTarget(context)
    const content = contentInput.trim()
    if (context.reference.provider === 'webhook') {
      throw new ArkmePluginError('bot-conversation-send-unsupported', 'Webhook Bot 仅接收外部系统推送', false, 400)
    }
    if (content === '' || content.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('bot-conversation-content-invalid', 'Bot 消息为空或超过长度限制', false, 400)
    }
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
        '/api/v1/bot/private-chat/message/send',
        { bot_id: context.reference.botId, content },
        context.session,
        signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && (
        error.retryable || ['arkme-network-error', 'arkme-timeout', 'arkme-response-invalid'].includes(error.code)
      )) {
        throw new ArkmePluginError(
          'bot-conversation-send-outcome-unknown',
          '消息发送结果未知，请刷新会话确认；不会自动重试',
          false,
          409,
          { cause: error },
        )
      }
      throw error
    }
    if (stringValue(objectValue(data.user_message).message_id).trim() === '') {
      throw new ArkmePluginError(
        'bot-conversation-send-outcome-unknown',
        '消息可能已发送，但响应缺少确认标识；请刷新会话确认',
        false,
        409,
      )
    }
    return {
      userMessage: subjectMessage(data.user_message, content),
      botMessages: dedupeMessages([
        ...listValue(data.bot_messages).map(message => subjectMessage(message)),
        ...(Object.keys(objectValue(data.bot_message)).length === 0 ? [] : [subjectMessage(data.bot_message)]),
      ]),
      status: stringValue(data.status).trim() || 'ok',
    }
  }

  async notificationPreference(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotNotificationPreference> {
    const target = this.subjectTarget(context)
    const data = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/subject/get-able-push-status', { subject_uid: target.subjectUid }, context.session, signal,
    )
    return { muted: data.able_push === false }
  }

  async updateNotificationPreference(
    context: BotConversationContext,
    muted: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeBotNotificationPreference> {
    const target = this.subjectTarget(context)
    await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/subject/set-able-push-status',
      { subject_uid: target.subjectUid, able_push: !muted },
      context.session,
      signal,
    )
    return { muted }
  }

  private async read(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation> {
    this.subjectTarget(context)
    const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: context.reference.botId }, context.session, signal,
    )
    return { messages: dedupeMessages(listValue(data.messages).map(message => subjectMessage(message))) }
  }

  private subjectTarget(context: BotConversationContext): Extract<AvailableBotRef['target'], { kind: 'subject' }> {
    if (context.reference.target.kind !== 'subject') {
      throw new ArkmePluginError('bot-conversation-owner-mismatch', 'Bot 会话 owner 不匹配', false, 409)
    }
    return context.reference.target
  }
}

class ChatBotConversationAdapter implements BotConversationOwnerAdapter {
  constructor(private readonly runtime: ServiceRuntime, private readonly chat: ChatBotConversationPort) {}

  async open(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation> {
    const target = this.chatTarget(context)
    const ensured = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
      '/api/v1/bot/private-chat/open', { bot_id: context.reference.botId }, context.session, signal,
    )
    if (stringValue(ensured.chat_session_uid).trim() !== target.chatSessionUid) {
      throw new ArkmePluginError('bot-conversation-target-mismatch', 'Bot Chat 会话确认不一致', false, 409)
    }
    return await this.chat.readDirectBotConversation(context.reference.botId, target.chatSessionUid, signal === undefined ? {} : { signal })
  }

  async refresh(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotConversation> {
    const target = this.chatTarget(context)
    return await this.chat.readDirectBotConversation(context.reference.botId, target.chatSessionUid, signal === undefined ? {} : { signal })
  }

  async send(context: BotConversationContext, content: string, signal?: AbortSignal): Promise<ArkmeBotConversationSendResult> {
    const target = this.chatTarget(context)
    return await this.chat.sendDirectBotText(target.chatSessionUid, content, signal === undefined ? {} : { signal })
  }

  async markRead(context: BotConversationContext, sequence: number, signal?: AbortSignal): Promise<ArkmeBotConversationReadResult> {
    const target = this.chatTarget(context)
    return await this.chat.markDirectBotRead(target.chatSessionUid, sequence, signal === undefined ? {} : { signal })
  }

  async notificationPreference(context: BotConversationContext, signal?: AbortSignal): Promise<ArkmeBotNotificationPreference> {
    const target = this.chatTarget(context)
    return await this.chat.directBotNotificationPreference(target.chatSessionUid, signal === undefined ? {} : { signal })
  }

  async updateNotificationPreference(
    context: BotConversationContext,
    muted: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeBotNotificationPreference> {
    const target = this.chatTarget(context)
    return await this.chat.updateDirectBotNotificationPreference(target.chatSessionUid, muted, signal === undefined ? {} : { signal })
  }

  private chatTarget(context: BotConversationContext): Extract<AvailableBotRef['target'], { kind: 'chat' }> {
    if (context.reference.target.kind !== 'chat') {
      throw new ArkmePluginError('bot-conversation-owner-mismatch', 'Bot 会话 owner 不匹配', false, 409)
    }
    return context.reference.target
  }
}

export class BotConversationService {
  private readonly subject: SubjectBotConversationAdapter
  private readonly chatAdapter: ChatBotConversationAdapter

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly bot: BotConversationRegistryPort,
    chat: ChatBotConversationPort,
    private readonly invalidateRecordProjection: () => Promise<void>,
  ) {
    this.subject = new SubjectBotConversationAdapter(runtime)
    this.chatAdapter = new ChatBotConversationAdapter(runtime, chat)
  }

  async directory(options: { signal?: AbortSignal } = {}): Promise<ArkmeBotConversationDirectory> {
    const session = await this.runtime.requireSession()
    const { items } = await this.bot.listBots(options)
    const hydrated = await Promise.all(items.map(async bot => {
      const reference = await this.bot.openBotRef(bot.botRef, session.userId)
      if (reference.target.kind !== 'subject') return bot
      try {
        const conversation = await this.subject.open({
          session,
          reference: { ...reference, target: reference.target },
        }, options.signal)
        return withLatestActivity(bot, conversation.messages)
      } catch {
        return bot
      }
    }))
    return { items: hydrated }
  }

  async open(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotConversation> {
    const context = await this.context(botRef)
    return await this.adapter(context).open(context, options.signal)
  }

  async refresh(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotConversation> {
    const context = await this.context(botRef)
    return await this.adapter(context).refresh(context, options.signal)
  }

  async send(
    botRef: string,
    content: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotConversationSendResult> {
    const context = await this.context(botRef)
    const result = await this.adapter(context).send(context, content, options.signal)
    if (context.reference.target.kind === 'subject') await this.invalidateRecordProjection()
    return result
  }

  async markRead(
    botRef: string,
    sequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotConversationReadResult> {
    const context = await this.context(botRef)
    const adapter = this.adapter(context)
    if (adapter.markRead === undefined) {
      throw new ArkmePluginError('bot-conversation-read-unsupported', '当前 Bot 会话不支持已读游标', false, 400)
    }
    return await adapter.markRead(context, sequence, options.signal)
  }

  async notificationPreference(
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotNotificationPreference> {
    const context = await this.context(botRef)
    return await this.adapter(context).notificationPreference(context, options.signal)
  }

  async updateNotificationPreference(
    botRef: string,
    muted: boolean,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotNotificationPreference> {
    const context = await this.context(botRef)
    return await this.adapter(context).updateNotificationPreference(context, muted, options.signal)
  }

  private async context(botRef: string): Promise<BotConversationContext> {
    const session = await this.runtime.requireSession()
    const reference = await this.bot.openBotRef(botRef, session.userId)
    if (reference.target.kind === 'unavailable') {
      throw new ArkmePluginError('bot-conversation-owner-unavailable', '当前 Bot 会话归属信息不可用，请刷新后重试', false, 409)
    }
    return { session, reference: { ...reference, target: reference.target } }
  }

  private adapter(context: BotConversationContext): BotConversationOwnerAdapter {
    return context.reference.target.kind === 'subject' ? this.subject : this.chatAdapter
  }
}
