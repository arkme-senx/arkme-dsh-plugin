import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { NATIVE_FORWARD_MAX_MESSAGES, NATIVE_FORWARD_MAX_TEXT_BYTES, NATIVE_FORWARD_MAX_TOTAL_BYTES } from '../native-chat-selection-contract.js'
import type {
  AgentMessageActionConversation,
  ArkoMessageActionReader,
  MessageActionSource,
  NativeMessageSnapshot,
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

const HISTORY_ACTION_PREFIX = 'arkme-arko-message-action-v1'

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
    private readonly arkoReader?: ArkoMessageActionReader,
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
    const reference = this.agentReference(item, userId)
    if (!reference) return {}
    const compact = item.messageRef !== undefined
    const payload = compact ? { userId, sessionId: item.sessionId, messageId: item.messageId, fingerprint: this.historyFingerprint(item), expiresAtMillis: Date.now() + 24 * 60 * 60_000 } : reference
    return { messageActionRef: await this.codec.seal(compact ? HISTORY_ACTION_PREFIX : ACTION_REF_PREFIX, payload), messageActionCapabilities: capabilities(reference) }
  }

  private agentReference(item: ArkmeArkoHistoryItem, userId: number): AgentMessageActionReference | undefined {
    if (item.role === 'user' && item.contentBlocks?.some(block => block.kind === 'image')) return undefined
    if (item.text.trim() === '' || item.messageId <= 0 || item.sessionId <= 0 || item.status !== 1) return undefined
    const entryRecordUid = item.entryRecordUid?.trim() ?? ''
    return {
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
      ...(item.sourceType === undefined ? {} : { shareableAgentReply: item.sourceType === 2 && item.messageType === 3 }),
      ...(item.role === 'user' && entryRecordUid !== '' ? { entryRecordUid } : {}),
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
    const { session, references } = await this.openConversationActions(conversationRef, actionRefs, signal)
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
    const { session, references } = await this.openConversationActions(conversationRef, actionRefs, options.signal)
    if (references.some(reference => reference.textContent.trim() === '')) {
      throw new ArkmePluginError('message-actions-source-unavailable', '所选消息暂不支持转发', false, 409)
    }
    return await this.deliver(references, session, options)
  }

  async forwardNative(snapshot: unknown, expectedUserId: number, options: MessageActionForwardOptions): Promise<ArkmeSourceSendResult> {
    const session = await this.gateway.requireSession()
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0 || session.userId !== expectedUserId) {
      throw new ArkmePluginError('native-forward-account-changed', '账号已变化，请重新选择后转发', false, 409)
    }
    const references = this.nativeMessages(snapshot, session.userId)
    return await this.deliver(references, session, options)
  }

  async forwardCodex(snapshot: unknown, expectedUserId: number, options: MessageActionForwardOptions): Promise<ArkmeSourceSendResult> {
    const session = await this.gateway.requireSession()
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0 || session.userId !== expectedUserId) throw new ArkmePluginError('codex-account-changed', '账号已变化，请重新选择', false, 409)
    const raw = snapshot as { taskTitle?: unknown; inputName?: unknown }
    if (!raw || typeof raw.taskTitle !== 'string' || !raw.taskTitle.trim() || raw.taskTitle.length > 500 || typeof raw.inputName !== 'string' || raw.inputName.length > 200) throw new ArkmePluginError('codex-selection-invalid', 'Codex 对话来源无效，请重新选择', false, 400)
    const references = this.nativeMessages(snapshot, session.userId).map(message => ({ ...message, ownerKind: 'codex' as const, taskTitle: raw.taskTitle as string,
      senderUserId: 0, senderName: message.role === 'user' ? (raw.inputName as string || '用户') : 'Codex' }))
    return this.deliver(references, session, options)
  }

  async copyLinkNative(snapshot: unknown, expectedUserId: number, signal?: AbortSignal): Promise<ArkmeMessageCopyLinkResult> {
    const session = await this.gateway.requireSession()
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0 || session.userId !== expectedUserId) {
      throw new ArkmePluginError('native-copy-link-account-changed', '账号已变化，请重新选择', false, 409)
    }
    const messages = this.nativeMessages(snapshot, session.userId)
    if (messages.some(item => new TextEncoder().encode(item.sessionId).byteLength > 512 || new TextEncoder().encode(item.messageIdentity).byteLength > 1024)) {
      throw new ArkmePluginError('native-selection-snapshot-invalid', '所选对话标识无效，请重新选择', false, 400)
    }
    if (messages.reduce((sum, item) => sum + new TextEncoder().encode(item.textContent).byteLength, 0) > 512 * 1024
      || messages.some(item => [...item.textContent].length > 90_000)) {
      throw new ArkmePluginError('native-copy-link-too-large', '所选内容过长，请减少消息后重试', false, 400)
    }
    return await this.gateway.createCopyLink(messages, session, signal)
  }

  private nativeMessages(snapshot: unknown, userId: number): NativeMessageSnapshot[] {
    const invalid = () => new ArkmePluginError('native-selection-snapshot-invalid', '所选对话正文无效，请重新选择', false, 400)
    if (!snapshot || typeof snapshot !== 'object') throw invalid()
    const raw = snapshot as Record<string, unknown>
    if (typeof raw.sessionId !== 'string' || !raw.sessionId.trim() || raw.sessionId.length > 512
      || !Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > NATIVE_FORWARD_MAX_MESSAGES) throw invalid()
    const sessionId = raw.sessionId
    let bytes = 0
    const keys = new Set<string>()
    let previous = -1
    return raw.messages.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw invalid()
      const item = value as Record<string, unknown>
      if (typeof item.key !== 'string' || !item.key.trim() || item.key.length > 1024 || keys.has(item.key)
        || (item.role !== 'user' && item.role !== 'assistant') || typeof item.text !== 'string' || !item.text.trim()
        || typeof item.anchorSeq !== 'number' || !Number.isSafeInteger(item.anchorSeq) || item.anchorSeq <= previous
        || typeof item.createdAtMillis !== 'number' || !Number.isSafeInteger(item.createdAtMillis) || item.createdAtMillis <= 0) throw invalid()
      const size = new TextEncoder().encode(item.text).byteLength
      bytes += size
      if (size > NATIVE_FORWARD_MAX_TEXT_BYTES || bytes > NATIVE_FORWARD_MAX_TOTAL_BYTES) throw invalid()
      keys.add(item.key); previous = item.anchorSeq
      return { ownerKind: 'dsh_native', sessionId, messageIdentity: item.key, role: item.role,
        textContent: item.text, createdAtMillis: item.createdAtMillis, sortOrdinal: item.anchorSeq,
        senderUserId: item.role === 'user' ? userId : 0, senderName: item.role === 'user' ? '我' : 'DeepSeek Harness' }
    })
  }

  private async deliver(references: readonly MessageActionSource[], session: ArkmeSessionCredentials, options: MessageActionForwardOptions): Promise<ArkmeSourceSendResult> {
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

  private historyFingerprint(item: ArkmeArkoHistoryItem): string {
    return this.codec.fingerprint([item.text, item.role, item.createdAtMillis, item.sourceType ?? 0, item.messageType ?? 0, item.entryRecordUid ?? ''])
  }

  private async openActionRefs(refs: string[], userId: number, signal?: AbortSignal): Promise<MessageActionReference[]> {
    const compact = new Map<string, { sessionId: number; messageId: number; fingerprint: string }>()
    for (const ref of refs) {
      signal?.throwIfAborted()
      if (!ref.startsWith(`${HISTORY_ACTION_PREFIX}.`)) continue
      const value = await this.codec.open(HISTORY_ACTION_PREFIX, ref)
      if (value.userId !== userId || !Number.isSafeInteger(value.sessionId) || numberValue(value.sessionId) < 1
        || !Number.isSafeInteger(value.messageId) || numberValue(value.messageId) < 1 || numberValue(value.expiresAtMillis) <= Date.now()
        || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用已失效，请刷新后重试', false, 403)
      compact.set(ref, { sessionId: numberValue(value.sessionId), messageId: numberValue(value.messageId), fingerprint: value.fingerprint })
    }
    const facts = new Map<string, ArkmeArkoHistoryItem>()
    if (compact.size) {
      if (!this.arkoReader) throw new ArkmePluginError('message-actions-source-unavailable', '当前 Host 不支持历史消息操作', false, 409)
      const rows = await this.arkoReader.read([...compact.values()].map(({ sessionId, messageId }) => ({ sessionId, messageId })), userId, signal)
      signal?.throwIfAborted()
      for (const item of rows) facts.set(`${item.sessionId}:${item.messageId}`, item)
    }
    return Promise.all(refs.map(async ref => {
      const expected = compact.get(ref)
      if (!expected) return this.openActionRef(ref, userId)
      const item = facts.get(`${expected.sessionId}:${expected.messageId}`)
      const reference = item ? this.agentReference(item, userId) : undefined
      if (!item || !reference || this.historyFingerprint(item) !== expected.fingerprint) throw new ArkmePluginError('message-actions-source-changed', '原消息已变化或不可查看，请刷新后重试', false, 409)
      return reference
    }))
  }

  private async openConversationActions(
    conversationRef: string,
    actionRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ session: Awaited<ReturnType<MessageActionGateway['requireSession']>>; references: MessageActionReference[] }> {
    const session = await this.gateway.requireSession()
    const normalizedRefs = actionRefs.map(value => value.trim()).filter(value => value !== '')
    if (normalizedRefs.length < 1 || normalizedRefs.length > MAX_MESSAGE_ACTIONS
      || new Set(normalizedRefs).size !== normalizedRefs.length) {
      throw new ArkmePluginError('message-actions-selection-invalid', '请选择 1 至 100 条不重复消息', false, 400)
    }
    const expected = await this.openConversation(conversationRef, session.userId)
    const references = await this.openActionRefs(normalizedRefs, session.userId, signal)
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
        ...(typeof raw.shareableAgentReply === 'boolean' ? { shareableAgentReply: raw.shareableAgentReply } : {}),
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
