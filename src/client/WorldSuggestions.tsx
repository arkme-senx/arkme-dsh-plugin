import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { WorldSuggestion, WorldSuggestionJob, WorldSuggestionModel, WorldSuggestionPrepared, WorldSuggestionsRequest, WorldSuggestionsResponse, WorldSuggestionsState } from '../world-suggestions-contract.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { worldSubscriptionAccount } from './WorldSubscriptions.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeFileCard, openSessionAttachmentPreview } from './ArkmeRichContent.js'
import { PublishDialog } from './ArkmeWorldSurface.js'
import { arkmeTheme as theme } from './arkme-theme.js'

const button: CSSProperties = { border: `1px solid ${theme.borderSoft}`, borderRadius: 8, padding: '7px 11px', background: theme.base, color: theme.text, font: 'inherit', fontSize: 13, cursor: 'pointer' }
const muted: CSSProperties = { color: theme.secondary, fontSize: 12, lineHeight: 1.7 }
const message = (e: unknown) => e instanceof Error ? e.message : '分享建议暂时不可用，请重试'
const active = (j?: WorldSuggestionJob) => j?.status === 'queued' || j?.status === 'running'
function call<R extends WorldSuggestionsRequest>(input: R, signal?: AbortSignal) { return callArkme<WorldSuggestionsResponse<R>>('world.suggestions', input, signal) }
type Create = Extract<WorldSuggestionsRequest, { action: 'create' }>
const pendingKey = (account: string) => `arkme.world-suggestions.pending.v1:${account}`
function saved(account: string): Create | undefined {
  try { const v = JSON.parse(localStorage.getItem(pendingKey(account)) ?? 'null') as Create; return v?.accountKey === account && v.action === 'create' && v.confirmed === true && [7, 30, 90, 365].includes(v.days) && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && (!v.modelRoute || typeof v.modelRoute === 'string' && v.modelRoute.length <= 256) ? v : undefined } catch { return undefined }
}

export function WorldSuggestionsEntry() {
  const account = useSyncExternalStore(arkmeAuthStore.subscribe, worldSubscriptionAccount, () => '')
  return account ? <ScopedEntry key={account} account={account} /> : null
}
function ScopedEntry({ account }: { account: string }) {
  const [open, setOpen] = useState(false), [count, setCount] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    void call({ accountKey: account, action: 'capabilities' }, c.signal).then(async v => {
      if (!v.supported) return
      const state = await call({ accountKey: account, action: 'state' }, c.signal)
      if (!c.signal.aborted && account === worldSubscriptionAccount()) setCount(state.candidateCount)
    }).catch(() => { /* The panel owns actionable capability/read errors. */ })
    return () => c.abort()
  }, [account])
  return <><button type="button" style={{ ...button, whiteSpace: 'nowrap' }} onClick={() => setOpen(true)}>✨ 分享建议{count > 0 ? ` ${count}` : ''}</button>{open && createPortal(<SuggestionsPanel account={account} onCount={setCount} onClose={() => setOpen(false)} />, document.body)}</>
}
function SuggestionsPanel({ account, onClose, onCount }: { account: string; onClose(): void; onCount(n: number): void }) {
  const initial = useRef(saved(account)), [pending, setPending] = useState<Create | undefined>(initial.current)
  const [days, setDays] = useState<Create['days']>(initial.current?.days ?? 30), [model, setModel] = useState(initial.current?.modelRoute ?? '')
  const [models, setModels] = useState<WorldSuggestionModel[]>([]), [supported, setSupported] = useState<boolean>(), [state, setState] = useState<WorldSuggestionsState>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const [original, setOriginal] = useState<WorldSuggestionPrepared>(), [publish, setPublish] = useState<{ prepared: WorldSuggestionPrepared; suggestion: WorldSuggestion }>()
  const mutation = useRef<AbortController>(), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort() } }, [])
  const current = () => mounted.current && account === worldSubscriptionAccount()
  const clearPending = () => { localStorage.removeItem(pendingKey(account)); setPending(undefined) }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, failures = 0, reading = false, started = Date.now(), capability: boolean | undefined
    const load = async () => {
      if (reading || controller.signal.aborted || !current() || document.visibilityState === 'hidden') return
      reading = true; setLoading(true)
      try {
        if (capability === undefined) {
          capability = (await call({ accountKey: account, action: 'capabilities' }, controller.signal)).supported
          if (!current() || controller.signal.aborted) return
          setSupported(capability)
          if (capability) {
            const result = await call({ accountKey: account, action: 'models' }, controller.signal)
            if (!current() || controller.signal.aborted) return
            setModels(result.items)
          }
        }
        if (!capability) return
        const result = await call({ accountKey: account, action: 'state', includeItems: true }, controller.signal)
        if (!current() || controller.signal.aborted) return
        setState(result); onCount(result.candidateCount); setError(''); failures = 0
        const receipt = saved(account)
        if (receipt && result.job?.requestId === receipt.requestId) clearPending()
        if (active(result.job) && Date.now() - started < 20 * 60_000) timer = setTimeout(() => void load(), 4000)
      } catch (e) {
        if (!controller.signal.aborted && current()) { setError(message(e)); if (capability && ++failures < 6) timer = setTimeout(() => void load(), Math.min(15_000, failures * 4000)) }
      } finally { reading = false; if (!controller.signal.aborted && current()) setLoading(false) }
    }
    const visible = () => { if (timer) clearTimeout(timer); if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible); void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [account, revision])
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (mutation.current || !current()) return
    const c = new AbortController(); mutation.current = c; setBusy(true); setError('')
    try { await work(c.signal) } catch (e) { if (!c.signal.aborted && current()) setError(message(e)) }
    finally { if (mutation.current === c) { mutation.current = undefined; if (!c.signal.aborted && current()) setBusy(false) } }
  }
  const start = () => run(async signal => {
    const request = pending ?? { accountKey: account, action: 'create' as const, confirmed: true as const, requestId: crypto.randomUUID(), days, ...(model ? { modelRoute: model } : {}) }
    // Persist intent before transport. A lost acknowledgement can only retry this exact request.
    localStorage.setItem(pendingKey(account), JSON.stringify(request)); setPending(request)
    try { await call(request, signal) }
    catch (e) { if (e instanceof ArkmeClientError && e.body.code === 'world-suggestion-not-accepted' && current()) clearPending(); throw e }
    if (!signal.aborted && current()) { clearPending(); setRevision(v => v + 1) }
  })
  const prepare = (suggestion: WorldSuggestion, sharing: boolean) => run(async signal => {
    const prepared = await call({ accountKey: account, action: 'prepare', ref: suggestion.ref }, signal)
    if (!signal.aborted && current()) sharing ? setPublish({ prepared, suggestion }) : setOriginal(prepared)
  })
  const hide = (suggestion: WorldSuggestion) => run(async signal => {
    await call({ accountKey: account, action: 'hide', confirmed: true, ref: suggestion.ref }, signal)
    if (!signal.aborted && current()) setRevision(v => v + 1)
  })
  const completed = () => {
    const published = publish; setPublish(undefined)
    if (published) void run(async signal => {
      try { await call({ accountKey: account, action: 'hide', confirmed: true, ref: published.suggestion.ref }, signal) }
      finally { if (!signal.aborted && current()) setRevision(v => v + 1) }
    })
  }
  if (!current()) return null
  return <ArkmeDetailShell title={original ? '查看原文' : '分享建议'} label="分享建议" onClose={onClose} {...(original ? { onBack: () => setOriginal(undefined), backLabel: '返回分享建议' } : {})} widthPreferenceKey="arkme.world-suggestions.width" style={{ position: 'fixed', top: 0, zIndex: 25 }}>
    {original ? <><h3 style={{ fontSize: 16 }}>{original.draft.title}</h3><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}><ArkmeRichText text={original.draft.textContent} /></div>{original.draft.attachments.map((attachment, index) => attachment.block ? <ArkmeFileCard key={index} block={attachment.block} onOpen={block => openSessionAttachmentPreview(original.draft.attachments.flatMap(v => v.block ? [v.block] : []), block, 'world-suggestion-original')} /> : <p key={index} style={muted}>{attachment.asset?.fileName ?? '附件'}{attachment.unavailable ? ' · 暂不可用' : ''}</p>)}<p style={muted}>原文只读。公开前仍会核对最新版本，并由你选择发布身份。</p></> : <>
      <p style={{ ...muted, marginTop: 0 }}>从本人快记中发现值得分享的表达，并解释推荐理由。建议仅自己可见，公开与否由你决定。</p>
      {supported === false ? <p role="status" style={muted}>分享建议服务尚未就绪，请稍后重试。</p> : <fieldset disabled={busy || active(state?.job) || !!pending || supported !== true} style={{ border: 0, padding: 0, margin: '16px 0', display: 'grid', gap: 10 }}>
        <label style={muted}>分析范围 <select aria-label="分析范围" value={days} onChange={e => setDays(Number(e.target.value) as Create['days'])} style={button}>{[7, 30, 90, 365].map(n => <option key={n} value={n}>最近 {n} 天</option>)}</select></label>
        <label style={muted}>分析模型 <select aria-label="分析模型" value={model} onChange={e => setModel(e.target.value)} style={{ ...button, maxWidth: '100%' }}><option value="">跟随当前模型设置</option>{models.map(m => <option key={m.route} value={m.route}>{m.name}{m.source === 'account' ? ' · 我的模型' : ''}</option>)}</select></label>
      </fieldset>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {supported === true && !active(state?.job) && <button type="button" style={{ ...button, color: theme.accent }} disabled={busy || loading} onClick={() => void start()}>{pending ? '核对上次提交' : state?.job ? '重新分析' : '开始分析'}</button>}
        <button type="button" style={button} disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>{loading ? '读取中…' : '刷新'}</button>
        {active(state?.job) && <button type="button" style={button} disabled={busy} onClick={() => void run(async signal => { await call({ accountKey: account, action: 'cancel', jobRef: state!.job!.ref, confirmed: true }, signal); if (current()) setRevision(v => v + 1) })}>停止分析</button>}
      </div>
      {supported === true && <p style={muted}>点击分析会使用所选模型的额度。最多筛选 500 条快记；不会自动发布。</p>}
      {pending && <p role="status" style={muted}>上次提交结果待核对。再次点击会核对同一请求，不会另建一轮分析。</p>}
      {state?.job && <p role="status" style={muted}>{active(state.job) ? `${state.job.phase === 'collecting' ? '正在读取快记' : state.job.phase === 'reconciling' ? '正在恢复本次分析' : '正在分析'} · 已检查 ${state.job.scanned} 条，已分析 ${state.job.processed} 条` : state.job.status === 'succeeded' ? `分析完成 · ${state.candidateCount} 条建议` : state.job.status === 'cancelled' ? '本次分析已停止，上一份有效建议仍保留。' : '本次分析未完成，上一份有效建议仍保留。'}{state.job.failure && <span>（{failureText(state.job.failure)}）</span>}</p>}
      {error && <p role="alert" style={{ ...muted, color: theme.accent }}>{error}</p>}
      {!!state?.unavailableCount && <p style={muted}>有 {state.unavailableCount} 条建议的原文已变化、不可访问或已公开，本次已隐藏。</p>}
      {state && state.items.length === 0 && !active(state.job) && <p style={{ ...muted, padding: '20px 0' }}>{state.job?.status === 'succeeded' ? '这次暂无适合公开分享的快记。可以调整范围后再分析。' : '点击开始分析，发现你的快记中值得分享的内容。'}</p>}
      {state?.items.map(item => <article key={item.key} style={{ border: `1px solid ${theme.borderSoft}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
        <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.8, color: theme.accent, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>✦ {item.reason}</p>
        {item.title && <h3 style={{ fontSize: 14, margin: '0 0 8px', overflowWrap: 'anywhere' }}>{item.title}</h3>}
        <p style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{item.preview}</p>
        <p style={muted}>{new Date(item.occurredAtMillis).toLocaleDateString()}</p>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}><button style={button} type="button" disabled={busy} onClick={() => void prepare(item, false)}>查看原文</button><button style={button} type="button" disabled={busy} onClick={() => void hide(item)}>暂不分享</button><button style={{ ...button, color: theme.accent }} type="button" disabled={busy} onClick={() => void prepare(item, true)}>发到世界</button></div>
      </article>)}
    </>}
    {publish && <PublishDialog origin={publish.prepared.origin} onClose={() => setPublish(undefined)} onPublished={completed} />}
  </ArkmeDetailShell>
}
function failureText(code: string) {
  return ({ source_changed: '部分原文已变化，请重新分析', scope_too_large: '快记较多，请缩小时间范围', output_invalid: '模型结果未通过校验', insufficient_balance: '模型额度不足', execution_unavailable: '服务暂时不可用', balance_reserved: '额度正在核对，稍后会自动继续', model_outcome_uncertain: '正在核对原调用结果，请勿重复发起分析', model_connector_offline: '本机模型暂时离线，恢复后会继续核对', model_unavailable: '模型暂时不可用，稍后会自动核对' } as Record<string, string>)[code] ?? '请刷新任务状态后重试'
}
