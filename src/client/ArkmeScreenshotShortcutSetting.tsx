import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {PencilSimple} from '@phosphor-icons/react/PencilSimple'
import {screenshotShortcutBridge,shortcutFromKey,shortcutLabel,useScreenshotShortcut} from './screenshot-shortcut.js'
import {tr,useArkmeLocale} from './locale.js'

export function ArkmeScreenshotShortcutSetting(){
 useArkmeLocale()
 const snapshot=useScreenshotShortcut()
 const [open,setOpen]=useState(false)
 if(!snapshot)return null
 return <><div className="arkme-shortcut-row"><span>{tr('截图快捷键')}</span><span style={{marginLeft:'auto'}}>{shortcutLabel(snapshot.accelerator)}</span><button type="button" aria-label={tr('编辑截图快捷键')} title={tr('编辑截图快捷键')} onClick={()=>setOpen(true)}><PencilSimple size={18}/></button></div>
 {!snapshot.available&&<p role="status">{tr('截图快捷键已被占用，请更换组合')}</p>}
 {open&&<ShortcutDialog initial={snapshot.accelerator} onClose={()=>setOpen(false)}/>}
 <style>{`.arkme-shortcut-row{display:flex;align-items:center;gap:12px;padding:16px 0;font-size:14px}.arkme-shortcut-row button{display:grid;place-items:center;border:0;background:transparent;color:inherit;cursor:pointer;padding:6px;border-radius:6px}.arkme-shortcut-dialog{color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid #8884;border-radius:16px;padding:24px;width:360px;max-width:calc(100vw - 48px);box-sizing:border-box;box-shadow:0 16px 60px #0003}.arkme-shortcut-dialog::backdrop{background:#0006}.arkme-shortcut-dialog h3{margin:0 0 16px}.arkme-shortcut-dialog p{font-size:13px}.arkme-shortcut-keys{display:flex;justify-content:center;gap:8px;padding:24px 0}.arkme-shortcut-keys kbd{padding:8px 12px;border:1px solid #8885;border-radius:7px;font:inherit;box-shadow:0 2px 0 #8883}.arkme-shortcut-actions{display:flex;justify-content:flex-end;gap:12px}.arkme-shortcut-actions button{padding:7px 16px;border:1px solid #8885;border-radius:8px;cursor:pointer}.arkme-shortcut-actions button:last-child{background:var(--dsw-alias-button-primary-fill,#252525);color:var(--dsw-alias-label-primary-inverted,#fff)}.arkme-shortcut-actions button:disabled{opacity:.4;cursor:default}`}</style></>
}
function ShortcutDialog({initial,onClose}:{initial:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [draft,setDraft]=useState(initial),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 const live=useRef(true)
 useEffect(()=>{
  const bridge=screenshotShortcutBridge();live.current=true;dialog.current?.showModal()
  void bridge?.record(true).then(ok=>{if(live.current){setReady(ok);if(!ok)setError('另一窗口正在编辑快捷键')}}).catch(()=>{if(live.current)setError('无法编辑快捷键，请重试')})
  return ()=>{live.current=false;void bridge?.record(false).catch(()=>{})}
 },[])
 useEffect(()=>{
  if(!ready||busy)return
  const record=(event:KeyboardEvent)=>{
   if(event.key==='Escape'||event.key==='Tab'||event.key==='Enter'&&!(event.metaKey||event.ctrlKey||event.altKey))return
   event.preventDefault();event.stopImmediatePropagation()
   if(event.repeat)return
   const next=shortcutFromKey(event)
   if(next){setDraft(next);setError('')}else if(!['Meta','Control','Alt','Shift'].includes(event.key))setError('请使用 Command、Ctrl 或 Alt 加字母、数字或功能键的组合')
  }
  document.addEventListener('keydown',record,true);return ()=>document.removeEventListener('keydown',record,true)
 },[ready,busy])
 const save=async()=>{if(!ready||busy)return;setBusy(true);setError('');try{await screenshotShortcutBridge()!.set(draft);if(live.current)onClose()}catch(e){if(live.current)setError(e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'快捷键保存失败，请重试')}finally{if(live.current)setBusy(false)}}
 return createPortal(<dialog ref={dialog} className="arkme-shortcut-dialog" aria-labelledby="arkme-shortcut-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
  <h3 id="arkme-shortcut-title">{tr('截图快捷键')}</h3><p>{tr(ready?'请按下新的快捷键组合':'正在准备快捷键录入…')}</p>
  <div className="arkme-shortcut-keys" aria-live="polite">{shortcutLabel(draft).split(' + ').map(key=><kbd key={key}>{key}</kbd>)}</div>
  {error&&<p role="alert" style={{color:'#d43838'}}>{tr(error)}</p>}
  <div className="arkme-shortcut-actions"><button type="button" disabled={busy} onClick={onClose}>{tr('取消')}</button><button type="button" disabled={!ready||busy} onClick={()=>void save()}>{tr(busy?'保存中…':'确认')}</button></div>
 </dialog>,document.body)
}
