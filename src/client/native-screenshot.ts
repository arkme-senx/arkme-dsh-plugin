import type {Rect} from './screenshot-editor-model.js'
import type { ArkmeDesktopScreenshotResult } from '../desktop-screenshot-contract.js'
export interface ScreenshotAskRequest { requestId:string; operationId:string; contentBase64:string; fileName:string }
export interface NativeScreenshotBridge {
 askDsh?(png:string):Promise<boolean>
 askDshResult?(reply:{requestId:string;ok:boolean;error?:string}):Promise<boolean>
 onAskDsh?(listener:(request:ScreenshotAskRequest)=>void):()=>void
 onAskDshCancel?(listener:(request:{requestId:string})=>void):()=>void
 onAskDshActivate?(listener:(request:{requestId:string})=>void):()=>void
 version:1
 capture(requestId:string):Promise<ArkmeDesktopScreenshotResult>
 cancel(requestId:string):Promise<void>
 context():Promise<{contentBase64:string;width:number;height:number;windows?:Rect[];destination?:'attachment'|'clipboard'}|null>
 ready():Promise<boolean>;select():Promise<boolean>;close():Promise<void>
 complete(png:string):Promise<boolean>;save(png:string):Promise<boolean>
}
export function nativeScreenshotBridge():NativeScreenshotBridge|undefined {
 const bridge=(globalThis as typeof globalThis & {arkmeScreenshot?:NativeScreenshotBridge}).arkmeScreenshot
 return bridge?.version===1?bridge:undefined
}
export function screenshotWindowRequested():boolean {
 return typeof location!=='undefined'&&new URLSearchParams(location.search).get('arkmeScreenshot')==='1'
}
export async function captureNativeScreenshot(signal:AbortSignal):Promise<ArkmeDesktopScreenshotResult> {
 signal.throwIfAborted()
 const bridge=nativeScreenshotBridge();if(!bridge)throw new Error('客户端不支持截图编辑，请更新客户端')
 const requestId=crypto.randomUUID()
 return new Promise((resolve,reject)=> {
  const abort=()=>{void bridge.cancel(requestId).catch(()=>{});reject(signal.reason??new DOMException('已取消','AbortError'))}
  signal.addEventListener('abort',abort,{once:true})
  bridge.capture(requestId).then(result=>{if(!signal.aborted)resolve(result)},reject).finally(()=>signal.removeEventListener('abort',abort))
 })
}
export async function screenshotBlobBase64(blob:Blob):Promise<string> {
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(new Error('无法读取截图'));reader.readAsDataURL(blob)})
}

/** Use Chromium's native decoder; the iterable mapping path costs a JS call per PNG byte. */
export function decodeScreenshotBase64(value:string):Uint8Array<ArrayBuffer> {
 const bytes=Uint8Array as typeof Uint8Array & {fromBase64?:(value:string)=>Uint8Array<ArrayBuffer>}
 if(typeof bytes.fromBase64==='function')return bytes.fromBase64(value)
 const binary=atob(value),result=new Uint8Array(binary.length)
 for(let i=0;i<binary.length;i++)result[i]=binary.charCodeAt(i)
 return result
}
