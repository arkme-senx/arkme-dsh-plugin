import { createHash, randomUUID } from 'node:crypto'
import type {
  ArkmeCachedQueryResult,
  ArkmeFileAssetDisplayItem,
  ArkmeImageSearchItem,
  ArkmeImageSearchResult,
  ArkmeRecordSearchResult,
  ArkmeRecordingSearchResult,
  ArkmeSearchAssetItem,
  ArkmeSearchHistoryResult,
  ArkmeSearchRecordItem,
  ArkmeSearchSceneKind,
  ArkmeSearchSourceAggregate,
} from '../types.js'
import { MediaService } from './media-service.js'
import { RecordService } from './record-service.js'
import { ArkmePluginError, ServiceRuntime, clippedText, objectValue, stringValue } from './service.js'
import { ARKME_DSH_AGENT_INPUT_CREATION_SOURCE, isDshAgentInputSourceTitle } from '../dsh-agent-input-source.js'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

export class SearchService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly record: RecordService,
    private readonly media: MediaService,
  ) {}

  async searchRecords(options: {
    query: string
    limit: number
    beforeMillis?: number
    syncAll?: boolean
    signal?: AbortSignal
  }): Promise<ArkmeCachedQueryResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('record-query-empty', '搜索关键词不能为空', false)
    if (options.syncAll === true) await this.record.syncHistory(20, options.signal)
    return await this.record.queryCached({
      query,
      limit: options.limit,
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
    })
  }

  async searchRemote(options: {
    query: string
    limit: number
    cursor?: string
    searchScope?: 'global' | 'topic' | 'chat_session'
    sourceUid?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('record-query-empty', '搜索关键词不能为空', false)
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/records/query',
      {
        keyword: query,
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        search_scope: options.searchScope ?? 'global',
        source_kinds: [1, 2, 3],
        ...(options.sourceUid?.trim() ? { source_uid: options.sourceUid.trim() } : {}),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    return this.recordSearchResult(data)
  }

  async searchHistory(limit = 10): Promise<ArkmeSearchHistoryResult> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/history/list',
      { limit: Math.min(20, Math.max(1, Math.trunc(limit))) },
      session,
    )
    return {
      items: listValue(data.items).map(raw => {
        const item = objectValue(raw)
        return {
          searchHistoryUid: stringValue(item.search_history_uid).trim(),
          keyword: stringValue(item.keyword).trim(),
          searchedAtMillis: numberValue(item.searched_at ?? item.created_at),
        }
      }).filter(item => item.keyword !== ''),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
    }
  }

  async createSearchHistory(keyword: string): Promise<void> {
    const normalized = keyword.trim()
    if (normalized === '') return
    const session = await this.runtime.requireSession()
    await this.runtime.authenticatedPost(
      '/api/v1/search/history/create',
      {
        client_event_uid: `dsh-${randomUUID()}`,
        keyword: normalized,
        searched_at: Date.now(),
        stay_sec: 0,
        client_name: 'DSH',
      },
      session,
    )
  }

  async searchScene(options: {
    scene: ArkmeSearchSceneKind
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    const sceneKinds: Record<ArkmeSearchSceneKind, number> = {
      audio: 1,
      link: 2,
      image_video: 3,
      file: 4,
      long_article: 5,
    }
    if (sceneKinds[options.scene] === undefined) {
      throw new ArkmePluginError('search-scene-invalid', '快速查找类型无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/records/scene/query',
      {
        scene_kind: sceneKinds[options.scene],
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        search_scope: 'global',
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    return this.recordSearchResult(data)
  }

  /** Build the desktop image library from the mixed image/video scene. */
  async searchImages(options: {
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeImageSearchResult> {
    const session = await this.runtime.requireSession()
    const pageLimit = Math.min(50, Math.max(1, Math.trunc(options.limit)))
    const seenCursors = new Set<string>()
    let cursor = options.cursor?.trim() ?? ''
    if (cursor !== '') seenCursors.add(cursor)
    let lastPage: ArkmeRecordSearchResult | undefined

    for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
      const page = await this.searchScene({
        scene: 'image_video',
        limit: pageLimit,
        ...(cursor === '' ? {} : { cursor }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      lastPage = page
      const candidates = page.items.flatMap(record => record.media.flatMap(asset => {
        const mimeType = asset.mimeType?.trim().toLowerCase() ?? ''
        const isImageCandidate = mimeType.startsWith('image/')
          || (mimeType === '' && (asset.fileKind === undefined || asset.fileKind === 1))
        return isImageCandidate ? [{ record, asset }] : []
      }))
      const uniqueAssetUids = [...new Set(candidates.map(candidate => candidate.asset.fileAssetUid))]
      const displayItems: ArkmeFileAssetDisplayItem[] = []
      for (let offset = 0; offset < uniqueAssetUids.length; offset += 50) {
        displayItems.push(...await this.media.queryFileAssets(uniqueAssetUids.slice(offset, offset + 50), options.signal))
      }
      const displayByUid = new Map(displayItems.map(item => [item.fileAssetUid, item]))
      const emitted = new Set<string>()
      const items = candidates.flatMap(({ record, asset }): ArkmeImageSearchItem[] => {
        const itemIdentity = `${record.recordUid}\0${asset.fileAssetUid}`
        if (emitted.has(itemIdentity)) return []
        const display = displayByUid.get(asset.fileAssetUid)
        if (display === undefined) return []
        const mimeType = (display.mimeType ?? asset.mimeType ?? '').trim().toLowerCase()
        if (!mimeType.startsWith('image/')) return []
        const remoteUrl = display.previewUrl ?? display.downloadUrl
        if (remoteUrl === undefined) return []
        emitted.add(itemIdentity)
        const fileName = display.fileName ?? asset.fileName ?? '图片'
        return [{
          itemKey: createHash('sha256').update(itemIdentity).digest('base64url'),
          mediaRef: this.media.issueImageMediaRef(session.userId, {
            remoteUrl,
            mimeType: mimeType || 'application/octet-stream',
            fileName,
            size: Math.max(0, Math.trunc(asset.size ?? 0)),
          }, asset.fileAssetUid),
          recordUid: record.recordUid,
          sendAtMillis: record.sendAtMillis,
          fileName,
          mimeType: mimeType || 'application/octet-stream',
          size: Math.max(0, Math.trunc(asset.size ?? 0)),
          recordTitle: record.title || record.nickname || '快记',
          ...(record.sourceTitle === undefined ? {} : { sourceTitle: record.sourceTitle }),
        }]
      })
      const nextCursor = page.nextCursor?.trim() ?? ''
      const canContinue = page.hasMore && nextCursor !== '' && !seenCursors.has(nextCursor)
      if (items.length > 0 || !canContinue) {
        return { items, hasMore: canContinue, ...(canContinue ? { nextCursor } : {}), queryGuard: page.queryGuard }
      }
      if (pageIndex === 7) return { items: [], hasMore: true, nextCursor, queryGuard: page.queryGuard }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }

    return { items: [], hasMore: false, queryGuard: lastPage?.queryGuard ?? { state: 'complete' } }
  }

  async searchRecordings(options: {
    query: string
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordingSearchResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('recording-query-empty', '搜索关键词不能为空', false)
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/recordings/query',
      {
        keyword: query,
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    const guard = objectValue(data.query_guard)
    return {
      items: listValue(data.items).map(raw => {
        const item = objectValue(raw)
        return {
          sessionId: stringValue(item.session_id).trim(),
          ...(stringValue(item.record_uid).trim() === '' ? {} : { recordUid: stringValue(item.record_uid).trim() }),
          dateStamp: numberValue(item.date_stamp),
          startAtMillis: numberValue(item.start_at),
          snippet: clippedText(item.snippet, 1_000),
          score: numberValue(item.score),
        }
      }).filter(item => item.sessionId !== '' && item.snippet !== ''),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
      queryGuard: {
        state: stringValue(guard.state).trim() || 'complete',
        ...(stringValue(guard.reason).trim() === '' ? {} : { reason: stringValue(guard.reason).trim() }),
      },
    }
  }

  private recordSearchResult(data: Record<string, unknown>): ArkmeRecordSearchResult {
    const guard = objectValue(data.query_guard)
    const summary = objectValue(data.page_summary)
    return {
      items: listValue(data.items).map(raw => this.searchRecordItem(raw)).filter((item): item is ArkmeSearchRecordItem => item !== undefined),
      sourceAggregates: listValue(data.source_aggregates)
        .map(raw => this.searchSourceAggregate(raw))
        .filter((item): item is ArkmeSearchSourceAggregate => item !== undefined),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
      queryGuard: {
        state: stringValue(guard.state).trim() || 'complete',
        ...(stringValue(guard.reason).trim() === '' ? {} : { reason: stringValue(guard.reason).trim() }),
      },
      ...(numberValue(summary.item_count) <= 0 ? {} : { itemCount: numberValue(summary.item_count) }),
      ...(numberValue(summary.item_size) <= 0 ? {} : { itemSize: numberValue(summary.item_size) }),
    }
  }

  private searchRecordItem(raw: unknown): ArkmeSearchRecordItem | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const match = objectValue(item.match_summary)
    const payload = objectValue(core.content_payload)
    const topic = objectValue(item.topic_core)
    const chat = objectValue(item.chat_core)
    const recordUid = stringValue(item.record_uid ?? core.record_uid).trim()
    if (recordUid === '') return undefined
    const assetItem = (value: unknown): ArkmeSearchAssetItem | undefined => {
      const source = objectValue(value)
      const fileAssetUid = stringValue(source.file_asset_uid ?? source.source_file_asset_uid).trim()
      if (fileAssetUid === '') return undefined
      return {
        fileAssetUid,
        ...(stringValue(source.file_uid).trim() === '' ? {} : { fileUid: stringValue(source.file_uid).trim() }),
        ...(stringValue(source.file_name).trim() === '' ? {} : { fileName: stringValue(source.file_name).trim() }),
        ...(stringValue(source.mime_type).trim() === '' ? {} : { mimeType: stringValue(source.mime_type).trim() }),
        ...(numberValue(source.file_kind) <= 0 ? {} : { fileKind: Math.trunc(numberValue(source.file_kind)) }),
        ...(numberValue(source.size) <= 0 ? {} : { size: numberValue(source.size) }),
        ...(numberValue(source.duration_millis) <= 0 ? {} : { durationMillis: numberValue(source.duration_millis) }),
      }
    }
    const media = listValue(payload.media_refs).map(assetItem).filter((value): value is NonNullable<typeof value> => value !== undefined)
    const files = listValue(item.file_ls).map(assetItem).filter((value): value is NonNullable<typeof value> => value !== undefined)
    const voice = assetItem(payload.voice)
    const textContent = clippedText(core.text_content, 2_000)
    const linkMatch = textContent.match(/https:\/\/[^\s<>()]+/u)
    const sourceTitle = stringValue(topic.title ?? chat.title).trim()
    const creationSource = Math.trunc(numberValue(core.creation_source ?? item.creation_source))
    const normalizedCreationSource = creationSource > 0
      ? creationSource
      : isDshAgentInputSourceTitle(sourceTitle)
        ? ARKME_DSH_AGENT_INPUT_CREATION_SOURCE
        : 0
    return {
      recordUid,
      sourceKind: Math.trunc(numberValue(item.source_kind)),
      ...(stringValue(item.source_uid).trim() === '' ? {} : { sourceUid: stringValue(item.source_uid).trim() }),
      routeTargetKind: stringValue(item.route_target_kind).trim(),
      ...(stringValue(item.route_target_uid).trim() === '' ? {} : { routeTargetUid: stringValue(item.route_target_uid).trim() }),
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: clippedText(core.title, 500),
      textContent,
      snippet: clippedText(match.snippet, 1_000),
      ...(stringValue(core.nickname).trim() === '' ? {} : { nickname: stringValue(core.nickname).trim() }),
      ...(numberValue(core.template_kind) <= 0 ? {} : { templateKind: Math.trunc(numberValue(core.template_kind)) }),
      ...(numberValue(core.display_kind) <= 0 ? {} : { displayKind: Math.trunc(numberValue(core.display_kind)) }),
      ...(normalizedCreationSource <= 0 ? {} : { creationSource: normalizedCreationSource }),
      ...(sourceTitle === '' ? {} : { sourceTitle }),
      media,
      files,
      ...(voice === undefined ? {} : { voice }),
      ...(linkMatch === null ? {} : { linkUrl: linkMatch[0] }),
      ...(numberValue(core.duration_millis ?? core.record_duration_millis) <= 0 ? {} : { recordDurationMillis: numberValue(core.duration_millis ?? core.record_duration_millis) }),
      ...(numberValue(item.scene_item_count) <= 0 ? {} : { sceneItemCount: numberValue(item.scene_item_count) }),
      ...(numberValue(item.scene_item_size) <= 0 ? {} : { sceneItemSize: numberValue(item.scene_item_size) }),
    }
  }

  private searchSourceAggregate(raw: unknown): ArkmeSearchSourceAggregate | undefined {
    const item = objectValue(raw)
    const topic = objectValue(item.topic_core)
    const chat = objectValue(item.chat_core)
    const sourceUid = stringValue(item.source_uid).trim()
    if (sourceUid === '') return undefined
    return {
      sourceKind: Math.trunc(numberValue(item.source_kind)),
      sourceUid,
      routeTargetKind: stringValue(item.route_target_kind).trim(),
      ...(stringValue(item.route_target_uid).trim() === '' ? {} : { routeTargetUid: stringValue(item.route_target_uid).trim() }),
      title: stringValue(topic.title ?? chat.title).trim() || '未命名来源',
      matchedRecordCount: Math.max(0, Math.trunc(numberValue(item.matched_record_count))),
      matchedRecordCountExact: booleanValue(item.matched_record_count_exact),
    }
  }
}
