import { useEffect, useRef, useState } from 'react'
import { groupPointsConsumption, formatAiPoints, pointsUnits, type ArkmeAiPointsPage, type ArkmeAiPointsConsumption } from '../ai-points.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'

const calendarMonth = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date())
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
    <div className="arkme-points-toolbar">
      <input aria-label={tr('消费月份')} type="month" value={month} max={calendarMonth()} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value <= calendarMonth()) setMonth(event.target.value) }} />
      {current?.status === 'ready' && current.items.length > 0 && <span>{tr('该月消费')} <strong>{formatAiPoints(current.total)}</strong> {tr('积分')}</span>}
    </div>
    {(!current || current.status === 'loading') && <p role="status">{tr('读取中…')}</p>}
    {current?.status === 'error' && <p role="alert">{tr('暂时无法读取消费明细。')} <button type="button" onClick={() => setRetry(value => value + 1)}>{tr('重试')}</button></p>}
    {current?.status === 'ready' && <>
      {current.items.length === 0 && <p>{tr('该月暂无积分消费')}</p>}
      {groupPointsConsumption(current.items).map(group => <details key={group.key}>
        <summary><span><strong>{consumptionLabel(group.calls[0]!.businessCode)}</strong><small>{new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(group.calls[group.calls.length - 1]!.createdAt)}</small></span><span className="arkme-points-record-amount">−{formatAiPoints(group.chargedPoints)} {tr('积分')} <span className="arkme-points-chevron" aria-hidden>›</span></span></summary>
        {group.calls.map(item => <PointsCallDetails key={item.requestUid} item={item} />)}
      </details>)}
      {current.more === 'error' && <p role="alert">{tr('加载失败，已有明细已保留。')}</p>}
      {current.next && <button type="button" disabled={current.more === 'loading'} onClick={() => void read(current.next)}>{tr(current.more === 'loading' ? '读取中…' : current.more === 'error' ? '重试' : '加载更多')}</button>}
    </>}
  </div>
}

function consumptionLabel(businessCode: string): string {
  if (businessCode === 'agent') return 'Agent'
  if (businessCode === 'arkme') return tr('DSH 对话')
  return tr('AI 调用')
}

function PointsCallDetails({ item }: { item: ArkmeAiPointsConsumption }) {
 const granted = pointsUnits(item.grantedPoints) > 0n
 const purchased = pointsUnits(item.purchasedPoints) > 0n
 const funding = granted && purchased
   ? tr('（赠送 {v0} · 充值 {v1}）', { v0: formatAiPoints(item.grantedPoints), v1: formatAiPoints(item.purchasedPoints) })
   : granted ? tr('（赠送）') : purchased ? tr('（充值）') : ''
 return <div className="arkme-points-call">
        <div className="arkme-usage-call-title"><span>{item.model}</span><span>{formatAiPoints(item.chargedPoints)} {tr('积分')}<span className="arkme-points-funding">{funding}</span></span></div>
        {item.services.length > 0 && <>
          <small>{tr('模型调用')} {formatAiPoints(item.modelPoints)} {tr('积分')}{item.services.map(service => <span key={service.code}> · {tr(service.code === 'web_search' || service.code === 'bailian.web_search.turbo' ? '联网搜索' : '附加服务')} {formatAiPoints(service.chargedPoints)} {tr('积分')}</span>)}</small>
        </>}
 </div>
}
