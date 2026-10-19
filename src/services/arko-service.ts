import { join } from 'node:path'
import { homedir } from 'node:os'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { GeneratedArtifacts } from '../generated-artifacts.js'
import { consumeArkoExport } from '../arko-history-export.js'
import type { ArkmeArkoHistoryQuery, ArkmeArkoSearchQuery, ArkmeArkoMessagePage, ArkmeArkoSearchPage, ArkmeArkoContextQuery, ArkmeArkoContextWindow, ArkmeArkoExport } from '../arko-history-contract.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryItem,
  ArkmeArkoHistoryPage,
  ArkmeArkoModelCatalog,
  ArkmeArkoModelOption,
  ArkmeArkoProfile,
  ArkmeArkoRunProjection,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
  ArkmeTimelineItem,
} from '../types.js'
import { ProfileService } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, clippedText, joinUrl, objectValue, stringValue } from './service.js'
import { MessageActionService } from './message-action-service.js'
import { arkoImageInputFromWire, arkoImageInputError, ARKO_IMAGE_MIME_TYPES } from '../arko-image-contract.js'
import type { ArkmeContentBlock, ArkmeUploadedAsset } from '../types.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import { ArkoLocalMarks } from './arko-local-marks.js'

export interface ArkoImagePorts {
  read(fileRef: string): Promise<{ file: ArkmeLocalFile }>
  upload(fileRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeUploadedAsset[]>
  project(raw: unknown, userId: number): ArkmeContentBlock[]
}

interface CacheEntry<T> { value: T; expiresAtMillis: number }

const ARKO_AGENT_DIRECT_SESSION_TYPE = 2
const ARKO_DEFAULT_SESSION_NAME = 'Arko'
const ARKO_COMPLETED_STATUS = 'completed'
const ARKO_STREAM_TIMEOUT_STATUS = 'stream_timeout'
const ARKO_HISTORY_PAGE_LIMIT = 50
const ARKO_MODEL_ROUTE_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/
const ARKO_RUN_STATUSES = new Set([
  'queued', 'running', 'waiting_user', 'waiting_tool', 'completed', 'partial',
  'failed', 'cancelled', 'expired',
])
const ARKO_PROFILE_DISPLAY_NAME_CACHE_TTL_MS = 10 * 60_000

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text === '' ? undefined : text
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  const record = objectValue(value)
  return Object.keys(record).length === 0 ? undefined : record
}

function normalizedAgentDisplayName(displayName: string | undefined): string | undefined {
  const normalized = displayName?.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  if (normalized === undefined || normalized === '') return undefined
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64).trimEnd()
}

function agentSourceLabel(displayName: string): string {
  const normalized = normalizedAgentDisplayName(displayName) ?? 'Agent'
  return `${normalized}代发`
}

function joinUrlWithQuery(baseUrl: string, path: string, query: Record<string, string | number>): string {
  const url = new URL(joinUrl(baseUrl, path))
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  return url.toString()
}

function arkoProfileFromData(data: Record<string, unknown>): ArkmeArkoProfile {
  const displayName = stringValue(data.display_name).trim()
  const version = numberValue(data.version)
  if (displayName === '' || !Number.isSafeInteger(version) || version < 0) {
    throw new ArkmePluginError('arko-profile-contract-invalid', 'Arko 资料响应不完整', true, 502)
  }
  return { displayName, version }
}

function arkoModelRouteKey(value: unknown): string {
  const routeKey = stringValue(value)
  if (routeKey.length > 128 || routeKey.trim() !== routeKey || !ARKO_MODEL_ROUTE_PATTERN.test(routeKey)) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  return routeKey
}

function arkoModelOptionFromData(value: unknown): ArkmeArkoModelOption {
  const data = objectValue(value)
  const routeKey = arkoModelRouteKey(data.route_key)
  const displayName = stringValue(data.display_name)
  const provider = stringValue(data.provider)
  const description = stringValue(data.description)
  if (displayName === '' || displayName.trim() !== displayName
    || provider === '' || provider.trim() !== provider
    || description.trim() !== description || routeKey.split('/', 1)[0] !== provider) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  const imageInput = arkoImageInputFromWire(data.image_input)
  return {
    routeKey,
    displayName,
    provider,
    description,
    costDescription: stringValue(data.cost_description),
    recommended: booleanValue(data.recommended),
    selected: booleanValue(data.selected),
    ...(imageInput === undefined ? {} : { imageInput }),
  }
}

function arkoModelCatalogFromData(data: Record<string, unknown>): ArkmeArkoModelCatalog {
  const defaultRouteKey = arkoModelRouteKey(data.default_route_key)
  const effectiveRouteKey = arkoModelRouteKey(data.effective_route_key)
  const selectionSource = stringValue(data.selection_source)
  const options = listValue(data.items).map(arkoModelOptionFromData)
  const routeKeys = new Set(options.map(option => option.routeKey))
  const selected = options.filter(option => option.selected)
  if ((selectionSource !== 'default' && selectionSource !== 'personal' && selectionSource !== 'unavailable')
    || options.length === 0 || options.length > 256 || routeKeys.size !== options.length
    || !routeKeys.has(defaultRouteKey)
    || (selectionSource === 'unavailable'
      ? routeKeys.has(effectiveRouteKey) || selected.length !== 0
      : !routeKeys.has(effectiveRouteKey) || selected.length !== 1 || selected[0]?.routeKey !== effectiveRouteKey)) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  return { defaultRouteKey, effectiveRouteKey, selectionSource, options }
}

function parsedJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim() === '') return objectValue(value)
  try {
    return objectValue(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function arkoHistoryItemFromData(value: unknown): ArkmeArkoHistoryItem | undefined {
  const data = objectValue(value)
  const messageId = numberValue(data.id ?? data.msg_id ?? data.msgId)
  const sessionId = numberValue(data.session_id ?? data.sessionId)
  const roleCode = numberValue(data.role ?? data.sender_role ?? data.senderRole)
  if (!Number.isSafeInteger(messageId) || messageId <= 0
    || !Number.isSafeInteger(sessionId) || sessionId <= 0
    || (roleCode !== 2 && roleCode !== 3)) return undefined
  const extra = parsedJsonRecord(data.extra ?? data.metadata ?? data.meta)
  const extraData = parsedJsonRecord(extra.data)
  const activityAt = [
    data.send_at, data.sendAt, extraData.send_at, extraData.sendAt,
    data.created_at_ms, data.created_at, data.create_at, data.createdAt, data.createAt,
    extraData.create_at, extraData.createAt, extra.create_at, extra.createAt,
    extraData.update_at, extraData.updateAt, data.updated_at, data.updatedAt,
  ].map(numberValue).find(candidate => candidate > 0) ?? 0
  const runUid = optionalString(extra.agent_run_uid)
  const runStatus = optionalString(extra.agent_run_status)
  const retryable = optionalBooleanValue(extra.agent_run_retryable)
  const errorCode = optionalString(extra.agent_run_error_code)
  const retryOfRunUid = optionalString(extra.retry_of_run_uid)
  const entryRecordUid = optionalString(extra.entry_record_uid ?? extraData.entry_record_uid)
  return {
    messageId,
    sessionId,
    role: roleCode === 2 ? 'user' : 'assistant',
    text: stringValue(data.content ?? data.text_content ?? data.textContent),
    reasoning: stringValue(data.reason_content ?? data.reason_text ?? data.reasonText),
    createdAtMillis: activityAt === data.created_at_ms ? activityAt : activityAt > 0 && activityAt < 100_000_000_000 ? activityAt * 1000 : activityAt,
    status: numberValue(data.status ?? data.msg_status),
    ...(runUid === undefined ? {} : { runUid }),
    ...(runStatus === undefined ? {} : { runStatus }),
    ...(retryable === undefined ? {} : { retryable }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(retryOfRunUid === undefined ? {} : { retryOfRunUid }),
    ...(entryRecordUid === undefined ? {} : { entryRecordUid }),
    createdRecordUids: arkoCreatedRecordUids(data.created_record_uids ?? data.createdRecordUids),
  }
}

function arkoRunProjectionFromData(data: Record<string, unknown>): ArkmeArkoRunProjection | undefined {
  const runUid = stringValue(data.agent_run_uid ?? data.run_uid).trim()
  const status = stringValue(data.agent_run_status ?? data.status).trim()
  if (runUid === '' || status === '') return undefined
  const errorCode = stringValue(data.agent_run_error_code ?? data.error_code).trim()
  const retryOfRunUid = stringValue(data.retry_of_run_uid).trim()
  const clientAction = optionalRecord(data.agent_client_action ?? data.client_action)
  return {
    runUid,
    status,
    retryable: booleanValue(data.agent_run_retryable ?? data.retryable),
    ...(errorCode === '' ? {} : { errorCode }),
    ...(retryOfRunUid === '' ? {} : { retryOfRunUid }),
    ...(clientAction === undefined ? {} : { clientAction }),
  }
}

function arkoCreatedRecordUids(value: unknown): string[] {
  return listValue(value).map(item => stringValue(item).trim()).filter(item => item !== '')
}

function arkoStreamFrame(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    return optionalRecord(parsed)
  } catch {
    return undefined
  }
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return 'Arkme请求失败'
}

export class ArkoService {
  private readonly historyCodec: EncryptedReferenceCodec
  private readonly generated: GeneratedArtifacts
  readonly localMarks: ArkoLocalMarks
  private readonly arkoProfileDisplayNameCache = new Map<number, { displayName: string; expiresAtMillis: number }>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly messageActions?: MessageActionService,
    private readonly images?: ArkoImagePorts,
  ) {
    this.localMarks = new ArkoLocalMarks(runtime)
    this.historyCodec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), () => new ArkmePluginError('arko-message-unavailable', '消息已不可查看，请重新搜索', false, 404))
    this.generated = new GeneratedArtifacts(join(runtime.config.fileStateDirectory ?? join(homedir(), '.arkme'), 'generated-downloads'),
      () => runtime.stateStore.uniqueCode(), async () => (await runtime.requireSession()).userId)
  }

  dispose(): void {
    this.arkoProfileDisplayNameCache.clear()
  }

  async arkoProfile(signal?: AbortSignal): Promise<ArkmeArkoProfile> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/profile/query',
      {},
      session,
      signal,
    )
    const profile = arkoProfileFromData(data)
    this.cacheArkoProfileDisplayName(session.userId, profile)
    return profile
  }

  async arkoEnsureSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    const session = await this.runtime.requireSession()
    const latest = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/latest-session',
      { type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
    )
    const latestSessionId = numberValue(latest.id)
    if (Number.isSafeInteger(latestSessionId) && latestSessionId > 0) {
      return {
        sessionId: latestSessionId,
        created: false,
        name: stringValue(latest.name).trim() || ARKO_DEFAULT_SESSION_NAME,
      }
    }
    return await this.arkoCreateSession(signal)
  }

  async arkoCreateSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    const session = await this.runtime.requireSession()
    const created = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/new-session',
      { name: ARKO_DEFAULT_SESSION_NAME, type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
    )
    const createdSessionId = numberValue(created.session_id)
    if (!Number.isSafeInteger(createdSessionId) || createdSessionId <= 0) {
      throw new ArkmePluginError('arko-session-contract-invalid', 'Arko 会话响应不完整', true, 502)
    }
    return { sessionId: createdSessionId, created: true, name: ARKO_DEFAULT_SESSION_NAME }
  }

  async arkoModelCatalog(signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/model/list',
      {},
      session,
      signal,
    )
    return arkoModelCatalogFromData(data)
  }

  async arkoActivateModel(routeKey: string, signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    const normalized = routeKey.trim()
    if (normalized !== routeKey || normalized.length > 128 || !ARKO_MODEL_ROUTE_PATTERN.test(normalized)) {
      throw new ArkmePluginError('arko-model-route-invalid', '请选择有效的 Arko 模型', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/model/activate',
      { route_key: normalized },
      session,
      signal,
    )
    return arkoModelCatalogFromData(data)
  }

  async arkoHistoryPage(
    limit = ARKO_HISTORY_PAGE_LIMIT,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoHistoryPage> {
    const normalizedLimit = Math.min(ARKO_HISTORY_PAGE_LIMIT, Math.max(1, Math.trunc(limit)))
    const normalizedOffset = Math.max(0, Math.trunc(offset))
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/message-list',
      { limit: normalizedLimit, offset: normalizedOffset, session_type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
      { lane: 'interactive-read', bypassCache: true, cacheMs: 0 },
    )
    const rawItems = listValue(data.message_ls)
    const items = await this.projectHistory(rawItems, session)
    const hasMore = rawItems.length === normalizedLimit
    return {
      items,
      hasMore,
      ...(hasMore ? { nextOffset: normalizedOffset + rawItems.length } : {}),
    }
  }

  private historyFacts(rawItems: unknown[], session: ArkmeSessionCredentials, strict = false, maxItems = 50): ArkmeArkoHistoryItem[] {
    if (strict && rawItems.length > maxItems) throw new ArkmePluginError('arko-history-contract-invalid', '历史窗口过大', true, 502)
    const projectedItems = rawItems
      .map(raw => {
        const item = arkoHistoryItemFromData(raw)
        if (item === undefined) {
          if (strict) throw new ArkmePluginError('arko-history-contract-invalid', '历史消息无效', true, 502)
          return undefined
        }
        if (strict) {
          const wire = objectValue(raw)
          if (![1, 2].includes(numberValue(wire.source_type)) || ![1, 2, 3].includes(numberValue(wire.type)) || ![1, 2, 3, 5].includes(item.status)
            || !Number.isSafeInteger(wire.created_at_ms) || !Number.isSafeInteger(wire.order_at_ms)) throw new ArkmePluginError('arko-history-contract-invalid', '历史消息字段不完整', true, 502)
          item.reasoning = ''
          item.sourceType = numberValue(wire.source_type); item.messageType = numberValue(wire.type); item.orderAtMillis = numberValue(wire.order_at_ms)
        }
        const attachments = listValue(objectValue(raw).attachments).map(objectValue).filter(attachment =>
          stringValue(attachment.file_asset_uid) !== ''
          && ARKO_IMAGE_MIME_TYPES.some(mime => mime === attachment.mime_type))
        if (attachments.length === 0) return item
        const blocks = this.images?.project({ media_display_items: attachments.map(attachment => ({ ...attachment, file_kind: 1 })) }, session.userId) ?? []
        // Keep an explicit placeholder if the original is deleted or cannot be resolved.
        const contentBlocks = attachments.map((attachment, sortOrder): ArkmeContentBlock =>
          blocks.find(block => block.fileAssetUid === attachment.file_asset_uid) ?? {
            kind: 'image', mediaRef: '', fileAssetUid: stringValue(attachment.file_asset_uid),
            fileName: stringValue(attachment.file_name) || '图片', mimeType: stringValue(attachment.mime_type),
            size: numberValue(attachment.size), sortOrder,
          })
        return { ...item, contentBlocks }
      })
      .filter((item): item is ArkmeArkoHistoryItem => item !== undefined)
    return projectedItems
  }

  private async projectHistory(rawItems: unknown[], session: ArkmeSessionCredentials, strict = false): Promise<ArkmeArkoHistoryItem[]> {
    const projectedItems = this.historyFacts(rawItems, session, strict)
    const conversationRefs = new Map<number, Promise<string>>()
    return await Promise.all(projectedItems.map(async original => {
          const localMarkRef = await this.localMarks.project(original, session.userId)
          const item = { ...original, ...(localMarkRef ? { localMarkRef } : {}),
            ...(strict ? { messageRef: await this.messageRef(session.userId, original.sessionId, original.messageId) } : {}) }
          const action = await this.messageActions?.agentHistoryItem(item, session.userId)
          if (action?.messageActionRef === undefined) return item
          let itemConversationRef = conversationRefs.get(item.sessionId)
          if (itemConversationRef === undefined) {
            itemConversationRef = this.messageActions!.agentConversationRef(session.userId, item.sessionId)
            conversationRefs.set(item.sessionId, itemConversationRef)
          }
          return { ...item, ...action, messageActionConversationRef: await itemConversationRef }
        }))

  }

  private historyBody(query: ArkmeArkoHistoryQuery): Record<string, unknown> {
    const limit = query.limit ?? 50, direction = query.direction ?? 'desc'
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !['asc', 'desc'].includes(direction)
      || (query.role !== undefined && query.role !== 'user' && query.role !== 'assistant')
      || (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 4096))
      || [query.startAtMillis, query.endAtMillis].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
      throw new ArkmePluginError('arko-history-invalid', '历史查询参数无效', false, 400)
    }
    return { limit, direction, ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.role ? { role: query.role === 'user' ? 2 : 3 } : {}),
      ...(query.startAtMillis === undefined ? {} : { start_at: query.startAtMillis }), ...(query.endAtMillis === undefined ? {} : { end_at: query.endAtMillis }) }
  }
  private async messageRef(userId: number, sessionId: number, messageId: number): Promise<string> {
    return this.historyCodec.seal('arkme-arko-message-v1', { userId, sessionId, messageId, expiresAtMillis: Date.now() + 24 * 60 * 60_000 })
  }
  private historyContinuation(data: Record<string, unknown>) {
    const hasMore = data.has_more === true, nextCursor = optionalString(data.next_cursor)
    if (typeof data.has_more !== 'boolean' || (hasMore && !nextCursor) || !Number.isSafeInteger(data.scanned) || numberValue(data.scanned) < 0 || numberValue(data.scanned) > 500 || data.consistency !== 'live') {
      throw new ArkmePluginError('arko-history-contract-invalid', '历史分页响应不完整', true, 502)
    }
    return { hasMore, ...(hasMore ? { nextCursor: nextCursor! } : {}), scanned: numberValue(data.scanned), consistency: 'live' as const }
  }
  async arkoMessages(query: ArkmeArkoHistoryQuery = {}, signal?: AbortSignal): Promise<ArkmeArkoMessagePage> {
    return this.runtime.runCompositeOwnerRead('arko.messages', { ...query }, scoped => this.readMessages(query, scoped), signal, query.cursor ? 'background-read' : 'interactive-read')
  }
  async arkoSearch(query: ArkmeArkoSearchQuery, signal?: AbortSignal): Promise<ArkmeArkoSearchPage> {
    return this.runtime.runCompositeOwnerRead('arko.search', { ...query }, scoped => this.readSearch(query, scoped), signal, query.cursor ? 'background-read' : 'interactive-read')
  }
  async arkoContext(query: ArkmeArkoContextQuery, signal?: AbortSignal): Promise<ArkmeArkoContextWindow> {
    return this.runtime.runCompositeOwnerRead('arko.context', { ...query }, scoped => this.readContext(query, scoped), signal)
  }
  private async readMessages(query: ArkmeArkoHistoryQuery = {}, signal?: AbortSignal): Promise<ArkmeArkoMessagePage> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/query', this.historyBody(query), session, signal,
      { lane: query.cursor ? 'background-read' : 'interactive-read', bypassCache: true, cacheMs: 0 })
    const items = await this.projectHistory(listValue(data.items), session, true)
    return { items, ...this.historyContinuation(data), ...(optionalString(data.before_cursor) ? { beforeCursor: stringValue(data.before_cursor) } : {}), ...(optionalString(data.after_cursor) ? { afterCursor: stringValue(data.after_cursor) } : {}) }
  }
  private async readSearch(query: ArkmeArkoSearchQuery, signal?: AbortSignal): Promise<ArkmeArkoSearchPage> {
    if (typeof query.keyword !== 'string' || query.keyword.trim() === '' || [...query.keyword.trim()].length > 200) throw new ArkmePluginError('arko-history-invalid', '请输入不超过 200 字的搜索词', false, 400)
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/search', { ...this.historyBody(query), keyword: query.keyword.trim() }, session, signal,
      { lane: query.cursor ? 'background-read' : 'interactive-read', bypassCache: true, cacheMs: 0 })
    if (!Array.isArray(data.items) || data.items.length > 50) throw new ArkmePluginError('arko-history-contract-invalid', '搜索响应无效', true, 502)
    const items = await Promise.all(data.items.map(async raw => {
      const item = objectValue(raw)
      if (!Number.isSafeInteger(item.id) || numberValue(item.id) < 1 || !Number.isSafeInteger(item.session_id) || numberValue(item.session_id) < 1
        || ![2, 3].includes(numberValue(item.role)) || ![1, 2, 3, 5].includes(numberValue(item.status)) || typeof item.snippet !== 'string' || item.snippet.length > 1024 || typeof item.created_at_ms !== 'number' || typeof item.order_at_ms !== 'number') throw new ArkmePluginError('arko-history-contract-invalid', '搜索响应无效', true, 502)
      return { messageRef: await this.messageRef(session.userId, numberValue(item.session_id), numberValue(item.id)), role: item.role === 2 ? 'user' as const : 'assistant' as const,
        snippet: item.snippet, createdAtMillis: item.created_at_ms, orderAtMillis: item.order_at_ms, status: numberValue(item.status) }
    }))
    return { items, ...this.historyContinuation(data) }
  }
  private async readContext(query: ArkmeArkoContextQuery, signal?: AbortSignal): Promise<ArkmeArkoContextWindow> {
    const before = query.before ?? 20, after = query.after ?? 20
    if (!Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 0 || before + after > 49 || typeof query.messageRef !== 'string') throw new ArkmePluginError('arko-history-invalid', '上下文窗口参数无效', false, 400)
    const session = await this.runtime.requireSession(), ref = await this.historyCodec.open('arkme-arko-message-v1', query.messageRef)
    if (ref.userId !== session.userId || numberValue(ref.expiresAtMillis) <= Date.now() || !Number.isSafeInteger(ref.messageId) || !Number.isSafeInteger(ref.sessionId)) throw new ArkmePluginError('arko-message-unavailable', '消息已不可查看，请重新搜索', false, 404)
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/context', { session_id: ref.sessionId, message_id: ref.messageId, before, after }, session, signal,
      { lane: 'interactive-read', bypassCache: true, cacheMs: 0 })
    const items = await this.projectHistory(listValue(data.items), session, true)
    if (typeof data.has_before !== 'boolean' || typeof data.has_after !== 'boolean'
      || (data.has_before && !optionalString(data.before_cursor)) || (data.has_after && !optionalString(data.after_cursor))
      || !items.some(item => item.sessionId === ref.sessionId && item.messageId === ref.messageId)) throw new ArkmePluginError('arko-history-contract-invalid', '上下文响应不完整', true, 502)
    const anchor = items.find(item => item.sessionId === ref.sessionId && item.messageId === ref.messageId)!
    anchor.messageRef = query.messageRef
    return { items, anchorMessageRef: query.messageRef, hasBefore: data.has_before, hasAfter: data.has_after,
      ...(data.has_before ? { beforeCursor: stringValue(data.before_cursor) } : {}), ...(data.has_after ? { afterCursor: stringValue(data.after_cursor) } : {}) }
  }
  async arkoExport(signal?: AbortSignal): Promise<ArkmeArkoExport> {
    const session = await this.runtime.requireSession()
    const name = this.arkoProfileDisplayNameCache.get(session.userId)?.displayName ?? 'Arko'
    const fileName = `${name.replace(/[\\/:*?"<>|\r\n]/g, '_')}-对话-${new Date().toISOString().slice(0, 10)}.md`
    const result = await this.generated.create(session.userId, fileName,
      write => this.runtime.intelligentExportStream(session, (body, streamSignal) => consumeArkoExport(body, streamSignal, write, name), signal), signal)
    return { ...result.file, count: result.result }
  }
  async actionMessages(anchors: readonly { sessionId: number; messageId: number }[], userId: number, signal?: AbortSignal): Promise<ArkmeArkoHistoryItem[]> {
    return this.runtime.runCompositeOwnerRead('arko.action-messages', { anchors }, async scoped => {
      const session = await this.runtime.requireSession()
      if (session.userId !== userId) throw new ArkmePluginError('arko-account-changed', '账号已切换，请重新读取', false, 409)
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/details',
        { anchors: anchors.map(anchor => ({ session_id: anchor.sessionId, message_id: anchor.messageId })) }, session, scoped,
        { lane: 'interactive-read', bypassCache: true, cacheMs: 0 })
      if (!Array.isArray(data.items)) throw new ArkmePluginError('arko-history-contract-invalid', '消息读取不完整', true, 502)
      return this.historyFacts(data.items, session, true, 100)
    }, signal)
  }
  async readGeneratedFile(ref: string) { return this.generated.read(ref) }

  async arkoAsk(
    text: string,
    options: {
      sessionId?: number
      clientTurnUid?: string
      waitMillis?: number
      modelRouteKey?: string
      replyToRunUid?: string
      replyToAssistantMsgId?: number
      imageFileRefs?: readonly string[]
      expectedUserId?: number
      signal?: AbortSignal
    } = {},
  ): Promise<ArkmeArkoAskResult> {
    const session = await this.runtime.requireSession()
    if (options.expectedUserId !== undefined && options.expectedUserId !== session.userId) {
      throw new ArkmePluginError('arko-account-changed', '账号已切换，本次发送已取消', false)
    }
    const sessionId = options.sessionId ?? (await this.arkoEnsureSession(options.signal)).sessionId
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const replyToRunUid = options.replyToRunUid?.trim() ?? ''
    const replyToAssistantMsgId = options.replyToAssistantMsgId
    const hasContinuationRun = replyToRunUid !== ''
    const hasContinuationMessage = replyToAssistantMsgId !== undefined
      && Number.isSafeInteger(replyToAssistantMsgId) && replyToAssistantMsgId > 0
    if (hasContinuationRun !== hasContinuationMessage) {
      throw new ArkmePluginError('arko-continuation-invalid', 'Arko 续接参数不完整', false)
    }
    let modelRouteKey = options.modelRouteKey?.trim() ?? ''
    if (hasContinuationRun && modelRouteKey !== '') {
      throw new ArkmePluginError('arko-continuation-model-invalid', '继续 Arko 任务时不能切换模型', false)
    }
    if (!hasContinuationRun && modelRouteKey === '') {
      try {
        const catalog = await this.arkoModelCatalog(options.signal)
        modelRouteKey = catalog.effectiveRouteKey
      } catch {
        // Model selection is an enhancement. The server still resolves the saved selection from its published catalog.
      }
    }
    if (modelRouteKey !== '' && (modelRouteKey.length > 128 || !ARKO_MODEL_ROUTE_PATTERN.test(modelRouteKey))) {
      throw new ArkmePluginError('arko-model-route-invalid', '请选择有效的 Arko 模型', false)
    }
    const imageFileRefs = options.imageFileRefs ?? []
    let attachments: ArkmeUploadedAsset[] = []
    if (imageFileRefs.length > 0) {
      if (hasContinuationRun) throw new ArkmePluginError('arko-image-continuation-unavailable', '当前任务续接尚未接通图片，请清除上下文后再发送；图片已保留', false)
      if (imageFileRefs.length > 9 || new Set(imageFileRefs).size !== imageFileRefs.length
        || imageFileRefs.some(ref => !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(ref))) {
        throw new ArkmePluginError('arko-image-invalid', '请选择有效的图片附件', false)
      }
      // A cached UI capability must not allow an obsolete backend to accept text only.
      const catalog = await this.arkoModelCatalog(options.signal)
      const capability = catalog.options.find(option => option.routeKey === modelRouteKey)?.imageInput
      if (capability === undefined || this.images === undefined) {
        throw new ArkmePluginError('arko-images-unavailable', arkoImageInputError(undefined, [{ mimeType: '', size: 0, fileName: '' }])!, false)
      }
      const files = await Promise.all(imageFileRefs.map(async ref => (await this.images!.read(ref)).file))
      const invalid = arkoImageInputError(capability, files)
      if (invalid !== undefined) throw new ArkmePluginError('arko-image-invalid', invalid, false)
      attachments = await this.images.upload(imageFileRefs, options.signal)
      if (attachments.length !== imageFileRefs.length) throw new ArkmePluginError('arko-image-upload-incomplete', '图片上传未完成，请重试', true)
      if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('arko-account-changed', '账号已切换，本次发送已取消', false)
    }
    const body: Record<string, unknown> = {
      model: 2,
      session_id: sessionId,
      content: text,
      extra: '{}',
      ...(timezone === undefined || timezone.trim() === '' ? {} : { tz_inna: timezone.trim() }),
      ...(options.clientTurnUid === undefined || options.clientTurnUid.trim() === ''
        ? {}
        : { client_turn_uid: options.clientTurnUid.trim() }),
      ...(hasContinuationRun ? {
        reply_to_run_uid: replyToRunUid,
        reply_to_assistant_msg_id: replyToAssistantMsgId,
      } : {}),
      client_capabilities: ['dsh.arko.v1', ...(attachments.length ? ['dsh.arko.images.v1'] : [])],
      ...(attachments.length === 0 ? {} : {
        attachments_protocol_version: 1,
        attachments: attachments.map(asset => ({ type: 'image', file_asset_uid: asset.fileAssetUid,
          file_name: asset.fileName, mime_type: asset.mimeType, size: asset.size })),
      }),
    }
    if (modelRouteKey !== '') body.model_route_key = modelRouteKey
    const accepted = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/new-msg-v2',
      body,
      session,
      options.signal,
    )
    const userMsgId = numberValue(accepted.user_msg_id)
    const assistantMsgId = numberValue(accepted.assistant_msg_id)
    const acceptedSessionId = numberValue(accepted.session_id) || sessionId
    if (!Number.isSafeInteger(acceptedSessionId) || acceptedSessionId <= 0
      || !Number.isSafeInteger(userMsgId) || userMsgId <= 0
      || !Number.isSafeInteger(assistantMsgId) || assistantMsgId <= 0) {
      throw new ArkmePluginError('arko-ask-contract-invalid', 'Arko 消息响应不完整', true, 502)
    }
    const runUid = stringValue(accepted.run_uid).trim()
    if (runUid === '') {
      throw new ArkmePluginError('arko-ask-contract-invalid', 'Arko 消息响应缺少运行标识', true, 502)
    }
    let events: { events: string[]; timedOut: boolean }
    try {
      events = await this.authenticatedIntelligentSseEvents(
        '/api/v1/qa/stream-v2',
        { session_id: acceptedSessionId, user_msg_id: userMsgId, assistant_msg_id: assistantMsgId },
        options.waitMillis ?? 25_000,
        session,
        options.signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arko-stream-cancelled') throw error
      // The run is already durable once new-msg-v2 succeeds. Preserve its identity so
      // callers recover through the status endpoint instead of submitting it again.
      events = { events: [], timedOut: true }
    }
    return this.projectArkoStreamEvents({
      sessionId: acceptedSessionId,
      userMsgId,
      assistantMsgId,
      runUid,
      initialStatus: 'queued',
      events: events.events,
      timedOut: events.timedOut,
    })
  }

  async arkoRunStatus(sessionId: number, runUid: string, signal?: AbortSignal): Promise<ArkmeArkoRunStatus> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/runs/status',
      { session_id: sessionId, run_uid: runUid.trim() },
      session,
      signal,
    )
    const status = stringValue(data.status).trim()
    const normalizedRunUid = stringValue(data.run_uid).trim() || runUid.trim()
    const sequence = numberValue(data.sequence)
    const surfaceAssistantMsgId = numberValue(data.surface_assistant_msg_id)
    const clientAction = optionalRecord(data.client_action)
    if (normalizedRunUid !== runUid.trim() || !ARKO_RUN_STATUSES.has(status)
      || !Number.isSafeInteger(sequence) || sequence < 0
      || !Number.isSafeInteger(surfaceAssistantMsgId) || surfaceAssistantMsgId <= 0) {
      throw new ArkmePluginError('arko-run-status-contract-invalid', 'Arko 运行状态响应不完整', true, 502)
    }
    return {
      sessionId,
      runUid: normalizedRunUid,
      status,
      sequence,
      surfaceAssistantMsgId,
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.error_code).trim() === '' ? {} : { errorCode: stringValue(data.error_code).trim() }),
      ...(stringValue(data.retry_of_run_uid).trim() === '' ? {} : { retryOfRunUid: stringValue(data.retry_of_run_uid).trim() }),
      ...(clientAction === undefined ? {} : { clientAction }),
    }
  }

  async arkoCancel(
    sessionId: number,
    assistantMsgId: number,
    runUid: string,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoCancelResult> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/runs/cancel',
      { session_id: sessionId, assistant_msg_id: assistantMsgId, run_uid: runUid.trim() },
      session,
      signal,
    )
    const status = stringValue(data.status).trim()
    const normalizedRunUid = stringValue(data.run_uid).trim() || runUid.trim()
    if (normalizedRunUid === '' || status === '') {
      throw new ArkmePluginError('arko-cancel-contract-invalid', 'Arko 取消响应不完整', true, 502)
    }
    return { sessionId, assistantMsgId, runUid: normalizedRunUid, status }
  }

  private arkoProfileDisplayName(profile: ArkmeArkoProfile): string {
    const displayName = normalizedAgentDisplayName(profile.displayName)
    return profile.version === 0 && displayName === 'Agent' ? 'Arko' : displayName ?? 'Agent'
  }

  private cacheArkoProfileDisplayName(userId: number, profile: ArkmeArkoProfile): string {
    const displayName = this.arkoProfileDisplayName(profile)
    this.arkoProfileDisplayNameCache.set(userId, {
      displayName,
      expiresAtMillis: Date.now() + ARKO_PROFILE_DISPLAY_NAME_CACHE_TTL_MS,
    })
    return displayName
  }

  private cachedArkoProfileDisplayName(userId: number): string | undefined {
    const cached = this.arkoProfileDisplayNameCache.get(userId)
    if (cached === undefined) return undefined
    if (cached.expiresAtMillis <= Date.now()) {
      this.arkoProfileDisplayNameCache.delete(userId)
      return undefined
    }
    return cached.displayName
  }

  currentUserAgentSourceFallback(
    userId: number,
    source: ArkmeTimelineItem['agentSource'] | undefined,
  ): ArkmeTimelineItem['agentSource'] | undefined {
    if (source === undefined) return undefined
    if (source.displayName !== 'Agent') return source
    const displayName = this.cachedArkoProfileDisplayName(userId)
    if (displayName === undefined) return source
    return { kind: 'agent', displayName, label: agentSourceLabel(displayName) }
  }

  async agentSourceDisplayName(session: ArkmeSessionCredentials): Promise<string> {
    const cached = this.cachedArkoProfileDisplayName(session.userId)
    if (cached !== undefined) return cached
    try {
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
        '/api/v1/agent/profile/query',
        {},
        session,
      )
      const profile = arkoProfileFromData(data)
      return this.cacheArkoProfileDisplayName(session.userId, profile)
    } catch {
      return 'Agent'
    }
  }

  private async authenticatedIntelligentSseEvents(
    path: string,
    query: Record<string, string | number>,
    waitMillis: number,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{ events: string[]; timedOut: boolean }> {
    let session = initialSession ?? await this.runtime.requireSession()
    try {
      return await this.readIntelligentSseEvents(path, query, session.accessToken, waitMillis, signal)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.runtime.refreshAccessToken(session)
      return await this.readIntelligentSseEvents(path, query, session.accessToken, waitMillis, signal)
    }
  }

  private async readIntelligentSseEvents(
    path: string,
    query: Record<string, string | number>,
    bearer: string | undefined,
    waitMillis: number,
    signal?: AbortSignal,
  ): Promise<{ events: string[]; timedOut: boolean }> {
    const events: string[] = []
    const dataLines: string[] = []
    const decoder = new TextDecoder()
    let buffer = ''
    let timedOut = false
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1, waitMillis))
    const flushEvent = (): void => {
      if (dataLines.length === 0) return
      events.push(dataLines.join('\n'))
      dataLines.length = 0
    }
    const pushText = (chunk: string): void => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (line === '') flushEvent()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        newlineIndex = buffer.indexOf('\n')
      }
    }
    try {
      const response = await this.runtime.fetchImpl(joinUrlWithQuery(this.runtime.config.intelligentBaseUrl, path, query), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Accept-Language': 'zh-CN',
          Usersource: '3',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new ArkmePluginError(
          `auth-http-${response.status}`,
          'Arkme 登录凭据已失效',
          false,
          response.status,
        )
      }
      if (!response.ok) {
        throw new ArkmePluginError('arkme-http-error', `Arko 流返回 HTTP ${response.status}`, true, 502)
      }
      if (response.body === null) {
        throw new ArkmePluginError('arko-stream-empty', 'Arko 流响应为空', true, 502)
      }
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        pushText(decoder.decode(next.value, { stream: true }))
      }
      pushText(decoder.decode())
      flushEvent()
      return { events, timedOut: false }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError' && timedOut && signal?.aborted !== true) {
        flushEvent()
        return { events, timedOut: true }
      }
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('arko-stream-cancelled', 'Arko 流已取消', false, 499, { cause: error })
      }
      throw new ArkmePluginError('arko-stream-network-error', '无法连接 Arko 流', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private projectArkoStreamEvents(input: {
    sessionId: number
    userMsgId: number
    assistantMsgId: number
    runUid?: string
    initialStatus: string
    events: string[]
    timedOut: boolean
  }): ArkmeArkoAskResult {
    let text = ''
    let reasoning = ''
    let status = input.initialStatus
    let terminal = false
    let errorMessage: string | undefined
    let profile: ArkmeArkoProfile | undefined
    let run: ArkmeArkoRunProjection | undefined
    let createdRecordUids: string[] = []
    for (const rawEvent of input.events) {
      const frame = arkoStreamFrame(rawEvent)
      if (frame === undefined) {
        text += rawEvent
        continue
      }
      const mid = objectValue(frame.mid)
      if (Object.keys(mid).length > 0) {
        text += stringValue(mid.content)
        reasoning += stringValue(mid.reason_content)
      }
      const tail = objectValue(frame.tail)
      if (Object.keys(tail).length > 0) {
        terminal = true
        const tailRun = arkoRunProjectionFromData(tail)
        if (tailRun !== undefined) {
          run = tailRun
          status = tailRun.status
        } else if (booleanValue(tail.error) || stringValue(tail.status).trim() === 'error') {
          status = 'failed'
        } else {
          status = ARKO_COMPLETED_STATUS
        }
        createdRecordUids = arkoCreatedRecordUids(tail.created_record_uids)
        const nextProfile = optionalRecord(tail.agent_profile)
        if (nextProfile !== undefined) profile = arkoProfileFromData(nextProfile)
        if (booleanValue(tail.error) || stringValue(tail.status).trim() === 'error') {
          errorMessage = stringValue(tail.error_message).trim() || 'Arko 执行失败'
        }
      }
      const type = stringValue(frame.type ?? frame.event).trim()
      const payload = optionalRecord(frame.payload) ?? frame
      if (type === 'message.delta') text += stringValue(payload.text ?? payload.content)
      else if (type === 'message.final') {
        const finalText = stringValue(payload.text ?? payload.content)
        if (finalText !== '') text = finalText
      } else if (type === 'thinking.delta') {
        reasoning += stringValue(payload.text ?? payload.content)
      } else if (type === 'done') {
        terminal = true
        const doneRun = arkoRunProjectionFromData(payload)
        if (doneRun !== undefined) {
          run = doneRun
          status = doneRun.status
        } else status = ARKO_COMPLETED_STATUS
        createdRecordUids = arkoCreatedRecordUids(payload.created_record_uids)
        const nextProfile = optionalRecord(payload.agent_profile)
        if (nextProfile !== undefined) profile = arkoProfileFromData(nextProfile)
      } else if (type === 'error') {
        terminal = true
        status = 'failed'
        errorMessage = stringValue(payload.message ?? payload.errorMessage).trim() || 'Arko 执行失败'
      }
    }
    if (!terminal && input.timedOut) status = ARKO_STREAM_TIMEOUT_STATUS
    return {
      sessionId: input.sessionId,
      userMsgId: input.userMsgId,
      assistantMsgId: input.assistantMsgId,
      ...(input.runUid === undefined ? {} : { runUid: input.runUid }),
      text,
      reasoning,
      status,
      terminal,
      timedOut: input.timedOut,
      ...(errorMessage === undefined ? {} : { errorMessage }),
      createdRecordUids,
      ...(profile === undefined ? {} : { profile }),
      ...(run === undefined ? {} : { run }),
    }
  }
}
