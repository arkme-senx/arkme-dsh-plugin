import { createContext, useContext } from 'react'
import type { ArkmeContentBlock } from '../types.js'

/** Presentation reads bytes through its business owner's authorized URL resolver.
 * No Chat identity or Record ownership is inferred from a display block.
 */
export type ArkmeMediaReadState = {status:'checking'|'available'|'revoked'} | {status:'unavailable';retry():void}
export interface ArkmeMediaAccess {
  url(block: ArkmeContentBlock): string
  subscribeReadState?(listener:(state:ArkmeMediaReadState)=>void):()=>void
}
export const ArkmeMediaAccessContext = createContext<ArkmeMediaAccess | undefined>(undefined)
export function useArkmeMediaUrl(): (block: ArkmeContentBlock) => string | undefined {
  const access = useContext(ArkmeMediaAccessContext)
  return block => access?.url(block)
}
