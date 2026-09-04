import { createHmac, timingSafeEqual } from 'node:crypto'
import { logArkmeAvatarDiagnostic } from '../avatar-diagnostics.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeChatAttentionSummary,
  ArkmeGroupAvatarPresentation,
  ArkmeSelfRecordItem,
  ArkmeSelfSummary,
  ArkmeSourceDirectory,
  ArkmeSourceDirectoryPinResult,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeTimelineItem,
  ArkmeTopicCreateResult,
  ArkmeTopicDissolveResult,
  ArkmeTopicDissolveProgress,
  ArkmeTopicDissolveTask,
  ArkmeTopicHierarchyMoveResult,
  ArkmeTopicRenameResult,
} from '../types.js'
import { ProfileService, type ArkmePublicProfile } from './profile-service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord, arkmePrivacyLockedTopic } from './privacy-visibility.js'
import {
  CHAT_SESSION_CONVERSATION_LIST_ENTITY,
  type ConversationListPreferenceEntry,
} from './conversation-list-preference-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { arkmeMentionMetadataMentionsViewer } from '../mention-metadata.js'
import { arkmeMediaKind } from '../file-transfer-contract.js'
import { projectArkmeChatAttention, projectArkmeChatAttentionFromMuted } from '../chat-attention.js'

export interface ArkmeSourceRefPayload {
  version: 1
  userId: number
  kind: ArkmeSourceKind
  ownerRef: string
  displayName: string
  botGroupTarget?: ArkmeGroupBotBindingTarget
  sidebarSubjectUid?: string
  conversationListActivityAtMillis?: number
  conversationListLatestSequence?: number
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

interface ArkmeChatDirectoryMetadata {
  subjectUid?: string
  activityAtMillis: number
  latestSequence: number
}

export interface ArkmePrivateChatViewerLabel {
  displayName: string
  remark: string
}

interface CacheEntry<T> { value: T; expiresAtMillis: number }

export interface ArkmeSourceRecordReader {
  summary(): Promise<ArkmeSelfSummary>
  recordItem(raw: unknown): ArkmeSelfRecordItem | undefined
  isDSHAgentInput?(raw: unknown): boolean
  isPrivacyLocked?(raw: unknown): boolean
}

const SOURCE_LIST_CACHE_TTL_MS = 30_000
const SOURCE_LIST_CACHE_MAX_ENTRIES = 200
const GROUP_AVATAR_CACHE_TTL_MS = 5 * 60_000
const GROUP_AVATAR_NEGATIVE_CACHE_TTL_MS = 60_000
const TOPIC_DISSOLVE_RECORD_CONCURRENCY = 6
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

function arkmeChatDirectoryMetadataFromBundle(
  bundle: Record<string, unknown>,
  fallbackSubjectUid = '',
): ArkmeChatDirectoryMetadata {
  const chatSession = objectValue(bundle.session)
  const unread = objectValue(bundle.unread_snapshot)
  const subjectUid = stringValue(
    bundle.subject_uid ?? bundle.subjectUid
    ?? bundle.topic_uid ?? bundle.topicUid
    ?? chatSession.subject_uid ?? chatSession.subjectUid
    ?? chatSession.topic_uid ?? chatSession.topicUid
    ?? fallbackSubjectUid,
  ).trim()
  return {
    ...(subjectUid === '' ? {} : { subjectUid }),
    activityAtMillis: arkmeChatSortActiveAt(bundle, chatSession),
    latestSequence: Math.max(0, numberValue(unread.session_last_seq ?? chatSession.last_seq)),
  }
}

function arkmeChatSortActiveAt(
  bundle: Record<string, unknown>,
  chatSession: Record<string, unknown>,
): number {
  const projected = numberValue(bundle.sort_active_at)
  return Math.max(0, projected > 0
    ? projected
    : numberValue(bundle.last_active_at ?? chatSession.last_active_at))
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

function attachmentPreviewKind(item: Record<string, unknown>): 'image' | 'video' | 'audio' | 'file' {
  const fileName = stringValue(item.file_name ?? item.fileName).trim()
  const mimeType = stringValue(item.mime_type ?? item.mimeType).trim()
  const detectedKind = arkmeMediaKind(mimeType, fileName)
  if (detectedKind !== undefined) return detectedKind
  const fileKind = integerLikeValue(item.file_kind ?? item.fileKind)
  if (fileKind === 1) return 'image'
  if (fileKind === 2) return 'audio'
  if (fileKind === 3) return 'video'
  return 'file'
}

export function arkmeChatConversationPreview(raw: Record<string, unknown>): string {
  const direct = stringValue(raw.text_content ?? raw.title ?? raw.summary).trim()
  if (direct !== '') return direct.slice(0, 300)
  const content = objectValue(raw.content_payload ?? raw.payload)
  const nested = stringValue(content.text_content ?? content.title ?? content.summary).trim()
  if (nested !== '') return nested.slice(0, 300)
  if (objectValue(content.voice).duration !== undefined) return '[语音]'
  const displayItems = listValue(raw.media_display_items ?? raw.mediaDisplayItems).map(objectValue)
  const displayByAsset = new Map<string, Record<string, unknown>>()
  for (const item of displayItems) {
    const fileAssetUid = stringValue(item.file_asset_uid ?? item.fileAssetUid).trim()
    if (fileAssetUid !== '') displayByAsset.set(fileAssetUid, item)
  }
  const mediaRefs = listValue(content.media_refs ?? content.mediaRefs).map(objectValue)
  const attachments: Record<string, unknown>[] = (mediaRefs.length > 0
    ? mediaRefs.map(ref => ({
        ...(displayByAsset.get(stringValue(ref.file_asset_uid ?? ref.fileAssetUid).trim()) ?? {}),
        ...ref,
      }))
    : displayItems)
    .filter(item => integerLikeValue(item.content_file_role ?? item.contentFileRole) !== 4)
    .sort((left, right) => integerLikeValue(left.sort_order ?? left.sortOrder) - integerLikeValue(right.sort_order ?? right.sortOrder))
  const firstAttachment = attachments[0]
  if (firstAttachment !== undefined) {
    const kind = attachmentPreviewKind(firstAttachment)
    return kind === 'image' ? '[图片]' : kind === 'video' ? '[视频]' : kind === 'audio' ? '[语音]' : '[文件]'
  }
  if (Object.keys(objectValue(content.structured_anchor)).length > 0) return '[卡片]'
  return ''
}

export function arkmeTimelineConversationPreview(item: ArkmeTimelineItem): string {
  const text = item.textContent.trim() || item.title.trim()
  if (text !== '') return text
  const kind = item.contentBlocks?.[0]?.kind
  return kind === 'image' ? '[图片]' : kind === 'video' ? '[视频]' : kind === 'audio' ? '[语音]' : kind === 'file' ? '[文件]' : '非文本内容'
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

function cloneSourceItem(value: ArkmeSourceItem): ArkmeSourceItem {
  return {
    ...value,
    ...(value.avatarRefs === undefined ? {} : { avatarRefs: [...value.avatarRefs] }),
    ...(value.groupAvatar === undefined ? {} : {
      groupAvatar: {
        ...value.groupAvatar,
        slots: value.groupAvatar.slots.map(slot => ({
          ...slot,
          ...(slot.fallback === undefined ? {} : { fallback: { ...slot.fallback } }),
        })),
      },
    }),
  }
}

function cloneSourceList(value: ArkmeSourceList): ArkmeSourceList {
  return { ...value, items: value.items.map(cloneSourceItem) }
}

export class SourceService {
  private readonly chatSourceCache = new Map<string, ArkmeSourceItem>()
  private readonly sourceListCache = new Map<string, CacheEntry<ArkmeSourceList>>()
  private readonly sourceListInFlight = new Map<string, Promise<ArkmeSourceList>>()
  private readonly groupAvatarSnapshotCache = new Map<string, CacheEntry<ArkmeGroupAvatarSnapshotProjection | null>>()
  private readonly topicDissolveProgress = new Map<string, {
    userId: number
    sourceRef: string
    parentSourceRef?: string
    progress: ArkmeTopicDissolveProgress
  }>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly recordReader: ArkmeSourceRecordReader,
    private readonly privacy = new ArkmePrivacyVisibilityService(runtime),
  ) {}

  async topicDissolveStatus(requestId: string): Promise<ArkmeTopicDissolveTask | undefined> {
    const session = await this.runtime.requireSession()
    const entry = this.topicDissolveProgress.get(requestId.trim())
    if (entry === undefined || entry.userId !== session.userId) return undefined
    return { ...entry.progress, sourceRef: entry.sourceRef, ...(entry.parentSourceRef === undefined ? {} : { parentSourceRef: entry.parentSourceRef }) }
  }

  async activeTopicDissolve(): Promise<ArkmeTopicDissolveTask | undefined> {
    const session = await this.runtime.requireSession()
    const tasks = [...this.topicDissolveProgress.values()].filter(entry => entry.userId === session.userId
      && entry.progress.stage !== 'completed' && entry.progress.stage !== 'failed')
    const entry = tasks.at(-1)
    return entry === undefined ? undefined : {
      ...entry.progress,
      sourceRef: entry.sourceRef,
      ...(entry.parentSourceRef === undefined ? {} : { parentSourceRef: entry.parentSourceRef }),
    }
  }

  private updateTopicDissolveProgress(
    requestId: string | undefined,
    userId: number,
    progress: Omit<ArkmeTopicDissolveProgress, 'requestId'>,
  ): void {
    const normalized = requestId?.trim() ?? ''
    if (normalized === '') return
    const existing = this.topicDissolveProgress.get(normalized)
    if (existing === undefined || existing.userId !== userId) return
    this.topicDissolveProgress.set(normalized, { ...existing, progress: { requestId: normalized, ...progress } })
  }

  cachedChatSource(userId: number, chatSessionUid: string): ArkmeSourceItem | undefined {
    return this.chatSourceCache.get(`${String(userId)}:${chatSessionUid}`)
  }

  cachedChatSourceByKey(cacheKey: string): ArkmeSourceItem | undefined {
    return this.chatSourceCache.get(cacheKey)
  }

  private projectChatSourceAttention(source: ArkmeSourceItem): ArkmeSourceItem {
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') return source
    const attention = projectArkmeChatAttentionFromMuted(source.unreadCount, source.isMuted === true)
    return { ...source, ...attention }
  }

  private storeChatSourceByKey(cacheKey: string, source: ArkmeSourceItem): void {
    this.chatSourceCache.set(cacheKey, cloneSourceItem(this.projectChatSourceAttention(source)))
  }

  /**
   * Server-owned tray summary. `summary` covers every visible conversation;
   * paginated `items` from this endpoint must never be summed as the Dock total.
   */
  async chatUnreadBadgeSummary(signal?: AbortSignal): Promise<ArkmeChatAttentionSummary> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/unread-snapshot',
      { limit: 1 },
      session,
      signal,
      { lane: 'background-read', key: 'chat:unread-badge-summary', bypassCache: true },
    )
    const summary = objectValue(data.summary)
    const badgeCount = integerLikeValue(summary.badge_count)
    const mutedUnreadCount = integerLikeValue(summary.muted_unread_count)
    const sessionCountWithUnread = integerLikeValue(summary.session_count_with_unread)
    const summaryVersion = integerLikeValue(summary.summary_version)
    const updatedAtMillis = integerLikeValue(summary.updated_at)
    const hasAttention = summary.has_attention
    if (![badgeCount, mutedUnreadCount, sessionCountWithUnread, summaryVersion, updatedAtMillis]
      .every(Number.isSafeInteger)
      || badgeCount < 0 || mutedUnreadCount < 0 || sessionCountWithUnread < 0
      || summaryVersion <= 0 || updatedAtMillis <= 0 || typeof hasAttention !== 'boolean') {
      throw new ArkmePluginError('chat-unread-summary-invalid', '聊天未读角标摘要响应不完整', true, 502)
    }
    return {
      badgeCount,
      mutedUnreadCount,
      sessionCountWithUnread,
      hasAttention,
      summaryVersion,
      updatedAtMillis,
    }
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
        displayName: '未分类',
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
    this.storeChatSourceByKey(`${String(userId)}:${chatSessionUid}`, source)
  }

  setChatSourceByKey(cacheKey: string, source: ArkmeSourceItem): void {
    this.storeChatSourceByKey(cacheKey, source)
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
    const labels = await this.privateChatViewerLabelsByUserIds(userIds, options)
    return new Map([...labels].map(([userId, label]) => [userId, label.displayName]))
  }

  /**
   * Resolve the current viewer's private-chat display label and its exact
   * remark source without compressing fallback snapshots into remark facts.
   */
  async privateChatViewerLabelsByUserIds(
    userIds: readonly number[],
    options: { signal?: AbortSignal } = {},
  ): Promise<Map<number, ArkmePrivateChatViewerLabel>> {
    const session = await this.runtime.requireSession()
    const remaining = new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0 && userId !== session.userId))
    const labels = new Map<number, ArkmePrivateChatViewerLabel>()
    let pageCursor: Record<string, unknown> | undefined

    // The chat directory is paged newest-first. Bound the scan so an unusually
    // large history cannot make a viewer-label projection unbounded.
    for (let page = 0; page < 20 && remaining.size > 0; page += 1) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list',
        { limit: 50, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) },
        session,
        options.signal,
        { lane: 'background-read', key: `private-chat-viewer-labels:${pageCursor === undefined ? 'first' : String(page)}` },
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
        const remark = stringValue(supplement.remark).trim()
        const displayName = remark
          || stringValue(supplement.counterpart_name_snapshot).trim()
          || stringValue(counterpart.display_name_snapshot).trim()
          || stringValue(supplement.pending_name).trim()
          || stringValue(counterpart.visible_phone).trim()
        if (displayName !== '') labels.set(targetUserId, { displayName, remark })
        remaining.delete(targetUserId)
      }
      if (data.has_more !== true) break
      const next = objectValue(data.next_page_cursor)
      if (Object.keys(next).length === 0) break
      pageCursor = next
    }
    return labels
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
    this.topicDissolveProgress.clear()
  }

  async createTopic(titleInput: string, parentSourceRef?: string): Promise<ArkmeTopicCreateResult> {
    const session = await this.runtime.requireSession()
    const title = titleInput.trim()
    if (title === '' || Array.from(title).length > 100) {
      throw new ArkmePluginError('topic-title-invalid', '主题名称不能为空或超过 100 个字符', false)
    }

    let parentTopicUid: string | undefined
    if (parentSourceRef !== undefined) {
      const parent = await this.openSourceRef(parentSourceRef, session.userId)
      if (parent.kind !== 'topic') {
        throw new ArkmePluginError('topic-parent-invalid', '只能在主题下创建子主题', false)
      }
      parentTopicUid = parent.ownerRef
    }

    const createdAtMillis = Date.now()
    const created = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/topics/create',
      {
        title,
        show_in_home: true,
        privacy_state: 1,
        extra: { source: 'dsh-arkme' },
      },
      session,
    )
    const topicUid = stringValue(created.topic_uid).trim()
    if (topicUid === '' || numberValue(created.status) !== 1) {
      throw new ArkmePluginError('topic-create-contract-invalid', '主题创建响应不完整', true, 502)
    }

    const sourceRef = await this.sealSourceRef(session.userId, 'topic', topicUid, title)
    if (parentTopicUid !== undefined) {
      try {
        const bound = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/bind',
          { parent_topic_uid: parentTopicUid, child_topic_uid: topicUid },
          session,
        )
        if (numberValue(objectValue(bound.relation).status) !== 1) {
          throw new ArkmePluginError('topic-hierarchy-bind-contract-invalid', '子主题层级响应不完整', true, 502)
        }
      } catch (bindError) {
        try {
          const rolledBack = await this.runtime.authenticatedPost<Record<string, unknown>>(
            '/api/v1/topics/update',
            {
              topic_uid: topicUid,
              title,
              show_in_home: true,
              privacy_state: 1,
              status: 2,
              extra: { source: 'dsh-arkme' },
            },
            session,
          )
          if (stringValue(rolledBack.topic_uid).trim() !== topicUid || !booleanValue(rolledBack.updated)) {
            throw new ArkmePluginError('topic-rollback-contract-invalid', '子主题清理响应不完整', true, 502)
          }
        } catch {
          return {
            source: {
              sourceRef,
              kind: 'topic',
              displayName: title,
              activeAtMillis: createdAtMillis,
              unreadCount: 0,
              recordCount: 0,
            },
            warning: '主题已创建，但父子关系添加及自动清理均未完成，请在根主题列表中检查后重试',
          }
        }
        throw new ArkmePluginError(
          'topic-hierarchy-bind-failed',
          '未能创建子主题，已自动清理，请重试',
          true,
          409,
          { cause: bindError },
        )
      }
    }

    return {
      source: {
        sourceRef,
        ...(parentSourceRef !== undefined ? { parentSourceRef } : {}),
        kind: 'topic',
        displayName: title,
        activeAtMillis: createdAtMillis,
        unreadCount: 0,
        recordCount: 0,
      },
    }
  }

  async renameTopic(sourceRef: string, titleInput: string): Promise<ArkmeTopicRenameResult> {
    const session = await this.runtime.requireSession()
    const topic = await this.openSourceRef(sourceRef, session.userId)
    if (topic.kind !== 'topic') {
      throw new ArkmePluginError('topic-rename-invalid', '只能重命名主题', false)
    }
    const title = titleInput.trim()
    if (title === '' || Array.from(title).length > 100) {
      throw new ArkmePluginError('topic-title-invalid', '主题名称不能为空或超过 100 个字符', false)
    }
    if (title === topic.displayName) return { sourceRef, displayName: title }
    const updated = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/topics/update',
      {
        topic_uid: topic.ownerRef,
        title,
        show_in_home: true,
        privacy_state: 1,
        status: 1,
        extra: { source: 'dsh-arkme' },
      },
      session,
    )
    if (stringValue(updated.topic_uid).trim() !== topic.ownerRef || !booleanValue(updated.updated)) {
      throw new ArkmePluginError('topic-rename-contract-invalid', '主题重命名响应不完整，请重试', true, 502)
    }
    this.invalidateSourceListCache(session.userId, 'send_to_self')
    return {
      sourceRef: await this.sealSourceRef(session.userId, 'topic', topic.ownerRef, title),
      displayName: title,
    }
  }

  /**
   * Dissolving a topic promotes its direct children and moves the topic's own
   * records into its parent. Root-topic records return to the default category.
   */
  async dissolveTopic(
    sourceRef: string,
    parentSourceRef: string | undefined,
    childSourceRefs: readonly string[],
    requestId?: string,
    expectedRecordCount?: number,
  ): Promise<ArkmeTopicDissolveResult> {
    const session = await this.runtime.requireSession()
    let totalRecordCount = Math.max(0, Math.trunc(expectedRecordCount ?? 0))
    let completedRecordCount = 0
    const report = (
      stage: ArkmeTopicDissolveProgress['stage'],
      error?: string,
    ) => {
      this.updateTopicDissolveProgress(requestId, session.userId, {
        stage, completedRecordCount, totalRecordCount, ...(error === undefined ? {} : { error }),
      })
    }
    const normalizedRequestId = requestId?.trim() ?? ''
    if (normalizedRequestId !== '') {
      this.topicDissolveProgress.set(normalizedRequestId, {
        userId: session.userId, sourceRef,
        ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
        progress: { requestId: normalizedRequestId, stage: 'reading', completedRecordCount: 0, totalRecordCount },
      })
    }
    report('reading')
    try {
    const topic = await this.openSourceRef(sourceRef, session.userId)
    if (topic.kind !== 'topic') {
      throw new ArkmePluginError('topic-dissolve-invalid', '只能解散主题', false)
    }
    const parent = parentSourceRef === undefined ? undefined : await this.openSourceRef(parentSourceRef, session.userId)
    if (parent !== undefined && parent.kind !== 'topic') {
      throw new ArkmePluginError('topic-dissolve-parent-invalid', '主题父级无效，请刷新后重试', false)
    }
    const childRefs = [...new Set(childSourceRefs.map(value => value.trim()).filter(value => value !== '' && value !== sourceRef))]
    const children = await Promise.all(childRefs.map(async childRef => {
      const child = await this.openSourceRef(childRef, session.userId)
      if (child.kind !== 'topic' || child.ownerRef === topic.ownerRef) {
        throw new ArkmePluginError('topic-dissolve-child-invalid', '子主题信息无效，请刷新后重试', false)
      }
      return { sourceRef: childRef, topic: child }
    }))
    const recordUids = await this.topicRecordUids(topic.ownerRef, session, completed => {
      completedRecordCount = completed
      totalRecordCount = Math.max(totalRecordCount, completed)
      report('reading')
    })
    totalRecordCount = recordUids.length
    completedRecordCount = 0
    report('migrating')
    const movedRecordUids = await this.moveTopicRecordsForDissolve(
      topic.ownerRef, parent?.ownerRef, recordUids, session,
      completed => { completedRecordCount = completed; report('migrating') },
    )
    const movedChildren: Array<{ sourceRef: string; topic: ArkmeSourceRefPayload }> = []
    try {
      report('promoting')
      for (const child of children) {
        const moved = await this.moveTopicHierarchyForDissolve(child.topic.ownerRef, topic.ownerRef, parent?.ownerRef, session)
        if (!moved) throw new ArkmePluginError('topic-dissolve-child-move-contract-invalid', '子主题转移失败，未解散当前主题', true, 502)
        movedChildren.push(child)
      }
      report('dissolving')
      const dissolved = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/update',
        {
          topic_uid: topic.ownerRef,
          title: topic.displayName,
          show_in_home: true,
          privacy_state: 1,
          status: 2,
          extra: { source: 'dsh-arkme' },
        },
        session,
      )
      if (stringValue(dissolved.topic_uid).trim() !== topic.ownerRef || !booleanValue(dissolved.updated)) {
        throw new ArkmePluginError('topic-dissolve-contract-invalid', '主题解散响应不完整，请重试', true, 502)
      }
    } catch (cause) {
      await this.rollbackDissolvedTopicChildren(movedChildren, topic.ownerRef, parent?.ownerRef, session)
      await this.rollbackDissolvedTopicRecords(topic.ownerRef, parent?.ownerRef, movedRecordUids, session)
      throw cause
    }
    this.invalidateSourceListCache(session.userId, 'send_to_self')
    const result = {
      sourceRef,
      movedChildSourceRefs: movedChildren.map(child => child.sourceRef),
      movedRecordCount: movedRecordUids.length,
      ...(parentSourceRef === undefined ? {} : { recordTargetSourceRef: parentSourceRef }),
    }
    completedRecordCount = movedRecordUids.length
    report('completed')
    return result
    } catch (cause) {
      report('failed', safeFailureMessage(cause))
      throw cause
    }
  }

  private async topicRecordUids(
    topicUid: string,
    session: ArkmeSessionCredentials,
    onProgress?: (loadedRecordCount: number) => void,
  ): Promise<string[]> {
    const recordUids = new Set<string>()
    const seenCursors = new Set<string>()
    let cursorSendAt: number | undefined
    let cursorRecordUid: string | undefined
    for (let pageIndex = 0; pageIndex < 1_000; pageIndex += 1) {
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/display/detail',
        {
          topic_uid: topicUid,
          limit: 100,
          ...(cursorSendAt === undefined ? {} : { cursor_send_at: cursorSendAt }),
          ...(cursorRecordUid === undefined ? {} : { cursor_record_uid: cursorRecordUid }),
        },
        session,
      )
      for (const raw of listValue(data.records)) {
        const item = objectValue(raw)
        const uid = stringValue(item.record_uid ?? objectValue(item.record_core).record_uid).trim()
        if (uid !== '') recordUids.add(uid)
      }
      onProgress?.(recordUids.size)
      if (data.has_more !== true) return [...recordUids]
      const nextSendAt = numberValue(data.next_cursor_send_at)
      const nextRecordUid = stringValue(data.next_cursor_record_uid).trim()
      const cursorKey = `${String(nextSendAt)}:${nextRecordUid}`
      if (nextSendAt <= 0 || nextRecordUid === '' || seenCursors.has(cursorKey)) {
        throw new ArkmePluginError('topic-dissolve-record-page-invalid', '主题快记加载不完整，未解散主题，请刷新后重试', true, 502)
      }
      seenCursors.add(cursorKey)
      cursorSendAt = nextSendAt
      cursorRecordUid = nextRecordUid
    }
    throw new ArkmePluginError('topic-dissolve-record-page-limit', '主题快记过多，未解散主题，请稍后重试', true, 409)
  }

  private async moveTopicRecordsForDissolve(
    sourceTopicUid: string, targetTopicUid: string | undefined, recordUids: readonly string[], session: ArkmeSessionCredentials,
    onProgress?: (completedRecordCount: number) => void,
  ): Promise<string[]> {
    const moved: string[] = []
    try {
      let nextIndex = 0
      let failure: unknown
      const moveOne = async (recordUid: string) => {
        let targetBound = false
        try {
          if (targetTopicUid !== undefined) {
            const bound = await this.runtime.authenticatedPost<Record<string, unknown>>(
              '/api/v1/topics/records/bind',
              { topic_uid: targetTopicUid, record_uid: recordUid, rel_kind: 1, is_primary: true }, session,
            )
            if (stringValue(bound.rel_uid).trim() === '') throw new ArkmePluginError('topic-dissolve-record-bind-contract-invalid', '快记迁移失败，请重试', true, 502)
            targetBound = true
          }
          const unbound = await this.runtime.authenticatedPost<Record<string, unknown>>(
            '/api/v1/topics/records/unbind', { topic_uid: sourceTopicUid, record_uid: recordUid }, session,
          )
          if (stringValue(unbound.rel_uid).trim() === '') throw new ArkmePluginError('topic-dissolve-record-unbind-contract-invalid', '快记迁移失败，请重试', true, 502)
          moved.push(recordUid)
          onProgress?.(moved.length)
        } catch (cause) {
          if (targetBound && targetTopicUid !== undefined) {
            await this.runtime.authenticatedPost<Record<string, unknown>>(
              '/api/v1/topics/records/unbind', { topic_uid: targetTopicUid, record_uid: recordUid }, session,
            ).catch(() => undefined)
          }
          throw cause
        }
      }
      const worker = async () => {
        while (failure === undefined) {
          const index = nextIndex
          nextIndex += 1
          if (index >= recordUids.length) return
          try {
            await moveOne(recordUids[index]!)
          } catch (cause) {
            failure = cause
            return
          }
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(TOPIC_DISSOLVE_RECORD_CONCURRENCY, recordUids.length) },
        () => worker(),
      ))
      if (failure !== undefined) throw failure
      return moved
    } catch (cause) {
      await this.rollbackDissolvedTopicRecords(sourceTopicUid, targetTopicUid, moved, session)
      throw new ArkmePluginError('topic-dissolve-record-move-failed', '快记迁移失败，未解散主题，请重试', true, 409, { cause })
    }
  }

  private async rollbackDissolvedTopicRecords(
    sourceTopicUid: string, targetTopicUid: string | undefined, recordUids: readonly string[], session: ArkmeSessionCredentials,
  ): Promise<void> {
    for (const recordUid of [...recordUids].reverse()) {
      await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/records/bind', { topic_uid: sourceTopicUid, record_uid: recordUid, rel_kind: 1, is_primary: true }, session,
      ).catch(() => undefined)
      if (targetTopicUid !== undefined) {
        await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/unbind', { topic_uid: targetTopicUid, record_uid: recordUid }, session,
        ).catch(() => undefined)
      }
    }
  }

  private async moveTopicHierarchyForDissolve(
    topicUid: string, previousParentTopicUid: string, nextParentTopicUid: string | undefined, session: ArkmeSessionCredentials,
  ): Promise<boolean> {
    const moved = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/topics/hierarchy/move',
      {
        topic_uid: topicUid,
        previous_parent_topic_uid: previousParentTopicUid,
        parent_topic_uid: nextParentTopicUid ?? '',
        insert_before_topic_uid: '',
      },
      session,
    )
    return stringValue(moved.topic_uid).trim() === topicUid
      && stringValue(moved.parent_topic_uid).trim() === (nextParentTopicUid ?? '')
      && numberValue(moved.sibling_order) > 0
  }

  private async rollbackDissolvedTopicChildren(
    children: readonly { sourceRef: string; topic: ArkmeSourceRefPayload }[],
    topicUid: string,
    parentTopicUid: string | undefined,
    session: ArkmeSessionCredentials,
  ): Promise<void> {
    for (const child of [...children].reverse()) {
      await this.moveTopicHierarchyForDissolve(child.topic.ownerRef, parentTopicUid ?? '', topicUid, session).catch(() => false)
    }
  }

  /** Move a topic atomically, including its persisted order among siblings. */
  async moveTopicHierarchy(
    sourceRef: string,
    currentParentSourceRef: string | undefined,
    nextParentSourceRef: string | undefined,
    insertBeforeSourceRef: string | undefined,
  ): Promise<ArkmeTopicHierarchyMoveResult> {
    const session = await this.runtime.requireSession()
    const topic = await this.openSourceRef(sourceRef, session.userId)
    if (topic.kind !== 'topic') {
      throw new ArkmePluginError('topic-hierarchy-move-invalid', '只能调整主题层级', false)
    }
    const resolveTopic = async (reference: string | undefined): Promise<string | undefined> => {
      if (reference === undefined) return undefined
      const item = await this.openSourceRef(reference, session.userId)
      if (item.kind !== 'topic') {
        throw new ArkmePluginError('topic-hierarchy-parent-invalid', '只能移动到主题下', false)
      }
      if (item.ownerRef === topic.ownerRef) {
        throw new ArkmePluginError('topic-hierarchy-cycle', '不能移动到自身下', false)
      }
      return item.ownerRef
    }
    const currentParentUid = await resolveTopic(currentParentSourceRef)
    const nextParentUid = await resolveTopic(nextParentSourceRef)
    const insertBeforeUid = await resolveTopic(insertBeforeSourceRef)
    if (insertBeforeUid === topic.ownerRef) {
      throw new ArkmePluginError('topic-hierarchy-insert-before-invalid', '不能插入到自身之前', false)
    }
    const moved = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/topics/hierarchy/move',
      {
        topic_uid: topic.ownerRef,
        previous_parent_topic_uid: currentParentUid ?? '',
        parent_topic_uid: nextParentUid ?? '',
        insert_before_topic_uid: insertBeforeUid ?? '',
      },
      session,
    )
    const movedTopicUid = stringValue(moved.topic_uid).trim()
    const movedParentUid = stringValue(moved.parent_topic_uid).trim()
    const siblingOrder = numberValue(moved.sibling_order)
    if (movedTopicUid !== topic.ownerRef || movedParentUid !== (nextParentUid ?? '') || siblingOrder <= 0) {
      throw new ArkmePluginError('topic-hierarchy-move-contract-invalid', '主题移动响应不完整，请刷新后重试', true, 502)
    }
    this.sourceListCache.clear()
    return {
      sourceRef,
      ...(nextParentSourceRef === undefined ? {} : { parentSourceRef: nextParentSourceRef }),
      siblingOrder,
    }
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<ArkmeSourceList> {
    const session = await this.runtime.requireSession()
    // Topic hierarchies require their parent and child to arrive in the same response.
    // The topics endpoint supports up to 100 items, while chat directories stay capped at 50.
    const maxLimit = directory === 'send_to_self' ? 100 : 50
    const limit = Math.min(maxLimit, Math.max(1, Math.trunc(options.limit ?? 30)))
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

  async setChatDirectoryPin(
    sourceRef: string,
    pinned: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeSourceDirectoryPinResult> {
    const session = await this.runtime.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('chat-directory-policy-invalid', '仅支持更新私聊或群聊的会话列表状态', false)
    }
    const pinTarget = await this.resolveChatPinTarget(source, session, signal)
    const current = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/get', { chat_session_uid: source.ownerRef }, session, signal,
    )
    const updatedAt = Date.now()
    await Promise.all([
      this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/policy/update',
        {
          chat_session_uid: source.ownerRef,
          show_in_home_state: numberValue(current.show_in_home_state) || 1,
          privacy_state: numberValue(current.privacy_state) || 1,
          mute_state: numberValue(current.mute_state) || 1,
          pin_state: pinned ? 2 : 1,
          notify_state: numberValue(current.notify_state) || 1,
          status: numberValue(current.status) || 1,
          update_at: updatedAt,
        },
        session,
        signal,
      ),
      this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/pin/set',
        {
          topic_uid: pinTarget.subjectUid,
          pin_state: pinned ? 1 : 2,
          ...(pinned ? { pinned_at: updatedAt } : {}),
        },
        session,
        signal,
      ),
    ])
    const cacheKey = `${String(session.userId)}:${source.ownerRef}`
    const cached = this.chatSourceCache.get(cacheKey)
    if (cached !== undefined) this.storeChatSourceByKey(cacheKey, { ...cached, isPinned: pinned })
    this.sourceListCache.clear()
    return { sourceRef, pinned }
  }

  async chatConversationListPreferenceEntry(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ConversationListPreferenceEntry> {
    const session = await this.runtime.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('chat-directory-policy-invalid', '仅支持读取私聊或群聊的会话列表状态', false)
    }
    if (signal?.aborted === true) throw new DOMException('The operation was aborted', 'AbortError')
    const cached = this.chatSourceCache.get(`${String(session.userId)}:${source.ownerRef}`)
    return {
      ownerUserId: session.userId,
      ref: { entityKind: CHAT_SESSION_CONVERSATION_LIST_ENTITY, entityUid: source.ownerRef },
      evidence: {
        sequence: Math.max(source.conversationListLatestSequence ?? 0, cached?.latestSequence ?? 0),
        activityAtMillis: Math.max(source.conversationListActivityAtMillis ?? 0, cached?.activeAtMillis ?? 0),
      },
    }
  }

  async chatConversationListPreferenceEntryBySessionUid(
    chatSessionUid: string,
    expectedOwnerUserId: number,
  ): Promise<ConversationListPreferenceEntry> {
    const session = await this.runtime.requireSession()
    const entityUid = chatSessionUid.trim()
    if (session.userId !== expectedOwnerUserId) {
      throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
    }
    if (entityUid === '') {
      throw new ArkmePluginError('chat-directory-preference-identity-invalid', '会话列表身份无效', false, 400)
    }
    const cached = this.chatSourceCache.get(`${String(session.userId)}:${entityUid}`)
    return {
      ownerUserId: session.userId,
      ref: { entityKind: CHAT_SESSION_CONVERSATION_LIST_ENTITY, entityUid },
      evidence: {
        sequence: cached?.latestSequence ?? 0,
        activityAtMillis: cached?.activeAtMillis ?? 0,
      },
    }
  }

  private async resolveChatPinTarget(
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{ subjectUid: string }> {
    if (source.sidebarSubjectUid !== undefined && source.sidebarSubjectUid.trim() !== '') {
      return { subjectUid: source.sidebarSubjectUid.trim() }
    }
    const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail',
      { chat_session_uid: source.ownerRef },
      session,
      signal,
      { lane: 'interactive-read', key: `chat-sidebar-target:${source.ownerRef}`, failureCooldownMs: 2_000 },
    )
    const target = arkmeChatDirectoryMetadataFromBundle(
      detail,
      source.kind === 'group_chat' ? source.ownerRef : '',
    )
    if (target.subjectUid === undefined) {
      throw new ArkmePluginError(
        'chat-sidebar-target-unavailable',
        '未能定位该会话的跨端侧边栏数据，请刷新后重试',
        true,
        502,
      )
    }
    return { subjectUid: target.subjectUid }
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
      const lockedRecordUids = await this.privacy.lockedRecordUids(session, options.signal)
      const topicPage = options.cursor === undefined || options.cursor.trim() === ''
        ? undefined
        : this.decodeTopicDirectoryCursor(options.cursor)
      const [data, hierarchyData] = await Promise.all([
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/display/list',
          {
            limit: Math.min(100, Math.max(1, limit)),
            // The established topic-client contract always supplies a keyword, including for an unfiltered page.
            keyword: '',
            privacy_state: 1,
            ...(topicPage?.pageCursor === undefined ? {} : { page_cursor: topicPage.pageCursor }),
            ...(topicPage?.offset === undefined ? {} : { offset: topicPage.offset }),
          },
          session,
          options.signal,
        ),
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/relations/list',
          {},
          session,
          options.signal,
        ).catch(() => undefined),
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
          .map(raw => this.recordReader.isDSHAgentInput?.(raw) === true
            || this.recordReader.isPrivacyLocked?.(raw) === true
            || arkmePrivacyLockedRecord(raw)
            || lockedRecordUids.has(stringValue(objectValue(raw).record_uid ?? objectValue(objectValue(raw).record_core).record_uid).trim())
            ? undefined
            : this.recordReader.recordItem(raw))
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
        sourceRef: await this.sealSourceRef(session.userId, 'default_category', 'uncategorized', '未分类'),
        kind: 'default_category',
        displayName: '未分类',
        activeAtMillis: defaultLatestRecord?.sendAtMillis ?? 0,
        unreadCount: 0,
        ...(defaultLatestPreview === '' ? {} : { latestPreview: defaultLatestPreview }),
        ...(defaultRecordCount === undefined ? {} : { recordCount: defaultRecordCount }),
      }
      const topicDescriptors: Array<{
        topicUid: string
        parentTopicUid?: string
        siblingOrder: number
        title: string
        latestPreview: string
        latestMessageAtMillis: number
        activeAtMillis: number
        recordCount: number
      }> = []
      const seenTopicUids = new Set<string>()
      const parentTopicUidByChild = new Map<string, string>()
      const siblingOrderByChild = new Map<string, number>()
      const childTopicUidsByParent = new Map<string, Set<string>>()
      for (const raw of listValue(hierarchyData?.relations)) {
        const relation = objectValue(raw)
        if (numberValue(relation.rel_kind) !== 1 || numberValue(relation.status) !== 1) continue
        const parentTopicUid = stringValue(relation.parent_topic_uid).trim()
        const childTopicUid = stringValue(relation.child_topic_uid).trim()
        if (parentTopicUid === '' || childTopicUid === '' || parentTopicUid === childTopicUid) continue
        parentTopicUidByChild.set(childTopicUid, parentTopicUid)
        siblingOrderByChild.set(childTopicUid, numberValue(relation.sibling_order))
        const children = childTopicUidsByParent.get(parentTopicUid) ?? new Set<string>()
        children.add(childTopicUid)
        childTopicUidsByParent.set(parentTopicUid, children)
      }
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        if (arkmePrivacyLockedTopic(item)) continue
        const core = objectValue(item.topic_core)
        const status = core.status ?? item.status
        // A dissolved topic remains in some list responses briefly (or in an
        // older cache), but it must never be selectable by the plugin.
        if (status !== undefined && numberValue(status) !== 1) continue
        const summary = objectValue(item.summary)
        const latest = objectValue(item.latest_record_core)
        const parent = objectValue(
          core.parent_topic_core ?? core.parent_topic ?? item.parent_topic_core ?? item.parent_topic,
        )
        const topicUid = stringValue(core.topic_uid).trim()
        const title = stringValue(core.title).trim()
        if (topicUid === '' || title === '' || seenTopicUids.has(topicUid)) continue
        seenTopicUids.add(topicUid)
        const parentTopicUid = stringValue(
          parentTopicUidByChild.get(topicUid)
          ?? core.parent_topic_uid ?? core.parent_uid ?? item.parent_topic_uid ?? item.parent_uid
          ?? parent.topic_uid ?? parent.uid,
        ).trim()
        topicDescriptors.push({
          topicUid,
          ...(parentTopicUid === '' || parentTopicUid === topicUid ? {} : { parentTopicUid }),
          siblingOrder: numberValue(siblingOrderByChild.get(topicUid) ?? core.sibling_order ?? item.sibling_order),
          title,
          latestPreview: arkmeChatConversationPreview(latest),
          latestMessageAtMillis: numberValue(latest.send_at ?? summary.latest_send_at),
          activeAtMillis: numberValue(latest.send_at ?? summary.latest_send_at ?? core.update_at),
          recordCount: numberValue(summary.record_count),
        })
      }
      const sourceRefByTopicUid = new Map<string, string>()
      const topicHierarchyKeyByUid = new Map<string, string>()
      for (const topic of topicDescriptors) {
        sourceRefByTopicUid.set(
          topic.topicUid,
          await this.sealSourceRef(session.userId, 'topic', topic.topicUid, topic.title),
        )
        topicHierarchyKeyByUid.set(topic.topicUid, await this.topicHierarchyKey(session.userId, topic.topicUid))
      }
      const topics: ArkmeSourceItem[] = await Promise.all(topicDescriptors.map(async topic => {
        const parentSourceRef = topic.parentTopicUid === undefined
          ? undefined
          : sourceRefByTopicUid.get(topic.parentTopicUid)
        const parentTopicHierarchyKey = topic.parentTopicUid === undefined
          ? undefined
          : await this.topicHierarchyKey(session.userId, topic.parentTopicUid)
        const hasPendingChildren = data.has_more === true
          && (childTopicUidsByParent.get(topic.topicUid)?.size ?? 0) > 0
          && [...(childTopicUidsByParent.get(topic.topicUid) ?? [])].some(childUid => !seenTopicUids.has(childUid))
        return {
          sourceRef: sourceRefByTopicUid.get(topic.topicUid)!,
          ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
          topicHierarchyKey: topicHierarchyKeyByUid.get(topic.topicUid)!,
          ...(parentTopicHierarchyKey === undefined ? {} : { parentTopicHierarchyKey }),
          ...(topic.siblingOrder > 0 ? { siblingOrder: topic.siblingOrder } : {}),
          kind: 'topic',
          displayName: topic.title,
          ...(topic.latestPreview === '' ? {} : { latestPreview: topic.latestPreview }),
          activeAtMillis: topic.activeAtMillis,
          unreadCount: 0,
          recordCount: topic.recordCount,
          ...(hasPendingChildren ? { hasPendingChildren: true } : {}),
        }
      }))
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
      const nextPageCursor = objectValue(data.next_page_cursor ?? data.next_cursor)
      const nextOffset = numberValue(data.next_offset)
      // The mobile client treats the cursor and offset forms as alternatives.
      // Prefer the cursor whenever both are present; sending both can make the
      // server repeat the first page instead of advancing the directory.
      const preferredPageCursor = Object.keys(nextPageCursor).length > 0 ? nextPageCursor : undefined
      const preferredOffset = preferredPageCursor === undefined && nextOffset > 0 ? nextOffset : undefined
      const hasMore = data.has_more === true && (preferredPageCursor !== undefined || preferredOffset !== undefined)
      const totalValue = data.total ?? data.total_count
      const total = totalValue === undefined ? undefined : Math.max(0, numberValue(totalValue))
      return {
        directory,
        items: [aggregateSource, defaultCategory, ...topics],
        ...(total === undefined ? {} : { total }),
        hasMore,
        ...(hasMore ? {
          nextCursor: this.encodeTopicDirectoryCursor({
            ...(preferredPageCursor === undefined ? {} : { pageCursor: preferredPageCursor }),
            ...(preferredOffset === undefined ? {} : { offset: preferredOffset }),
          }),
        } : {}),
      }
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
    const chatSessionUidByIndex = new Map<number, string>()
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
      const currentPolicy = objectValue(bundle.current_policy)
      const attention = projectArkmeChatAttention(unread.unread_count, currentPolicy)
      const isPinned = numberValue(currentPolicy.pin_state) === 2
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
      const preview = arkmeChatConversationPreview(latestPayload)
      const unreadCount = attention.unreadCount
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
      const cached = this.chatSourceCache.get(`${String(session.userId)}:${uid}`)
      const chatDirectoryMetadata = arkmeChatDirectoryMetadataFromBundle(bundle, kind === 'group_chat' ? uid : '')
      const item: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(
          session.userId,
          kind,
          uid,
          displayName,
          {
            ...(botGroupTarget === undefined ? {} : { botGroupTarget }),
            chatDirectoryMetadata,
          },
        ),
        sourceKey: await this.chatDirectorySourceKey(session.userId, uid),
        kind,
        displayName,
        ...(kind === 'private_chat' && cached?.avatarRef !== undefined
          ? { avatarRef: cached.avatarRef }
          : {}),
        ...(kind === 'group_chat' && cached?.avatarRefs !== undefined
          ? { avatarRefs: [...cached.avatarRefs] }
          : {}),
        ...(kind === 'group_chat' && cached?.groupAvatar !== undefined
          ? { groupAvatar: cloneSourceItem(cached).groupAvatar }
          : {}),
        ...(preview === '' ? {} : { latestPreview: preview }),
        activeAtMillis: arkmeChatSortActiveAt(bundle, chatSession),
        ...attention,
        ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }),
        isPinned,
        ...((numberValue(unread.session_last_seq ?? chatSession.last_seq)) > 0
          ? { latestSequence: numberValue(unread.session_last_seq ?? chatSession.last_seq) }
          : {}),
      }
      const itemIndex = items.push(item) - 1
      chatSessionUidByIndex.set(itemIndex, uid)
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
    // Cache the final hydrated projection as an owned snapshot. Realtime updates
    // must not depend on later mutation of the directory row object.
    for (const [index, uid] of chatSessionUidByIndex) {
      const item = items[index]
      if (item !== undefined) this.storeChatSourceByKey(`${String(session.userId)}:${uid}`, item)
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
    const authoritativeGroupIndices = new Set<number>()
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
      authoritativeGroupIndices.add(index)
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
      for (const uid of groupUids) {
        const index = indexByGroupUid.get(uid)
        if (index !== undefined) authoritativeGroupIndices.add(index)
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

    for (const index of authoritativeGroupIndices) {
      if (groupSnapshotsByIndex.has(index) || items[index] === undefined) continue
      // A successful snapshot read with no usable members is the complete
      // baseline and is therefore allowed to remove a previous presentation.
      delete items[index].groupAvatar
      delete items[index].avatarRefs
    }
    const targetUserIds = new Set<number>(privateUserIdByIndex.values())
    for (const snapshot of groupSnapshotsByIndex.values()) {
      for (const userId of snapshot.memberIds) targetUserIds.add(userId)
    }
    let profiles: ReadonlyMap<number, ArkmePublicProfile>
    try {
      profiles = await this.profile.publicProfileSummariesByUserIds([...targetUserIds], session, signal)
    } catch (error) {
      // A failed profile read is not an authoritative avatar deletion. Callers
      // may have seeded the rows with their last successful presentation.
      console.warn('dsh-arkme: Public profile avatar hydration failed:', safeFailureMessage(error))
      return
    }
    for (const [index, targetUserId] of privateUserIdByIndex) {
      const item = items[index]
      if (item === undefined) continue
      if (profiles.get(targetUserId)?.avatarUrl === undefined) {
        // The profile request completed and explicitly produced no usable
        // avatar, so the full directory baseline owns removal.
        delete item.avatarRef
        continue
      }
      try {
        item.avatarRef = await this.profile.sealProfileImageRef(session.userId, targetUserId)
      } catch (error) {
        // Keep a seeded last-known-good avatar when sealing is temporarily
        // unavailable; this is not a server-owned deletion either.
        logArkmeAvatarDiagnostic('private_avatar_seal_failed', {
          environment: this.runtime.config.environment, viewerUserId: session.userId, targetUserId,
        }, error)
      }
    }
    for (const [index, snapshot] of groupSnapshotsByIndex) {
      if (items[index] === undefined) continue
      try {
        const presentation = await this.groupAvatarPresentation(snapshot, profiles, session.userId)
        items[index].groupAvatar = presentation
        items[index].avatarRefs = presentation.slots.flatMap(slot => slot.avatarRef === undefined ? [] : [slot.avatarRef])
      } catch (error) {
        // Preserve a seeded last-known-good group presentation when the
        // complete replacement could not be materialized.
        console.warn('dsh-arkme: Group avatar presentation failed:', safeFailureMessage(error))
      }
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

  async chatTimelineItemKey(userId: number, chatSessionUid: string, relationUid: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`chat-timeline-item-key-v1:${String(userId)}:${chatSessionUid.trim()}:${relationUid.trim()}`)
      .digest('base64url')
    return `arkme-chat-timeline-item-v1.${digest}`
  }

  async chatPreparingActorKey(viewerUserId: number, chatSessionUid: string, actorUserId: number): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`chat-preparing-actor-v1:${String(viewerUserId)}:${chatSessionUid.trim()}:${String(actorUserId)}`)
      .digest('base64url')
    return `arkme-chat-preparing-actor-v1.${digest}`
  }

  async chatPreparingActorPresentation(
    viewerUserId: number, chatSessionUid: string, actorUserId: number,
  ): Promise<{ actorKey: string; avatarRef: string }> {
    const [actorKey, avatarRef] = await Promise.all([
      this.chatPreparingActorKey(viewerUserId, chatSessionUid, actorUserId),
      this.profile.sealProfileImageRef(viewerUserId, actorUserId),
    ])
    return { actorKey, avatarRef }
  }

  async topicHierarchyKey(userId: number, topicUid: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`topic-hierarchy-key-v1:${String(userId)}:${topicUid.trim()}`)
      .digest('base64url')
    return `arkme-topic-hierarchy-v1.${digest}`
  }

  async sealSourceRef(
    userId: number,
    kind: ArkmeSourceKind,
    ownerRef: string,
    displayName: string,
    options: {
      botGroupTarget?: ArkmeGroupBotBindingTarget
      chatDirectoryMetadata?: ArkmeChatDirectoryMetadata
    } = {},
  ): Promise<string> {
    const botGroupTarget = kind === 'group_chat' ? sanitizeGroupBotBindingTarget(options.botGroupTarget) : undefined
    const chatDirectoryMetadata = kind === 'private_chat' || kind === 'group_chat'
      ? options.chatDirectoryMetadata
      : undefined
    const payload = encodeOpaqueJson({
      version: 1,
      userId,
      kind,
      ownerRef,
      displayName,
      ...(botGroupTarget === undefined ? {} : { botGroupTarget }),
      ...(chatDirectoryMetadata === undefined ? {} : {
        ...(chatDirectoryMetadata.subjectUid === undefined ? {} : {
          sidebarSubjectUid: chatDirectoryMetadata.subjectUid,
        }),
        conversationListActivityAtMillis: chatDirectoryMetadata.activityAtMillis,
        conversationListLatestSequence: chatDirectoryMetadata.latestSequence,
      }),
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
      displayName: isSourceKind(kind) && kind === 'default_category' ? '未分类' : stringValue(parsed.displayName).trim(),
      ...(kind === 'group_chat' ? (() => {
        const botGroupTarget = sanitizeGroupBotBindingTarget(parsed.botGroupTarget)
        return botGroupTarget === undefined ? {} : { botGroupTarget }
      })() : {}),
      ...((kind === 'private_chat' || kind === 'group_chat') ? (() => {
        const sidebarSubjectUid = stringValue(parsed.sidebarSubjectUid).trim()
        return {
          ...(sidebarSubjectUid === '' ? {} : { sidebarSubjectUid }),
          conversationListActivityAtMillis: Math.max(0, numberValue(parsed.conversationListActivityAtMillis)),
          conversationListLatestSequence: Math.max(0, numberValue(parsed.conversationListLatestSequence)),
        }
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
        {
          ...(source.botGroupTarget === undefined ? {} : { botGroupTarget: source.botGroupTarget }),
          chatDirectoryMetadata: {
            ...(source.sidebarSubjectUid === undefined ? {} : { subjectUid: source.sidebarSubjectUid }),
            activityAtMillis: source.conversationListActivityAtMillis ?? 0,
            latestSequence: source.conversationListLatestSequence ?? 0,
          },
        },
      ),
      ...(sourceKey === undefined ? {} : { sourceKey }),
      kind: source.kind,
      displayName: source.displayName,
      activeAtMillis: source.conversationListActivityAtMillis ?? 0,
      unreadCount: 0,
      ...((source.conversationListLatestSequence ?? 0) > 0
        ? { latestSequence: source.conversationListLatestSequence }
        : {}),
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
    const currentPolicy = objectValue(bundle.current_policy)
    const attention = projectArkmeChatAttention(unread.unread_count, currentPolicy, cached?.isMuted ?? false)
    const isPinned = numberValue(currentPolicy.pin_state) === 2
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
        ? arkmeTimelineConversationPreview(latestItem)
        : `[转发] ${latestItem.forwardRecords.title}`
    const latestSequence = Math.max(
      numberValue(unread.session_last_seq ?? chatSession.last_seq),
      latestItem?.sequence ?? 0,
      cached?.latestSequence ?? 0,
    )
    const unreadCount = attention.unreadCount
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
    const chatDirectoryMetadata = arkmeChatDirectoryMetadataFromBundle(bundle, kind === 'group_chat' ? uid : '')
    return {
      sourceRef: await this.sealSourceRef(
        session.userId,
        kind,
        uid,
        displayName,
        {
          ...(botGroupTarget === undefined ? {} : { botGroupTarget }),
          chatDirectoryMetadata,
        },
      ),
      sourceKey: await this.chatDirectorySourceKey(session.userId, uid),
      kind,
      displayName,
      ...(cached?.avatarRef === undefined ? {} : { avatarRef: cached.avatarRef }),
      ...(cached?.avatarRefs === undefined ? {} : { avatarRefs: cached.avatarRefs }),
      ...(cached?.groupAvatar === undefined ? {} : { groupAvatar: cached.groupAvatar }),
      ...(latestPreview === undefined || latestPreview === '' ? {} : { latestPreview }),
      activeAtMillis: Math.max(
        arkmeChatSortActiveAt(bundle, chatSession),
        latestItem?.sendAtMillis ?? 0,
      ),
      ...attention,
      ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }),
      isPinned,
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

  private encodeTopicDirectoryCursor(value: { pageCursor?: Record<string, unknown>; offset?: number }): string {
    return this.encodeCursor({ directory: 'send_to_self', ...value })
  }

  private decodeTopicDirectoryCursor(cursor: string): { pageCursor?: Record<string, unknown>; offset?: number } {
    const value = this.decodeCursor(cursor)
    if (value.directory !== 'send_to_self') {
      throw new ArkmePluginError('source-cursor-invalid', '发给自己的主题分页游标无效', false)
    }
    const pageCursor = objectValue(value.pageCursor)
    const offset = numberValue(value.offset)
    if (Object.keys(pageCursor).length === 0 && offset <= 0) {
      throw new ArkmePluginError('source-cursor-invalid', '发给自己的主题分页游标无效', false)
    }
    return {
      ...(Object.keys(pageCursor).length === 0 ? {} : { pageCursor }),
      ...(offset <= 0 ? {} : { offset }),
    }
  }
}
