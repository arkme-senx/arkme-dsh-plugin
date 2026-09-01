import type {
  AgentMessageActionConversation,
  AgentMessageActionReference,
  ChatBotMessageActionReference,
  MessageActionBotRegistryPort,
  MessageActionCapabilityCodec,
  MessageActionGateway,
  MessageActionReference,
  SubjectBotMessageActionReference,
} from '../message-action-contract.js'
import { messageActionCanCopyLink } from '../message-action-contract.js'
import type {
  ArkmeArkoHistoryItem,
  ArkmeMessageActionCapabilities,
  ArkmeMessageCopyLinkResult,
  ArkmeSourceSendResult,
} from '../types.js'
import { ArkmePluginError, stringValue } from './service.js'

const ACTION_REF_PREFIX = 'arkme-owner-message-action-v2'
const AGENT_CONVERSATION_REF_PREFIX = 'arkme-agent-conversation-v2'
const MAX_MESSAGE_ACTIONS = 100
const RECORD_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface MessageActionForwardOptions {
  targetSourceRef: string
  requestId: string
  recordUid: string
  sendAtMillis: number
  commentRecordUid?: string
  commentText?: string
  signal?: AbortSignal
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function capabilities(reference: MessageActionReference): ArkmeMessageActionCapabilities {
  return { copyLink: messageActionCanCopyLink(reference), forward: reference.textContent.trim() !== '' }
}

export class MessageActionService {
  constructor(
    private readonly gateway: MessageActionGateway,
    private readonly botRegistry: MessageActionBotRegistryPort,
    private readonly codec: MessageActionCapabilityCodec,
  ) {}

  async agentConversationRef(userId: number, sessionId: number): Promise<string> {
    if (userId <= 0 || sessionId <= 0) {
      throw new ArkmePluginError('message-actions-conversation-invalid', 'Agent 会话无效', false, 400)
    }
    return await this.codec.seal(AGENT_CONVERSATION_REF_PREFIX, {
      version: 2,
      userId,
      sessionId,
    } satisfies AgentMessageActionConversation)
  }

  async agentHistoryItem(
    item: ArkmeArkoHistoryItem,
    userId: number,
  ): Promise<Pick<ArkmeArkoHistoryItem, 'messageActionRef' | 'messageActionCapabilities'>> {
    const textContent = item.text.trim()
    if (textContent === '' || item.messageId <= 0 || item.sessionId <= 0 || item.status !== 1) return {}
    const entryRecordUid = item.entryRecordUid?.trim() ?? ''
    const reference: AgentMessageActionReference = {
      version: 2,
      userId,
      ownerKind: 'agent',
      messageIdentity: String(item.messageId),
      role: item.role,
      textContent: item.text,
      createdAtMillis: Math.max(0, Math.trunc(item.createdAtMillis)),
      sortOrdinal: item.messageId,
      senderUserId: item.role === 'user' ? userId : 0,
      senderName: item.role === 'user' ? '我' : 'Agent',
      agentSessionId: item.sessionId,
      agentMessageId: item.messageId,
      ...(item.role === 'user' && entryRecordUid !== '' ? { entryRecordUid } : {}),
    }
    return {
      messageActionRef: await this.codec.seal(ACTION_REF_PREFIX, reference),
      messageActionCapabilities: capabilities(reference),
    }
  }

  async chatBotMessage(input: {
    userId: number
    chatSessionUid: string
    relationUid: string
    recordUid: string
    messageIdentity: string
    role: 'user' | 'assistant'
    textContent: string
    createdAtMillis: number
    sequence: number
    senderUserId: number
    senderName: string
  }): Promise<{ messageActionRef: string; messageActionCapabilities: ArkmeMessageActionCapabilities } | undefined> {
    if (input.chatSessionUid.trim() === '' || input.relationUid.trim() === '' || input.recordUid.trim() === ''
      || input.messageIdentity.trim() === '' || input.textContent.trim() === '' || input.sequence <= 0) return undefined
    const reference: ChatBotMessageActionReference = {
      version: 2,
      userId: input.userId,
      ownerKind: 'bot_chat',
      messageIdentity: input.messageIdentity,
      role: input.role,
      textContent: input.textContent,
      createdAtMillis: Math.max(0, Math.trunc(input.createdAtMillis)),
      sortOrdinal: Math.trunc(input.sequence),
      senderUserId: input.senderUserId,
      senderName: input.senderName.trim() || (input.role === 'user' ? '我' : 'Bot'),
      chatSessionUid: input.chatSessionUid,
      relationUid: input.relationUid,
      recordUid: input.recordUid,
      sequence: Math.trunc(input.sequence),
    }
    return {
      messageActionRef: await this.codec.seal(ACTION_REF_PREFIX, reference),
      messageActionCapabilities: capabilities(reference),
    }
  }

  async subjectBotMessage(input: {
    userId: number
    subjectUid: string
    messageIdentity: string
    recordUid: string
    role: 'user' | 'assistant'
    textContent: string
    createdAtMillis: number
  }): Promise<{ messageActionRef: string; messageActionCapabilities: ArkmeMessageActionCapabilities } | undefined> {
    if (input.subjectUid.trim() === '' || input.messageIdentity.trim() === '' || input.recordUid.trim() === ''
      || input.textContent.trim() === '') return undefined
    const reference: SubjectBotMessageActionReference = {
      version: 2,
      userId: input.userId,
      ownerKind: 'bot_subject',
      messageIdentity: input.messageIdentity,
      role: input.role,
      textContent: input.textContent,
      createdAtMillis: Math.max(0, Math.trunc(input.createdAtMillis)),
      sortOrdinal: Math.max(0, Math.trunc(input.createdAtMillis)),
      senderUserId: input.role === 'user' ? input.userId : 0,
      senderName: input.role === 'user' ? '我' : 'Bot',
      subjectUid: input.subjectUid,
      recordUid: input.recordUid,
    }
    return {
      messageActionRef: await this.codec.seal(ACTION_REF_PREFIX, reference),
      messageActionCapabilities: capabilities(reference),
    }
  }

  async copyLink(
    conversationRef: string,
    actionRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeMessageCopyLinkResult> {
    const { session, references } = await this.openConversationActions(conversationRef, actionRefs)
    if (references.some(reference => !messageActionCanCopyLink(reference))) {
      throw new ArkmePluginError('message-actions-source-unavailable', '所选消息暂不支持复制链接', false, 409)
    }
    return await this.gateway.createCopyLink(references, session, signal)
  }

  async forward(
    conversationRef: string,
    actionRefs: readonly string[],
    options: MessageActionForwardOptions,
  ): Promise<ArkmeSourceSendResult> {
    const { session, references } = await this.openConversationActions(conversationRef, actionRefs)
    if (references.some(reference => reference.textContent.trim() === '')) {
      throw new ArkmePluginError('message-actions-source-unavailable', '所选消息暂不支持转发', false, 409)
    }
    const targetSourceRef = options.targetSourceRef.trim()
    const requestId = options.requestId.trim()
    const recordUid = options.recordUid.trim()
    const commentRecordUid = options.commentRecordUid?.trim() ?? ''
    const sendAtMillis = Math.trunc(options.sendAtMillis)
    if (targetSourceRef === '' || requestId === '' || requestId.length > 180
      || !RECORD_UID_PATTERN.test(recordUid)
      || (commentRecordUid !== '' && !RECORD_UID_PATTERN.test(commentRecordUid))
      || !Number.isSafeInteger(options.sendAtMillis) || sendAtMillis <= 0) {
      throw new ArkmePluginError('message-actions-request-invalid', '转发请求标识无效', false, 400)
    }
    const commentText = options.commentText?.trim() ?? ''
    if (commentText.length > this.gateway.maxTextLength()) {
      throw new ArkmePluginError('source-text-invalid', '发送内容超过长度限制', false, 400)
    }
    const target = await this.gateway.openTarget(targetSourceRef, session.userId)
    if (commentText !== '' && target.kind !== 'private_chat' && target.kind !== 'group_chat' && commentRecordUid === '') {
      throw new ArkmePluginError('message-actions-request-invalid', '转发附言标识无效', false, 400)
    }
    if (target.kind === 'private_chat' || target.kind === 'group_chat') {
      return await this.gateway.forwardToChat({
        targetSourceRef, target, references, requestId, sendAtMillis, commentText, session,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    }
    const result = await this.gateway.forwardToRecord({
      targetSourceRef, target, references, requestId, recordUid, sendAtMillis, session,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (commentText === '') return result
    try {
      await this.gateway.createRecordTargetComment({
        target, recordUid: commentRecordUid, textContent: commentText,
        sendAtMillis: sendAtMillis + 1, session,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      return result
    } catch {
      return { ...result, warningText: '转发已完成，附言发送失败' }
    }
  }

  private async openConversationActions(
    conversationRef: string,
    actionRefs: readonly string[],
  ): Promise<{ session: Awaited<ReturnType<MessageActionGateway['requireSession']>>; references: MessageActionReference[] }> {
    const session = await this.gateway.requireSession()
    const normalizedRefs = actionRefs.map(value => value.trim()).filter(value => value !== '')
    if (normalizedRefs.length < 1 || normalizedRefs.length > MAX_MESSAGE_ACTIONS
      || new Set(normalizedRefs).size !== normalizedRefs.length) {
      throw new ArkmePluginError('message-actions-selection-invalid', '请选择 1 至 100 条不重复消息', false, 400)
    }
    const expected = await this.openConversation(conversationRef, session.userId)
    const references = await Promise.all(normalizedRefs.map(async ref => await this.openActionRef(ref, session.userId)))
    const identities = new Set<string>()
    for (const reference of references) {
      let matches: boolean
      if (expected.kind === 'agent') {
        matches = reference.ownerKind === 'agent' && reference.agentSessionId === expected.sessionId
      } else if (expected.target.kind === 'chat') {
        matches = reference.ownerKind === 'bot_chat' && reference.chatSessionUid === expected.target.chatSessionUid
      } else {
        matches = reference.ownerKind === 'bot_subject' && reference.subjectUid === expected.target.subjectUid
      }
      if (!matches || !identities.add(`${reference.ownerKind}\u0000${reference.messageIdentity}`)) {
        throw new ArkmePluginError('message-actions-conversation-mismatch', '消息引用与当前会话不匹配', false, 403)
      }
    }
    references.sort((left, right) => left.sortOrdinal - right.sortOrdinal
      || left.createdAtMillis - right.createdAtMillis
      || left.messageIdentity.localeCompare(right.messageIdentity))
    return { session, references }
  }

  private async openConversation(conversationRef: string, userId: number): Promise<
    | { kind: 'agent'; sessionId: number }
    | { kind: 'bot'; target: { kind: 'chat'; chatSessionUid: string } | { kind: 'subject'; subjectUid: string } }
  > {
    if (conversationRef.startsWith(`${AGENT_CONVERSATION_REF_PREFIX}.`)) {
      const raw = await this.codec.open(AGENT_CONVERSATION_REF_PREFIX, conversationRef)
      const sessionId = Math.trunc(numberValue(raw.sessionId))
      if (raw.version !== 2 || Math.trunc(numberValue(raw.userId)) !== userId || sessionId <= 0) {
        throw new ArkmePluginError('message-actions-conversation-invalid', 'Agent 会话引用无效', false, 403)
      }
      return { kind: 'agent', sessionId }
    }
    const reference = await this.botRegistry.openBotRef(conversationRef, userId)
    if (reference.target.kind === 'unavailable') {
      throw new ArkmePluginError('message-actions-conversation-invalid', 'Bot 会话归属不可用', false, 409)
    }
    return { kind: 'bot', target: reference.target }
  }

  private async openActionRef(actionRef: string, userId: number): Promise<MessageActionReference> {
    const raw = await this.codec.open(ACTION_REF_PREFIX, actionRef)
    const ownerKind = stringValue(raw.ownerKind)
    const role = stringValue(raw.role)
    const common = {
      version: 2 as const,
      userId: Math.trunc(numberValue(raw.userId)),
      messageIdentity: stringValue(raw.messageIdentity).trim(),
      role: role as 'user' | 'assistant',
      textContent: stringValue(raw.textContent),
      createdAtMillis: Math.max(0, Math.trunc(numberValue(raw.createdAtMillis))),
      sortOrdinal: Math.max(0, Math.trunc(numberValue(raw.sortOrdinal))),
      senderUserId: Math.trunc(numberValue(raw.senderUserId)),
      senderName: stringValue(raw.senderName).trim(),
    }
    if (raw.version !== 2 || common.userId !== userId || !['user', 'assistant'].includes(role)
      || common.messageIdentity === '' || common.textContent.trim() === '' || common.senderName === '') {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 403)
    }
    if (ownerKind === 'agent') {
      const agentSessionId = Math.trunc(numberValue(raw.agentSessionId))
      const agentMessageId = Math.trunc(numberValue(raw.agentMessageId))
      const entryRecordUid = stringValue(raw.entryRecordUid).trim()
      if (agentSessionId <= 0 || agentMessageId <= 0 || common.messageIdentity !== String(agentMessageId)
        || common.sortOrdinal !== agentMessageId
        || (common.role === 'user' ? common.senderUserId !== userId : common.senderUserId !== 0 || entryRecordUid !== '')) {
        throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 403)
      }
      return {
        ...common, ownerKind, agentSessionId, agentMessageId,
        ...(entryRecordUid === '' ? {} : { entryRecordUid }),
      }
    }
    if (ownerKind === 'bot_chat') {
      const chatSessionUid = stringValue(raw.chatSessionUid).trim()
      const relationUid = stringValue(raw.relationUid).trim()
      const recordUid = stringValue(raw.recordUid).trim()
      const sequence = Math.trunc(numberValue(raw.sequence))
      if (chatSessionUid === '' || relationUid === '' || recordUid === '' || sequence <= 0
        || common.sortOrdinal !== sequence) {
        throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 403)
      }
      return { ...common, ownerKind, chatSessionUid, relationUid, recordUid, sequence }
    }
    if (ownerKind === 'bot_subject') {
      const subjectUid = stringValue(raw.subjectUid).trim()
      const recordUid = stringValue(raw.recordUid).trim()
      if (subjectUid === '' || recordUid === '' || common.sortOrdinal !== common.createdAtMillis
        || (common.role === 'user' ? common.senderUserId !== userId : common.senderUserId !== 0)) {
        throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 403)
      }
      return { ...common, ownerKind, subjectUid, recordUid }
    }
    throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 400)
  }
}
