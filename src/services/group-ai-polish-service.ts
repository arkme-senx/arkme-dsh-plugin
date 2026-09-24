import { randomUUID } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeGroupAiPolishMutationResult,
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishRuleCandidate,
  ArkmeGroupAiPolishSnapshot,
  ArkmeGroupAiPolishThreadMessage,
  ArkmeRecordCaptureContext,
  ArkmeSourceItem,
  ArkmeSourceSendResult,
  ArkmeTimelineItem,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { SourceService } from './source-service.js'

export interface ArkmeAiPolishConfigSnapshot {
  enabled: boolean
  canManage: boolean
  viewerRole: number
  activeRuleUid: string
  activeRuleName: string
  updatedAtMillis: number
  rules: Array<{
    ruleUid: string
    name: string
    ruleText: string
    ruleVersion: number
    threadMessages: ArkmeGroupAiPolishThreadMessage[]
  }>
}

interface ArkmePendingAiPolishConfirmation {
  userId: number
  chatSessionUid: string
  groupName: string
  action: 'enable' | 'disable'
  expiresAtMillis: number
  candidateUid?: string
  editingRuleUid?: string
  editingRuleVersion?: number
  savedRuleUid?: string
  confirming?: boolean
  ruleName?: string
  ruleText?: string
  promptVersion?: string
  extra?: Record<string, unknown>
}

interface ArkmePendingAiPolishRetry {
  userId: number
  sourceRef: string
  chatSessionUid: string
  relationUid: string
  recordUid: string
  originalText: string
  attempt: number
  expiresAtMillis: number
}

interface ArkmeAiPolishTextResult {
  taskUid: string
  attempt: number
  state: number
  action: number
  polishedText: string
  recordUid: string
  revisionUid: string
  ruleUid: string
  modelVersion: string
  promptVersion: string
  failureMessage: string
  extra: Record<string, unknown>
}

export interface ArkmeAiPolishChatPort {
  sendChatSourceTextRaw(
    sourceRef: string,
    chatSessionUid: string,
    text: string,
    recordUid: string,
    relationUid: string,
    session: ArkmeSessionCredentials,
    initialAiPolish?: Record<string, unknown>,
    contentPayload?: Record<string, unknown>,
    signal?: AbortSignal,
    options?: { agentAuthored?: boolean; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext },
  ): Promise<ArkmeSourceSendResult>
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function aiPolishThreadMessages(value: unknown): ArkmeGroupAiPolishThreadMessage[] {
  let totalCharacters = 0
  const messages: ArkmeGroupAiPolishThreadMessage[] = []
  for (const raw of listValue(value).slice(-40)) {
    const item = objectValue(raw)
    const id = stringValue(item.id).trim()
    const role = stringValue(item.role).trim()
    const text = stringValue(item.text).trim().slice(0, 4_000)
    if (id === '' || (role !== 'ai' && role !== 'user') || text === '') continue
    totalCharacters += [...text].length
    if (totalCharacters > 20_000) break
    const ruleRef = stringValue(item.rule_uid ?? item.ruleRef).trim()
    messages.push({
      id, role, text,
      ...(item.is_rule === true || item.isRule === true ? { isRule: true } : {}),
      ...(ruleRef === '' ? {} : { ruleRef }),
    })
  }
  return messages
}

function serializeAiPolishThreadMessage(message: ArkmeGroupAiPolishThreadMessage): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.isRule === true ? { is_rule: true } : {}),
    ...(message.ruleRef === undefined || message.ruleRef === '' ? {} : { rule_uid: message.ruleRef }),
  }
}

function compactAiPolishActorLabel(value: unknown): string {
  const normalized = stringValue(value).replace(/\s+/g, ' ').trim()
  if (normalized === '') return ''
  const characters = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(normalized)]
    .map(segment => segment.segment)
  return characters.length <= 4 ? normalized : characters.slice(0, 4).join('') + '…'
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

export class GroupAiPolishService {
  private readonly aiPolishConfirmations = new Map<string, ArkmePendingAiPolishConfirmation>()
  private readonly aiPolishRetries = new Map<string, ArkmePendingAiPolishRetry>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly chat: ArkmeAiPolishChatPort,
  ) {}

  dispose(): void {
    this.aiPolishConfirmations.clear()
    this.aiPolishRetries.clear()
  }

  private invalidateAiPolishReadCache(userId: number, chatSessionUid: string): void {
    const scope = this.runtime.requestScope(userId)
    this.runtime.requestCoordinator.invalidateKey(scope, 'ai-polish:settings:' + chatSessionUid)
    this.runtime.requestCoordinator.invalidateKey(scope, 'ai-polish:notices:' + chatSessionUid)
  }

  async inspectGroupAiPolish(
      sourceRef: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishSnapshot> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      if (source.kind !== 'group_chat') {
        throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
      }
      const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal)
      return this.groupAiPolishSnapshot(sourceRef, source.displayName, config)
    }
  
  async inspectGroupAiPolishByName(
      groupName: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishSnapshot> {
      const source = await this.resolveUniqueGroupByName(groupName, options.signal)
      return await this.inspectGroupAiPolish(source.sourceRef, options)
    }
  
  async readGroupAiPolishNotices(
      sourceRef: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishNotice[]> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      if (source.kind !== 'group_chat') {
        throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色通知仅支持群聊', false)
      }
      return await this.queryGroupAiPolishNotices(source.ownerRef, session, options.signal)
    }
  
  async generateGroupAiPolishRuleForSource(
      sourceRef: string,
      requirement: string,
      options: { signal?: AbortSignal; threadMessages?: readonly ArkmeGroupAiPolishThreadMessage[]; targetRuleRef?: string } = {},
    ): Promise<ArkmeGroupAiPolishRuleCandidate> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const instruction = requirement.trim()
      if (source.kind !== 'group_chat') {
        throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
      }
      if (instruction === '' || [...instruction].length > 2_000) {
        throw new ArkmePluginError('group-ai-polish-requirement-invalid', '请提供不超过 2000 字的润色要求', false)
      }
      const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal, options.targetRuleRef?.trim() !== '')
      if (!config.canManage) {
        throw this.permissionDenied()
      }
      const targetRuleRef = options.targetRuleRef?.trim() ?? ''
      const targetRule = targetRuleRef === '' ? undefined : config.rules.find(rule => rule.ruleUid === targetRuleRef)
      if (targetRuleRef !== '' && targetRule === undefined) {
        throw new ArkmePluginError('group-ai-polish-rule-not-found', '规则已删除或不可用，请重新读取规则列表', false, 404)
      }
      const generated = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/rules/generate',
        { chat_session_uid: source.ownerRef, instruction },
        session,
        options.signal,
      )
      const candidate = objectValue(generated.candidate ?? generated.rule ?? generated.generated_rule ?? generated)
      const ruleName = stringValue(candidate.name).trim()
      const ruleText = stringValue(candidate.rule_text).trim()
      if (ruleName === '' || ruleText === '') {
        throw new ArkmePluginError('group-ai-polish-generate-invalid', 'AI 没有生成可用的润色规则，请换一种描述重试', true, 502)
      }
      this.cleanupAiPolishState()
      const confirmationRef = `arkme-ai-polish-confirm-v1.${randomUUID()}`
      const suppliedThread = aiPolishThreadMessages(options.threadMessages)
      const candidateMessage: ArkmeGroupAiPolishThreadMessage = {
        id: `arkme-${randomUUID()}`, role: 'ai', text: ruleText, isRule: true,
        ...((targetRule?.ruleUid ?? stringValue(candidate.candidate_uid).trim()) === ''
          ? {} : { ruleRef: targetRule?.ruleUid ?? stringValue(candidate.candidate_uid).trim() }),
      }
      const threadMessages = suppliedThread.length === 0 ? [] : [...suppliedThread, candidateMessage]
      const candidateExtra = objectValue(candidate.extra)
      this.aiPolishConfirmations.set(confirmationRef, {
        userId: session.userId,
        chatSessionUid: source.ownerRef,
        groupName: source.displayName,
        action: 'enable',
        expiresAtMillis: Date.now() + 10 * 60_000,
        candidateUid: targetRule?.ruleUid ?? stringValue(candidate.candidate_uid).trim(),
        ...(targetRule === undefined ? {} : { editingRuleUid: targetRule.ruleUid, editingRuleVersion: targetRule.ruleVersion }),
        ruleName,
        ruleText,
        promptVersion: stringValue(candidate.prompt_version).trim(),
        extra: threadMessages.length === 0 ? candidateExtra : {
          ...candidateExtra,
          rule_thread_messages: threadMessages.map(serializeAiPolishThreadMessage),
          active_rule_message_id: candidateMessage.id,
        },
      })
      return {
        groupName: source.displayName, ruleName, ruleText, confirmationRef,
        ...(threadMessages.length === 0 ? {} : { threadMessages }),
      }
    }
  
  async generateGroupAiPolishRule(
      groupName: string,
      requirement: string,
      options: { signal?: AbortSignal; threadMessages?: readonly ArkmeGroupAiPolishThreadMessage[]; targetRuleRef?: string } = {},
    ): Promise<ArkmeGroupAiPolishRuleCandidate> {
      const source = await this.resolveUniqueGroupByName(groupName, options.signal)
      return await this.generateGroupAiPolishRuleForSource(source.sourceRef, requirement, options)
    }
  
  async confirmEnableGroupAiPolish(
    confirmationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishMutationResult> {
    const session = await this.runtime.requireSession()
    const pending = this.requireAiPolishConfirmation(confirmationRef, session.userId, 'enable')
    if (pending.confirming) throw new ArkmePluginError('group-ai-polish-confirm-busy', '此操作正在确认，请稍后重试', true, 409)
    pending.confirming = true
    try {
      const current = await this.queryGroupAiPolishConfig(pending.chatSessionUid, session, options.signal, true)
      if (!current.canManage) throw this.permissionDenied()
      const updateAt = Date.now()
      let ruleUid = pending.savedRuleUid ?? ''
      let ruleChanged = false
      if (ruleUid !== '') {
        const saved = current.rules.find(rule => rule.ruleUid === ruleUid)
        if (saved === undefined || saved.name !== pending.ruleName || saved.ruleText !== pending.ruleText) {
          throw new ArkmePluginError('group-ai-polish-preview-stale', '规则已被修改或删除，请重新预览并确认', false, 409)
        }
      } else {
        if (pending.editingRuleUid !== undefined) {
          const currentRule = current.rules.find(rule => rule.ruleUid === pending.editingRuleUid)
          if (currentRule === undefined || currentRule.ruleVersion !== pending.editingRuleVersion) {
            throw new ArkmePluginError('group-ai-polish-preview-stale', '规则已被其他成员修改或删除，请重新读取后再编辑', false, 409)
          }
        }
        const upserted = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/ai-polish/rules/upsert',
          {
            chat_session_uid: pending.chatSessionUid,
            ...(pending.candidateUid === undefined || pending.candidateUid === '' ? {} : { rule_uid: pending.candidateUid }),
            name: pending.ruleName,
            rule_text: pending.ruleText,
            ...(pending.promptVersion === undefined || pending.promptVersion === '' ? {} : { prompt_version: pending.promptVersion }),
            update_at: updateAt,
            ...(pending.extra === undefined || Object.keys(pending.extra).length === 0 ? {} : { extra: pending.extra }),
          },
          session,
          options.signal,
        )
        const rule = objectValue(upserted.rule ?? upserted)
        ruleUid = stringValue(rule.rule_uid).trim()
        if (ruleUid === '') {
          throw new ArkmePluginError('group-ai-polish-rule-invalid', '保存润色规则后未返回有效规则', true, 502)
        }
        ruleChanged = true
        pending.savedRuleUid = ruleUid
        this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
      }
      try {
        if (!current.enabled || current.activeRuleUid !== ruleUid) {
          await this.runtime.authenticatedChatPost<Record<string, unknown>>(
            '/api/v1/chats/ai-polish/settings/update',
            {
              chat_session_uid: pending.chatSessionUid,
              enabled: true,
              active_rule_uid: ruleUid,
              update_at: Math.max(Date.now(), updateAt + 1),
            },
            session,
            options.signal,
          )
        }
        this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
        const verified = await this.queryGroupAiPolishConfig(pending.chatSessionUid, session, options.signal, true)
        const verifiedRule = verified.rules.find(rule => rule.ruleUid === ruleUid)
        if (!verified.enabled || verified.activeRuleUid !== ruleUid
          || verifiedRule === undefined || verifiedRule.name !== pending.ruleName || verifiedRule.ruleText !== pending.ruleText) {
          throw new Error('AI polish state did not match the approved preview')
        }
      } catch {
        this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
        throw new ArkmePluginError('group-ai-polish-enable-unverified', '规则已保存，但未能确认开启生效；请查询当前状态后重试，不需要重新生成规则', true, 502)
      }
      this.aiPolishConfirmations.delete(confirmationRef.trim())
      return {
        groupName: pending.groupName, enabled: true, ruleName: pending.ruleName ?? '',
        changed: ruleChanged || !current.enabled || current.activeRuleUid !== ruleUid,
      }
    } finally {
      pending.confirming = false
    }
  }

  private permissionDenied(): ArkmePluginError {
    return new ArkmePluginError('group-ai-polish-forbidden', '服务端未授予当前账号该群的 AI 润色设置权限；请确认账号仍在群内，以及服务端已支持全体群成员设置', false, 403)
  }

  async prepareEnableGroupAiPolishForSource(
    sourceRef: string,
    ruleName = '',
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
    const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal, true)
    if (!config.canManage) throw this.permissionDenied()
    const name = ruleName.trim()
    const matches = name !== '' ? config.rules.filter(rule => rule.name === name)
      : config.activeRuleUid !== '' ? config.rules.filter(rule => rule.ruleUid === config.activeRuleUid)
        : config.rules
    if (matches.length === 0) throw new ArkmePluginError('group-ai-polish-rule-not-found', '没有找到可开启的规则，请先查询规则或提供新的润色要求', false, 404)
    if (matches.length !== 1) throw new ArkmePluginError('group-ai-polish-rule-ambiguous', '存在多个候选规则，请查询并指定唯一的规则名称', false, 409)
    const rule = matches[0]!
    this.cleanupAiPolishState()
    const confirmationRef = `arkme-ai-polish-confirm-v1.${randomUUID()}`
    this.aiPolishConfirmations.set(confirmationRef, {
      userId: session.userId, chatSessionUid: source.ownerRef, groupName: source.displayName,
      action: 'enable', expiresAtMillis: Date.now() + 10 * 60_000,
      savedRuleUid: rule.ruleUid, ruleName: rule.name, ruleText: rule.ruleText,
    })
    return { groupName: source.displayName, ruleName: rule.name, ruleText: rule.ruleText, confirmationRef }
  }

  async prepareEnableGroupAiPolishRuleForSource(
    sourceRef: string,
    ruleRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
    const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal, true)
    if (!config.canManage) throw this.permissionDenied()
    const normalizedRuleRef = ruleRef.trim()
    const rule = config.rules.find(candidate => candidate.ruleUid === normalizedRuleRef)
    if (normalizedRuleRef === '' || rule === undefined) {
      throw new ArkmePluginError('group-ai-polish-rule-not-found', '规则已删除或不可用，请重新读取规则列表', false, 404)
    }
    this.cleanupAiPolishState()
    const confirmationRef = `arkme-ai-polish-confirm-v1.${randomUUID()}`
    this.aiPolishConfirmations.set(confirmationRef, {
      userId: session.userId, chatSessionUid: source.ownerRef, groupName: source.displayName,
      action: 'enable', expiresAtMillis: Date.now() + 10 * 60_000,
      savedRuleUid: rule.ruleUid, ruleName: rule.name, ruleText: rule.ruleText,
    })
    return { groupName: source.displayName, ruleName: rule.name, ruleText: rule.ruleText, confirmationRef }
  }

  async prepareEnableGroupAiPolish(
    groupName: string,
    ruleName = '',
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const source = await this.resolveUniqueGroupByName(groupName, options.signal)
    return await this.prepareEnableGroupAiPolishForSource(source.sourceRef, ruleName, options)
  }
  
  async prepareDisableGroupAiPolishForSource(
      sourceRef: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishRuleCandidate> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      if (source.kind !== 'group_chat') throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
      const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal)
      if (!config.canManage) throw this.permissionDenied()
      this.cleanupAiPolishState()
      const confirmationRef = `arkme-ai-polish-confirm-v1.${randomUUID()}`
      this.aiPolishConfirmations.set(confirmationRef, {
        userId: session.userId, chatSessionUid: source.ownerRef, groupName: source.displayName,
        action: 'disable', expiresAtMillis: Date.now() + 10 * 60_000,
        ruleName: config.activeRuleName,
      })
      return {
        groupName: source.displayName,
        ruleName: config.activeRuleName,
        ruleText: '关闭后，新发送的群聊文本将不再自动润色。',
        confirmationRef,
      }
    }
  
  async prepareDisableGroupAiPolish(
      groupName: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishRuleCandidate> {
      const source = await this.resolveUniqueGroupByName(groupName, options.signal)
      return await this.prepareDisableGroupAiPolishForSource(source.sourceRef, options)
    }
  
  async confirmDisableGroupAiPolish(
      confirmationRef: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeGroupAiPolishMutationResult> {
      const session = await this.runtime.requireSession()
      const pending = this.requireAiPolishConfirmation(confirmationRef, session.userId, 'disable')
      const current = await this.queryGroupAiPolishConfig(pending.chatSessionUid, session, options.signal, true)
      if (!current.canManage) throw this.permissionDenied()
      const updated = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/settings/update',
        { chat_session_uid: pending.chatSessionUid, enabled: false, active_rule_uid: '', update_at: Date.now() },
        session,
        options.signal,
      )
      if (booleanValue(objectValue(updated.config ?? updated).enabled)) {
        throw new ArkmePluginError('group-ai-polish-disable-invalid', '关闭 AI 表达润色失败，请重试', true, 502)
      }
      this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
      this.aiPolishConfirmations.delete(confirmationRef.trim())
      return { groupName: pending.groupName, enabled: false, ruleName: pending.ruleName ?? '', changed: current.enabled }
    }
  
  async retryGroupAiPolish(
      retryRef: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<ArkmeSourceSendResult> {
      const session = await this.runtime.requireSession()
      this.cleanupAiPolishState()
      const normalized = retryRef.trim()
      const pending = this.aiPolishRetries.get(normalized)
      if (pending === undefined || pending.userId !== session.userId || pending.expiresAtMillis <= Date.now()) {
        this.aiPolishRetries.delete(normalized)
        throw new ArkmePluginError('group-ai-polish-retry-expired', '本次润色重试已失效，请重新发送消息', false, 410)
      }
      const taskUid = randomUUID()
      const attempt = pending.attempt + 1
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/text/retry-apply',
        {
          task_uid: taskUid,
          chat_session_uid: pending.chatSessionUid,
          rel_uid: pending.relationUid,
          record_uid: pending.recordUid,
          attempt,
          original_text: pending.originalText,
          extra: { input_source: 'dsh_plugin', content_kind: 'plain_text' },
        },
        session,
        options.signal,
      )
      const result = this.aiPolishTextResult(data)
      if (result.state === 1 && result.action === 1 && result.polishedText !== '') {
        this.aiPolishRetries.delete(normalized)
        return {
          sourceRef: pending.sourceRef,
          itemUid: result.recordUid || pending.recordUid,
          status: 1,
          localState: 'synced',
          aiPolish: {
            state: 'polished', originalText: pending.originalText, polishedText: result.polishedText,
          },
        }
      }
      pending.attempt = attempt
      pending.expiresAtMillis = Date.now() + 30 * 60_000
      return {
        sourceRef: pending.sourceRef,
        itemUid: pending.recordUid,
        status: 1,
        localState: 'synced',
        aiPolish: {
          state: 'failed', originalText: pending.originalText,
          failureMessage: result.failureMessage || '润色失败', retryRef: normalized,
        },
      }
    }
  
  async sendGroupSourceTextWithAiPolish(
      sourceRef: string,
      chatSessionUid: string,
      originalText: string,
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      options: { agentAuthored?: boolean; recordDurationMillis?: number; captureContext?: ArkmeRecordCaptureContext; contentPayload?: Record<string, unknown>; signal?: AbortSignal } = {},
    ): Promise<ArkmeSourceSendResult> {
      let config: ArkmeAiPolishConfigSnapshot
      try {
        config = await this.queryGroupAiPolishConfig(chatSessionUid, session, options.signal)
      } catch {
        return await this.chat.sendChatSourceTextRaw(
          sourceRef, chatSessionUid, originalText, recordUid, relationUid, session, undefined, options.contentPayload, options.signal, options,
        )
      }
      if (!config.enabled || config.activeRuleUid === '') {
        return await this.chat.sendChatSourceTextRaw(
          sourceRef, chatSessionUid, originalText, recordUid, relationUid, session, undefined, options.contentPayload, options.signal, options,
        )
      }
      const taskUid = randomUUID()
      let polished: ArkmeAiPolishTextResult
      try {
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/ai-polish/text/polish',
          {
            task_uid: taskUid,
            chat_session_uid: chatSessionUid,
            attempt: 1,
            original_text: originalText,
            extra: { input_source: 'dsh_plugin', content_kind: 'plain_text' },
          },
          session,
          options.signal,
        )
        polished = this.aiPolishTextResult(data)
      } catch (error) {
        const sent = await this.chat.sendChatSourceTextRaw(
          sourceRef, chatSessionUid, originalText, recordUid, relationUid, session, undefined, options.contentPayload, options.signal, options,
        )
        return this.withFailedAiPolishRetry(
          sent, sourceRef, chatSessionUid, relationUid, recordUid, originalText, 1, session.userId,
          safeFailureMessage(error),
        )
      }
      if (polished.state === 1 && polished.action === 1 && polished.polishedText !== '') {
        const activeRule = config.rules.find(rule => rule.ruleUid === polished.ruleUid)
        const sent = await this.chat.sendChatSourceTextRaw(
          sourceRef,
          chatSessionUid,
          originalText,
          recordUid,
          relationUid,
          session,
          {
            revision_uid: polished.revisionUid,
            attempt_uid: polished.taskUid || taskUid,
            original_text: originalText,
            polished_text: polished.polishedText,
            rule_uid: polished.ruleUid,
            rule_name: activeRule?.name ?? config.activeRuleName,
            model: polished.modelVersion,
            prompt: polished.promptVersion,
            ...(Object.keys(polished.extra).length === 0 ? {} : { extra: polished.extra }),
          },
          options.contentPayload,
          options.signal,
          options,
        )
        return {
          ...sent,
          aiPolish: { state: 'polished', originalText, polishedText: polished.polishedText },
        }
      }
      const sent = await this.chat.sendChatSourceTextRaw(
        sourceRef, chatSessionUid, originalText, recordUid, relationUid, session, undefined, options.contentPayload, options.signal, options,
      )
      if (polished.action === 2) {
        return { ...sent, aiPolish: { state: 'kept_original', originalText } }
      }
      return this.withFailedAiPolishRetry(
        sent, sourceRef, chatSessionUid, relationUid, recordUid, originalText,
        Math.max(1, polished.attempt), session.userId, polished.failureMessage || '润色失败',
      )
    }
  
  private withFailedAiPolishRetry(
      sent: ArkmeSourceSendResult,
      sourceRef: string,
      chatSessionUid: string,
      relationUid: string,
      recordUid: string,
      originalText: string,
      attempt: number,
      userId: number,
      failureMessage: string,
    ): ArkmeSourceSendResult {
      this.cleanupAiPolishState()
      const retryRef = `arkme-ai-polish-retry-v1.${randomUUID()}`
      this.aiPolishRetries.set(retryRef, {
        userId, sourceRef, chatSessionUid, relationUid, recordUid, originalText, attempt,
        expiresAtMillis: Date.now() + 30 * 60_000,
      })
      return {
        ...sent,
        aiPolish: { state: 'failed', originalText, failureMessage, retryRef },
      }
    }
  
  timelineAiPolish(
      record: Record<string, unknown>,
      payload: Record<string, unknown>,
    ): ArkmeTimelineItem['aiPolish'] | undefined {
      const preview = objectValue(
        payload.ai_polish_preview ?? payload.aiPolishPreview
        ?? record.ai_polish_preview ?? record.aiPolishPreview,
      )
      const originalText = stringValue(preview.original_text ?? preview.originalText)
      const polishedText = stringValue(preview.polished_text ?? preview.polishedText)
      const hasPolish = booleanValue(
        payload.has_polish ?? payload.hasPolish ?? record.has_polish ?? record.hasPolish,
      ) || (originalText !== '' && polishedText !== '')
      if (!hasPolish || originalText === '' || polishedText === '') return undefined
      return { state: 'polished', originalText, polishedText }
    }
  
  async queryGroupAiPolishConfig(
      chatSessionUid: string,
      session: ArkmeSessionCredentials,
      signal?: AbortSignal,
      fresh = false,
    ): Promise<ArkmeAiPolishConfigSnapshot> {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/settings/query',
        { chat_session_uid: chatSessionUid },
        session,
        signal,
        fresh ? { lane: 'interactive-read' } : {
          lane: 'background-read',
          key: `ai-polish:settings:${chatSessionUid}`,
          cacheMs: 15_000,
          failureCooldownMs: 5_000,
        },
      )
      const config = objectValue(data.config ?? data.setting ?? data.settings ?? data)
      const activeRuleUid = stringValue(config.active_rule_uid).trim()
      const rules = listValue(data.rules).map(raw => objectValue(raw)).map(rule => {
        const extra = objectValue(rule.extra)
        return {
          ruleUid: stringValue(rule.rule_uid).trim(),
          name: stringValue(rule.name).trim() || '未命名规则',
          ruleText: stringValue(rule.rule_text).trim(),
          ruleVersion: numberValue(rule.rule_version),
          threadMessages: aiPolishThreadMessages(extra.rule_thread_messages),
        }
      }).filter(rule => rule.ruleUid !== '' && rule.ruleText !== '')
      return {
        enabled: booleanValue(config.enabled ?? config.is_enabled),
        canManage: booleanValue(data.can_manage),
        viewerRole: numberValue(data.viewer_role),
        activeRuleUid,
        activeRuleName: rules.find(rule => rule.ruleUid === activeRuleUid)?.name ?? '',
        updatedAtMillis: numberValue(config.update_at),
        rules,
      }
    }
  
  groupAiPolishSnapshot(
      sourceRef: string,
      groupName: string,
      config: ArkmeAiPolishConfigSnapshot,
    ): ArkmeGroupAiPolishSnapshot {
      return {
        sourceRef,
        groupName,
        enabled: config.enabled,
        canManage: config.canManage,
        viewerRole: config.viewerRole,
        activeRuleName: config.activeRuleName,
        rules: config.rules.map(rule => ({
          ruleRef: rule.ruleUid,
          name: rule.name,
          ruleText: rule.ruleText,
          isActive: rule.ruleUid === config.activeRuleUid,
          ...(rule.threadMessages.length === 0 ? {} : { threadMessages: rule.threadMessages }),
        })),
        updatedAtMillis: config.updatedAtMillis,
      }
    }
  
  async queryGroupAiPolishNotices(
      chatSessionUid: string,
      session: ArkmeSessionCredentials,
      signal?: AbortSignal,
    ): Promise<ArkmeGroupAiPolishNotice[]> {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/notices/query',
        { chat_session_uid: chatSessionUid, limit: 100 },
        session,
        signal,
        {
          lane: 'background-read',
          key: `ai-polish:notices:${chatSessionUid}`,
          cacheMs: 15_000,
          failureCooldownMs: 5_000,
        },
      )
      return listValue(data.notices).map(raw => objectValue(raw)).map(notice => {
        const kind = numberValue(notice.notice_kind)
        const rule = stringValue(notice.rule_name).trim() || stringValue(notice.rule_text).trim()
        const actor = compactAiPolishActorLabel(notice.actor_display_name_snapshot)
        return {
          noticeUid: stringValue(notice.notice_uid).trim(),
          sourceKey: stringValue(notice.source_key).trim(),
          message: kind === 1
            ? actor === '' ? `AI润色已开启：${rule}` : `${actor}开启了 AI 润色：${rule}`
            : kind === 2
              ? actor === '' ? `AI润色规则已修改：${rule}` : `${actor}修改了 AI 润色规则：${rule}`
              : '',
          createdAtMillis: numberValue(notice.created_at),
          status: numberValue(notice.status),
        }
      }).filter(notice => notice.noticeUid !== '' && notice.message !== '' && notice.createdAtMillis > 0
        && (notice.status === 0 || notice.status === 1))
        .map(({ status: _status, ...notice }) => notice)
    }
  
  private async resolveUniqueGroupByName(
      groupName: string,
      signal?: AbortSignal,
    ): Promise<ArkmeSourceItem> {
      const normalized = groupName.trim()
      if (normalized === '') throw new ArkmePluginError('group-name-required', '请提供准确的群名称', false)
      const matches = new Map<string, ArkmeSourceItem>()
      let cursor: string | undefined
      for (let page = 0; page < 20; page += 1) {
        const result = await this.source.listSources('root', {
          limit: 50,
          ...(cursor === undefined ? {} : { cursor }),
          ...(signal === undefined ? {} : { signal }),
        })
        for (const item of result.items) {
          if (item.kind === 'group_chat' && item.displayName.trim() === normalized) matches.set(item.sourceRef, item)
        }
        if (!result.hasMore || result.nextCursor === undefined) break
        cursor = result.nextCursor
      }
      if (matches.size === 0) {
        throw new ArkmePluginError('group-name-not-found', `没有找到名称为“${normalized}”的群聊，请核对完整群名`, false, 404)
      }
      if (matches.size > 1) {
        throw new ArkmePluginError('group-name-ambiguous', `找到 ${String(matches.size)} 个同名群“${normalized}”，请先在插件界面打开目标群后设置`, false, 409)
      }
      return [...matches.values()][0]!
    }
  
  private requireAiPolishConfirmation(
      confirmationRef: string,
      userId: number,
      action: 'enable' | 'disable',
    ): ArkmePendingAiPolishConfirmation {
      this.cleanupAiPolishState()
      const normalized = confirmationRef.trim()
      const pending = this.aiPolishConfirmations.get(normalized)
      if (pending === undefined || pending.userId !== userId || pending.action !== action
        || pending.expiresAtMillis <= Date.now()) {
        this.aiPolishConfirmations.delete(normalized)
        throw new ArkmePluginError('group-ai-polish-confirmation-invalid', '确认已失效，请重新生成或读取一次设置', false, 410)
      }
      return pending
    }
  
  private cleanupAiPolishState(): void {
      const now = Date.now()
      for (const [key, value] of this.aiPolishConfirmations) {
        if (value.expiresAtMillis <= now) this.aiPolishConfirmations.delete(key)
      }
      for (const [key, value] of this.aiPolishRetries) {
        if (value.expiresAtMillis <= now) this.aiPolishRetries.delete(key)
      }
    }
  
  private aiPolishTextResult(data: Record<string, unknown>): ArkmeAiPolishTextResult {
      return {
        taskUid: stringValue(data.task_uid).trim(),
        attempt: numberValue(data.attempt),
        state: numberValue(data.state),
        action: numberValue(data.action),
        polishedText: stringValue(data.polished_text),
        recordUid: stringValue(data.record_uid ?? data.recordUid).trim(),
        revisionUid: stringValue(data.revision_uid ?? data.revisionUid).trim(),
        ruleUid: stringValue(data.rule_uid).trim(),
        modelVersion: stringValue(data.model_version).trim(),
        promptVersion: stringValue(data.prompt_version).trim(),
        failureMessage: stringValue(data.failure_message).trim(),
        extra: objectValue(data.extra),
      }
    }
}
