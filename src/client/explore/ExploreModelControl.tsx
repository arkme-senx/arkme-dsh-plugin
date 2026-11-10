import { useCallback, useEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { EXPLORE_LABELS, type ExploreModelModule, type ExploreSettings } from '../../explore-contract.js'
import { exploreModelChoices } from '../../explore-models.js'
import { UnifiedModelPicker } from '../UnifiedModelPicker.js'
import { callArkme } from '../api.js'
import { tr } from '../locale.js'

export function ExploreModelControl({ module, accountScope, onChanged }: {
  module: ExploreModelModule; accountScope: string; onChanged(message: string): void
}) {
  const [data, setData] = useState<ExploreSettings>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), reader = useRef<AbortController>(), writer = useRef<AbortController>()
  const changing = useRef(false)
  const read = useCallback(async () => {
    if (changing.current) return
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller
    setLoading(true); setError('')
    try {
      const next = await callArkme<ExploreSettings>('explore.settings', { module, part: 'models', expectedAccountScope: accountScope }, controller.signal)
      if (controller.signal.aborted) return
      if (next.accountScope !== accountScope) throw new Error('账号已切换，请重新读取模型')
      setData(next)
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('模型暂不可用'))
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [module, accountScope])
  useEffect(() => {
    void read()
    const focus = () => { if (document.visibilityState !== 'hidden') void read() }
    window.addEventListener('focus', focus)
    return () => { reader.current?.abort(); writer.current?.abort(); window.removeEventListener('focus', focus) }
  }, [read])
  const models = data ? exploreModelChoices(module, data) : []
  const selectedIndex = data?.models.findIndex(model => model.selected) ?? -1
  const currentId = models[selectedIndex]?.id ?? ''
  const label = data?.models[selectedIndex]?.label ?? tr(error ? '模型暂不可用' : loading ? '正在读取模型…' : '选择模型')
  return <>
    <button ref={trigger} type="button" className="explore-model-trigger" aria-label={tr('选择{v0}分析模型：{v1}', { v0: tr(EXPLORE_LABELS[module]), v1: label })}
      title={tr('当前分析模型')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{label}</span><CaretDown size={13} aria-hidden/>
    </button>
    {open && <UnifiedModelPicker scene={({profile:'explore-profile',events:'explore-event',goals:'explore-goal',anniversaries:'explore-anniversary'} as const)[module]} scopeLabel={EXPLORE_LABELS[module]} models={models} currentId={currentId}
      ariaLabel={tr('选择{v0}分析模型', { v0: tr(EXPLORE_LABELS[module]) })} anchor={trigger.current ?? undefined} busy={saving}
      error={error || (data && !models.length ? tr('当前板块暂无可选模型') : '')} onRefresh={read} confirmLabel="应用并重新分析"
      confirmationDescription="切换模型可能启动后台分析并产生 AI 用量，已有结果会保留。" onClose={() => setOpen(false)}
      onApply={async model => {
        const target = models.find(candidate => candidate.explore === model.explore)
        if (!data || !target?.explore || changing.current) return false
        reader.current?.abort(); const controller = new AbortController(); writer.current = controller
        changing.current = true; setSaving(true); setError('')
        try {
          const result = await callArkme<{ saved: boolean; settings?: ExploreSettings; message?: string }>('explore.settings.save', { ref: data.ref, modelRef: target.explore }, controller.signal)
          if (controller.signal.aborted) return false
          if (!result.saved || result.settings?.accountScope !== accountScope) throw new Error('模型切换状态待确认，请重新读取后核对')
          const actual = exploreModelChoices(module, result.settings).find((_, index) => result.settings!.models[index]?.selected)
          setData(result.settings)
          if (actual?.id !== target.id) throw new Error('模型切换状态待确认，请重新读取后核对')
          onChanged(result.message || tr('模型已切换，分析状态将在后台更新'))
          return true
        } catch (caught) {
          if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('模型切换失败，请重试'))
          return false
        } finally { changing.current = false; if (!controller.signal.aborted) { setSaving(false); setLoading(false) } }
      }}/>}
  </>
}
