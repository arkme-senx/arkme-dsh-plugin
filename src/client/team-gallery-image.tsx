import {forwardRef,useCallback,useEffect,useRef,useState,type ImgHTMLAttributes} from 'react'
import {arkmeAuthStore} from './auth-store.js'
import {backgroundUiReads} from './background-read.js'
import {tr} from './locale.js'

function accountScope():string|undefined {
  const auth=arkmeAuthStore.getSnapshot().auth
  return auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:undefined
}
type ImageAttempt={identity:string;sequence:number}
type ImageCompletion={attempt:ImageAttempt;image?:HTMLImageElement;finish():void}

/** DOM admission only. The existing Team URL still authorizes every byte read. */
export const TeamGalleryImage=forwardRef<HTMLImageElement,ImgHTMLAttributes<HTMLImageElement>&{src:string;readScopeKey:string;onUnavailable():void}>(function TeamGalleryImage({src,readScopeKey,onLoad,onError,onUnavailable,style,...props},forwardedRef){
  const target=useRef<HTMLSpanElement>(null)
  const identity=JSON.stringify([readScopeKey,src])
  const [visibleFor,setVisibleFor]=useState<string>()
  const [admitted,setAdmitted]=useState<ImageAttempt>()
  const [loaded,setLoaded]=useState<ImageAttempt>()
  const sequence=useRef(0)
  const completion=useRef<ImageCompletion>()
  const unavailable=useRef(onUnavailable);unavailable.current=onUnavailable
  const attach=useCallback((element:HTMLImageElement|null)=>{
    if(element&&completion.current)completion.current.image=element
    if(typeof forwardedRef==='function')forwardedRef(element)
    else if(forwardedRef)forwardedRef.current=element
  },[forwardedRef])

  useEffect(()=>{
    const element=target.current
    if(!element||!src.trim()||loaded?.identity===identity)return
    if(typeof IntersectionObserver!=='function'){setVisibleFor(identity);return}
    let disposed=false
    const observer=new IntersectionObserver(entries=>{
      if(!disposed)setVisibleFor(entries.some(entry=>entry.isIntersecting)?identity:undefined)
    },{rootMargin:'300px 0px'})
    observer.observe(element)
    return()=>{disposed=true;observer.disconnect()}
  },[identity,loaded])

  useEffect(()=>{
    if(visibleFor!==identity||!src.trim())return
    const scope=accountScope()
    if(!scope)return
    const controller=new AbortController(),attempt={identity,sequence:++sequence.current}
    let disposed=false,ownCompletion:ImageCompletion|undefined
    const clear=()=>{
      ownCompletion?.image?.removeAttribute('src')
      if(completion.current===ownCompletion)completion.current=undefined
      setAdmitted(value=>value===attempt?undefined:value)
      setLoaded(value=>value===attempt?undefined:value)
    }
    const stopAuth=arkmeAuthStore.subscribe(()=>{if(accountScope()!==scope){controller.abort();clear()}})
    void backgroundUiReads.run({scope,lane:'image',service:'team',signal:controller.signal,operation:signal=>{
      signal.throwIfAborted()
      if(accountScope()!==scope)throw new DOMException('Account changed','AbortError')
      return new Promise<void>((resolve,reject)=>{
        const abort=()=>{clear();reject(signal.reason)}
        const finish=()=>{signal.removeEventListener('abort',abort);resolve()}
        ownCompletion={attempt,finish};completion.current=ownCompletion
        signal.addEventListener('abort',abort,{once:true})
        setAdmitted(attempt)
      })
    }}).catch(()=>{
      if(!disposed&&!controller.signal.aborted&&accountScope()===scope)unavailable.current()
    }).finally(()=>{if(completion.current===ownCompletion)completion.current=undefined})
    return()=>{disposed=true;controller.abort();stopAuth();clear()}
  },[identity,visibleFor])

  const attempt=admitted?.identity===identity?admitted:undefined
  const ready=attempt!==undefined&&loaded===attempt
  // The stable placeholder owns visibility. Each admitted request gets its own
  // image node, so cancelled/late DOM events cannot complete a later permit.
  // Keep hidden loading images at foreground priority; React 18 forwards the lowercase attribute.
  return <span ref={target} data-arkme-team-gallery-image style={{...style,position:'relative'}}>
    {attempt&&<img {...props} key={attempt.sequence} ref={attach} src={src} loading="eager" {...{fetchpriority:'high'}}
      style={{...style,visibility:ready?style?.visibility:'hidden'}}
      onLoad={event=>{if(completion.current?.attempt!==attempt)return;completion.current.finish();setLoaded(attempt);onLoad?.(event)}}
      onError={event=>{if(completion.current?.attempt!==attempt)return;completion.current.finish();onError?.(event)}}/>}
    {!ready&&<span data-arkme-image-loading role="status" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontSize:12,color:'var(--dsw-alias-label-secondary, #68707c)',pointerEvents:'none'}}>{tr('图片加载中…')}</span>}
  </span>
})
