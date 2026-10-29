import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { TeamConversation, TeamIdentity, TeamMessage } from '../team-app-contract.js'
import type { TeamHistoryOptions, TeamHistoryResponse, TeamHistoryWord } from '../team-history-contract.js'
import type { ConversationActivitySelection } from '../conversation-activity.js'
import { historyCall, historyMonthWindow, prepareHistory, useTeamHistoryPage, useTeamHistoryParticipants } from './team-history-client.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import { ActivityChart, conversationActivityStyles } from './statistics/ConversationActivity.js'
import { ConversationWordsCloud, conversationAnalysisStyles } from './statistics/ConversationAnalysis.js'
import { teamHistoryDate, teamHistoryText } from './team-history-browser.js'
import { tr } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import { useTeamPersonNames } from './use-team-person-names.js'

const button: CSSProperties = { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', padding: '5px 8px', font: 'inherit', fontSize: 12 }
type Props = {
  conversation: TeamConversation; accountKey: string; kind: 'search' | 'analysis'
  keyword: string; onKeywordChange(value: string): void; inputRef: RefObject<HTMLInputElement>
  opening: string; onLocate(message: TeamMessage): void; resolveIdentity(identity: TeamIdentity): TeamIdentity
}

/** Original result row presentation; only its data and paging owner changed. */
function TeamHistoryRows({ messages, conversation, accountKey, opening, onLocate, resolveIdentity }: Pick<Props, 'conversation' | 'accountKey' | 'opening' | 'onLocate' | 'resolveIdentity'> & { messages: TeamMessage[] }) {
  const names = useTeamPersonNames(conversation, accountKey, messages.map(message => message.sender))
  const identity = (person: TeamIdentity) => {
    const enriched = names(person)
    return enriched.nickname !== (person.publicNickname || person.nickname) ? enriched : resolveIdentity(person)
  }
  return <>{messages.map(message => <button type="button" key={message.key} data-team-history-hit={message.key} disabled={!!opening} onClick={() => onLocate(message)}
    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 0', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' }}>
    <span style={{ display: 'block', color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{message.own ? tr('我') : identity(message.sender).nickname} · {teamHistoryDate(message.createdAt) ? new Date(message.createdAt).toLocaleString() : tr('时间未提供')}{opening === message.key ? ` · ${tr('正在定位…')}` : ''}</span>
    <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 14 }}>{teamHistoryText(message) || tr('[消息]')}</span>
  </button>)}</>
}
function HistoryCoverage({ loading, complete, count, error, onPause, onRefresh }: { loading: boolean; complete: boolean; count: number; error: string; onPause(): void; onRefresh(): void }) {
  return <div style={{ color: arkmeTheme.secondary, fontSize: 12, margin: '10px 0' }}>
    <span role="status">{tr(loading ? '正在读取历史' : complete ? '历史已读取' : '结果尚不完整')} · {count} {tr('条')}</span>
    {loading ? <button type="button" style={button} onClick={onPause}>{tr('暂停')}</button> : <button type="button" style={button} onClick={onRefresh}>{tr(error ? '重试' : '刷新')}</button>}
    {error && <p role="alert">{error}</p>}
  </div>
}
function MoreMessages({ owner }: { owner: ReturnType<typeof useTeamHistoryPage> }) {
  return <>{owner.windowed && <p>{tr('当前仅保留最近加载的 200 条摘要，刷新可返回起点')}</p>}
    {owner.page?.hasMore && <button type="button" style={button} disabled={owner.loading} onClick={() => void owner.more()}>{tr('显示更多结果')}</button>}</>
}
export function TeamHistoryPanel(props: Props) {
  // Different surfaces own different state, as in the colleague's original UI.
  return props.kind === 'search' ? <TeamHistorySearch {...props} /> : <TeamHistoryAnalysis {...props} />
}
function TeamHistorySearch(props: Props) {
  const query = props.keyword.trim(), [debounced, setDebounced] = useState(query)
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer) }, [query])
  const enabled = !!query && query === debounced
  const owner = useTeamHistoryPage(props.conversation.ref, props.accountKey, 'query', { keyword: debounced }, enabled, props.conversation.key)
  const messages = enabled ? owner.page?.messages ?? [] : []
  return <>
    {query && <HistoryCoverage loading={owner.loading} complete={owner.page?.state === 'ready' && !owner.page.hasMore && !owner.windowed} count={messages.length} error={owner.error} onPause={owner.pause} onRefresh={owner.refresh} />}
    <input ref={props.inputRef} type="search" aria-label={tr('搜索团队聊天关键词')} placeholder={tr('搜索此对话')} value={props.keyword} onChange={event => props.onKeywordChange(event.target.value)}
      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.input, color: arkmeTheme.text, fontSize: 14 }} />
    <p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{query ? `${messages.length} ${tr(owner.page?.hasMore || owner.windowed ? '条已显示匹配' : '条匹配')}` : tr('输入关键词，查找消息或附件名称')}</p>
    {owner.page?.indexing && <p role="status">{tr('新消息正在索引，当前显示已完成范围')}</p>}
    <TeamHistoryRows {...props} messages={messages} />
    <MoreMessages owner={owner} />
  </>
}
function TeamHistoryAnalysis(props: Props) {
  const { conversation, accountKey } = props
  const scope = JSON.stringify([accountKey, conversation.key, conversation.side])
  const [tab, setTab] = useState<'activity' | 'words'>('activity'), [person, setPerson] = useState('all'), [month, setMonth] = useState(''), [weekly, setWeekly] = useState(false)
  const [bucket, setBucket] = useState<ConversationActivitySelection>(), [word, setWord] = useState<{ resultRef: string; value: TeamHistoryWord }>(), [view, setView] = useState<'cloud' | 'list'>('cloud')
  const [revision, setRevision] = useState(0), selectedPerson = useRef<TeamIdentity>()
  const people = useTeamHistoryParticipants(conversation.ref, accountKey, conversation.side, scope, revision)
  const names = useTeamPersonNames(conversation, accountKey, people.people)
  const personName = (person: TeamIdentity) => {
    const enriched = names(person)
    return (enriched.nickname !== (person.publicNickname || person.nickname) ? enriched : props.resolveIdentity(person)).nickname
  }
  const currentPerson = people.people.find(value => value.personKey === person) ?? selectedPerson.current
  const options: TeamHistoryOptions = { ...historyMonthWindow(month), ...(person === 'self' ? { sender: 'self' } : person !== 'all' && currentPerson?.personRef ? { personRef: currentPerson.personRef } : {}) }
  const signature = JSON.stringify([scope, tab, options, revision])
  const current = useRef({ ref: conversation.ref, options }); current.current = { ref: conversation.ref, options }
  const active = useRef<AbortController>()
  const [state, setState] = useState<{ signature: string; manifest?: TeamHistoryResponse; result?: TeamHistoryResponse; error: string }>({ signature: '', error: '' })
  useEffect(() => {
    const controller = new AbortController(); active.current = controller
    setState({ signature, error: '' })
    void prepareHistory(current.current.ref, accountKey, 'analysis/create', { ...current.current.options, analysisKind: tab, requestId: crypto.randomUUID() }, controller.signal, manifest => {
      if (!controller.signal.aborted) setState({ signature, manifest, error: '' })
    }).then(async manifest => {
      if (!manifest.resultRef) throw new Error('分析结果无效，请重试')
      const result = tab === 'activity' ? await historyCall(current.current.ref, accountKey, 'analysis/result', { resultRef: manifest.resultRef }, controller.signal) : manifest
      if (result.state !== 'ready') throw new Error(result.reason || '分析数据尚未就绪，请重试')
      if (!controller.signal.aborted) setState({ signature, manifest, result, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ signature, error: error instanceof Error ? error.message : '分析失败，请重试' })
    })
    return () => controller.abort()
  }, [signature, accountKey, tab])
  useEffect(() => subscribeTeamMessageChanges((account, receiptOnly) => {
    if (account === accountKey && !receiptOnly) { active.current?.abort(); setState({ signature, error: '团队内容已更新，请刷新查询' }) }
  }), [accountKey, signature])
  const result = state.signature === signature && !people.error ? state.result : undefined
  const words = useTeamHistoryPage(conversation.ref, accountKey, 'analysis/words', { resultRef: result?.resultRef ?? '', limit: 100 }, !!result && tab === 'words', scope)
  const selection = tab === 'words' ? word && result && word.resultRef === result.resultRef ? { sourceRef: word.value.sourceRef } : undefined : bucket ? { hour: bucket.hour, ...(bucket.weekday !== null ? { weekday: bucket.weekday } : {}) } : undefined
  const sources = useTeamHistoryPage(conversation.ref, accountKey, 'analysis/sources', { resultRef: result?.resultRef ?? '', ...selection }, !!result && !!selection, scope)
  const error = (state.signature === signature ? state.error : '') || people.error || (selection ? sources.error : tab === 'words' ? words.error : '')
  const loading = !error && (!result || people.loading || (selection ? sources.loading : tab === 'words' && words.loading))
  const complete = !!result && !people.loading && !error && (tab === 'activity' || words.page?.state === 'ready')
  const count = (tab === 'words' ? words.page?.activity?.totalMessages : result?.activity?.totalMessages) ?? (state.signature === signature ? state.manifest?.messageCount : 0) ?? 0
  const refresh = () => { setWord(undefined); setRevision(value => value + 1) }
  const pause = () => {
    active.current?.abort(); people.pause()
    if (selection) sources.pause(); else if (tab === 'words') words.pause()
    setState(old => ({ ...old, signature, error: '已暂停读取，当前结果不完整' }))
  }
  const choose = (value: string) => {
    selectedPerson.current = people.people.find(item => item.personKey === value)
    setPerson(value); setBucket(undefined); setWord(undefined)
  }
  return <>
    <HistoryCoverage loading={loading} complete={complete} count={count} error={error} onPause={pause} onRefresh={refresh} />
    <div className="conversation-words"><style>{conversationAnalysisStyles}{conversationActivityStyles}</style>
      <div className="cw-controls" role="group" aria-label={tr('分析类型')}><button aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>{tr('活跃时间')}</button><button aria-pressed={tab === 'words'} onClick={() => setTab('words')}>{tr('词频分析')}</button></div>
      <div className="cw-controls"><select aria-label={tr('分析成员')} value={person} onChange={event => choose(event.target.value)}><option value="all">{tr('全部成员')}</option>
        {(conversation.side === 'external' || people.people.some(item => item.isMe) || person === 'self') && <option value="self">{tr('我')}</option>}
        {people.people.filter(item => !item.isMe).map(item => <option key={item.personKey} value={item.personKey}>{personName(item)}</option>)}
        {person !== 'all' && person !== 'self' && !people.people.some(item => item.personKey === person) && currentPerson && <option value={person}>{personName(currentPerson)}</option>}
      </select>
        <input type="month" aria-label={tr('分析月份')} value={month} onChange={event => { setMonth(event.target.value); setBucket(undefined); setWord(undefined) }} /><button onClick={() => { setMonth(''); setBucket(undefined); setWord(undefined) }}>{tr('全部时间')}</button></div>
      <p className="cw-muted">{tr('所有消息类型 · 按发送时间统计')} · {options.timezone}</p>
      {result?.activity && tab === 'activity' && <>
        <div className="ca-metrics"><div>{tr('消息量')}<strong>{result.activity.totalMessages}</strong></div><div>{tr('活跃天数')}<strong>{result.activity.activeDays}</strong></div><div>{tr('已知参与者')}<strong>{result.activity.participants}</strong></div></div>
        {!!result.unknownTime && <p className="cw-muted">{result.unknownTime} {tr('条消息时间未提供，未计入时间分布')}</p>}
      </>}
      {result && selection ? <>
        <button onClick={() => tab === 'words' ? setWord(undefined) : setBucket(undefined)}>{tr(tab === 'words' ? '返回词云' : '返回分布')}</button>
        {sources.page?.totalInSnapshot !== undefined && <p>{sources.page.totalInSnapshot} {tr('条消息')}</p>}
        <TeamHistoryRows {...props} messages={sources.page?.messages ?? []} /><MoreMessages owner={sources} />
      </> : result && tab === 'words' ? <>
        <button onClick={() => setView(value => value === 'cloud' ? 'list' : 'cloud')}>{tr(view === 'cloud' ? '查看列表' : '查看词云')}</button>
        <ConversationWordsCloud words={(words.page?.words ?? []).map(value => ({ key: value.sourceRef, text: value.word, count: value.count, messageCount: value.messageCount }))} view={view} onSelect={ref => { const value = words.page?.words.find(item => item.sourceRef === ref); if (value) setWord({ resultRef: result.resultRef!, value }) }} onList={() => setView('list')} />
        {words.page?.hasMore && <button type="button" style={button} disabled={words.loading} onClick={() => void words.more()}>{tr('显示更多结果')}</button>}
      </> : result?.activity ? <>
        <div className="cw-controls"><button aria-pressed={!weekly} onClick={() => setWeekly(false)}>{tr('一天内')}</button><button aria-pressed={weekly} onClick={() => setWeekly(true)}>{tr('一周内')}</button></div>
        {result.activity.totalMessages ? <ActivityChart key={String(weekly)} result={result.activity} weekly={weekly} onSelect={setBucket} /> : <p className="cw-empty">{tr('此范围暂无消息活动')}</p>}
      </> : null}
    </div>
  </>
}
