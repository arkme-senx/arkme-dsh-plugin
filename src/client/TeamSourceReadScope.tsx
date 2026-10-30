import {useEffect,useState,type ReactNode} from 'react'
import {watchTeamSourceRead,type TeamSourceReadTarget} from './team-source-read.js'

/** Frozen references retain intent; only their current source authority displays material. */
export function TeamSourceReadScope({children,...target}:TeamSourceReadTarget&{children(authorized:boolean):ReactNode}) {
  const identity=JSON.stringify([target.accountKey,target.conversationRef,target.messageRef,target.version,target.conversationKey,target.messageKey])
  const [authorized,setAuthorized]=useState<string>()
  useEffect(()=>watchTeamSourceRead(target,state=>setAuthorized(state.status==='available'?identity:undefined)),[identity])
  return children(authorized===identity)
}
