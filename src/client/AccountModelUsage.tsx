import { useEffect, useMemo, useState } from 'react'
import type { AccountModelSettings, ModelUsageCall, ModelUsageOperation, ModelUsagePage, ModelUsageQuery, ModelUsageTotals } from '../account-models.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'

const zone = 'Asia/Shanghai'
const formatDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const shift = (date: string, days: number) => { const value = new Date(`${date}T00:00:00+08:00`); value.setUTCDate(value.getUTCDate() + days); return formatDate(value) }
function period(grain: 'day' | 'week' | 'month', end = shift(formatDate(new Date()), 1)): { start: string; end: string } { return { start: shift(end, grain === 'day' ? -15 : grain === 'week' ? -84 : -365), end } }
function tokens(total: ModelUsageTotals, kind: 'input' | 'output' | 'cache'): string { const known = kind === 'input' ? total.input_known_calls : kind === 'output' ? total.output_known_calls : total.cache_known_calls; if (total.calls && !known) return tr('未知'); const value = kind === 'input' ? total.input_tokens : kind === 'output' ? total.output_tokens : total.cached_tokens; return `${value.toLocaleString()}${known < total.calls ? '+' : ''}` }
function totalTokens(total: ModelUsageTotals) { return total.calls && !total.input_known_calls && !total.output_known_calls ? tr('未知') : `${(total.input_tokens + total.output_tokens).toLocaleString()}${total.unknown_calls ? '+' : ''}` }
function dateTime(value: number) { return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value) }
const outcome = (call: ModelUsageCall) => call.call_status === 1 ? tr('成功') : call.call_status === 4 ? tr('已取消') : call.call_status === 3 ? tr('超时 / 结果未知') : tr('失败')

function OperationCalls({ scope, operation, query }: { scope: string; operation: ModelUsageOperation; query: ModelUsageQuery }) {
  const [calls, setCalls] = useState<ModelUsageCall[]>([]), [next, setNext] = useState<string>(), [loading, setLoading] = useState(false), [error, setError] = useState(''), [page, setPage] = useState<string | undefined>()
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    void callArkme<ModelUsagePage>('models.usage.query', { expectedAccountScope: scope, query: { ...query, mode: 'calls', operation_uid: operation.key.operation, model_uid: operation.key.model, scene: operation.key.scene, cursor: page ?? operation.calls_cursor, limit: 30 } }, controller.signal).then(value => {
      if (controller.signal.aborted || value.accountScope !== scope) return
      setCalls(current => page ? [...current, ...value.calls] : value.calls); setNext(value.next_cursor)
    }).catch(() => { if (!controller.signal.aborted) setError(tr('调用明细读取失败，请收起后重试。')) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [scope, operation.key.operation, operation.key.model, operation.key.scene, operation.calls_cursor, page])
  return <div aria-busy={loading}>{calls.map(call => <div className="arkme-model-usage-call" key={call.event_uid}>
    <strong>{dateTime(call.created_at)} · {call.model_display_name || call.model_key}</strong><span className={call.call_status !== 1 ? 'error' : ''}>{outcome(call)} · {(call.duration_ms / 1000).toFixed(1)} s</span>
    <p>{tr('输入')} {call.usage_field_mask & 1 ? call.prompt_tokens.toLocaleString() : tr('未知')} · {tr('输出')} {call.usage_field_mask & 2 ? call.completion_tokens.toLocaleString() : tr('未知')} · {tr('缓存输入')} {call.usage_field_mask & 4 ? call.cached_tokens.toLocaleString() : tr('未知')}{call.cache_creation_input_tokens > 0 && ` · ${tr('缓存写入')} ${call.cache_creation_input_tokens.toLocaleString()}`}</p>
    {call.usage_status === 4 && <p>{tr('提供方用量无效，未计入 Token 合计')}</p>}{call.error_type === 'outcome_unknown' && <p>{tr('中断前可能已发出请求，结果未知；系统没有自动重放。')}</p>}
  </div>)}{error && <p role="alert">{error}</p>}{loading && <p role="status">{tr('正在读取调用…')}</p>}{next && !loading && <button type="button" onClick={() => setPage(next)}>{tr('更多调用')}</button>}</div>
}
function OperationRow({ scope, operation, query, name }: { scope: string; operation: ModelUsageOperation; query: ModelUsageQuery; name: string }) {
  const [expanded, setExpanded] = useState(false)
  return <details className="arkme-model-usage-operation" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span><strong>{name} · {operation.name || tr('自提供模型')}</strong><small>{dateTime(operation.at)} · {operation.calls} {tr('次调用')}{operation.failed_calls > 0 && ` · ${operation.failed_calls} ${tr('次未完成')}`}</small></span><span>{totalTokens(operation)} Token<small>{tr('输入')} {tokens(operation, 'input')} · {tr('输出')} {tokens(operation, 'output')}</small></span></summary>
    {expanded && <OperationCalls scope={scope} operation={operation} query={query}/>}
  </details>
}
export function AccountModelUsage({ scope, settings }: { scope: string; settings?: AccountModelSettings | undefined }) {
  const [mode, setMode] = useState<'statistics' | 'operations'>('statistics'), [grain, setGrain] = useState<'day' | 'week' | 'month'>('day'), [window, setWindow] = useState(() => period('day'))
  const [source, setSource] = useState('all'), [model, setModel] = useState(''), [scene, setScene] = useState(''), [revision, setRevision] = useState(0), [cursor, setCursor] = useState<string>(), [result, setResult] = useState<ModelUsagePage>(), [operations, setOperations] = useState<ModelUsageOperation[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const query = useMemo<ModelUsageQuery>(() => ({ ...window, grain, source: source as NonNullable<ModelUsageQuery['source']>, model_uid: model, scene, mode, limit: 30 }), [window, grain, source, model, scene, mode])
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    void callArkme<ModelUsagePage>('models.usage.query', { expectedAccountScope: scope, query: { ...query, cursor } }, controller.signal).then(value => {
      if (controller.signal.aborted || value.accountScope !== scope) return
      setResult(value); setOperations(current => cursor ? [...current, ...value.operations] : value.operations)
    }).catch(() => { if (!controller.signal.aborted) { setError(tr(cursor ? '记录已更新或分页已过期，请刷新后重新查看。' : '暂时无法读取模型使用记录，请重试。')); setResult(undefined); if (!cursor) setOperations([]) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [scope, query, cursor, revision])
  const change = (action: () => void) => { setCursor(undefined); setResult(undefined); setOperations([]); action() }
  const [knownModels,setKnownModels]=useState<Record<string,string>>({})
  useEffect(()=>{if(result?.models.length)setKnownModels(current=>({...current,...Object.fromEntries(result.models.map(item=>[item.key,item.name||item.key]))}))},[result])
  const modelOptions={...knownModels,...Object.fromEntries(settings?.models.map(item=>[item.uid,item.name])??[])}
  const names = new Map(settings?.scenes.map(item => [item.key, item.name]))
  const series = useMemo(() => {
    if (grain !== 'day') return result?.timeline ?? []
    const values = new Map(result?.timeline.map(item => [item.key, item]))
    return Array.from({ length: 15 }, (_, index) => { const key = shift(window.start, index); return values.get(key) ?? { key, calls: 0, input_tokens: 0, output_tokens: 0, unknown_calls: 0 } })
  }, [result, grain, window])
  const max = Math.max(1, ...series.map(item => item.input_tokens + item.output_tokens))
  return <div>
    <div className="arkme-model-usage-toolbar"><div className="arkme-model-usage-segments" role="group" aria-label={tr('使用记录视图')}><button type="button" aria-pressed={mode === 'statistics'} onClick={() => change(() => setMode('statistics'))}>{tr('统计')}</button><button type="button" aria-pressed={mode === 'operations'} onClick={() => change(() => setMode('operations'))}>{tr('明细')}</button></div><button type="button" disabled={loading} onClick={() => change(() => setRevision(value => value + 1))}>{tr('刷新记录')}</button></div>
    <div className="arkme-model-usage-toolbar"><div className="arkme-model-usage-segments" role="group" aria-label={tr('统计粒度')}>{([['day', '按天'], ['week', '按周'], ['month', '按月']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={grain === key} onClick={() => change(() => { setGrain(key); setWindow(period(key)) })}>{tr(label)}</button>)}</div>
      <select aria-label={tr('筛选模型来源')} value={source} onChange={event => change(() => setSource(event.target.value))}><option value="all">{tr('全部自提供模型')}</option><option value="user-api">{tr('账号绑定模型')}</option><option value="host-local">{tr('本机 DSH 模型')}</option></select>
      <select aria-label={tr('筛选使用模型')} value={model} onChange={event => change(() => setModel(event.target.value))}><option value="">{tr('全部模型')}</option>{Object.entries(modelOptions).map(([uid,name]) => <option key={uid} value={uid}>{name}</option>)}</select>
      <select aria-label={tr('筛选使用场景')} value={scene} onChange={event => change(() => setScene(event.target.value))}><option value="">{tr('全部场景')}</option>{settings?.scenes.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select>
    </div>
    <div className="arkme-model-usage-toolbar"><button type="button" aria-label={tr('查看前一时段')} onClick={() => change(() => setWindow(period(grain, window.start)))}>‹</button><span>{window.start} — {shift(window.end, -1)}</span><button type="button" aria-label={tr('查看后一时段')} disabled={window.end >= shift(formatDate(new Date()), 1)} onClick={() => change(() => setWindow(period(grain, shift(window.end, grain === 'day' ? 15 : grain === 'week' ? 84 : 365))))}>›</button><small>{tr('北京时间')}</small></div>
    {error && <div className="arkme-account-models-notice" role="alert"><p>{error}</p><button type="button" onClick={() => change(() => setRevision(value => value + 1))}>{tr('重新读取')}</button></div>}
    {loading && <p role="status">{tr('正在读取使用记录…')}</p>}
    {result && <>
      <div className="arkme-model-usage-metrics"><div><small>{tr('输入 Token')}</small><strong>{tokens(result.totals, 'input')}</strong></div><div><small>{tr('输出 Token')}</small><strong>{tokens(result.totals, 'output')}</strong></div><div><small>{tr('调用次数')}</small><strong>{result.totals.calls.toLocaleString()}</strong></div></div>
      {result.totals.unknown_calls > 0 && <p className="arkme-account-models-notice">{tr('有 {v0} 次调用的用量不完整，合计仅包含已知 Token。',{v0:result.totals.unknown_calls})}</p>}
      {mode === 'statistics' ? <>
        <h3>{tr('按时间统计')}</h3><div className="arkme-model-usage-chart" role="img" aria-label={tr('所选时段的每日或周期 Token 使用量')}>{series.map((item, index) => <div className="arkme-model-usage-bar" key={item.key} title={`${item.key} · ${item.input_tokens + item.output_tokens} Token · ${item.calls} ${tr('次调用')}${item.unknown_calls ? ` · ${tr('含未知用量')}` : ''}`}><div style={{ height: `${Math.max(1, (item.input_tokens + item.output_tokens) / max * 100)}%`, opacity: item.calls ? 1 : .16 }}/>{(index === 0 || index === series.length - 1 || index % 3 === 0) && <span>{item.key.slice(5)}</span>}</div>)}</div>
        <p className="arkme-account-model-hint">{tr('图表为输入与输出 Token 合计，缓存输入属于输入的一部分。')}</p>
        <h3>{tr('按类型统计')}</h3>{result.scenes.length === 0 ? <p className="arkme-account-models-empty">{tr('这个时段还没有模型使用记录。')}</p> : result.scenes.map(item => <div className="arkme-model-usage-scene" key={item.key}><strong>{names.get(item.key) || item.key || tr('其他场景')}</strong><span>{totalTokens(item)} Token</span><small>{item.calls} {tr('次调用')} · {item.failed_calls} {tr('次未完成')}</small><small>{tr('缓存输入')} {tokens(item, 'cache')}</small></div>)}
      </> : <>{operations.length === 0 && !loading && <p className="arkme-account-models-empty">{tr('这个时段还没有模型使用记录。')}</p>}{operations.map(operation => <OperationRow key={`${JSON.stringify(operation.key)}:${operation.calls_cursor}`} scope={scope} operation={operation} query={query} name={names.get(operation.key.scene) || operation.key.scene || tr('其他场景')}/>)}{result.next_cursor && <button type="button" disabled={loading} onClick={() => setCursor(result.next_cursor)}>{tr('加载更多明细')}</button>}</>}
    </>}
    <p className="arkme-account-model-hint">{tr('使用记录从功能启用后开始采集，保留 {v0} 天。历史未采集用量不补造；本机记录由 Host 报告。',{v0:result?.retention_days ?? 180})}</p>
  </div>
}
