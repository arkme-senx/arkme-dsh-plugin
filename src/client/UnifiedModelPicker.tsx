import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatAiPoints, pointsUnits } from '../ai-points.js'
import { mergeModelChoices, type ModelChoice, type ModelScene } from '../model-directory.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { ArkmePointsConsumption } from './ArkmePointsConsumption.js'
import { useUnifiedModels } from './use-unified-models.js'
import { tr, useArkmeLocale } from './locale.js'
import css from './unified-model-picker.css?inline'
import usageCss from './account-usage.css?inline'

export function ModelBalanceShortcut() {
  const data = useUnifiedModels()
  const [usage, setUsage] = useState(false)
  if (!data.scope) return null
  return <ArkmeBillingSettings key={data.scope} active={false} modal onCreditsChanged={() => { void data.refresh() }} renderTrigger={({ onOpen }) => <>
    <style>{css}</style>
    <span className="arkme-model-balance-shortcut">
      <button type="button" title={tr('积分与用量明细')} onClick={() => setUsage(true)}>{data.account ? `Arkme ${formatAiPoints(data.account.availablePoints)} ${tr('积分')}` : tr(data.accountError ? '积分读取失败' : '积分加载中…')}</button>
      <button type="button" onClick={onOpen}>{tr('充值')}</button>
    </span>
    {usage && <UnifiedModelPicker scene="arko" scopeLabel="积分与用量" models={[]} currentId="" initialView="usage" onApply={async () => false} onClose={() => setUsage(false)} />}
  </>} />
}

export function UnifiedModelPicker({ scene, scopeLabel, models: localModels, currentId, currentEffort, anchor, busy = false, error = '', confirmLabel = '使用此模型', initialView = 'models', onApply, onClose, onRefresh, ariaLabel }: {
  scene: ModelScene; scopeLabel: string; models: readonly ModelChoice[]; currentId: string; currentEffort?: string | undefined
  anchor?: HTMLButtonElement | undefined; busy?: boolean; error?: string; confirmLabel?: string; initialView?: 'models' | 'usage'
  onApply(model: ModelChoice, effort?: string): Promise<boolean>
  onRefresh?: (() => Promise<void>) | undefined
  ariaLabel?: string | undefined
  onClose(): void
}) {
  useArkmeLocale()
  const data = useUnifiedModels(), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), title = useId()
  const [view, setView] = useState(initialView), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState(currentId)
  const [effort, setEffort] = useState(currentEffort ?? ''), [notice, setNotice] = useState(''), [applying, setApplying] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: anchor ? 'hidden' : 'visible' })
  const choices = mergeModelChoices(data.catalog?.models ?? [], localModels)
  const selected = choices.find(model => model.id === selectedId)
  const supported = selected?.[scene] !== undefined
  const filtered = choices.filter(model => `${model.name} ${model.channel} ${model.identifier}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useEffect(() => { void data.refresh() }, [])
  useEffect(() => { setSelectedId(currentId); setEffort(currentEffort ?? '') }, [currentId, currentEffort])
  useLayoutEffect(() => { panel.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selectedId, data.catalog?.observedAt])
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const place = () => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect(), width = Math.min(420, window.innerWidth - 24)
      const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16, upwards = above >= below
      setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }), maxHeight: Math.max(120, Math.min(600, upwards ? above : below)) })
    }
    place(); search.current?.focus()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); (anchor ?? previous)?.focus({ preventScroll: true }) }
  }, [anchor])
  const apply = async () => {
    if (!selected || busy || applying) return
    if (!supported) { setNotice('此模型在当前场景的执行路由尚未接通，请选择已支持的模型。'); return }
    setApplying(true); setNotice('')
    try { if (await onApply(selected, effort || undefined)) onClose() }
    catch (error) { setNotice(error instanceof Error ? error.message : '模型切换失败，请重试') }
    finally { setApplying(false) }
  }
  const body = <ArkmeBillingSettings key={data.scope ?? 'guest'} active={false} modal onCreditsChanged={() => { void data.refresh() }} renderTrigger={({ onOpen }) =>
    <div className={`arkme-unified-model-backdrop${anchor ? ' is-anchored' : ''}`} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panel} className="arkme-unified-model-panel" style={position} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : title}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
          if (event.target instanceof Element && event.target.closest('[role="listbox"]') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            const options = [...(panel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])], index = options.indexOf(document.activeElement as HTMLElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            event.preventDefault(); options[next]?.focus()
          }
          if (event.key === 'Tab') {
            const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary') ?? [])]
            const first = controls[0], last = controls.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <header className="arkme-unified-model-header"><strong id={title}>{tr(view === 'usage' ? '积分与用量明细' : '选择模型')}</strong><button type="button" aria-label={tr('关闭模型面板')} onClick={onClose}>×</button></header>
        <div className="arkme-unified-model-account">
          <div><span>{tr('Arkme 可用积分')}</span><strong>{data.account ? formatAiPoints(data.account.availablePoints) : tr(data.accountError ? '读取失败' : data.scope ? '加载中…' : '登录后查看')}</strong>
            {data.account && <small>{tr('已预占')} {formatAiPoints(data.account.reservedPoints)} {tr('积分')}</small>}</div>
          <div><button type="button" disabled={!data.scope} onClick={onOpen}>{tr('充值')}</button><button type="button" disabled={!data.scope} onClick={() => setView(view === 'usage' ? 'models' : 'usage')}>{tr(view === 'usage' ? '返回模型' : '用量明细')}</button></div>
        </div>
        {view === 'usage' ? <div className="arkme-unified-model-list">{data.scope && <ArkmePointsConsumption scope={data.scope} revision={data.catalog?.observedAt ?? 0}/>}</div> : <>
          <div className="arkme-unified-model-search"><input ref={search} aria-label={tr('搜索模型、渠道或版本')} placeholder={tr('搜索模型、渠道或版本')} value={query} onChange={event => setQuery(event.target.value)} />
            <button type="button" disabled={data.loading} onClick={() => { void Promise.all([data.refresh(), onRefresh?.()]).catch(error => setNotice(error instanceof Error ? error.message : '刷新失败')) }}>{tr(data.loading ? '刷新中…' : '刷新')}</button></div>
          <div className="arkme-unified-model-list" role="listbox" aria-label={tr('全部已接入模型')}>
            {filtered.map(model => <button key={model.id} type="button" role="option" aria-selected={model.id === selectedId} className="arkme-unified-model-option"
              onClick={() => { setSelectedId(model.id); setEffort(model.id === currentId ? currentEffort ?? '' : model.reasoning?.defaultEffort ?? ''); setNotice('') }}>
              <span><strong>{model.name}</strong><small>{model.channel}{model.images ? ` · ${tr('支持图片')}` : ''}<span className={model[scene] ? 'is-supported' : ''}>{tr(model[scene] ? '当前场景可用' : '支持待确认')}</span></small></span><span aria-hidden>{model.id === selectedId ? '✓' : ''}</span>
            </button>)}
            {!filtered.length && <p role="status">{tr(data.loading ? '正在读取模型目录…' : query ? '未找到匹配模型' : '模型目录暂不可用，请刷新')}</p>}
          </div>
          <footer className="arkme-unified-model-footer">
            {selected && <><strong>{selected.name}</strong><small>{tr('渠道')}：{selected.channel} · {tr('具体版本')}：{selected.version ?? tr('目录尚未提供')}</small>
              <small>{tr('计费账户')}：{selected.billing === 'arkme-points' ? tr('Arkme 积分') : selected.billing === 'provider-account' ? `${selected.channel} · ${tr('按该渠道账户结算')}` : tr('待服务端确认')}</small>
              <p>{selected.pricing || tr('该模型的积分报价尚未提供，费用待确认。')}</p>
              <details><summary>{tr('模型详情')}</summary><p>{selected.identifier}</p>
                {selected.catalogRevision && <p>{tr('目录版本')}：{selected.catalogRevision}</p>}
                {selected.offeringRevision && <p>{tr('模型配置版本')}：{selected.offeringRevision}</p>}
                {selected.supplierCode && <p>{tr('供应渠道标识')}：{selected.supplierCode}</p>}
                <p>{tr('计费账户与场景能力以服务端返回为准。')}</p></details>
              {selected.reasoning && <label>{tr('思考强度')} <select aria-label={tr('思考强度')} value={effort} onChange={event => setEffort(event.target.value)}><option value="">{tr('默认')}</option>{selected.reasoning.efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
              {!supported && <p className="arkme-unified-model-notice">{tr('当前场景尚未提供此模型的执行路由。')}</p>}
              {data.account && pointsUnits(data.account.availablePoints) === 0n && <p className="arkme-unified-model-notice">{tr('可用积分为 0，可在上方充值后继续。')}</p>}</>}
            <small>{tr('生效范围')}：{tr(scopeLabel)}</small>
            <small>{tr('任务费用尚无预估结果；是否可启动以服务端校验为准。')}</small>
            {(notice || error) && <p role="alert">{notice || error}</p>}
            <div className="arkme-unified-model-apply"><span>{data.catalog ? `${tr('目录更新')} ${new Date(data.catalog.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span><button type="button" onClick={onClose}>{tr('取消')}</button><button type="button" disabled={!selected || busy || applying} onClick={() => { void apply() }}>{tr(applying || busy ? '正在应用…' : confirmLabel)}</button></div>
          </footer>
        </>}
        {(data.catalogError || data.accountError || data.catalog?.failures.length) ? <div className="arkme-unified-model-errors" role="status">
          {[data.catalogError, data.accountError, ...(data.catalog?.failures.map(failure => `${failure.source}：${failure.message}`) ?? [])].filter(Boolean).join('；')}
        </div> : null}
      </section>
    </div>} />
  return <><style>{css}{usageCss}</style>{typeof document === 'undefined' ? body : createPortal(body, document.body)}</>
}
