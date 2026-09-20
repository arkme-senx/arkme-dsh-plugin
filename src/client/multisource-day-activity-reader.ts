import type { ArkmeArkoHistoryPage, ArkmeBotConversation, ArkmeBotList, ArkmeBotSummary,
  ArkmeCallHistoryItem, ArkmeCallHistoryPage, ArkmeCallDetail } from '../types.js'
import { callArkme } from './api.js'
import { createExistingDayActivityReader, existingDayBounds, type ExistingDayTarget } from './existing-day-activity-reader.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { dayActivityMatchesFilter, dayActivityQueryKey, type DayActivityReader, type DayActivityEntry, type DayActivityQuery,
  type DayActivityPage, type DayActivityDetailPage, type DayActivityKind } from './calendar-activity-model.js'

const PAGE_SIZE = 20
const GROUP_GAP = 15 * 60_000
const KINDS: DayActivityKind[] = ['note', 'private_chat', 'group_chat', 'call', 'arko', 'bot', 'dsh', 'recording']
type Target = ExistingDayTarget | { kind: 'arko' } | { kind: 'bot'; bot: ArkmeBotSummary }
type DetailItem = DayActivityDetailPage['items'][number]
interface Session {
  id: string; query: DayActivityQuery; baseQuery: DayActivityQuery; start: number; end: number; page: number
  base?: DayActivityPage; entries: Map<string, DayActivityEntry>; aiEntries: Map<string, DayActivityEntry>
  messages: Map<string, DetailItem>; calls: Map<string, ArkmeCallHistoryItem>; targets: Map<string, Target>
  groups: Map<string, DayActivityEntry[]>; missing: Set<DayActivityKind>
  warnings: Set<string>
  callsMore: boolean; callCursor?: string; callCursors: Set<string>
  arkoMore: boolean; arkoOffset: number; botQueue: ArkmeBotSummary[]; bots?: ArkmeBotList
}

/** Join only an explicit same-source identity within 15 minutes. The span is not work duration. */
export function groupDayActivities(entries: readonly DayActivityEntry[], mode: DayActivityQuery['mode']) {
  const groups = new Map<string, DayActivityEntry[]>()
  const bySource = new Map<string, DayActivityEntry[][]>()
  for (const entry of [...entries].sort((a, b) => b.startAtMillis - a.startAtMillis || a.id.localeCompare(b.id))) {
    const canGroup = mode === 'activities' && entry.access === 'available' && entry.sourceIdentity
      && ['private_chat', 'group_chat', 'arko', 'bot', 'dsh'].includes(entry.kind)
    const key = JSON.stringify([entry.kind, entry.sourceIdentity])
    const buckets = bySource.get(key) ?? []
    const last = buckets.at(-1)
    if (canGroup && last && last.at(-1)!.startAtMillis - entry.startAtMillis <= GROUP_GAP) last.push(entry)
    else {
      const group = [entry]; groups.set(entry.id, group)
      if (canGroup) { buckets.push(group); bySource.set(key, buckets) }
    }
  }
  const items = [...groups].map(([id, members]) => {
    const latest = members[0]!
    const place = members.find(member => member.location)
    return { ...latest, id, startAtMillis: Math.min(...members.map(item => item.startAtMillis)),
      endAtMillis: Math.max(...members.map(item => item.endAtMillis)),
      recordCount: members.reduce((sum, item) => sum + item.recordCount, 0),
      ...(members.some(item => item.canLoadLocation) ? { canLoadLocation: true } : {}),
      ...(place?.location ? { location: place.location } : {}) }
  }).sort((a, b) => b.startAtMillis - a.startAtMillis || a.id.localeCompare(b.id))
  return { groups, items }
}

/** Bounded, explicitly paged composition. No auto-open/ensure, no read receipt, no history fan-out. */
export function createMultisourceDayActivityReader(accountScope: string, read: typeof callArkme = callArkme): DayActivityReader & {
  resolveTarget(ref: string): Target | undefined
} {
  const base = createExistingDayActivityReader(accountScope, read)
  let current: Session | undefined, revision = 0
  const active = (session: Session, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (current !== session) throw new Error('日期或账号已变化，请刷新')
  }
  const request = <T,>(operation: Parameters<typeof callArkme>[0], params: Record<string, unknown>, signal: AbortSignal) =>
    withArkmeReadDeadline(s => read<T>(operation, params, s), signal)
  const wants = (session: Session, kind: DayActivityKind) => dayActivityMatchesFilter(session.query.kind, kind)
  const inDay = (session: Session, time: number) => Number.isFinite(time) && time >= session.start && time < session.end
  const loadBase = async (session: Session, signal: AbortSignal) => {
    if (session.base && !session.base.hasMore) return
    const page = await base.loadDay(session.baseQuery, { signal, ...(session.base?.nextCursor ? {
      cursor: session.base.nextCursor, snapshotId: session.base.snapshotId } : {}) })
    active(session, signal); session.base = page
    for (const entry of page.items) session.entries.set(entry.id, entry)
  }
  const loadCalls = async (session: Session, signal: AbortSignal) => {
    if (!session.callsMore) return
    try {
      const page = await request<ArkmeCallHistoryPage>('calls.history.list', { limit: PAGE_SIZE, includeRecentContacts: false,
        ...(session.callCursor ? { cursor: session.callCursor } : {}) }, signal)
      active(session, signal)
      if (!Array.isArray(page.items)) throw new Error('通话历史格式不一致')
      if (page.hasMore && (!page.nextCursor || session.callCursors.has(page.nextCursor))) throw new Error('通话游标失效')
      if (page.nextCursor) { session.callCursors.add(page.nextCursor); session.callCursor = page.nextCursor }
      session.callsMore = page.hasMore
      for (const item of page.items) {
        if (!item.stableId || !item.callRef || !Number.isFinite(item.startedAtMillis) || item.startedAtMillis <= 0) continue
        const end = Number.isFinite(item.endedAtMillis) ? Math.max(item.startedAtMillis, item.endedAtMillis) : item.startedAtMillis
        if (item.startedAtMillis >= session.end || end < session.start || end === session.start && item.startedAtMillis < session.start) continue
        const id = `call:${item.stableId}`
        // A terminal no-answer/cancel result wins over inconsistent acceptedAt/duration fields.
        const resultLabel = /busy/i.test(item.callResult) ? '对方忙线' : item.resultLabel
        const connected = resultLabel === '已接通' || !resultLabel && item.acceptedAtMillis > 0
        const seconds = Number.isFinite(item.durationSeconds) ? Math.max(0, Math.floor(item.durationSeconds)) : 0
        const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`
        session.calls.set(id, item)
        session.entries.set(id, { id, kind: 'call', startAtMillis: item.startedAtMillis, endAtMillis: end,
          title: `与 ${item.peerDisplayName || '未命名用户'} ${item.mediaType === 'video' ? '视频通话' : item.mediaType === 'audio' ? '语音通话' : '通话'}`,
          preview: (item.summaryPreview || '').slice(0, 240), access: 'available', sourceName: '', recordCount: 1, participation: 'participated',
          statusLabel: connected ? `${resultLabel || '已接通'} · ${duration}` : resultLabel || '状态未知' })
      }
    } catch { active(session, signal); session.missing.add('call'); session.callsMore = false; session.warnings.add('通话记录加载失败，可刷新重试。') }
  }
  const loadArko = async (session: Session, signal: AbortSignal) => {
    if (!session.arkoMore) return
    try {
      const page = await request<ArkmeArkoHistoryPage>('arko.history', { limit: PAGE_SIZE, offset: session.arkoOffset }, signal)
      active(session, signal)
      if (!Array.isArray(page.items) || page.hasMore && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset! <= session.arkoOffset)) throw new Error('Arko 分页失效')
      session.arkoMore = page.hasMore
      session.arkoOffset = page.nextOffset ?? session.arkoOffset
      for (const item of page.items) {
        if (!inDay(session, item.createdAtMillis) || !item.messageId) continue
        // Only the explicit input Record link deduplicates calendar records, never createdRecordUids.
        const id = item.role === 'user' && item.entryRecordUid ? `note:${item.entryRecordUid}` : `arko:${item.sessionId}:${item.messageId}`
        session.aiEntries.set(id, { id, kind: 'arko', startAtMillis: item.createdAtMillis, endAtMillis: item.createdAtMillis,
          title: '与 Arko 对话', sourceIdentity: `arko:${item.sessionId}`, preview: (item.role === 'assistant' ? arkmeMarkdownPlainText(item.text) : item.text).slice(0, 240),
          access: 'available', sourceName: 'Arko', recordCount: 1, participation: item.role === 'user' ? 'self' : 'received' })
        session.messages.set(id, { id, occurredAtMillis: item.createdAtMillis, author: { name: item.role === 'user' ? '我' : 'Arko' }, text: item.text,
          textFormat: item.role === 'assistant' ? 'markdown' : 'plain' })
        session.targets.set(id, { kind: 'arko' })
      }
    } catch { active(session, signal); session.missing.add('arko'); session.arkoMore = false; session.warnings.add('Arko 记录加载失败，可刷新重试。') }
  }
  const loadBots = async (session: Session, signal: AbortSignal) => {
    if (!wants(session, 'bot')) return
    try {
      if (!session.bots) {
        const bots = await request<ArkmeBotList>('bots.list', {}, signal)
        active(session, signal)
        if (!Array.isArray(bots.items)) throw new Error('Bot 列表无效')
        session.bots = bots
        session.botQueue = bots.items.filter(bot => bot.directChatAvailable && bot.conversationProjection === 'chat')
        if (bots.items.some(bot => bot.conversationProjection !== 'chat')) session.missing.add('bot')
      }
      // Only two existing Chat-owned Bots per user-requested page; Subject open is never called.
      const bots = session.botQueue.splice(0, 2)
      await Promise.all(bots.map(async bot => {
        try {
          const conversation = await request<ArkmeBotConversation>('bots.private-chat.history.read', { botRef: bot.botRef }, signal)
          active(session, signal)
          if (!Array.isArray(conversation.messages)) throw new Error('Bot 历史无效')
          // Current Bot read exposes only a latest window, no complete date pagination contract.
          session.missing.add('bot')
          for (const item of conversation.messages) {
            if (!item.messageId || !inDay(session, item.createdAtMillis)) continue
            const id = item.recordUid ? `note:${item.recordUid}` : `bot:${bot.directoryKey || bot.botRef}:${item.messageId}`
            session.aiEntries.set(id, { id, kind: 'bot', startAtMillis: item.createdAtMillis, endAtMillis: item.createdAtMillis,
              title: `与 ${bot.name} 对话`, sourceIdentity: bot.chatSourceKey || bot.directoryKey || bot.botRef,
              preview: item.content.slice(0, 240), access: 'available', sourceName: bot.name, recordCount: 1,
              participation: item.role === 'user' ? 'self' : 'received', statusLabel: '已加载的近期消息' })
            session.messages.set(id, { id, occurredAtMillis: item.createdAtMillis, author: { name: item.role === 'user' ? '我' : bot.name },
              text: item.content || item.attachments.map(attachment => `[${attachment.fileName || attachment.kind}]`).join(' ') })
            session.targets.set(id, { kind: 'bot', bot })
          }
        } catch { active(session, signal); session.missing.add('bot'); session.warnings.add('部分 Bot 记录加载失败，可刷新重试。') }
      }))
    } catch { active(session, signal); session.missing.add('bot'); session.botQueue = []; session.bots = { items: [] }; session.warnings.add('Bot 列表加载失败，可刷新重试。') }
  }
  const result = (session: Session): DayActivityPage => {
    const merged = new Map(session.entries)
    for (const [id, entry] of session.aiEntries) {
      const record = merged.get(id)
      if (record?.access === 'restricted') continue
      merged.set(id, { ...record, ...entry })
    }
    // Bot identity is explicit; never classify by a nickname resembling a Bot.
    for (const [id, entry] of merged) {
      const bot = session.bots?.items.find(bot => bot.chatSourceKey && bot.chatSourceKey === entry.sourceIdentity)
      if (bot && entry.access === 'available' && entry.kind === 'private_chat') merged.set(id, { ...entry, kind: 'bot', title: `与 ${bot.name} 对话` })
      if (session.query.kind === 'all' && session.query.mode === 'activities' && entry.relatedCallId && session.calls.has(`call:${entry.relatedCallId}`)) merged.delete(id)
    }
    const grouped = groupDayActivities([...merged.values()].filter(entry => wants(session, entry.kind)), session.query.mode)
    session.groups = grouped.groups
    const missing = new Set(session.missing)
    if (wants(session, 'private_chat')) missing.add('private_chat')
    if (wants(session, 'group_chat')) missing.add('group_chat')
    if (wants(session, 'dsh')) missing.add('dsh')
    if (session.callsMore) missing.add('call')
    if (session.arkoMore) missing.add('arko')
    if (session.botQueue.length) missing.add('bot')
    for (const kind of session.base?.missingKinds ?? []) if (['note', 'recording'].includes(kind) && wants(session, kind)) missing.add(kind)
    const hasMore = !!session.base?.hasMore || session.callsMore || session.arkoMore || session.botQueue.length > 0
    session.page += 1
    return { query: session.query, snapshotId: session.id, order: 'descending', replaceItems: true, items: grouped.items,
      completeness: missing.size || hasMore ? 'partial' : 'complete', missingKinds: [...missing], hasMore,
      ...(hasMore ? { nextCursor: `${session.id}:${session.page}` } : {}), dayStartMillis: session.start, dayEndMillis: session.end,
      ...(session.base?.coverage ? { coverage: session.base.coverage } : {}),
      ...(session.base?.recordingReview ? { recordingReview: session.base.recordingReview } : {}),
      warnings: [...new Set([...(session.base?.warnings ?? []), ...session.warnings])],
      ...(session.base?.speechIntervals ? { speechIntervals: session.base.speechIntervals } : {}),
      notice: [session.base?.notice, session.callsMore || session.arkoMore ? '通话 / Arko 历史仍有未加载页；较早日期可继续加载，不能据此判断当天没有活动。' : '',
        missing.has('bot') ? 'Bot 暂仅展示可安全读取的近期记录；旧版 Bot 与更早历史未完整接入。' : ''].filter(Boolean).join(' ') }
  }
  const sessionFor = (query: DayActivityQuery, snapshotId: string, signal: AbortSignal) => {
    const session = current
    if (!session || session.id !== snapshotId || dayActivityQueryKey(query) !== dayActivityQueryKey(session.query)) throw new Error('活动详情已过期，请刷新')
    active(session, signal); return session
  }
  return {
    capabilities: { kinds: KINDS, modes: ['activities', 'records'], autoLocationLimit: 8, background: false,
      notice: '同一会话相邻 15 分钟内的记录合为片段，时间跨度不代表持续工作时长。私聊 / 群聊暂以我发送的记录为线索，DSH 暂为已同步输入；通话、Arko 与可只读的 Bot 逐页补入。' },
    async loadDay(query, options) {
      options.signal.throwIfAborted()
      if (!accountScope || query.accountScope !== accountScope) throw new Error('账号范围不一致，请重新打开日历')
      let session = current
      if (options.cursor) {
        session = sessionFor(query, options.snapshotId ?? '', options.signal)
        if (options.cursor !== `${session.id}:${session.page}`) throw new Error('活动分页已过期，请刷新')
      } else {
        const [start, end] = existingDayBounds(query)
        const onlyExternal = ['call', 'arko', 'bot', 'recording'].includes(query.kind)
        session = { id: `multi-read-${++revision}`, query, baseQuery: { ...query, kind: onlyExternal ? 'recording' : 'all' },
          start, end, page: 0, entries: new Map(), aiEntries: new Map(), messages: new Map(), calls: new Map(), targets: new Map(),
          groups: new Map(), missing: new Set(), warnings: new Set(), callsMore: dayActivityMatchesFilter(query.kind, 'call'), callCursors: new Set(),
          arkoMore: dayActivityMatchesFilter(query.kind, 'arko'), arkoOffset: 0, botQueue: [] }
        current = session
      }
      await Promise.all([loadBase(session, options.signal), loadCalls(session, options.signal), loadArko(session, options.signal), loadBots(session, options.signal)])
      active(session, options.signal)
      return result(session)
    },
    async loadDetail(query, activityId, options) {
      const session = sessionFor(query, options.snapshotId, options.signal)
      const members = session.groups.get(activityId)
      if (!members) throw new Error('活动不存在，请刷新')
      const common = { query, snapshotId: session.id, activityId, access: members[0]!.access }
      if (common.access === 'restricted') return { ...common, items: [], hasMore: false }
      const call = session.calls.get(activityId)
      if (call) {
        const detail = await request<ArkmeCallDetail>('calls.history.detail', { callRef: call.callRef }, options.signal)
        active(session, options.signal)
        if (detail.stableId !== call.stableId) throw new Error('通话详情不一致，请刷新')
        return { ...common, items: [], hasMore: false, call: { item: call, detail } }
      }
      if (members.length === 1 && !session.messages.has(activityId)) {
        const detail = await base.loadDetail(session.baseQuery, activityId, { ...options, snapshotId: session.base!.snapshotId })
        active(session, options.signal)
        if (detail.sourceRef) { const target = base.resolveTarget(detail.sourceRef); if (target) session.targets.set(activityId, target) }
        return { ...detail, ...common, ...(session.targets.has(activityId) ? { sourceRef: `${session.id}|${activityId}` } : {}) }
      }
      const offset = options.cursor ? Number(options.cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 50 !== 0 || offset > members.length) throw new Error('详情分页无效')
      const items: DetailItem[] = []
      for (const member of [...members].reverse().slice(offset, offset + 50)) {
        const message = session.messages.get(member.id)
        if (message) items.push(message)
        else {
          const detail = await base.loadDetail(session.baseQuery, member.id, { signal: options.signal, snapshotId: session.base!.snapshotId })
          active(session, options.signal); items.push(...detail.items)
          if (detail.sourceRef) { const target = base.resolveTarget(detail.sourceRef); if (target) session.targets.set(activityId, target) }
        }
      }
      const hasMore = offset + 50 < members.length
      return { ...common, items, hasMore, ...(hasMore ? { nextCursor: String(offset + 50) } : {}),
        ...(session.targets.has(activityId) ? { sourceRef: `${session.id}|${activityId}` } : {}) }
    },
    async loadLocation(query, activityId, options) {
      const session = sessionFor(query, options.snapshotId, options.signal)
      const members = session.groups.get(activityId)
      const member = members?.find(item => item.canLoadLocation && session.entries.has(item.id))
      if (!member || !session.base) throw new Error('此活动暂无可读取的地点')
      const location = await base.loadLocation!(session.baseQuery, member.id, { ...options, snapshotId: session.base.snapshotId })
      active(session, options.signal)
      return { ...location, query, snapshotId: session.id, activityId }
    },
    resolveTarget(ref) {
      return current && ref.startsWith(`${current.id}|`) ? current.targets.get(ref.slice(current.id.length + 1)) : undefined
    },
  }
}
