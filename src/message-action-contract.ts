import type { ArkmeSessionCredentials } from './keychain-store.js'
import type { ArkmeMessageCopyLinkResult, ArkmeSourceSendResult } from './types.js'

export type MessageActionRole = 'user' | 'assistant'

interface MessageActionReferenceBase {
  version: 2
  userId: number
  messageIdentity: string
  role: MessageActionRole
  textContent: string
  createdAtMillis: number
  sortOrdinal: number
  senderUserId: number
  senderName: string
}

export interface AgentMessageActionReference extends MessageActionReferenceBase {
  ownerKind: 'agent'
  agentSessionId: number
  agentMessageId: number
  entryRecordUid?: string
}

export interface ChatBotMessageActionReference extends MessageActionReferenceBase {
  ownerKind: 'bot_chat'
  chatSessionUid: string
  relationUid: string
  recordUid: string
  sequence: number
}

export interface SubjectBotMessageActionReference extends MessageActionReferenceBase {
  ownerKind: 'bot_subject'
  subjectUid: string
  recordUid: string
}

export type MessageActionReference =
  | AgentMessageActionReference
  | ChatBotMessageActionReference
  | SubjectBotMessageActionReference

export interface AgentMessageActionConversation {
  version: 2
  userId: number
  sessionId: number
}

export type MessageActionTarget =
  | { kind: 'private_chat'; ownerRef: string }
  | { kind: 'group_chat'; ownerRef: string }
  | { kind: 'send_to_self'; ownerRef: string }
  | { kind: 'default_category'; ownerRef: string }
  | { kind: 'topic'; ownerRef: string }

export interface MessageActionBotRegistryPort {
  openBotRef(botRef: string, expectedUserId: number): Promise<{
    target:
      | { kind: 'chat'; chatSessionUid: string }
      | { kind: 'subject'; subjectUid: string }
      | { kind: 'unavailable'; reason: string }
  }>
}

export interface MessageActionCapabilityCodec {
  seal(prefix: string, payload: unknown): Promise<string>
  open(prefix: string, value: string): Promise<Record<string, unknown>>
}

export interface MessageActionGateway {
  requireSession(): Promise<ArkmeSessionCredentials>
  maxTextLength(): number
  openTarget(targetSourceRef: string, userId: number): Promise<MessageActionTarget>
  createCopyLink(
    references: readonly MessageActionReference[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeMessageCopyLinkResult>
  forwardToChat(input: {
    targetSourceRef: string
    target: Extract<MessageActionTarget, { kind: 'private_chat' }> | Extract<MessageActionTarget, { kind: 'group_chat' }>
    references: readonly MessageActionReference[]
    requestId: string
    sendAtMillis: number
    commentText: string
    session: ArkmeSessionCredentials
    signal?: AbortSignal
  }): Promise<ArkmeSourceSendResult>
  forwardToRecord(input: {
    targetSourceRef: string
    target: Exclude<MessageActionTarget, { kind: 'private_chat' | 'group_chat' }>
    references: readonly MessageActionReference[]
    requestId: string
    recordUid: string
    sendAtMillis: number
    session: ArkmeSessionCredentials
    signal?: AbortSignal
  }): Promise<ArkmeSourceSendResult>
  createRecordTargetComment(input: {
    target: Exclude<MessageActionTarget, { kind: 'private_chat' | 'group_chat' }>
    recordUid: string
    textContent: string
    sendAtMillis: number
    session: ArkmeSessionCredentials
    signal?: AbortSignal
  }): Promise<void>
}

export function messageActionCanCopyLink(reference: MessageActionReference): boolean {
  if (reference.ownerKind === 'agent') return reference.role === 'assistant' || reference.entryRecordUid !== undefined
  if (reference.ownerKind === 'bot_chat') return true
  return reference.role === 'user'
}
