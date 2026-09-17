import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelSelection, ModelProviderGroup, ModelCatalogFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { ArkmeBillingSettings, formatArkmeNanoCny } from './ArkmeBillingSettings.js'
import css from './arkme-model-select.css?inline'

/** The public ModelDirectory face; DSH remains the sole directory and selection owner. */
export interface ArkmeModelDirectory {
  store: SnapshotStore<{
    current: ModelSelection | null
    groups: readonly ModelProviderGroup[]
    failures: readonly ModelCatalogFailure[]
    status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
    error: string | null
  }>
  load(): Promise<unknown>
  select(selection: ModelSelection): Promise<unknown>
}

export function ArkmeModelSelect({ directory, locked, available }: {
  directory: ArkmeModelDirectory
  locked: boolean
  available: boolean
}) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
  const [pane, setPane] = useState<'model' | 'effort' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const group = state.groups.find(item => item.id === state.current?.provider)
  const model = group?.models.find(item => item.id === state.current?.model)
  const reasoning = model?.reasoning
  const effort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning?.efforts.find(item => item.id === effort)?.name ?? effort ?? '默认'
  const busy = locked || state.status === 'selecting'
  const reload = () => { void directory.load().catch(() => { /* DSH publishes the error on its store. */ }) }
  const close = (focus = false) => { setPane(null); if (focus) trigger.current?.focus() }

  useEffect(() => { if (available) reload() }, [available, directory])
  useEffect(() => {
    if (pane === null) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
    return () => document.removeEventListener('pointerdown', outside)
  }, [pane])

  if (!available) return null
  const choose = (selection: ModelSelection) => {
    if (busy) return
    void directory.select(selection).then(() => close(true), () => { /* Keep menu and prior selection on failure. */ })
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (pane === null) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <ArkmeBillingSettings active={pane === 'model' && state.groups.some(item => item.id === 'arkme-managed')}
    renderTrigger={({ quotaState, onOpen, onRefresh }) => <div className="arkme-model-select" ref={root} onKeyDown={keyboard}
      onBlur={event => { if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) close() }}>
      <style>{css}</style>
      <button ref={trigger} type="button" className="arkme-model-trigger" disabled={locked}
        aria-label={`选择模型：${model?.name ?? '选择模型'}`} aria-haspopup="menu" aria-expanded={pane !== null}
        aria-controls={pane === null ? undefined : id}
        onClick={() => { if (pane !== null) close(); else { setPane('model'); reload() } }}>
        <span>{model?.name ?? '选择模型'}</span>{reasoning && <small> · {effortLabel}</small>}<span aria-hidden>⌄</span>
      </button>
      {pane !== null && <div id={id} className="arkme-model-menu" role="menu" aria-label="模型选择" aria-busy={state.status === 'loading' || busy}>
        {pane === 'effort' ? <>
          <button type="button" role="menuitem" className="arkme-model-option" onClick={() => setPane('model')}>‹ 返回模型列表</button>
          {reasoning && [{ id: undefined, name: '默认', description: undefined }, ...reasoning.efforts].map(item =>
            <button key={item.id ?? 'default'} type="button" role="menuitemradio" className="arkme-model-option"
              aria-checked={item.id === (state.current?.reasoningEffort ?? undefined)} disabled={busy}
              onClick={() => { if (state.current) choose({ provider: state.current.provider, model: state.current.model,
                ...(item.id === undefined ? {} : { reasoningEffort: item.id }) }) }}>
              <span>{item.name}{item.description && <small>{item.description}</small>}</span>
              {item.id === state.current?.reasoningEffort && <span aria-hidden>✓</span>}
            </button>)}
        </> : <>
          {reasoning && <button type="button" role="menuitem" className="arkme-model-option" disabled={busy} onClick={() => setPane('effort')}>
            <span>思考强度</span><small>{effortLabel} ›</small>
          </button>}
          {state.status === 'loading' && <div className="arkme-model-status" role="status">正在加载模型…</div>}
          {state.failures.map(failure => <div key={failure.id} className="arkme-model-error" role="alert">{failure.name}：{failure.message}</div>)}
          {state.groups.map(provider => <section role="group" aria-labelledby={`${id}-${provider.id}`} key={provider.id}>
            <div className="arkme-model-group-heading">
              <span id={`${id}-${provider.id}`}>{provider.id === 'arkme-managed' ? 'Arkme' : provider.name}
                {provider.id === 'arkme-managed' && <span aria-live="polite"> · {quotaState.kind === 'ready'
                  ? formatArkmeNanoCny(quotaState.quota.availableNanoCny)
                  : quotaState.kind === 'loading' ? '余额加载中…' : '余额读取失败'}</span>}
              </span>
              {provider.id === 'arkme-managed' && <span className="arkme-model-balance-actions">
                {quotaState.kind === 'error' && <button type="button" onClick={onRefresh}>重试</button>}
                <button type="button" onClick={() => { close(true); onOpen() }}>去充值</button>
              </span>}
            </div>
            {provider.models.map(item => {
              const selected = state.current?.provider === provider.id && state.current.model === item.id
              return <button type="button" role="menuitemradio" key={item.id} className="arkme-model-option"
                aria-checked={selected} disabled={busy} onClick={() => selected ? close(true) : choose({ provider: provider.id, model: item.id })}>
                <span>{item.name}{item.description && <small>{item.description}</small>}</span>{selected && <span aria-hidden>✓</span>}
              </button>
            })}
          </section>)}
          {state.status === 'ready' && state.groups.every(item => item.models.length === 0) && <div className="arkme-model-status">暂无可用模型</div>}
        </>}
        {(state.error || state.failures.length > 0) && <div className="arkme-model-error" role="alert">
          <span>{state.error}</span><button type="button" disabled={busy} onClick={reload}>重新加载</button>
        </div>}
      </div>}
    </div>} />
}
