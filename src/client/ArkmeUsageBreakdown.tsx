import { useEffect, useRef, useState } from 'react'
import type { ArkmeAccountStorageUsage, ArkmeStorageCategory } from '../account-usage.js'
import type { ArkmeTokenUsageCall, ArkmeTokenUsageOperation, ArkmeTokenUsagePage, ArkmeTokenUsageSummary, ArkmeUsageTokens } from '../account-usage-details.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'

const count = (value: number) => new Intl.NumberFormat(arkmeIntlLocale()).format(value)
function time(value: number, timezone?: string) {
  return value > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(timezone ? { timeZone: timezone } : {}) }).format(value) : tr('未知')
}
function monthLabel(value: string) {
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`))
}
const cacheLabel = (value: number) => tr(({ 2: '未命中', 3: '已命中', 4: '混合命中' } as Record<number, string>)[value] ?? '未知')

export function ArkmeStorageUsageBreakdown({ usage, formatBytes }: { usage: ArkmeAccountStorageUsage; formatBytes(value: number): string }) {
  useArkmeLocale()
  const labels: Record<ArkmeStorageCategory, string> = { image: '图片', video: '视频', file: '文件', backgroundVoice: '背景音', callRecording: '通话录音', other: '其他' }
  return <div className="arkme-usage-breakdown" data-usage-detail="storage">
    {usage.breakdown === undefined ? <p role="status">{tr('存储分类明细暂不可用，汇总用量仍有效，请稍后刷新。')}</p>
      : usage.usedBytes === 0 ? <p>{tr('当前未使用云存储空间')}</p>
      : <ul className="arkme-storage-composition" aria-label={tr('空间构成')}>
        {usage.breakdown.map(item => <li key={item.category}>
          <span>{tr(labels[item.category])}</span><strong>{formatBytes(item.bytes)}</strong>
          <span>{new Intl.NumberFormat(arkmeIntlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(item.bytes / usage.usedBytes)}</span>
        </li>)}
      </ul>}
    <small>{tr('占比按已用空间计算。文字、快记短语音和缩略图不计入存储空间。')}</small>
  </div>
}

function Retry({ onRetry, more = false }: { onRetry(): void; more?: boolean }) {
  return <p role="alert" className="arkme-usage-detail-error">{tr(more ? '明细加载失败，已有结果保留。' : '暂时无法读取用量明细。')} <button type="button" onClick={onRetry}>{tr('重试')}</button></p>
}
function TokenNumbers({ tokens }: { tokens: ArkmeUsageTokens }) {
  return <p className="arkme-usage-detail-meta">{tr('输入 {input} · 输出 {output}', { input: count(tokens.promptTokens), output: count(tokens.completionTokens) })}</p>
}

/** One controller per query; navigation/closing cancels reads and ignores late responses. */
function usePages<T>(operation: 'account.usage.token.operations' | 'account.usage.token.calls', scope: string, params: Record<string, string | number>, identity?: (item: T) => string) {
  const query = JSON.stringify(params), key = `${scope}:${operation}:${query}`
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; items: T[]; nextCursor: string; status: 'loading' | 'ready' | 'error'; more: 'idle' | 'loading' | 'error' }>()
  const request = useRef<{ key: string; controller: AbortController; busy: boolean }>()
  const [pageRequest, setPageRequest] = useState<{ key: string; cursor: string }>()
  useEffect(() => {
    const current = { key, controller: new AbortController(), busy: true }
    request.current = current
    const cursor = pageRequest?.key === key ? pageRequest.cursor : ''
    if (!cursor) setState({ key, items: [], nextCursor: '', status: 'loading', more: 'idle' })
    else setState(old => old?.key === key ? { ...old, more: 'loading' } : old)
    void callArkme<ArkmeTokenUsagePage<T>>(operation, { ...JSON.parse(query), expectedAccountScope: scope, cursor }, current.controller.signal).then(page => {
      if (current.controller.signal.aborted || request.current !== current) return
      if (page.accountScope !== scope || (page.nextCursor && page.nextCursor === cursor)) throw new Error('stale usage page')
      setState(old => {
        const combined = cursor && old?.key === key ? [...old.items, ...page.items] : page.items
        const items = identity ? [...new Map(combined.map(item => [identity(item), item])).values()] : combined
        return { key, items, nextCursor: page.nextCursor, status: 'ready', more: 'idle' }
      })
    }).catch(() => {
      if (current.controller.signal.aborted || request.current !== current) return
      setState(old => cursor && old?.key === key ? { ...old, more: 'error' } : { key, items: [], nextCursor: '', status: 'error', more: 'idle' })
    }).finally(() => { current.busy = false })
    return () => current.controller.abort()
  }, [key, query, scope, operation, revision, pageRequest])
  const load = (cursor: string) => {
    if (request.current?.key !== key || request.current.busy) return
    request.current.busy = true
    setPageRequest({ key, cursor }); setRevision(value => value + 1)
  }
  return { state: state?.key === key ? state : undefined, load }
}
const operationKey = (item: ArkmeTokenUsageOperation) => `${item.operationUid}:${item.bizCode}`

function CallDetails({ scope, monthKey, timezone, operation }: { scope: string; monthKey: string; timezone: string; operation: ArkmeTokenUsageOperation }) {
  const { state, load } = usePages<ArkmeTokenUsageCall>('account.usage.token.calls', scope, { monthKey, timezone, operationUid: operation.operationUid, bizCode: operation.bizCode })
  return <div className="arkme-usage-calls" aria-label={tr('逐次调用明细')}>
    <TokenNumbers tokens={operation.tokens} />
    {operation.partialUsage && <small>{tr('部分用量字段不可用')}</small>}
    {!state || state.status === 'loading' ? <p role="status">{tr('读取中…')}</p> : state.status === 'error' ? <Retry onRetry={() => load('')} /> : <>
      {state.items.length === 0 ? <p>{tr('暂无逐次调用记录')}</p> : <ol>
        {state.items.map((item, index) => <li key={index}>
          <div className="arkme-usage-call-title"><strong>{item.model || tr('未知模型')}</strong><time>{time(item.occurredAtMs, timezone)}</time></div>
          <p>{count(item.tokens.totalTokens)} Token</p><TokenNumbers tokens={item.tokens} />
          <p className="arkme-usage-detail-meta">{tr('缓存：{status} · 命中 {hit} · 未命中 {miss}', { status: cacheLabel(item.cacheStatus), hit: count(item.tokens.cachedTokens), miss: count(item.tokens.cacheMissTokens) })}{item.tokens.cacheCreationInputTokens > 0 && tr(' · 缓存创建 {value}', { value: count(item.tokens.cacheCreationInputTokens) })}</p>
          {item.usageStatus !== 3 && <small>{tr('部分用量字段不可用')}</small>}
        </li>)}
      </ol>}
      {state.more === 'error' && <Retry more onRetry={() => load(state.nextCursor)} />}
      {state.nextCursor && state.more !== 'error' && <button type="button" disabled={state.more === 'loading'} onClick={() => load(state.nextCursor)}>{tr(state.more === 'loading' ? '读取中…' : '加载更多调用')}</button>}
    </>}
  </div>
}

function OperationList({ scope, summary }: { scope: string; summary: ArkmeTokenUsageSummary }) {
  const { state, load } = usePages<ArkmeTokenUsageOperation>('account.usage.token.operations', scope, { monthKey: summary.monthKey, timezone: summary.timezone }, operationKey)
  const [selected, setSelected] = useState('')
  if (!state || state.status === 'loading') return <p role="status">{tr('读取中…')}</p>
  if (state.status === 'error') return <Retry onRetry={() => load('')} />
  return <>
    {state.items.length === 0 ? <p>{tr('该月份暂无 Token 用量记录')}</p> : <ul className="arkme-token-operations">
      {state.items.map(item => {
        const key = operationKey(item), open = selected === key
        return <li key={key}>
          <button className="arkme-token-operation" type="button" aria-expanded={open} aria-label={tr('查看 {name} 的调用明细', { name: item.displayName })} onClick={() => setSelected(open ? '' : key)}>
            <span><strong>{item.displayName}</strong><small>{time(item.occurredAtMs, summary.timezone)} · {tr('{count} 次模型调用', { count: count(item.callCount) })} · {tr('缓存：{status}', { status: cacheLabel(item.cacheStatus) })}</small></span>
            <span>{count(item.tokens.totalTokens)} Token <span aria-hidden>{open ? '⌄' : '›'}</span></span>
          </button>
          {open && <CallDetails key={key} scope={scope} monthKey={summary.monthKey} timezone={summary.timezone} operation={item} />}
        </li>
      })}
    </ul>}
    {state.more === 'error' && <Retry more onRetry={() => load(state.nextCursor)} />}
    {state.nextCursor && state.more !== 'error' && <button type="button" disabled={state.more === 'loading'} onClick={() => load(state.nextCursor)}>{tr(state.more === 'loading' ? '读取中…' : '加载更多')}</button>}
  </>
}

export function ArkmeTokenUsageBreakdown({ scope, revision }: { scope: string; revision: number }) {
  useArkmeLocale()
  const [month, setMonth] = useState(''), [retry, setRetry] = useState(0)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const key = `${scope}:${month}:${revision}:${retry}`
  const [state, setState] = useState<{ key: string; status: 'ready'; value: ArkmeTokenUsageSummary } | { key: string; status: 'error' }>()
  const [months, setMonths] = useState<string[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeTokenUsageSummary>('account.usage.token.summary', { expectedAccountScope: scope, monthKey: month, timezone }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.accountScope !== scope || (month && value.monthKey !== month)) throw new Error('stale usage summary')
      setMonths([...new Set([value.monthKey, ...value.availableMonths])].sort().reverse())
      setState({ key, status: 'ready', value })
    }).catch(() => { if (!controller.signal.aborted) setState({ key, status: 'error' }) })
    return () => controller.abort()
  }, [key, scope, month, timezone])
  const ready = state?.key === key && state.status === 'ready' ? state.value : undefined
  return <div className="arkme-usage-breakdown" data-usage-detail="tokens">
    <div className="arkme-token-detail-toolbar">
      {months.length > 0 && <label>{tr('月份')} <select aria-label={tr('选择用量月份')} value={month || ready?.monthKey || months[0]} onChange={event => setMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>}
      {ready && <strong>{tr('该月已记录')} {count(ready.tokens.totalTokens)} Token</strong>}
    </div>
    <small>{tr('模型实际调用用量，不等同于月度额度扣减或充值消费。')}</small>
    {!state || state.key !== key ? <p role="status">{tr('读取中…')}</p> : state.status === 'error' ? <Retry onRetry={() => setRetry(value => value + 1)} /> : <>
      {ready!.partialUsage && <small>{tr('部分用量字段不可用')}</small>}
      {ready!.availableFromMs > 0 && <small>{tr('明细可查询起点：{time}', { time: time(ready!.availableFromMs, ready!.timezone) })}</small>}
      <OperationList key={key} scope={scope} summary={ready!} />
    </>}
  </div>
}
