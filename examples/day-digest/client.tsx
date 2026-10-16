import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createArkmeSdk, type ArkmeDayDigestState } from '@senguoyun/dsh-arkme/sdk'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

const sdk = createArkmeSdk()
const labels = { audio: '录音', call: '通话', chat: '聊天', self: '记录', location: '位置' }
const dateText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
function AccountBoundDigest() {
  const [scope, setScope] = useState('')
  useEffect(() => sdk.subscribe(state => setScope(state.authStatus === 'authenticated' ? `${state.environment}:${state.userId}` : ''), { onError: () => setScope('') }), [])
  return scope ? <DayDigest key={scope} /> : <p>请先登录。账号变化后会重新读取该账号的结果。</p>
}
function DayDigest() {
  const [date, setDate] = useState(dateText(new Date()))
  const [tab, setTab] = useState<'summary' | 'timeline'>('timeline')
  const [state, setState] = useState<ArkmeDayDigestState>(), [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const key = useRef(''), epoch = useRef(0), pending = useRef<AbortController>()
  const query = useMemo(() => {
    const midnight = new Date(`${date}T00:00:00`)
    return { dateStamp: midnight.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, timeZoneOffsetMillis: -midnight.getTimezoneOffset() * 60000 }
  }, [date])
  useEffect(() => {
    epoch.current++; key.current = ''; setState(undefined); setError('')
    const dispose = sdk.subscribeDayDigest(query, value => { setState(value); setError('') }, {
      onError: reason => { setState(undefined); setError(String(reason)) }, intervalMs: 5000,
    })
    return () => { epoch.current++; pending.current?.abort(); dispose() }
  }, [query])
  const generate = async () => {
    if (submitting) return
    const current = epoch.current, abort = new AbortController(); pending.current = abort
    key.current ||= crypto.randomUUID()
    setSubmitting(true); setError('')
    try {
      // No await before this call: it must retain the current browser gesture.
      const receipt = await sdk.generateDayDigest({ ...query, kinds: ['summary', 'timeline'], sources: ['audio', 'call', 'chat', 'self'], idempotencyKey: key.current }, abort.signal)
      if (current !== epoch.current) return
      setState(previous => ({ ...previous, ...receipt, result: receipt.result ?? previous?.result ?? null })); key.current = ''
    } catch (reason) {
      // Preserve the exact key after a lost acknowledgement. Never auto-retry.
      if (current === epoch.current) setError(String(reason))
    } finally { if (current === epoch.current) setSubmitting(false) }
  }
  const running = state?.job && !['ready', 'failed'].includes(state.job.status)
  return <section aria-label="日总结示例" style={{ padding: 24, maxWidth: 900 }}>
    <h2>日总结</h2>
    <label>日期 <input type="date" value={date} disabled={submitting} onChange={event => { if (event.target.value) setDate(event.target.value) }} /></label>{' '}
    <button disabled={!state?.supported || state.generationEnabled !== true || submitting || !!running} onClick={() => { void generate() }}>{submitting ? '等待确认…' : '生成时间轴和日总结'}</button>
    {state?.generationEnabled === false && <p>当前 Provider 仅支持读取已有结果。</p>}
    {error && <p role="alert">{error}</p>}
    {state?.resultUnavailableReason && <p role="alert">来源已变化或当前不可访问，结果已隐藏；请重新生成</p>}
    {state?.job && <p role="status">{state.job.status} · {state.job.stage} {state.job.message} {state.job.errorCode}</p>}
    <div role="tablist"><button role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>时间轴</button><button role="tab" aria-selected={tab === 'summary'} onClick={() => setTab('summary')}>日总结</button></div>
    {!state?.result && <p>尚无可用结果。读取和刷新不会发起生成。</p>}
    {state?.result?.coverage.map(source => <p key={source.kind}>{labels[source.kind]}：{source.count} 条 · {source.status} {source.note}</p>)}
    {tab === 'summary' ? state?.result?.summary.map((point, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{point.text}</p>) : state?.result?.timeline.map((event, i) => <details key={i}>
      <summary>{new Date(event.startAtMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {event.title} · {event.scene}</summary>
      <p>{event.text}</p><p>参与者：{event.roles?.join('、')}</p><p>发生的事情：{event.events?.join('；')}</p><p>我的心情：{event.mood}</p><p>待办：{event.todos?.join('；')}</p><p>代表性原话：{event.quotes?.join('；')}</p>
    </details>)}
  </section>
}
export const inject = ['slots']
export function apply(ctx: ClientContext) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'day-digest-example', order: 100, label: () => '日总结示例' }, AccountBoundDigest))
}
