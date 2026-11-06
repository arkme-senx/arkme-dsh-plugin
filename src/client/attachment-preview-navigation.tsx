import {createContext,useLayoutEffect,useMemo,type ReactNode} from 'react'
import type {ArkmeContentBlock} from '../types.js'
import type {ArkmeMediaAccess} from './media-access.js'

export interface ArkmeAttachmentNavigationEntry {
  key:string
  source:string
  version:string
  blocks:ArkmeContentBlock[]
  mediaAccess?:ArkmeMediaAccess
  blockKey?:(block:ArkmeContentBlock)=>string
  load?:(signal:AbortSignal)=>Promise<ArkmeContentBlock[]>
}
export interface ArkmeAttachmentNavigation {
  scopeKey:string
  getSnapshot():readonly ArkmeAttachmentNavigationEntry[]
  subscribe(listener:()=>void):()=>void
}
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
    let snapshot:readonly ArkmeAttachmentNavigationEntry[]=entries
    const listeners=new Set<()=>void>()
    return {scopeKey,getSnapshot:()=>snapshot,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
      update(next:ArkmeAttachmentNavigationEntry[]){if(snapshot===next)return;snapshot=next;for(const listener of listeners)listener()}}
  },[scopeKey])
  useLayoutEffect(()=>{owner.update(entries)},[owner,entries])
  return <ArkmeAttachmentNavigationContext.Provider value={owner}>{children}</ArkmeAttachmentNavigationContext.Provider>
}
