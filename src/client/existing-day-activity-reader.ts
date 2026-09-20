import type { ArkmeCalendarRecordLocation, ArkmeCalendarDayRecordPage, ArkmeCalendarRecordItem, ArkmeRecordingDay, ArkmeRecordingCoverageInterval,
  ArkmeRecordingWorkbenchItem, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { dayActivityQueryKey, type DayActivityReader, type DayActivityQuery, type DayActivityEntry,
  type DayActivityPage, type DayActivityDetailPage } from './calendar-activity-model.js'

const NOTE_PAGE_SIZE = 20
const DISPLAY_PAGE_SIZE = 40
const DETAIL_PAGE_SIZE = 50
export type ExistingDayTarget = { kind: 'source'; source: ArkmeSourceItem }
  | { kind: 'recording'; dateStamp: number; startAtMillis: number }

export function personalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** recordings.day currently takes device-local midnight. Do not silently mix timezones. */
export function existingDayBounds(query: DayActivityQuery): [number, number] {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (query.timezone !== localZone) throw new Error('当前录音接口仅支持设备所在时区，请重新打开日历')
  const [year, month, day] = query.bucketDate.split('-').map(Number)
  const start = new Date(year!, month! - 1, day!)
  if (personalDateKey(start) !== query.bucketDate) throw new Error('日期无效')
  const end = new Date(start); end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}

/** Only join physically touching/overlapping intervals from the same source/status. Never fill a gap. */
export function continuousRecordingIntervals(intervals: readonly ArkmeRecordingCoverageInterval[]): ArkmeRecordingCoverageInterval[] {
  const groups = new Map<string, ArkmeRecordingCoverageInterval[]>()
  for (const interval of intervals) {
    if (!Number.isFinite(interval.startAtMillis) || !Number.isFinite(interval.endAtMillis) || interval.endAtMillis <= interval.startAtMillis) continue
    const key = JSON.stringify([interval.sourceLabel, interval.status])
    const group = groups.get(key) ?? []; group.push({ ...interval }); groups.set(key, group)
  }
  return [...groups.values()].flatMap(group => {
    const result: ArkmeRecordingCoverageInterval[] = []
    for (const item of group.sort((a, b) => a.startAtMillis - b.startAtMillis)) {
      const last = result.at(-1)
      if (last && item.startAtMillis <= last.endAtMillis) last.endAtMillis = Math.max(last.endAtMillis, item.endAtMillis)
      else result.push(item)
    }
    return result
  })
}

interface ReadSession {
  id: string; key: string; query: DayActivityQuery; start: number; end: number; cursor: number
  notes: Map<string, ArkmeCalendarRecordItem>; transcripts: Map<string, ArkmeRecordingWorkbenchItem[]>
  entries: Map<string, DayActivityEntry>; pending: DayActivityEntry[]; targets: Map<string, ExistingDayTarget>
  notesMore: boolean; noteCursor?: NonNullable<ArkmeCalendarDayRecordPage['nextCursor']>
  noteCursors: Set<string>; watermark: number; missingNotes: boolean; recording?: ArkmeRecordingDay
  recordingFailed: boolean; recordingUnsupported: boolean
}

/** Uses existing backend reads through the Host. One session is retained per mounted calendar. */
export function createExistingDayActivityReader(accountScope: string, read: typeof callArkme = callArkme): DayActivityReader & {
  resolveTarget(ref: string): ExistingDayTarget | undefined
} {
  let current: ReadSession | undefined
  let revision = 0
  const assertActive = (session: ReadSession, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (session !== current) throw new Error('日期或账号已变化，请刷新')
  }
  const loadNotes = async (session: ReadSession, signal: AbortSignal) => {
    const page = await withArkmeReadDeadline(requestSignal => read<ArkmeCalendarDayRecordPage>('calendar.records', {
      bucketDate: session.query.bucketDate, timezone: session.query.timezone, limit: NOTE_PAGE_SIZE,
      ...(session.noteCursor ? { cursor: session.noteCursor } : {}),
    }, requestSignal), signal)
    assertActive(session, signal)
    if (page.bucketDate !== session.query.bucketDate || page.timezone !== session.query.timezone) throw new Error('个人记录日期不一致')
    if (page.hasMore) {
      if (!page.nextCursor || !Number.isFinite(page.nextCursor.sendAtMillis)
        || !page.nextCursor.recordUid || page.nextCursor.sendAtMillis > session.watermark) throw new Error('个人记录分页异常，请刷新')
      const key = JSON.stringify(page.nextCursor)
      if (session.noteCursors.has(key)) throw new Error('个人记录分页已失效，请刷新')
      session.noteCursors.add(key)
      session.noteCursor = page.nextCursor
      session.watermark = page.nextCursor.sendAtMillis
    } else session.watermark = -Infinity
    session.notesMore = page.hasMore
    for (const item of page.items) {
      if (!item.recordUid || !Number.isFinite(item.sendAtMillis) || item.sendAtMillis < session.start || item.sendAtMillis >= session.end) continue
      const id = `note:${item.recordUid}`
      if (session.notes.has(id)) continue
      session.notes.set(id, item)
      const available = item.accessState === 'available' && !item.protected
      const kind = item.creationSource === 3 || item.content?.agentSource?.kind === 'dsh_agent_input' ? 'dsh'
        : item.source?.kind === 'private_chat' ? 'private_chat' : item.source?.kind === 'group_chat' ? 'group_chat' : 'note'
      const entry: DayActivityEntry = { id, kind, startAtMillis: item.sendAtMillis, endAtMillis: item.sendAtMillis,
        ...(available && item.content?.callRecord?.stableId ? { relatedCallId: item.content.callRecord.stableId } : {}),
        ...(available && item.source ? { sourceIdentity: item.source.sourceKey || item.source.sourceRef } : {}),
        ...(available && kind === 'private_chat' ? { participant: { name: item.source!.displayName } } : {}),
        ...(available && item.locationObservation ? { location: item.locationObservation } : {}),
        ...(available && item.locationRef ? { canLoadLocation: true } : {}),
        access: available ? 'available' : 'restricted', title: available ? kind === 'dsh' ? 'DSH · 我提交的输入'
          : kind === 'group_chat' ? `${item.source!.displayName} · 我参与的讨论` : item.title || '我的记录' : '',
        preview: available ? (item.preview || item.textContent).slice(0, 240) : '',
        sourceName: available ? item.source?.displayName || item.topicTitle || '我发送的内容' : '', recordCount: 1, participation: 'self',
        ...(kind === 'private_chat' || kind === 'group_chat' ? { statusLabel: '仅我发送的记录' }
          : kind === 'dsh' ? { statusLabel: '已同步输入，不代表完整工作过程' } : {}) }
      session.pending.push(entry); session.entries.set(id, entry)
      if (available && item.source) session.targets.set(id, { kind: 'source', source: item.source })
    }
  }

  const addRecordings = (session: ReadSession) => {
    const recording = session.recording
    if (!recording) return
    const owned = [...new Map(recording.transcript.items.filter(item => item.recordingBelongsToViewer === true
      && Number.isFinite(item.startAtMillis) && Number.isFinite(item.endAtMillis)).map(item => [item.itemId, item])).values()]
    const intervals = continuousRecordingIntervals(recording.coverage?.intervals ?? [])
    for (const interval of intervals) {
      if (interval.endAtMillis <= session.start || interval.startAtMillis >= session.end) continue
      const id = `recording:${JSON.stringify([interval.startAtMillis, interval.endAtMillis, interval.sourceLabel, interval.status])}`
      const items = owned.filter(item => item.startAtMillis < interval.endAtMillis && item.endAtMillis > interval.startAtMillis)
      session.transcripts.set(id, items)
      const entry: DayActivityEntry = { id, kind: 'recording', ...interval, access: 'available', title: '录音时段',
        preview: items.length ? items.slice(0, 2).map(item => item.text).join(' ').slice(0, 240)
          : recording.transcript.state === 'error' || recording.transcript.state === 'failed' ? '转写暂不可用，音频覆盖仍可查看' : '已记录声音，暂无已识别转写',
        sourceName: interval.sourceLabel, recordCount: items.length, participation: 'self' }
      session.entries.set(id, entry); session.pending.push(entry)
      session.targets.set(id, { kind: 'recording', dateStamp: session.start, startAtMillis: Math.max(session.start, interval.startAtMillis) })
    }
  }
  const page = (session: ReadSession): DayActivityPage => {
    // Hold older audio until the note cursor reaches it. Never fetch all notes to sort a day.
    const eligible = session.pending.filter(item => item.startAtMillis >= session.watermark)
      .sort((a, b) => b.startAtMillis - a.startAtMillis || b.id.localeCompare(a.id)).slice(0, DISPLAY_PAGE_SIZE)
    const ids = new Set(eligible.map(item => item.id))
    session.pending = session.pending.filter(item => !ids.has(item.id))
    const hasMore = session.notesMore || session.pending.length > 0
    session.cursor += 1
    const missingKinds: DayActivityPage['missingKinds'] = ['private_chat', 'group_chat', 'call']
    if (session.missingNotes) missingKinds.push('note')
    if (session.recordingFailed || session.recordingUnsupported || session.recording?.coverage?.state !== 'ready'
      || session.recording.transcript.state === 'error' || session.recording.transcript.state === 'failed') missingKinds.push('recording')
    return { query: session.query, snapshotId: session.id, order: 'descending', items: eligible, completeness: 'partial', missingKinds,
      hasMore, ...(hasMore ? { nextCursor: `${session.id}:${session.cursor}` } : {}), dayStartMillis: session.start, dayEndMillis: session.end,
      coverage: session.recording?.coverage ?? { state: 'error', intervals: [] },
      ...(session.recording ? { recordingReview: { summary: session.recording.summary, timeline: session.recording.timeline } } : {}),
      warnings: [session.missingNotes ? '个人记录加载失败，可刷新重试。' : '',
        session.recordingFailed ? '录音数据加载失败，可刷新重试。' : '',
        session.recording?.transcript.state === 'error' || session.recording?.transcript.state === 'failed' ? '录音转写暂不可用，可以刷新重试。' : ''].filter(Boolean),
      speechIntervals: (session.recording?.transcript.items ?? []).filter(item => item.recordingBelongsToViewer === true && !item.isBackground && item.text.trim() !== '')
        .map(item => ({ startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis })),
      notice: session.recordingUnsupported ? '这一天早于现有录音接口支持范围，仅显示个人记录。'
        : session.recording?.transcript.state === 'error' || session.recording?.transcript.state === 'failed' ? '录音转写暂不可用，可以刷新重试。' : '',
    }
  }

  return {
    capabilities: { kinds: ['note', 'recording'], modes: ['activities'],
      notice: '先显示自己的记录和已同步云端、明确归属于本人的录音，按时间由近到远排列。记录包括发给自己、私聊和群聊中我发送的内容；完整聊天往来、通话和智能活动分段尚未接入。' },
    async loadDay(query, options) {
      options.signal.throwIfAborted()
      if (!accountScope || query.accountScope !== accountScope) throw new Error('账号范围不一致，请重新打开日历')
      if (!['all', 'note', 'recording'].includes(query.kind)) throw new Error('此类活动尚未接入')
      if (options.cursor) {
        const session = current
        if (!session || session.key !== dayActivityQueryKey(query) || options.snapshotId !== session.id
          || options.cursor !== `${session.id}:${session.cursor}`) throw new Error('分页已过期，请刷新')
        if (session.notesMore && !session.pending.some(item => session.notes.has(item.id))) await loadNotes(session, options.signal)
        assertActive(session, options.signal)
        return page(session)
      }
      const [start, end] = existingDayBounds(query)
      const session: ReadSession = { id: `local-read-${++revision}`, key: dayActivityQueryKey(query), query, start, end, cursor: 0,
        notes: new Map(), transcripts: new Map(), entries: new Map(), pending: [], targets: new Map(), notesMore: query.kind !== 'recording',
        noteCursors: new Set(), watermark: query.kind === 'recording' ? -Infinity : Infinity, missingNotes: false,
        recordingFailed: false, recordingUnsupported: !isRecordingLocalDateOnOrAfterMinimum(start) }
      current = session
      await Promise.all([
        query.kind === 'recording' ? Promise.resolve() : loadNotes(session, options.signal).catch(() => {
          assertActive(session, options.signal)
          session.missingNotes = true; session.notesMore = false; session.watermark = -Infinity
        }),
        session.recordingUnsupported ? Promise.resolve() : withArkmeReadDeadline(requestSignal => read<ArkmeRecordingDay>('recordings.day', { dateStamp: start }, requestSignal), options.signal).then(value => {
          assertActive(session, options.signal)
          if (value.dateStamp !== start) throw new Error('录音日期不一致')
          session.recording = value
        }).catch(() => { assertActive(session, options.signal); session.recordingFailed = true }),
      ])
      assertActive(session, options.signal)
      if (query.kind !== 'note') addRecordings(session)
      return page(session)
    },
    async loadLocation(query, activityId, options) {
      const session = current
      if (!session || session.key !== dayActivityQueryKey(query) || options.snapshotId !== session.id) throw new Error('地点详情已过期，请刷新')
      assertActive(session, options.signal)
      const note = session.notes.get(activityId)
      if (!note || note.accessState !== 'available' || note.protected || !note.locationRef) throw new Error('此记录暂不能读取地点')
      const result = await withArkmeReadDeadline(signal => read<ArkmeCalendarRecordLocation>('calendar.record-location',
        { locationRef: note.locationRef }, signal), options.signal)
      assertActive(session, options.signal)
      if (result.recordUid !== note.recordUid || !['available', 'restricted'].includes(result.access)) throw new Error('地点与当前记录不一致，请刷新')
      return { query, activityId, snapshotId: session.id, access: result.access,
        ...(result.access === 'available' && result.location ? { location: result.location } : {}) }
    },
    async loadDetail(query, activityId, options) {
      const session = current
      if (!session || session.key !== dayActivityQueryKey(query) || options.snapshotId !== session.id) throw new Error('详情已过期，请刷新')
      assertActive(session, options.signal)
      const entry = session.entries.get(activityId)
      if (!entry) throw new Error('活动不存在，请刷新')
      const base = { query, activityId, snapshotId: session.id, access: entry.access }
      if (entry.access !== 'available') return { ...base, items: [], hasMore: false }
      const note = session.notes.get(activityId)
      const items: DayActivityDetailPage['items'] = note ? [{ id: note.recordUid, occurredAtMillis: note.sendAtMillis,
        author: { name: '我' }, text: note.textContent || note.preview,
        content: note.content ?? { itemUid: note.recordUid, senderName: '我', isMe: true, status: 1, sendAtMillis: note.sendAtMillis,
          title: note.title, textContent: note.textContent || note.preview, templateKind: note.templateKind, displayKind: note.displayKind,
          ...(note.textFormat ? { textFormat: note.textFormat } : {}) } }]
        : [...new Map((session.transcripts.get(activityId) ?? []).map(item => [item.itemId, item])).values()]
          .sort((a, b) => a.startAtMillis - b.startAtMillis).map(item => ({ id: item.itemId, occurredAtMillis: item.startAtMillis,
            author: { name: item.speakerLabel }, text: item.text }))
      const offset = options.cursor ? Number(options.cursor) : 0
      if (!Number.isInteger(offset) || offset < 0 || offset % DETAIL_PAGE_SIZE !== 0 || offset > items.length) throw new Error('详情分页无效')
      const hasMore = offset + DETAIL_PAGE_SIZE < items.length
      return { ...base, items: items.slice(offset, offset + DETAIL_PAGE_SIZE), hasMore,
        ...(hasMore ? { nextCursor: String(offset + DETAIL_PAGE_SIZE) } : {}),
        ...(session.targets.has(activityId) ? { sourceRef: `${session.id}|${activityId}` } : {}) }
    },
    resolveTarget(ref) {
      return current && ref.startsWith(`${current.id}|`) ? current.targets.get(ref.slice(current.id.length + 1)) : undefined
    },
  }
}
