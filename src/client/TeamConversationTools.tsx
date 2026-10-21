import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import type { TeamConversation, TeamIdentity, TeamMessage, TeamTimeline } from '../team-app-contract.js'
import type { ArkmeOpenPrivateChatResult } from '../types.js'
import type { ConversationActivitySelection } from '../conversation-activity.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeConversationHeaderIconButton, ARKME_CONVERSATION_HEADER_ACTIONS_STYLE } from './ArkmeGroupChatControls.js'
import { ArkmeSelfCalendarPopover } from './ArkmeCalendarSurface.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { ConversationActionsMenu, conversationExportActionItem } from './PrivateChatActions.js'
import { ActivityChart, conversationActivityStyles } from './statistics/ConversationActivity.js'
import { conversationAnalysisStyles } from './statistics/ConversationAnalysis.js'
import { downloadArkmeConversationMarkdown } from './conversation-export.js'
import { useSelectedMessageSearch } from './message-selection-search.js'
import { teamDirectoryPreferences, teamEntryPinned, useTeamDirectoryPreferences } from './team-directory-preferences.js'
import { availableTeamMessage, exportTeamHistory, readTeamHistory, teamHistoryActivity, teamHistoryDate, teamHistoryDays, teamHistoryPerson, teamHistoryText } from './team-history-browser.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeUi } from './ui-controller.js'
import { tr } from './locale.js'
import { useTeamPersonNames } from './use-team-person-names.js'

type Panel = 'calendar' | 'search' | 'analysis' | 'menu'
type Archive = { messages: TeamMessage[]; loading: boolean; complete: boolean; error: string; lastSeq: number }
const emptyArchive: Archive = { messages: [], loading: false, complete: false, error: '', lastSeq: -1 }
const button: CSSProperties = { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', padding: '5px 8px', font: 'inherit', fontSize: 12 }
const errorText = (e: unknown) => e instanceof Error ? e.message : tr('操作失败，请重试')

/** One account/conversation-scoped, in-memory history reader shared by all five header tools. */
export function TeamConversationTools({ conversation, accountKey, host, onOpenPanel, onLocate, resolveIdentity, getReadingDate, overlayOpen }: {
  conversation: TeamConversation; accountKey: string; overlayOpen: boolean; host: RefObject<HTMLElement>
  onOpenPanel(): void; onLocate(message: TeamMessage, signal: AbortSignal): Promise<void>
  resolveIdentity(identity: TeamIdentity): TeamIdentity; getReadingDate(): string | undefined
}) {
  const [open, setOpen] = useState<Panel>(), [archive, setArchive] = useState<Archive>(emptyArchive)
  const archiveRef = useRef(archive); archiveRef.current = archive
  const calendar = useRef<HTMLButtonElement>(null), search = useRef<HTMLButtonElement>(null), analysis = useRef<HTMLButtonElement>(null), menu = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null), lifetime = useRef(new AbortController()), reader = useRef<AbortController>(), inFlight = useRef<Promise<TeamMessage[]>>()
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(50), [notice, setNotice] = useState(''), [opening, setOpening] = useState('')
  const [exporting, setExporting] = useState(false), [privateBusy, setPrivateBusy] = useState(false)
  const privateLock = useRef(false), locateLock = useRef(false), exportLock = useRef(false)
  const prefs = useTeamDirectoryPreferences(accountKey), target = { kind: 'conversation' as const, conversation }
  const pinned = teamEntryPinned(prefs, target)
  useEffect(() => () => { lifetime.current.abort(); reader.current?.abort() }, [])
  useEffect(() => { if (overlayOpen) setOpen(undefined) }, [overlayOpen])
  useEffect(() => {
    if (open !== 'search') return
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  const read = (force = false): Promise<TeamMessage[]> => {
    if (inFlight.current) return inFlight.current
    if (!force && archiveRef.current.complete && archiveRef.current.lastSeq === conversation.lastSeq) return Promise.resolve(archiveRef.current.messages)
    const controller = new AbortController(); reader.current = controller
    const lastSeq = conversation.lastSeq
    setArchive(old => ({ ...old, loading: true, complete: false, error: '' }))
    const task = readTeamHistory((beforeSeq, signal) => withArkmeReadDeadline(s => callArkme<TeamTimeline>('team.app.timeline', {
      conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq,
    }, s), signal), controller.signal, messages => {
      if (!controller.signal.aborted) setArchive({ messages, loading: true, complete: false, error: '', lastSeq })
    }).then(messages => {
      if (!controller.signal.aborted) setArchive({ messages, loading: false, complete: true, error: '', lastSeq })
      return messages
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setArchive(old => ({ ...(/team-(not_accessible|account-changed)|login-/.test(JSON.stringify((e as { body?: unknown })?.body)) ? emptyArchive : old), loading: false, complete: false, error: errorText(e) }))
      throw e
    }).finally(() => { if (reader.current === controller) inFlight.current = undefined })
    inFlight.current = task; return task
  }
  const cancel = () => {
    reader.current?.abort(); inFlight.current = undefined
    setArchive(old => ({ ...old, loading: false, complete: false, error: tr('已暂停读取，当前结果不完整') }))
    setExporting(false)
  }
  const toggle = (next: Panel) => {
    if (next === open) { setOpen(undefined); return }
    onOpenPanel(); setOpen(next); setNotice('')
    if (next !== 'menu') void read().catch(() => {})
  }
  useSelectedMessageSearch(conversation.ref, text => {
    onOpenPanel(); setQuery(text); setLimit(50); setOpen('search'); void read().catch(() => {})
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
  })
  const historyIdentity = useTeamPersonNames(conversation, accountKey, archive.messages.map(m => m.sender))
  const displayIdentity = (identity: TeamIdentity) => {
    const enriched = historyIdentity(identity)
    return enriched.nickname !== (identity.publicNickname || identity.nickname) ? enriched : resolveIdentity(identity)
  }
  const items = useMemo(() => archive.messages.filter(availableTeamMessage).map(m => ({ ...m, sender: displayIdentity(m.sender) })), [archive.messages, resolveIdentity, historyIdentity])
  const hits = useMemo(() => query.trim() ? items.filter(m => teamHistoryText(m).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).reverse() : [], [items, query])
  const days = useMemo(() => teamHistoryDays(items), [items])
  const locate = async (message: TeamMessage) => {
    if (locateLock.current) return
    locateLock.current = true; setOpening(message.key); setNotice('')
    try { await onLocate(message, lifetime.current.signal); if (!lifetime.current.signal.aborted) setOpen(undefined) }
    catch (e) { if (!lifetime.current.signal.aborted) setNotice(errorText(e)) }
    finally { locateLock.current = false; if (!lifetime.current.signal.aborted) setOpening('') }
  }
  const openPrivate = async (mediaType?: 'audio' | 'video') => {
    if (privateLock.current) return
    setOpen(undefined)
    if (conversation.side !== 'team') { setNotice(tr('当前是团队服务会话，请先选择具体成员再发起个人通话')); return }
    privateLock.current = true; setPrivateBusy(true); setNotice('')
    try {
      const result = await withArkmeReadDeadline(signal => callArkme<ArkmeOpenPrivateChatResult>('team.app.visitor.private.open', {
        conversationRef: conversation.ref, expectedAccountKey: accountKey,
      }, signal), lifetime.current.signal)
      lifetime.current.signal.throwIfAborted()
      if (mediaType) outgoingCallUi.request({ sourceRef: result.source.sourceRef, displayName: conversation.visitor?.nickname ?? result.source.displayName, mediaType })
      else arkmeUi.activateNotificationSource(result.source)
    } catch (e) { if (!lifetime.current.signal.aborted) setNotice(errorText(e)) }
    finally { privateLock.current = false; if (!lifetime.current.signal.aborted) setPrivateBusy(false) }
  }
  const title = conversation.side === 'team' ? conversation.visitor?.nickname ?? tr('外部用户') : conversation.channel.name
  const exportHistory = async () => {
    if (exportLock.current) return
    exportLock.current = true; setExporting(true); setNotice('')
    try {
      const messages = await read(true)
      lifetime.current.signal.throwIfAborted(); reader.current?.signal.throwIfAborted()
      downloadArkmeConversationMarkdown(`${title.replace(/[\\/:*?"<>|\r\n]/g, '_')}-团队对话-${teamHistoryDate(Date.now())}.md`, exportTeamHistory(messages.map(m => ({ ...m, sender: displayIdentity(m.sender) })), title))
      setNotice(tr('已导出 {v0} 条可访问消息', { v0: messages.filter(availableTeamMessage).length }))
    } catch (e) { if (!lifetime.current.signal.aborted && !reader.current?.signal.aborted) setNotice(errorText(e)) }
    finally { exportLock.current = false; if (!lifetime.current.signal.aborted) setExporting(false) }
  }
  const progress = `${archive.loading ? tr('正在读取历史') : archive.complete ? tr('历史已读取') : tr('结果尚不完整')} · ${archive.messages.length} ${tr('条')}`
  const coverage = <div style={{ color: arkmeTheme.secondary, fontSize: 12, margin: '10px 0' }}>
    <span role="status">{progress}{archive.lastSeq >= 0 && conversation.lastSeq > archive.lastSeq ? ` · ${tr('有新消息，可刷新更新')}` : ''}</span>
    {archive.loading ? <button type="button" style={button} onClick={cancel}>{tr('暂停')}</button> : <button type="button" style={button} onClick={() => void read(true).catch(() => {})}>{tr(archive.error ? '重试' : '刷新')}</button>}
    {archive.error && <p role="alert">{archive.error}</p>}
  </div>
  const hitRows = (messages: TeamMessage[]) => <>
    {messages.slice(0, limit).map(message => <button type="button" key={message.key} data-team-history-hit={message.key} disabled={!!opening} onClick={() => void locate(message)}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 0', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' }}>
      <span style={{ display: 'block', color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{message.own ? tr('我') : message.sender.nickname} · {teamHistoryDate(message.createdAt) ? new Date(message.createdAt).toLocaleString() : tr('时间未提供')}{opening === message.key ? ` · ${tr('正在定位…')}` : ''}</span>
      <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 14 }}>{teamHistoryText(message) || tr('[消息]')}</span>
    </button>)}
    {messages.length > limit && <button type="button" style={button} onClick={() => setLimit(n => n + 50)}>{tr('显示更多结果')}</button>}
  </>
  return <div data-team-conversation-tools style={{ ...ARKME_CONVERSATION_HEADER_ACTIONS_STYLE, flex: '0 0 auto' }}>
    <ArkmeConversationHeaderIconButton label={tr('按日期查看团队消息')} buttonRef={calendar} hasPopup="dialog" expanded={open === 'calendar'} onClick={() => toggle('calendar')}><CalendarBlank size={24}/></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('搜索团队消息')} buttonRef={search} hasPopup="dialog" expanded={open === 'search'} onClick={() => toggle('search')}><MagnifyingGlass size={24}/></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('对话分析')} buttonRef={analysis} hasPopup="dialog" expanded={open === 'analysis'} onClick={() => toggle('analysis')}><ChartBar size={22}/></ArkmeConversationHeaderIconButton>
    <ArkmePrivateCallMenu displayName={title} personalIdentity busy={privateBusy} onStart={mediaType => void openPrivate(mediaType)}/>
    <ConversationActionsMenu anchor={menu} label={tr('更多团队对话操作')} trigger={{ open: open === 'menu', onOpenChange: value => value ? toggle('menu') : setOpen(undefined) }} onClose={() => setOpen(undefined)} items={[
      conversationExportActionItem({ busy: exporting, processed: archive.messages.length, invoke: () => void exportHistory() }),
      ...(conversation.side === 'team' ? [{ id: 'private', label: tr('发起私聊'), icon: <ChatCircle size={20}/>, busy: privateBusy, invoke: () => void openPrivate() }] : []),
      { id: 'pin', label: tr(pinned ? '取消置顶' : '置顶'), icon: <PushPin size={20}/>, invoke: async () => { try { await teamDirectoryPreferences.pin(accountKey, target, !pinned) } catch (e) { setNotice(errorText(e)) } } },
    ]}/>
    <ArkmeSelfCalendarPopover open={open === 'calendar'} anchor={calendar} accountScope={accountKey} scopeKey={`team:${conversation.key}`} getReadingDate={getReadingDate}
      onClose={() => setOpen(undefined)} onSelectRecord={() => {}}
      index={{ value: { days }, loading: archive.loading, error: archive.error, incomplete: !archive.complete, notice: progress, retry: () => void read(true).catch(() => {}) }}
      onSelectIndexedDay={date => { const message = items.find(m => teamHistoryDate(m.createdAt) === date); if (message) void locate(message) }}/>
    {host.current && (open === 'search' || open === 'analysis') && createPortal(<ArkmeDetailShell title={tr(open === 'search' ? '查找团队消息' : '对话分析')} label={tr(open === 'search' ? '查找团队消息' : '团队对话分析')}
      returnFocusRef={open === 'search' ? search : analysis} onPointerDownOutside={() => setOpen(undefined)} onClose={() => setOpen(undefined)} bodyStyle={{ padding: '12px 16px' }}>
      {coverage}
      {open === 'search' ? <>
        <input ref={input} type="search" aria-label={tr('搜索团队聊天关键词')} placeholder={tr('搜索此对话')} value={query} onChange={event => { setQuery(event.target.value); setLimit(50) }}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.input, color: arkmeTheme.text, fontSize: 14 }}/>
        <p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{query.trim() ? `${hits.length} ${tr('条匹配')}` : tr('输入关键词，查找消息或附件名称')}</p>
        {hitRows(hits)}
      </> : <TeamHistoryAnalysis messages={items} complete={archive.complete} renderMessages={hitRows}/>}
    </ArkmeDetailShell>, host.current)}
    {host.current && (notice || exporting || privateBusy) && createPortal(<div role="status" style={{ position: 'absolute', zIndex: 13, top: 76, right: 16, maxWidth: 'calc(100% - 32px)', padding: '8px 12px', borderRadius: 8, background: arkmeTheme.layer2, color: arkmeTheme.secondary, border: `1px solid ${arkmeTheme.border}`, fontSize: 12 }}>
      {exporting ? progress : privateBusy ? tr('正在打开个人会话…') : notice}
      {exporting ? <button style={button} onClick={cancel}>{tr('取消')}</button> : !privateBusy && <button style={button} onClick={() => setNotice('')}>{tr('关闭')}</button>}
    </div>, host.current)}
  </div>
}

function TeamHistoryAnalysis({ messages, complete, renderMessages }: { messages: TeamMessage[]; complete: boolean; renderMessages(messages: TeamMessage[]): React.ReactNode }) {
  const [tab, setTab] = useState('activity'), [person, setPerson] = useState('all'), [month, setMonth] = useState(''), [weekly, setWeekly] = useState(false)
  const [bucket, setBucket] = useState<ConversationActivitySelection>()
  const people = new Map(messages.filter(m => teamHistoryPerson(m) !== 'unknown').map(m => [teamHistoryPerson(m), m.own ? tr('我') : m.sender.nickname]))
  const selected = messages.filter(m => (person === 'all' || teamHistoryPerson(m) === person) && (!month || teamHistoryDate(m.createdAt).startsWith(month)))
  const result = useMemo(() => teamHistoryActivity(selected), [messages, person, month])
  const unknownTimes = selected.filter(m => !teamHistoryDate(m.createdAt)).length
  const unknownPeople = selected.filter(m => teamHistoryPerson(m) === 'unknown').length
  return <div className="conversation-words"><style>{conversationAnalysisStyles}{conversationActivityStyles}</style>
    <div className="cw-controls" role="group" aria-label={tr('分析类型')}><button aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>{tr('活跃时间')}</button><button aria-pressed={tab === 'words'} onClick={() => setTab('words')}>{tr('词频分析')}</button></div>
    {tab === 'words' ? <div className="cw-empty"><ChartBar size={36}/><strong>{tr('团队词频分析尚未接通')}</strong><p>{tr('需要支持团队对话的词频服务，接通后可按成员查看词云与原消息。')}</p></div> : <>
      <div className="cw-controls"><select aria-label={tr('分析成员')} value={person} onChange={e => { setPerson(e.target.value); setBucket(undefined) }}><option value="all">{tr('全部成员')}</option>{[...people].map(([key, label]) => <option key={key} value={key}>{label}</option>)}{unknownPeople > 0 && <option value="unknown">{tr('身份未提供')}</option>}</select>
        <input type="month" aria-label={tr('分析月份')} value={month} onChange={e => { setMonth(e.target.value); setBucket(undefined) }}/><button onClick={() => { setMonth(''); setBucket(undefined) }}>{tr('全部时间')}</button></div>
      <p className="cw-muted">{tr('所有消息类型 · 按发送时间统计')} · {Intl.DateTimeFormat().resolvedOptions().timeZone}{!complete && ` · ${tr('当前为已加载部分')}`}</p>
      <div className="ca-metrics"><div>{tr('消息量')}<strong>{result.totalMessages}</strong></div><div>{tr('活跃天数')}<strong>{result.activeDays}</strong></div><div>{tr('已知参与者')}<strong>{result.participants}</strong></div></div>
      {(unknownTimes > 0 || unknownPeople > 0) && <p className="cw-muted">{unknownTimes > 0 && `${unknownTimes} 条未提供有效时间，未计入分布。`}{unknownPeople > 0 && `${unknownPeople} 条身份未提供，不计入参与人数。`}</p>}
      {bucket ? <><button onClick={() => setBucket(undefined)}>{tr('返回分布')}</button>{renderMessages(selected.filter(m => { const d = new Date(m.createdAt); return !!teamHistoryDate(m.createdAt) && d.getHours() === bucket.hour && (bucket.weekday === null || (d.getDay() || 7) === bucket.weekday) }))}</> : <>
        <div className="cw-controls"><button aria-pressed={!weekly} onClick={() => setWeekly(false)}>{tr('一天内')}</button><button aria-pressed={weekly} onClick={() => setWeekly(true)}>{tr('一周内')}</button></div>
        {result.totalMessages ? <ActivityChart key={String(weekly)} result={result} weekly={weekly} onSelect={setBucket}/> : <p className="cw-empty">{tr(complete ? '此范围暂无消息活动' : '正在等待消息数据…')}</p>}
      </>}
    </>}
  </div>
}
