import { describe, it, expect, vi } from 'vitest'
import type { ArkmeCalendarRecordItem, ArkmeCallHistoryItem, ArkmeBotSummary } from '../src/types.js'
import type { callArkme } from '../src/client/api.js'
import type { DayActivityQuery, DayActivityEntry } from '../src/client/calendar-activity-model.js'
import { createMultisourceDayActivityReader, groupDayActivities } from '../src/client/multisource-day-activity-reader.js'

const start = new Date(2026, 8, 19).getTime(), minute = 60_000
const query: DayActivityQuery = { accountScope: 'test:42', bucketDate: '2026-09-19', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  mode: 'activities', kind: 'all', includeBackground: false }
const options = () => ({ signal: new AbortController().signal })
const note = (id: string, changes: Partial<ArkmeCalendarRecordItem> = {}): ArkmeCalendarRecordItem => ({ recordUid: id,
  sendAtMillis: start + 600 * minute, accessState: 'available', title: '', preview: '记录', textContent: '原始正文',
  sourceKind: 'self', creationSource: 0, templateKind: 1, displayKind: 0, protected: false, ...changes })
const call = (id: string, changes: Partial<ArkmeCallHistoryItem> = {}): ArkmeCallHistoryItem => ({ stableId: id, callRef: `ref:${id}`,
  peerDisplayName: '备注名', mediaType: 'audio', startedAtMillis: start + 600 * minute, acceptedAtMillis: start + 600 * minute,
  endedAtMillis: start + 606 * minute, durationSeconds: 360, callResult: 'NormalEnd', resultLabel: '已接通', summaryStatus: 'done',
  summaryPreview: '已有摘要', canOpenDetail: true, canRedial: true, ...changes })
const bot = (id: string, changes: Partial<ArkmeBotSummary> = {}): ArkmeBotSummary => ({ botRef: id, directoryKey: id, name: id,
  provider: 'webhook', description: '', status: 'online', directChatAvailable: true, conversationProjection: 'chat', ...changes })
function setup(overrides: Record<string, unknown | ((params: any) => unknown)> = {}) {
  const read = vi.fn<typeof callArkme>(async (operation, params) => {
    const override = overrides[operation]
    if (override instanceof Error) throw override
    if (typeof override === 'function') return override(params)
    if (override !== undefined) return override
    if (operation === 'calendar.records') return { bucketDate: query.bucketDate, timezone: query.timezone, items: [], hasMore: false }
    if (operation === 'recordings.day') return { dateStamp: start, coverage: { state: 'ready', intervals: [] }, transcript: { state: 'empty', items: [] } }
    if (operation === 'calls.history.list' || operation === 'arko.history') return { items: [], hasMore: false }
    if (operation === 'bots.list') return { items: [] }
    throw new Error(`unexpected read ${operation}`)
  })
  return { read, reader: createMultisourceDayActivityReader(query.accountScope, read) }
}

describe('multisource daily activity reader', () => {
  it.each(['activities', 'records'] as const)('reads all five conversation sources with real pagination in %s mode, without fetching calls', async mode => {
    const source = { sourceRef: 'source', sourceKey: 'peer:42', displayName: '备注名', activeAtMillis: start, unreadCount: 0 }
    const q: DayActivityQuery = { ...query, mode, kind: 'conversation' }
    const { reader, read } = setup({
      'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, hasMore: false, items: [
        note('self'), note('private', { source: { ...source, kind: 'private_chat' } }),
        note('group', { source: { ...source, sourceKey: 'group:1', displayName: '项目群', kind: 'group_chat' } }),
        note('dsh', { creationSource: 3 })] },
      'recordings.day': { dateStamp: start, coverage: { state: 'ready', intervals: [{
        startAtMillis: start + 599 * minute, endAtMillis: start + 600 * minute, status: 'saved', sourceLabel: '本人录音',
      }] }, transcript: { state: 'empty', items: [] } },
      'bots.list': { items: [bot('helper')] },
      'bots.private-chat.history.read': { messages: [{ messageId: '1', role: 'assistant', content: 'Bot 内容',
        createdAtMillis: start + 601 * minute, attachments: [] }] },
      'arko.history': (params: any) => params.offset === 0 ? { items: [], hasMore: true, nextOffset: 20 }
        : { items: [{ messageId: 1, sessionId: 3, role: 'assistant', text: '**Arko 回复**', createdAtMillis: start + 602 * minute }], hasMore: false },
    })
    const first = await reader.loadDay(q, options())
    expect(first.items.map(item => item.kind).sort()).toEqual(['bot', 'dsh', 'group_chat', 'private_chat'])
    expect(first.hasMore).toBe(true)
    const second = await reader.loadDay(q, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(second.items.map(item => item.kind).sort()).toEqual(['arko', 'bot', 'dsh', 'group_chat', 'private_chat'])
    expect(second.items[0]?.kind).toBe('arko')
    expect(second.hasMore).toBe(false)
    expect(second.missingKinds).not.toContain('call')
    expect(read.mock.calls.some(([op]) => /calls\.|open|ensure|mark-read|send/.test(op))).toBe(false)
    expect(read.mock.calls.filter(([op]) => op === 'arko.history').map(([, params]) => params?.offset)).toEqual([0, 20])
    const arko = second.items.find(item => item.kind === 'arko')!
    const detail = await reader.loadDetail(q, arko.id, { ...options(), snapshotId: second.snapshotId })
    expect(detail.items[0]?.text).toBe('**Arko 回复**')
    expect(reader.resolveTarget(detail.sourceRef!)).toEqual({ kind: 'arko' })
    const all = await reader.loadDay(query, options())
    expect(all.items.some(item => item.kind === 'note')).toBe(true)
    expect(all.items.some(item => item.kind === 'recording')).toBe(true)
    await expect(reader.loadDetail(q, arko.id, { ...options(), snapshotId: second.snapshotId })).rejects.toThrow('过期')
  })
  it('classifies self, private, group and DSH from explicit metadata, prefers provided remarks', async () => {
    const source = { sourceRef: 'source', sourceKey: 'peer:42', displayName: '周鹏备注', activeAtMillis: start, unreadCount: 0 }
    const { reader } = setup({ 'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, hasMore: false, items: [
      note('self'), note('private', { source: { ...source, kind: 'private_chat', privateNickname: '昵称' } }),
      note('group', { source: { ...source, sourceKey: 'group:1', displayName: '项目群', kind: 'group_chat' } }),
      note('dsh', { creationSource: 3 })] } })
    const page = await reader.loadDay(query, options())
    expect(page.items.map(item => item.kind).sort()).toEqual(['dsh', 'group_chat', 'note', 'private_chat'])
    expect(page.items.find(item => item.kind === 'private_chat')?.participant?.name).toBe('周鹏备注')
    expect(page.items.find(item => item.kind === 'group_chat')?.title).toContain('项目群')
    expect(page.missingKinds).toEqual(expect.arrayContaining(['private_chat', 'group_chat', 'dsh']))
  })
  it('loads real audio/video/missed calls and only loads call detail when selected', async () => {
    const item = call('one')
    const { reader, read } = setup({ 'calls.history.list': { items: [item, call('missed', { acceptedAtMillis: start + 600 * minute, durationSeconds: 90, resultLabel: '未接通', mediaType: 'video' })], hasMore: false },
      'calls.history.detail': { stableId: 'one', callRef: 'renewed-ref', transcriptSegments: [], participants: [], summaryText: '完整摘要' } })
    const page = await reader.loadDay(query, options())
    expect(read.mock.calls.some(([op]) => op === 'calls.history.detail')).toBe(false)
    expect(page.items.find(item => item.id === 'call:one')).toMatchObject({ title: '与 备注名 语音通话', statusLabel: '已接通 · 6分0秒' })
    expect(page.items.find(item => item.id === 'call:missed')).toMatchObject({ title: '与 备注名 视频通话', statusLabel: '未接通' })
    const detail = await reader.loadDetail(query, 'call:one', { ...options(), snapshotId: page.snapshotId })
    expect(detail.call?.detail.summaryText).toBe('完整摘要')
    expect(read.mock.calls.at(-1)?.slice(0, 2)).toEqual(['calls.history.detail', { callRef: item.callRef }])
  })
  it('includes cross-midnight calls, excludes other dates, never guesses missing start times', async () => {
    const { reader } = setup({ 'calls.history.list': { hasMore: false, items: [call('cross', { startedAtMillis: start - minute, endedAtMillis: start + minute }),
      call('old', { startedAtMillis: start - 10 * minute, endedAtMillis: start - minute }), call('unknown', { startedAtMillis: 0 }),
      call('next', { startedAtMillis: start + 1440 * minute })] } })
    const page = await reader.loadDay({ ...query, kind: 'call' }, options())
    expect(page.items.map(item => item.id)).toEqual(['call:cross'])
  })
  it('paginates each history only once per explicit request; marks not-yet-loaded as partial', async () => {
    const { reader, read } = setup({ 'calls.history.list': (params: any) => params.cursor
      ? { items: [call('one')], hasMore: false } : { items: [], hasMore: true, nextCursor: 'older' } })
    const q = { ...query, kind: 'call' as const }
    const first = await reader.loadDay(q, options())
    expect(first.items).toHaveLength(0); expect(first.missingKinds).toContain('call'); expect(first.hasMore).toBe(true)
    expect(read.mock.calls.filter(([op]) => op === 'calls.history.list')).toHaveLength(1)
    const second = await reader.loadDay(q, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(second.items).toHaveLength(1); expect(second.missingKinds).not.toContain('call'); expect(second.replaceItems).toBe(true)
    expect(second.hasMore).toBe(false)
  })
  it('deduplicates Arko input by explicit entryRecordUid, not records created by the agent', async () => {
    const { reader } = setup({ 'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, hasMore: false, items: [note('input'), note('effect')] },
      'arko.history': { hasMore: false, items: [{ messageId: 1, sessionId: 5, role: 'user', text: '问题', createdAtMillis: start + 600 * minute,
        entryRecordUid: 'input', createdRecordUids: ['effect'] }, { messageId: 2, sessionId: 5, role: 'assistant', text: '回答', createdAtMillis: start + 601 * minute }] } })
    const page = await reader.loadDay(query, options())
    expect(page.items).toHaveLength(2)
    const arko = page.items.find(item => item.kind === 'arko')!
    expect(arko.recordCount).toBe(2)
    const detail = await reader.loadDetail(query, arko.id, { ...options(), snapshotId: page.snapshotId })
    expect(detail.items.map(item => item.text)).toEqual(['问题', '回答'])
    expect(reader.resolveTarget(detail.sourceRef!)).toEqual({ kind: 'arko' })
  })
  it('does not leak an explicitly protected calendar record through linked AI history', async () => {
    const { reader } = setup({ 'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, hasMore: false,
      items: [note('locked', { protected: true, title: 'secret' })] }, 'arko.history': { hasMore: false, items: [
      { messageId: 1, sessionId: 1, role: 'user', text: 'secret', createdAtMillis: start + 600 * minute, entryRecordUid: 'locked' }] } })
    const page = await reader.loadDay(query, options())
    expect(JSON.stringify(page)).not.toContain('secret')
    const detail = await reader.loadDetail(query, 'note:locked', { ...options(), snapshotId: page.snapshotId })
    expect(detail).toMatchObject({ access: 'restricted', items: [] })
  })
  it('reads only Chat-owned Bot history, at most two bots per page, never ensure/open/mark-read', async () => {
    const { reader, read } = setup({ 'bots.list': { items: [bot('a'), bot('b'), bot('c'), bot('legacy', { conversationProjection: 'record' })] },
      'bots.private-chat.history.read': (params: any) => ({ messages: [{ messageId: '1', role: 'assistant', content: params.botRef,
        createdAtMillis: start + 600 * minute, attachments: [] }] }) })
    const first = await reader.loadDay(query, options())
    expect(first.items.filter(item => item.kind === 'bot')).toHaveLength(2)
    expect(read.mock.calls.filter(([op]) => op === 'bots.private-chat.history.read')).toHaveLength(2)
    await reader.loadDay(query, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(read.mock.calls.filter(([op]) => op === 'bots.private-chat.history.read')).toHaveLength(3)
    expect(read.mock.calls.some(([op]) => /open|ensure|mark-read|send|session/.test(op))).toBe(false)
    expect(first.missingKinds).toContain('bot')
  })
  it('deduplicates chat call cards only by confirmed call identity, preserves raw records mode', async () => {
    const record = note('card', { content: { itemUid: 'card', senderName: '我', isMe: true, status: 1, sendAtMillis: start + 600 * minute,
      textContent: '', callRecord: { stableId: 'one', mediaType: 'audio', text: '通话' } } })
    const { reader } = setup({ 'calls.history.list': { items: [call('one')], hasMore: false },
      'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, items: [record], hasMore: false } })
    expect((await reader.loadDay(query, options())).items).toHaveLength(1)
    expect((await reader.loadDay({ ...query, mode: 'records' }, options())).items).toHaveLength(2)
  })
  it('groups only same-source occurrences; identical names and large gaps remain separate', () => {
    const entry = (id: string, time: number, sourceIdentity: string): DayActivityEntry => ({ id, kind: 'private_chat', sourceIdentity,
      startAtMillis: time * minute, endAtMillis: time * minute, title: '同名', preview: '', sourceName: '', access: 'available', participation: 'self', recordCount: 1 })
    const entries = [entry('a', 100, 'one'), entry('b', 90, 'one'), entry('c', 90, 'two'), entry('d', 40, 'one')]
    const grouped = groupDayActivities(entries, 'activities')
    expect(grouped.items).toHaveLength(3)
    expect(grouped.groups.get('a')?.map(item => item.id)).toEqual(['a', 'b'])
    expect(groupDayActivities(entries, 'records').items).toHaveLength(4)
  })
  it('isolates failed sources and rejects expired queries, cursors and mismatched call detail', async () => {
    const { reader } = setup({ 'arko.history': new Error('offline'), 'calls.history.list': { items: [call('one')], hasMore: false },
      'calls.history.detail': { stableId: 'other' } })
    const page = await reader.loadDay(query, options())
    expect(page.items).toHaveLength(1); expect(page.missingKinds).toContain('arko')
    await expect(reader.loadDetail(query, 'call:one', { ...options(), snapshotId: page.snapshotId })).rejects.toThrow('不一致')
    await expect(reader.loadDay({ ...query, accountScope: 'else' }, options())).rejects.toThrow('账号')
    await reader.loadDay(query, options())
    await expect(reader.loadDetail(query, 'call:one', { ...options(), snapshotId: page.snapshotId })).rejects.toThrow('过期')
  })
  it('reads a grouped location from its actual record, without assigning it to a call or whole span', async () => {
    const { reader, read } = setup({ 'calendar.records': { bucketDate: query.bucketDate, timezone: query.timezone, hasMore: false,
      items: [note('place', { locationRef: 'location-capability' })] },
      'calendar.record-location': { recordUid: 'place', access: 'available', location: { source: 'device', latitude: 30, longitude: 114 } } })
    const page = await reader.loadDay(query, options())
    expect(read.mock.calls.some(([op]) => op === 'calendar.record-location')).toBe(false)
    expect(await reader.loadLocation!(query, 'note:place', { ...options(), snapshotId: page.snapshotId })).toMatchObject({ activityId: 'note:place', snapshotId: page.snapshotId })
  })
  it('discards a late call page after refresh instead of mixing two read sessions', async () => {
    let finish!: (value: unknown) => void, count = 0
    const { reader } = setup({ 'calls.history.list': () => ++count === 1 ? new Promise(resolve => { finish = resolve }) : { items: [], hasMore: false } })
    const first = reader.loadDay(query, options())
    const rejection = expect(first).rejects.toThrow('日期或账号已变化')
    await reader.loadDay(query, options())
    finish({ items: [call('late')], hasMore: false })
    await rejection
  })
})
