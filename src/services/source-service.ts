import { createHmac, timingSafeEqual } from 'node:crypto'
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
  ArkmeTopicCreateResult,
} from '../types.js'
import { ProfileService, type ArkmePublicProfile } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeSourceRefPayload {
  version: 1
  userId: number
  kind: ArkmeSourceKind
  ownerRef: string
  displayName: string
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
      this.sourceListCache.delete(cacheKey)
      this.sourceListCache.set(cacheKey, { value: cloneSourceList(result), expiresAtMillis: Date.now() + SOURCE_LIST_CACHE_TTL_MS })
      this.pruneSourceListCache()
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
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/display/list',
          { limit: Math.min(100, Math.max(1, limit)) },
          session,
        ),
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/relations/list',
          {},
          session,
        ).catch(() => undefined),
      ])
      const [summaryResult, latestRecordsResult] = await Promise.allSettled([
        this.recordReader.summary(),
        this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/records/uncategorized/query',
          { limit: 10 },
          session,
        ),
      ])
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
      const parentTopicUidByChild = new Map<string, string>()
      for (const raw of listValue(hierarchyData?.relations)) {
        const relation = objectValue(raw)
        if (numberValue(relation.rel_kind) !== 1 || numberValue(relation.status) !== 1) continue
        const parentTopicUid = stringValue(relation.parent_topic_uid).trim()
        const childTopicUid = stringValue(relation.child_topic_uid).trim()
        if (parentTopicUid === '' || childTopicUid === '' || parentTopicUid === childTopicUid) continue
        parentTopicUidByChild.set(childTopicUid, parentTopicUid)
      }
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const core = objectValue(item.topic_core)
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
      const item: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, kind, uid, displayName),
        sourceKey: await this.chatDirectorySourceKey(session.userId, uid),
        kind,
        displayName,
        ...(preview === '' ? {} : { latestPreview: preview }),
        activeAtMillis: numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        unreadCount: numberValue(unread.unread_count),
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

  invalidateSourceListCache(userId: number, directory?: ArkmeSourceDirectory): void {
    const prefix = `${String(userId)}:`
    for (const key of this.sourceListCache.keys()) {
      if (!key.startsWith(prefix)) continue
      if (directory !== undefined && !key.startsWith(`${prefix}${directory}:`)) continue
      this.sourceListCache.delete(key)
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
  ): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, kind, ownerRef, displayName } satisfies ArkmeSourceRefPayload)
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
      sourceRef: await this.sealSourceRef(source.userId, source.kind, source.ownerRef, source.displayName),
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
    return {
      sourceRef: await this.sealSourceRef(session.userId, kind, uid, displayName),
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
      unreadCount: Math.max(0, Math.trunc(numberValue(unread.unread_count))),
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
