import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import type { ArkmeSourceItem } from '../../types.js'
import type { ConversationWord, ConversationWordMessage, ConversationWordMessages, ConversationWordParticipant, ConversationWordParticipants, ConversationWordsQuery } from '../../conversation-word-frequency.js'
import { ArkmeConversationHeaderIconButton } from '../ArkmeGroupChatControls.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { arkmeUi } from '../ui-controller.js'
import { ConversationActivity } from './ConversationActivity.js'
import { useConversationWords } from './use-conversation-words.js'

export const conversationAnalysisStyles = `
.conversation-words{font-size:13px;line-height:1.6}
.conversation-words button,.conversation-words select,.conversation-words input{font:inherit;color:inherit;max-width:100%;box-sizing:border-box}
.conversation-words button{cursor:pointer;background:transparent;border:1px solid ${arkmeTheme.borderSoft};border-radius:6px;padding:4px 8px}
.conversation-words button:hover{background:${arkmeTheme.subtle}}
.conversation-words button:disabled{opacity:.45;cursor:default}
.conversation-words button[aria-pressed=true]{background:${arkmeTheme.subtle};font-weight:600}
.conversation-words :focus-visible{outline:2px solid currentColor;outline-offset:2px}
.conversation-words .cw-muted{font-size:12px;color:${arkmeTheme.secondary}}
.conversation-words .cw-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.conversation-words .cw-controls label{display:flex;align-items:center;gap:8px;min-width:0}
.conversation-words select,.conversation-words input{border:1px solid ${arkmeTheme.borderSoft};border-radius:6px;background:${arkmeTheme.base};padding:5px 7px;min-width:0}
.conversation-words .cw-empty{text-align:center;padding:38px 0;color:${arkmeTheme.secondary}}
.conversation-words .cw-empty svg{display:block;margin:0 auto 14px;opacity:.5}
.conversation-words .cw-cloud{min-height:180px;display:flex;align-content:center;justify-content:center;align-items:center;flex-wrap:wrap;gap:12px 18px;padding:18px 0}
.conversation-words .cw-cloud button{border:0;line-height:1.4;padding:3px;overflow-wrap:anywhere}
.conversation-words .cw-cloud small{font-size:11px;margin-left:4px;color:${arkmeTheme.tertiary}}
.conversation-words .cw-list{list-style:none;margin:0;padding:0}
.conversation-words .cw-list button{display:flex;gap:10px;justify-content:space-between;text-align:left;width:100%;border:0;border-bottom:1px solid ${arkmeTheme.borderSoft};border-radius:0;padding:10px 0}
.conversation-words .cw-list span:first-child{min-width:0;overflow-wrap:anywhere}
.conversation-words .cw-list small{display:block}
.conversation-words .cw-person-list{max-height:240px;overflow-y:auto;border:1px solid ${arkmeTheme.borderSoft};border-radius:8px;padding:8px;margin-bottom:12px}
.conversation-words .cw-person-list input{width:100%;margin-bottom:7px}
.conversation-words .cw-person-list button{display:block;border:0;width:100%;text-align:left;padding:7px}
.conversation-words .cw-message{border-bottom:1px solid ${arkmeTheme.borderSoft};padding:14px 0}
.conversation-words .cw-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}
.conversation-words time{font-variant-numeric:tabular-nums}
.conversation-words .cw-coverage{border-bottom:1px solid ${arkmeTheme.borderSoft};padding-bottom:12px;margin-bottom:14px}
`
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateTime = (at: number, timezone: string) => new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)

export function ConversationAnalysis({ source, host, accountScope, refreshRevision }: { source: ArkmeSourceItem; host: RefObject<HTMLElement>; accountScope: string; refreshRevision: string }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { setOpen(false) }, [accountScope, source.sourceKey])
  return <>
    <ArkmeConversationHeaderIconButton buttonRef={trigger} label={tr('对话分析')} hasPopup="dialog" expanded={open} onClick={() => {
      if (!open) window.dispatchEvent(new CustomEvent('arkme:conversation-analysis-open'))
      setOpen(value => !value)
    }}><ChartBar size={22} /></ArkmeConversationHeaderIconButton>
    {open && host.current && createPortal(<ConversationAnalysisPanel source={source} accountScope={accountScope} refreshRevision={refreshRevision} onClose={() => setOpen(false)} returnFocusRef={trigger} />, host.current)}
  </>
}

export function ConversationAnalysisPanel({ source, accountScope, refreshRevision, onClose, returnFocusRef }: {
  source: ArkmeSourceItem; accountScope: string; refreshRevision: string; onClose(): void; returnFocusRef?: RefObject<HTMLElement>
}) {
  useArkmeLocale()
  const [sender, setSender] = useState('all'), [person, setPerson] = useState<ConversationWordParticipant>(), [peopleOpen, setPeopleOpen] = useState(false)
  const [range, setRange] = useState<'all' | 'month' | 'custom'>('all'), [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7))
  const [dates, setDates] = useState({ from: dateKey(new Date()), to: dateKey(new Date()) }), [applied, setApplied] = useState(dates), [rangeError, setRangeError] = useState('')
  const [supported, setSupported] = useState(false), [tab, setTab] = useState<'words' | 'activity'>('words')
  const bounds = useMemo(() => {
    if (range === 'all') return { fromDate: null, toDate: null }
    if (range === 'custom') return { fromDate: applied.from, toDate: applied.to }
    const [year, m] = month.split('-').map(Number)
    return { fromDate: `${month}-01`, toDate: dateKey(new Date(year!, m!, 0)) }
  }, [range, month, applied])
  const query: ConversationWordsQuery = { accountScope, sourceRef: source.sourceRef, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...bounds, sender }
  const queryKey = JSON.stringify(query)
  const choose = (p: ConversationWordParticipant | undefined) => { setPerson(p); setSender(p?.isSelf ? 'self' : p?.ref ?? 'all'); setPeopleOpen(false) }
  return <><style>{conversationAnalysisStyles}</style><ArkmeDetailShell title={tr('对话分析')} subtitle={source.displayName} label={tr('对话分析面板')} className="conversation-words" onClose={onClose}
    closeLabel={tr('关闭对话分析')} widthPreferenceKey="arkme:conversation-words-width:v1" resizeLabel={tr('调整对话分析宽度')}
    {...(returnFocusRef ? { returnFocusRef } : {})} style={{ zIndex: 32 }} onPointerDownOutside={event => {
      if (event.target instanceof Node && returnFocusRef?.current?.contains(event.target)) return
      onClose()
    }}>
    <div className="cw-controls" role="tablist" aria-label={tr('对话分析类别')}>
      {([['words', '词频'], ['activity', '活跃时间']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} aria-pressed={tab === value} onClick={() => { if (value !== tab) { setTab(value); setPeopleOpen(false); setSupported(false) } }}>{tr(label)}</button>)}
    </div>
    <div className="cw-controls"><label>{tr('时间范围')}<select aria-label={tr('分析时间范围')} value={range} onChange={e => { setRange(e.target.value as typeof range); setRangeError('') }}><option value="all">{tr('全部时间')}</option><option value="month">{tr('按月')}</option><option value="custom">{tr('自定日期')}</option></select></label>
      {range === 'month' && <input type="month" aria-label={tr('分析月份')} value={month} max={dateKey(new Date()).slice(0, 7)} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value) }} />}</div>
    {range === 'custom' && <form className="cw-controls" onSubmit={event => { event.preventDefault(); if (!dates.from || !dates.to || dates.from > dates.to) setRangeError(tr('请选择有效的起止日期')); else { setApplied({ ...dates }); setRangeError('') } }}>
      <input type="date" aria-label={tr('分析开始日期')} required value={dates.from} max={dates.to} onInput={e => { const value = e.currentTarget.value; setDates(v => ({ ...v, from: value })) }} onChange={e => setDates(v => ({ ...v, from: e.target.value }))} />
      <input type="date" aria-label={tr('分析结束日期')} required value={dates.to} min={dates.from} max={dateKey(new Date())} onInput={e => { const value = e.currentTarget.value; setDates(v => ({ ...v, to: value })) }} onChange={e => setDates(v => ({ ...v, to: e.target.value }))} /><button type="submit">{tr('应用')}</button>
      {(dates.from !== applied.from || dates.to !== applied.to) && <span className="cw-muted">{tr('日期更改尚未应用')}</span>}</form>}
    {rangeError && <p role="alert">{rangeError}</p>}
    <div className="cw-controls" role="group" aria-label={tr('分析对象')}><span className="cw-muted">{tr('分析对象')}</span>
      {source.kind === 'private_chat' ? ([['all', tr('全部')], ['self', tr('我')], ['peer', source.displayName]] as const).map(([value, label]) => <button key={value} aria-pressed={sender === value} onClick={() => setSender(value)}>{label}</button>)
        : <button aria-expanded={peopleOpen} disabled={!supported} onClick={() => setPeopleOpen(v => !v)}>{sender === 'all' ? tr('全部人') : sender === 'self' ? tr('我') : person?.name ?? tr('所选发言者')} ▾</button>}</div>
    {peopleOpen && supported && <ConversationWordsPeople key={`${tab}:${query.sourceRef}:${query.fromDate}:${query.toDate}`} operation={tab === 'words' ? 'chat.word-frequency.participants' : 'chat.activity.participants'} query={{ ...query, sender: 'all' }} selected={sender} onChoose={choose} onSelf={() => { setSender('self'); setPerson(undefined); setPeopleOpen(false) }} />}
    {tab === 'words'
      ? <ConversationWordsContent key={`words:${queryKey}`} query={query} source={source} refreshRevision={refreshRevision} onSupport={setSupported} onClose={onClose} />
      : <ConversationActivity key={`activity:${queryKey}`} query={query} source={source} refreshRevision={refreshRevision} onSupport={setSupported} onClose={onClose} />}
  </ArkmeDetailShell></>
}

function ConversationWordsContent({ query, source, refreshRevision, onSupport, onClose }: { query: ConversationWordsQuery; source: ArkmeSourceItem; refreshRevision: string; onSupport(v: boolean): void; onClose(): void }) {
  const owner = useConversationWords(query, refreshRevision)
  const [view, setView] = useState<'cloud' | 'list'>('cloud'), [selected, setSelected] = useState('')
  const result = owner.state?.result, word = result?.words.find(w => w.key === selected)
  useEffect(() => { onSupport(owner.state?.supported === true); return () => onSupport(false) }, [owner.state?.supported, onSupport])
  useEffect(() => setSelected(''), [result?.id])
  return <>
    <div className="cw-controls"><button disabled={owner.loading || owner.submitting} onClick={() => void owner.read()}>{tr('检查更新')}</button><button disabled={!owner.state?.supported || owner.loading || owner.submitting || (owner.running && !owner.uncertain)} onClick={() => void owner.generate()}>{tr(owner.submitting ? '正在提交…' : owner.uncertain ? '核对提交' : owner.running ? '统计中' : result ? '更新统计' : '开始分析')}</button></div>
    {owner.error && <p role="alert">{owner.error}</p>}{owner.uncertain && <p className="cw-muted">{tr('提交结果尚未确认。核对提交会复用同一次请求，避免重复分析。')}</p>}
    {owner.loading && !owner.state && <p role="status">{tr('正在读取对话词频…')}</p>}
    {owner.state && !owner.state.supported && <div className="cw-empty"><ChartBar size={36} /><strong>{tr('对话词频服务尚未接通')}</strong><p>{tr('接通后，可查看完整聊天历史的词云，按时间和发言者分析。')}</p><p className="cw-muted">{tr('不会把当前加载的几页消息当作全部历史。')}</p></div>}
    {owner.state?.job && <p role="status">{tr(owner.state.job.status === 'failed' ? '统计未完成，请重试' : owner.state.job.status === 'queued' ? '等待统计' : '正在统计历史消息')}{owner.state.job.total > 0 && ` · ${owner.state.job.completed}/${owner.state.job.total}`}</p>}
    {result && <>
      <div className="cw-coverage"><div>{tr('已统计')} {result.analyzedMessages.toLocaleString()} / {result.eligibleMessages.toLocaleString()} {tr('条可分析消息')}</div>
        {result.fromAt !== null && result.toAt !== null && <div className="cw-muted">{dateTime(result.fromAt, query.timezone)} — {dateTime(result.toAt, query.timezone)}</div>}
        {result.excludedMessages > 0 && <div className="cw-muted">{result.excludedMessages} {tr('条无可分析正文，未计入')}</div>}
        {result.voiceTranscriptMessages > 0 && <div className="cw-muted">{tr('包含')} {result.voiceTranscriptMessages} {tr('条语音转写，未经原音核验')}</div>}
      </div>
      {(owner.state?.stale || owner.locallyStale) && <p role="status">{tr(owner.state?.stale ? '消息内容已变化，当前为上次结果，请更新统计。' : '对话有新动态，可更新统计查看最新结果。')}</p>}
      {word ? <ConversationWordsMessages key={`${result.id}:${word.key}`} query={query} resultId={result.id} word={word} source={source} onBack={() => setSelected('')} onClose={onClose} />
        : <><div className="cw-controls"><span className="cw-muted" style={{ marginRight: 'auto' }}>{tr('点击词语查看原消息')}</span><button onClick={() => setView(v => v === 'cloud' ? 'list' : 'cloud')}>{tr(view === 'cloud' ? '查看列表' : '查看词云')}</button></div><ConversationWordsCloud words={result.words} view={view} onSelect={setSelected} onList={() => setView('list')} /></>}
    </>}
    {owner.state?.supported && !owner.state.job && !result && <p className="cw-empty">{tr('尚未生成此范围的词频，点击开始分析。')}</p>}
  </>
}

export function ConversationWordsCloud({ words, view, onSelect, onList }: { words: ConversationWord[]; view: 'cloud' | 'list'; onSelect(key: string): void; onList(): void }) {
  const sorted = words.slice().sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)), max = Math.max(1, ...sorted.map(w => w.count))
  if (!sorted.length) return <p role="status">{tr('此范围暂无可分析的词语')}</p>
  return view === 'cloud' ? <><div className="cw-cloud" aria-label={tr('对话词云')}>{sorted.slice(0, 40).map(w => <button key={w.key} aria-label={`${w.text}，${w.count} ${tr('次')}`} onClick={() => onSelect(w.key)} style={{ fontSize: 15 + 17 * Math.sqrt(w.count / max), fontWeight: w.count / max > .6 ? 600 : 400 }}><span>{w.text}</span><small>{w.count}</small></button>)}</div>{sorted.length > 40 && <button onClick={onList}>{tr('查看全部词语')}</button>}</>
    : <ol className="cw-list" aria-label={tr('对话词频列表')}>{sorted.map(w => <li key={w.key}><button onClick={() => onSelect(w.key)}><span>{w.text}<small className="cw-muted">{tr('涉及')} {w.messageCount} {tr('条消息')}</small></span><span>{w.count} {tr('次')}</span></button></li>)}</ol>
}

function ConversationWordsPeople({ query, operation, selected, onChoose, onSelf }: { operation: 'chat.word-frequency.participants' | 'chat.activity.participants'; query: ConversationWordsQuery; selected: string; onChoose(p: ConversationWordParticipant | undefined): void; onSelf(): void }) {
  const [search, setSearch] = useState(''), [data, setData] = useState<ConversationWordParticipants>(), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const controller = useRef<AbortController>(), busy = useRef(false), generation = useRef(0)
  const load = async (cursor: string | null = null, epoch = generation.current) => {
    if (busy.current) return
    const c = new AbortController(); controller.current = c; busy.current = true; setLoading(true); setError('')
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<ConversationWordParticipants>(operation, { ...query, search, cursor }, signal), c.signal)
      if (cursor && value.nextCursor === cursor) throw new Error(tr('发言者分页未推进，请重新搜索'))
      if (!c.signal.aborted && epoch === generation.current) setData(old => ({ ...value, items: cursor ? [...new Map([...(old?.items ?? []), ...value.items].map(p => [p.ref, p])).values()] : value.items }))
    } catch (e) { if (!c.signal.aborted && epoch === generation.current) setError(e instanceof Error ? e.message : tr('发言者读取失败')) }
    finally { if (epoch === generation.current) { busy.current = false; if (!c.signal.aborted) setLoading(false) } }
  }
  useEffect(() => {
    const epoch = ++generation.current; controller.current?.abort(); busy.current = false; setData(undefined); setError(''); setLoading(true)
    const timer = setTimeout(() => void load(null, epoch), 200)
    return () => { clearTimeout(timer); controller.current?.abort() }
  }, [search, operation])
  return <div className="cw-person-list" aria-label={tr('选择历史发言者')}><input aria-label={tr('搜索发言者')} placeholder={tr('搜索备注或昵称')} value={search} onChange={e => setSearch(e.target.value)} />
    <button aria-pressed={selected === 'all'} onClick={() => onChoose(undefined)}>{tr('全部人')}</button><button aria-pressed={selected === 'self'} onClick={onSelf}>{tr('我')}</button>
    {data?.items.filter(p => !p.isSelf).map(p => <button key={p.ref} aria-pressed={selected === p.ref} onClick={() => onChoose(p)}>{p.name}{p.former && <small className="cw-muted"> · {tr('已离开')}</small>}</button>)}
    {loading && <p role="status">{tr('正在读取发言者…')}</p>}{error && <p role="alert">{error}<button onClick={() => void load(data?.nextCursor ?? null)}>{tr('重试')}</button></p>}
    {!loading && !error && data?.items.length === 0 && <p>{tr('没有找到发言者')}</p>}
    {data?.nextCursor && !error && <button disabled={loading} onClick={() => void load(data.nextCursor)}>{tr('更多发言者')}</button>}
  </div>
}

function ConversationWordsMessages({ query, resultId, word, source, onBack, onClose }: { query: ConversationWordsQuery; resultId: string; word: ConversationWord; source: ArkmeSourceItem; onBack(): void; onClose(): void }) {
  const [data, setData] = useState<ConversationWordMessages>(), [loading, setLoading] = useState(false), [error, setError] = useState(''), [opening, setOpening] = useState(''), [sourceError, setSourceError] = useState('')
  const controller = useRef<AbortController>(), sourceController = useRef<AbortController>(), busy = useRef(false)
  const load = async (cursor: string | null = null) => {
    if (busy.current) return
    busy.current = true; const c = new AbortController(); controller.current = c; setLoading(true); setError('')
    try {
      const page = await withArkmeReadDeadline(signal => callArkme<ConversationWordMessages>('chat.word-frequency.messages', { ...query, resultId, wordKey: word.key, cursor }, signal), c.signal)
      if (cursor && page.nextCursor === cursor) throw new Error(tr('消息分页未推进，请重新打开详情'))
      if (!c.signal.aborted) setData(old => ({ ...page, items: cursor ? [...new Map([...(old?.items ?? []), ...page.items].map(m => [m.key, m])).values()] : page.items }))
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('消息读取失败')) }
    finally { busy.current = false; if (!c.signal.aborted) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { controller.current?.abort(); sourceController.current?.abort() } }, [])
  const locate = async (message: ConversationWordMessage) => {
    if (!message.sourceRef) return
    sourceController.current?.abort(); const c = new AbortController(); sourceController.current = c; setOpening(message.key); setSourceError('')
    try {
      const target = await withArkmeReadDeadline(signal => callArkme<{ messageUid: string; sendAtMillis: number }>('chat.word-frequency.source', { ...query, resultId, messageSourceRef: message.sourceRef }, signal), c.signal)
      if (!c.signal.aborted) { onClose(); arkmeUi.showConversationTarget(source, target.messageUid, target.sendAtMillis) }
    } catch (e) { if (!c.signal.aborted) setSourceError(e instanceof Error ? e.message : tr('原消息不可定位')) }
    finally { if (!c.signal.aborted) setOpening('') }
  }
  return <section aria-label={tr('词频消息详情')}><button onClick={onBack}>{tr('返回词云')}</button><h3 style={{ marginBottom: 4 }}>{word.text}</h3><div className="cw-muted">{tr('出现')} {word.count} {tr('次')} · {tr('涉及')} {word.messageCount} {tr('条消息')}</div>
    {sourceError && <p role="alert">{sourceError}</p>}
    {data?.items.map(message => <article className="cw-message" key={message.key}><strong>{message.senderName}</strong><div className="cw-muted"><time>{dateTime(message.sentAt, query.timezone)}</time> · {message.count} {tr('次')}{message.basis === 'voice_transcript' && ` · ${tr('语音转写，未经原音核验')}`}</div><p>{message.text}</p><button disabled={!message.sourceRef || !!opening} onClick={() => void locate(message)}>{tr(opening === message.key ? '正在定位…' : '定位消息')}</button>{!message.sourceRef && <small className="cw-muted"> {tr('原消息暂不可用')}</small>}</article>)}
    {loading && <p role="status">{tr('正在读取相关消息…')}</p>}{error && <p role="alert">{error}<button onClick={() => void load(data?.nextCursor ?? null)}>{tr('重试')}</button></p>}
    {!loading && !error && data?.items.length === 0 && <p>{tr('暂无可查看的相关消息')}</p>}
    {data?.nextCursor && !error && <button disabled={loading} onClick={() => void load(data.nextCursor)}>{tr('加载更多消息')}</button>}
  </section>
}
