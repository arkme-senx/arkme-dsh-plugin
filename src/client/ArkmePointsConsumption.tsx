import { useEffect, useRef, useState } from 'react'
import { formatAiPoints, type ArkmeAiPointsPage, type ArkmeAiPointsConsumption } from '../ai-points.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'

const calendarMonth = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date())
const tokenCount = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
type PageState = { key: string; status: 'loading' | 'ready' | 'error'; items: ArkmeAiPointsConsumption[]; total: string; next: string; more: 'idle' | 'loading' | 'error' }

export function ArkmePointsConsumption({ scope, revision }: { scope: string; revision: number }) {
  useArkmeLocale()
  const [month, setMonth] = useState(calendarMonth)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<PageState>()
  const request = useRef<AbortController>()
  const key = `${scope}:${month}:${revision}:${retry}`
  const pending = useRef('')
  const currentKey = useRef(key)
  currentKey.current = key
  const read = async (cursor = '') => {
    const pendingKey = `${key}:${cursor}`
    if (pending.current === pendingKey && !request.current?.signal.aborted) return
    pending.current = pendingKey
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (!cursor) setState({ key, status: 'loading', items: [], total: '0', next: '', more: 'idle' })
    else setState(previous => previous?.key === key ? { ...previous, more: 'loading' } : previous)
    try {
      const page = await callArkme<ArkmeAiPointsPage>('account.points.consumption', { expectedAccountScope: scope, month, ...(cursor ? { beforeId: cursor } : {}) }, controller.signal)
      if (controller.signal.aborted || currentKey.current !== key) return
      if (page.accountScope !== scope || page.month !== month || (cursor && page.nextBeforeId && BigInt(page.nextBeforeId) >= BigInt(cursor))) throw new Error('stale points page')
      setState(previous => ({ key, status: 'ready', items: [...new Map([...(cursor && previous?.key === key ? previous.items : []), ...page.items].map(item => [item.requestUid, item])).values()], total: page.chargedPoints, next: page.nextBeforeId, more: 'idle' }))
    } catch {
      if (controller.signal.aborted || currentKey.current !== key) return
      setState(previous => previous?.key === key ? { ...previous, ...(cursor ? { more: 'error' } : { status: 'error' }) } : previous)
    } finally { if (!controller.signal.aborted) pending.current = '' }
  }
  useEffect(() => { void read(); return () => request.current?.abort() }, [key])
  const current = state?.key === key ? state : undefined
  return <div className="arkme-usage-breakdown" data-usage-detail="points">
    <label>{tr('月份')} <input aria-label={tr('消费月份')} type="month" value={month} max={calendarMonth()} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value <= calendarMonth()) setMonth(event.target.value) }} /></label>
    {(!current || current.status === 'loading') && <p role="status">{tr('读取中…')}</p>}
    {current?.status === 'error' && <p role="alert">{tr('暂时无法读取消费明细。')} <button type="button" onClick={() => setRetry(value => value + 1)}>{tr('重试')}</button></p>}
    {current?.status === 'ready' && <>
      <p>{tr('本月消费')} <strong>{formatAiPoints(current.total)}</strong> {tr('积分')}</p>
      {current.items.length === 0 && <p>{tr('本月暂无积分消费')}</p>}
      {current.items.map(item => <details className="arkme-usage-metric" key={item.requestUid}>
        <summary><strong>{item.businessCode === 'agent' ? 'Agent' : item.model}</strong> · {formatAiPoints(item.chargedPoints)} {tr('积分')}<br /><small>{new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(item.createdAt)}</small></summary>
        <p>{item.model}</p>
        {item.services.length > 0 && <>
          <p>{tr('模型调用')} {item.modelPoints} {tr('积分')}</p>
          {item.services.map(service => <p key={service.code}>{tr(service.code === 'web_search' ? '联网搜索' : '附加服务')} {service.chargedPoints} {tr('积分')}</p>)}
        </>}
        <p>{tr('赠送积分')} {formatAiPoints(item.grantedPoints)} · {tr('充值积分')} {formatAiPoints(item.purchasedPoints)}</p>
        <small>{tr('精确消费')} {item.chargedPoints} {tr('积分')}</small>
        <p>{tr('输入 Token')} {tokenCount((BigInt(item.tokens.cacheHitInput) + BigInt(item.tokens.cacheMissInput)).toString())} · {tr('输出 Token')} {tokenCount(item.tokens.output)}</p>
        <small>{tr('缓存命中')} {tokenCount(item.tokens.cacheHitInput)} · {tr('缓存未命中')} {tokenCount(item.tokens.cacheMissInput)}</small>
      </details>)}
      {current.more === 'error' && <p role="alert">{tr('加载失败，已有明细已保留。')}</p>}
      {current.next && <button type="button" disabled={current.more === 'loading'} onClick={() => void read(current.next)}>{tr(current.more === 'loading' ? '读取中…' : current.more === 'error' ? '重试' : '加载更多')}</button>}
    </>}
  </div>
}
