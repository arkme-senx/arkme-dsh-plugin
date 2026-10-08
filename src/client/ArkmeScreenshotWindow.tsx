import type {Rect} from './screenshot-editor-model.js'
import {useEffect,useState} from 'react'
import {ArkmeScreenshotEditor} from './ArkmeScreenshotEditor.js'
import type {ScreenshotFrame} from './browser-screenshot.js'
import {nativeScreenshotBridge,screenshotBlobBase64,decodeScreenshotBase64} from './native-screenshot.js'
export function ArkmeScreenshotWindow() {
 const bridge=nativeScreenshotBridge(),[frame,setFrame]=useState<ScreenshotFrame>(),[error,setError]=useState(''),[windows,setWindows]=useState<Rect[]>([]),[destination,setDestination]=useState<'attachment'|'clipboard'>('attachment')
 useEffect(()=>{let disposed=false
  void bridge?.context().then(value=>{if(disposed)return;if(!value)throw new Error('截图会话已失效')
   setDestination(value.destination??'attachment');setWindows(value.windows??[]);const bytes=decodeScreenshotBase64(value.contentBase64);setFrame({blob:new Blob([bytes],{type:'image/png'}),width:value.width,height:value.height})})
   .catch(e=>{if(!disposed){setError(String(e));void bridge?.close()}})
  return()=>{disposed=true}
 },[bridge])
 if(!bridge||!frame)return <div role="status">{error||'正在加载截图…'}</div>
 return <ArkmeScreenshotEditor frame={frame} completionDestination={destination} desktop windows={windows} onClose={()=>{void bridge.close()}}
  onReady={()=>{void bridge.ready()}} onSelect={()=>bridge.select()}
  onAskDsh={bridge.askDsh?async blob=>{if(!await bridge.askDsh!(await screenshotBlobBase64(blob)))throw new Error('截图会话已失效，请重新截图')}:undefined}
  onSave={async blob=>bridge.save(await screenshotBlobBase64(blob))}
  onComplete={async blob=>{if(!await bridge.complete(await screenshotBlobBase64(blob)))throw new Error('截图会话已失效，请重新截图')}}/>
}
