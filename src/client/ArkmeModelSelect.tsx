import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelSelection, ModelProviderGroup, ModelCatalogFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelChoice } from '../model-directory.js'
import { UnifiedModelPicker } from './UnifiedModelPicker.js'
import css from './arkme-model-select.css?inline'

/** DSH remains the selection owner; the shared panel only adapts its public directory. */
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
export function ArkmeModelSelect({ directory, locked, available }: { directory: ArkmeModelDirectory; locked: boolean; available: boolean }) {
  useArkmeLocale()
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null)
  const reload = () => { void directory.load().catch(() => {}) }
  useEffect(() => { if (available) reload() }, [available, directory])
  if (!available) return null
  const models: ModelChoice[] = state.groups.flatMap(provider => provider.models.map(model => ({
    id: JSON.stringify(['dsh', provider.id, model.id]), name: model.name, identifier: model.id,
    origin: provider.id === 'arkme-managed' ? 'official' : 'user-provided',
    channel: provider.id === 'arkme-managed' ? 'Arkme 托管' : provider.name,
    billing: provider.id === 'arkme-managed' ? 'arkme-points' as const : 'provider-account' as const,
    billingByScene: { dsh: provider.id === 'arkme-managed' ? 'arkme-points' : 'provider-account' },
    ...(provider.id === 'arkme-managed' && model.description ? { pricing: model.description } : {}),
    ...(model.reasoning ? { reasoning: { efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name,
      ...(effort.description ? { description: effort.description } : {}) })), ...(model.reasoning.defaultEffort ? { defaultEffort: model.reasoning.defaultEffort } : {}) } } : {}),
    dsh: { provider: provider.id, model: model.id },
  })))
  const currentId = JSON.stringify(['dsh', state.current?.provider, state.current?.model]), model = models.find(item => item.id === currentId)
  const effort = state.current?.reasoningEffort ?? model?.reasoning?.defaultEffort
  const effortName = model?.reasoning?.efforts.find(item => item.id === effort)?.name ?? effort
  return <div className="arkme-model-select"><style>{css}</style>
    <button ref={trigger} type="button" className="arkme-model-trigger" disabled={locked} aria-label={tr('选择模型：{v0}', { v0: model?.name ?? tr('选择模型') })}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(value => !value); reload() }}>
      <span>{model?.name ?? state.current?.model ?? tr('选择模型')}</span>{effortName && <small> · {effortName}</small>}<span aria-hidden>⌄</span>
    </button>
    {open && <UnifiedModelPicker scene="dsh" scopeLabel="当前 DSH 对话" models={models} currentId={currentId} currentEffort={state.current?.reasoningEffort ?? undefined}
      anchor={trigger.current ?? undefined} busy={locked || state.status === 'selecting'}
      error={[state.error, ...state.failures.map(failure => `${failure.name}：${failure.message}`)].filter(Boolean).join('；')}
      onRefresh={async () => { await directory.load() }} onClose={() => setOpen(false)} onApply={async (selected, reasoningEffort) => {
        const target = selected.dsh
        if (!target || !state.groups.some(group => group.id === target.provider && group.models.some(item => item.id === target.model))) throw new Error('此模型暂未出现在当前对话目录，请刷新后重试')
        await directory.select({ ...target, ...(reasoningEffort ? { reasoningEffort } : {}) }); return true
      }}/>}
  </div>
}
