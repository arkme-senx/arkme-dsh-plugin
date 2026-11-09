import { createContext, useContext } from 'react'
import type { ArkmeContentBlock } from '../types.js'

/** Presentation reads bytes through its business owner's authorized URL resolver.
 * No Chat identity or Record ownership is inferred from a display block.
 */
export type ArkmeMediaReadState = {status:'checking'|'available'|'revoked'} | {status:'unavailable';retry():void}
export interface ArkmeImagePresentation {
  current(): boolean
  subscribeInvalidation(listener:()=>void):()=>void
}
export interface ArkmeMediaAccess {
  url(block: ArkmeContentBlock): string
  /** Stable account/source/version identity, independent of a selected attachment or rotating ref. */
  readScopeKey?: string
  /** This owner's no-store byte route independently reauthorizes each image read. */
  prepareImageWhileChecking?: boolean
  /** A mounted, already-visible source presentation; never a grant for new reads or actions. */
  imagePresentation?: ArkmeImagePresentation
  subscribeReadState?(listener:(state:ArkmeMediaReadState)=>void):()=>void
}
export const ArkmeMediaAccessContext = createContext<ArkmeMediaAccess | undefined>(undefined)
export function useArkmeMediaUrl(): (block: ArkmeContentBlock) => string | undefined {
  const access = useContext(ArkmeMediaAccessContext)
  return block => access?.url(block)
}
