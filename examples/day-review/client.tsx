import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createArkmeSdk, projectDayReviewRecordingSection, ArkmeClientError, type DayReviewModels, type DayReviewCreateInput, type DayReviewState } from '@senguoyun/dsh-arkme/sdk'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

type ArkmeRecordingTimelineEvent = ReturnType<typeof projectDayReviewRecordingSection>['items'][number]['timelineEvents'][number]
const sdk = createArkmeSdk()
const labels = { location: '位置', audio: '录音', call: '通话', chat: '聊天', self: '记录' }
const dateText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
function AccountBoundDigest() {
  const [scope, setScope] = useState('')
  useEffect(() => sdk.subscribe(state => setScope(state.authStatus === 'authenticated' ? `${state.environment}:${state.userId}` : ''), { onError: () => setScope('') }), [])
  return scope ? <DayReview key={scope} accountScope={scope} /> : <p>请先登录。账号变化后会重新读取该账号的结果。</p>
}
function DayReview({ accountScope }: { accountScope: string }) {
  const [date, setDate] = useState(dateText(new Date()))
  const [tab, setTab] = useState<'summary' | 'timeline'>('timeline')
  const [state, setState] = useState<DayReviewState>(), [error, setError] = useState('')
  const [models, setModels] = useState<DayReviewModels>(), [modelCode, setModelCode] = useState('')
  const intent = useRef<DayReviewCreateInput>()
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<ArkmeRecordingTimelineEvent>()
  const key = useRef(''), epoch = useRef(0), pending = useRef<AbortController>()
  const query = useMemo(() => ({ accountScope, bucketDate: date, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), [date, accountScope])
  const section = state?.result ? projectDayReviewRecordingSection(state.result, query) : undefined
  useEffect(() => {
    epoch.current++; key.current = ''; intent.current = undefined; setState(undefined); setSelected(undefined); setError('')
    const dispose = sdk.subscribeDayReview(query, value => {
      setState(value); setError('')
      setSelected(current => (value.result ? projectDayReviewRecordingSection(value.result, query).items.flatMap(x => x.timelineEvents) : []).find(x => x.eventId === current?.eventId))
    }, {
      onError: reason => { setState(undefined); setSelected(undefined); setError(String(reason)) },
    })
    return () => { epoch.current++; pending.current?.abort(); dispose() }
  }, [query])
  useEffect(() => {
    const controller = new AbortController(); setModels(undefined); setModelCode('')
    void sdk.dayReviewModels(query, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setModels(value); setModelCode(value.models.some(x => x.code === value.defaultCode) ? value.defaultCode : value.models[0]?.code ?? '')
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)) })
    return () => controller.abort()
  }, [query])
  const generate = async (startNew = false) => {
    if (submitting) return
    const current = epoch.current, abort = new AbortController(); pending.current = abort
    key.current ||= crypto.randomUUID()
    intent.current ??= { ...query, sourceKinds: ['audio', 'call', 'chat', 'self', 'location'], requestId: key.current, modelCode }
    setSubmitting(true); setError('')
    try {
      // No await before this call: it must retain the current browser gesture.
      const receipt = await (state?.pendingRequestId ? sdk.reconcileDayReview(query, abort.signal) : !startNew && state?.job?.resumable ? sdk.resumeDayReview({ ...query, jobId: state.job.id }, abort.signal) : sdk.createDayReview(intent.current, abort.signal))
      if (current !== epoch.current) return
      setState(receipt); setSelected(undefined); key.current = ''; intent.current = undefined
    } catch (reason) {
      // Preserve the exact key after a lost acknowledgement. Never auto-retry.
      if (current === epoch.current) {
        if (reason instanceof ArkmeClientError && ['calendar-review-not-accepted', 'day-review-human-required'].includes(reason.body.code)) { intent.current = undefined; key.current = '' }
        setError(String(reason))
      }
    } finally { if (current === epoch.current) setSubmitting(false) }
  }
  const running = state?.job && state.job.status !== 'failed'
  const events = section?.items[0]?.timelineEvents ?? []
  return <section aria-label="日回顾示例" style={{ padding: 24, maxWidth: 900 }}>
    <h2>日总结</h2>
    <label>日期 <input type="date" value={date} disabled={submitting} onChange={event => { if (event.target.value) setDate(event.target.value) }} /></label>{' '}
    <label>模型 <select aria-label="模型" value={modelCode} disabled={submitting || !!intent.current || !!state?.pendingRequestId || !!running} onChange={event => setModelCode(event.target.value)}>{models?.models.map(model => <option key={model.code} value={model.code}>{model.displayName}</option>)}</select></label>{' '}
    <button disabled={!state?.supported || submitting || !!running || (!modelCode && !state?.pendingRequestId && !state?.job?.resumable)} onClick={() => { void generate() }}>{submitting ? '等待确认…' : state?.pendingRequestId ? '核对原请求' : state?.job?.resumable ? '恢复生成' : '生成时间轴和日总结'}</button>
    {state?.job?.resumable && <button disabled={submitting || !!running || !!state.pendingRequestId || !!intent.current || !modelCode} onClick={() => { void generate(true) }}>重新生成（新任务）</button>}
    {state?.supported === false && <p>当前 Provider 不支持日回顾。</p>}
    {error && <p role="alert">{error}</p>}
    {state?.resultError && <p role="alert">来源已变化或当前不可访问，结果已隐藏；请重新生成</p>}
    {state?.job && <p role="status">{state.job.status} {state.job.message} {state.job.failureCode}</p>}
    <div role="tablist"><button role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>时间轴</button><button role="tab" aria-selected={tab === 'summary'} onClick={() => setTab('summary')}>日总结</button></div>
    {!state?.result && <p>尚无可用结果。读取和刷新不会发起生成。</p>}
    {state?.result && <p>实际来源：{section!.sourceScope.map(x => labels[x]).join('、') || '无'} · 时区：{query.timezone}</p>}
    {state?.result?.coverage.map(source => <p key={source.kind}>{labels[source.kind]}：{source.count} 条 · {source.status} {source.note}{source.details && <span> · 正文 {source.details.textCount} · 媒体事件 {source.details.mediaCount} · 未纳入 {source.details.skippedCount}</span>}</p>)}
    {tab === 'summary' ? <div role="tabpanel" aria-label="日总结" style={{ whiteSpace: 'pre-wrap' }}>{section?.items[0]?.content}</div> : <div role="tabpanel" aria-label="时间轴">
      {events.map(event => <button type="button" key={event.eventId} onClick={() => setSelected(event)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 16, margin: '8px 0', textAlign: 'left' }}>
        <time>{event.startAt}</time><strong style={{ flex: 1 }}>{event.title}</strong><span style={{ borderRadius: 12, padding: '4px 8px', background: 'rgba(128,128,128,.15)' }}>{event.scene || '未知场景'}</span><span aria-hidden="true">›</span>
      </button>)}
    </div>}
    {selected && <EventDetail event={selected} close={() => setSelected(undefined)} />}
  </section>
}
function EventDetail({ event, close }: { event: ArkmeRecordingTimelineEvent; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} aria-label="时间段详情" onCancel={close} style={{ maxWidth: 650, width: '80%', maxHeight: '80vh', padding: 24 }}>
    <button type="button" onClick={close} style={{ float: 'right' }}>关闭</button>
    <h3>{event.title}</h3><p>{event.timeRange} · {event.scene}</p>
    <h4>时段总结</h4><p style={{ whiteSpace: 'pre-wrap' }}>{event.description}</p>
    <h4>参与者</h4><p>{event.participants.join('、') || '未知'}</p>
    <h4>我的心情</h4><p>{event.emotion || '无法判断'}</p>
    <h4>待办</h4><p style={{ whiteSpace: 'pre-wrap' }}>{event.todo || '无'}</p>
    <h4>代表性原话</h4>{event.dialoguePoints?.length ? event.dialoguePoints.map((point, i) => <blockquote key={i}>{point.quote}</blockquote>) : <p>无可用原话</p>}
    <h4>其他信息</h4>{event.otherInfo?.length ? event.otherInfo.map((item, i) => <p key={i}>{item.label}：{item.value}</p>) : <p>无</p>}
  </dialog>
}
export const inject = ['slots']
export function apply(ctx: ClientContext) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'day-review-example', order: 100, label: () => '日回顾示例' }, AccountBoundDigest))
}
