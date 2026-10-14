import { arrangementEvidence, projectEvidence, type ArrangementEvidenceData } from '../arrangement-provenance.js'
import { ArrangementSourceRecovery } from './arrangement-source-recovery.js'
import { parseArrangementBoardCachePages, type ArkmeArrangementBoardCache } from '../arrangement-board-cache.js'
import { createHmac } from 'node:crypto'
import { projectArrangementRecordingSource, validRecordingSourceDay } from '../arrangement-recording-source.js'
import { validArrangementDateContext } from '../arrangement-creation.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeArrangementReorderInput,
  ArkmeArrangementReorderResult,
  ArkmeArrangementDetail,
  ArkmeArrangementCreationSource,
  ArkmeArrangementItem,
  ArkmeArrangementListStatus,
  ArkmeArrangementMutationIntent,
  ArkmeArrangementMutationResult,
  ArkmeArrangementPage,
  ArkmeArrangementReminderEvent,
  ArkmeArrangementReminderPage,
  ArkmeArrangementReminderSummary,
  ArkmeArrangementReminderToggleResult,
  ArkmeArrangementReminderWriteResult,
  ArkmeArrangementStatus,
  ArkmeArrangementCreateInput,
  ArkmeRecordingArrangementQuery,
  ArkmeRecordingArrangementPage,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

interface ArkmeArrangementRefEntry {
  viewerUserId: number
  arrangementUid: string
  expiresAtMillis: number
}

interface ArkmeArrangementReminderRefEntry {
  viewerUserId: number
  eventUid: string
  expiresAtMillis: number
}

const ARKME_ARRANGEMENT_REF_TTL_MILLIS = 15 * 60 * 1000
const MAX_ARKME_ARRANGEMENT_REFS = 4096
const ARKME_ARRANGEMENT_REMINDER_REF_TTL_MILLIS = 15 * 60 * 1000
const MAX_ARKME_ARRANGEMENT_REMINDER_REFS = 4096

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Match Flutter creation-source precedence; never substitute the AI description. */
function arrangementCreationSource(item: Record<string, unknown>): ArkmeArrangementCreationSource {
  const records = listValue(item.related_records).map(objectValue)
  const recordCount = listValue(item.record_uids).filter(value => stringValue(value).trim()).length
  const project = (text: string, at: unknown) => ({ text, ...(numberValue(at) > 0 ? { createdAtMillis: Math.trunc(numberValue(at)) } : {}) })
  if ((records.length || recordCount) && !listValue(item.source_items).length && !stringValue(item.source_text)) {
    const items = records.filter(record => stringValue(record.text_content).trim()).map(record => project(stringValue(record.text_content), record.create_at))
    return { kind: 'quick-note', items, unavailableCount: Math.max(recordCount, records.length) - items.length }
  }
  const source = objectValue(item.source)
  const readItems = (value: unknown) => listValue(value).map(objectValue).filter(entry => stringValue(entry.text).trim()).map(entry => project(stringValue(entry.text), entry.create_at ?? entry.createAt))
  const nestedItems = readItems(source.source_items ?? source.sourceItems)
  const items = nestedItems.length ? nestedItems : readItems(item.source_items ?? item.sourceItems)
  if (items.length) return { kind: 'input', items, unavailableCount: 0 }
  const keys = ['source_text', 'sourceText', 'original_text', 'originalText', 'input_text', 'inputText', 'create_text', 'createText']
  const text = [...['content', 'text', ...keys].map(key => stringValue(source[key])), ...[...keys, 'raw_text', 'rawText'].map(key => stringValue(item[key]))].find(value => value.trim())
  return text ? { kind: 'input', items: [{ text }], unavailableCount: 0 } : { kind: 'none', items: [], unavailableCount: 0 }
}

function arrangementStatusCode(status: ArkmeArrangementListStatus): number {
  if (status === 'identified') return 1
  if (status === 'following') return 2
  if (status === 'completed') return 3
  return -1
}

function arrangementStatus(value: unknown): ArkmeArrangementStatus {
  const code = Math.trunc(numberValue(value))
  if (code === 1) return 'identified'
  if (code === 2) return 'following'
  if (code === 3) return 'completed'
  return 'unknown'
}

function arrangementMutationPath(intent: ArkmeArrangementMutationIntent): string {
  switch (intent) {
    case 'start-follow': return '/api/v1/arrangements/start-follow'
    case 'cancel-follow': return '/api/v1/arrangements/cancel-follow'
    case 'complete': return '/api/v1/arrangements/complete'
    case 'cancel-complete': return '/api/v1/arrangements/cancel-complete'
    case 'delete': return '/api/v1/arrangements/delete'
  }
}

function arrangementMutationExpectedStatus(
  intent: Exclude<ArkmeArrangementMutationIntent, 'delete'>,
): ArkmeArrangementStatus {
  switch (intent) {
    case 'start-follow':
    case 'cancel-complete':
      return 'following'
    case 'cancel-follow':
      return 'identified'
    case 'complete':
      return 'completed'
  }
}

function isAmbiguousArrangementWriteError(error: unknown): boolean {
  return error instanceof ArkmePluginError && error.retryable
}

export class ArrangementService {
  private readonly arrangementRefs = new Map<string, ArkmeArrangementRefEntry>()
  private readonly arrangementReminderRefs = new Map<string, ArkmeArrangementReminderRefEntry>()
  private readonly arrangementWrites = new Set<string>()

  private readonly recovery: ArrangementSourceRecovery
  constructor(private readonly runtime: ServiceRuntime) { this.recovery = new ArrangementSourceRecovery(runtime) }

  async arrangementBoardCache(accountScope: string, rawPages?: unknown): Promise<ArkmeArrangementBoardCache> {
    const session = await this.runtime.requireSession()
    if (accountScope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('arrangement-cache-account-changed', '账号已切换，请刷新安排', false, 403)
    let pages
    if (rawPages !== undefined) {
      try { pages = parseArrangementBoardCachePages(rawPages) }
      catch { throw new ArkmePluginError('invalid-params', '安排看板缓存格式无效', false, 400) }
      for (const page of Object.values(pages)) {
        for (const item of page.items) this.openArrangementRef(item.arrangementRef, session.userId)
      }
    }
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId) return { pages: {} }
    const result = await this.runtime.stateStore.arrangementBoardCache?.(this.runtime.config.environment, session.userId, pages).catch(() => ({})) ?? {}
    if ((await this.runtime.requireSession()).userId !== session.userId) return { pages: {} }
    return { pages: result }
  }


  dispose(): void {
    this.arrangementRefs.clear()
    this.arrangementReminderRefs.clear()
    this.arrangementWrites.clear()
  }

  async createArrangement(input: ArkmeArrangementCreateInput, signal?: AbortSignal): Promise<{ items: ArkmeArrangementItem[] }> {
    const texts = input.texts.map(text => text.trim())
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId) || texts.length < 1 || texts.length > 10 || texts.some(text => !text || [...text].length > 500) || texts.reduce((n,text) => n + [...text].length,0) > 2000) {
      throw new ArkmePluginError('arrangement-create-invalid', '最多输入10条，每条500字，总计2000字', false, 400)
    }
    if ('dueAtMillis' in input || (input.dateContext !== undefined && !validArrangementDateContext(input.dateContext))) {
      throw new ArkmePluginError('arrangement-create-invalid', '安排默认日期或时区无效，请刷新后重试', false, 400)
    }
    const dateContext = input.dateContext ? { default_date: input.dateContext.defaultDate, timezone: input.dateContext.timezone } : undefined
    const session = await this.runtime.requireSession()
    return this.withArrangementWrite(`create:${input.requestId}`, session.userId, async () => {
      if (dateContext) {
        // Old servers ignore unknown JSON fields. Verify support before any write.
        const unsupported = () => new ArkmePluginError('arrangement-date-context-unavailable', '当前服务暂不支持日历默认日期，尚未提交安排；输入已保留。', false, 409)
        let capabilities: Record<string, unknown>
        try {
          capabilities = objectValue(await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/creation-options', {}, session, signal, { lane: 'interactive-read', bypassCache: true }))
        } catch (error) {
          if (error instanceof ArkmePluginError && ([404, 405, 501].includes(error.upstreamStatus ?? 0) || error.code === 'arkme-response-invalid')) throw unsupported()
          throw error
        }
        if (capabilities.contract_version !== 1 || capabilities.date_context !== true) throw unsupported()
      }
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/fast-create-async', {
        uid: input.requestId, scene_type: 'private', topic_uid: '', sent_messages: texts.map(text => ({ type: 'text', text })),
        ...(dateContext ? { required_contract_version: 1, date_context: dateContext } : {}),
      }, session, signal)
      if (dateContext && (data.contract_version !== 1 || objectValue(data.date_context).default_date !== dateContext.default_date || objectValue(data.date_context).timezone !== dateContext.timezone)) {
        throw new ArkmePluginError('arrangement-create-uncertain', '未能确认默认日期已保存，输入已保留；请使用原请求重试核对。', true, 502)
      }
      const items = await Promise.all(listValue(data.items).map(raw => this.arrangementItem(raw, session.userId)))
      if (!items.length) throw new ArkmePluginError('arrangement-create-uncertain', '未能确认创建结果，请重试核对', true, 502)
      return { items }
    })
  }

  async arrangementRecognition(refs: string[], signal?: AbortSignal): Promise<{ items: ArkmeArrangementItem[] }> {
    if (!refs.length || refs.length > 50) throw new ArkmePluginError('arrangement-read-invalid', '安排查询范围无效', false, 400)
    const session = await this.runtime.requireSession()
    const uids = refs.map(ref => this.openArrangementRef(ref, session.userId).arrangementUid)
    const read = async (ids: string[]) => {
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/list', { status: -1, uids: ids, limit: 50, offset: 0 }, session, signal, { lane: 'interactive-read', bypassCache: true })
      return listValue(data.list).map(objectValue)
    }
    const rows = await read(uids)
    const seen = new Set(rows.map(row => stringValue(row.uid)))
    const results = [...new Set(rows.flatMap(row => listValue(row.recognition_result_uids).map(stringValue).filter(Boolean)))].filter(uid => !seen.has(uid))
    for (let i = 0; i < results.length; i += 50) rows.push(...await read(results.slice(i, i + 50)))
    return { items: await Promise.all(rows.map(row => this.arrangementItem(row, session.userId))) }
  }

  async listArrangements(
    options: { status?: ArkmeArrangementListStatus; limit?: number; offset?: number; order?: 'board'; boardVersion?: string; dueStartAtMillis?: number; dueEndAtMillis?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementPage> {
    const session = await this.runtime.requireSession()
    const status = options.status ?? 'all'
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const hasRange = options.dueStartAtMillis !== undefined || options.dueEndAtMillis !== undefined
    if (hasRange && (!Number.isSafeInteger(options.dueStartAtMillis) || !Number.isSafeInteger(options.dueEndAtMillis)
      || options.dueStartAtMillis! <= 0 || options.dueEndAtMillis! < options.dueStartAtMillis! || options.order === 'board')) {
      throw new ArkmePluginError('arrangement-read-invalid', '安排日期范围无效', false, 400)
    }
    let data: Record<string, unknown>
    try { data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/arrangements/list',
      { status: arrangementStatusCode(status), limit, offset, ...(hasRange ? { due_start_at: options.dueStartAtMillis, due_end_at: options.dueEndAtMillis } : {}), ...(options.order === 'board' ? { order: 'board', ...(options.boardVersion ? { board_version: options.boardVersion } : {}) } : {}) },
      session,
      options.signal,
      { lane: 'interactive-read' },
    )
    } catch (error) {
      if (options.order === 'board' && error instanceof ArkmePluginError && error.upstreamStatus === 409) {
        throw new ArkmePluginError('arrangement-board-conflict', '安排排序版本已变化，请刷新', false, 409)
      }
      if (options.order === 'board' && error instanceof ArkmePluginError && error.upstreamStatus === 422) {
        const page = await this.listArrangements({ status, limit, offset, ...(options.signal ? { signal: options.signal } : {}) })
        return { ...page, board: { supported: false, version: '' } }
      }
      throw error
    }
    const rawItems = listValue(data.list)
    const items = await Promise.all(rawItems.map(async raw => await this.arrangementItem(raw, session.userId)))
    if (hasRange && items.some(item => item.dueAtMillis === undefined || item.dueAtMillis < options.dueStartAtMillis! || item.dueAtMillis > options.dueEndAtMillis!)) {
      throw new ArkmePluginError('arrangement-contract-invalid', '未能确认当天安排，请稍后重试', true, 502)
    }
    const total = Math.max(0, Math.trunc(numberValue(data.total)))
    const nextOffset = offset + rawItems.length
    const hasMore = rawItems.length > 0 && nextOffset < total
    const board = objectValue(data.board)
    if (board.supported === true && !stringValue(board.version).trim()) throw new ArkmePluginError('arrangement-contract-invalid', '安排排序版本缺失', true, 502)
    return { items, total, hasMore, ...(hasMore ? { nextOffset } : {}), ...(typeof board.supported === 'boolean' ? { board: { supported: board.supported, version: stringValue(board.version) } } : options.order === 'board' ? { board: { supported: false, version: '' } } : {}) }
  }

  /** Dedicated endpoint: old list servers may silently ignore an unknown source-date filter. */
  async recordingDayArrangements(options: ArkmeRecordingArrangementQuery, signal?: AbortSignal): Promise<ArkmeRecordingArrangementPage> {
    const { dateStamp, tzOffsetMillis } = options
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    if (!validRecordingSourceDay(dateStamp, tzOffsetMillis) || !Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)
      || (offset > 0 && !options.snapshotVersion?.trim()) || (options.snapshotVersion?.length ?? 0) > 512) {
      throw new ArkmePluginError('arrangement-read-invalid', '录音来源日期或分页参数无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    const unavailable = { state: 'unavailable', items: [], total: null, hasMore: false } as const
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/recording-day', {
        date_stamp: dateStamp, tz_offset: tzOffsetMillis, limit, offset,
        ...(options.snapshotVersion ? { snapshot_version: options.snapshotVersion } : {}),
      }, session, signal, { lane: 'interactive-read', bypassCache: true })
    } catch (error) {
      if (error instanceof ArkmePluginError && [404, 405, 501].includes(error.upstreamStatus ?? 0)) return { ...unavailable, items: [] }
      throw error
    }
    if (data.contract_version !== 1 || data.date_stamp !== dateStamp || data.tz_offset !== tzOffsetMillis) {
      throw new ArkmePluginError('arrangement-contract-invalid', '未能确认录音来源安排，请稍后重试', true, 502)
    }
    if (data.state === 'unavailable') return { ...unavailable, items: [] }
    const version = stringValue(data.snapshot_version)
    if (!['ready', 'processing', 'partial'].includes(stringValue(data.state)) || !Number.isSafeInteger(data.total) || numberValue(data.total) < 0
      || !Array.isArray(data.list) || data.list.length > limit || !version.trim() || version.length > 512
      || (options.snapshotVersion !== undefined && version !== options.snapshotVersion)) {
      throw new ArkmePluginError('arrangement-contract-invalid', '录音来源安排响应不完整，请刷新', true, 502)
    }
    const total = data.total as number
    const items = await Promise.all(data.list.map(raw => this.arrangementItem(raw, session.userId)))
    const nextOffset = offset + items.length
    if (nextOffset > total || (nextOffset < total && items.length === 0) || new Set(items.map(item => item.arrangementRef)).size !== items.length
      || items.some(item => item.recordingSource?.state !== 'ready' || item.recordingSource.dateStamp !== dateStamp || item.recordingSource.tzOffsetMillis !== tzOffsetMillis)) {
      throw new ArkmePluginError('arrangement-contract-invalid', '录音来源安排与当天不匹配，请刷新', true, 502)
    }
    return { state: data.state as 'ready' | 'processing' | 'partial', items, total, hasMore: nextOffset < total,
      ...(nextOffset < total ? { nextOffset } : {}), snapshotVersion: version }
  }

  async reorderArrangement(input: ArkmeArrangementReorderInput, signal?: AbortSignal): Promise<ArkmeArrangementReorderResult> {
    if (!['identified', 'following', 'completed'].includes(input.status) || !input.boardVersion.trim() || !input.requestId.trim() || input.boardVersion.length > 512 || input.requestId.length > 128) {
      throw new ArkmePluginError('arrangement-order-invalid', '安排排序参数无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    const uid = this.openArrangementRef(input.arrangementRef, session.userId).arrangementUid
    const beforeUid = input.beforeRef ? this.openArrangementRef(input.beforeRef, session.userId).arrangementUid : undefined
    const afterUid = input.afterRef ? this.openArrangementRef(input.afterRef, session.userId).arrangementUid : undefined
    if (beforeUid === uid || afterUid === uid || (beforeUid && beforeUid === afterUid)) throw new ArkmePluginError('arrangement-order-invalid', '安排排序位置无效', false, 400)
    return await this.withArrangementWrite(input.arrangementRef, session.userId, async () => {
      // Never retry a write here: a lost response may already have committed.
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/reorder', {
        uid, status: arrangementStatusCode(input.status),
        ...(beforeUid ? { before_uid: beforeUid } : {}), ...(afterUid ? { after_uid: afterUid } : {}),
        board_version: input.boardVersion, request_id: input.requestId,
      }, session, signal)
      const board = objectValue(data.board)
      if (board.supported !== true || !stringValue(board.version).trim()) throw new ArkmePluginError('arrangement-contract-invalid', '安排排序保存结果不确定，请刷新', true, 502)
      return { board: { supported: true, version: stringValue(board.version) } }
    })
  }

  async arrangementDetail(arrangementRef: string, signal?: AbortSignal): Promise<ArkmeArrangementDetail> {
    const session = await this.runtime.requireSession()
    const reference = this.openArrangementRef(arrangementRef, session.userId)
    return await this.arrangementOwnerDetail(reference.arrangementUid, session, signal)
  }

  async listArrangementReminders(
    options: { unreadOnly?: boolean; limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementReminderPage> {
    const session = await this.runtime.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/arrangements/reminders/list',
      { limit, offset, unread_only: options.unreadOnly === true },
      session,
      options.signal,
      { lane: 'interactive-read' },
    )
    const rawItems = listValue(data.list)
    const items = await Promise.all(rawItems.map(async raw => await this.arrangementReminderEvent(raw, session.userId)))
    const total = Math.max(0, Math.trunc(numberValue(data.total)))
    const nextOffset = offset + rawItems.length
    const hasMore = rawItems.length > 0 && nextOffset < total
    return { items, total, hasMore, ...(hasMore ? { nextOffset } : {}) }
  }

  async arrangementReminderSummary(signal?: AbortSignal): Promise<ArkmeArrangementReminderSummary> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/arrangements/reminders/summary',
      {},
      session,
      signal,
      { lane: 'interactive-read' },
    )
    const project = async (raw: unknown): Promise<ArkmeArrangementReminderEvent | undefined> => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
      return await this.arrangementReminderEvent(raw, session.userId)
    }
    const [latestUnread, latestEvent, nextReminder] = await Promise.all([
      project(data.latest_unread),
      project(data.latest_event),
      project(data.next_reminder),
    ])
    return {
      unreadCount: Math.max(0, Math.trunc(numberValue(data.unread_count))),
      ...(latestUnread === undefined ? {} : { latestUnread }),
      ...(latestEvent === undefined ? {} : { latestEvent }),
      ...(nextReminder === undefined ? {} : { nextReminder }),
    }
  }

  async mutateArrangement(
    arrangementRef: string,
    intent: ArkmeArrangementMutationIntent,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementMutationResult> {
    const session = await this.runtime.requireSession()
    const normalizedRef = arrangementRef.trim()
    const reference = this.openArrangementRef(normalizedRef, session.userId)
    return await this.withArrangementWrite(normalizedRef, session.userId, async () => {
      let ambiguous = false
      try {
        await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
          arrangementMutationPath(intent),
          { uid: reference.arrangementUid },
          session,
          signal,
        )
      } catch (error) {
        if (!isAmbiguousArrangementWriteError(error)) throw error
        ambiguous = true
      }

      if (intent === 'delete') {
        if (!ambiguous) {
          this.arrangementRefs.delete(normalizedRef)
          return { arrangementRef: normalizedRef, intent, outcome: 'confirmed', deleted: true }
        }
        const result = await this.reconcileArrangementDelete(normalizedRef, reference.arrangementUid, session)
        if (result.deleted === true) this.arrangementRefs.delete(normalizedRef)
        return result
      }

      let item: ArkmeArrangementItem | undefined
      try {
        item = await this.arrangementOwnerDetail(reference.arrangementUid, session, ambiguous ? undefined : signal)
      } catch {
        return { arrangementRef: normalizedRef, intent, outcome: ambiguous ? 'unknown' : 'confirmed' }
      }
      if (!ambiguous) return { arrangementRef: normalizedRef, intent, outcome: 'confirmed', item }
      const expectedStatus = arrangementMutationExpectedStatus(intent)
      return {
        arrangementRef: normalizedRef,
        intent,
        outcome: item.status === expectedStatus ? 'reconciled' : 'unknown',
        item,
      }
    })
  }

  async setArrangementReminderEnabled(
    arrangementRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderToggleResult> {
    const session = await this.runtime.requireSession()
    const normalizedRef = arrangementRef.trim()
    const reference = this.openArrangementRef(normalizedRef, session.userId)
    return await this.withArrangementWrite(normalizedRef, session.userId, async () => {
      let ambiguous = false
      try {
        await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
          '/api/v1/arrangements/reminder-enabled',
          { uid: reference.arrangementUid, reminder_enabled: enabled },
          session,
          signal,
        )
      } catch (error) {
        if (!isAmbiguousArrangementWriteError(error)) throw error
        ambiguous = true
      }
      let item: ArkmeArrangementItem | undefined
      try {
        item = await this.arrangementOwnerDetail(reference.arrangementUid, session, ambiguous ? undefined : signal)
      } catch {
        return { arrangementRef: normalizedRef, enabled, outcome: ambiguous ? 'unknown' : 'confirmed' }
      }
      return {
        arrangementRef: normalizedRef,
        enabled,
        outcome: ambiguous
          ? item.reminderEnabled === enabled ? 'reconciled' : 'unknown'
          : 'confirmed',
        item,
      }
    })
  }

  async markArrangementRemindersRead(
    eventRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderWriteResult> {
    const session = await this.runtime.requireSession()
    if (eventRefs.length === 0 || eventRefs.length > 50) {
      throw new ArkmePluginError('arrangement-reminder-refs-invalid', '请选择 1 至 50 条安排提醒', false)
    }
    const eventUids = [...new Set(eventRefs.map(eventRef => {
      return this.openArrangementReminderRef(eventRef, session.userId).eventUid
    }))]
    return await this.withArrangementWrite('reminders', session.userId, async () => {
      try {
        const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
          '/api/v1/arrangements/reminders/mark-read',
          { event_uids: eventUids, mark_all: false },
          session,
          signal,
        )
        return { outcome: 'confirmed', updatedCount: Math.max(0, Math.trunc(numberValue(data.updated_count))) }
      } catch (error) {
        if (!isAmbiguousArrangementWriteError(error)) throw error
        return { outcome: 'unknown' }
      }
    })
  }

  async markAllArrangementRemindersRead(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    const session = await this.runtime.requireSession()
    return await this.withArrangementWrite('reminders', session.userId, async () => {
      try {
        const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
          '/api/v1/arrangements/reminders/mark-read',
          { event_uids: [], mark_all: true },
          session,
          signal,
        )
        return { outcome: 'confirmed', updatedCount: Math.max(0, Math.trunc(numberValue(data.updated_count))) }
      } catch (error) {
        if (!isAmbiguousArrangementWriteError(error)) throw error
        return { outcome: 'unknown' }
      }
    })
  }

  async clearArrangementReminders(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    const session = await this.runtime.requireSession()
    return await this.withArrangementWrite('reminders', session.userId, async () => {
      try {
        const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
          '/api/v1/arrangements/reminders/clear',
          {},
          session,
          signal,
        )
        return { outcome: 'confirmed', updatedCount: Math.max(0, Math.trunc(numberValue(data.updated_count))) }
      } catch (error) {
        if (!isAmbiguousArrangementWriteError(error)) throw error
        try {
          const page = await this.listArrangementReminders({ limit: 1, offset: 0 })
          return { outcome: page.total === 0 && page.items.length === 0 ? 'reconciled' : 'unknown' }
        } catch {
          return { outcome: 'unknown' }
        }
      }
    })
  }

  private async withArrangementWrite<T>(
    arrangementRef: string,
    userId: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${String(userId)}:${arrangementRef}`
    if (this.arrangementWrites.has(key)) {
      throw new ArkmePluginError(
        'arrangement-write-pending',
        '这条安排正在处理中，请等待当前操作完成',
        false,
        409,
      )
    }
    this.arrangementWrites.add(key)
    try {
      return await operation()
    } finally {
      this.arrangementWrites.delete(key)
    }
  }

  private async arrangementOwnerDetail(
    arrangementUid: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementItem> {
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/arrangements/detail',
      { uid: arrangementUid },
      session,
      signal,
      { lane: 'interactive-read' },
    )
    if (stringValue(data.uid).trim() !== arrangementUid) {
      throw new ArkmePluginError('arrangement-contract-invalid', '安排详情响应身份不一致', true, 502)
    }
    if (objectValue(data.source_provenance).version !== 1 && [5,6].includes(Number(data.source_type))) {
      const recovered = await this.recovery.recover(data, session, signal).catch(() => undefined)
      if (recovered) data.source_provenance = { version: 1, items: [recovered] }
    }
    return await this.arrangementItem(data, session.userId)
  }

  async sourceDocument(arrangementRef: string, evidenceId: string, signal?: AbortSignal): Promise<string> {
    const session=await this.runtime.requireSession()
    const ref=this.openArrangementRef(arrangementRef,session.userId)
    const data=await this.runtime.authenticatedIntelligentPost<Record<string,unknown>>('/api/v1/arrangements/source/read',{uid:ref.arrangementUid,evidence_id:evidenceId},session,signal,{lane:'interactive-read',bypassCache:true})
    if(data.state!=='ready') throw new ArkmePluginError('arrangement-source-unavailable',stringValue(data.reason)||'来源暂不可查看',false,404)
    return stringValue(data.content)
  }

  async sourceEvidence(arrangementRef: string, evidenceId: string, signal?: AbortSignal): Promise<ArrangementEvidenceData> {
    const session = await this.runtime.requireSession()
    const ref = this.openArrangementRef(arrangementRef, session.userId)
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/detail', { uid: ref.arrangementUid }, session, signal, { lane: 'interactive-read', bypassCache: true })
    if (data.uid !== ref.arrangementUid || ![1,2,3].includes(Number(data.status))) throw new ArkmePluginError('arrangement-source-mismatch', '安排已删除或来源已变化，请刷新', false, 409)
    const recovered = await this.recovery.cached(data, session)
    if (recovered && objectValue(data.source_provenance).version !== 1) data.source_provenance = { version: 1, items: [recovered] }
    const evidence = arrangementEvidence(data).find(e => e.id === evidenceId)
    if (!evidence) throw new ArkmePluginError('arrangement-source-missing', '来源信息已变化，请刷新', false, 404)
    return evidence
  }

  private async reconcileArrangementDelete(
    arrangementRef: string,
    arrangementUid: string,
    session: ArkmeSessionCredentials,
  ): Promise<ArkmeArrangementMutationResult> {
    try {
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
        '/api/v1/arrangements/list',
        { status: -1, uids: [arrangementUid], limit: 1, offset: 0 },
        session,
        undefined,
        { lane: 'interactive-read' },
      )
      const visible = listValue(data.list).find(raw => stringValue(objectValue(raw).uid).trim() === arrangementUid)
      if (visible === undefined) {
        return { arrangementRef, intent: 'delete', outcome: 'reconciled', deleted: true }
      }
      return {
        arrangementRef,
        intent: 'delete',
        outcome: 'unknown',
        deleted: false,
        item: await this.arrangementItem(visible, session.userId),
      }
    } catch {
      return { arrangementRef, intent: 'delete', outcome: 'unknown' }
    }
  }

  private async arrangementItem(raw: unknown, viewerUserId: number): Promise<ArkmeArrangementItem> {
    const item = objectValue(raw)
    const arrangementUid = stringValue(item.uid).trim()
    if (arrangementUid === '') {
      throw new ArkmePluginError('arrangement-contract-invalid', '安排响应缺少业务身份', true, 502)
    }
    const dueAtMillis = Math.trunc(numberValue(item.due_at))
    const remindAtMillis = Math.trunc(numberValue(item.remind_at))
    if ([5,6].includes(Number(item.source_type)) && objectValue(item.source_provenance).version !== 1) {
      const session = await this.runtime.requireSession()
      if (session.userId === viewerUserId) { const recovered = await this.recovery.cached(item, session); if (recovered) item.source_provenance = { version: 1, items: [recovered] } }
    }
    const evidence = arrangementEvidence(item)
    const summary = evidence.find(e => e.kind === 'audio_summary' && e.summary_id)
    const recordingSource = projectArrangementRecordingSource(summary ? { ...item, recording_source: { kind: 'daily-summary', date_stamp: summary.date_stamp, tz_offset: summary.tz_offset, summary_id: summary.summary_id } } : item)
    return {
      arrangementRef: await this.arrangementRef(viewerUserId, arrangementUid),
      title: stringValue(item.title),
      description: stringValue(item.description),
      creationSource: arrangementCreationSource(item),
      provenance: evidence.map(projectEvidence),
      sourceType: numberValue(item.source_type),
      ...(recordingSource ? { recordingSource } : {}),
      recognitionState: stringValue(item.recognition_state),
      status: arrangementStatus(item.status),
      reminderEnabled: booleanValue(item.reminder_enabled),
      reminderState: stringValue(item.reminder_state),
      createdAtMillis: Math.trunc(numberValue(item.create_at)),
      updatedAtMillis: Math.trunc(numberValue(item.update_at)),
      ...(dueAtMillis > 0 ? { dueAtMillis } : {}),
      ...(remindAtMillis > 0 ? { remindAtMillis } : {}),
    }
  }

  private async arrangementRef(viewerUserId: number, arrangementUid: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`arrangement-v1:${String(viewerUserId)}:${arrangementUid}`)
      .digest('base64url')
    const arrangementRef = `arkme-arrangement-v1.${digest}`
    const now = Date.now()
    this.pruneArrangementRefs(now)
    this.arrangementRefs.set(arrangementRef, {
      viewerUserId,
      arrangementUid,
      expiresAtMillis: now + ARKME_ARRANGEMENT_REF_TTL_MILLIS,
    })
    return arrangementRef
  }

  private async arrangementReminderEvent(
    raw: unknown,
    viewerUserId: number,
  ): Promise<ArkmeArrangementReminderEvent> {
    const item = objectValue(raw)
    const eventUid = stringValue(item.uid).trim()
    const arrangementUid = stringValue(item.arrangement_uid).trim()
    if (eventUid === '' || arrangementUid === '') {
      throw new ArkmePluginError('arrangement-reminder-contract-invalid', '安排提醒响应缺少有效身份', true, 502)
    }
    const dueAtMillis = Math.trunc(numberValue(item.due_at))
    const remindAtMillis = Math.trunc(numberValue(item.remind_at))
    const readAtMillis = Math.trunc(numberValue(item.read_at))
    return {
      eventRef: await this.arrangementReminderRef(viewerUserId, eventUid),
      arrangementRef: await this.arrangementRef(viewerUserId, arrangementUid),
      title: stringValue(item.title),
      description: stringValue(item.description),
      eventKind: stringValue(item.event_kind),
      eventAtMillis: Math.trunc(numberValue(item.event_at)),
      read: readAtMillis > 0,
      reminderState: stringValue(item.reminder_state),
      createdAtMillis: Math.trunc(numberValue(item.create_at)),
      updatedAtMillis: Math.trunc(numberValue(item.update_at)),
      ...(dueAtMillis > 0 ? { dueAtMillis } : {}),
      ...(remindAtMillis > 0 ? { remindAtMillis } : {}),
      ...(readAtMillis > 0 ? { readAtMillis } : {}),
    }
  }

  private async arrangementReminderRef(viewerUserId: number, eventUid: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`arrangement-reminder-v1:${String(viewerUserId)}:${eventUid}`)
      .digest('base64url')
    const eventRef = `arkme-arrangement-reminder-v1.${digest}`
    const now = Date.now()
    this.pruneArrangementReminderRefs(now)
    this.arrangementReminderRefs.set(eventRef, {
      viewerUserId,
      eventUid,
      expiresAtMillis: now + ARKME_ARRANGEMENT_REMINDER_REF_TTL_MILLIS,
    })
    return eventRef
  }

  private pruneArrangementReminderRefs(now: number): void {
    for (const [eventRef, entry] of this.arrangementReminderRefs) {
      if (entry.expiresAtMillis <= now) this.arrangementReminderRefs.delete(eventRef)
    }
    while (this.arrangementReminderRefs.size >= MAX_ARKME_ARRANGEMENT_REMINDER_REFS) {
      const oldest = this.arrangementReminderRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.arrangementReminderRefs.delete(oldest)
    }
  }

  private openArrangementReminderRef(eventRef: string, viewerUserId: number): ArkmeArrangementReminderRefEntry {
    const normalized = eventRef.trim()
    const entry = normalized.startsWith('arkme-arrangement-reminder-v1.')
      ? this.arrangementReminderRefs.get(normalized)
      : undefined
    if (entry === undefined || entry.viewerUserId !== viewerUserId || entry.expiresAtMillis <= Date.now()) {
      this.arrangementReminderRefs.delete(normalized)
      throw new ArkmePluginError(
        'arrangement-reminder-ref-invalid',
        '安排提醒引用无效或已过期，请刷新提醒',
        false,
        403,
      )
    }
    return entry
  }

  private pruneArrangementRefs(now: number): void {
    for (const [arrangementRef, entry] of this.arrangementRefs) {
      if (entry.expiresAtMillis <= now) this.arrangementRefs.delete(arrangementRef)
    }
    while (this.arrangementRefs.size >= MAX_ARKME_ARRANGEMENT_REFS) {
      const oldest = this.arrangementRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.arrangementRefs.delete(oldest)
    }
  }

  private openArrangementRef(arrangementRef: string, viewerUserId: number): ArkmeArrangementRefEntry {
    const normalized = arrangementRef.trim()
    const entry = normalized.startsWith('arkme-arrangement-v1.')
      ? this.arrangementRefs.get(normalized)
      : undefined
    if (entry === undefined || entry.viewerUserId !== viewerUserId || entry.expiresAtMillis <= Date.now()) {
      this.arrangementRefs.delete(normalized)
      throw new ArkmePluginError('arrangement-ref-invalid', '安排引用无效或已过期，请刷新安排', false, 403)
    }
    return entry
  }
}
