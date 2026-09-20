import type { ArkmeBotSummary, ArkmeCalendarRecordItem, ArkmeCalendarRecordLocation, ArkmeCallHistoryItem, ArkmeCallDetail, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { dayActivityMatchesFilter, dayActivityQueryKey, type DayActivityDetailPage, type DayActivityEntry, type DayActivityPage, type DayActivityQuery, type DayActivityReader, type DayActivityKind } from './calendar-activity-model.js'
import { groupDayActivities } from './multisource-day-activity-reader.js'

const PAGE_SIZE = 50
type SourceName = 'record' | 'chat' | 'call' | 'audio' | 'arko' | 'bot'
type Target = { kind: 'recording'; dateStamp: number; startAtMillis: number } | { kind: 'source'; source: ArkmeSourceItem } | { kind: 'arko' } | { kind: 'bot'; bot: ArkmeBotSummary }
type SourcePage = { cursor?: unknown; hasMore: boolean; loaded: boolean; partial?: boolean; failed?: string; seen?: Set<string> }
type ReadSession = {
  id: string
  key: string
  query: DayActivityQuery
  start: number
  end: number
  page: number
  entries: Map<string, DayActivityEntry>
  details: Map<string, DayActivityDetailPage['items']>
  targets: Map<string, Target>
  groups: Map<string, DayActivityEntry[]>
  calls: Map<string, ArkmeCallHistoryItem>
  recordings: Map<string, string>
  recordLinks: Map<string, string>
  chatRecordLinks: Map<string, string[]>
  locationRefs: Map<string, { ref: string; recordUid: string }>
  sources: Record<SourceName, SourcePage>
  coverage?: DayActivityPage['coverage']
  speechIntervals: Array<{ startAtMillis: number; endAtMillis: number }>
  warnings: string[]
}

function objectValue(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return 0
}
function firstString(...values: unknown[]): string { return values.map(stringValue).find(Boolean) ?? '' }
function firstMillis(...values: unknown[]): number {
  for (const value of values) {
    const number = numberValue(value)
    if (number > 0) return number < 10_000_000_000 ? Math.trunc(number * 1000) : Math.trunc(number)
  }
  return 0
}
function payloadData(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  return Object.keys(objectValue(raw.data)).length ? objectValue(raw.data) : raw
}
function dailyItems(value: unknown): Record<string, unknown>[] {
  const data = payloadData(value)
  return listValue(data.items ?? data.daily_data ?? data.dailyData).map(objectValue)
}
function sourceKind(raw: Record<string, unknown>): DayActivityKind {
  const source = firstString(raw.source_kind, raw.sourceKind, objectValue(raw.source_ref).kind).toLowerCase()
  if (source === 'private' || source === 'private_chat') return 'private_chat'
  if (source === 'group' || source === 'group_chat') return 'group_chat'
  if (source === 'bot') return 'bot'
  if (source === 'arko') return 'arko'
  if (source === 'dsh') return 'dsh'
  return 'private_chat'
}
function sourceItem(raw: Record<string, unknown>): ArkmeSourceItem | undefined {
  // Navigation accepts only the Host's viewer-bound projection, never a raw session UID.
  const projected = objectValue(raw.source_item)
  if (typeof projected.sourceRef === 'string' && typeof projected.displayName === 'string'
    && ['private_chat', 'group_chat'].includes(String(projected.kind))) return projected as unknown as ArkmeSourceItem
  return undefined
}
function sourceIdentity(raw: Record<string, unknown>): string {
  const ref = objectValue(raw.source_ref ?? raw.sourceRef)
  return firstString(ref.chat_session_uid, ref.chatSessionUid, raw.chat_session_uid, ref.session_id ? String(ref.session_id) : '')
}
function fullText(raw: Record<string, unknown>): string {
  const record = objectValue(raw.record ?? raw.message), payload = objectValue(record.payload ?? record.record_core)
  return firstString(raw.text, raw.content, payload.text_content, record.text_content, record.text, raw.preview, raw.summary)
}
function preview(raw: Record<string, unknown>): string {
  return (firstString(raw.preview) || fullText(raw)).slice(0, 240)
}
function relationLabel(flags: string[]): string {
  if (flags.includes('replied_to_me')) return '回复了我'
  if (flags.includes('mentioned_me')) return '提及了我'
  if (flags.includes('received')) return '我收到'
  return '我发送'
}
function inRange(value: number, start: number, end: number): boolean { return value >= start && value < end }
function localDayBounds(query: DayActivityQuery): [number, number] {
  const [year, month, day] = query.bucketDate.split('-').map(Number)
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: query.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const guess = Date.UTC(year!, month! - 1, day!)
  const offsetAt = (stamp: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: query.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(stamp).map(part => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - stamp
  }
  let start = guess - offsetAt(guess)
  const check = format.format(new Date(start))
  if (check !== query.bucketDate) start += check < query.bucketDate ? 86_400_000 : -86_400_000
  const next = new Date(start)
  const nextParts = format.formatToParts(new Date(start)).reduce<Record<string, string>>((acc, part) => (acc[part.type] = part.value, acc), {})
  const nextLocal = new Date(Date.UTC(Number(nextParts.year), Number(nextParts.month) - 1, Number(nextParts.day) + 1))
  const nextStart = nextLocal.getTime() - offsetAt(nextLocal.getTime())
  void day; void next
  return [start, nextStart]
}

function callBody(source: SourceName, query: DayActivityQuery, cursor: unknown): Record<string, unknown> {
  const [start, end] = localDayBounds(query)
  if (source === 'record') return { bucket_scope_kind: 1, view_scope_kind: 1, bucket_date: query.bucketDate, timezone: query.timezone, limit: PAGE_SIZE, oldest_first: false, include_location_summary: true, ...(cursor && typeof cursor === 'object' ? cursor : {}) }
  if (source === 'chat') return { start_at: start, end_at: end, timezone: query.timezone, direction: 'desc', limit: PAGE_SIZE,
    filters: { conversation_types: ['private', 'group'], relation_types: ['sent', 'received', 'mentioned_me', 'replied_to_me'] }, ...(cursor ? { cursor } : {}) }
  if (source === 'call') return { start_at: start, end_at: end, timezone: query.timezone, direction: 'desc', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
  if (source === 'audio') return { start_at: start, end_at: end, timezone: query.timezone, direction: 'desc', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
  return { start_at: start, end_at: end, timezone: query.timezone, direction: 'desc', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
}

function locationSummary(raw: Record<string, unknown>): { label?: string; capturedAtMillis?: number } | undefined {
  const value = objectValue(raw.location_summary ?? raw.locationSummary)
  const label = firstString(value.label, value.name)
  const captured = firstMillis(value.captured_at, value.capturedAt)
  if (!label && !captured) return undefined
  return { ...(label ? { label } : {}), ...(captured ? { capturedAtMillis: captured } : {}) }
}

export function createDocumentedDayActivityReader(accountScope: string, read: typeof callArkme = callArkme): DayActivityReader & { resolveTarget(ref: string): Target | undefined } {
  let current: ReadSession | undefined
  let revision = 0
  const request = async (source: SourceName, mode: 'details' | 'coverage' | 'transcripts', body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted()
    return await read('calendar.activity', { source, mode, body }, signal)
  }
  const readSource = async (session: ReadSession, source: SourceName, signal: AbortSignal) => {
    const state = session.sources[source]
    if (!state.hasMore && state.loaded) return
    try {
      const value = await request(source, source === 'audio' ? 'coverage' : 'details', callBody(source, session.query, state.cursor), signal)
      if (current !== session) throw new Error('日期或账号已变化，请刷新')
      const data = payloadData(value)
      state.loaded = true; delete state.failed; state.hasMore = data.has_more === true || data.hasMore === true
      state.partial = objectValue(data.coverage).status === 'partial' || objectValue(data.coverage).complete === false
      state.cursor = data.next_cursor ?? data.nextCursor ?? (data.next_cursor_record_uid ? { cursor_send_at: data.next_cursor_send_at, cursor_record_uid: data.next_cursor_record_uid } : undefined)
      if (state.hasMore) {
        const key = JSON.stringify(state.cursor)
        if (!key || state.seen?.has(key)) throw new Error('分页游标未推进，请刷新')
        ;(state.seen ??= new Set()).add(key)
      }
      if (source === 'audio') {
        const intervals = listValue(data.items ?? data.intervals).map(objectValue).map(item => ({ startAtMillis: firstMillis(item.start_at, item.startAt, item.occurred_at), endAtMillis: firstMillis(item.end_at, item.endAt), sourceLabel: firstString(item.source_label, item.sourceLabel) || '录音', status: (firstString(item.status) || 'saved') as 'saved' | 'processing' | 'local' | 'submitted' | 'recording' })).filter(item => item.endAtMillis > item.startAtMillis)
        session.coverage = { state: state.partial || state.hasMore ? 'partial' : 'ready', intervals: [...(session.coverage?.intervals ?? []), ...intervals] }
        for (const interval of intervals) {
          const start = Math.max(session.start, interval.startAtMillis), end = Math.min(session.end, interval.endAtMillis)
          if (end <= start) continue
          const id = `recording:${start}:${end}:${interval.sourceLabel}:${interval.status}`
          session.entries.set(id, { id, kind: 'recording', startAtMillis: start, endAtMillis: end, title: '录音时段', preview: '已记录声音，转写可按需查看', sourceName: interval.sourceLabel, recordCount: 0, access: 'available', participation: 'self' })
          session.targets.set(id, { kind: 'recording', dateStamp: session.start, startAtMillis: start })
          const raw = listValue(data.items ?? data.intervals).map(objectValue).find(item => firstMillis(item.start_at, item.startAt, item.occurred_at) === interval.startAtMillis && firstMillis(item.end_at, item.endAt) === interval.endAtMillis)
          const recordingId = firstString(raw?.recording_id)
          if (/^[a-f\d]{24}$/i.test(recordingId)) session.recordings.set(id, recordingId)
        }
        return
      }
      for (const item of dailyItems(value)) {
        const occurred = firstMillis(item.occurred_at, item.occurredAt, item.send_at, item.sendAt, item.started_at, item.startedAt, item.created_at, item.createdAt)
        if (!occurred || !inRange(occurred, session.start - 86_400_000, session.end)) continue
        if (source === 'record') {
          if (item.record_projection) {
            const note = item.record_projection as ArkmeCalendarRecordItem
            if (!note.recordUid || note.accessState !== 'available' || note.protected) continue
            const id = `note:${note.recordUid}`, sourceInfo = note.source
            const kind = note.creationSource === 3 || note.content?.agentSource?.kind === 'dsh_agent_input' ? 'dsh'
              : sourceInfo?.kind === 'group_chat' ? 'group_chat' : sourceInfo?.kind === 'private_chat' ? 'private_chat' : 'note'
            session.entries.set(id, { id, kind, startAtMillis: occurred, endAtMillis: occurred, access: 'available', participation: 'self', recordCount: 1,
              title: kind === 'dsh' ? 'DSH · 我提交的输入' : note.title || sourceInfo?.displayName || '我的记录', preview: (note.preview || note.textContent).slice(0, 240), sourceName: sourceInfo?.displayName || note.topicTitle || '个人记录',
              ...(sourceInfo ? { sourceIdentity: sourceInfo.sourceKey || sourceInfo.sourceRef, avatar: { avatarRef: sourceInfo.avatarRef, avatarRefs: sourceInfo.avatarRefs, groupAvatar: sourceInfo.groupAvatar }, ...(kind === 'private_chat' ? { participant: { name: sourceInfo.displayName } } : {}) } : {}),
              ...(note.locationSummary ? { locationSummary: note.locationSummary } : {}), ...(note.locationObservation ? { location: note.locationObservation } : {}), ...(note.locationRef ? { canLoadLocation: true } : {}) })
            session.details.set(id, [{ id, occurredAtMillis: occurred, author: { name: '我' }, text: note.textContent || note.preview, ...(note.content ? { content: note.content } : {}) }])
            if (sourceInfo) session.targets.set(id, { kind: 'source', source: sourceInfo })
            if (sourceInfo && (kind === 'private_chat' || kind === 'group_chat')) session.recordLinks.set(id, `${sourceInfo.sourceKey || sourceInfo.sourceRef}|${note.recordUid}`)
            if (note.locationRef) session.locationRefs.set(id, { ref: note.locationRef, recordUid: note.recordUid })
            continue
          }
          const record = objectValue(item.record_core ?? item.recordCore ?? item.record ?? item)
          const id = `note:${firstString(record.record_uid, record.recordUid, item.record_uid, item.recordUid)}`
          if (id === 'note:') continue
          const sourceInfo = sourceItem(item)
          const kind = sourceInfo?.kind === 'group_chat' ? 'group_chat' : sourceInfo?.kind === 'private_chat' ? 'private_chat' : firstString(record.creation_source, item.creation_source) === '3' ? 'dsh' : 'note'
          const loc = locationSummary(item) ?? locationSummary(record)
          const locationRef = firstString(item.location_ref, item.locationRef, record.location_ref, record.locationRef)
          const entry: DayActivityEntry = { id, kind, startAtMillis: occurred, endAtMillis: occurred, title: firstString(record.title, item.title) || (kind === 'dsh' ? 'DSH · 我提交的输入' : kind === 'note' ? '我的记录' : sourceInfo?.displayName || '对话'), preview: firstString(record.preview, record.text_content, item.preview, item.text_content).slice(0, 240), sourceName: sourceInfo?.displayName || '个人记录', recordCount: 1, access: 'available', participation: 'self', ...(sourceInfo ? { sourceIdentity: sourceInfo.sourceKey, ...(kind === 'private_chat' ? { participant: { name: sourceInfo.displayName } } : {}) } : {}), ...(loc ? { locationSummary: loc } : {}), ...(locationRef ? { canLoadLocation: true } : {}) }
          if (sourceInfo) entry.avatar = { avatarRef: sourceInfo.avatarRef, avatarRefs: sourceInfo.avatarRefs, groupAvatar: sourceInfo.groupAvatar }
          session.entries.set(id, entry); if (sourceInfo) session.targets.set(id, { kind: 'source', source: sourceInfo })
          if (locationRef) session.locationRefs.set(id, { ref: locationRef, recordUid: id.slice(5) })
          session.details.set(id, [{ id, occurredAtMillis: occurred, author: { name: '我' }, text: firstString(record.text_content) || entry.preview }])
        } else if (source === 'chat' || source === 'arko' || source === 'bot') {
          const kind: DayActivityKind = source === 'chat' ? sourceKind(item) : source
          if (!dayActivityMatchesFilter(session.query.kind, kind)) continue
          const id = `${source}:${firstString(item.entry_id, item.entryId, item.message_id, item.messageId) || `${occurred}:${session.entries.size}`}`
          const flags = listValue(item.relation_flags ?? item.relationFlags).map(stringValue)
          const sourceInfo = sourceItem(item)
          const title = source === 'bot' ? `与 ${firstString(item.bot_name, item.botName) || 'Bot'} 对话` : source === 'arko' ? '与 Arko 对话' : sourceInfo?.displayName || (kind === 'group_chat' ? '群聊互动' : '私聊互动')
          const identity = sourceInfo?.sourceKey || sourceIdentity(item)
          const role = numberValue(item.role)
          const entry: DayActivityEntry = { id, kind, startAtMillis: occurred, endAtMillis: occurred, title, preview: preview(item), sourceName: title, recordCount: 1, access: 'available', participation: source === 'arko' ? role === 2 ? 'self' : role === 3 ? 'received' : 'background' : flags.includes('mentioned_me') ? 'mentioned' : flags.includes('received') || flags.includes('replied_to_me') ? 'received' : 'self', ...(flags.length ? { statusLabel: relationLabel(flags) } : {}), ...(identity ? { sourceIdentity: identity } : {}), ...(sourceInfo && kind === 'private_chat' ? { participant: { name: sourceInfo.displayName } } : {}) }
          if (sourceInfo) entry.avatar = { avatarRef: sourceInfo.avatarRef, avatarRefs: sourceInfo.avatarRefs, groupAvatar: sourceInfo.groupAvatar }
          // A group name is not a speaker name. Missing actor information remains explicitly anonymous.
          const authorName = kind === 'private_chat' ? sourceInfo?.displayName : firstString(objectValue(item.relation).display_name_snapshot)
          if (authorName && entry.participation !== 'self') entry.previewAuthor = { name: authorName }
          session.entries.set(id, entry)
          const recordUid = firstString(objectValue(item.source_ref).record_uid, objectValue(item.relation).record_uid)
          if (sourceInfo && flags.includes('sent') && recordUid) {
            const link = `${sourceInfo.sourceKey || sourceInfo.sourceRef}|${recordUid}`
            session.chatRecordLinks.set(link, [...new Set([...(session.chatRecordLinks.get(link) ?? []), id])])
          }
          session.details.set(id, [{ id, occurredAtMillis: occurred, author: { name: entry.participation === 'self' ? '我' : firstString(objectValue(item.relation).display_name_snapshot) || sourceInfo?.displayName || entry.sourceName }, text: fullText(item) || entry.preview }])
          if (sourceInfo) session.targets.set(id, { kind: 'source', source: sourceInfo })
          if (source === 'arko') session.targets.set(id, { kind: 'arko' })
        } else if (source === 'call') {
          if (item.call_projection) {
            const call = item.call_projection as ArkmeCallHistoryItem, id = `call:${call.stableId}`
            session.calls.set(id, call)
            session.entries.set(id, { id, kind: 'call', startAtMillis: call.startedAtMillis, endAtMillis: Math.max(call.startedAtMillis, call.endedAtMillis),
              title: `与 ${call.peerDisplayName} ${call.mediaType === 'video' ? '视频通话' : '语音通话'}`, preview: call.summaryPreview || '', sourceName: '', recordCount: 1, access: 'available', participation: 'participated', avatar: { avatarRef: call.peerAvatarRef }, statusLabel: `${call.resultLabel}${call.durationSeconds > 0 ? ` · ${Math.floor(call.durationSeconds / 60)}:${String(call.durationSeconds % 60).padStart(2, '0')}` : ''}` })
            continue
          }
          const end = firstMillis(item.ended_at, item.endedAt, item.end_at, item.endAt) || occurred
          const id = `call:${firstString(item.call_id, item.callId, item.stable_id, item.stableId) || `${occurred}:${session.entries.size}`}`
          const title = `与 ${firstString(item.peer_display_name, item.peerDisplayName, item.participant_name, item.participantName) || '未命名用户'} ${firstString(item.media_type, item.mediaType) === 'video' ? '视频通话' : '语音通话'}`
          const summary = firstString(item.summary_preview, item.summaryPreview, item.summary, item.result_label, item.resultLabel)
          const entry: DayActivityEntry = { id, kind: 'call', startAtMillis: occurred, endAtMillis: Math.max(occurred, end), title, preview: summary, sourceName: '', recordCount: 1, access: 'available', participation: 'participated', statusLabel: firstString(item.result_label, item.resultLabel, item.call_result, item.callResult) }
          session.entries.set(id, entry); session.details.set(id, [{ id, occurredAtMillis: occurred, author: { name: title }, text: summary || '通话记录' }])
        }
      }
    } catch (error) {
      if (current !== session || signal.aborted) throw error
      state.loaded = true; state.hasMore = false; state.failed = error instanceof Error ? error.message : '读取失败'
      session.warnings.push(`${source} 数据加载失败，可刷新重试。`)
    }
  }
  const result = (session: ReadSession): DayActivityPage => {
    for (const [noteId, link] of session.recordLinks) {
      const note = session.entries.get(noteId)!
      for (const chatId of session.chatRecordLinks.get(link) ?? []) {
        const chat = session.entries.get(chatId)!
        session.entries.set(chatId, { ...chat, ...(note.location ? { location: note.location } : {}),
          ...(note.locationSummary ? { locationSummary: note.locationSummary } : {}), ...(note.canLoadLocation ? { canLoadLocation: true } : {}) })
        const ref = session.locationRefs.get(noteId)
        if (ref) session.locationRefs.set(chatId, ref)
        const content = session.details.get(noteId)?.[0]?.content
        if (content) session.details.set(chatId, (session.details.get(chatId) ?? []).map(item => ({ ...item, content })))
      }
    }
    const grouped = groupDayActivities([...session.entries.values()].filter(item => dayActivityMatchesFilter(session.query.kind, item.kind)
      && !session.chatRecordLinks.has(session.recordLinks.get(item.id) ?? '')), session.query.mode)
    session.groups = grouped.groups
    const missing = (Object.entries(session.sources) as Array<[SourceName, SourcePage]>).filter(([, state]) => state.failed || state.partial || !state.loaded || state.hasMore).flatMap(([source]): DayActivityKind[] => source === 'record' ? ['note'] : source === 'chat' ? ['private_chat', 'group_chat'] : source === 'audio' ? ['recording'] : [source])
    const hasMore = Object.values(session.sources).some(state => state.hasMore)
    session.page += 1
    return { query: session.query, snapshotId: session.id, order: 'descending', replaceItems: true, items: grouped.items, completeness: missing.length || hasMore ? 'partial' : 'complete', missingKinds: [...new Set(missing)], hasMore, ...(hasMore ? { nextCursor: `${session.id}:${session.page}` } : {}), dayStartMillis: session.start, dayEndMillis: session.end, warnings: [...new Set(session.warnings)], ...(session.coverage ? { coverage: session.coverage } : {}), ...(session.speechIntervals.length ? { speechIntervals: session.speechIntervals } : {}), notice: '数据按来源独立读取；概览只统计当前已加载内容，不代表全天完整总量。' }
  }
  return {
    capabilities: { kinds: ['note', 'private_chat', 'group_chat', 'call', 'recording', 'arko', 'bot', 'dsh'], modes: ['activities', 'records'], autoLocationLimit: 0, background: false, notice: '私聊、群聊、通话、录音、Arko、Bot 与个人记录按来源独立读取；来源失败或历史不完整时会保留明确状态。' },
    async loadDay(query, options) {
      if (!accountScope || query.accountScope !== accountScope) throw new Error('账号范围不一致，请重新打开日历')
      let session = current
      if (options.cursor) {
        if (!session || session.id !== options.snapshotId || session.key !== dayActivityQueryKey(query) || options.cursor !== `${session.id}:${session.page}`) throw new Error('活动分页已过期，请刷新')
      } else {
        const [start, end] = localDayBounds(query)
        const wants = (kind: DayActivityKind) => dayActivityMatchesFilter(query.kind, kind)
        const state = (enabled: boolean): SourcePage => ({ hasMore: enabled, loaded: !enabled })
        session = { id: `documented-read-${++revision}`, key: dayActivityQueryKey(query), query, start, end, page: 0, entries: new Map(), details: new Map(), targets: new Map(), groups: new Map(), calls: new Map(), recordings: new Map(), recordLinks: new Map(), chatRecordLinks: new Map(), locationRefs: new Map(), sources: { record: state(['note', 'dsh', 'private_chat', 'group_chat'].some(kind => wants(kind as DayActivityKind))), chat: state(wants('private_chat') || wants('group_chat')), call: state(wants('call')), audio: state(wants('recording')), arko: state(wants('arko')), bot: state(wants('bot')) }, speechIntervals: [], warnings: [] }
        current = session
      }
      const sources: SourceName[] = ['record', 'chat', 'call', 'audio', 'arko', 'bot']
      await Promise.all(sources.filter(source => session!.sources[source].hasMore || !session!.sources[source].loaded).map(source => readSource(session!, source, options.signal)))
      options.signal.throwIfAborted()
      if (current !== session) throw new Error('日期或账号已变化，请刷新')
      return result(session)
    },
    async loadDetail(query, activityId, options) {
      if (!current || current.id !== options.snapshotId || current.key !== dayActivityQueryKey(query)) throw new Error('活动详情已过期，请刷新')
      const entry = current.entries.get(activityId)
      if (!entry) throw new Error('活动不存在，请刷新')
      options.signal.throwIfAborted()
      const session = current, common = { query, activityId, snapshotId: session.id, access: entry.access }
      const call = session.calls.get(activityId)
      if (call?.canOpenDetail) {
        const detail = await read<ArkmeCallDetail>('calls.history.detail', { callRef: call.callRef }, options.signal)
        options.signal.throwIfAborted()
        if (current !== session || detail.stableId !== call.stableId) throw new Error('通话详情已变化，请刷新')
        return { ...common, items: [], hasMore: false, call: { item: call, detail } }
      }
      const recordingId = session.recordings.get(activityId)
      if (recordingId) {
        const data = payloadData(await request('audio', 'transcripts', { recording_id: recordingId, start_at: entry.startAtMillis, end_at: entry.endAtMillis, limit: 50, direction: 'asc', ...(options.cursor ? { cursor: options.cursor } : {}) }, options.signal))
        options.signal.throwIfAborted()
        if (current !== session) throw new Error('日期已变化，请刷新')
        return { ...common, items: listValue(data.items).map(objectValue).map(item => ({ id: firstString(item.entry_id), occurredAtMillis: firstMillis(item.occurred_at), author: { name: firstString(objectValue(item.speaker).label) || '未标记说话人' }, text: firstString(item.text) })), hasMore: data.has_more === true, ...(data.next_cursor ? { nextCursor: String(data.next_cursor) } : {}), sourceRef: `${session.id}|${activityId}` }
      }
      const members = session.groups.get(activityId) ?? [entry]
      const offset = options.cursor ? Number(options.cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 50 || offset > members.length) throw new Error('详情分页无效')
      const items = [...members].reverse().slice(offset, offset + 50).flatMap(member => session.details.get(member.id) ?? [])
      return { ...common, items, hasMore: offset + 50 < members.length, ...(offset + 50 < members.length ? { nextCursor: String(offset + 50) } : {}), ...(session.targets.has(activityId) ? { sourceRef: `${session.id}|${activityId}` } : {}) }
    },
    async loadLocation(query, activityId, options) {
      if (!current || current.id !== options.snapshotId || current.key !== dayActivityQueryKey(query)) throw new Error('地点详情已过期，请刷新')
      const entry = (current.groups.get(activityId) ?? []).find(member => member.canLoadLocation || member.locationSummary) ?? current.entries.get(activityId)
      if (!entry?.canLoadLocation && !entry?.locationSummary) throw new Error('此活动暂无可读取的地点')
      if (entry.locationSummary && !current.locationRefs.has(entry.id)) return { query, activityId, snapshotId: current.id, access: 'available' as const }
      const session = current
      const capability = session.locationRefs.get(entry.id)
      const value = await read<ArkmeCalendarRecordLocation>('calendar.record-location', { locationRef: capability?.ref ?? '' }, options.signal)
      options.signal.throwIfAborted()
      if (current !== session || value.recordUid !== capability?.recordUid) throw new Error('地点与当前记录不一致，请刷新')
      return { query, activityId, snapshotId: session.id, access: value.access, ...(value.access === 'available' && value.location ? { location: value.location } : {}) }
    },
    resolveTarget(ref) { return current && ref.startsWith(`${current.id}|`) ? current.targets.get(ref.slice(current.id.length + 1)) : undefined },
  }
}
