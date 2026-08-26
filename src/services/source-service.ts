import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeGroupAvatarPresentation,
  ArkmeSelfRecordItem,
  ArkmeSelfSummary,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeTimelineItem,
  ArkmeTopicBatchCreateResult,
  ArkmeTopicBatchItemDisposition,
  ArkmeTopicCreateResult,
} from '../types.js'
import { ProfileService, type ArkmePublicProfile } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { arkmeMentionMetadataMentionsViewer } from '../mention-metadata.js'

export interface ArkmeSourceRefPayload {
  version: 1
  userId: number
  kind: ArkmeSourceKind
  ownerRef: string
  displayName: string
  botGroupTarget?: ArkmeGroupBotBindingTarget
}

export interface ArkmeGroupBotBindingTarget {
  rmSubjectId?: number
  subjectUid?: string
}

export interface ArkmeGroupAvatarSnapshotProjection {
  memberCount: number
  strategy: string
  computedAtMillis: number
  memberIds: number[]
}

interface CacheEntry<T> { value: T; expiresAtMillis: number }

export interface ArkmeSourceRecordReader {
  summary(): Promise<ArkmeSelfSummary>
  recordItem(raw: unknown): ArkmeSelfRecordItem | undefined
  isDSHAgentInput?(raw: unknown): boolean
}

const SOURCE_LIST_CACHE_TTL_MS = 30_000
const SOURCE_LIST_CACHE_MAX_ENTRIES = 200
const GROUP_AVATAR_CACHE_TTL_MS = 5 * 60_000
const GROUP_AVATAR_NEGATIVE_CACHE_TTL_MS = 60_000
const PRIVATE_REMARK_PAGE_LIMIT = 50
const PRIVATE_REMARK_MAX_PAGES = 20

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function integerIdentifierValue(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value.trim())) return 0
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function integerLikeValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function sanitizeGroupBotBindingTarget(value: unknown): ArkmeGroupBotBindingTarget | undefined {
  const raw = objectValue(value)
  const rmSubjectId = integerLikeValue(raw.rmSubjectId ?? raw.rm_subject_id)
  const subjectUid = stringValue(raw.subjectUid ?? raw.subject_uid).trim()
  const target: ArkmeGroupBotBindingTarget = {
    ...(rmSubjectId > 0 ? { rmSubjectId } : {}),
    ...(subjectUid === '' ? {} : { subjectUid }),
  }
  return Object.keys(target).length === 0 ? undefined : target
}

export function arkmeGroupBotBindingTargetFromBundle(
  bundle: Record<string, unknown>,
): ArkmeGroupBotBindingTarget | undefined {
  const chatSession = objectValue(bundle.session)
  const rmSubjectId = integerLikeValue(
    bundle.rm_subject_id ?? bundle.rmSubjectId
    ?? bundle.subject_id ?? bundle.subjectId
    ?? bundle.shared_topic_id ?? bundle.sharedTopicId
    ?? chatSession.rm_subject_id ?? chatSession.rmSubjectId
    ?? chatSession.subject_id ?? chatSession.subjectId
    ?? chatSession.shared_topic_id ?? chatSession.sharedTopicId,
  )
  const subjectUid = stringValue(
    bundle.subject_uid ?? bundle.subjectUid
    ?? chatSession.subject_uid ?? chatSession.subjectUid,
  ).trim()
  if (rmSubjectId > 0) return { rmSubjectId }
  if (subjectUid !== '') return { subjectUid }
  return undefined
}

export function arkmeGroupBotBindingBody(
  source: Pick<ArkmeSourceRefPayload, 'ownerRef' | 'botGroupTarget'>,
): Record<string, unknown> {
  const target = source.botGroupTarget
  if (target?.rmSubjectId !== undefined && target.rmSubjectId > 0) return { rm_subject_id: target.rmSubjectId }
  if (target?.subjectUid !== undefined && target.subjectUid.trim() !== '') return { subject_uid: target.subjectUid.trim() }
  return { subject_uid: source.ownerRef }
}

function backendBooleanValue(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return undefined
}

function chatUnreadMentionState(unread: Record<string, unknown>): boolean | undefined {
  const explicit = backendBooleanValue(unread.has_unread_attention ?? unread.hasUnreadAttention)
  if (explicit !== undefined) return explicit
  const rawCount = unread.unread_attention_count ?? unread.unreadAttentionCount
  if (rawCount === undefined || rawCount === null) return undefined
  return integerLikeValue(rawCount) > 0
}

function requiredTopicHierarchyParents(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) {
    throw new ArkmePluginError('topic-hierarchy-contract-invalid', '主题层级响应不完整', true, 502)
  }
  const parents = new Map<string, string>()
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ArkmePluginError('topic-hierarchy-contract-invalid', '主题层级响应条目无效', true, 502)
    }
    const relation = raw as Record<string, unknown>
    if (relation.rel_kind !== 1 || relation.status !== 1) {
      throw new ArkmePluginError('topic-hierarchy-contract-invalid', '主题层级响应状态无效', true, 502)
    }
    const parentTopicUid = typeof relation.parent_topic_uid === 'string' ? relation.parent_topic_uid.trim() : ''
    const childTopicUid = typeof relation.child_topic_uid === 'string' ? relation.child_topic_uid.trim() : ''
    if (parentTopicUid === '' || childTopicUid === '' || parentTopicUid === childTopicUid) {
      throw new ArkmePluginError('topic-hierarchy-contract-invalid', '主题层级响应身份无效', true, 502)
    }
    const existingParent = parents.get(childTopicUid)
    if (existingParent !== undefined) {
      throw new ArkmePluginError('topic-hierarchy-contract-invalid', '主题层级响应存在重复子主题', true, 502)
    }
    parents.set(childTopicUid, parentTopicUid)
  }
  return parents
}

function topicBatchUid(clientMutationId: string, parentTopicUid: string | undefined, index: number): string {
  const placementScope = parentTopicUid === undefined ? 'root' : `parent:${parentTopicUid}`
  const bytes = createHash('sha256').update(`dsh-arkme:topic-batch:${clientMutationId}:${placementScope}:${String(index)}`).digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function topicDisplayTitle(title: string, topicUid: string): string {
  const normalized = title.trim()
  if (normalized !== '') return normalized
  const stableLabel = createHash('sha256').update(topicUid).digest('hex').slice(0, 8)
  return `未命名主题 · ${stableLabel}`
}

function isTopicBatchDisposition(value: string): value is ArkmeTopicBatchItemDisposition {
  return ['accepted', 'idempotent', 'failed_before_create', 'failed_cleaned', 'outcome_unknown'].includes(value)
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function isSourceKind(value: unknown): value is ArkmeSourceKind {
  return value === 'default_category' || value === 'send_to_self' || value === 'topic'
    || value === 'private_chat' || value === 'group_chat'
}

function chatMessageDnd(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = value as Record<string, unknown>
  return numberValue(policy.mute_state) === 2 || numberValue(policy.notify_state) === 2
}

function textPreview(raw: Record<string, unknown>): string {
  const direct = stringValue(raw.text_content ?? raw.title ?? raw.summary).trim()
  if (direct !== '') return direct.slice(0, 300)
  const content = objectValue(raw.content_payload ?? raw.payload)
  const nested = stringValue(content.text_content ?? content.title ?? content.summary).trim()
  if (nested !== '') return nested.slice(0, 300)
  if (objectValue(content.voice).duration !== undefined) return '[语音]'
  if (listValue(content.media_refs).length > 0 || listValue(raw.media_display_items).length > 0) return '[图片]'
  if (Object.keys(objectValue(content.structured_anchor)).length > 0) return '[卡片]'
  return ''
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

function cloneSourceList(value: ArkmeSourceList): ArkmeSourceList {
  return {
    ...value,
    items: value.items.map(item => ({
      ...item,
      ...(item.avatarRefs === undefined ? {} : { avatarRefs: [...item.avatarRefs] }),
    })),
  }
}

export class SourceService {
  private readonly chatSourceCache = new Map<string, ArkmeSourceItem>()
  private readonly sourceListCache = new Map<string, CacheEntry<ArkmeSourceList>>()
  private readonly sourceListInFlight = new Map<string, Promise<ArkmeSourceList>>()
  private readonly groupAvatarSnapshotCache = new Map<string, CacheEntry<ArkmeGroupAvatarSnapshotProjection | null>>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly recordReader: ArkmeSourceRecordReader,
  ) {}

  cachedChatSource(userId: number, chatSessionUid: string): ArkmeSourceItem | undefined {
    return this.chatSourceCache.get(`${String(userId)}:${chatSessionUid}`)
  }

  cachedChatSourceByKey(cacheKey: string): ArkmeSourceItem | undefined {
    return this.chatSourceCache.get(cacheKey)
  }

  /** Resolve a remote-search owner into the same viewer-bound source used by the conversation UI. */
  async searchTargetSource(
    sourceKind: number,
    sourceUid: string,
    displayNameInput: string,
    signal?: AbortSignal,
  ): Promise<ArkmeSourceItem | undefined> {
    const session = await this.runtime.requireSession()
    const displayName = displayNameInput.replace(/\s+/g, ' ').trim()
    if (sourceKind === 1) {
      return await this.sourceItem({
        version: 1,
        userId: session.userId,
        kind: 'default_category',
        ownerRef: 'uncategorized',
        displayName: displayName || '默认分类',
      })
    }
    const ownerRef = sourceUid.trim()
    if (ownerRef === '') return undefined
    if (sourceKind === 2) {
      return await this.sourceItem({
        version: 1,
        userId: session.userId,
        kind: 'topic',
        ownerRef,
        displayName: displayName || '未命名主题',
      })
    }
    if (sourceKind !== 3) return undefined
    const cacheKey = `${String(session.userId)}:${ownerRef}`
    const cached = this.chatSourceCache.get(cacheKey)
    if (cached !== undefined) return cached

    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await this.listSources('root', {
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      })
      const resolved = this.chatSourceCache.get(cacheKey)
      if (resolved !== undefined) return resolved
      if (!page.hasMore || page.nextCursor === undefined) return undefined
      cursor = page.nextCursor
    }
    return undefined
  }

  setChatSource(userId: number, chatSessionUid: string, source: ArkmeSourceItem): void {
    this.chatSourceCache.set(`${String(userId)}:${chatSessionUid}`, source)
  }

  setChatSourceByKey(cacheKey: string, source: ArkmeSourceItem): void {
    this.chatSourceCache.set(cacheKey, source)
  }

  /**
   * Resolve the current viewer's private-chat labels for the supplied people.
   * The result is deliberately keyed only inside the Provider; callers project
   * the resolved label into their own viewer-bound response.
   */
  async privateDisplayNamesByUserIds(
    userIds: readonly number[],
    options: { signal?: AbortSignal } = {},
  ): Promise<Map<number, string>> {
    const session = await this.runtime.requireSession()
    const remaining = new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0 && userId !== session.userId))
    const displayNames = new Map<number, string>()
    let pageCursor: Record<string, unknown> | undefined

    // The chat directory is paged newest-first. Bound the scan so an unusually
    // large history cannot make rendering a World page unbounded.
    for (let page = 0; page < 20 && remaining.size > 0; page += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list',
        { limit: 50, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) },
        session,
        options.signal,
        { lane: 'background-read', key: `world-author-labels:${pageCursor === undefined ? 'first' : String(page)}` },
      )
      for (const raw of listValue(data.items)) {
        const bundle = objectValue(raw)
        const chatSession = objectValue(bundle.session)
        const sessionKind = numberValue(chatSession.session_kind)
        if (sessionKind !== 1 && sessionKind !== 3) continue
        const targetUserId = numberValue(objectValue(bundle.private_counterpart).user_id)
        if (!remaining.has(targetUserId)) continue
        const supplement = objectValue(bundle.private_supplement)
        const counterpart = objectValue(bundle.private_counterpart)
        const displayName = stringValue(supplement.remark).trim()
          || stringValue(supplement.counterpart_name_snapshot).trim()
          || stringValue(counterpart.display_name_snapshot).trim()
          || stringValue(supplement.pending_name).trim()
          || stringValue(counterpart.visible_phone).trim()
        if (displayName !== '') displayNames.set(targetUserId, displayName)
        remaining.delete(targetUserId)
      }
      if (data.has_more !== true) break
      const next = objectValue(data.next_page_cursor)
      if (Object.keys(next).length === 0) break
      pageCursor = next
    }
    return displayNames
  }

  /**
   * Resolve only viewer-owned contact remarks for the supplied people.
   * This deliberately does not fall back to a private nickname or snapshot:
   * callers must keep those identities in their own domain-specific order.
   */
  async privateRemarksByUserIds(
    userIds: readonly number[],
    options: { signal?: AbortSignal } = {},
  ): Promise<Map<number, string>> {
    const session = await this.runtime.requireSession()
    const remaining = new Set(userIds.filter(
      userId => Number.isSafeInteger(userId) && userId > 0 && userId !== session.userId,
    ))
    const remarks = new Map<number, string>()
    let offset = 0

    for (let page = 0; page < PRIVATE_REMARK_MAX_PAGES && remaining.size > 0; page += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/contacts/list',
        { limit: PRIVATE_REMARK_PAGE_LIMIT, offset },
        session,
        options.signal,
        {
          lane: 'background-read',
          key: `private-remarks:${String(offset)}`,
          failureCooldownMs: 2_000,
        },
      )
      const rawItems = listValue(data.items)
      for (const value of rawItems) {
        const raw = objectValue(value)
        const targetUserId = integerIdentifierValue(raw.user_id)
        if (!remaining.has(targetUserId)) continue
        const remark = stringValue(raw.remark).trim()
        if (remark !== '') {
          remarks.set(targetUserId, remark)
          remaining.delete(targetUserId)
        }
      }
      if (data.has_more !== true) break
      if (rawItems.length === 0) {
        throw new ArkmePluginError(
          'private-remark-pagination-invalid', '联系人备注分页响应不完整', true, 502,
        )
      }
      offset += rawItems.length
    }

    let pageCursor: Record<string, unknown> | undefined
    for (let page = 0; page < PRIVATE_REMARK_MAX_PAGES && remaining.size > 0; page += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list',
        {
          limit: PRIVATE_REMARK_PAGE_LIMIT,
          ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }),
        },
        session,
        options.signal,
        {
          lane: 'background-read',
          key: `private-remarks:direct:${pageCursor === undefined ? 'first' : String(page)}`,
          failureCooldownMs: 2_000,
        },
      )
      for (const value of listValue(data.items)) {
        const bundle = objectValue(value)
        const chatSession = objectValue(bundle.session)
        const sessionKind = numberValue(chatSession.session_kind)
        if (sessionKind !== 1 && sessionKind !== 3) continue
        const targetUserId = integerIdentifierValue(objectValue(bundle.private_counterpart).user_id)
        if (!remaining.has(targetUserId)) continue
        const remark = stringValue(objectValue(bundle.private_supplement).remark).trim()
        if (remark !== '') remarks.set(targetUserId, remark)
        remaining.delete(targetUserId)
      }
      if (data.has_more !== true) break
      const next = objectValue(data.next_page_cursor)
      if (Object.keys(next).length === 0) break
      pageCursor = next
    }
    return remarks
  }

  invalidateGroupAvatar(userId: number, chatSessionUid: string): void {
    this.groupAvatarSnapshotCache.delete(`${String(userId)}:${chatSessionUid}`)
  }

  dispose(): void {
    this.chatSourceCache.clear()
    this.sourceListCache.clear()
    this.sourceListInFlight.clear()
    this.groupAvatarSnapshotCache.clear()
  }

  async createTopic(titleInput: string, parentSourceRef?: string): Promise<ArkmeTopicCreateResult> {
    const title = titleInput.trim()
    if (title === '' || Array.from(title).length > 100) {
      throw new ArkmePluginError('topic-title-invalid', '主题名称不能为空或超过 100 个字符', false)
    }

    // Preserve the existing top-level create contract. Batch creation has
    // stricter same-placement semantics and must not silently change this
    // established single-topic UI operation.
    if (parentSourceRef === undefined) {
      const session = await this.runtime.requireSession()
      const createdAtMillis = Date.now()
      let created: Record<string, unknown>
      try {
        created = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/create',
          { title, show_in_home: true, privacy_state: 1, extra: { source: 'dsh-arkme' } },
          session,
        )
      } finally {
        this.invalidateSourceListCache(session.userId, 'send_to_self')
      }
      const topicUid = stringValue(created.topic_uid).trim()
      if (topicUid === '' || numberValue(created.status) !== 1) {
        throw new ArkmePluginError('topic-create-contract-invalid', '主题创建响应不完整', true, 502)
      }
      return {
        source: {
          sourceRef: await this.sealSourceRef(session.userId, 'topic', topicUid, title),
          kind: 'topic',
          displayName: title,
          activeAtMillis: createdAtMillis,
          unreadCount: 0,
          recordCount: 0,
        },
      }
    }

    const result = await this.createTopicsBatch([title], randomUUID(), parentSourceRef)
    const item = result.items[0]
    if (item?.succeeded === true && item.source !== undefined) return { source: item.source }
    if (item?.disposition === 'failed_cleaned') {
      throw new ArkmePluginError('topic-hierarchy-bind-failed', '未能创建子主题，已自动清理，请重试', true, 409)
    }
    if (item?.disposition === 'failed_before_create') {
      throw new ArkmePluginError('topic-create-failed', item.errorMessage ?? '主题未创建', false, 409)
    }
    throw new ArkmePluginError(
      'topic-create-outcome-unknown',
      '主题创建终态暂时无法确认，请刷新主题列表后再决定是否重试',
      false,
      409,
    )
  }

  async createTopicsBatch(
    titlesInput: readonly string[],
    clientMutationId: string,
    parentSourceRef?: string,
    signal?: AbortSignal,
  ): Promise<ArkmeTopicBatchCreateResult> {
    const titles = titlesInput.map(title => title.trim())
    if (titles.length === 0 || titles.length > 20 || titles.some(title => title === '' || Array.from(title).length > 100)) {
      throw new ArkmePluginError('topic-batch-invalid', '每批必须包含 1 到 20 个不超过 100 个字符的主题名称', false)
    }
    if (new Set(titles).size !== titles.length) {
      throw new ArkmePluginError('topic-batch-invalid', '同一批次不能包含重复主题名称', false)
    }
    const normalizedMutationId = clientMutationId.trim().toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedMutationId)) {
      throw new ArkmePluginError('topic-batch-mutation-id-invalid', '主题批量操作身份无效', false)
    }

    const session = await this.runtime.requireSession()
    let parentTopicUid: string | undefined
    if (parentSourceRef !== undefined) {
      const parent = await this.openSourceRef(parentSourceRef, session.userId)
      if (parent.kind !== 'topic') {
        throw new ArkmePluginError('topic-parent-invalid', '只能在主题下创建子主题', false)
      }
      parentTopicUid = parent.ownerRef
    }

    const requested = titles.map((title, index) => ({
      topic_uid: topicBatchUid(normalizedMutationId, parentTopicUid, index),
      title,
    }))
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        parentSourceRef === undefined ? '/api/v1/topics/batch-create' : '/api/v1/topics/children/batch-create',
        {
          ...(parentSourceRef === undefined
            ? {}
            : { parent_topic_uid: parentTopicUid }),
          items: requested,
        },
        session,
        signal,
      )
    } finally {
      this.invalidateSourceListCache(session.userId, 'send_to_self')
    }
    const rawItems = listValue(data.items)
    if (rawItems.length !== requested.length) {
      throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应条目数不完整', true, 502)
    }
    const ownerSucceededCount = data.succeeded_count
    const ownerFailedCount = data.failed_count
    if (typeof ownerSucceededCount !== 'number' || typeof ownerFailedCount !== 'number'
      || !Number.isSafeInteger(ownerSucceededCount) || !Number.isSafeInteger(ownerFailedCount)
      || ownerSucceededCount < 0 || ownerFailedCount < 0
      || ownerSucceededCount + ownerFailedCount !== requested.length) {
      throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应计数无效', true, 502)
    }

    const rawByRequestedUid = new Map<string, Record<string, unknown>>()
    for (const raw of rawItems) {
      const item = objectValue(raw)
      const requestedTopicUid = item.requested_topic_uid
      if (typeof requestedTopicUid !== 'string') {
        throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应身份无效', true, 502)
      }
      if (requestedTopicUid === '' || rawByRequestedUid.has(requestedTopicUid)) {
        throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应身份无效', true, 502)
      }
      rawByRequestedUid.set(requestedTopicUid, item)
    }

    const createdAtMillis = Date.now()
    const items = await Promise.all(requested.map(async request => {
      const raw = rawByRequestedUid.get(request.topic_uid)
      if (raw === undefined) {
        throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应缺少请求身份', true, 502)
      }
      const optionalStringFields = ['topic_uid', 'title', 'parent_topic_uid', 'error_code', 'error_message'] as const
      if (typeof raw.disposition !== 'string' || typeof raw.succeeded !== 'boolean'
        || optionalStringFields.some(field => raw[field] !== undefined && typeof raw[field] !== 'string')
        || (raw.status !== undefined && (typeof raw.status !== 'number' || !Number.isSafeInteger(raw.status)))) {
        throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应字段类型无效', true, 502)
      }
      const disposition = raw.disposition
      const succeeded = raw.succeeded
      const topicUid = stringValue(raw.topic_uid)
      const successDisposition = disposition === 'accepted' || disposition === 'idempotent'
      const responseParentTopicUid = stringValue(raw.parent_topic_uid)
      const responseTitle = stringValue(raw.title)
      const status = raw.status ?? 0
      const errorCode = stringValue(raw.error_code)
      const errorMessage = stringValue(raw.error_message)
      const emptyFact = topicUid === '' && responseTitle === '' && status === 0
      const exactActiveFact = topicUid === request.topic_uid && responseTitle === request.title && status === 1
      const exactDeletedFact = topicUid === request.topic_uid && responseTitle === request.title && status === 2
      const validFailureFact = disposition === 'failed_before_create'
        ? (emptyFact || exactActiveFact)
        : disposition === 'failed_cleaned'
          ? exactDeletedFact
          : disposition === 'outcome_unknown'
            ? (emptyFact || exactActiveFact || exactDeletedFact)
            : false
      if (
        !isTopicBatchDisposition(disposition) ||
        succeeded !== successDisposition ||
        responseParentTopicUid !== (parentTopicUid ?? '') ||
        (succeeded && (!exactActiveFact || errorCode !== '' || errorMessage !== '')) ||
        (!succeeded && (!validFailureFact || errorCode.trim() === '' || errorCode !== errorCode.trim()
          || errorMessage.trim() === '' || errorMessage !== errorMessage.trim()))
      ) {
        throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应终态无效', true, 502)
      }
      return {
        title: request.title,
        disposition,
        succeeded,
        ...(succeeded ? {
          source: {
            sourceRef: await this.sealSourceRef(session.userId, 'topic', topicUid, request.title),
            ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
            kind: 'topic' as const,
            displayName: request.title,
            activeAtMillis: createdAtMillis,
            unreadCount: 0,
            recordCount: 0,
          },
        } : {}),
        ...(errorCode === '' ? {} : { errorCode }),
        ...(errorMessage === '' ? {} : { errorMessage }),
      }
    }))
    if (items.filter(item => item.succeeded).length !== ownerSucceededCount) {
      throw new ArkmePluginError('topic-batch-contract-invalid', '主题批量创建响应计数与逐项终态不一致', true, 502)
    }
    return {
      ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
      items,
      succeededCount: ownerSucceededCount,
      failedCount: ownerFailedCount,
    }
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<ArkmeSourceList> {
    const session = await this.runtime.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const cursor = options.cursor?.trim() ?? ''
    const cacheKey = `${String(session.userId)}:${directory}:${String(limit)}:${cursor}`
    this.pruneSourceListCache()
    const cached = this.sourceListCache.get(cacheKey)
    if (options.refresh !== true && cached !== undefined && cached.expiresAtMillis > Date.now()) return cloneSourceList(cached.value)
    const existing = this.sourceListInFlight.get(cacheKey)
    if (existing !== undefined) return cloneSourceList(await existing)
    const pending = this.listSourcesUncached(session, directory, { ...options, ...(cursor === '' ? {} : { cursor }) }, limit)
    this.sourceListInFlight.set(cacheKey, pending)
    try {
      const result = await pending
      if (this.sourceListInFlight.get(cacheKey) === pending) {
        this.sourceListCache.delete(cacheKey)
        this.sourceListCache.set(cacheKey, { value: cloneSourceList(result), expiresAtMillis: Date.now() + SOURCE_LIST_CACHE_TTL_MS })
        this.pruneSourceListCache()
      }
      return cloneSourceList(result)
    } finally {
      if (this.sourceListInFlight.get(cacheKey) === pending) this.sourceListInFlight.delete(cacheKey)
    }
  }

  async listGroupSources(
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<ArkmeSourceList> {
    const session = await this.runtime.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const page = await this.listSourcesUncached(session, 'root', options, limit, 2)
    return { ...page, items: page.items.filter(item => item.kind === 'group_chat') }
  }

  async countGroupSources(signal?: AbortSignal): Promise<number> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/list', { limit: 0, session_kind: 2 }, session, signal,
      { lane: 'interactive-read', key: 'directory:groups:count', failureCooldownMs: 2_000 },
    )
    return Math.max(0, numberValue(data.total ?? data.total_count))
  }

  private async listSourcesUncached(
    session: ArkmeSessionCredentials,
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean },
    limit: number,
    sessionKind?: number,
  ): Promise<ArkmeSourceList> {
    if (directory === 'send_to_self') {
      if (options.cursor !== undefined && options.cursor.trim() !== '') {
        throw new ArkmePluginError('source-cursor-invalid', '发给自己的主题目录不支持该分页游标', false)
      }
      const [data, hierarchyData] = await Promise.all([
        this.listAllTopicDisplayItems(session, options.signal),
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/relations/list',
          {},
          session,
          options.signal,
        ).catch(error => {
          if (options.signal?.aborted === true) throw error
          return undefined
        }),
      ])
      options.signal?.throwIfAborted()
      const [summaryResult, latestRecordsResult] = await Promise.allSettled([
        this.recordReader.summary(),
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/records/uncategorized/query',
          { limit: 10 },
          session,
          options.signal,
        ),
      ])
      options.signal?.throwIfAborted()
      const cached = summaryResult.status === 'rejected' || latestRecordsResult.status === 'rejected'
        ? await this.runtime.stateStore.cachedSnapshot(session.userId).catch(() => undefined)
        : undefined
      // Source-card decoration is best-effort and must not make the directory unavailable.
      const defaultRecordCount = summaryResult.status === 'fulfilled'
        ? summaryResult.value.recordCount
        : cached?.summary?.recordCount
      const defaultLatestRecord = latestRecordsResult.status === 'fulfilled'
        ? listValue(latestRecordsResult.value.items)
          .map(raw => this.recordReader.isDSHAgentInput?.(raw) === true ? undefined : this.recordReader.recordItem(raw))
          .find(item => item !== undefined)
        : cached?.items.reduce<ArkmeSelfRecordItem | undefined>((latest, item) => (
          item.creationSource === 3
            ? latest
            : latest === undefined || item.sendAtMillis > latest.sendAtMillis ? item : latest
        ), undefined)
      const defaultLatestPreview = defaultLatestRecord === undefined
        ? ''
        : (defaultLatestRecord.textContent.trim() || defaultLatestRecord.title.trim())
      const defaultCategory: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, 'default_category', 'uncategorized', '默认分类'),
        kind: 'default_category',
        displayName: '默认分类',
        activeAtMillis: defaultLatestRecord?.sendAtMillis ?? 0,
        unreadCount: 0,
        ...(defaultLatestPreview === '' ? {} : { latestPreview: defaultLatestPreview }),
        ...(defaultRecordCount === undefined ? {} : { recordCount: defaultRecordCount }),
      }
      const topicDescriptors: Array<{
        topicUid: string
        parentTopicUid?: string
        title: string
        latestPreview: string
        latestMessageAtMillis: number
        activeAtMillis: number
        recordCount: number
      }> = []
      const seenTopicUids = new Set<string>()
      const parentTopicUidByChild = hierarchyData === undefined
        ? undefined
        : requiredTopicHierarchyParents(hierarchyData.relations)
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const core = objectValue(item.topic_core)
        const summary = objectValue(item.summary)
        const latest = objectValue(item.latest_record_core)
        const embeddedParent = objectValue(
          core.parent_topic_core ?? core.parent_topic ?? item.parent_topic_core ?? item.parent_topic,
        )
        const topicUid = typeof core.topic_uid === 'string' ? core.topic_uid.trim() : ''
        if (topicUid === '' || seenTopicUids.has(topicUid)) {
          throw new ArkmePluginError('topic-page-contract-invalid', '主题分页响应身份无效', true, 502)
        }
        if (typeof core.title !== 'string') {
          throw new ArkmePluginError('topic-page-contract-invalid', '主题分页响应字段无效', true, 502)
        }
        seenTopicUids.add(topicUid)
        const title = topicDisplayTitle(core.title, topicUid)
        const fallbackParentTopicUid = stringValue(
          core.parent_topic_uid ?? core.parent_uid ?? item.parent_topic_uid ?? item.parent_uid
          ?? embeddedParent.topic_uid ?? embeddedParent.uid,
        ).trim()
        const parentTopicUid = parentTopicUidByChild === undefined
          ? (fallbackParentTopicUid === '' || fallbackParentTopicUid === topicUid ? undefined : fallbackParentTopicUid)
          : parentTopicUidByChild.get(topicUid)
        topicDescriptors.push({
          topicUid,
          ...(parentTopicUid === undefined ? {} : { parentTopicUid }),
          title,
          latestPreview: textPreview(latest),
          latestMessageAtMillis: numberValue(latest.send_at ?? summary.latest_send_at),
          activeAtMillis: numberValue(latest.send_at ?? summary.latest_send_at ?? core.update_at),
          recordCount: numberValue(summary.record_count),
        })
      }
      const sourceRefByTopicUid = new Map<string, string>()
      for (const topic of topicDescriptors) {
        sourceRefByTopicUid.set(
          topic.topicUid,
          await this.sealSourceRef(session.userId, 'topic', topic.topicUid, topic.title),
        )
      }
      const topics: ArkmeSourceItem[] = topicDescriptors.map(topic => {
        const parentSourceRef = topic.parentTopicUid === undefined
          ? undefined
          : sourceRefByTopicUid.get(topic.parentTopicUid)
        return {
          sourceRef: sourceRefByTopicUid.get(topic.topicUid)!,
          ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
          kind: 'topic',
          displayName: topic.title,
          ...(topic.latestPreview === '' ? {} : { latestPreview: topic.latestPreview }),
          activeAtMillis: topic.activeAtMillis,
          unreadCount: 0,
          recordCount: topic.recordCount,
        }
      })
      const aggregateCandidates = [
        defaultCategory,
        ...topics.map((source, index) => ({
          ...source,
          activeAtMillis: topicDescriptors[index]?.latestMessageAtMillis ?? 0,
        })),
      ]
      const latestAggregateItem = aggregateCandidates.reduce<ArkmeSourceItem | undefined>(
        (latest, source) => latest === undefined || source.activeAtMillis > latest.activeAtMillis ? source : latest,
        undefined,
      )
      const aggregateLatestPreview = latestAggregateItem === undefined || latestAggregateItem.activeAtMillis <= 0
        ? ''
        : latestAggregateItem.latestPreview?.trim() || '非文本内容'
      const aggregateSource: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, 'send_to_self', 'all', '发给自己'),
        kind: 'send_to_self',
        displayName: '发给自己',
        ...(aggregateLatestPreview === '' ? {} : { latestPreview: aggregateLatestPreview }),
        activeAtMillis: latestAggregateItem?.activeAtMillis ?? 0,
        unreadCount: 0,
      }
      return { directory, items: [aggregateSource, defaultCategory, ...topics], hasMore: false }
    }
    if (directory !== 'root') throw new ArkmePluginError('source-directory-invalid', 'Arkme 数据源目录无效', false)
    const pageCursor = options.cursor === undefined || options.cursor.trim() === ''
      ? undefined
      : this.decodeCursor(options.cursor)
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/list',
      {
        limit,
        ...(sessionKind === undefined ? {} : { session_kind: sessionKind }),
        ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }),
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `directory:root:${sessionKind === undefined ? 'all' : String(sessionKind)}:${String(limit)}:${options.cursor?.trim() ?? ''}`,
        failureCooldownMs: 2_000,
        bypassCache: options.refresh === true,
      },
    )
    const items: ArkmeSourceItem[] = []
    const privateUserIdByIndex = new Map<number, number>()
    const groupSessionUidByIndex = new Map<number, string>()
    for (const raw of listValue(data.items)) {
      const bundle = objectValue(raw)
      const chatSession = objectValue(bundle.session)
      const counterpart = objectValue(bundle.private_counterpart)
      const supplement = objectValue(bundle.private_supplement)
      const latestPreview = objectValue(bundle.latest_preview)
      const latestRecord = objectValue(latestPreview.record)
      const latestPayload = objectValue(latestRecord.payload)
      const unread = objectValue(bundle.unread_snapshot)
      const isMuted = chatMessageDnd(bundle.current_policy) ?? false
      const uid = stringValue(chatSession.chat_session_uid).trim()
      const sessionKind = numberValue(chatSession.session_kind)
      const kind: ArkmeSourceKind | undefined = sessionKind === 2
        ? 'group_chat'
        : sessionKind === 1 || sessionKind === 3 ? 'private_chat' : undefined
      if (uid === '' || kind === undefined) continue
      const displayName = (kind === 'private_chat'
        ? stringValue(
          supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
          ?? supplement.pending_name ?? counterpart.visible_phone,
        )
        : stringValue(chatSession.title)).trim() || '未命名会话'
      const preview = textPreview(latestPayload)
      const unreadCount = Math.max(0, Math.trunc(numberValue(unread.unread_count)))
      const latestRelation = objectValue(latestPreview.relation)
      const latestSenderUserId = integerLikeValue(latestRelation.sender_user_id ?? latestRelation.senderUserId)
      const latestPreviewMentionsViewer = latestSenderUserId !== session.userId
        && arkmeMentionMetadataMentionsViewer(latestRecord, latestPayload, session.userId)
      const backendMentionState = chatUnreadMentionState(unread)
      const hasUnreadMention = kind !== 'group_chat'
        ? undefined
        : unreadCount <= 0
          ? false
          : backendMentionState === undefined && !latestPreviewMentionsViewer
            ? undefined
            : backendMentionState === true || latestPreviewMentionsViewer
      const botGroupTarget = kind === 'group_chat' ? arkmeGroupBotBindingTargetFromBundle(bundle) : undefined
      const item: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(
          session.userId,
          kind,
          uid,
          displayName,
          botGroupTarget === undefined ? {} : { botGroupTarget },
        ),
        sourceKey: await this.chatDirectorySourceKey(session.userId, uid),
        kind,
        displayName,
        ...(preview === '' ? {} : { latestPreview: preview }),
        activeAtMillis: numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        unreadCount,
        ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }),
        isMuted,
        ...((numberValue(unread.session_last_seq ?? chatSession.last_seq)) > 0
          ? { latestSequence: numberValue(unread.session_last_seq ?? chatSession.last_seq) }
          : {}),
      }
      const itemIndex = items.push(item) - 1
      this.chatSourceCache.set(`${String(session.userId)}:${uid}`, item)
      if (kind === 'private_chat') {
        const counterpartUserId = numberValue(counterpart.user_id)
        if (Number.isSafeInteger(counterpartUserId) && counterpartUserId > 0) {
          item.peerUserId = counterpartUserId
          privateUserIdByIndex.set(itemIndex, counterpartUserId)
        }
      } else {
        groupSessionUidByIndex.set(itemIndex, uid)
      }
    }
    try {
      await this.hydrateSourceAvatars(
        items, privateUserIdByIndex, groupSessionUidByIndex, session, options.signal,
      )
    } catch (error) {
      // Avatar decoration is best-effort; chat source identity and navigation remain usable.
      console.warn('dsh-arkme: Chat avatar hydration failed:', safeFailureMessage(error))
    }
    const hasMore = data.has_more === true
    const totalValue = data.total ?? data.total_count
    const total = totalValue === undefined ? undefined : Math.max(0, numberValue(totalValue))
    const nextPageCursor = objectValue(data.next_page_cursor)
    return {
      directory,
      items,
      ...(total === undefined ? {} : { total }),
      hasMore,
      ...(hasMore && Object.keys(nextPageCursor).length > 0
        ? { nextCursor: this.encodeCursor(nextPageCursor) }
        : {}),
    }
  }

  private async listAllTopicDisplayItems(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const items: unknown[] = []
    const seenCursors = new Set<string>()
    let pageCursor: Record<string, unknown> | undefined
    let offset = 0
    for (;;) {
      const page = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/display/list',
        {
          limit: 100,
          ...(pageCursor === undefined ? (offset === 0 ? {} : { offset }) : { page_cursor: pageCursor }),
        },
        session,
        signal,
      )
      if (!Array.isArray(page.items) || (page.has_more !== undefined && typeof page.has_more !== 'boolean')) {
        throw new ArkmePluginError('topic-page-contract-invalid', '主题分页响应不完整', true, 502)
      }
      items.push(...page.items)
      if (page.has_more !== true) return { items }

      const nextPageCursor = objectValue(page.next_page_cursor)
      if (Object.keys(nextPageCursor).length > 0) {
        const signature = JSON.stringify(nextPageCursor)
        if (seenCursors.has(signature)) {
          throw new ArkmePluginError('topic-page-contract-invalid', '主题分页游标没有向前推进', true, 502)
        }
        seenCursors.add(signature)
        pageCursor = nextPageCursor
        continue
      }

      const nextOffset = Math.trunc(numberValue(page.next_offset))
      if (nextOffset <= offset) {
        throw new ArkmePluginError('topic-page-contract-invalid', '主题分页偏移没有向前推进', true, 502)
      }
      offset = nextOffset
    }
  }

  invalidateSourceListCache(userId: number, directory?: ArkmeSourceDirectory): void {
    const prefix = `${String(userId)}:`
    const matches = (key: string): boolean => (
      key.startsWith(prefix)
      && (directory === undefined || key.startsWith(`${prefix}${directory}:`))
    )
    for (const key of this.sourceListCache.keys()) {
      if (matches(key)) this.sourceListCache.delete(key)
    }
    for (const key of this.sourceListInFlight.keys()) {
      if (matches(key)) this.sourceListInFlight.delete(key)
    }
  }

  private pruneSourceListCache(): void {
    const now = Date.now()
    for (const [key, cached] of this.sourceListCache) {
      if (cached.expiresAtMillis <= now) this.sourceListCache.delete(key)
    }
    while (this.sourceListCache.size > SOURCE_LIST_CACHE_MAX_ENTRIES) {
      const oldestKey = this.sourceListCache.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      this.sourceListCache.delete(oldestKey)
    }
  }

  async hydrateSourceAvatars(
    items: ArkmeSourceItem[],
    privateUserIdByIndex: ReadonlyMap<number, number>,
    groupSessionUidByIndex: ReadonlyMap<number, string>,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    const groupSnapshotsByIndex = new Map<number, ArkmeGroupAvatarSnapshotProjection>()
    const indexByGroupUid = new Map([...groupSessionUidByIndex].map(([index, uid]) => [uid, index]))
    const missingGroupUids: string[] = []
    const now = Date.now()
    for (const [uid, index] of indexByGroupUid) {
      const cacheKey = `${String(session.userId)}:${uid}`
      const cached = this.groupAvatarSnapshotCache.get(cacheKey)
      if (cached === undefined || cached.expiresAtMillis <= now) {
        if (cached !== undefined) this.groupAvatarSnapshotCache.delete(cacheKey)
        missingGroupUids.push(uid)
        continue
      }
      if (cached.value !== null && cached.value.memberIds.length > 0) {
        groupSnapshotsByIndex.set(index, {
          ...cached.value,
          memberIds: [...cached.value.memberIds],
        })
      }
    }
    for (const groupUids of chunksOf(missingGroupUids, 10)) {
      let data: Record<string, unknown>
      try {
        data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/group-avatar-snapshots',
          { chat_session_uids: groupUids },
          session,
          signal,
          {
            lane: 'background-read',
            key: `group-avatar:${[...groupUids].sort().join('|')}`,
            failureCooldownMs: 5_000,
          },
        )
      } catch (error) {
        console.warn(
          `dsh-arkme: Group avatar snapshot batch failed (${String(groupUids.length)} sessions):`,
          safeFailureMessage(error),
        )
        continue
      }
      const snapshotsByUid = new Map<string, ArkmeGroupAvatarSnapshotProjection>()
      for (const raw of listValue(data.items)) {
        const snapshot = objectValue(raw)
        const uid = stringValue(snapshot.chat_session_uid).trim()
        const index = indexByGroupUid.get(uid)
        if (index === undefined || !groupUids.includes(uid)) continue
        const memberIds = listValue(snapshot.members)
          .map(member => numberValue(objectValue(member).user_id))
          .filter(userId => Number.isSafeInteger(userId) && userId > 0)
          .slice(0, 5)
        const projection = {
          memberCount: Math.max(0, Math.trunc(numberValue(snapshot.member_count))),
          strategy: stringValue(snapshot.strategy).trim(),
          computedAtMillis: numberValue(snapshot.computed_at),
          memberIds,
        }
        snapshotsByUid.set(uid, projection)
        if (memberIds.length > 0) groupSnapshotsByIndex.set(index, projection)
      }
      for (const uid of groupUids) {
        const snapshot = snapshotsByUid.get(uid) ?? null
        this.groupAvatarSnapshotCache.set(`${String(session.userId)}:${uid}`, {
          value: snapshot,
          expiresAtMillis: Date.now() + (snapshot === null
            ? GROUP_AVATAR_NEGATIVE_CACHE_TTL_MS
            : GROUP_AVATAR_CACHE_TTL_MS),
        })
      }
    }

    const targetUserIds = new Set<number>(privateUserIdByIndex.values())
    for (const snapshot of groupSnapshotsByIndex.values()) {
      for (const userId of snapshot.memberIds) targetUserIds.add(userId)
    }
    const profiles = await this.profile.publicProfileSummariesByUserIds([...targetUserIds], session, signal).catch(() => new Map())
    for (const [index, targetUserId] of privateUserIdByIndex) {
      if (profiles.get(targetUserId)?.avatarUrl === undefined || items[index] === undefined) continue
      items[index].avatarRef = await this.profile.sealProfileImageRef(session.userId, targetUserId)
    }
    for (const [index, snapshot] of groupSnapshotsByIndex) {
      if (items[index] === undefined) continue
      const presentation = await this.groupAvatarPresentation(snapshot, profiles, session.userId)
      items[index].groupAvatar = presentation
      items[index].avatarRefs = presentation.slots.flatMap(slot => slot.avatarRef === undefined ? [] : [slot.avatarRef])
    }
  }

  async groupAvatarPresentation(
    snapshot: ArkmeGroupAvatarSnapshotProjection,
    profiles: ReadonlyMap<number, ArkmePublicProfile>,
    viewerUserId: number,
  ): Promise<ArkmeGroupAvatarPresentation> {
    return {
      memberCount: snapshot.memberCount,
      strategy: snapshot.strategy,
      computedAtMillis: snapshot.computedAtMillis,
      slots: await Promise.all(snapshot.memberIds.slice(0, 5).map(async userId => {
        const profile = profiles.get(userId)
        if (profile?.avatarUrl !== undefined) {
          return { avatarRef: await this.profile.sealProfileImageRef(viewerUserId, userId) }
        }
        return { fallback: profile?.avatarFallback ?? { kind: 'default' } }
      })),
    }
  }

  async chatDirectorySourceKey(userId: number, chatSessionUid: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`chat-source-key-v1:${String(userId)}:${chatSessionUid.trim()}`)
      .digest('base64url')
    return `arkme-chat-source-v1.${digest}`
  }

  async sealSourceRef(
    userId: number,
    kind: ArkmeSourceKind,
    ownerRef: string,
    displayName: string,
    options: { botGroupTarget?: ArkmeGroupBotBindingTarget } = {},
  ): Promise<string> {
    const botGroupTarget = kind === 'group_chat' ? sanitizeGroupBotBindingTarget(options.botGroupTarget) : undefined
    const payload = encodeOpaqueJson({
      version: 1,
      userId,
      kind,
      ownerRef,
      displayName,
      ...(botGroupTarget === undefined ? {} : { botGroupTarget }),
    } satisfies ArkmeSourceRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-source-v1.${payload}.${signature}`
  }

  async openSourceRef(sourceRef: string, expectedUserId: number): Promise<ArkmeSourceRefPayload> {
    const parts = sourceRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-source-v1') {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = objectValue(decodeOpaqueJson(payload))
    } catch (error) {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false, 400, { cause: error })
    }
    const kind = parsed.kind
    const result: ArkmeSourceRefPayload = {
      version: 1,
      userId: numberValue(parsed.userId),
      kind: isSourceKind(kind) ? kind : 'default_category',
      ownerRef: stringValue(parsed.ownerRef).trim(),
      displayName: stringValue(parsed.displayName).trim(),
      ...(kind === 'group_chat' ? (() => {
        const botGroupTarget = sanitizeGroupBotBindingTarget(parsed.botGroupTarget)
        return botGroupTarget === undefined ? {} : { botGroupTarget }
      })() : {}),
    }
    if (parsed.version !== 1 || result.userId !== expectedUserId || !isSourceKind(kind)
      || result.ownerRef === '' || result.displayName === '') {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用与当前账号不匹配', false, 403)
    }
    return result
  }

  async sourceItem(source: ArkmeSourceRefPayload): Promise<ArkmeSourceItem> {
    const sourceKey = source.kind === 'private_chat' || source.kind === 'group_chat'
      ? await this.chatDirectorySourceKey(source.userId, source.ownerRef)
      : undefined
    return {
      sourceRef: await this.sealSourceRef(
        source.userId,
        source.kind,
        source.ownerRef,
        source.displayName,
        source.botGroupTarget === undefined ? {} : { botGroupTarget: source.botGroupTarget },
      ),
      ...(sourceKey === undefined ? {} : { sourceKey }),
      kind: source.kind,
      displayName: source.displayName,
      activeAtMillis: 0,
      unreadCount: 0,
    }
  }

  async chatSourceFromBundle(
    bundle: Record<string, unknown>,
    session: ArkmeSessionCredentials,
    cached: ArkmeSourceItem | undefined,
    timelineItems: ArkmeTimelineItem[],
  ): Promise<ArkmeSourceItem> {
    const chatSession = objectValue(bundle.session)
    const counterpart = objectValue(bundle.private_counterpart)
    const supplement = objectValue(bundle.private_supplement)
    const unread = objectValue(bundle.unread_snapshot)
    const isMuted = chatMessageDnd(bundle.current_policy) ?? cached?.isMuted ?? false
    const uid = stringValue(chatSession.chat_session_uid).trim()
    const sessionKind = numberValue(chatSession.session_kind)
    const kind: ArkmeSourceKind | undefined = sessionKind === 2
      ? 'group_chat'
      : sessionKind === 1 || sessionKind === 3 ? 'private_chat' : undefined
    if (uid === '' || kind === undefined) throw new Error('invalid chat display snapshot')
    const displayName = (kind === 'private_chat'
      ? stringValue(
        supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
        ?? supplement.pending_name ?? counterpart.visible_phone,
      )
      : stringValue(chatSession.title)).trim() || cached?.displayName || '未命名会话'
    const latestItem = [...timelineItems].sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))[0]
    const latestPreview = latestItem === undefined
      ? cached?.latestPreview
      : latestItem.forwardRecords === undefined
        ? latestItem.textContent || latestItem.title || '非文本内容'
        : `[转发] ${latestItem.forwardRecords.title}`
    const latestSequence = Math.max(
      numberValue(unread.session_last_seq ?? chatSession.last_seq),
      latestItem?.sequence ?? 0,
      cached?.latestSequence ?? 0,
    )
    const unreadCount = Math.max(0, Math.trunc(numberValue(unread.unread_count)))
    const latestMentionsViewer = latestItem?.isMe === false && latestItem.mentionsViewer === true
    const backendMentionState = chatUnreadMentionState(unread)
    const hasUnreadMention = kind !== 'group_chat'
      ? undefined
      : unreadCount <= 0
        ? false
        : backendMentionState === undefined && !latestMentionsViewer
          ? cached?.hasUnreadMention
          : backendMentionState === true || latestMentionsViewer
    const botGroupTarget = kind === 'group_chat' ? arkmeGroupBotBindingTargetFromBundle(bundle) : undefined
    return {
      sourceRef: await this.sealSourceRef(
        session.userId,
        kind,
        uid,
        displayName,
        botGroupTarget === undefined ? {} : { botGroupTarget },
      ),
      sourceKey: await this.chatDirectorySourceKey(session.userId, uid),
      kind,
      displayName,
      ...(cached?.avatarRef === undefined ? {} : { avatarRef: cached.avatarRef }),
      ...(cached?.avatarRefs === undefined ? {} : { avatarRefs: cached.avatarRefs }),
      ...(cached?.groupAvatar === undefined ? {} : { groupAvatar: cached.groupAvatar }),
      ...(latestPreview === undefined || latestPreview === '' ? {} : { latestPreview }),
      activeAtMillis: Math.max(
        numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        latestItem?.sendAtMillis ?? 0,
      ),
      unreadCount,
      ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }),
      isMuted,
      ...(latestSequence > 0 ? { latestSequence } : {}),
    }
  }

  private encodeCursor(value: Record<string, unknown>): string {
    return `arkme-cursor-v1.${encodeOpaqueJson(value)}`
  }

  private decodeCursor(cursor: string): Record<string, unknown> {
    const [prefix, payload, ...extra] = cursor.trim().split('.')
    if (prefix !== 'arkme-cursor-v1' || payload === undefined || extra.length > 0) {
      throw new ArkmePluginError('source-cursor-invalid', 'Arkme 数据源分页游标无效', false)
    }
    try {
      const decoded = objectValue(decodeOpaqueJson(payload))
      if (Object.keys(decoded).length === 0) throw new Error('empty cursor')
      return decoded
    } catch (error) {
      throw new ArkmePluginError('source-cursor-invalid', 'Arkme 数据源分页游标无效', false, 400, { cause: error })
    }
  }
}
