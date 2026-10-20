import { useCallback, useEffect, useRef, useState } from 'react'
import { blankReviewPrompts, parseReviewPromptDraft, parseReviewPromptConfig, promptConfigOnly, REVIEW_PROMPT_FIELDS, REVIEW_PROMPT_KINDS, REVIEW_PROMPT_LIMIT, reviewPromptStorageKey,
  sameReviewPrompts, type ReviewPromptConfig, type ReviewPromptDraft, type ReviewPromptKind, type ReviewPromptSnapshot, type ReviewPromptSupport } from '../calendar-day-review-prompts.js'
import type { DayReviewQuery } from '../calendar-day-review.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

const labels = { summary: '日总结', timeline: '时间轴' }
const fieldLabels = { instruction: '主要提示词', chunk: '分段整理指令', aggregate: '最终汇总指令' }
function readDraft(scope: string): { draft: ReviewPromptDraft; error: string } {
  if (!scope || typeof window === 'undefined') return { draft: {}, error: '' }
  try {
    const raw = window.localStorage.getItem(reviewPromptStorageKey(scope))
    return { draft: raw ? parseReviewPromptDraft(JSON.parse(raw)) : {}, error: '' }
  } catch { return { draft: {}, error: '本机提示词草稿无法读取，请检查浏览器存储后重试' } }
}
/** Drafts contain configuration only; account-scoped and separate from date-scoped generation requests. */
export function useDayReviewPrompts(query: DayReviewQuery) {
  const [initial] = useState(() => readDraft(query.accountScope))
  const [draft, setDraft] = useState(initial.draft), [storageError, setStorageError] = useState(initial.error)
  const [open, setOpen] = useState(false), [support, setSupport] = useState<ReviewPromptSupport>(), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>(), current = useRef(draft)
  const persist = useCallback((next: ReviewPromptDraft) => {
    current.current = next; setDraft(next)
    try {
      if (!query.accountScope || typeof window === 'undefined') throw new Error('storage unavailable')
      window.localStorage.setItem(reviewPromptStorageKey(query.accountScope), JSON.stringify({ schemaVersion: 1, ...next }))
      setStorageError('')
    } catch { setStorageError('配置仅保留在当前页面，浏览器存储不可用，关闭页面可能丢失') }
  }, [query.accountScope])
  const read = useCallback(async () => {
    if (!query.accountScope) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<ReviewPromptSupport>('calendar.day-review.prompts', { ...query }, signal), controller.signal)
      if (controller.signal.aborted) return
      setSupport(value)
      const local = current.current.editing ?? current.current.saved
      // Offline drafts have no known server defaults. Fill only untouched fields when defaults arrive.
      if (local && !local.baseVersion && value.defaults) {
        const editing = promptConfigOnly(local); editing.baseVersion = value.defaults.baseVersion
        for (const kind of REVIEW_PROMPT_KINDS) for (const field of REVIEW_PROMPT_FIELDS) {
          if (!editing[kind][field].trim()) editing[kind][field] = value.defaults[kind][field]
        }
        persist({ ...current.current, editing })
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '提示词暂时无法读取') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [query, persist])
  useEffect(() => {
    if (initial.draft.saved || initial.draft.editing) void read()
    return () => request.current?.abort()
  }, [read, initial])
  const toggle = () => { setOpen(v => !v); if (!open && !loading) void read() }
  const effective = draft.editing ?? draft.saved ?? support?.defaults ?? blankReviewPrompts()
  let block = ''
  if (draft.editing) block = '提示词尚未保存，请先保存配置或恢复默认'
  else if (draft.saved) {
    if (!support?.supported || !support.defaults || error) block = '自定义提示词仅保存为草稿，服务接通并核对后才能用于生成'
    else if (draft.saved.baseVersion !== support.defaults.baseVersion) block = '系统提示词已更新，请先核对并采用当前规则'
    else { try { parseReviewPromptConfig(draft.saved) } catch { block = '提示词未填写完整，请展开提示词补齐' } }
  }
  const save = () => {
    setError('')
    try {
      const config = parseReviewPromptConfig(effective, !support?.supported)
      persist(sameReviewPrompts(config, support?.defaults) ? {} : { saved: config })
    } catch (e) { setError(e instanceof Error ? e.message : '提示词未填写完整') }
  }
  return { open, toggle, support, loading, error, storageError, draft, effective, block, read, save,
    reset: () => { setError(''); persist({}) },
    edit: (kind: ReviewPromptKind, field: typeof REVIEW_PROMPT_FIELDS[number], text: string) => {
      const editing = promptConfigOnly(effective); editing[kind][field] = text
      persist({ ...current.current, editing })
    },
    adopt: () => {
      if (support?.defaults) persist({ ...current.current, editing: { ...promptConfigOnly(effective), baseVersion: support.defaults.baseVersion } })
    },
  }
}
export type DayReviewPromptsController = ReturnType<typeof useDayReviewPrompts>
function PromptPreview({ config, constraints, kind }: { config: ReviewPromptConfig; constraints: string; kind: ReviewPromptKind }) {
  return <div className="day-review-prompt-preview">
    <p>{tr('来源、人物、发生时间及引用格式等共用约束')}</p><pre>{constraints}</pre>
    <p>{tr('单段生成：共用约束 + 主要提示词')}</p><pre>{config[kind].instruction}</pre>
    <p>{tr('分段整理：共用约束 + 主要提示词 + 分段整理指令')}</p><pre>{config[kind].chunk}</pre>
    <p>{tr('最终汇总：共用约束 + 主要提示词 + 最终汇总指令')}</p><pre>{config[kind].aggregate}</pre>
  </div>
}
export function CalendarDayReviewPromptEditor({ controller: p, view, locked }: { controller: DayReviewPromptsController; view: ReviewPromptKind; locked: boolean }) {
  const [kind, setKind] = useState<ReviewPromptKind>(view)
  if (!p.open) return null
  const defaults = p.support?.defaults
  return <section className="day-review-prompt-editor" aria-label={tr('提示词设置')}>
    <div className="day-review-prompt-heading"><strong>{tr('提示词设置')}</strong><span>{tr(p.draft.editing ? '未保存' : p.draft.saved ? (p.support?.supported ? '自定义' : '本机草稿') : (p.support?.defaults ? '系统默认' : '默认待获取'))}</span>
      <button type="button" className="arkme-day-source" onClick={p.toggle}>{tr('收起')}</button></div>
    <nav aria-label={tr('提示词类型')}>{REVIEW_PROMPT_KINDS.map(key => <button type="button" key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>{tr(labels[key])}</button>)}</nav>
    {p.loading && <p role="status">{tr('正在读取系统提示词…')}</p>}
    {p.error && <p role="alert" className="day-review-error">{p.error} <button type="button" className="arkme-day-source" disabled={p.loading || locked} onClick={() => void p.read()}>{tr('重新读取')}</button></p>}
    {!p.loading && !p.support?.supported && <p className="day-review-hint">{tr('尚未取得系统默认提示词。可以先填写本机草稿，尚未用于生成。')}</p>}
    {defaults && <p className="day-review-hint">{tr('系统版本')} {defaults.baseVersion} · {tr('按当前账号保存在此浏览器，切换日期继续使用')}</p>}
    {defaults && p.effective.baseVersion !== defaults.baseVersion && <p role="status">{tr('系统提示词已更新，当前内容基于')} {p.effective.baseVersion || tr('未确认版本')}
      <button type="button" className="arkme-day-source" disabled={locked} onClick={p.adopt}>{tr('保留内容并采用当前规则')}</button></p>}
    <fieldset disabled={locked || (!p.support && p.loading)}>
      <label>{tr(`${labels[kind]}主要提示词`)}<textarea aria-label={tr(`${labels[kind]}主要提示词`)} rows={7} maxLength={REVIEW_PROMPT_LIMIT}
        placeholder={tr('填写希望关注的内容、归纳方式和表达要求…')} value={p.effective[kind].instruction} onChange={event => p.edit(kind, 'instruction', event.target.value)} /></label>
      <details><summary>{tr('高级：分段整理与最终汇总指令')}</summary>
        <p className="day-review-hint">{tr('主要提示词贯穿所有阶段。这里补充各阶段要求，不填写当天资料。')}</p>
        {(['chunk', 'aggregate'] as const).map(field => <label key={field}>{tr(fieldLabels[field])}<textarea rows={4} maxLength={REVIEW_PROMPT_LIMIT}
          aria-label={tr(`${labels[kind]}${fieldLabels[field]}`)} value={p.effective[kind][field]} onChange={event => p.edit(kind, field, event.target.value)}
          placeholder={defaults ? '' : tr('后端接通后显示真实默认指令')} /></label>)}
      </details>
    </fieldset>
    {defaults && <details><summary>{tr('查看完整生成指令（不含当天资料）')}</summary><PromptPreview config={p.effective} constraints={defaults.constraints} kind={kind} /></details>}
    {p.storageError && <p role="alert" className="day-review-error">{p.storageError}</p>}
    <div className="day-review-prompt-footer"><button type="button" className="arkme-day-source" title={tr('恢复日总结和时间轴的系统默认提示词')} disabled={locked || (!p.draft.saved && !p.draft.editing)} onClick={p.reset}>{tr('恢复默认')}</button>
      <span>{tr('保存后重新生成才会生效')}</span><button type="button" className="day-review-generate" disabled={locked || !p.draft.editing} onClick={p.save}>{tr(p.support?.supported ? '保存配置' : '保存草稿')}</button></div>
  </section>
}
export function DayReviewPromptSnapshot({ snapshot, view }: { snapshot: ReviewPromptSnapshot; view: ReviewPromptKind }) {
  return <details className="day-review-prompt-snapshot"><summary>{tr('查看本次提示词')} · {snapshot.baseVersion}</summary>
    <PromptPreview config={snapshot} constraints={snapshot.constraints} kind={view} /></details>
}
