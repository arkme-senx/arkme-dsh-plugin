import { useEffect, useRef, useState } from 'react'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { speechFrequency, speechRate, type SpeechMode, type SpeechOccurrence, type SpeechOccurrences, type SpeechQuery, type SpeechResult, type SpeechTerm } from '../../recording-speech-statistics.js'
import type { ExploreSource } from '../../explore-contract.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { callArkme } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { useSpeechStatistics } from './use-speech-statistics.js'

export type SpeechSource = Extract<ExploreSource, { kind: 'recording' }>
const style = `
.speech-stats{font-size:13px;line-height:1.6;color:${arkmeTheme.text}}
.speech-stats button{font:inherit;color:inherit;cursor:pointer;border:1px solid ${arkmeTheme.borderSoft};border-radius:7px;background:transparent;padding:4px 9px}
.speech-stats button:disabled{cursor:default;opacity:.45}
.speech-stats button:focus-visible{outline:2px solid ${arkmeTheme.text};outline-offset:2px}
.speech-stats .speech-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.speech-stats button[aria-pressed=true]{background:${arkmeTheme.subtle};font-weight:600}
.speech-stats .speech-muted{color:${arkmeTheme.secondary};font-size:12px}
.speech-stats .speech-coverage{padding:12px 0;margin-bottom:12px;border-bottom:1px solid ${arkmeTheme.borderSoft}}
.speech-stats .speech-empty{padding:48px 8px;text-align:center;color:${arkmeTheme.secondary}}
.speech-stats .speech-empty svg{display:block;margin:0 auto 16px;opacity:.5}
.speech-stats .speech-cloud{display:flex;align-items:center;justify-content:center;align-content:center;gap:12px 18px;flex-wrap:wrap;min-height:190px;padding:20px 0}
.speech-stats .speech-cloud button{border:0;padding:3px;max-width:100%;overflow-wrap:anywhere;line-height:1.35;color:${arkmeTheme.text}}
.speech-stats .speech-cloud button:nth-child(3n+2){color:${arkmeTheme.secondary}}
.speech-stats .speech-cloud small{font-size:11px;margin-left:4px;font-weight:400;color:${arkmeTheme.tertiary}}
.speech-stats .speech-list{list-style:none;margin:0;padding:0}
.speech-stats .speech-list button{display:flex;justify-content:space-between;gap:12px;width:100%;border:0;border-bottom:1px solid ${arkmeTheme.borderSoft};border-radius:0;padding:10px 0;text-align:left}
.speech-stats .speech-list span:first-child{overflow-wrap:anywhere;min-width:0}
.speech-stats .speech-list span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.speech-stats .speech-occurrence{padding:14px 0;border-bottom:1px solid ${arkmeTheme.borderSoft}}
.speech-stats .speech-occurrence p{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}
.speech-stats .speech-occurrence time{font-variant-numeric:tabular-nums}
.speech-stats .speech-error{color:${arkmeTheme.text};border-left:2px solid currentColor;padding-left:8px}
`
const minutes = (ms: number) => (ms / 60000).toLocaleString(arkmeIntlLocale(), { maximumFractionDigits: 1 })
const stages = { queued: '等待分析', recognizing: '正在识别原音', verifying: '正在核验表达', counting: '正在整理词频', failed: '分析未完成，可重试' }

export function RecordingSpeechStatistics({ query, refreshRevision, onClose, onSource }: {
  query: SpeechQuery; refreshRevision: string; onClose(): void; onSource(source: SpeechSource, action: 'play' | 'locate'): void
}) {
  useArkmeLocale()
  const owner = useSpeechStatistics(query, refreshRevision)
  const [mode, setMode] = useState<SpeechMode>('habit'), [view, setView] = useState<'cloud' | 'list'>('cloud'), [selected, setSelected] = useState('')
  const [sourceError, setSourceError] = useState(''), [opening, setOpening] = useState('')
  const sourceRequest = useRef<AbortController>()
  const result = owner.state?.result, term = result?.terms.find(t => t.key === selected)
  useEffect(() => { setSelected(''); setSourceError(''); sourceRequest.current?.abort(); setOpening('') }, [result?.id, mode])
  useEffect(() => () => sourceRequest.current?.abort(), [])
  const openSource = async (occurrence: SpeechOccurrence, action: 'play' | 'locate') => {
    if (!result || !occurrence.sourceRef) return
    sourceRequest.current?.abort(); const c = new AbortController(); sourceRequest.current = c
    setOpening(occurrence.key); setSourceError('')
    try {
      const source = await withArkmeReadDeadline(signal => callArkme<SpeechSource>('recordings.speech-statistics.source', { ...query, resultId: result.id, sourceRef: occurrence.sourceRef }, signal), c.signal)
      if (!c.signal.aborted) onSource(source, action)
    } catch (e) { if (!c.signal.aborted) setSourceError(e instanceof Error ? e.message : tr('原音暂不可用')) }
    finally { if (!c.signal.aborted) setOpening('') }
  }
  return <><style>{style}</style><ArkmeDetailShell title={tr('我的说话统计')} subtitle={query.date} label={tr('每日说话统计')}
    closeLabel={tr('关闭说话统计')} onClose={onClose} className="speech-stats" style={{ position: 'fixed', top: 0, bottom: 0, right: 0, zIndex: 1001 }}
    widthPreferenceKey="arkme:speech-statistics-width:v1" resizeLabel={tr('调整说话统计宽度')}
    {...(term ? { onBack: () => { setSelected(''); setSourceError(''); sourceRequest.current?.abort(); setOpening('') }, backLabel: tr('返回词云') } : {})}>
    <div className="speech-controls"><span className="speech-muted" style={{ marginRight: 'auto' }}>{tr('仅分析本人')}</span>
      <button disabled={owner.loading || owner.submitting} onClick={() => void owner.read()}>{tr('检查更新')}</button>
      <button disabled={!owner.state?.supported || owner.loading || owner.submitting || (owner.running && !owner.uncertain)} onClick={() => void owner.generate()}>{tr(owner.submitting ? '正在提交…' : owner.uncertain ? '核对提交' : owner.running ? '分析中' : result ? '重新分析' : '开始分析')}</button></div>
    {owner.error && <p role="alert" className="speech-error">{owner.error}</p>}
    {owner.uncertain && <p className="speech-muted">{tr('上次提交结果尚未确认；核对提交会复用同一次请求，避免重复分析。')}</p>}
    {owner.loading && !owner.state && <p role="status">{tr('正在读取说话统计…')}</p>}
    {owner.state && !owner.state.supported && <div className="speech-empty"><ChartBar size={36} /><strong>{tr('原音说话统计尚未接通')}</strong><p>{tr('接通后，将根据你当天的真实发音，分析常用表达和口语习惯。')}</p><p className="speech-muted">{tr('每次出现都可试听原音，并定位到转写原文。')}</p></div>}
    {owner.state?.job && <p role="status">{tr(stages[owner.state.job.stage])}{owner.state.job.total > 0 && ` · ${owner.state.job.completed}/${owner.state.job.total}`}</p>}
    {result && (owner.state?.stale || owner.locallyStale) && <p role="status">{tr('录音或人物标记已变化，当前展示上次结果，请重新分析。')}</p>}
    {result && <>
      <div className="speech-coverage"><div>{tr('已分析本人语音')} {minutes(result.coverage.analyzedMillis)} / {minutes(result.coverage.eligibleMillis)} {tr('分钟')}</div>
        <div className="speech-muted">{result.coverage.pendingSegments > 0 && <span>{tr('待处理')} {result.coverage.pendingSegments} {tr('段')} · </span>}{result.coverage.missingAudioSegments > 0 && <span>{tr('缺少原音')} {result.coverage.missingAudioSegments} {tr('段')} · </span>}{result.coverage.uncertainSpeakerSegments > 0 && <span>{tr('本人身份待确认')} {result.coverage.uncertainSpeakerSegments} {tr('段')}</span>}</div>
      </div>
      {term ? <SpeechTermDetail key={`${result.id}:${term.key}:${mode}`} query={query} result={result} term={term} mode={mode} opening={opening} onOpen={(o, action) => void openSource(o, action)} /> : <>
        <div className="speech-controls" role="group" aria-label={tr('统计分类')}>{([['habit', '口语习惯'], ['all', '全部词频']] as const).map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{tr(label)}</button>)}
          <button style={{ marginLeft: 'auto' }} onClick={() => setView(view === 'cloud' ? 'list' : 'cloud')}>{tr(view === 'cloud' ? '查看列表' : '查看词云')}</button></div>
        <p className="speech-muted">{tr(mode === 'habit' ? '按口头衔接用法排序；当天表现仅供观察，不直接判定为口头禅。' : '按原音核验后的出现次数排序，待核验次数单独显示。')}</p>
        <SpeechWords result={result} mode={mode} view={view} onSelect={setSelected} onList={() => setView('list')} />
      </>}
    </>}
    {sourceError && <p role="alert" className="speech-error">{sourceError}</p>}
    {owner.state?.supported && !result && !owner.state.job && <div className="speech-empty"><ChartBar size={36} /><strong>{tr('看看你今天常说什么')}</strong><p>{tr('点击开始分析，读取当天已确认属于你的语音。')}</p></div>}
  </ArkmeDetailShell></>
}

export function SpeechWords({ result, mode, view, onSelect, onList }: { result: SpeechResult; mode: SpeechMode; view: 'cloud' | 'list'; onSelect(key: string): void; onList(): void }) {
  const terms = result.terms.filter(t => speechFrequency(t, mode) > 0 || (view === 'list' && t.pendingCount > 0))
    .sort((a, b) => speechFrequency(b, mode) - speechFrequency(a, mode) || a.text.localeCompare(b.text))
  const max = Math.max(1, ...terms.map(t => speechFrequency(t, mode))), visible = view === 'cloud' ? terms.slice(0, 40) : terms
  return <>
    {!terms.length && <p role="status">{tr(mode === 'habit' ? '暂无已核验的口头衔接表达' : '暂无已核验的词频')}{result.terms.some(t => t.pendingCount > 0) && <button onClick={onList}>{tr('查看待核验表达')}</button>}</p>}
    {view === 'cloud' ? <div className="speech-cloud" aria-label={tr('说话词云')}>{visible.map(t => <button key={t.key} onClick={() => onSelect(t.key)} aria-label={`${t.text}，${speechFrequency(t, mode)} ${tr('次')}`} style={{ fontSize: 15 + 17 * Math.sqrt(speechFrequency(t, mode) / max), fontWeight: speechFrequency(t, mode) / max > .6 ? 600 : 400 }}><span>{t.text}</span><small>{speechFrequency(t, mode)}</small></button>)}</div>
      : <ol className="speech-list" aria-label={tr('说话词频列表')}>{visible.map(t => <li key={t.key}><button onClick={() => onSelect(t.key)}><span>{t.text}</span><span>{speechFrequency(t, mode)} {tr('次')}{t.pendingCount > 0 && <small className="speech-muted"> · {tr('待核验')} {t.pendingCount}</small>}</span></button></li>)}</ol>}
    {view === 'cloud' && terms.length > 40 && <button onClick={onList}>{tr('查看全部表达')}</button>}
  </>
}

export function SpeechTermDetail({ query, result, term, mode, opening, onOpen }: { query: SpeechQuery; result: SpeechResult; term: SpeechTerm; mode: SpeechMode; opening: string; onOpen(o: SpeechOccurrence, action: 'play' | 'locate'): void }) {
  const [data, setData] = useState<SpeechOccurrences>(), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const controller = useRef<AbortController>(), busy = useRef(false)
  const load = async (cursor: string | null = null) => {
    if (busy.current) return
    busy.current = true; setLoading(true); setError(''); const c = new AbortController(); controller.current = c
    try {
      const page = await withArkmeReadDeadline(signal => callArkme<SpeechOccurrences>('recordings.speech-statistics.occurrences', { ...query, resultId: result.id, termKey: term.key, mode, cursor }, signal), c.signal)
      if (page.nextCursor && page.nextCursor === cursor) throw new Error(tr('出现记录分页未推进，请重新打开详情'))
      if (!c.signal.aborted) setData(current => ({ ...page, items: cursor ? [...new Map([...(current?.items ?? []), ...page.items].map(item => [item.key, item])).values()] : page.items }))
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('出现记录读取失败')) }
    finally { busy.current = false; if (!c.signal.aborted) setLoading(false) }
  }
  useEffect(() => { void load(); return () => controller.current?.abort() }, [])
  const rate = speechRate(term, mode, result.coverage.analyzedMillis)
  return <section aria-label={tr('表达出现详情')}><h3 style={{ margin: '0 0 6px' }}>{term.text}</h3><div>{tr('原音核验')} {term.verifiedCount} {tr('次')} · {tr('口头衔接')} {term.habitCount} {tr('次')}</div>
    <p className="speech-muted">{term.pendingCount > 0 && <>{tr('另有')} {term.pendingCount} {tr('次待核验，未计入确定次数')}。 </>}{rate !== null && <>{tr('每 10 分钟本人语音约')} {rate} {tr('次')}{mode === 'habit' && `（${tr('口头衔接')}）`}</>}</p>
    {data?.items.map(o => <article className="speech-occurrence" key={o.key}><time className="speech-muted">{new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: query.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(o.startAtMillis)}</time> <small>{tr(o.verification === 'pending' ? '待核验' : o.use === 'habit' ? '口头衔接' : '已核验')}</small><p>{o.text}</p>
      {o.originalText !== o.text && <details><summary className="speech-muted">{tr('与原转写不同')}</summary><p className="speech-muted">{o.originalText || tr('原转写未包含这段表达')}</p></details>}
      <div className="speech-controls"><button disabled={!o.sourceRef || !!opening} onClick={() => onOpen(o, 'play')}>{tr(opening === o.key ? '正在打开…' : '试听原音')}</button><button disabled={!o.sourceRef || !!opening} onClick={() => onOpen(o, 'locate')}>{tr('定位原文')}</button>{!o.sourceRef && <small>{tr('原音位置暂不可用')}</small>}</div>
    </article>)}
    {loading && <p role="status">{tr('正在读取出现记录…')}</p>}{error && <p role="alert">{error} <button onClick={() => void load(data?.nextCursor ?? null)}>{tr('重试')}</button></p>}
    {!loading && !error && data?.items.length === 0 && <p>{tr('暂无可查看的出现记录')}</p>}
    {!error && data?.nextCursor && <button disabled={loading} onClick={() => void load(data.nextCursor)}>{tr('加载更多出现记录')}</button>}
  </section>
}
