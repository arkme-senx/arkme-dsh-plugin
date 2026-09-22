import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { ScreenshotFrame } from './browser-screenshot.js'
import { clamp, windowAtPoint, historyStep, imagePoint, moveSelection, rectBetween, resizeSelection, type Annotation, type Point, type Rect, type Tool } from './screenshot-editor-model.js'
import { exportScreenshot, paintScreenshot } from './screenshot-editor-render.js'
import { ScreenshotToolIcon, type ScreenshotIcon } from './screenshot-editor-icons.js'
import { AskDshIcon } from './AskDshIcon.js'
const names:Record<ScreenshotIcon,string>={rectangle:'矩形',ellipse:'圆形',arrow:'箭头',pen:'画笔',mosaic:'马赛克',text:'文本',undo:'撤销',redo:'重做',reselect:'重选',save:'保存',close:'取消',complete:'完成'}
const tools:Tool[]=['rectangle','ellipse','arrow','pen','mosaic','text']
const panel:CSSProperties={background:'#fff',color:'#24262b',border:'1px solid #dfe1e6',borderRadius:10,boxShadow:'0 8px 28px #0003'}
interface Props {
 frame:ScreenshotFrame; completionDestination?:'attachment'|'clipboard'; desktop?:boolean; windows?:readonly Rect[]; onClose():void; onComplete(blob:Blob):void|Promise<void>;
 onAskDsh?:((blob:Blob)=>Promise<void>)|undefined; onSave?(blob:Blob):Promise<boolean>; onReady?():void; onSelect?():Promise<boolean>;
}
export function ArkmeScreenshotEditor({frame,completionDestination='attachment',desktop=false,windows=[],onClose,onComplete,onSave,onAskDsh,onReady,onSelect}:Props) {
 const canvas=useRef<HTMLCanvasElement>(null),area=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null)
 const image=useRef<HTMLImageElement>(); const alive=useRef(true); const submitting=useRef(false)
 const [loaded,setLoaded]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const [view,setView]=useState({width:1,height:1,left:0,top:0}),[barSize,setBarSize]=useState({width:560,height:88})
 const [selection,setSelection]=useState<Rect>(),[tool,setTool]=useState<Tool>(),[draft,setDraft]=useState<Annotation>()
 const [hovered,setHovered]=useState<Rect>()
 const [barPosition,setBarPosition]=useState<Point>(),[barDragging,setBarDragging]=useState(false)
 const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight})
 const barGesture=useRef<{id:number;start:Point;position:Point}>()
 const [history,dispatch]=useReducer(historyStep,{done:[],undone:[]})
 const [color,setColor]=useState('#ef4444'),[line,setLine]=useState(4),[font,setFont]=useState(28),[mosaic,setMosaic]=useState(14)
 const [text,setText]=useState<{point:Point;value:string}>(),[drawing,setDrawing]=useState(false)
 const gesture=useRef<{id:number;start:Point;clientStart:Point;candidate?:Rect|undefined;dragged?:boolean;rect?:Rect;handle?:string;mark?:Annotation}>()
 const latest=useRef({onClose,onReady,onSelect});latest.current={onClose,onReady,onSelect}
 useEffect(()=> {
  alive.current=true; const url=URL.createObjectURL(frame.blob),img=new Image(); image.current=img
  img.onload=()=> { if(alive.current){setLoaded(true)} }
  img.onerror=()=>{if(alive.current)setError('截图加载失败，请取消后重试')};img.src=url
  return()=>{alive.current=false;URL.revokeObjectURL(url);img.onload=null;img.onerror=null}
 },[frame])
 useLayoutEffect(()=> {
  const element=area.current;if(!element)return
  const resize=()=> {const b=element.getBoundingClientRect();const scale=Math.min(b.width/frame.width,b.height/frame.height)
   const width=desktop?b.width:frame.width*scale,height=desktop?b.height:frame.height*scale
   setView({width,height,left:b.left+(b.width-width)/2,top:b.top+(b.height-height)/2})}
  resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect()
 },[frame.width,frame.height,desktop])
 useLayoutEffect(()=>{const el=toolbar.current;if(!el)return
  const measure=()=>{if(el.offsetWidth&&el.offsetHeight)setBarSize({width:el.offsetWidth,height:el.offsetHeight})}
  measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect()
 },[selection,drawing])
 useEffect(()=>{const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight})
  window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)
 },[])
 useEffect(()=>{setBarPosition(undefined);barGesture.current=undefined;setBarDragging(false)},[frame])
 useEffect(()=>{if(!loaded||!image.current||!canvas.current)return
  try{paintScreenshot(canvas.current,image.current,[...history.done,...(draft?[draft]:[])],selection)}catch(e){setError(String(e))}
 },[loaded,history,draft,selection])
 useEffect(()=>{if(!loaded)return;const id=requestAnimationFrame(()=>latest.current.onReady?.());return()=>cancelAnimationFrame(id)},[loaded])
 const commitText=()=> {if(text?.value.trim())dispatch({type:'add',mark:{tool:'text',points:[text.point],color,size:font,text:text.value}});setText(undefined)}
 const reset=()=> {setBarPosition(undefined);barGesture.current=undefined;setBarDragging(false);setHovered(undefined);setText(undefined);dispatch({type:'reset'});setDraft(undefined);setSelection(undefined);setTool(undefined);setStatus('')}
 const finish=async(save:boolean|'ask-dsh')=> {
  if(!selection||!loaded||submitting.current||text||gesture.current||barGesture.current)return
  submitting.current=true;setBusy(true);setError('');setStatus('')
  try{const blob=await exportScreenshot(canvas.current!,selection);if(!alive.current)return
   if(save==='ask-dsh'){await onAskDsh?.(blob)}
   else if(save){const saved=onSave?await onSave(blob):download(blob);if(alive.current&&saved)setStatus('已保存')}
   else await onComplete(blob)
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'截图导出失败，请重试')}
  finally{submitting.current=false;if(alive.current)setBusy(false)}
 }
 const actions=useRef({finish,commitText,text,busy});actions.current={finish,commitText,text,busy}
 useEffect(()=> {
  root.current?.focus()
  const key=(e:KeyboardEvent)=> {
   const input=e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(actions.current.text)setText(undefined);else latest.current.onClose();return}
   if(input)return
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();if(!actions.current.busy)dispatch({type:e.shiftKey?'redo':'undo'})}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();void actions.current.finish(true)}
   if(e.key==='Enter'&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();e.stopImmediatePropagation();void actions.current.finish(false)}
   if(e.key==='Tab') {const els=root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select');if(!els?.length)return
    const first=els[0]!,last=els[els.length-1]!;if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  }
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true)
 },[])
 const point=(e:PointerEvent)=>imagePoint(e.clientX,e.clientY,stage.current!.getBoundingClientRect(),frame.width,frame.height)
 const inSelection=(p:Point)=>!!selection&&p.x>=selection.x&&p.y>=selection.y&&p.x<=selection.x+selection.width&&p.y<=selection.y+selection.height
 const down=(e:PointerEvent<HTMLDivElement>)=> {
  if(e.button!==0||!loaded||busy||gesture.current||text)return
  const p=point(e);const handle=(e.target as HTMLElement).dataset.handle
  if(selection&&tool&&!inSelection(p))return
  if(selection&&!tool&&history.done.length)return
  e.preventDefault();setStatus('')
  if(selection&&tool==='text'){setText({point:p,value:''});return}
  const mark=selection&&tool?{tool,points:[p],color,size:tool==='mosaic'?mosaic:line,text:''}:undefined
  gesture.current={id:e.pointerId,start:p,clientStart:{x:e.clientX,y:e.clientY},candidate:!selection?windowAtPoint(windows,p):undefined,...(selection?{rect:selection}:{}),...(handle?{handle}:{}),...(mark?{mark}: {})}
  if(!selection)setHovered(windowAtPoint(windows,p))
  if(mark)setDraft(mark)
  setDrawing(true);e.currentTarget.setPointerCapture(e.pointerId)
 }
 const move=(e:PointerEvent<HTMLDivElement>)=> {
  const g=gesture.current;const p=point(e)
  if(!g){if(!selection&&loaded&&!busy)setHovered(windowAtPoint(windows,p));return}
  if(g.id!==e.pointerId)return
  if(!g.rect&&!g.mark){
   if(!g.dragged&&Math.hypot(e.clientX-g.clientStart.x,e.clientY-g.clientStart.y)<=4)return
   g.dragged=true;setHovered(undefined)
  }
  if(g.mark){const m=g.mark;const previous=m.points.at(-1)!;if((m.tool==='pen'||m.tool==='mosaic')&&Math.hypot(previous.x-p.x,previous.y-p.y)<2)return; m.points=(m.tool==='pen'||m.tool==='mosaic')?[...m.points,p]:[g.start,p];setDraft({...m});return}
  if(g.rect&&g.handle)setSelection(resizeSelection(g.rect,g.handle,p,frame.width,frame.height))
  else if(g.rect)setSelection(moveSelection(g.rect,p.x-g.start.x,p.y-g.start.y,frame.width,frame.height))
  else setSelection(rectBetween(g.start,p))
 }
 const up=(e:PointerEvent<HTMLDivElement>)=> {
  const g=gesture.current;if(!g||g.id!==e.pointerId)return
  move(e);gesture.current=undefined;setDrawing(false);e.currentTarget.releasePointerCapture(e.pointerId)
  if(g.mark){dispatch({type:'add',mark:{...g.mark}});setDraft(undefined)}
  else {const p=point(e);const r=g.rect?(g.handle?resizeSelection(g.rect,g.handle,p,frame.width,frame.height):moveSelection(g.rect,p.x-g.start.x,p.y-g.start.y,frame.width,frame.height)):g.dragged?rectBetween(g.start,p):g.candidate;setHovered(undefined);setSelection(r);if(!r||r.width<2||r.height<2)setSelection(undefined)
   else if(!g.rect)void latest.current.onSelect?.().then(ok=>{if(!ok)latest.current.onClose()}).catch(()=>latest.current.onClose())}
 }
 const cancelGesture=()=> {const g=gesture.current;gesture.current=undefined;setDrawing(false);setDraft(undefined);setHovered(undefined);if(g&&!g.mark)setSelection(g.rect)}
 const sx=view.width/frame.width,sy=view.height/frame.height
 const selected=selection&&selection.width>=2&&selection.height>=2
 const boundBar=(p:Point)=>({x:clamp(p.x,8,Math.max(8,viewport.width-barSize.width-8)),y:clamp(p.y,8,Math.max(8,viewport.height-barSize.height-8))})
 const bottom=view.top+((selection?.y??0)+(selection?.height??0))*sy+12
 const position=boundBar(barPosition??{x:view.left+(selection?.x??0)*sx,y:bottom+barSize.height<viewport.height-8?bottom:view.top+(selection?.y??0)*sy-barSize.height-12})
 const barLeft=position.x,barTop=position.y
 const dragBar=(e:PointerEvent<HTMLButtonElement>)=>{
  const g=barGesture.current;if(!g||g.id!==e.pointerId)return
  e.preventDefault();e.stopPropagation()
  setBarPosition(boundBar({x:g.position.x+e.clientX-g.start.x,y:g.position.y+e.clientY-g.start.y}))
 }
 const releaseBar=(e:PointerEvent<HTMLButtonElement>,complete=false)=>{
  if(barGesture.current?.id!==e.pointerId)return
  if(complete)dragBar(e)
  barGesture.current=undefined;setBarDragging(false)
  if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
 }
 const button=(name:ScreenshotIcon,action:()=>void,disabled=false,shortcut='')=>{
  const clipboardCompletion=name==='complete'&&completionDestination==='clipboard'
  const label=clipboardCompletion?'保存到剪贴板':names[name]
  const hint=shortcut
  return <button key={name} type="button" aria-label={names[name]} title={label+(hint?(clipboardCompletion?` · ${hint}`:`（${hint}）`):'')} aria-pressed={tools.includes(name as Tool)?tool===name:undefined}
  disabled={disabled||(busy&&name!=='close')} onClick={action} className="arkme-shot-tool" data-selected={tool===name} data-primary={name==='complete'}><ScreenshotToolIcon name={name}/><span role="tooltip">{label}{hint?` · ${hint}`:''}</span></button>
 }
 return <div ref={root} data-arkme-screenshot-editor="true" role="dialog" aria-modal="true" aria-label="截图编辑" tabIndex={-1}
  style={{position:'fixed',inset:0,zIndex:2147483100,background:'#181a20',color:'#fff',fontFamily:'system-ui,sans-serif',outline:'none',userSelect:'none'}}>
  <style>{`.arkme-shot-tool{position:relative;display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:6px;color:#414550;background:transparent;cursor:pointer;flex-shrink:0}.arkme-shot-tool:hover,.arkme-shot-tool:focus-visible{background:#edf1f8;outline:2px solid #90b8ff;outline-offset:0}.arkme-shot-tool[data-selected=true]{background:#e8f0ff;color:#2764d8}.arkme-shot-tool[data-primary=true]{background:#3478f6;color:white}[data-tooltips-below=true] .arkme-shot-tool [role=tooltip]{bottom:auto;top:calc(100% + 8px)}.arkme-shot-tool:disabled{cursor:default}.arkme-shot-tool:disabled>svg{opacity:.3}.arkme-shot-tool [role=tooltip]{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;padding:5px 8px;border-radius:5px;background:#20232b;color:#fff;font-size:12px;pointer-events:none;z-index:5}.arkme-shot-tool:hover [role=tooltip],.arkme-shot-tool:focus-visible [role=tooltip]{display:block}`}</style>
  <div ref={area} style={{position:'absolute',inset:desktop?0:'48px 24px 110px'}}/>
  <div ref={stage} data-arkme-screenshot-stage="true" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelGesture} onPointerLeave={()=>{if(!gesture.current)setHovered(undefined)}} onLostPointerCapture={()=>{if(gesture.current)cancelGesture()}}
   style={{position:'absolute',left:view.left,top:view.top,width:view.width,height:view.height,touchAction:'none',cursor:tool==='text'?'text':selection&&!tool?'move':'crosshair',overflow:'hidden'}}>
   <canvas ref={canvas} width={frame.width} height={frame.height} style={{display:'block',width:'100%',height:'100%',pointerEvents:'none'}}/>
   {!selection&&!hovered&&<div style={{position:'absolute',inset:0,background:'#0005',pointerEvents:'none'}}/>}
   {!selection&&hovered&&<div data-arkme-screenshot-window-hover="true" style={{position:'absolute',left:hovered.x*sx,top:hovered.y*sy,width:hovered.width*sx,height:hovered.height*sy,border:'2px solid #75a7ff',boxSizing:'border-box',boxShadow:'0 0 0 30000px #0008',pointerEvents:'none'}}/>}
   {selection&&<div data-arkme-screenshot-selection="true" style={{position:'absolute',left:selection.x*sx,top:selection.y*sy,width:selection.width*sx,height:selection.height*sy,border:'1px solid #75a7ff',boxSizing:'border-box',boxShadow:'0 0 0 30000px #0008',pointerEvents:'none'}}>
    <span style={{position:'absolute',left:0,top:selection.y*sy<26?4:-26,background:'#20232bdd',padding:'3px 6px',fontSize:11,whiteSpace:'nowrap'}}>{Math.round(selection.width)} × {Math.round(selection.height)}</span>
    {!tool&&!history.done.length&&['nw','n','ne','e','se','s','sw','w'].map(h=><i key={h} data-handle={h} style={{position:'absolute',left:h.includes('w')?0:h.includes('e')?'100%':'50%',top:h.includes('n')?0:h.includes('s')?'100%':'50%',width:8,height:8,background:'#fff',border:'1px solid #3478f6',transform:'translate(-50%,-50%)',pointerEvents:'auto',cursor:`${h}-resize`}}/>) }
   </div>}
   {text&&<textarea autoFocus aria-label="输入标注文字" value={text.value} onChange={e=>setText({...text,value:e.target.value.slice(0,2000)})} onBlur={commitText}
    onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();commitText()}}}
    style={{position:'absolute',left:Math.min(text.point.x*sx,Math.max(0,view.width-180)),top:Math.min(text.point.y*sy,Math.max(0,view.height-64)),width:Math.min(240,view.width),height:70,color,background:'#fffe',border:'1px solid #3478f6',fontSize:Math.min(40,font*sy),resize:'none',userSelect:'text'}}/>}
  </div>
  {!selected&&!drawing&&<div style={{position:'absolute',top:16,left:'50%',transform:'translateX(-50%)',background:'#222d',padding:'8px 12px',borderRadius:8,fontSize:13,display:'flex',alignItems:'center',gap:12}}>{loaded?(windows.length?'单击选择窗口 · 拖动自由框选 · Esc 取消':'拖动框选截图区域 · Esc 取消'):'正在加载截图…'}{button('close',onClose)}</div>}
  {selected&&!drawing&&<div ref={toolbar} data-tooltips-below={barTop<40} role="toolbar" aria-label="截图编辑工具" style={{...panel,position:'fixed',left:barLeft,top:barTop,maxWidth:'calc(100vw - 16px)',padding:6,boxSizing:'border-box'}}>
   <div style={{display:'flex',gap:2,flexWrap:'wrap',alignItems:'center'}}>
    <button type="button" className="arkme-shot-tool" aria-label="拖动截图工具栏" title="拖动工具栏" disabled={busy}
     style={{width:24,cursor:busy?'default':barDragging?'grabbing':'grab',touchAction:'none'}}
     onPointerDown={e=>{if(e.button!==0||busy||barGesture.current)return;e.preventDefault();e.stopPropagation()
      barGesture.current={id:e.pointerId,start:{x:e.clientX,y:e.clientY},position:{x:barLeft,y:barTop}};setBarDragging(true);e.currentTarget.setPointerCapture(e.pointerId)}}
     onPointerMove={dragBar} onPointerUp={e=>releaseBar(e,true)} onPointerCancel={e=>releaseBar(e)} onLostPointerCapture={e=>releaseBar(e)}>
     <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor" aria-hidden="true">{[5,10,15].flatMap(y=>[3,9].map(x=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.4"/>))}</svg>
     <span role="tooltip">拖动工具栏</span>
    </button>
    {tools.map(t=>button(t,()=>{setTool(tool===t?undefined:t)},false))}
    <span style={{height:20,borderLeft:'1px solid #e1e4e9',margin:'0 4px'}}/>
    {button('undo',()=>dispatch({type:'undo'}),!history.done.length,'⌘/Ctrl+Z')}
    {button('redo',()=>dispatch({type:'redo'}),!history.undone.length,'⌘/Ctrl+Shift+Z')}
    {button('reselect',reset)}{button('save',()=>{void finish(true)},false,'⌘/Ctrl+S')}{onAskDsh&&<button type="button" aria-label="问dsh" title="问dsh" disabled={busy} className="arkme-shot-tool" onClick={()=>{void finish('ask-dsh')}}><AskDshIcon size={20}/><span role="tooltip">问dsh</span></button>}{button('close',onClose,false,'Esc')}{button('complete',()=>{void finish(false)},false,'Enter')}
   </div>
   {tool&&<div style={{display:'flex',gap:10,alignItems:'center',padding:'6px 4px 2px',borderTop:'1px solid #eceef2',marginTop:5,fontSize:12,flexWrap:'wrap'}}>
    {tool!=='mosaic'&&<><label title="颜色" style={{display:'flex',alignItems:'center',gap:4}}>颜色 <input aria-label="标注颜色" type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:26,height:24,border:0,padding:0}}/></label>
     {['#ef4444','#fbbf24','#22c55e','#3b82f6','#ffffff','#111827'].map(c=><button key={c} title={c} aria-label={`颜色 ${c}`} onClick={()=>setColor(c)} style={{width:16,height:16,border:color===c?'2px solid #3478f6':'1px solid #ccc',borderRadius:'50%',background:c,padding:0}}/>)}</>}
    <label>{tool==='text'?'字号':tool==='mosaic'?'马赛克大小':'粗细'} <input aria-label={tool==='text'?'字号':tool==='mosaic'?'马赛克大小':'粗细'} type="range" min={tool==='text'?12:tool==='mosaic'?8:2} max={tool==='text'?72:tool==='mosaic'?32:16}
     value={tool==='text'?font:tool==='mosaic'?mosaic:line} onChange={e=>{const v=Number(e.target.value);if(tool==='text')setFont(v);else if(tool==='mosaic')setMosaic(v);else setLine(v)}} style={{width:90,verticalAlign:'middle'}}/></label>
   </div>}
  </div>}
  {(error||status)&&<div role={error?'alert':'status'} style={{position:'absolute',left:'50%',bottom:12,transform:'translateX(-50%)',background:error?'#9c2929':'#20232b',padding:'8px 16px',borderRadius:8,fontSize:13}}>{error||status}</div>}
 </div>
}
function download(blob:Blob):boolean {
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`截图-${Date.now()}.png`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);return true
}
