import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { formatAiPoints, pointsUnits } from '../ai-points.js'
import { mergeModelChoices, type ModelChoice, type ModelScene } from '../model-directory.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { ArkmePointsConsumption } from './ArkmePointsConsumption.js'
import { ThinkingEffortSlider } from './ThinkingEffortSlider.js'
import { useUnifiedModels } from './use-unified-models.js'
import { tr, useArkmeLocale } from './locale.js'
import css from './unified-model-picker.css?inline'
import usageCss from './account-usage.css?inline'

export function UnifiedModelPicker({ scene, scopeLabel, models: localModels, currentId, currentEffort, anchor, busy = false, error = '', confirmLabel = '确认并生成', initialView = 'models', onApply, onClose, onRefresh, ariaLabel }: {
  scene: ModelScene; scopeLabel: string; models: readonly ModelChoice[]; currentId: string; currentEffort?: string | undefined
  anchor?: HTMLButtonElement | undefined; busy?: boolean; error?: string; confirmLabel?: string; initialView?: 'models' | 'usage'
  onApply(model: ModelChoice, effort?: string): Promise<boolean>
  onRefresh?: (() => Promise<void>) | undefined
  ariaLabel?: string | undefined
  onClose(): void
}) {
  useArkmeLocale()
  const data = useUnifiedModels(), panel = useRef<HTMLElement>(null), title = useId()
  const [view, setView] = useState<'models' | 'usage' | 'pricing'>(initialView)
  const [selectedId, setSelectedId] = useState(currentId), [effort, setEffort] = useState(currentEffort ?? '')
  const [notice, setNotice] = useState(''), [applying, setApplying] = useState(false)
  const applyingRef = useRef(false), mounted = useRef(true), latestScope = useRef(data.scope)
  latestScope.current = data.scope
  const [position, setPosition] = useState<CSSProperties>({ visibility: anchor ? 'hidden' : 'visible' })
  const choices = mergeModelChoices(data.catalog?.models ?? [], localModels)
  const selected = choices.find(model => model.id === selectedId)
  const requiresConfirmation = scene === 'recording'
  const checkedId = requiresConfirmation ? selectedId : currentId
  const groups = [...choices.reduce((groups, model) => {
    const group = groups.get(model.channel) ?? []
    group.push(model); groups.set(model.channel, group); return groups
  }, new Map<string, ModelChoice[]>())].sort((a, b) => {
    const rank = (models: ModelChoice[]) => models.some(model => model.billing === 'arkme-points') ? 0 : models.some(model => model.billing === 'provider-account') ? 1 : 2
    return rank(a[1]) - rank(b[1])
  })
  const hasReadError = !!(data.catalogError || data.accountError || data.catalog?.failures.length)
  const restoreSelection = () => { setSelectedId(currentId); setEffort(currentEffort ?? '') }
  useEffect(() => { mounted.current = true; void data.refresh(); return () => { mounted.current = false } }, [])
  useEffect(() => { restoreSelection() }, [currentId, currentEffort])
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const place = () => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect(), width = Math.min(400, window.innerWidth - 24)
      const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16, upwards = above >= below
      setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }), maxHeight: Math.max(120, Math.min(560, upwards ? above : below)) })
    }
    place()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); (anchor ?? previous)?.focus({ preventScroll: true }) }
  }, [anchor])
  useLayoutEffect(() => {
    const option = view === 'models' ? panel.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? panel.current?.querySelector<HTMLElement>('[role="option"]') : undefined
    option?.scrollIntoView?.({ block: 'nearest' })
    ;(option ?? panel.current)?.focus({ preventScroll: true })
  }, [view])
  const apply = async (model: ModelChoice, nextEffort?: string, closeOnSuccess = true) => {
    if (busy || applyingRef.current) return
    if (!model[scene]) { setNotice('此模型在当前场景的支持情况待确认'); return }
    const scope = data.scope
    applyingRef.current = true; setApplying(true); setNotice('')
    try {
      const accepted = await onApply(model, nextEffort || undefined)
      if (!mounted.current || latestScope.current !== scope) return
      if (accepted) { if (closeOnSuccess) onClose() }
      else {
        restoreSelection()
        if (!closeOnSuccess) setNotice('思考强度保存失败，请重试')
      }
    } catch (error) {
      if (mounted.current && latestScope.current === scope) {
        restoreSelection(); setNotice(error instanceof Error ? error.message : '模型切换失败，请重试')
      }
    } finally {
      applyingRef.current = false
      if (mounted.current) setApplying(false)
      if (!closeOnSuccess) window.requestAnimationFrame?.(() => {
        if (mounted.current && latestScope.current === scope && document.activeElement === document.body)
          panel.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true })
      })
    }
  }
  const choose = (model: ModelChoice) => {
    if (busy || applyingRef.current) return
    const nextEffort = model.id === currentId ? currentEffort ?? '' : model.reasoning?.defaultEffort ?? ''
    setSelectedId(model.id); setEffort(nextEffort); setNotice('')
    if (!model[scene]) { setNotice('此模型在当前场景的支持情况待确认'); return }
    if (!requiresConfirmation) {
      if (model.id === currentId) onClose()
      else void apply(model, nextEffort)
    }
  }
  const retry = () => { setNotice(''); void Promise.all([data.refresh(), onRefresh?.()]).catch(() => setNotice('暂时无法更新，请稍后重试')) }
  const balanceText = data.account ? tr('Arkme 积分') + ' ' + formatAiPoints(data.account.availablePoints)
    : tr(data.accountError ? 'Arkme 积分暂不可用' : data.scope ? 'Arkme 积分加载中…' : '登录后查看 Arkme 积分')
  const billingHint = tr(selected?.billing === 'arkme-points' ? '使用 Arkme 积分' : selected?.billing === 'provider-account' ? '外部账户结算' : '计费归属待确认')
  const body = <ArkmeBillingSettings key={data.scope ?? 'guest'} active={false} modal onCreditsChanged={() => { void data.refresh() }} renderTrigger={({ onOpen }) =>
    <div className={'arkme-unified-model-backdrop' + (anchor ? ' is-anchored' : '')} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panel} tabIndex={-1} className="arkme-unified-model-panel" style={position} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : title}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
          if (event.target instanceof Element && event.target.closest('[role="listbox"]') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            const options = [...(panel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])], index = options.indexOf(document.activeElement as HTMLElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            event.preventDefault(); options[next]?.focus()
          }
          if (event.key === 'Tab') {
            const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
            const first = controls[0], last = controls.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <header className="arkme-unified-model-header">
          {view !== 'models' && initialView === 'models' && <button type="button" aria-label={tr('返回模型')} onClick={() => setView('models')}><ArrowLeft size={18}/></button>}
          <strong id={title}>{tr(view === 'usage' ? 'Arkme 积分与用量' : view === 'pricing' ? '计费详情' : '选择模型')}</strong>
          <button type="button" aria-label={tr('关闭模型面板')} onClick={onClose}><X size={18}/></button>
        </header>
        {view === 'models' ? <>
          <div className="arkme-unified-model-list" role="group" aria-label={tr('全部已接入模型')} aria-busy={applying}>
            {groups.map(([channel, models]) => <div key={channel} role="group" aria-label={channel} className="arkme-unified-model-group">
              <div className="arkme-unified-model-group-title">
                <span>{channel}</span>
                {channel === 'Arkme 托管' && <div className="arkme-unified-model-account" role="group" aria-label={tr('Arkme 积分账户')}>
                  <button type="button" className="arkme-unified-model-balance" aria-label={balanceText} title={tr('Arkme 可用积分')} disabled={!data.scope} onClick={() => setView('usage')}>
                    {data.account ? `· ${formatAiPoints(data.account.availablePoints)} ${tr('积分')}` : balanceText}
                  </button>
                  <button type="button" aria-label={tr('充值 Arkme 积分')} title={tr('充值 Arkme 积分')} disabled={!data.scope} onClick={onOpen}>{tr('充值')}</button>
                  <button type="button" aria-label={tr('Arkme 积分用量')} disabled={!data.scope} onClick={() => setView('usage')}>{tr('用量')}</button>
                </div>}
              </div>
              <div role="listbox" aria-label={channel}>
              {models.map(model => <button key={model.id} type="button" role="option" aria-selected={model.id === checkedId} disabled={busy || applying}
                className="arkme-unified-model-option" onClick={() => choose(model)}>
                <span className="arkme-unified-model-name">{model.name}</span>
                {!model[scene] && <small>{tr('支持待确认')}</small>}
                <span className="arkme-unified-model-check" aria-hidden>{model.id === checkedId && <Check size={16} weight="bold"/>}</span>
              </button>)}
              </div>
            </div>)}
            {!choices.length && <p className="arkme-unified-model-empty" role="status">{tr(data.loading ? '正在读取模型…' : '模型暂不可用')}</p>}
          </div>
          <footer className="arkme-unified-model-footer">
            {selected?.reasoning && <ThinkingEffortSlider key={selected.id} reasoning={selected.reasoning} value={effort}
              disabled={busy || applying || !selected[scene]} onPreview={setEffort} onCommit={value => {
                setNotice('')
                if (!requiresConfirmation && value !== (currentEffort ?? '')) void apply(selected, value, false)
              }}/>}
            {selected && <button type="button" className="arkme-unified-model-info" aria-label={tr('计费详情')} onClick={() => setView('pricing')}>
              <span>{billingHint}</span><span className="arkme-unified-model-info-link">{tr('详情')}<CaretRight size={14}/></span>
            </button>}
            {(notice || error) && <p className="arkme-unified-model-notice" role="alert">{notice || error}</p>}
            {hasReadError && <div className="arkme-unified-model-read-error" role="status"><span>{tr(data.catalogError || data.catalog?.failures.length ? '部分模型信息暂不可用' : '积分暂不可用')}</span><button type="button" disabled={data.loading} onClick={retry}>{tr(data.loading ? '重试中…' : '重试')}</button></div>}
            {requiresConfirmation && <button type="button" className="arkme-unified-model-confirm" disabled={!selected?.[scene] || busy || applying}
              onClick={() => { if (selected) void apply(selected, effort) }}>{tr(applying || busy ? '正在提交…' : confirmLabel)}</button>}
          </footer>
        </> : <div className="arkme-unified-model-content">
          {view === 'usage' ? <>
            {data.account && <div className="arkme-unified-model-usage-balance"><span>{balanceText}</span>
              {pointsUnits(data.account.reservedPoints) > 0n && <span>{tr('已预占')} {formatAiPoints(data.account.reservedPoints)} {tr('积分')}</span>}</div>}
            {data.scope && <ArkmePointsConsumption scope={data.scope} revision={data.catalog?.observedAt ?? 0}/>}
          </> : selected && <>
            <h3>{selected.name}</h3><p className="arkme-unified-model-muted">{selected.channel}</p>
            <p className="arkme-unified-model-muted">{tr(selected.billing === 'arkme-points'
              ? '本模型使用 Arkme 积分，充值增加的是 Arkme 积分账户余额。'
              : selected.billing === 'provider-account' ? '本模型由外部账户结算，充值 Arkme 积分不会增加该账户余额。'
                : '当前目录尚未明确本模型的计费账户，不能据 Arkme 积分余额判断是否可用。')}</p>
            <dl><dt>{tr('计费账户')}</dt><dd>{selected.billing === 'arkme-points' ? tr('Arkme 积分') : selected.billing === 'provider-account' ? selected.channel : tr('待确认')}</dd>
              <dt>{tr('具体版本')}</dt><dd>{selected.version ?? tr('待确认')}</dd>
              <dt>{tr('生效范围')}</dt><dd>{tr(scopeLabel)}</dd>
              {selected.images && <><dt>{tr('图片输入')}</dt><dd>{tr('支持')}</dd></>}</dl>
            <p className="arkme-unified-model-price">{selected.pricing || tr(selected.billing === 'provider-account' ? '按该渠道账户结算。' : '该模型的报价待确认。')}</p>
            {selected.billing !== 'provider-account' && <p className="arkme-unified-model-muted">{tr('实际费用按用量结算，是否可启动以服务端校验为准。')}</p>}
          </>}
          {hasReadError && <div className="arkme-unified-model-read-error" role="status"><span>{tr('部分信息暂不可用')}</span><button type="button" disabled={data.loading} onClick={retry}>{tr('重试')}</button></div>}
        </div>}
      </section>
    </div>} />
  return <><style>{css}{usageCss}</style>{typeof document === 'undefined' ? body : createPortal(body, document.body)}</>
}
