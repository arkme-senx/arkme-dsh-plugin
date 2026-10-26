import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { callArkme } from '../../api.js'
import { tr, useArkmeLocale } from '../../locale.js'
import type { TeamCodexEvent, TeamCodexTask } from '../../../team-codex-contract.js'

type Image = NonNullable<TeamCodexEvent['privateImages']>[number]
type Props = { teamRef:string; task:TeamCodexTask; event:TeamCodexEvent }
function Picture({ image, params, full=false }: { image:Image; params:Record<string,unknown>; full?:boolean }) {
  const [url,setUrl]=useState(''),[error,setError]=useState(false),[retry,setRetry]=useState(0),[visible,setVisible]=useState(full)
  const container=useRef<HTMLSpanElement>(null),key=JSON.stringify(params)
  useEffect(()=>{
    if(full||typeof IntersectionObserver==='undefined'){setVisible(true);return}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'})
    if(container.current)observer.observe(container.current)
    return ()=>observer.disconnect()
  },[full])
  useEffect(()=>{
    if(!visible||image.state!=='ready')return
    const controller=new AbortController();setError(false);setUrl('')
    void callArkme<{dataUrl:string}>('team.codex.image',{...JSON.parse(key),ref:image.ref,full},controller.signal).then(result=>{
      if(controller.signal.aborted)return
      if(!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.dataUrl))throw Error('Invalid image')
      setUrl(result.dataUrl)
    }).catch(()=>{if(!controller.signal.aborted)setError(true)})
    return ()=>controller.abort()
  },[key,image.ref,image.state,visible,full,retry])
  return <span ref={container} className={`arkme-codex-private-picture${full?' is-full':''}`} style={full?undefined:{aspectRatio:`${image.width}/${image.height}`}}>
    {url?<img src={url} alt={tr('仅本人可见的图片')} onError={()=>{setUrl('');setError(true)}}/>:image.state==='unavailable'?<span>{tr('原图片不可用')}</span>
      :error?<span>{tr('图片加载失败')} <button type="button" onClick={e=>{e.stopPropagation();setRetry(n=>n+1)}}>{tr('重试')}</button></span>:<span role="status">{tr('图片加载中…')}</span>}
  </span>
}
export function CodexPrivateImages({teamRef,task,event}:Props) {
  useArkmeLocale()
  const [selected,setSelected]=useState<Image>(),dialog=useRef<HTMLDivElement>(null),previousFocus=useRef<HTMLElement|null>(null)
  const params={teamRef,id:task.id,turnId:event.turnId,kind:event.kind,...(task.cloud?.remote?{sourceId:task.cloud.sourceId}:{})}
  useEffect(()=>{
    if(!selected)return
    previousFocus.current=document.activeElement as HTMLElement|null;dialog.current?.focus()
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setSelected(undefined)}else if(e.key==='Tab'){
      const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>('button');if(!buttons?.length)return
      if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[buttons.length-1]?.focus()}
      else if(!e.shiftKey&&document.activeElement===buttons[buttons.length-1]){e.preventDefault();buttons[0]?.focus()}
    }}
    document.addEventListener('keydown',key)
    return ()=>{document.removeEventListener('keydown',key);previousFocus.current?.focus()}
  },[selected])
  if(!event.privateImages?.length)return null
  return <div className="arkme-codex-private-images" data-private-media="owner-only" onContextMenu={e=>e.stopPropagation()}>
    <div className="arkme-codex-private-gallery">{event.privateImages.map((image,index)=><div key={image.ref} className="arkme-codex-private-tile">
      <Picture image={image} params={params}/>
      {image.state==='ready'&&<button className="arkme-codex-private-open" type="button" aria-label={tr('查看图片')+` ${index+1}`} onClick={()=>setSelected(image)}/>}
    </div>)}</div>
    <small>{tr('仅本人可见 · 尚未同步到云端')}</small>
    {selected&&createPortal(<div className="arkme-codex-private-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(undefined)}}>
      <div ref={dialog} tabIndex={-1} className="arkme-codex-private-dialog" role="dialog" aria-modal="true" aria-label={tr('图片预览')}>
        <button className="arkme-codex-private-close" type="button" aria-label={tr('关闭图片预览')} onClick={()=>setSelected(undefined)}>×</button>
        <Picture image={selected} params={params} full/><small>{tr('仅本人可见 · 本机图片')}</small>
      </div>
    </div>,document.body)}
  </div>
}
