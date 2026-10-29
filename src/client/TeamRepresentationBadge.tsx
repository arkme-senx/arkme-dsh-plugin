import {useState} from 'react'
import {Users} from '@phosphor-icons/react/dist/icons/Users'
import type {TeamRepresentationSnapshot} from '../team-group-contract.js'
import {arkmeAuthStore} from './auth-store.js'
import {TeamPublicCardDialog} from './TeamPublicCardDialog.js'
import {teamIdentityBadgeStyle,teamIdentityLinkStyle} from './team-identity-presentation.js'
export function TeamRepresentationBadge({value,compact=false}:{value:Pick<TeamRepresentationSnapshot,'name'|'jotmoId'>;compact?:boolean}){
 const[open,setOpen]=useState(false),auth=arkmeAuthStore.getSnapshot().auth,accountKey=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:undefined
 return <><button type="button" title={`代表${value.name}发言；查看团队资料`} aria-label={`查看${value.name}团队资料`} onClick={event=>{event.stopPropagation();if(accountKey)setOpen(true)}}
  style={compact?{...teamIdentityBadgeStyle,padding:0,cursor:'pointer'}:teamIdentityLinkStyle}><Users size={compact?10:12} weight="fill"/>{!compact&&value.name}</button>
  {open&&accountKey&&<TeamPublicCardDialog accountKey={accountKey} jotmoId={value.jotmoId} onClose={()=>setOpen(false)}/>}</>
}
