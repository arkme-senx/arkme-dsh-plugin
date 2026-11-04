import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { modelSceneBilling, type ModelChoice, type ModelScene, type UnifiedModelCatalog } from '../model-directory.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { catalogModelScenes, catalogSceneLabel, catalogScenes, catalogSupplier, filterCatalogModels, officialCatalogModels, type CatalogScene } from './model-catalog.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import css from './model-catalog.css?inline'

function ScenePrice({ model, scene }: { model: ModelChoice; scene: ModelScene }) {
  const billing = modelSceneBilling(model, scene), price = model.pointPricing
  return <section className="arkme-model-catalog-scene-price">
    <div><strong>{tr(catalogSceneLabel(scene))}</strong><span>{tr(billing === 'arkme-points' ? '使用 AI 积分' : billing === 'provider-account' ? '使用已绑定账户' : '计费信息待确认')}</span></div>
    {billing === 'arkme-points' && price ? <>
      <p>{tr('每 1,000 Token，单位：积分')}</p>
      <dl className="arkme-model-catalog-prices">{[[tr('输入'),price.cacheMissInputPerThousand],[tr('缓存输入'),price.cacheHitInputPerThousand],[tr('输出'),price.outputPerThousand]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </> : <p>{billing !== 'unknown' && model.pricing ? model.pricing : tr('该场景的计费详情暂未提供')}</p>}
  </section>
}

export function ArkmeModelCatalogDialog({ scope, onClose, returnFocusRef }: { scope: string; onClose(): void; returnFocusRef?: RefObject<HTMLElement> }) {
  useArkmeLocale()
  const dialog = useRef<HTMLDialogElement>(null), id = useId()
  useModalLayer(dialog, true, onClose)
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const [revision,setRevision] = useState(0), [search,setSearch] = useState(''), [scene,setScene] = useState<CatalogScene>('all')
  const [result,setResult] = useState<{scope:string;revision:number;value?:UnifiedModelCatalog;error?:unknown}>()
  useEffect(() => {
    const element = dialog.current; element?.showModal(); element?.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus({preventScroll:true})
    return () => { element?.close(); queueMicrotask(() => { if(returnFocusRef?.current?.isConnected) returnFocusRef.current.focus({preventScroll:true}) }) }
  },[returnFocusRef])
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<UnifiedModelCatalog>('models.directory',{expectedAccountScope:scope,officialOnly:true},controller.signal).then(value => {
      if(value.accountScope!==scope || !Array.isArray(value.models) || value.models.length>2048 || !Array.isArray(value.failures)) throw new Error('Invalid model catalog')
      if(!controller.signal.aborted) setResult({scope,revision,value})
    }).catch(error => {if(!controller.signal.aborted) setResult({scope,revision,error})})
    return () => controller.abort()
  },[scope,revision])
  const current = result?.scope===scope && result.revision===revision ? result : undefined
  const data=current?.value, models=useMemo(()=>officialCatalogModels(data?.models??[]),[data])
  const visible=filterCatalogModels(models,scene,search), loading=!current, refresh=()=>setRevision(value=>value+1)
  return createPortal(<dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="arkme-model-catalog-dialog" data-arkme-notification-blocking-overlay="true"
    onCancel={event=>{event.preventDefault();event.stopPropagation();onClose()}} onKeyDown={event=>event.stopPropagation()}
    onClick={event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose()}}>
    <style>{css}</style>
    <header className="arkme-model-catalog-header"><div><h2 id={`${id}-title`}>{tr('即我可用模型')}</h2><p>{tr('查看官方模型，可在对应功能中选用')}</p></div>
      <div><button type="button" aria-label={tr('刷新模型目录')} disabled={loading} onClick={refresh}><ArrowClockwise size={18}/></button><button type="button" aria-label={tr('关闭模型目录')} onClick={onClose}><X size={20}/></button></div>
    </header>
    <div className="arkme-model-catalog-toolbar"><input type="search" aria-label={tr('搜索模型名称或提供方')} placeholder={tr('搜索模型名称或提供方')} value={search} onChange={event=>setSearch(event.target.value)} data-modal-autofocus />
      <div role="group" aria-label={tr('筛选模型适用场景')}>{catalogScenes.map(([value,label])=><button type="button" key={value} aria-pressed={value===scene} onClick={()=>setScene(value)}>{tr(label)}</button>)}</div>
    </div>
    <div className="arkme-model-catalog-body" aria-busy={loading}>
      {loading ? <p className="arkme-model-catalog-state" role="status">{tr('正在读取官方模型…')}</p> : current.error ? <div className="arkme-model-catalog-state" role="alert"><p>{tr('暂时无法读取模型目录')}</p><button type="button" onClick={refresh}>{tr('重试')}</button></div> : <>
        {!!data?.failures.length && <div className="arkme-model-catalog-notice" role="status"><p>{tr('部分场景暂时无法读取，已展示可确认的模型。')} <span>{[...new Set(data.failures.map(item=>item.source))].join('、')}</span></p><button type="button" onClick={refresh}>{tr('重试')}</button></div>}
        <p className="arkme-model-catalog-count">{tr('共 {v0} 个模型',{v0:visible.length})}</p>
        {visible.length===0 ? <p className="arkme-model-catalog-state">{tr(search.trim() ? '没有找到匹配的模型' : '该场景暂未提供可用模型')}</p> : visible.map(model=>{
          const suppliers=[...new Set(model.models.map(catalogSupplier))], images=model.models.some(item=>item.images), reasoning=model.models.some(item=>item.reasoning?.efforts.some(effort=>effort.id!=='off'))
          const prices=new Map<ModelScene,ModelChoice>();for(const item of model.models)for(const value of catalogModelScenes(item))if(!prices.has(value)||item.pointPricing)prices.set(value,item)
          return <details className="arkme-model-catalog-model" key={model.key}><summary aria-label={tr('查看 {v0} 的能力与费用',{v0:model.name})}>
            <div><div className="arkme-model-catalog-name"><strong>{model.name}</strong><span>{suppliers.join(' · ')}</span></div><div className="arkme-model-catalog-tags"><span>{tr('文本')}</span>{images&&<span>{tr('图片')}</span>}{reasoning&&<span>{tr('深度思考')}</span>}</div><p>{model.scenes.map(value=>tr(catalogSceneLabel(value))).join(' · ')}</p></div><span className="arkme-model-catalog-more">{tr('能力与费用')} <span aria-hidden>›</span></span>
          </summary><div className="arkme-model-catalog-model-details">{[...prices].map(([scene,item])=><ScenePrice key={scene} scene={scene} model={item}/>)}
            <p className="arkme-model-catalog-footnote">{tr('模型能力及费用以对应场景为准，实际费用按用量结算。')}</p></div></details>
        })}
      </>}
    </div>
    <footer>{tr('模型目录会随官方开放情况更新')}{data&&<span>{tr('读取于 {v0}',{v0:new Intl.DateTimeFormat(arkmeIntlLocale(),{hour:'2-digit',minute:'2-digit'}).format(data.observedAt)})}</span>}</footer>
  </dialog>,document.body)
}
