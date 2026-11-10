import { createContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

export const AttachmentPreviewSurface = createContext<Document | undefined>(undefined)
export interface AttachmentPreviewImageCandidate {
  key:string
  url:string
  size:number
  current():boolean
  subscribeInvalidation(listener:()=>void):()=>void
}
type RetainedImage = {key:string;image:HTMLImageElement;current():boolean;stop():void;cancel?:()=>void;claimed?:boolean}
type PreviewTransition={canvas:HTMLCanvasElement;label:string;stop():void}
// Match the existing bounded inline image byte budget; this does not change
// user-initiated original loading. Dimensions are checked again after load.
const neighborImageMaxBytes=2*1024*1024
const neighborImageMaxCount=4
/** The window owns current pixels and up to two neighbors in each direction, with
 * one speculative GET at a time. Display retains message-scope authority. */
export class AttachmentPreviewImages {
  private neighbors=new Map<string,RetainedImage>()
  private reserved:RetainedImage|undefined
  private selected:string|undefined
  private neighborKeys:Set<string>|undefined
  private active:RetainedImage|undefined
  private requested:AttachmentPreviewImageCandidate[]=[]
  private attempted=new Set<string>()
  private document:Document|undefined
  private preparing=false
  private disposed=false
  private transition:PreviewTransition|undefined
  private transitionListeners=new Set<()=>void>()
  getTransition=()=>this.transition
  subscribeTransition=(listener:()=>void)=>{this.transitionListeners.add(listener);return()=>{this.transitionListeners.delete(listener)}}
  clearTransition():void {
    const previous=this.transition;if(!previous)return
    this.transition=undefined;previous.stop();previous.canvas.width=0;previous.canvas.height=0
    for(const listener of this.transitionListeners)listener()
  }
  hold(image:HTMLImageElement,current:()=>boolean,subscribe:(listener:()=>void)=>()=>void):void {
    if(this.disposed||!current()||!image.isConnected||!image.complete||image.naturalWidth<=0||image.naturalHeight<=0)return
    const canvas=image.ownerDocument.createElement('canvas'),scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight))
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale))
    try{const context=canvas.getContext('2d');if(!context)throw new Error('canvas unavailable');context.drawImage(image,0,0,canvas.width,canvas.height)}catch{canvas.width=0;canvas.height=0;return}
    // One bounded copy of the still-authorized current picture prevents a blank switch.
    this.clearTransition()
    const value:PreviewTransition={canvas,label:image.alt,stop:()=>{}};this.transition=value
    value.stop=subscribe(()=>{if(this.transition===value)this.clearTransition()})
    if(this.transition!==value)value.stop()
    else if(!current())this.clearTransition()
    for(const listener of this.transitionListeners)listener()
  }
  private release(value:RetainedImage|undefined){if(value){value.cancel?.();value.stop();value.image.removeAttribute('src')}}
  private remove(value:RetainedImage){if(this.neighbors.get(value.key)===value)this.neighbors.delete(value.key);if(this.reserved===value)this.reserved=undefined;this.release(value)}
  select(key:string|undefined,neighborKeys?:readonly string[]):void {
    this.selected=key;this.preparing=false;this.requested=[];this.attempted.clear()
    this.neighborKeys=neighborKeys?new Set(neighborKeys.slice(0,neighborImageMaxCount)):undefined
    this.release(this.reserved);this.reserved=undefined
    if(this.active&&this.active.key!==key)this.remove(this.active)
    this.prune()
    for(const value of this.neighbors.values())if(!key||value.key!==key&&this.neighborKeys&&!this.neighborKeys.has(value.key))this.remove(value)
    const target=key?this.neighbors.get(key):undefined
    if(target){this.neighbors.delete(target.key);this.reserved=target}
  }
  take(key:string):HTMLImageElement|undefined {
    this.prune()
    const value=this.reserved?.key===key?this.reserved:undefined
    if(!value)return
    this.reserved=undefined;value.stop();value.stop=()=>{};value.claimed=true
    return value.image
  }
  releaseActive(image:HTMLImageElement):void {if(this.active?.image===image)this.remove(this.active)}
  isPending(image:HTMLImageElement):boolean {return this.active?.image===image}
  retain(key:string,image:HTMLImageElement,current:()=>boolean,subscribe:(listener:()=>void)=>()=>void):boolean {
    if(this.disposed||!this.selected||this.selected===key||this.neighborKeys&&!this.neighborKeys.has(key)||!current()||!image.complete||image.naturalWidth<=0||image.naturalHeight<=0||image.naturalWidth>2048||image.naturalHeight>2048)return false
    const previous=this.neighbors.get(key);if(previous)this.remove(previous)
    const maximum=this.neighborKeys?neighborImageMaxCount:1
    while(this.neighbors.size>=maximum)this.remove(this.neighbors.values().next().value!)
    const value:RetainedImage={key,image,current,stop:()=>{}}
    this.neighbors.set(key,value)
    value.stop=subscribe(()=>this.remove(value))
    if(this.neighbors.get(key)!==value)value.stop()
    return this.neighbors.get(key)===value
  }
  prepare(document:Document,candidates:readonly AttachmentPreviewImageCandidate[]):void {
    if(this.disposed||!this.selected||!this.neighborKeys)return
    this.document=document;this.preparing=true;this.neighborKeys=new Set(candidates.slice(0,neighborImageMaxCount).map(value=>value.key));this.prune()
    for(const value of this.neighbors.values())if(!this.neighborKeys.has(value.key))this.remove(value)
    for(const key of this.attempted)if(!this.neighborKeys.has(key))this.attempted.delete(key)
    this.requested=candidates.slice(0,neighborImageMaxCount).filter(value=>value.key!==this.selected&&this.neighborKeys!.has(value.key)&&Number.isSafeInteger(value.size)&&value.size>0&&value.size<=neighborImageMaxBytes&&value.url.trim()!==''&&value.current())
    this.pump()
  }
  stopPreparing(clear=false):void {
    this.preparing=false;this.requested=[]
    if(this.active&&!this.active.claimed){this.attempted.delete(this.active.key);this.remove(this.active)}
    if(clear){for(const value of this.neighbors.values())this.remove(value);this.release(this.reserved);this.reserved=undefined;this.attempted.clear();this.clearTransition()}
  }
  private pump():void {
    if(!this.preparing||this.disposed||this.active||!this.document)return
    const candidate=this.requested.shift();if(!candidate)return
    if(this.neighbors.has(candidate.key)||this.attempted.has(candidate.key)||!candidate.current()){this.pump();return}
    this.attempted.add(candidate.key)
    const image=this.document.createElement('img')
    const value:RetainedImage={key:candidate.key,image,current:candidate.current,stop:()=>{}}
    this.neighbors.set(value.key,value);this.active=value
    const clean=()=>{image.removeEventListener('load',loaded);image.removeEventListener('error',failed);if(this.active===value)this.active=undefined;delete value.cancel}
    const finish=(ok:boolean)=>{
      clean()
      if(!value.claimed&&(!ok||!value.current()||!image.complete||image.naturalWidth<=0||image.naturalHeight<=0||image.naturalWidth>2048||image.naturalHeight>2048))this.remove(value)
      this.pump()
    }
    const loaded=()=>finish(true),failed=()=>finish(false)
    value.cancel=clean
    value.stop=candidate.subscribeInvalidation(()=>{this.remove(value);this.pump()})
    if(this.active!==value){value.stop();return}
    image.addEventListener('load',loaded);image.addEventListener('error',failed)
    image.setAttribute('fetchpriority','low');image.setAttribute('src',candidate.url)
  }
  prune():void {
    for(const value of this.neighbors.values())if(!value.current())this.remove(value)
    if(this.reserved&&!this.reserved.current()){const value=this.reserved;this.reserved=undefined;this.release(value)}
  }
  dispose():void {this.disposed=true;this.stopPreparing(true);if(this.active)this.remove(this.active);this.selected=undefined;this.document=undefined;this.neighborKeys=undefined;this.attempted.clear()}
}
export const AttachmentPreviewImageContext=createContext<AttachmentPreviewImages|undefined>(undefined)
type Bridge = { version: number; focus(): void; close(): void }
export function attachmentPreviewBridge(): Bridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { arkmeAttachmentPreview?: Bridge }).arkmeAttachmentPreview
}

/** The child has no application bootstrap. Existing hooks run in the opener. */
export class AttachmentPreviewWindow {
  private child: Window | undefined
  private root: Root | undefined
  private identity: string | undefined
  private disconnect: (() => void) | undefined
  private images:AttachmentPreviewImages|undefined
  constructor(private readonly opener: Window, private readonly open = () => opener.open('about:blank', 'arkme-attachment-preview', 'width=800,height=600')) {}

  show(identity: string, render: (document: Document,images:AttachmentPreviewImages) => ReactNode): void {
    if (this.child?.closed) this.dispose()
    if (!this.child) {
      const child = this.open()
      if (!child) throw new Error('无法创建预览窗口，请重试')
      try {
        const doc = child.document
        doc.title = 'Arkme · 文件预览'
        const base = doc.createElement('base'); base.href = this.opener.location.href; doc.head.append(base)
        doc.body.style.margin = '0'
        this.child = child
        this.images=new AttachmentPreviewImages()
        this.root = createRoot(this.opener.document.createElement('div'))
        const sync = () => {
          doc.head.querySelectorAll('[data-arkme-preview-style]').forEach(node => node.remove())
          for (const source of this.opener.document.querySelectorAll('style,link[rel="stylesheet"]')) {
            const copy = source.cloneNode(true) as HTMLElement
            copy.setAttribute('data-arkme-preview-style', ''); doc.head.append(copy)
          }
          doc.documentElement.className = this.opener.document.documentElement.className
          doc.documentElement.style.cssText = this.opener.document.documentElement.style.cssText
          doc.documentElement.lang = this.opener.document.documentElement.lang
          doc.body.className = this.opener.document.body.className
          for (const target of [doc.documentElement, doc.body]) {
            const source = target === doc.body ? this.opener.document.body : this.opener.document.documentElement
            for (const attr of Array.from(target.attributes)) if (attr.name.startsWith('data-')) target.removeAttribute(attr.name)
            for (const attr of Array.from(source.attributes)) if (attr.name.startsWith('data-')) target.setAttribute(attr.name, attr.value)
          }
          // Theme variables can be attached to the body by the host.
          for (const name of Array.from(this.opener.document.body.style)) {
            if (name.startsWith('--')) doc.body.style.setProperty(name, this.opener.document.body.style.getPropertyValue(name))
          }
        }
        sync()
        const observer = new MutationObserver(sync)
        observer.observe(this.opener.document.head, {subtree: true, childList: true, attributes: true, characterData: true})
        observer.observe(this.opener.document.documentElement, {attributes: true})
        observer.observe(this.opener.document.body, {attributes: true})
        const unloaded = () => { if (this.child === child) this.dispose() }
        child.addEventListener('beforeunload', unloaded)
        this.disconnect = () => { observer.disconnect(); child.removeEventListener('beforeunload', unloaded) }
      } catch (error) { this.dispose(); child.close(); throw error }
    }
    if (identity !== this.identity) {
      this.identity = identity
      const doc = this.child.document
      this.root!.render(createPortal(<AttachmentPreviewSurface.Provider value={doc}><AttachmentPreviewImageContext.Provider value={this.images!}>{render(doc,this.images!)}</AttachmentPreviewImageContext.Provider></AttachmentPreviewSurface.Provider>, doc.body))
    }
    this.child.focus()
    attachmentPreviewBridge()?.focus()
  }

  close = (): void => {
    const child = this.child
    this.dispose()
    if (child && !child.closed) child.close()
    attachmentPreviewBridge()?.close()
  }
  closeSource(source: string): void {
    if (this.identity?.startsWith(`${source}:`)) this.close()
  }
  private dispose(): void {
    this.disconnect?.(); this.disconnect = undefined
    this.images?.dispose();this.images=undefined
    for (const media of this.child?.document.querySelectorAll('video,audio') ?? []) {
      const element = media as HTMLMediaElement
      element.pause(); element.removeAttribute('src'); element.load()
    }
    this.root?.unmount(); this.root = undefined
    this.child = undefined; this.identity = undefined
  }
}
let host: AttachmentPreviewWindow | undefined
export function showAttachmentPreview(identity: string, render: (document: Document,images:AttachmentPreviewImages) => ReactNode): void {
  host ??= new AttachmentPreviewWindow(window)
  try { host.show(identity, render) }
  catch { host.close(); host.show(identity, render) }
}
export function closeAttachmentPreview(): void { host?.close(); host = undefined }

export function closeAttachmentPreviewSource(source: string): void { host?.closeSource(source) }
