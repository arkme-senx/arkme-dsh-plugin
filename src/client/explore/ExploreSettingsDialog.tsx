import { useEffect, useRef, useState } from 'react'
import type { ExploreModule, ExploreSettings } from '../../explore-contract.js'
import { callArkme } from '../api.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { tr } from '../locale.js'
export function ExploreSettingsDialog({module,onClose,onChanged}:{module:ExploreModule;onClose:()=>void;onChanged:()=>void}) {
  const [data,setData]=useState<ExploreSettings>(),[model,setModel]=useState(''),[sources,setSources]=useState<string[]>([]),[error,setError]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState('')
  const request=useRef<AbortController>()
  const read=async()=>{request.current?.abort();const c=new AbortController();request.current=c;setError('')
    try{const value=await callArkme<ExploreSettings>('explore.settings',{module},c.signal);if(!c.signal.aborted){setData(value);setModel(value.models.find(x=>x.selected)?.ref??'');setSources(value.sources.filter(x=>x.enabled).map(x=>x.key))}}
    catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:tr('加载失败'))}
  }
  useEffect(()=>{void read();return()=>request.current?.abort()},[module])
  const save=async(kind:'model'|'sources')=>{if(!data||saving)return;const c=new AbortController();request.current=c;setSaving(true);setError('');setSaved('')
    try{await callArkme('explore.settings.save',{ref:data.ref,...(kind==='model'?{modelRef:model}:{sources})},c.signal);if(!c.signal.aborted){setSaved(tr('已保存'));onChanged();await read()}}
    catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:tr('保存失败'))}finally{setSaving(false)}
  }
  return <ArkmeDetailShell title={tr('分析设置')} label={tr('分析设置')} onClose={()=>{if(!saving)onClose()}}><div className="arkme-explore-dialog">
    {data?<><label>{tr('分析模型')}<select disabled={saving} value={model} onChange={e=>setModel(e.target.value)}>{!model&&<option value="">{tr('选择模型')}</option>}{data.models.map(x=><option key={x.ref} value={x.ref}>{x.label}{x.selected?` · ${tr('当前')}`:''}</option>)}</select></label><p className="explore-muted">{tr('切换模型可能启动新的分析并产生 AI 用量，已有结果会保留。')}</p><button className="explore-button" disabled={saving||!model||data.models.find(x=>x.ref===model)?.selected} onClick={()=>void save('model')}>{saving?tr('正在保存…'):tr('应用模型')}</button>
    {!!data.sources.length&&<><h3 style={{fontSize:14,marginBottom:0}}>{tr('参与分析的内容')}</h3>{data.sources.map(s=><label key={s.key} style={{display:'flex',gap:10,alignItems:'flex-start'}}><input type="checkbox" style={{width:'auto',marginTop:4}} checked={sources.includes(s.key)} disabled={saving} onChange={e=>setSources(v=>e.target.checked?[...v,s.key]:v.filter(x=>x!==s.key))}/><span>{s.label}<div className="explore-muted">{s.description}</div></span></label>)}<p className="explore-muted">{tr('调整范围会重新整理个人档案，可能产生 AI 用量。')}</p><button className="explore-button" disabled={saving||JSON.stringify([...sources].sort())===JSON.stringify(data.sources.filter(x=>x.enabled).map(x=>x.key).sort())} onClick={()=>void save('sources')}>{tr('保存分析范围')}</button></>}
    </>:!error&&<div role="status">{tr('正在加载…')}</div>}
    {saved&&<div role="status">{saved}</div>}{error&&<div role="alert" className="explore-error">{error}{!data&&<button className="explore-source-link" onClick={()=>void read()}>{tr('重试')}</button>}</div>}
  </div></ArkmeDetailShell>
}
