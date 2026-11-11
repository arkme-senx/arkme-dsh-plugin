import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { formatAiPoints, pointsUnits } from '../ai-points.js'
import { modelSceneBilling, modelAvailable, sceneReference, type ModelChoice, type ModelScene, type ModelOrigin } from '../model-directory.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { ArkmePointsConsumption } from './ArkmePointsConsumption.js'
import { ThinkingEffortSlider } from './ThinkingEffortSlider.js'
import { useUnifiedModels } from './use-unified-models.js'
import { tr, useArkmeLocale } from './locale.js'
import css from './unified-model-picker.css?inline'
import usageCss from './account-usage.css?inline'

export function UnifiedModelPicker({ scene, scopeLabel, models: localModels, currentId, currentEffort, anchor, busy = false, loading = false, error = '', confirmLabel = '确认并生成', confirmationDescription, initialView = 'models', onApply, onClose, onRefresh, ariaLabel }: {
  scene: ModelScene; scopeLabel: string; models: readonly ModelChoice[]; currentId: string; currentEffort?: string | undefined
  anchor?: HTMLButtonElement | undefined; busy?: boolean; loading?: boolean; error?: string; confirmLabel?: string; initialView?: 'models' | 'usage'
  confirmationDescription?: string | undefined
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
  const positioned = position.visibility !== 'hidden'
  const catalogChoices = data.catalog?.models ?? []
  // Only display metadata can come from the shared catalog. Scene data owns routes, billing and controls.
  const choices = localModels.filter(model => modelAvailable(model, scene)).map(local => {
    const reference = sceneReference(local, scene)
    const catalogModel = catalogChoices.find(model => model.origin === local.origin && model.id === local.id)
      ?? catalogChoices.find(model => local.origin === model.origin && (
      ((scene === 'dayReview' || local.origin === 'user-provided') && typeof reference === 'string' && sceneReference(model, scene) === reference)
      || (scene === 'dsh' && local.dsh && model.dsh?.provider === local.dsh.provider && model.dsh.model === local.dsh.model)
    ))
    return catalogModel ? {
      ...(catalogModel.supplierCode ? { supplierCode: catalogModel.supplierCode } : {}),
      ...(catalogModel.version ? { version: catalogModel.version } : {}),
      ...local,
    } : local
  })
  const selected = choices.find(model => model.id === selectedId)
  const requiresConfirmation = scene.startsWith('recording-') || scene.startsWith('explore-') || scene === 'dayReview'
  const checkedId = requiresConfirmation ? selectedId : currentId
  const rank = (model: ModelChoice) => model.id === currentId ? 0 : 1
  const groups = (['official', 'user-provided'] as const).map(origin => [origin, choices.filter(model => model.origin === origin).sort((a, b) => rank(a) - rank(b))] as const)
    .filter(([, models]) => models.length)
  const firstChoiceId = groups[0]?.[1][0]?.id
  const nameKey = (model: ModelChoice) => `${model.origin}:${model.name.trim().toLowerCase().replace(/\s+/g, ' ')}`
  const nameCounts = new Map<string, number>()
  for (const model of choices) nameCounts.set(nameKey(model), (nameCounts.get(nameKey(model)) ?? 0) + 1)
  const supplierLabel = (model: ModelChoice) => {
    const supplier = model.supplierCode || (['分析模型', 'Arkme 托管'].includes(model.channel)
      ? model.exploreRouteKey?.split('/')[0] || model.channel : model.channel)
    return ({ dashscope: '百炼', 'aliyun-bailian': '百炼', deepseek: 'DeepSeek', volcengine: '火山引擎', openai: 'OpenAI' } as Record<string, string>)[supplier] ?? supplier
  }
  const hasDraftChange = selected !== undefined && (selectedId !== currentId || effort !== (currentEffort ?? ''))
  // Recording's explicit generation action is meaningful even without a model change.
  const showConfirmation = choices.length > 0 && requiresConfirmation && (scene.startsWith('recording-') || scene === 'dayReview' || hasDraftChange || busy || applying)
  const originLabel = (origin: ModelOrigin) => tr(origin === 'official' ? '即我官方' : '用户自提供')
  const hasReadError = !!(data.catalogError || data.accountError || data.catalog?.failures.length)
  const restoreSelection = () => { setSelectedId(currentId); setEffort(currentEffort ?? '') }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (requiresConfirmation && selectedId && selectedId !== currentId && !selected) {
      setSelectedId('')
      setEffort('')
    }
  }, [requiresConfirmation, selectedId, currentId, selected])
  useEffect(() => { restoreSelection() }, [currentId, currentEffort])
  useEffect(() => { if (view === 'pricing' && !selected) setView('models') }, [view, selected])
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
    if (!positioned || !panel.current) return
    const option = view === 'models' ? panel.current.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not(:disabled)')
      ?? panel.current.querySelector<HTMLElement>('[role="option"]:not(:disabled)') : undefined
    option?.scrollIntoView?.({ block: 'nearest' })
    ;(option ?? panel.current).focus({ preventScroll: true })
  }, [view, positioned, selected?.id, firstChoiceId])
  const apply = async (model: ModelChoice, nextEffort?: string, closeOnSuccess = true) => {
    if (busy || applyingRef.current) return
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
    if (!requiresConfirmation) {
      if (model.id === currentId) onClose()
      else void apply(model, nextEffort)
    }
  }
  const retry = () => { setNotice(''); void Promise.all([data.refresh(), onRefresh?.()]).catch(() => setNotice('暂时无法更新，请稍后重试')) }
  const balanceText = data.account ? tr('Arkme 积分') + ' ' + formatAiPoints(data.account.availablePoints)
    : tr(data.accountError ? 'Arkme 积分暂不可用' : data.scope ? 'Arkme 积分加载中…' : '登录后查看 Arkme 积分')
  const billing = selected ? modelSceneBilling(selected, scene) : 'unknown'
  const billingHint = tr(billing === 'arkme-points' ? '使用 Arkme 积分' : billing === 'provider-account' ? '使用已绑定账户' : '此场景计费待确认')
  const body = <ArkmeBillingSettings key={data.scope ?? 'guest'} active={false} modal onCreditsChanged={() => { void data.refresh() }} renderTrigger={({ onOpen }) =>
    <div className={'arkme-unified-model-backdrop' + (anchor ? ' is-anchored' : '')} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panel} tabIndex={-1} className="arkme-unified-model-panel" style={position} role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : title}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose() }
          if (event.target instanceof Element && event.target.closest('[role="listbox"]') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            const options = [...(panel.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])], index = options.indexOf(document.activeElement as HTMLElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            event.preventDefault(); options[next]?.focus()
          }
          if (event.key === 'Tab') {
            const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
            const first = controls[0], last = controls.at(-1)
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <header className="arkme-unified-model-header">
          {view !== 'models' && initialView === 'models' && <button type="button" aria-label={tr('返回模型')} onClick={() => setView('models')}><ArrowLeft size={18}/></button>}
          <strong id={title}>{tr(view === 'usage' ? 'Arkme 积分与用量' : view === 'pricing' ? '计费详情' : '选择模型')}
            {view === 'models' && <span className="arkme-unified-model-scope" title={tr(scopeLabel)}> · {tr(scopeLabel)}</span>}
          </strong>
          <ArkmeCloseButton type="button" aria-label={tr('关闭模型面板')} onClick={onClose} />
        </header>
        {view === 'models' ? <>
          <div className="arkme-unified-model-list" role="group" aria-label={tr('当前场景可用模型')} aria-busy={applying}>
            {groups.map(([origin, models]) => <div key={origin} role="group" aria-label={originLabel(origin)} className="arkme-unified-model-group">
              <div className="arkme-unified-model-group-title">
                <span>{originLabel(origin)}</span>
                {origin === 'official' && <div className="arkme-unified-model-account" role="group" aria-label={tr('Arkme 积分账户')}>
                  <button type="button" className="arkme-unified-model-balance" aria-label={balanceText} title={tr('Arkme 可用积分')} disabled={!data.scope} onClick={() => setView('usage')}>
                    {data.account ? `· ${formatAiPoints(data.account.availablePoints)} ${tr('积分')}` : balanceText}
                  </button>
                  <button type="button" aria-label={tr('充值 Arkme 积分')} title={tr('充值 Arkme 积分')} disabled={!data.scope} onClick={onOpen}>{tr('充值')}</button>
                  <button type="button" aria-label={tr('Arkme 积分用量')} disabled={!data.scope} onClick={() => setView('usage')}>{tr('用量')}</button>
                </div>}
              </div>
              <div role="listbox" aria-label={originLabel(origin)}>
              {models.map(model => <button key={model.id} type="button" role="option" aria-selected={model.id === checkedId} disabled={busy || applying}
                className="arkme-unified-model-option" onClick={() => choose(model)}>
                <span className="arkme-unified-model-name"><span className="arkme-unified-model-primary">{model.name}
                  {origin === 'official' && nameCounts.get(nameKey(model))! > 1 && <small className="arkme-unified-model-supplier">{tr(supplierLabel(model))}</small>}
                </span>
                  {origin === 'user-provided' && <small className="arkme-unified-model-bound-account">{model.channel}</small>}
                </span>
                {model.id === currentId && <small className="arkme-unified-model-current">{tr('当前')}</small>}
                <span className="arkme-unified-model-check" aria-hidden>{model.id === checkedId && <Check size={16} weight="bold"/>}</span>
              </button>)}
              </div>
            </div>)}
            {!choices.length && !error && <p className="arkme-unified-model-empty" role="status">{tr(loading ? '正在读取模型…' : '模型暂不可用')}</p>}
          </div>
          <footer className="arkme-unified-model-footer">
            {showConfirmation && confirmationDescription && <p className="arkme-unified-model-muted">{tr(confirmationDescription)}</p>}
            {selected?.reasoning && scene !== 'dayReview' && <ThinkingEffortSlider key={selected.id} reasoning={selected.reasoning} value={effort}
              disabled={busy || applying} onPreview={setEffort} onCommit={value => {
                setNotice('')
                if (!requiresConfirmation && value !== (currentEffort ?? '')) void apply(selected, value, false)
              }}/>}
            {selected && <button type="button" className="arkme-unified-model-info" aria-label={tr('计费详情')} onClick={() => setView('pricing')}>
              <span>{billingHint}</span><span className="arkme-unified-model-info-link">{tr('详情')}<CaretRight size={14}/></span>
            </button>}
            {(notice || error) && <p className="arkme-unified-model-notice" role="alert">{notice || error}</p>}
            {!selected && requiresConfirmation && choices.length > 0 && <p className="arkme-unified-model-muted" role="status">{tr('请选择模型')}</p>}
            {error && onRefresh && <div className="arkme-unified-model-read-error"><button type="button" disabled={busy || applying || loading} onClick={retry}>{tr('重新读取模型')}</button></div>}
            {hasReadError && <div className="arkme-unified-model-read-error" role="status"><span>{tr(data.catalogError || data.catalog?.failures.length ? '部分模型信息暂不可用' : '积分暂不可用')}</span>
              {!(error && onRefresh) && <button type="button" disabled={data.loading} onClick={retry}>{tr(data.loading ? '重试中…' : '重试')}</button>}</div>}
            {showConfirmation && <button type="button" className="arkme-unified-model-confirm" disabled={!selected || busy || applying}
              onClick={() => { if (selected) void apply(selected, effort) }}>{tr(applying || busy ? '正在提交…' : confirmLabel)}</button>}
          </footer>
        </> : <div className="arkme-unified-model-content">
          {view === 'usage' ? <>
            {data.account && <div className="arkme-unified-model-usage-balance"><span>{balanceText}</span>
              {pointsUnits(data.account.reservedPoints) > 0n && <span>{tr('已预占')} {formatAiPoints(data.account.reservedPoints)} {tr('积分')}</span>}</div>}
            {data.scope && <ArkmePointsConsumption scope={data.scope} revision={data.catalog?.observedAt ?? 0}/>}
          </> : selected && <>
            <h3>{selected.name}</h3><p className="arkme-unified-model-muted">{originLabel(selected.origin)} · {selected.channel}</p>
            <p className="arkme-unified-model-muted">{tr(billing === 'arkme-points'
              ? '此场景使用 Arkme 积分，充值增加的是 Arkme 积分账户余额。'
              : billing === 'provider-account' ? '使用你绑定账户的额度或结算方式，不消耗 Arkme 积分。'
                : '当前场景的收费方式尚未确认，不能据 Arkme 积分余额判断是否可用。')}</p>
            <dl><dt>{tr('计费账户')}</dt><dd>{billing === 'arkme-points' ? tr('Arkme 积分') : billing === 'provider-account' ? selected.channel : tr('待确认')}</dd>
              <dt>{tr('具体版本')}</dt><dd>{selected.version ?? tr('待确认')}</dd>
              <dt>{tr('生效范围')}</dt><dd>{tr(scopeLabel)}</dd>
              {selected.images && <><dt>{tr('图片输入')}</dt><dd>{tr('支持')}</dd></>}</dl>
            <p className="arkme-unified-model-price">{billing !== 'unknown' && selected.pricing || tr(billing === 'provider-account' ? '使用已绑定账户的额度或结算方式。' : '此场景的报价待确认。')}</p>
            {billing === 'arkme-points' && <p className="arkme-unified-model-muted">{tr('实际费用按用量结算，是否可启动以服务端校验为准。')}</p>}
          </>}
          {hasReadError && <div className="arkme-unified-model-read-error" role="status"><span>{tr('部分信息暂不可用')}</span><button type="button" disabled={data.loading} onClick={retry}>{tr('重试')}</button></div>}
        </div>}
      </section>
    </div>} />
  return <><style>{css}{usageCss}</style>{typeof document === 'undefined' ? body : createPortal(body, document.body)}</>
}
