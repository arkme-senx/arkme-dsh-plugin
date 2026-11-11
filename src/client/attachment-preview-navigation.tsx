import {createContext,useLayoutEffect,useMemo,type ReactNode} from 'react'
import type {ArkmeContentBlock} from '../types.js'
import type {ArkmeMediaAccess} from './media-access.js'

export interface ArkmeAttachmentNavigationEntry {
  key:string
  source:string
  version:string
  blocks:ArkmeContentBlock[]
  revalidating?:boolean
  readGeneration?:number
  mediaAccess?:ArkmeMediaAccess
  blockKey?:(block:ArkmeContentBlock)=>string
  load?:(signal:AbortSignal)=>Promise<ArkmeContentBlock[]>
}
export interface ArkmeAttachmentNavigation {
  scopeKey:string
  isAttached():boolean
  getSnapshot():readonly ArkmeAttachmentNavigationEntry[]
  subscribe(listener:()=>void):()=>void
  registerPresentation(key:string,version:string,read:AttachmentPresentationReader):()=>void
  presentation(key:string,version:string,block:ArkmeContentBlock):ArkmeAttachmentPresentation|undefined
}
export interface ArkmeAttachmentPresentation {
  blocks:ArkmeContentBlock[]
  selected:ArkmeContentBlock
  mediaAccess:ArkmeMediaAccess
  image:HTMLImageElement
}
type AttachmentPresentationReader=(entry:ArkmeAttachmentNavigationEntry,block:ArkmeContentBlock)=>ArkmeAttachmentPresentation|undefined
export const ArkmeAttachmentNavigationContext=createContext<ArkmeAttachmentNavigation|undefined>(undefined)
export function attachmentNavigationBlockKey(entry:ArkmeAttachmentNavigationEntry,block:ArkmeContentBlock):string {return entry.blockKey?.(block)??block.attachmentUid??block.fileAssetUid??block.mediaRef}
export function attachmentNavigationBlocksEqual(entry:ArkmeAttachmentNavigationEntry,left:ArkmeContentBlock,right:ArkmeContentBlock):boolean {
  if(entry.blockKey)return entry.blockKey(left)===entry.blockKey(right)
  if(left.attachmentUid&&right.attachmentUid)return left.attachmentUid===right.attachmentUid
  if(left.fileAssetUid&&right.fileAssetUid)return left.fileAssetUid===right.fileAssetUid
  return !!left.mediaRef&&left.mediaRef===right.mediaRef
}
export function isAttachmentNavigationBlock(block:ArkmeContentBlock):boolean {return block.kind==='image'||block.kind==='video'}

/** One loaded conversation, held only by its list and any open preview. A new
 * conversation creates a new owner; an existing child retains its bounded range. */
export function ArkmeAttachmentNavigationProvider({scopeKey,entries,children}:{scopeKey:string;entries:ArkmeAttachmentNavigationEntry[];children:ReactNode}) {
  const owner=useMemo(()=>{
    let attached=false
    let snapshot:readonly ArkmeAttachmentNavigationEntry[]=entries.filter(entry=>!entry.revalidating)
    const listeners=new Set<()=>void>()
    // Mounted DOM readers only, never bytes or authorization. Unmount removes
    // the reader while an independent window can retain its loaded range.
    const presentations=new Map<string,{version:string;read:AttachmentPresentationReader}>()
    return {scopeKey,isAttached:()=>attached,getSnapshot:()=>snapshot,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
      registerPresentation(key:string,version:string,read:AttachmentPresentationReader){
        const value={version,read};presentations.set(key,value)
        return()=>{if(presentations.get(key)===value)presentations.delete(key)}
      },
      presentation(key:string,version:string,block:ArkmeContentBlock){
        const entry=snapshot.find(value=>value.key===key),mounted=presentations.get(key)
        if(!entry||entry.revalidating||entry.version!==version||mounted?.version!==version||!entry.blocks.some(candidate=>attachmentNavigationBlocksEqual(entry,candidate,block)))return undefined
        return mounted.read(entry,block)
      },
      attach(){attached=true},
      detach(){
        attached=false
        const retained=snapshot.filter(entry=>!entry.revalidating)
        if(retained.length!==snapshot.length)snapshot=retained
        for(const listener of listeners)listener()
      },
      update(next:ArkmeAttachmentNavigationEntry[]){
        if(snapshot===next)return
        const previous=new Map(snapshot.map(entry=>[entry.key,entry]))
        snapshot=next.flatMap<ArkmeAttachmentNavigationEntry>(entry=>{
          const old=previous.get(entry.key)
          // A pending source retains known navigation slots, never readable
          // pixels. Missing entries are still removals, not retained history.
          if(entry.revalidating)return old?[{...old,revalidating:true}]:[]
          return [{...entry,readGeneration:(old?.readGeneration??0)+(old?.revalidating?1:0)}]
        })
        for(const listener of listeners)listener()
      }}
  },[scopeKey])
  useLayoutEffect(()=>{owner.update(entries)},[owner,entries])
  useLayoutEffect(()=>{owner.attach();return()=>owner.detach()},[owner])
  return <ArkmeAttachmentNavigationContext.Provider value={owner}>{children}</ArkmeAttachmentNavigationContext.Provider>
}
